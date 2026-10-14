(function initializeLocalAuthBridge() {
  const params = new URLSearchParams(location.search);
  const state = params.get('state'), origin = params.get('origin'), opener = window.opener;
  const status = document.getElementById('status'), cancelButton = document.getElementById('cancel-btn');
  let busy = false, finished = false, confirmed = false;
  const setStatus = text => { status.textContent = text; };
  if (!opener || !/^[a-f0-9]{64}$/.test(state || '') || !origin) {
    setStatus('Кіруді Galamtor қолданбасынан қайта бастаңыз.'); cancelButton.hidden = true; return;
  }
  history.replaceState({}, document.title, '/bridge');
  function notify(ok, code) { opener.postMessage({ type: 'galamtor-auth-result', state, ok, code }, origin); }
  const timer = setTimeout(() => {
    if (busy || finished) return;
    finished = true; setStatus('Кіру деректері келмеді. Алдыңғы терезеден қайта көріңіз.');
    cancelButton.hidden = true; notify(false, 'bridge/timeout');
  }, 10000);
  async function cancel() {
    if (finished) return;
    finished = true; clearTimeout(timer); cancelButton.hidden = true;
    setStatus('Кіру тоқтатылуда…');
    try {
      const response = await fetch('/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }), signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Cancellation unavailable');
      setStatus('Кіру тоқтатылды. Galamtor-ға оралыңыз.'); notify(false, 'auth/cancelled');
    } catch { setStatus('Galamtor-дағы «Кіруді тоқтату» батырмасын басыңыз.'); notify(false, 'bridge/unavailable'); }
  }
  cancelButton.addEventListener('click', cancel);
  window.addEventListener('message', async event => {
    if (event.origin !== origin || event.source !== opener || event.data?.state !== state) return;
    if (event.data.type === 'galamtor-auth-cancel') {
      if (finished) notify(false, confirmed ? 'auth/already-complete' : 'auth/cancelled');
      else await cancel();
      return;
    }
    if (finished) return;
    if (event.data.type !== 'galamtor-auth-credential' || busy) return;
    const token = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/\s/.test(value) ? value : null;
    const googleIdToken = token(event.data.googleIdToken), googleAccessToken = token(event.data.googleAccessToken);
    if (!googleIdToken && !googleAccessToken) return;
    busy = true; clearTimeout(timer); setStatus('Galamtor қолданбасында кіру расталуда…');
    try {
      const response = await fetch('/callback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(40000),
        body: JSON.stringify({ state, googleIdToken, googleAccessToken })
      });
      if (finished) return;
      const result = await response.json().catch(() => null);
      const ok = response.ok && result?.ok === true && result.code === 'complete';
      finished = true; confirmed = ok; cancelButton.hidden = true;
      setStatus(ok ? '✅ Galamtor кіруі расталды! Қолданбаға оралыңыз.' : 'Galamtor кіруді растамады. Қолданбада қайта бастаңыз.');
      notify(ok, ok ? 'complete' : 'bridge/rejected');
    } catch {
      if (finished) return;
      finished = true; cancelButton.hidden = true;
      setStatus('Galamtor-мен байланыс үзілді. Алдыңғы терезеден қайта көріңіз.'); notify(false, 'bridge/unavailable');
    }
  });
  opener.postMessage({ type: 'galamtor-auth-ready', state }, origin);
})();
