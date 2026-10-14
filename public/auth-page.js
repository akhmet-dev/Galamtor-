(function initializeAuthPage() {
  const status = document.getElementById('status');
  const spinner = document.getElementById('spinner');
  const controls = document.getElementById('retry-container');
  const help = document.getElementById('setup-help');
  const params = new URLSearchParams(location.search);
  let storage = null, state = params.get('state'), generation = 0, busy = false, credentials = null, persistenceReady = false;
  try { storage = sessionStorage; } catch {}
  const flow = window.GalamtorAuthFlow;
  function setStatus(text, loading = false) { status.textContent = text; spinner.style.display = loading ? 'inline-block' : 'none'; }
  function log(code) {
    // Only fixed diagnostic codes; never provider messages, identities or tokens.
    document.getElementById('logs').textContent += `\n${code}`;
  }
  function button(id, text, callback) {
    const node = document.createElement('button');
    node.id = id; node.type = 'button'; node.textContent = text; node.className = 'auth-action';
    node.addEventListener('click', callback); controls.appendChild(node);
    return node;
  }
  function reloadRetry() { controls.replaceChildren(); button('retry-btn', 'Қайталап көру', () => location.reload()); }
  if (!window.firebase || !flow || !window.GalamtorAsync) {
    setStatus('Google кіру модулі жүктелмеді. Желіні тексеріп, қайталап көріңіз.');
    reloadRetry(); return;
  }
  if (!flow.isValidState(state)) {
    try { state = storage?.getItem(flow.LOGIN_STATE_KEY); } catch {}
  }
  if (!flow.isValidState(state)) {
    setStatus('Galamtor қолданбасынан Google кіруін бастаңыз.'); return;
  }
  try { storage?.setItem(flow.LOGIN_STATE_KEY, state); } catch {}
  history.replaceState({}, document.title, location.pathname);
  const firebaseConfig = {
    apiKey: 'AIzaSyDkEReqxwG0_IR12_lNFioKSPEdipqcPZ8',
    authDomain: 'galamtor-browser-974cc.firebaseapp.com',
    projectId: 'galamtor-browser-974cc',
    storageBucket: 'galamtor-browser-974cc.firebasestorage.app',
    messagingSenderId: '984286831243',
    appId: '1:984286831243:web:e694bfabf858f946eeaa8e'
  };
  let auth, provider;
  try {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
  } catch { setStatus('Google кіру модулі іске қосылмады. Қайталап көріңіз.'); reloadRetry(); return; }
  const { withTimeout } = GalamtorAsync;
  function showLogin(retry = false) {
    controls.replaceChildren();
    button(retry ? 'retry-btn' : 'login-btn', retry ? 'Google арқылы қайта кіру' : 'Google арқылы кіру', persistenceReady ? startPopup : ready);
    button('cancel-btn', 'Кіруді тоқтату', cancel);
  }
  function showError(code) {
    const messages = {
      'auth/popup-blocked': 'Google терезесі бұғатталды. Осы сайтқа popup рұқсатын беріп, батырманы қайта басыңыз.',
      'auth/popup-closed-by-user': 'Google терезесі жабылды. Қайта кіруге болады.',
      'auth/cancelled-popup-request': 'Алдыңғы Google терезесі жабылды. Қайта кіруге болады.',
      'auth/network-request-failed': 'Желіге қосылмады. Интернетті тексеріп, қайта көріңіз.',
      'auth/timeout': 'Кіру уақыты аяқталды. Galamtor қолданбасынан қайта бастаңыз.',
      'auth/unauthorized-domain': 'Firebase бұл сайттың доменіне рұқсат бермеді.',
      'auth/account-exists-with-different-credential': 'Бұл аккаунт басқа кіру әдісімен тіркелген.',
      'auth/invalid-credential': 'Google кіру деректері жарамсыз. Қолданбадан қайта бастаңыз.'
    };
    setStatus(messages[code] || 'Google кіруі аяқталмады. Қайталап көріңіз.');
    log(Object.hasOwn(messages, code) ? code : 'auth/failed');
    if (code === 'auth/unauthorized-domain') {
      help.hidden = false; help.textContent = 'Firebase әкімшісі Google provider мен сайттың рұқсат етілген домендерін тексеруі керек.';
      controls.replaceChildren(); button('cancel-btn', 'Кіруді тоқтату', cancel);
    } else showLogin(true);
  }
  async function sendCredentials(id) {
    if (busy || !credentials) return;
    busy = true; controls.replaceChildren(); button('cancel-btn', 'Кіруді тоқтату', cancel);
    setStatus('Galamtor қолданбасында кіру расталуда…', true);
    try {
      const response = await fetch('http://127.0.0.1:4242/callback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(40000), body: JSON.stringify({ state, ...credentials })
      });
      if (id !== generation) return;
      if (response.ok) {
        const acknowledgment = await response.json().catch(() => null);
        if (id !== generation) return;
        credentials = null; flow.clearLogin(storage); controls.replaceChildren(); auth.signOut().catch(() => {});
        if (acknowledgment?.ok === true && acknowledgment.code === 'complete') {
          setStatus('✅ Galamtor кіруі расталды! Қолданбаға оралыңыз.'); log('auth/complete');
        } else {
          setStatus('Google деректері қолданбаға жіберілді. Кіру нәтижесін Galamtor-да тексеріңіз. Толық растау үшін 1.5.1 немесе жаңа нұсқа қажет.'); log('callback/legacy-app');
        }
      } else {
        credentials = null; controls.replaceChildren();
        setStatus('Galamtor кіруді растамады немесе сұрау мерзімі аяқталды. Қолданбаға оралып, кіруді қайта бастаңыз.');
        log(`callback/http-${response.status}`);
      }
    } catch {
      if (id !== generation) return;
      setStatus('Galamtor-мен байланыс орнамады. Қолданба ашық екенін тексеріңіз. Браузер сұраса, жергілікті желіге рұқсат беріңіз.');
      log('callback/unavailable'); controls.replaceChildren();
      button('retry-btn', 'Galamtor-ға қайта жіберу', () => sendCredentials(generation));
      button('cancel-btn', 'Кіруді тоқтату', cancel);
    } finally { if (id === generation) busy = false; }
  }
  function startPopup() {
    if (busy || !persistenceReady) return;
    busy = true; const id = ++generation; help.hidden = true;
    controls.replaceChildren(); button('cancel-btn', 'Кіруді тоқтату', cancel);
    setStatus('Google терезесінде аккаунтты таңдаңыз…', true);
    // Invoke directly in the click handler, preserving Safari's user gesture.
    let request;
    try { request = auth.signInWithPopup(provider); } catch (error) { request = Promise.reject(error); }
    withTimeout(request, 120000, 'auth/timeout').then(async result => {
      if (id !== generation) return;
      const credential = firebase.auth.GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.idToken && !credential?.accessToken) throw Object.assign(new Error('Missing credential'), { code: 'auth/invalid-credential' });
      credentials = { googleIdToken: credential.idToken || null, googleAccessToken: credential.accessToken || null };
      busy = false;
      await sendCredentials(id);
    }).catch(error => {
      if (id !== generation) return;
      busy = false; showError(error?.code);
    });
  }
  async function cancel() {
    generation++; busy = false; credentials = null; flow.clearLogin(storage);
    controls.replaceChildren(); setStatus('Кіру тоқтатылды. Google терезесін жауып, Galamtor-ға оралыңыз.');
    auth.signOut().catch(() => {});
    try {
      const response = await fetch('http://127.0.0.1:4242/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000), body: JSON.stringify({ state }) });
      if (!response.ok) throw new Error('Cancellation unavailable');
    } catch { setStatus('Бұл беттегі кіру тоқтатылды. Galamtor-дағы «Кіруді тоқтату» батырмасын да басыңыз.'); }
  }
  async function ready() {
    const id = generation;
    try {
      // Recover a legacy redirect once; new attempts always use an explicit popup.
      if (params.get('mode') !== 'login') {
        const result = await withTimeout(auth.getRedirectResult(), 8000, 'auth/timeout');
        if (id !== generation) return;
        if (result?.user) {
          const credential = firebase.auth.GoogleAuthProvider.credentialFromResult(result);
          if (credential?.idToken || credential?.accessToken) {
            credentials = { googleIdToken: credential.idToken || null, googleAccessToken: credential.accessToken || null };
            await withTimeout(auth.setPersistence(firebase.auth.Auth.Persistence.NONE), 8000, 'auth/timeout');
            await sendCredentials(generation); return;
          }
        }
        flow.clearRedirectPending(storage);
      }
      // The external helper does not retain an account/token on disk.
      await withTimeout(auth.setPersistence(firebase.auth.Auth.Persistence.NONE), 8000, 'auth/timeout');
      if (id !== generation) return;
      persistenceReady = true;
      setStatus('Google арқылы кіруді басыңыз. Аккаунт таңдау бөлек терезеде ашылады.');
      showLogin(); log('auth/popup-ready');
    } catch (error) { if (id === generation) showError(error?.code); }
  }
  setStatus('Google кіруі дайындалуда…', true);
  ready();
})();
