(function startGalamtorWeb() {
  'use strict';
  const $ = id => document.getElementById(id);
  const Shared = window.GalamtorBrowserState, Model = window.GalamtorWebState;
  let storage;
  try { storage = window.localStorage; }
  catch { storage = { getItem() { throw new Error('Unavailable'); }, setItem() { throw new Error('Unavailable'); }, removeItem() { throw new Error('Unavailable'); } }; }
  const repository = Model.createRepository(storage);
  const loaded = repository.load();
  let state = loaded.state, storageError = loaded.error;
  let closedTabs = [], bookmarkEditing = null, vibeEditing = null, currentPanel = 'profile';
  let bookmarkQuery = '', historyQuery = '', sourceOffset = 0, commandSelection = 0, commands = [];
  let toastTimer, syncTimer, currencyRequest = 0, hasRates = false;
  let authController, authState = { status: 'loading', message: 'Кіру модулі жүктелуде…', remember: false, rememberAvailable: false, syncStatus: 'idle' };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const wallpaperNames = { alatau: 'Алатау', bozzhira: 'Бозжыра', kolsai: 'Көлсай', charyn: 'Шарын', burabay: 'Бурабай', kaindy: 'Қайыңды', akorda: 'Ақорда', turkestan: 'Түркістан', aktau: 'Ақтау', shymbulak: 'Шымбұлақ' };
  const sources = [
    ['Tengrinews жаңалықтары', 'Tengrinews.kz', 'https://tengrinews.kz', 'thumb-tech', '⌕'],
    ['eGov қызметтері', 'eGov.kz', 'https://egov.kz', 'thumb-gov', 'E'],
    ['Қазақстан заңдары', 'Әділет', 'https://adilet.zan.kz/kaz/', 'thumb-fin', '§'],
    ['Білім және сабақтар', 'BilimLand', 'https://bilimland.kz/kk', 'thumb-edu', '✦'],
    ['ҚМДБ ресми сайты', 'Muftyat.kz', 'https://www.muftyat.kz/kk/', 'thumb-gov', '☾'],
    ['Қазақша Wikipedia', 'Wikipedia', 'https://kk.wikipedia.org', 'thumb-tech', 'W']
  ];
  const actionList = [
    ['new-tab', 'Жаңа қойынды', 'Alt+T'], ['reopen-tab', 'Жабылған қойындыны қайтару', 'Alt+Shift+T'],
    ['home', 'Басты бет', ''], ['open-bookmarks', 'Бетбелгілер', ''], ['add-bookmark', 'Таңдаулы сайт қосу', 'Alt+D'],
    ['open-history', 'Galamtor-дан ашылған сайттар', ''], ['command-palette', 'Қойындылар мен әрекеттерден іздеу', '⌘/Ctrl+K'],
    ['open-settings', 'Басты бетті баптау', ''], ['open-profile', 'Workspace және профиль', ''],
    ['lens', 'Galamtor Lens', ''], ['ai-tools', 'AI сайттары', '']
  ];
  const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const activeTab = () => state.tabs.find(tab => tab.id === state.activeId) || state.tabs[0];
  const vibe = () => state.vibes.find(item => item.id === state.activeVibe) || state.vibes[0];

  function toast(message) {
    clearTimeout(toastTimer); $('web-toast').textContent = message; $('web-toast').hidden = false;
    toastTimer = setTimeout(() => { $('web-toast').hidden = true; }, 4200);
  }
  function renderStorageWarning() {
    const warning = $('storage-warning');
    warning.hidden = !storageError;
    warning.textContent = storageError === 'corrupt'
      ? 'Сақталған Workspace оқылмады. Оның үстіне жазылмайды. Баптаулардан JSON импорттаңыз немесе жергілікті деректі тазалаңыз.'
      : 'Браузер деректі сақтауға рұқсат бермеді. Өзгерістер осы ашық бетте ғана қалады.';
  }
  function save(message) {
    const result = repository.save(state);
    storageError = result.ok ? null : result.error;
    renderStorageWarning();
    renderStats();
    if (message) toast(result.ok ? message : 'Өзгеріс осы сессияда қолданылды, бірақ қайта ашқанда сақталмауы мүмкін.');
    scheduleStats();
    return result.ok;
  }
  function scheduleStats() {
    if (authState.status !== 'connected') return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => authController?.syncStats({ openTabsCount: state.tabs.length, pinnedTabsCount: state.bookmarks.length,
      vibesCount: state.vibes.length, registrationDate: state.profile.createdAt }), 500);
  }
  function renderStats() {
    $('workspace-stats').innerHTML = `<div><strong>${state.tabs.length}</strong><span>ҚОЙЫНДЫ</span></div><div><strong>${state.bookmarks.length}</strong><span>ТАҢДАУЛЫ</span></div><div><strong>${escapeHTML(vibe().name)}</strong><span>ВАЙБ</span></div>`;
  }

  function nativeOpen(url) {
    // A real user-initiated browser tab; no iframe or privileged page access.
    const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    document.body.appendChild(link); link.click(); link.remove();
  }
  function addVisit(url, title) {
    const previous = state.history[0];
    if (previous?.url === url && Date.now() - previous.timestamp < 1000) return;
    state.history.unshift({ url, title, timestamp: Date.now() });
    state.history = state.history.slice(0, 500);
  }
  function prepareSite(url, title = '', newTab = true) {
    const address = Shared.webURL(url);
    if (!address) { toast('Тек жарамды HTTP немесе HTTPS мекенжайын ашуға болады.'); return false; }
    let tab = state.tabs.find(item => item.url === address);
    if (!tab && newTab) {
      if (state.tabs.length >= 50) { toast('50 қойынды шегіне жеттіңіз. Бір қойындыны жабыңыз.'); return false; }
      tab = { id: Model.id(), url: address, title: title || new URL(address).hostname };
      state.tabs.push(tab);
    } else if (!tab) {
      tab = activeTab(); tab.url = address; tab.title = title || new URL(address).hostname;
    }
    state.activeId = tab.id; addVisit(address, tab.title); save(); renderTabs(); renderActiveView();
    return true;
  }
  function openSite(url, title = '', newTab = true) {
    if (!prepareSite(url, title, newTab)) return;
    nativeOpen(url);
  }
  function navigate(input) {
    const value = input.trim();
    if (!value) { toast('Іздеу сөзін немесе сайт мекенжайын енгізіңіз.'); return; }
    const url = window.GalamtorURLUtils.parseSearchOrURL(value);
    if (!Shared.webURL(url)) { toast('Бұл мекенжайға рұқсат жоқ. HTTP/HTTPS сайтты енгізіңіз.'); return; }
    const searched = url.startsWith('https://www.google.com/search?');
    openSite(url, searched ? value.slice(0, 150) : new URL(url).hostname, false);
  }
  function newTab() {
    if (state.tabs.length >= 50) { toast('50 қойынды шегіне жеттіңіз. Бір қойындыны жабыңыз.'); return; }
    const tab = Model.homeTab(); state.tabs.push(tab); state.activeId = tab.id;
    save(); renderTabs(); renderActiveView(); $('welcome-search-input').focus();
  }
  function closeTab(id) {
    const index = state.tabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const [tab] = state.tabs.splice(index, 1); closedTabs.unshift({ tab, index }); closedTabs = closedTabs.slice(0, 20);
    if (!state.tabs.length) state.tabs.push(Model.homeTab());
    if (state.activeId === id) state.activeId = state.tabs[Math.min(index, state.tabs.length - 1)].id;
    save(); renderTabs(); renderActiveView();
  }
  function reopenTab() {
    const previous = closedTabs.shift();
    if (!previous) { toast('Қайта ашатын қойынды жоқ.'); return; }
    if (state.tabs.length >= 50) { closedTabs.unshift(previous); toast('Алдымен бір қойындыны жабыңыз.'); return; }
    state.tabs.splice(Math.min(previous.index, state.tabs.length), 0, previous.tab);
    state.activeId = previous.tab.id; save('Қойынды қайтарылды.'); renderTabs(); renderActiveView();
  }
  function goHome() {
    let tab = state.tabs.find(item => item.url === null);
    if (!tab) { newTab(); return; }
    state.activeId = tab.id; save(); renderTabs(); renderActiveView();
  }
  function renderTabs() {
    $('tabs-container').replaceChildren();
    state.tabs.forEach(tab => {
      const row = document.createElement('div'); row.className = `tab${tab.id === state.activeId ? ' active' : ''}`; row.dataset.tabId = tab.id;
      const select = document.createElement('button'); select.type = 'button'; select.className = 'web-tab-open'; select.setAttribute('role', 'tab');
      select.setAttribute('aria-selected', String(tab.id === state.activeId)); select.tabIndex = tab.id === state.activeId ? 0 : -1;
      select.textContent = tab.title; select.title = tab.title;
      select.addEventListener('click', () => { state.activeId = tab.id; save(); renderTabs(); renderActiveView(); });
      const close = document.createElement('button'); close.type = 'button'; close.className = 'tab-close'; close.textContent = '×';
      close.setAttribute('aria-label', `${tab.title} сілтеме қойындысын жабу`); close.addEventListener('click', () => closeTab(tab.id));
      row.append(select, close); $('tabs-container').appendChild(row);
    });
    document.querySelectorAll('[data-action="reopen-tab"]').forEach(button => { button.disabled = !closedTabs.length; });
  }
  function renderActiveView() {
    const tab = activeTab();
    $('welcome-screen').hidden = Boolean(tab.url); $('web-site-view').hidden = !tab.url;
    $('url-input').value = tab.url || '';
    document.title = tab.url ? `${tab.title} · Galamtor Web` : 'Galamtor Web';
    if (tab.url) {
      $('site-title').textContent = tab.title; $('site-url').textContent = tab.url; $('site-open').href = tab.url;
    }
    renderBookmarkStatus();
  }
  function renderBookmarkStatus() {
    const existing = state.bookmarks.find(item => item.url === activeTab().url);
    $('btn-bookmark-current').textContent = existing ? '★' : '☆';
    $('btn-bookmark-current').setAttribute('aria-label', existing ? 'Бетбелгіні өңдеу' : 'Бетбелгі қосу');
    $('site-bookmark').textContent = existing ? '★ Бетбелгіні өңдеу' : '☆ Таңдаулыға қосу';
  }
  function siteLink(bookmark, className) {
    const link = document.createElement('a'); link.href = bookmark.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.className = className; link.dataset.site = bookmark.title; return link;
  }
  function renderFavorites() {
    const bar = $('bookmarks-bar-items'), home = $('home-favorites'); bar.replaceChildren(); home.replaceChildren();
    if (!state.bookmarks.length) {
      const text = document.createElement('span'); text.className = 'web-bar-empty'; text.textContent = 'Таңдаулы сайтыңызды ＋ арқылы қосыңыз'; bar.appendChild(text);
      const empty = document.createElement('div'); empty.className = 'web-empty'; empty.textContent = 'Күнде ашатын сайттарың осында тұрады. «Қосу» арқылы алғашқы сайтты сақта.'; home.appendChild(empty);
    }
    for (const bookmark of state.bookmarks.slice(0, 100)) {
      const top = siteLink(bookmark, 'web-bar-link'); top.textContent = bookmark.title; top.title = `${bookmark.title} · ${bookmark.url}`; bar.appendChild(top);
    }
    for (const bookmark of state.bookmarks.slice(0, 12)) {
      const tile = siteLink(bookmark, 'web-favorite'); tile.title = bookmark.url;
      const icon = document.createElement('span'); icon.setAttribute('aria-hidden', 'true'); icon.textContent = bookmark.title[0].toLocaleUpperCase();
      const label = document.createElement('span'); label.textContent = bookmark.title;
      tile.append(icon, label); home.appendChild(tile);
    }
    renderBookmarkStatus();
  }

  function showDialog(id) {
    closeMenu(); window.GalamtorWebPet?.close();
    const dialog = $(id); if (!dialog.open) dialog.showModal();
  }
  function closeDialog(element) { element.closest('dialog')?.close(); }
  function openWorkspace(panel = 'profile') {
    currentPanel = panel; renderStats(); renderWorkspace(); showDialog('workspace-dialog');
  }
  function renderWorkspace() {
    $('workspace-nav').querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.panel === currentPanel));
    if (currentPanel === 'profile') renderProfile();
    else if (currentPanel === 'bookmarks') renderBookmarkPanel();
    else if (currentPanel === 'history') renderHistoryPanel();
    else if (currentPanel === 'vibes') renderVibesPanel();
    else renderSettings();
  }
  function renderProfile() {
    $('workspace-panel').innerHTML = `<form id="profile-form"><label class="web-field">Пайдаланушы аты<input id="profile-name" maxlength="100" autocomplete="off" value="${escapeHTML(state.profile.name)}" required></label><p id="profile-error" role="alert"></p><button type="submit" class="web-primary">Атын сақтау</button></form>
      <section class="web-auth-card"><h3>Бұлтты синхрондау</h3><p id="auth-status" role="status" aria-live="polite"></p><div class="web-card-actions"><button id="google-login" class="web-primary" type="button">Google арқылы кіру</button><button id="google-cancel" type="button" hidden>Кіруді тоқтату</button><button id="google-signout" type="button" hidden>Шығу</button></div><p id="sync-status" class="web-muted" role="status" aria-live="polite"></p><button id="sync-retry" class="web-text-button" type="button" hidden>Бұлтқа қайта сақтау</button></section>
      <label class="web-checkbox"><input id="remember-signin" type="checkbox">Осы браузерде Google кіруін сақтау</label><p class="web-muted">Жеке құрылғыда ғана қосыңыз. Сессия осы браузердің шифрланған қоймасында сақталады. Браузердегі сайт деректерін өшірсеңіз, кіру де жойылады. Өшірулі болса, бетті қайта ашқанда Google-ге қайта кіресіз.</p>
      <p class="web-muted">Бұлтқа тек қойындылар, таңдаулылар және вайбтар саны сақталады. Сайт мекенжайлары мен тарих осы құрылғыда қалады.</p><h3 class="web-section-title">Құрылғыдағы профиль</h3><p class="web-muted">Құрылған күні: ${escapeHTML(state.profile.createdAt)}</p><div class="web-card-actions"><button type="button" data-action="export-profile">JSON экспорттау</button><button type="button" data-action="import-profile">JSON импорттау</button></div>`;
    $('profile-form').addEventListener('submit', event => {
      event.preventDefault(); const name = $('profile-name').value.trim();
      if (!name) { $('profile-error').textContent = 'Пайдаланушы атын енгізіңіз.'; return; }
      state.profile.name = name.slice(0, 100); $('profile-error').textContent = ''; save('Профиль аты сақталды.');
    });
    $('google-login').addEventListener('click', () => authController?.login());
    $('google-cancel').addEventListener('click', () => authController?.cancelLogin());
    $('google-signout').addEventListener('click', () => authController?.signOut());
    $('remember-signin').addEventListener('change', async event => {
      event.target.disabled = true;
      const ok = await authController?.setRemember(event.target.checked);
      if (!ok) toast('Кіруді сақтау баптауы өзгермеді. Қайталап көріңіз.');
      else toast('Google кіруін сақтау баптауы жаңартылды.');
      renderAuth();
    });
    $('sync-retry').addEventListener('click', scheduleStats);
    renderAuth();
  }
  function renderAuth() {
    if (!$('auth-status')) return;
    $('auth-status').textContent = authState.message || (authState.status === 'connected' ? 'Google аккаунты қосылған.' : 'Бұлтқа қосылмаған.');
    $('google-login').hidden = authState.status === 'connected' || authState.status === 'signing-in';
    $('google-login').disabled = authState.status === 'loading';
    $('google-cancel').hidden = authState.status !== 'signing-in';
    $('google-signout').hidden = !authState.signedIn && authState.status !== 'connected';
    $('remember-signin').checked = authState.remember;
    $('remember-signin').disabled = !authState.rememberAvailable || authState.status === 'loading' || authState.status === 'signing-in';
    $('sync-status').textContent = ({ idle: '', saving: 'Профиль статистикасы сақталуда…', saved: 'Профиль статистикасы сақталды.', error: 'Бұлтқа сақтау орындалмады. Жергілікті деректер сақталған.' })[authState.syncStatus] || '';
    $('sync-retry').hidden = authState.syncStatus !== 'error';
  }

  function openBookmarkEditor(bookmark = null) {
    bookmarkEditing = bookmark?.id || null;
    $('bookmark-editor-title').textContent = bookmark ? 'Бетбелгіні өңдеу' : 'Таңдаулы сайт қосу';
    $('bookmark-title').value = bookmark?.title || (activeTab().url ? activeTab().title : '');
    $('bookmark-url').value = bookmark?.url || activeTab().url || '';
    $('bookmark-error').textContent = ''; $('bookmark-delete').hidden = !bookmark;
    showDialog('bookmark-dialog'); $('bookmark-title').focus();
  }
  function renderBookmarkPanel() {
    $('workspace-panel').innerHTML = `<div class="web-card-actions"><button class="web-primary" type="button" data-action="add-bookmark">＋ Таңдаулы қосу</button></div><label class="web-field">Бетбелгілерден іздеу<input id="bookmark-filter" value="${escapeHTML(bookmarkQuery)}" autocomplete="off"></label><div id="bookmark-results" class="web-list"></div>`;
    $('bookmark-filter').addEventListener('input', event => { bookmarkQuery = event.target.value; renderBookmarkResults(); });
    renderBookmarkResults();
  }
  function renderBookmarkResults() {
    const container = $('bookmark-results'); if (!container) return;
    container.replaceChildren();
    const query = bookmarkQuery.trim().toLocaleLowerCase();
    const results = state.bookmarks.filter(item => `${item.title} ${item.url}`.toLocaleLowerCase().includes(query));
    if (!results.length) { container.innerHTML = `<p class="web-empty">${state.bookmarks.length ? 'Сәйкес бетбелгі табылмады.' : 'Әзірге бетбелгі жоқ. «Таңдаулы қосу» арқылы алғашқы сайтты қосыңыз.'}</p>`; return; }
    results.slice(0, 100).forEach(bookmark => {
      const row = document.createElement('div'); row.className = 'web-list-row bookmark-row'; row.dataset.id = bookmark.id;
      const link = siteLink(bookmark, ''); link.innerHTML = `<strong>${escapeHTML(bookmark.title)}</strong><small>${escapeHTML(bookmark.url)}</small>`;
      const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.bookmarkEdit = bookmark.id; edit.textContent = 'Өңдеу'; edit.setAttribute('aria-label', `${bookmark.title} бетбелгісін өңдеу`);
      edit.addEventListener('click', () => openBookmarkEditor(bookmark)); row.append(link, edit); container.appendChild(row);
    });
  }
  $('bookmark-form').addEventListener('submit', event => {
    event.preventDefault();
    const raw = $('bookmark-url').value.trim(), title = $('bookmark-title').value.trim();
    const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(raw);
    const url = Shared.webURL(hasScheme ? raw : `https://${raw}`);
    if (!title || !url || !raw) { $('bookmark-error').textContent = 'Атау мен жарамды HTTP/HTTPS сайт мекенжайын енгізіңіз.'; return; }
    if (!bookmarkEditing && state.bookmarks.some(item => item.url === url)) { $('bookmark-error').textContent = 'Бұл сайт таңдаулыларда бар. Оны тізімнен өңдеңіз.'; return; }
    const result = Shared.changeBookmark(state.bookmarks, { title, url }, bookmarkEditing);
    if (!result.ok) { $('bookmark-error').textContent = result.error === 'duplicate' ? 'Бұл мекенжай басқа бетбелгіде бар.' : 'Бұл бетбелгі табылмады. Тізімді жаңартыңыз.'; return; }
    state.bookmarks = result.bookmarks; save(bookmarkEditing ? 'Бетбелгі жаңартылды.' : 'Таңдаулы сайт қосылды.');
    $('bookmark-dialog').close(); renderFavorites(); if (currentPanel === 'bookmarks' && $('workspace-dialog').open) renderBookmarkPanel();
  });
  $('bookmark-delete').addEventListener('click', () => {
    state.bookmarks = state.bookmarks.filter(item => item.id !== bookmarkEditing); save('Бетбелгі өшірілді.');
    $('bookmark-dialog').close(); renderFavorites(); if (currentPanel === 'bookmarks' && $('workspace-dialog').open) renderBookmarkPanel();
  });

  function renderHistoryPanel() {
    $('workspace-panel').innerHTML = `<p class="web-muted">Бұл тізім Galamtor арқылы ашқан сілтемелерді ғана сақтайды. Safari/Chrome ішіндегі толық тарих оқылмайды.</p><label class="web-field">Тарихтан іздеу<input id="history-filter" value="${escapeHTML(historyQuery)}" autocomplete="off"></label><button type="button" class="web-secondary" data-action="clear-history">Тарихты тазалау</button><div id="history-results" class="web-list"></div>`;
    $('history-filter').addEventListener('input', event => { historyQuery = event.target.value; renderHistoryResults(); }); renderHistoryResults();
  }
  function renderHistoryResults() {
    const container = $('history-results'); if (!container) return;
    container.replaceChildren(); const query = historyQuery.trim().toLocaleLowerCase();
    const results = state.history.filter(item => `${item.title} ${item.url}`.toLocaleLowerCase().includes(query));
    if (!results.length) { container.innerHTML = '<p class="web-empty">Сәйкес тарих жазбасы жоқ.</p>'; return; }
    results.slice(0, 100).forEach(item => {
      const row = document.createElement('div'); row.className = 'web-list-row history-row';
      const link = siteLink(item, ''); link.innerHTML = `<strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.url)}</small>`;
      const date = document.createElement('small'); date.textContent = new Date(item.timestamp).toLocaleDateString('kk-KZ'); row.append(link, date); container.appendChild(row);
    });
  }
  function renderVibesPanel() {
    $('workspace-panel').innerHTML = `<p class="web-muted">Вайб интерфейс акцентін өзгертеді. Таңдаулылар барлық вайбқа ортақ.</p><div id="vibe-results" class="web-list"></div><form id="vibe-form"><label class="web-field">Вайб атауы<input id="vibe-name" maxlength="50" required autocomplete="off"></label><label class="web-field">Акцент түсі<input id="vibe-color" type="color" value="#648cff"></label><p id="vibe-error" role="alert"></p><div class="web-card-actions"><button id="vibe-submit" type="submit" class="web-primary">Вайб қосу</button><button id="vibe-edit-cancel" type="button" hidden>Болдырмау</button></div></form>`;
    state.vibes.forEach(item => {
      const row = document.createElement('div'); row.className = 'web-list-row';
      const select = document.createElement('button'); select.type = 'button'; select.dataset.vibeId = item.id; select.textContent = `${state.activeVibe === item.id ? '✓ ' : ''}${item.name}`; select.style.color = item.color;
      select.addEventListener('click', () => { state.activeVibe = item.id; save('Вайб таңдалды.'); applySettings(); renderStats(); renderVibesPanel(); });
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Өңдеу'; edit.dataset.vibeEdit = item.id;
      edit.addEventListener('click', () => { vibeEditing = item.id; $('vibe-name').value = item.name; $('vibe-color').value = item.color; $('vibe-submit').textContent = 'Сақтау'; $('vibe-edit-cancel').hidden = false; $('vibe-name').focus(); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Өшіру'; remove.dataset.vibeDelete = item.id; remove.disabled = state.vibes.length === 1;
      remove.addEventListener('click', () => { state.vibes = state.vibes.filter(entry => entry.id !== item.id); if (state.activeVibe === item.id) state.activeVibe = state.vibes[0].id; vibeEditing = null; save('Вайб өшірілді.'); applySettings(); renderVibesPanel(); });
      row.append(select, edit, remove); $('vibe-results').appendChild(row);
    });
    $('vibe-edit-cancel').addEventListener('click', () => { vibeEditing = null; renderVibesPanel(); });
    $('vibe-form').addEventListener('submit', event => {
      event.preventDefault(); const name = $('vibe-name').value.trim(), color = $('vibe-color').value;
      if (!name) { $('vibe-error').textContent = 'Вайб атауын енгізіңіз.'; return; }
      if (vibeEditing) { const item = state.vibes.find(entry => entry.id === vibeEditing); if (item) Object.assign(item, { name, color }); }
      else { if (state.vibes.length >= 20) { $('vibe-error').textContent = '20 вайб шегіне жеттіңіз.'; return; } const item = { id: Model.id(), name, color }; state.vibes.push(item); state.activeVibe = item.id; }
      vibeEditing = null; save('Вайб сақталды.'); applySettings(); renderVibesPanel();
    });
  }

  function renderSettings() {
    const settings = state.settings;
    const check = (key, label) => `<label class="web-checkbox"><input type="checkbox" data-setting="${key}" ${settings[key] ? 'checked' : ''}>${label}</label>`;
    $('workspace-panel').innerHTML = `<h3 class="web-section-title">Виджеттер</h3>${[['clock', 'Сағат пен күн'], ['currency', 'Валюта бағамы'], ['prayer', 'Намаз кестесі'], ['news', 'Пайдалы дереккөздер']].map(([key, label]) => `<label class="web-checkbox"><input type="checkbox" data-widget="${key}" ${settings.widgets[key] ? 'checked' : ''}>${label}</label>`).join('')}
      <label class="web-field">Виджет стилі<select id="hub-style-select" data-setting="hubStyle">${[['bento', 'Bento'], ['capsule', 'Капсула'], ['astral', 'Astral'], ['neon', 'Neon'], ['ambient', 'Ambient']].map(([key, label]) => `<option value="${key}" ${settings.hubStyle === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <h3 class="web-section-title">Тұсқағаз</h3><div class="web-wallpapers">${Model.WALLPAPERS.map(key => `<button type="button" class="web-wallpaper${key === settings.wallpaper ? ' active' : ''}" data-wallpaper="${key}" aria-pressed="${key === settings.wallpaper}"><img src="assets/wallpapers/${key}.jpg" alt="" loading="lazy">${wallpaperNames[key]}</button>`).join('')}</div>
      <label class="web-field">Қараңғылық <output id="dim-value">${settings.dim}%</output><input type="range" data-setting="dim" min="0" max="85" value="${settings.dim}"></label><label class="web-field">Бұлыңғырлық <output id="blur-value">${settings.blur}px</output><input type="range" data-setting="blur" min="0" max="12" value="${settings.blur}"></label>
      <h3 class="web-section-title">Қолдану ыңғайы</h3>${check('showPet', 'Серікті көрсету')}${check('reduceMotion', 'Қимылды азайту (Reduce Motion)')}${check('restoreSession', 'Қайта ашқанда Galamtor қойындыларын қалпына келтіру')}
      <p class="web-muted">Жүйедегі Reduce Motion әрқашан ескеріледі. Сақталған сыртқы сайттар өздігінен қайта ашылмайды.</p><div class="web-card-actions"><button type="button" data-action="reset-settings">Басты бет баптауларын қалпына келтіру</button></div>
      <h3 class="web-section-title">Деректі басқару</h3><div class="web-card-actions"><button type="button" data-action="export-profile">JSON экспорттау</button><button type="button" data-action="import-profile">JSON импорттау</button><button type="button" class="web-danger" data-action="clear-local-data">Сайттағы жергілікті деректі өшіру</button></div>
      <p class="web-muted">Galamtor Web · 1.5.3. Жаңарту сайтты қайта жүктегенде келеді. Desktop қолданбасының профилі бөлек сақталады.</p><div class="web-card-actions"><a class="web-secondary" href="/">Ресми сайт</a><a class="web-secondary" href="/#download">Қолданбаны жүктеу</a><a class="web-secondary" href="/privacy.html" target="_blank" rel="noopener noreferrer">Құпиялылық</a></div>`;
    $('workspace-panel').querySelectorAll('[data-widget]').forEach(input => input.addEventListener('change', () => {
      state.settings.widgets[input.dataset.widget] = input.checked; save('Виджет баптауы сақталды.'); applySettings();
      if (input.dataset.widget === 'currency' && input.checked && !hasRates) refreshRates();
    }));
    $('workspace-panel').querySelectorAll('[data-setting]').forEach(input => input.addEventListener(input.type === 'range' ? 'input' : 'change', () => {
      const key = input.dataset.setting; state.settings[key] = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
      if (key === 'dim') $('dim-value').textContent = `${input.value}%`;
      if (key === 'blur') $('blur-value').textContent = `${input.value}px`;
      save(input.type === 'range' ? null : 'Баптау сақталды.'); applySettings();
    }));
    $('workspace-panel').querySelectorAll('[data-wallpaper]').forEach(button => button.addEventListener('click', () => {
      state.settings.wallpaper = button.dataset.wallpaper; save('Тұсқағаз сақталды.'); applySettings();
      $('workspace-panel').querySelectorAll('[data-wallpaper]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
    }));
  }
  function applySettings() {
    const settings = state.settings;
    $('welcome-bg-image').style.backgroundImage = `url("assets/wallpapers/${settings.wallpaper}.jpg")`;
    $('welcome-bg-dim').style.setProperty('--dim-opacity', settings.dim / 100);
    $('welcome-bg-dim').style.setProperty('--blur-amount', `${settings.blur}px`);
    $('cyber-steppe-hub').className = `valuta-card-container hub-style-${settings.hubStyle}`;
    $('welcome-clock-widget').hidden = !settings.widgets.clock;
    $('cs-currency').hidden = !settings.widgets.currency; $('cs-prayer').hidden = !settings.widgets.prayer;
    $('section-bento-hero').hidden = !settings.widgets.currency && !settings.widgets.prayer;
    $('section-reading-news').hidden = !settings.widgets.news;
    $('galamtor-bot-widget').hidden = !settings.showPet;
    if (!settings.showPet) window.GalamtorWebPet?.close();
    document.body.classList.toggle('reduce-motion', settings.reduceMotion || motion.matches);
    document.documentElement.style.setProperty('--accent-blue', vibe().color);
    $('active-vibe-name').textContent = `· ${vibe().name}`;
  }
  function exportProfile() {
    const json = JSON.stringify({ ...Model.normalize(state), pet: window.GalamtorPet.loadProfile(storage) }, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'Galamtor-Web-profile.json'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Galamtor Web профилінің JSON файлы дайын.');
  }
  $('profile-import-file').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('JSON файлы 2 МБ-тан аспауы керек.'); return; }
    try {
      const parsed = JSON.parse(await file.text());
      if (!Model.validateImport(parsed)) throw new Error('Invalid');
      if (!confirm('Осы браузердегі Galamtor Web профилін JSON файлындағы дерекпен ауыстыру керек пе?')) return;
      const next = Model.normalize(parsed);
      if (!repository.replace(next).ok) { toast('Импортты сақтау мүмкін болмады. Қазіргі профиль сақталды.'); return; }
      state = next;
      if (parsed.pet) window.GalamtorPet.saveProfile(parsed.pet, storage);
      location.reload();
    } catch { toast('Жарамды Galamtor Web JSON файлын таңдаңыз.'); }
  });
  async function clearLocalData() {
    if (!confirm('Galamtor Web-тің осы браузердегі таңдаулыларын, тарихын, қойындыларын және баптауларын өшіру керек пе? Desktop профилі өзгермейді.')) return;
    if (authController && (!await authController.signOut() || !await authController.setRemember(false))) { toast('Кіру деректерін өшіру аяқталмады. Қайталап көріңіз.'); return; }
    if (!repository.reset().ok) { toast('Жергілікті деректі өшіру мүмкін болмады.'); return; }
    try { storage.removeItem(window.GalamtorPet.STORAGE_KEY); }
    catch { toast('Серік дерегін өшіру мүмкін болмады.'); return; }
    location.reload();
  }

  function updateClock() {
    const now = new Date(); $('clock-time-display').textContent = now.toLocaleTimeString('kk-KZ', { hour: '2-digit', minute: '2-digit', hour12: false });
    $('clock-date-display').textContent = now.toLocaleDateString('kk-KZ', { weekday: 'long', day: 'numeric', month: 'long' });
    $('welcome-greeting').textContent = window.GalamtorWelcomeUtils.getKazakhGreeting(now);
  }
  function renderSources() {
    $('portal-news-bar').replaceChildren();
    for (let i = 0; i < 2; i++) {
      const [title, source, url, klass, icon] = sources[(sourceOffset + i) % sources.length];
      const link = siteLink({ title, url }, 'safari-reading-card');
      link.innerHTML = `<div class="safari-reading-thumb ${klass}" aria-hidden="true">${icon}</div><div class="safari-reading-meta"><span class="safari-reading-title">${title}</span><span class="safari-reading-subline"><span class="safari-source-tag">${source}</span><span class="safari-time-tag">Дереккөз ↗</span></span></div>`;
      $('portal-news-bar').appendChild(link);
    }
  }
  async function refreshRates() {
    const request = ++currencyRequest, button = $('btn-refresh-rates'), label = $('rates-status');
    button.disabled = true; label.textContent = 'Бағам жүктелуде…';
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/USD', { signal: controller.signal });
      if (!response.ok) throw new Error('Network');
      const data = await response.json(), rates = data.rates;
      if (data.result !== 'success' || data.base_code !== 'USD' || !['KZT', 'EUR', 'RUB'].every(key => Number.isFinite(rates?.[key]) && rates[key] > 0)) throw new Error('Empty');
      if (request !== currencyRequest) return;
      const format = value => value.toLocaleString('kk-KZ', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
      $('rate-usd').textContent = format(rates.KZT); $('rate-eur').textContent = format(rates.KZT / rates.EUR); $('rate-rub').textContent = format(rates.KZT / rates.RUB);
      hasRates = true; label.textContent = 'Жаңартылды. Анықтамалық бағам, банк бағамы өзгеше болуы мүмкін.';
    } catch {
      if (request === currencyRequest) label.textContent = hasRates ? 'Жаңарту орындалмады. Көрсетілген бағам ескі. Қайталап көріңіз.' : 'Бағамды алу мүмкін болмады. «Жаңарту» арқылы қайталап көріңіз.';
    } finally { clearTimeout(timeout); if (request === currencyRequest) button.disabled = false; }
  }

  function openCommands() { showDialog('commands-dialog'); $('command-input').value = ''; renderCommands(); $('command-input').focus(); }
  function renderCommands() {
    const query = $('command-input').value.trim().toLocaleLowerCase();
    const entries = [
      ...state.tabs.map(tab => ({ title: tab.title, subtitle: 'Қойынды', run: () => { state.activeId = tab.id; save(); renderTabs(); renderActiveView(); } })),
      ...state.bookmarks.map(item => ({ title: item.title, subtitle: item.url, run: () => openSite(item.url, item.title) })),
      ...actionList.map(([action, title, shortcut]) => ({ title, subtitle: `Әрекет ${shortcut}`, disabled: action === 'reopen-tab' && !closedTabs.length, run: () => dispatch(action) }))
    ];
    commands = entries.filter(item => `${item.title} ${item.subtitle}`.toLocaleLowerCase().includes(query) && !item.disabled).slice(0, 25);
    commandSelection = 0; $('command-results').replaceChildren();
    if (!commands.length) { $('command-results').innerHTML = '<p class="web-empty">Ештеңе табылмады.</p>'; return; }
    commands.forEach((entry, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'web-command';
      button.innerHTML = `<strong>${escapeHTML(entry.title)}</strong><small>${escapeHTML(entry.subtitle)}</small>`;
      button.addEventListener('click', () => runCommand(index)); $('command-results').appendChild(button);
    }); markCommand();
  }
  function markCommand() {
    $('command-results').querySelectorAll('.web-command').forEach((button, i) => { button.classList.toggle('selected', i === commandSelection); });
    $('command-results').querySelectorAll('.web-command')[commandSelection]?.scrollIntoView({ block: 'nearest' });
  }
  function runCommand(index) { const entry = commands[index]; if (!entry) return; $('commands-dialog').close(); entry.run(); }
  $('command-input').addEventListener('input', renderCommands);
  $('commands-dialog').addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && commands.length) { event.preventDefault(); commandSelection = (commandSelection + (event.key === 'ArrowDown' ? 1 : -1) + commands.length) % commands.length; markCommand(); }
    else if (event.key === 'Enter' && event.target === $('command-input')) { event.preventDefault(); runCommand(commandSelection); }
  });
  function closeMenu() { $('browser-menu').hidden = true; $('menu-backdrop').hidden = true; $('btn-browser-menu').setAttribute('aria-expanded', 'false'); }
  function openMenu() {
    if (!$('browser-menu').hidden) { closeMenu(); return; }
    const menu = $('browser-menu'); menu.replaceChildren();
    actionList.forEach(([action, label, shortcut]) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'browser-menu-item'; button.dataset.action = action; button.setAttribute('role', 'menuitem');
      button.innerHTML = `<span>${label}</span><span class="browser-menu-shortcut">${shortcut}</span>`;
      button.disabled = action === 'reopen-tab' && !closedTabs.length; menu.appendChild(button);
    });
    const footer = document.createElement('div'); footer.className = 'browser-menu-footer'; footer.textContent = 'Galamtor Web · 1.5.3 · орнатусыз'; menu.appendChild(footer);
    menu.hidden = false; $('menu-backdrop').hidden = false; $('btn-browser-menu').setAttribute('aria-expanded', 'true'); menu.querySelector('button')?.focus();
  }
  function dispatch(action) {
    closeMenu();
    switch (action) {
      case 'new-tab': newTab(); break;
      case 'reopen-tab': reopenTab(); break;
      case 'home': goHome(); break;
      case 'open-bookmarks': openWorkspace('bookmarks'); break;
      case 'add-bookmark': openBookmarkEditor(); break;
      case 'open-history': openWorkspace('history'); break;
      case 'open-settings': openWorkspace('settings'); break;
      case 'open-profile': openWorkspace('profile'); break;
      case 'command-palette': openCommands(); break;
      case 'lens': $('ai-tools-dialog').close(); showDialog('lens-dialog'); $('lens-error').textContent = ''; $('lens-url').focus(); break;
      case 'ai-tools': showDialog('ai-tools-dialog'); break;
      case 'export-profile': exportProfile(); break;
      case 'import-profile': $('profile-import-file').click(); break;
      case 'clear-history': if (confirm('Galamtor-дан ашылған сайттар тарихын тазалау керек пе?')) { state.history = []; save('Galamtor тарихы тазаланды.'); renderHistoryResults(); } break;
      case 'reset-settings': state.settings = Model.defaults().settings; save('Басты бет баптаулары қалпына келтірілді.'); applySettings(); renderSettings(); break;
      case 'clear-local-data': clearLocalData(); break;
    }
  }
  document.addEventListener('click', event => {
    const close = event.target.closest('[data-close-dialog]'); if (close) { closeDialog(close); return; }
    const action = event.target.closest('[data-action]'); if (action && !action.disabled) { dispatch(action.dataset.action); return; }
    const site = event.target.closest('a[data-site]');
    if (site && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
      event.preventDefault(); document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); openSite(site.href, site.dataset.site);
    } else if (site) { prepareSite(site.href, site.dataset.site); }
  });
  $('workspace-nav').addEventListener('click', event => { const target = event.target.closest('[data-panel]'); if (target) { vibeEditing = null; currentPanel = target.dataset.panel; renderWorkspace(); } });
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  }));
  $('url-form').addEventListener('submit', event => { event.preventDefault(); navigate($('url-input').value); });
  $('welcome-search-form').addEventListener('submit', event => { event.preventDefault(); navigate($('welcome-search-input').value); });
  $('lens-form').addEventListener('submit', event => {
    event.preventDefault(); const value = $('lens-url').value.trim(), result = window.GalamtorLensUtils.buildLensUploadUrl(value);
    if (!result) { $('lens-error').textContent = value ? 'Жалпыға қолжетімді HTTPS сурет сілтемесін енгізіңіз. Жергілікті және ішкі желі мекенжайлары жіберілмейді.' : 'Сурет сілтемесін енгізіңіз.'; return; }
    $('lens-error').textContent = ''; $('lens-dialog').close(); openSite(result, 'Google Lens');
  });
  $('site-open').addEventListener('click', () => { addVisit(activeTab().url, activeTab().title); save(); });
  $('btn-new-tab').addEventListener('click', newTab);
  $('btn-home').addEventListener('click', goHome);
  $('btn-workspace').addEventListener('click', () => openWorkspace('profile'));
  $('btn-settings').addEventListener('click', () => openWorkspace('settings'));
  $('btn-open-customizer').addEventListener('click', () => openWorkspace('settings'));
  $('btn-sidebar-bookmarks').addEventListener('click', () => openWorkspace('bookmarks'));
  $('btn-sidebar-history').addEventListener('click', () => openWorkspace('history'));
  $('btn-ai-tools').addEventListener('click', () => dispatch('ai-tools'));
  $('btn-lens').addEventListener('click', () => dispatch('lens'));
  $('btn-add-bookmark').addEventListener('click', () => openBookmarkEditor());
  const editCurrentBookmark = () => openBookmarkEditor(state.bookmarks.find(item => item.url === activeTab().url) || null);
  $('btn-bookmark-current').addEventListener('click', editCurrentBookmark);
  $('site-bookmark').addEventListener('click', editCurrentBookmark);
  $('btn-browser-menu').addEventListener('click', openMenu);
  $('menu-backdrop').addEventListener('click', closeMenu);
  $('btn-refresh-news').addEventListener('click', () => { sourceOffset = (sourceOffset + 2) % sources.length; renderSources(); });
  $('btn-refresh-rates').addEventListener('click', refreshRates);
  $('web-pet-avatar').addEventListener('click', () => $('galamtor-pet-customize').click());
  $('browser-menu').addEventListener('keydown', event => {
    const buttons = [...$('browser-menu').querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
    else if (event.key === 'Escape') { closeMenu(); $('btn-browser-menu').focus(); }
  });
  $('tabs-container').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.target.getAttribute('role') !== 'tab') return;
    event.preventDefault(); const index = state.tabs.findIndex(tab => tab.id === state.activeId);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? state.tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + state.tabs.length) % state.tabs.length;
    state.activeId = state.tabs[next].id; save(); renderTabs(); renderActiveView(); $('tabs-container').querySelector('[aria-selected="true"]')?.focus();
  });
  document.addEventListener('keydown', event => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.code || `Key${event.key.toUpperCase()}`;
    if ((mod || event.altKey) && key === 'KeyK') { event.preventDefault(); openCommands(); }
    else if (event.altKey && key === 'KeyT') { event.preventDefault(); event.shiftKey ? reopenTab() : newTab(); }
    else if (event.altKey && key === 'KeyW') { event.preventDefault(); closeTab(state.activeId); }
    else if (event.altKey && key === 'KeyD') { event.preventDefault(); editCurrentBookmark(); }
    else if (event.key === 'Escape') closeMenu();
  });
  motion.addEventListener('change', applySettings);
  window.addEventListener('resize', closeMenu);
  window.GalamtorWebPet = window.GalamtorPet.initialize();
  renderTabs(); renderActiveView(); renderFavorites(); renderSources(); applySettings(); renderStorageWarning(); updateClock(); setInterval(updateClock, 1000);
  if (state.settings.widgets.currency) refreshRates();
  try {
    authController = window.GalamtorWebAuth.create({ onState(next) {
      const newlyConnected = next.status === 'connected' && authState.status !== 'connected';
      authState = next; renderAuth(); if (newlyConnected) scheduleStats();
    } });
  } catch {
    authState = { ...authState, status: 'error', message: 'Google кіру модулі іске қосылмады. Бетті қайта жүктеп көріңіз.' }; renderAuth();
  }
})();
