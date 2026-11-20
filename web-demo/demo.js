const demoOrigin = location.origin;
const initialLesson = {
  id: 'lesson', kind: 'explanation', title: 'Жай бөлшектерді салыстыру',
  intro: 'Бөлімдері әртүрлі бөлшектерді ортақ бөлімге келтір. Содан кейін алымдарын салыстыр.',
  steps: ['3 пен 5 үшін ортақ бөлім — 15.', '2/3 = 10/15, ал 3/5 = 9/15.', '10 > 9, сондықтан 2/3 > 3/5.'],
  speech: 'Жай бөлшектерді салыстыру. Үш пен бес үшін ортақ бөлім он бес. Үштен екі он бестен онға тең. Бестен үш он бестен тоғызға тең. Он тоғыздан үлкен, сондықтан үштен екі бестен үштен үлкен.'
};
const stateKey = 'ortaq-share-demo-v1';
const pageView = new URLSearchParams(location.search).get('view');

window.fetch = async (path, options = {}) => {
  const state = JSON.parse(localStorage.getItem(stateKey) || 'null') ?? {
    question: initialLesson, answers: {}, revealed: false
  };
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const teacher = pageView === 'teacher';
  if (path === '/account') return reply({ registered: true, name: 'Демо мұғалім' });
  if (path === '/join') return reply({ url: demoOrigin + '/?view=student', hasQr: false });
  if (path === '/state') {
    const answers = Object.values(state.answers);
    const counts = { '<': 0, '=': 0, '>': 0 };
    for (const { answer } of answers) counts[answer]++;
    return reply({
      question: state.question, total: answers.length, revealed: state.revealed,
      answers: teacher ? answers : undefined, counts: state.revealed || teacher ? counts : null
    });
  }
  const body = JSON.parse(options.body || '{}');
  if (teacher && ['/question', '/explanation'].includes(path)) {
    state.question = { ...(path === '/explanation' ? initialLesson : { left: body.left, right: body.right }), id: crypto.randomUUID() };
    state.revealed = false;
    state.answers = {};
  } else if (teacher && path === '/reveal' && body.id === state.question.id) {
    state.revealed = true;
  } else if (pageView === 'student' && path === '/answer' && body.id === state.question.id && !state.revealed && state.question.kind !== 'explanation' && ['<', '=', '>'].includes(body.answer)) {
    state.answers[body.device] = { name: body.name, answer: body.answer };
  } else {
    return reply({}, 400);
  }
  localStorage.setItem(stateKey, JSON.stringify(state));
  return reply({ ok: true });
};
