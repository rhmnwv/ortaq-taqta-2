import http from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const page = readFileSync(new URL('./index.html', import.meta.url));
const script = readFileSync(new URL('./app.js', import.meta.url));
const teacherKey = randomUUID();
const teacherSessions = new Set();
let account;
const addresses = Object.values(networkInterfaces()).flat()
  .filter(info => info.family === 'IPv4' && !info.internal)
  .map(info => info.address);
const joinLinks = addresses.map(address => 'http://' + address + ':8080/?view=student');
let qr;
try {
  const saved = JSON.parse(readFileSync(new URL('./join-qr.json', import.meta.url), 'utf8'));
  if (joinLinks.includes(saved.url)) qr = saved;
} catch {
  // The board can still show a join link while the QR is being prepared.
}
const explanation = {
  kind: 'explanation',
  title: 'Жай бөлшектерді салыстыру',
  intro: 'Бөлімдері әртүрлі бөлшектерді ортақ бөлімге келтір. Содан кейін алымдарын салыстыр.',
  steps: [
    'Ортақ бөлімді тап. 3 пен 5 үшін ортақ бөлім — 15.',
    'Бөлшектерді түрлендір. 2/3 = 10/15, ал 3/5 = 9/15.',
    'Алымдарды салыстыр. 10 саны 9-дан үлкен. Сондықтан 2/3 > 3/5.'
  ],
  speech: 'Жай бөлшектерді салыстыру. Бөлімдері әртүрлі бөлшектерді ортақ бөлімге келтір. Содан кейін алымдарын салыстыр. Мысалы, үш пен бес үшін ортақ бөлім — он бес. Үштен екі — он бестен онға тең. Бестен үш — он бестен тоғызға тең. Он саны тоғыздан үлкен, сондықтан үштен екі бестен үштен үлкен.'
};
let question = process.argv.includes('--demo') ? { ...explanation, id: randomUUID() } : null;
let revealed = false;
const answers = new Map();

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const token = req.headers['x-teacher-key'];
  const teacher = token === teacherKey || teacherSessions.has(token);
  const send = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(page);
  }
  if (['GET', 'HEAD'].includes(req.method) && path === '/media/sign-language.mp4') {
    const file = new URL('./web-demo/media/sign-language.mp4', import.meta.url);
    const size = statSync(file).size;
    const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
    const range = req.headers.range;
    let start = 0;
    let end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end;
      }
      if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || start >= size || end < start || (!match[1] && Number(match[2]) === 0)) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + size });
        return res.end();
      }
      headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  }
  if (req.method === 'GET' && path === '/app.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(script);
  }
  if (req.method === 'GET' && path === '/account') {
    return send(200, { registered: Boolean(account), name: teacher ? account?.name : undefined });
  }
  if (req.method === 'GET' && path === '/join') {
    return send(200, { url: qr?.url ?? joinLinks[0], hasQr: Boolean(qr) });
  }
  if (req.method === 'GET' && path === '/join-qr.svg' && qr) {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.end(qr.svg);
  }
  if (req.method === 'GET' && path === '/state') {
    const counts = { '<': 0, '=': 0, '>': 0 };
    for (const { answer } of answers.values()) counts[answer]++;
    return send(200, {
      question, total: answers.size, revealed,
      counts: revealed || teacher ? counts : null,
      answers: teacher ? [...answers.values()] : undefined
    });
  }
  if (req.method !== 'POST' || !['/question', '/reveal', '/answer', '/explanation', '/register', '/login'].includes(path)) return send(404, {});
  if (['/question', '/reveal', '/explanation'].includes(path) && !teacher) return send(403, {});
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4096) return send(413, {});
    }
    const data = JSON.parse(raw);
    if (path === '/register' || path === '/login') {
      const name = typeof data.name === 'string' ? data.name.trim().replace(/\s+/g, ' ') : '';
      const password = data.password;
      if (name.length < 2 || name.length > 80 || typeof password !== 'string' || password.length < 6 || password.length > 100) return send(400, {});
      if (path === '/register') {
        if (account) return send(409, {});
        const salt = randomUUID();
        account = { name, salt, hash: scryptSync(password, salt, 64) };
      } else if (!account || name.toLowerCase() !== account.name.toLowerCase() || !timingSafeEqual(account.hash, scryptSync(password, account.salt, 64))) {
        return send(401, {});
      }
      const session = randomUUID();
      teacherSessions.add(session);
      return send(200, { token: session, name: account.name });
    }
    if (path === '/explanation') {
      question = { ...explanation, id: randomUUID() };
      answers.clear();
      revealed = false;
    } else if (path === '/question') {
      if (![data.left, data.right].every(value => typeof value === 'string' && /^\d{1,3}\/[1-9]\d{0,2}$/.test(value))) return send(400, {});
      question = { id: randomUUID(), left: data.left, right: data.right };
      answers.clear();
      revealed = false;
    } else if (path === '/reveal') {
      if (!question || question.kind === 'explanation' || data.id !== question.id) return send(409, {});
      revealed = true;
    } else {
      if (!question || question.kind === 'explanation' || data.id !== question.id) return send(409, {});
      if (revealed || !Object.hasOwn({ '<': 1, '=': 1, '>': 1 }, data.answer)) return send(400, {});
      if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 40 || typeof data.device !== 'string' || !/^[a-z0-9-]{8,80}$/.test(data.device)) return send(400, {});
      answers.set(data.device, { name: data.name.trim(), answer: data.answer });
    }
    send(200, { ok: true });
  } catch {
    send(400, {});
  }
});

server.listen(8080, '0.0.0.0', () => {
  console.log('Компьютер: http://localhost:8080');
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) console.log('Wi-Fi: http://' + info.address + ':8080');
    }
  }
  console.log('Мұғалім кілті: ' + teacherKey);
});
