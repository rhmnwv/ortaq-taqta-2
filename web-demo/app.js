const byId = id => document.getElementById(id);
const requested = new URLSearchParams(location.search).get('view');
const view = ['teacher', 'board', 'student'].includes(requested) ? requested : 'home';
const status = message => { if (byId('status').textContent !== message) byId('status').textContent = message; };
let key = sessionStorage.getItem('teacherKey') || '';
let device = localStorage.getItem('ortaqDevice');
if (!device) {
  device = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  localStorage.setItem('ortaqDevice', device);
}
let activeId;
let activeLesson;
let explanationStep = 0;
let submitted;
let posting = false;
let connected = false;

byId(view).hidden = false;
document.querySelector(view === 'home' ? 'nav a[href="/"]' : 'nav a[href="/?view=' + view + '"]').setAttribute('aria-current', 'page');
byId('studentActions').hidden = view !== 'student';
byId('boardResults').hidden = view !== 'board';
byId('name').value = sessionStorage.getItem('studentName') || '';

async function request(path, data) {
  const headers = view === 'teacher' ? { 'X-Teacher-Key': key } : {};
  if (data) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    headers, cache: 'no-store', method: data ? 'POST' : 'GET',
    body: data ? JSON.stringify(data) : undefined
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

function equation(question) {
  const node = byId('equation');
  node.replaceChildren();
  [question.left, '□', question.right].forEach(value => {
    const part = document.createElement('span');
    if (value.includes('/')) {
      part.className = 'fraction';
      part.setAttribute('role', 'img');
      part.setAttribute('aria-label', fractionLabel(value));
      for (const number of value.split('/')) {
        const item = document.createElement('span');
        item.textContent = number;
        part.append(item);
      }
    } else {
      part.setAttribute('aria-hidden', 'true');
      part.textContent = value;
    }
    node.append(part);
  });
}

function fractionLabel(value) {
  const [numerator, denominator] = value.split('/');
  return 'Алымы ' + numerator + ', бөлімі ' + denominator;
}

function update(state) {
  const { question, revealed, total, counts, answers } = state;
  const authorized = view !== 'teacher' || Array.isArray(answers);
  if (view === 'teacher') {
    byId('auth').hidden = authorized;
    byId('controls').hidden = !authorized;
    byId('reveal').disabled = !question || question.kind === 'explanation' || revealed;
    byId('teacherTotal').textContent = total + ' оқушы жауап берді';
    if (authorized) {
      const rows = answers.map(({ name, answer }) => {
        const row = document.createElement('tr');
        for (const value of [name, answer]) row.insertCell().textContent = value;
        return row;
      });
      const table = byId('responses');
      const signature = JSON.stringify(answers);
      if (table.dataset.signature !== signature) {
        table.replaceChildren(...rows);
        table.dataset.signature = signature;
      }
    }
  }
  byId('task').hidden = !question || !authorized;
  byId('waiting').hidden = Boolean(question) || !authorized || view === 'teacher';
  if (!question) return;
  if (activeId !== question.id) {
    activeId = question.id;
    activeLesson = question.kind === 'explanation' ? question : null;
    explanationStep = 0;
    window.speechSynthesis?.cancel();
    byId('taskTitle').textContent = activeLesson?.title ?? 'Бөлшектерді салыстыр';
    byId('equation').hidden = Boolean(activeLesson);
    byId('explanationText').hidden = !activeLesson;
    byId('choices').hidden = Boolean(activeLesson);
    byId('choosePrompt').hidden = Boolean(activeLesson);
    byId('boardResults').hidden = view !== 'board' || Boolean(activeLesson);
    updateReadingMode();
    if (activeLesson) {
      byId('equation').dataset.speech = activeLesson.speech;
      signFrames = [activeLesson.intro, ...activeLesson.steps];
      setSignPanel(false);
      if (view === 'student') status('Сабақ түсіндірмесі ашылды.');
      return;
    }
    equation(question);
    signFrames = ["Бөлшектерді салыстыр.", "Сол жақтағы бөлшек: " + fractionLabel(question.left) + ". Оң жақтағы бөлшек: " + fractionLabel(question.right) + ".", "Кіші, тең немесе үлкен белгісін таңда."];
    setSignPanel(false);
    byId('equation').dataset.speech = 'Бөлшектерді салыстыр. Бірінші бөлшек: ' + fractionLabel(question.left) + '. Екінші бөлшек: ' + fractionLabel(question.right) + '. Кіші, тең немесе үлкен белгісін таңда.';
    submitted = sessionStorage.getItem('answer:' + activeId);
    if (view === 'student') status(submitted ? 'Жауабың жіберілді.' : 'Жаңа тапсырма ашылды.');
  }
  if (activeLesson) return;
  if (view === 'student') {
    for (const button of byId('choices').querySelectorAll('button')) {
      button.disabled = revealed || posting;
      button.setAttribute('aria-pressed', String(button.value === submitted));
    }
    if (revealed) status('Жауап қабылдау аяқталды.');
  }
  if (view === 'board') {
    const message = total + ' оқушы жауап берді';
    if (byId('total').textContent !== message) byId('total').textContent = message;
    byId('counts').hidden = !revealed;
    if (revealed) byId('counts').textContent = 'Кіші: ' + counts['<'] + ' · Тең: ' + counts['='] + ' · Үлкен: ' + counts['>'];
  }
}

async function refresh() {
  try {
    const state = await request('/state');
    if (!connected) status('');
    connected = true;
    update(state);
    return state;
  } catch {
    connected = false;
    status('Байланыс үзілді. Қайта қосылуда…');
  }
}

let registered = true;

function configureAuth(account) {
  registered = account.registered;
  byId('authTitle').textContent = registered ? 'Кабинетке кіру' : 'Мұғалім ретінде тіркелу';
  byId('authHint').textContent = registered ? 'Тіркелген аты-жөніңіз бен құпиясөзіңізді енгізіңіз.' : 'Демо үшін аты-жөніңізді және кемінде 6 таңбалы жаңа құпиясөз жазыңыз.';
  byId('authSubmit').textContent = registered ? 'Кіру' : 'Тіркелу';
  byId('password').autocomplete = registered ? 'current-password' : 'new-password';
  byId('welcome').textContent = account.name ? 'Қош келдіңіз, ' + account.name + '!' : '';
}

if (view === 'teacher') request('/account').then(configureAuth).catch(() => status('Кабинет жүктелмеді.'));

byId('auth').addEventListener('submit', async event => {
  event.preventDefault();
  const button = byId('authSubmit');
  button.disabled = true;
  try {
    const session = await request(registered ? '/login' : '/register', {
      name: byId('teacherName').value,
      password: byId('password').value
    });
    key = session.token;
    sessionStorage.setItem('teacherKey', key);
    byId('password').value = '';
    configureAuth({ registered: true, name: session.name });
    await refresh();
    status('Мұғалім кабинеті ашылды.');
  } catch (error) {
    if (error.message === '409') configureAuth(await request('/account').catch(() => ({ registered: true })));
    status(error.message === '401' ? 'Аты-жөніңізді және құпиясөзіңізді тексеріңіз.' : 'Кіру орындалмады. Деректерді тексеріп, қайталап көріңіз.');
  } finally {
    button.disabled = false;
  }
});

async function teacherAction(path, data, message) {
  try {
    await request(path, data);
    await refresh();
    status(message);
  } catch {
    status('Әрекет орындалмады. Кілтті, байланысты және тапсырманы тексеріңіз.');
  }
}

byId('questionForm').addEventListener('submit', event => {
  event.preventDefault();
  return teacherAction('/question', Object.fromEntries(new FormData(event.target)), 'Сұрақ жіберілді.');
});
byId('reveal').addEventListener('click', () => teacherAction('/reveal', { id: activeId }, 'Нәтиже тақтаға шықты.'));

byId('settings').addEventListener('click', event => {
  const button = event.target.closest('[data-setting]');
  if (!button) return;
  const setting = button.dataset.setting;
  const enabled = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(enabled));
  if (setting === 'steps') {
    explanationStep = 0;
    updateReadingMode();
  } else {
    document.body.classList.toggle(setting, enabled);
  }
});

