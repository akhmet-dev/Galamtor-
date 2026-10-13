// Bookmark UI shares the validated main-process store with the bar and palette.
let currentBookmarks = [];
let bookmarkMutationBusy = false;
let bookmarkPanelRequest = 0;

async function refreshBookmarks() {
  currentBookmarks = await window.galamtorAPI.getBookmarks();
  renderBookmarksBar();
  await updateBookmarkButtonState();
}

async function initBookmarks() {
  try { await refreshBookmarks(); }
  catch { showToast('Бетбелгілерді жүктеу мүмкін болмады'); }
}

function renderBookmarksBar() {
  const container = document.getElementById('bookmarks-bar-items');
  const bar = document.getElementById('bookmarks-bar');
  if (!container || !bar) return;
  bar.style.display = currentBookmarks.length ? 'flex' : 'none';
  container.replaceChildren();
  currentBookmarks.forEach(bookmark => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'bookmark-bar-item';
    item.dataset.url = bookmark.url;
    item.title = `${bookmark.title} (${bookmark.url}) · Оң жақ батырма: өңдеу`;
    const img = document.createElement('img');
    img.alt = '';
    img.src = safeHttpUrl(bookmark.favicon) || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(extractDomain(bookmark.url))}`;
    img.onerror = () => { img.onerror = null; img.remove(); };
    const label = document.createElement('span');
    label.textContent = bookmark.title;
    item.append(img, label);
    item.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey) createTab(bookmark.url);
      else navigateTo(bookmark.url);
    });
    item.addEventListener('auxclick', event => {
      if (event.button === 1) { event.preventDefault(); createTab(bookmark.url); }
    });
    item.addEventListener('contextmenu', event => {
      event.preventDefault();
      openBookmarkEditor(bookmark);
    });
    container.appendChild(item);
  });
}

async function updateBookmarkButtonState() {
  const button = document.getElementById('btn-bookmark-current');
  if (!button) return;
  const tab = tabs.find(item => item.id === activeTabId);
  const url = window.GalamtorBrowserState.webURL(tab?.url);
  button.disabled = !tab || tab.isHome || !url || bookmarkMutationBusy;
  const bookmarked = !!url && currentBookmarks.some(item => item.url === url);
  button.classList.toggle('bookmarked', bookmarked);
  button.setAttribute('aria-pressed', String(bookmarked));
  button.title = bookmarked ? 'Бетбелгілерден алып тастау (⌘D)' : 'Осы бетті бетбелгіге қосу (⌘D)';
  button.setAttribute('aria-label', button.title);
}

async function toggleBookmarkCurrent({ addOnly = false } = {}) {
  if (bookmarkMutationBusy) return false;
  const tab = tabs.find(item => item.id === activeTabId);
  if (!tab || tab.isHome || !tab.url) { showToast('Алдымен веб-бетті ашыңыз'); return false; }
  const snapshot = { ...tab };
  bookmarkMutationBusy = true;
  updateBookmarkButtonState();
  try {
    const exists = await window.galamtorAPI.isBookmarked(snapshot.url);
    if (exists && addOnly) { showToast('Бұл бет бетбелгілерде бар'); return true; }
    const success = exists ? await window.galamtorAPI.removeBookmark(snapshot.url)
      : await window.galamtorAPI.addBookmark({ title: snapshot.title || snapshot.url, url: snapshot.url, favicon: snapshot.favicon || '' });
    if (!success) { showToast('Бетбелгі өзгерісі сақталмады. Қайталап көріңіз.'); return false; }
    await refreshBookmarks();
    showToast(exists ? 'Бетбелгі өшірілді' : 'Бетбелгі қосылды');
    return true;
  } catch { showToast('Бетбелгі өзгерісі сақталмады. Қайталап көріңіз.'); return false; }
  finally { bookmarkMutationBusy = false; updateBookmarkButtonState(); }
}

async function removeBookmarkByUrl(idOrUrl) {
  if (bookmarkMutationBusy) return false;
  bookmarkMutationBusy = true;
  try {
    if (!await window.galamtorAPI.removeBookmark(idOrUrl)) {
      showToast('Бетбелгі өшірілмеді. Қайталап көріңіз.'); return false;
    }
    await refreshBookmarks();
    showToast('Бетбелгі өшірілді');
    return true;
  } catch { showToast('Бетбелгі өшірілмеді. Қайталап көріңіз.'); return false; }
  finally { bookmarkMutationBusy = false; updateBookmarkButtonState(); }
}

async function gpRenderBookmarksTab(query = null) {
  const panel = _gp.overlayEl?.querySelector('#gp-panel-bookmarks');
  if (!panel) return;
  const search = query ?? panel.querySelector('#gp-bookmark-search')?.value ?? '';
  const request = ++bookmarkPanelRequest;
  panel.innerHTML = '<p role="status">Бетбелгілер жүктелуде…</p>';
  try {
    const bookmarks = await window.galamtorAPI.getBookmarks();
    if (request !== bookmarkPanelRequest) return;
    currentBookmarks = bookmarks;
    const active = tabs.find(tab => tab.id === activeTabId);
    const canAdd = active && !active.isHome && !bookmarks.some(item => item.url === window.GalamtorBrowserState.webURL(active.url));
    panel.innerHTML = `
      <div class="bookmark-panel-toolbar">
        <h3>Бетбелгілер (${bookmarks.length})</h3>
        <div class="bookmark-panel-actions">
          <button class="gp-btn gp-btn-secondary" id="gp-add-current-bm-btn" ${canAdd ? '' : 'disabled'}>Ағымдағы бетті қосу</button>
          <button class="gp-btn gp-btn-primary" id="gp-new-bookmark">+ Жаңа</button>
        </div>
      </div>
      <input class="gp-input" id="gp-bookmark-search" type="search" placeholder="Атауы немесе URL бойынша іздеу" aria-label="Бетбелгілерден іздеу" value="${escapeAttr(search)}">
      <div id="gp-bookmark-list" class="bookmark-panel-list"></div>`;
    const renderList = value => {
      const list = panel.querySelector('#gp-bookmark-list');
      const needle = value.trim().toLocaleLowerCase();
      const matches = bookmarks.filter(item => `${item.title} ${item.url}`.toLocaleLowerCase().includes(needle));
      list.innerHTML = matches.length ? matches.map(item => `
        <div class="gp-bookmark-item">
          <button class="gp-bm-click" data-url="${escapeAttr(item.url)}" title="${escapeAttr(item.url)}">
            <strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.url)}</small>
          </button>
          <button class="gp-btn gp-btn-secondary gp-btn-edit-bm" data-id="${escapeAttr(item.id)}" aria-label="${escapeAttr(item.title)} бетбелгісін өңдеу">Өңдеу</button>
          <button class="gp-btn gp-btn-secondary gp-btn-delete-bm" data-id="${escapeAttr(item.id)}" aria-label="${escapeAttr(item.title)} бетбелгісін өшіру">×</button>
        </div>`).join('') : `<p class="bookmark-empty" role="status">${bookmarks.length ? 'Сәйкес бетбелгі табылмады.' : 'Бетбелгілер бос. «Жаңа» немесе ⌘D арқылы сайт қосыңыз.'}</p>`;
      list.querySelectorAll('.gp-bm-click').forEach(button => button.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey) createTab(button.dataset.url);
        else navigateTo(button.dataset.url);
        gpCloseModal();
      }));
      list.querySelectorAll('.gp-btn-edit-bm').forEach(button => button.addEventListener('click', () => {
        openBookmarkEditor(bookmarks.find(item => item.id === button.dataset.id));
      }));
      list.querySelectorAll('.gp-btn-delete-bm').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        if (await removeBookmarkByUrl(button.dataset.id)) gpRenderBookmarksTab(value);
        else button.disabled = false;
      }));
    };
    renderList(search);
    panel.querySelector('#gp-bookmark-search').addEventListener('input', event => renderList(event.target.value));
    panel.querySelector('#gp-new-bookmark').addEventListener('click', () => openBookmarkEditor());
    panel.querySelector('#gp-add-current-bm-btn').addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      await toggleBookmarkCurrent({ addOnly: true });
      gpRenderBookmarksTab(search);
    });
  } catch {
    if (request !== bookmarkPanelRequest) return;
    panel.innerHTML = '<p role="alert">Бетбелгілерді жүктеу мүмкін болмады.</p><button class="gp-btn gp-btn-primary">Қайталап көру</button>';
    panel.querySelector('button').addEventListener('click', () => gpRenderBookmarksTab(search));
  }
}

function openBookmarkEditor(bookmark = null) {
  if (document.querySelector('.bookmark-editor-overlay')) return;
  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'bookmark-editor-overlay';
  overlay.innerHTML = `<form class="bookmark-editor" role="dialog" aria-modal="true" aria-labelledby="bookmark-editor-title" novalidate>
    <h2 id="bookmark-editor-title">${bookmark ? 'Бетбелгіні өңдеу' : 'Жаңа бетбелгі'}</h2>
    <label for="bookmark-title">Атауы</label>
    <input class="gp-input" id="bookmark-title" maxlength="300" value="${escapeAttr(bookmark?.title || '')}" autocomplete="off">
    <label for="bookmark-url">Сайт мекенжайы</label>
    <input class="gp-input" id="bookmark-url" type="url" value="${escapeAttr(bookmark?.url || '')}" placeholder="https://example.com" autocomplete="off" spellcheck="false">
    <p id="bookmark-editor-error" role="alert"></p>
    <div class="bookmark-editor-actions">
      ${bookmark ? '<button type="button" id="bookmark-editor-delete" class="gp-btn gp-btn-secondary">Өшіру</button>' : ''}
      <button type="button" id="bookmark-editor-cancel" class="gp-btn gp-btn-secondary">Болдырмау</button>
      <button type="submit" class="gp-btn gp-btn-primary">Сақтау</button>
    </div>
  </form>`;
  document.body.appendChild(overlay);
  const form = overlay.querySelector('form');
  const titleInput = form.querySelector('#bookmark-title');
  const addressInput = form.querySelector('#bookmark-url');
  const error = form.querySelector('#bookmark-editor-error');
  let busy = false;
  const close = () => {
    if (busy) return;
    overlay.remove();
    (previousFocus?.isConnected ? previousFocus : document.getElementById('btn-bookmark-current'))?.focus();
  };
  form.querySelector('#bookmark-editor-cancel').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') {
      const items = [...form.querySelectorAll('input, button:not(:disabled)')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  form.querySelector('#bookmark-editor-delete')?.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const success = await removeBookmarkByUrl(bookmark.id);
    busy = false;
    if (success) { close(); if (_gp.activeTab === 'bookmarks') gpRenderBookmarksTab(); }
    else error.textContent = 'Өшіру мүмкін болмады. Қайталап көріңіз.';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || bookmarkMutationBusy) return;
    const raw = addressInput.value.trim();
    const address = window.GalamtorBrowserState.webURL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!titleInput.value.trim() || !address || !raw || /^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) {
      error.textContent = 'Атау мен жарамды HTTP/HTTPS сайт мекенжайын енгізіңіз.';
      (!titleInput.value.trim() ? titleInput : addressInput).focus();
      return;
    }
    busy = bookmarkMutationBusy = true;
    form.setAttribute('aria-busy', 'true');
    form.querySelector('[type="submit"]').disabled = true;
    error.textContent = '';
    try {
      const input = { title: titleInput.value.trim(), url: address };
      const result = bookmark ? await window.galamtorAPI.updateBookmark(bookmark.id, input)
        : { ok: await window.galamtorAPI.addBookmark(input) };
      if (!result.ok) {
        error.textContent = result.error === 'duplicate' ? 'Бұл мекенжай басқа бетбелгіде бар.'
          : result.error === 'missing' ? 'Бұл бетбелгі өшірілген. Терезені жауып, тізімді жаңартыңыз.'
            : 'Сақтау мүмкін болмады. Қайталап көріңіз.';
        return;
      }
      await refreshBookmarks();
      busy = false;
      close();
      showToast(bookmark ? 'Бетбелгі жаңартылды' : 'Бетбелгі қосылды');
      if (_gp.activeTab === 'bookmarks') gpRenderBookmarksTab();
    } catch { error.textContent = 'Сақтау мүмкін болмады. Қайталап көріңіз.'; }
    finally {
      busy = bookmarkMutationBusy = false;
      form.setAttribute('aria-busy', 'false');
      form.querySelector('[type="submit"]').disabled = false;
      updateBookmarkButtonState();
    }
  });
  titleInput.focus();
}