function updateReadingMode() {
  const stepped = view === 'student' && document.querySelector('[data-setting="steps"]').getAttribute('aria-pressed') === 'true';
  byId('instruction').hidden = Boolean(activeLesson) || stepped;
  byId('steps').hidden = Boolean(activeLesson) || !stepped;
  byId('nextStep').hidden = !activeLesson || !stepped;
  if (!activeLesson) return;
  byId('explanationIntro').textContent = activeLesson.intro;
  const lines = activeLesson.steps.slice(0, stepped ? explanationStep + 1 : undefined);
  byId('explanationSteps').replaceChildren(...lines.map(line => {
    const item = document.createElement('li');
    item.textContent = line;
    return item;
  }));
  byId('nextStep').textContent = explanationStep >= activeLesson.steps.length - 1 ? 'Басынан оқу' : 'Келесі қадам';
}

byId('nextStep').addEventListener('click', () => {
  if (!activeLesson) return;
  explanationStep = (explanationStep + 1) % activeLesson.steps.length;
  updateReadingMode();
});
byId('publishExplanation').addEventListener('click', () => {
  const board = window.open('/?view=board', 'ortaq-board');
  if (board) board.focus();
  return teacherAction('/explanation', {}, board
    ? 'Түсіндіру тақта мен планшеттерге жіберілді.'
    : 'Түсіндіру жіберілді. Тақтаны ашу үшін сабақтағы «Тақтаны бөлек ашу» сілтемесін басыңыз.');
});

byId('listen').addEventListener('click', () => {
  const speech = window.speechSynthesis;
  const voice = speech?.getVoices().find(option => /^kk(?:[-_]|$)/i.test(option.lang));
  if (!voice) return status('Қазақша дыбыстау үшін құрылғыға қазақша дауыс орнату қажет.');
  speech.cancel();
  const utterance = new SpeechSynthesisUtterance(byId('equation').dataset.speech);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.onerror = () => status('Дыбыстау іске қосылмады.');
  speech.speak(utterance);
});

byId('choices').addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || posting) return;
  const name = byId('name').value.trim();
  if (!name) {
    byId('name').focus();
    return status('Алдымен атыңды енгіз.');
  }
  const id = activeId;
  posting = true;
  try {
    await request('/answer', { id, device, answer: button.value, name });
    sessionStorage.setItem('studentName', name);
    sessionStorage.setItem('answer:' + id, button.value);
    if (id === activeId) {
      submitted = button.value;
      status('Жауабың жіберілді.');
    }
  } catch {
    status('Жауап қабылданбады. Тапсырма мен байланысты тексер.');
  } finally {
    posting = false;
    await refresh();
  }
});

let signFrames = [];
let signIndex = 0;

function showSignFrame() {
  byId('signCaption').textContent = signFrames[signIndex];
  byId('signNext').textContent = signIndex === signFrames.length - 1 ? 'Қайта бастау' : 'Келесі кадр';
}

function setSignPanel(open) {
  byId('signPanel').hidden = !open;
  byId('signDemo').setAttribute('aria-expanded', String(open));
  signIndex = 0;
  if (open) showSignFrame();
}

byId('signDemo').addEventListener('click', () => setSignPanel(byId('signPanel').hidden));
byId('signNext').addEventListener('click', () => {
  signIndex = (signIndex + 1) % signFrames.length;
  showSignFrame();
});

async function poll() {
  await refresh();
  setTimeout(poll, 650);
}
if (view === 'home') byId('waiting').hidden = true;
else poll();


if (view === 'board') {
  document.body.classList.add('presenter');
  byId('fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      status('Толық экранды браузер мәзірінен қосыңыз.');
    }
  });
  document.addEventListener('fullscreenchange', () => {
    byId('fullscreen').textContent = document.fullscreenElement ? 'Толық экраннан шығу' : 'Толық экран';
  });
  byId('toggleQr').addEventListener('click', () => {
    const panel = byId('join');
    panel.hidden = !panel.hidden;
    const button = byId('toggleQr');
    button.setAttribute('aria-expanded', String(!panel.hidden));
    button.textContent = panel.hidden ? 'QR-ды көрсету' : 'QR-ды жасыру';
  });
  request('/join').then(({ url, hasQr }) => {
    if (!url) return;
    const link = byId('joinLink');
    link.href = url;
    link.textContent = url;
    if (hasQr) {
      byId('joinQr').src = '/join-qr.svg';
      byId('joinQr').hidden = false;
    }
    byId('join').hidden = false;
    byId('toggleQr').hidden = false;
  }).catch(() => status('Қосылу сілтемесі жүктелмеді.'));
}

const grade = byId('grade');
const subject = byId('subject');
const topic = byId('topic');
byId('library').addEventListener('submit', event => event.preventDefault());
function updateTopics() {
  const available = grade.value === '6' && subject.value === 'math';
  topic.replaceChildren(new Option('Тақырыпты таңдаңыз', ''));
  if (available) topic.add(new Option('Жай бөлшектерді салыстыру', 'fractions'));
  topic.disabled = !available;
  byId('catalogEmpty').hidden = !subject.value || available;
  byId('lesson').hidden = true;
}

grade.addEventListener('change', () => {
  subject.value = '';
  subject.disabled = !grade.value;
  updateTopics();
});
subject.addEventListener('change', updateTopics);
topic.addEventListener('change', () => {
  byId('lesson').hidden = !topic.value;
});
byId('lessonQuestions').addEventListener('click', async event => {
  const button = event.target.closest('button[data-left]');
  if (!button) return;
  const buttons = Array.from(byId('lessonQuestions').querySelectorAll('button'));
  buttons.forEach(item => { item.disabled = true; });
  try {
    const { left, right } = button.dataset;
    await teacherAction('/question', { left, right }, 'Сұрақ тақта мен телефондарға жіберілді.');
  } finally {
    buttons.forEach(item => { item.disabled = false; });
  }
});





