// ════════════════════════════════════════════════════════════
//  GALAMTOR — Renderer Process v2
//  Tab Drag & Drop · Sidebar Pinning · Lens · PIP Dock
// ════════════════════════════════════════════════════════════

// ── DOM References ──
const tabsContainer = document.getElementById('tabs-container');
const btnNewTab = document.getElementById('btn-new-tab');
const urlForm = document.getElementById('url-form');
const urlInput = document.getElementById('url-input');
const urlBar = document.getElementById('url-bar');
const welcomeSearchForm = document.getElementById('welcome-search-form');
const welcomeSearchInput = document.getElementById('welcome-search-input');
const welcomeSearchBox = document.getElementById('welcome-search-box');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnRefresh = document.getElementById('btn-refresh');
const btnHome = document.getElementById('btn-home');
const btnClearCache = document.getElementById('btn-clear-cache');
const btnLens = document.getElementById('btn-lens');
const btnLensWelcome = document.getElementById('btn-lens-welcome');
const lensFileInput = document.getElementById('lens-file-input');
const lensDropOverlay = document.getElementById('lens-drop-overlay');
const welcomeScreen = document.getElementById('welcome-screen');
const webviewsContainer = document.getElementById('webviews-container');
const loadingBar = document.getElementById('loading-bar');
const sidebar = document.getElementById('sidebar');
const dockIcons = document.getElementById('dock-icons');
const sidebarDropZone = document.getElementById('sidebar-drop-zone');
const pipDock = document.getElementById('pip-dock');
const btnPipToggle = document.getElementById('btn-pip-toggle');
const pipClose = document.getElementById('pip-close');
const pipExpand = document.getElementById('pip-expand');
const pipPlay = document.getElementById('pip-play');
const pipPrev = document.getElementById('pip-prev');
const pipNext = document.getElementById('pip-next');
const pipProgressBar = document.getElementById('pip-progress-bar');
const contextMenu = document.getElementById('context-menu');
const ctxOpen = document.getElementById('ctx-open');
const ctxNewTab = document.getElementById('ctx-new-tab');
const ctxRemove = document.getElementById('ctx-remove');

// ── State ──
let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;
let draggedTabId = null;
let contextTarget = null; // { element, url }
let pipState = { visible: false, playing: false, progress: 0, interval: null };

// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════

function generateTabId() { return `tab-${++tabIdCounter}`; }

function parseSearchOrURL(input) {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const urlPattern = /^(https?:\/\/)?(www\.)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}/;
  if (urlPattern.test(trimmed) || trimmed.includes('localhost:') || trimmed.startsWith('file://')) {
    if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace('www.', '');
  } catch { return url; }
}

function getInitial(url) {
  const domain = extractDomain(url);
  return domain.charAt(0).toUpperCase();
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 2500);
}

// ════════════════════════════════════════
//  TAB MANAGEMENT
// ════════════════════════════════════════

function createTab(url = null) {
  const tabId = generateTabId();
  const tab = { id: tabId, title: 'Жаңа қойынды', url, isHome: !url };
  tabs.push(tab);

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.tabId = tabId;
  tabEl.setAttribute('draggable', 'true');
  tabEl.innerHTML = `
    <span class="tab-title">${tab.title}</span>
    <button class="tab-close" title="Жабу">×</button>
  `;

  // Click to activate
  tabEl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('tab-close')) activateTab(tabId);
  });
  tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(tabId);
  });

  // ── Tab Drag & Drop ──
  tabEl.addEventListener('dragstart', (e) => {
    draggedTabId = tabId;
    tabEl.classList.add('dragging');
    e.dataTransfer.setData('text/plain', tabId);
    e.dataTransfer.setData('application/x-galamtor-tab', tabId);
    e.dataTransfer.effectAllowed = 'move';
    // Show sidebar drop zone
    sidebarDropZone.classList.add('visible');
  });

  tabEl.addEventListener('dragend', () => {
    tabEl.classList.remove('dragging');
    draggedTabId = null;
    clearAllDragIndicators();
    sidebarDropZone.classList.remove('visible', 'drag-hover');
    sidebar.classList.remove('drop-active');
  });

  tabEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedTabId || draggedTabId === tabId) return;
    e.dataTransfer.dropEffect = 'move';

    const rect = tabEl.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    clearAllDragIndicators();
    if (e.clientX < midX) {
      tabEl.classList.add('drag-over-left');
    } else {
      tabEl.classList.add('drag-over-right');
    }
  });

  tabEl.addEventListener('dragleave', () => {
    tabEl.classList.remove('drag-over-left', 'drag-over-right');
  });

  tabEl.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggedTabId || draggedTabId === tabId) return;

    const rect = tabEl.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const insertBefore = e.clientX < midX;

    reorderTab(draggedTabId, tabId, insertBefore);
    clearAllDragIndicators();
  });

  tabsContainer.appendChild(tabEl);

  if (url) createWebview(tabId, url);
  activateTab(tabId);
  return tabId;
}

function reorderTab(dragId, targetId, insertBefore) {
  const dragIndex = tabs.findIndex(t => t.id === dragId);
  const targetIndex = tabs.findIndex(t => t.id === targetId);
  if (dragIndex === -1 || targetIndex === -1) return;

  // Reorder data array
  const [dragged] = tabs.splice(dragIndex, 1);
  const newTargetIndex = tabs.findIndex(t => t.id === targetId);
  if (insertBefore) {
    tabs.splice(newTargetIndex, 0, dragged);
  } else {
    tabs.splice(newTargetIndex + 1, 0, dragged);
  }

  // Reorder DOM
  const dragEl = document.querySelector(`.tab[data-tab-id="${dragId}"]`);
  const targetEl = document.querySelector(`.tab[data-tab-id="${targetId}"]`);
  if (dragEl && targetEl) {
    if (insertBefore) {
      tabsContainer.insertBefore(dragEl, targetEl);
    } else {
      tabsContainer.insertBefore(dragEl, targetEl.nextSibling);
    }
  }
}

function clearAllDragIndicators() {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.remove('drag-over-left', 'drag-over-right');
  });
}

function createWebview(tabId, url) {
  const wrapper = document.createElement('div');
  wrapper.className = 'webview-wrapper';
  wrapper.dataset.tabId = tabId;

  const webview = document.createElement('webview');
  webview.setAttribute('src', url);
  webview.setAttribute('allowpopups', '');
  wrapper.appendChild(webview);
  webviewsContainer.appendChild(wrapper);

  webview.addEventListener('did-start-loading', () => {
    if (activeTabId === tabId) showLoadingBar();
  });

  webview.addEventListener('did-stop-loading', () => {
    if (activeTabId === tabId) {
      hideLoadingBar();
      updateNavButtons(webview);
    }
  });

  webview.addEventListener('did-navigate', (event) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) tab.url = event.url;
    if (activeTabId === tabId) {
      urlInput.value = event.url;
      updateNavButtons(webview);
    }
  });

  webview.addEventListener('did-navigate-in-page', (event) => {
    if (activeTabId === tabId) {
      urlInput.value = event.url;
      const wv = getActiveWebview();
      if (wv) updateNavButtons(wv);
    }
  });

  webview.addEventListener('page-title-updated', (event) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      tab.title = event.title || 'Жаңа қойынды';
      updateTabTitle(tabId, tab.title);

      // Detect YouTube Music for PIP
      if (tab.url && tab.url.includes('music.youtube.com') && activeTabId === tabId) {
        pipUpdateFromYTMusic(tab.title);
      }
    }
  });

  webview.addEventListener('page-favicon-updated', (event) => {
    if (event.favicons && event.favicons.length > 0) {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) tab.favicon = event.favicons[0];
      updateTabFavicon(tabId, event.favicons[0]);
    }
  });
}

function activateTab(tabId) {
  activeTabId = tabId;
  const tab = tabs.find(t => t.id === tabId);

  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  const activeTabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (activeTabEl) activeTabEl.classList.add('active');

  document.querySelectorAll('.webview-wrapper').forEach(el => {
    el.classList.toggle('active', el.dataset.tabId === tabId);
  });

  if (tab && tab.isHome) {
    welcomeScreen.classList.remove('hidden-view');
    urlInput.value = '';
    btnBack.disabled = true;
    btnForward.disabled = true;
  } else {
    welcomeScreen.classList.add('hidden-view');
    if (tab) urlInput.value = tab.url || '';
    const wv = getActiveWebview();
    if (wv) updateNavButtons(wv);
  }
}

function closeTab(tabId) {
  const index = tabs.findIndex(t => t.id === tabId);
  if (index === -1) return;
  tabs.splice(index, 1);

  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (tabEl) tabEl.remove();

  const wvWrapper = document.querySelector(`.webview-wrapper[data-tab-id="${tabId}"]`);
  if (wvWrapper) wvWrapper.remove();

  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      activateTab(tabs[Math.min(index, tabs.length - 1)].id);
    } else {
      createTab();
    }
  }
}

function updateTabTitle(tabId, title) {
  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"] .tab-title`);
  if (tabEl) tabEl.textContent = title.length > 22 ? title.substring(0, 22) + '…' : title;
}

function updateTabFavicon(tabId, faviconUrl) {
  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (!tabEl) return;
  let img = tabEl.querySelector('.tab-favicon');
  if (!img) {
    img = document.createElement('img');
    img.className = 'tab-favicon';
    tabEl.insertBefore(img, tabEl.firstChild);
  }
  img.src = faviconUrl;
  img.onerror = () => img.remove();
}

function getActiveWebview() {
  const wrapper = document.querySelector(`.webview-wrapper[data-tab-id="${activeTabId}"]`);
  return wrapper ? wrapper.querySelector('webview') : null;
}

// ════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════

function navigateTo(targetUrl) {
  if (!targetUrl) return;
  const parsedUrl = parseSearchOrURL(targetUrl);
  const tab = tabs.find(t => t.id === activeTabId);

  if (tab && tab.isHome) {
    tab.isHome = false;
    tab.url = parsedUrl;
    createWebview(activeTabId, parsedUrl);
    welcomeScreen.classList.add('hidden-view');
    document.querySelectorAll('.webview-wrapper').forEach(el => {
      el.classList.toggle('active', el.dataset.tabId === activeTabId);
    });
  } else {
    const wv = getActiveWebview();
    if (wv) {
      wv.loadURL(parsedUrl);
      tab.url = parsedUrl;
    }
  }
  urlInput.value = parsedUrl;
}

function navigateHome() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) {
    tab.isHome = true;
    tab.url = null;
    tab.title = 'Жаңа қойынды';
    updateTabTitle(activeTabId, tab.title);
  }
  const wvWrapper = document.querySelector(`.webview-wrapper[data-tab-id="${activeTabId}"]`);
  if (wvWrapper) wvWrapper.remove();
  welcomeScreen.classList.remove('hidden-view');
  urlInput.value = '';
  btnBack.disabled = true;
  btnForward.disabled = true;
}

// ════════════════════════════════════════
//  LOADING BAR
// ════════════════════════════════════════

let progressInterval = null;

function showLoadingBar() {
  if (progressInterval) clearInterval(progressInterval);
  loadingBar.style.opacity = '1';
  loadingBar.style.width = '20%';
  progressInterval = setInterval(() => {
    const cur = parseFloat(loadingBar.style.width);
    if (cur < 90) {
      loadingBar.style.width = (cur + Math.random() * 12) + '%';
    } else {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }, 200);
}

function hideLoadingBar() {
  if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
  loadingBar.style.width = '100%';
  setTimeout(() => {
    loadingBar.style.opacity = '0';
    setTimeout(() => { loadingBar.style.width = '0%'; }, 400);
  }, 200);
}

function updateNavButtons(webview) {
  try {
    btnBack.disabled = !webview.canGoBack();
    btnForward.disabled = !webview.canGoForward();
  } catch {
    btnBack.disabled = true;
    btnForward.disabled = true;
  }
}

// ════════════════════════════════════════
//  SIDEBAR PIN (Drag Tab → Sidebar)
// ════════════════════════════════════════

// Sidebar itself is a drop zone
sidebar.addEventListener('dragover', (e) => {
  // Only accept galamtor tab drags
  if (!draggedTabId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  sidebar.classList.add('drop-active');
  sidebarDropZone.classList.add('drag-hover');
});

sidebar.addEventListener('dragleave', (e) => {
  // Check if leaving sidebar entirely
  if (!sidebar.contains(e.relatedTarget)) {
    sidebar.classList.remove('drop-active');
    sidebarDropZone.classList.remove('drag-hover');
  }
});

sidebar.addEventListener('drop', (e) => {
  e.preventDefault();
  sidebar.classList.remove('drop-active');
  sidebarDropZone.classList.remove('drag-hover', 'visible');

  if (!draggedTabId) return;

  const tab = tabs.find(t => t.id === draggedTabId);
  if (!tab || !tab.url) return;

  pinToSidebar(tab.url, tab.title, tab.favicon);
});

function pinToSidebar(url, title, faviconUrl) {
  // Check if already pinned
  const existing = dockIcons.querySelector(`.dock-btn[data-url="${url}"]`);
  if (existing) {
    showToast('📌 Бұл сайт қазірдің өзінде бекітілген');
    return;
  }

  const domain = extractDomain(url);
  const initial = getInitial(url);
  const btn = document.createElement('button');
  btn.className = 'dock-btn';
  btn.dataset.url = url;
  btn.title = title || domain;

  if (faviconUrl) {
    btn.innerHTML = `<span class="dock-badge pinned-bg"><img src="${faviconUrl}" width="16" height="16" style="border-radius:2px;" onerror="this.parentElement.textContent='${initial}'"></span>`;
  } else {
    btn.innerHTML = `<span class="dock-badge pinned-bg">${initial}</span>`;
  }

  // Click to navigate
  btn.addEventListener('click', () => navigateTo(url));

  // Context menu
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, btn, url);
  });

  dockIcons.appendChild(btn);
  showToast(`📌 ${domain} бекітілді`);
}

// ════════════════════════════════════════
//  CONTEXT MENU (for sidebar icons)
// ════════════════════════════════════════

function showContextMenu(x, y, element, url) {
  contextTarget = { element, url };
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.classList.add('visible');
}

function hideContextMenu() {
  contextMenu.classList.remove('visible');
  contextTarget = null;
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.dock-btn')) hideContextMenu();
});

ctxOpen.addEventListener('click', () => {
  if (contextTarget) navigateTo(contextTarget.url);
  hideContextMenu();
});

ctxNewTab.addEventListener('click', () => {
  if (contextTarget) createTab(contextTarget.url);
  hideContextMenu();
});

ctxRemove.addEventListener('click', () => {
  if (contextTarget && contextTarget.element) {
    contextTarget.element.remove();
    showToast('🗑️ Бекітілген сайт жойылды');
  }
  hideContextMenu();
});

// Add context menu to existing dock buttons
dockIcons.querySelectorAll('.dock-btn').forEach(btn => {
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, btn, btn.dataset.url);
  });
});

// ════════════════════════════════════════
//  GALAMTOR LENS — Automated Image Search
// ════════════════════════════════════════

/**
 * Reads a local image file as base64, navigates to Google Lens,
 * then programmatically uploads the image inside the webview
 * so the user lands directly on the search-results page.
 */
function openLensWithFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('⚠️ Тек сурет файлдарын қабылдаймыз');
    return;
  }

  showToast('🔍 Galamtor Lens — сурет дайындалуда...');

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl    = reader.result;                          // data:image/…;base64,…
    const safeName   = file.name.replace(/['"\\`${}]/g, '_');  // sanitize for injection
    const mimeType   = file.type;

    // 1) Navigate to Google Lens origin so our injected fetch
    //    runs same-origin and keeps cookies / CORS happy.
    navigateTo('https://lens.google.com/');

    // 2) Grab the webview that was just created / reused.
    //    navigateTo() is synchronous DOM-wise, so the element exists now.
    requestAnimationFrame(() => {
      const wv = getActiveWebview();
      if (!wv) { showToast('⚠️ Webview табылмады'); return; }

      // Guard against double-fire
      let injected = false;
      const attemptInjection = () => {
        if (injected) return;
        injected = true;
        wv.removeEventListener('did-finish-load', attemptInjection);

        // Short grace period for Google's JS to initialise
        setTimeout(() => {
          performLensUpload(wv, dataUrl, safeName, mimeType);
        }, 1200);
      };

      wv.addEventListener('did-finish-load', attemptInjection);
    });
  };
  reader.readAsDataURL(file);
}

/**
 * Core injection — runs entirely inside the Google Lens webview.
 *
 * Strategy chain (first success wins):
 *   1. POST to /v3/upload  → follow redirect to results
 *   2. POST to legacy /searchbyimage/upload → follow redirect
 *   3. Find any <input type="file"> on the page and inject the File
 *   4. Simulate a DragEvent drop on the page body
 */
function performLensUpload(webview, dataUrl, fileName, mimeType) {
  // JSON.stringify safely escapes the (potentially multi-MB) base64 string
  // so it can be embedded as a JS string literal inside executeJavaScript.
  const b64Literal   = JSON.stringify(dataUrl);
  const nameLiteral  = JSON.stringify(fileName);
  const mimeLiteral  = JSON.stringify(mimeType);

  const script = `
    (async () => {
      /* ─── Helper: data-URL → File ─── */
      const b64  = ${b64Literal};
      const resp = await fetch(b64);
      const blob = await resp.blob();
      const file = new File([blob], ${nameLiteral}, { type: ${mimeLiteral} });

      /* ─── STRATEGY 1 — POST /v3/upload (modern Lens endpoint) ─── */
      try {
        const fd1 = new FormData();
        fd1.append('encoded_image', file, file.name);
        fd1.append('sbisrc', 'Chromium Lens Overlay');
        fd1.append('original_width',  '0');
        fd1.append('original_height', '0');

        const r1 = await fetch('/v3/upload', {
          method: 'POST',
          body: fd1,
          credentials: 'include',
          redirect: 'follow',
        });

        /* Fetch followed a redirect → the final URL is the results page */
        if (r1.redirected && r1.url) {
          window.location.href = r1.url;
          return 'ok:redirect-v3';
        }

        /* No redirect, but the response body may contain one */
        if (r1.ok) {
          const html = await r1.text();
          const m = html.match(/(https:\\/\\/lens\\.google\\.com\\/search[^"'\\\\s<>]+)/);
          if (m) {
            window.location.href = m[1].replace(/&amp;/g, '&');
            return 'ok:parsed-v3';
          }
        }
      } catch (_) { /* fall through */ }

      /* ─── STRATEGY 2 — POST /searchbyimage/upload (legacy) ─── */
      try {
        const fd2 = new FormData();
        fd2.append('encoded_image', file, file.name);
        fd2.append('image_content', '');

        const r2 = await fetch('/searchbyimage/upload', {
          method: 'POST',
          body: fd2,
          credentials: 'include',
          redirect: 'follow',
        });

        if (r2.redirected && r2.url) {
          window.location.href = r2.url;
          return 'ok:redirect-legacy';
        }

        if (r2.ok) {
          const html2 = await r2.text();
          const m2 = html2.match(/(https?:\\/\\/[^"'\\\\s<>]+search[^"'\\\\s<>]+)/);
          if (m2) {
            window.location.href = m2[1].replace(/&amp;/g, '&');
            return 'ok:parsed-legacy';
          }
        }
      } catch (_) { /* fall through */ }

      /* ─── STRATEGY 3 — Inject into <input type="file"> ─── */
      try {
        const inputs = document.querySelectorAll('input[type="file"]');
        if (inputs.length) {
          for (const inp of inputs) {
            const dt = new DataTransfer();
            dt.items.add(file);
            inp.files = dt.files;
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new Event('input',  { bubbles: true }));
          }
          return 'ok:input-inject';
        }
      } catch (_) { /* fall through */ }

      /* ─── STRATEGY 4 — Simulate drop on page body ─── */
      try {
        const target = document.querySelector('[data-action-type]')
                    || document.querySelector('[jscontroller]')
                    || document.body;
        const dt = new DataTransfer();
        dt.items.add(file);
        ['dragenter', 'dragover', 'drop'].forEach(evtName => {
          target.dispatchEvent(new DragEvent(evtName, {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
          }));
        });
        return 'ok:drop-simulate';
      } catch (_) { /* fall through */ }

      return 'fail:all-strategies-exhausted';
    })();
  `;

  webview.executeJavaScript(script)
    .then(result => {
      console.log('[Galamtor Lens]', result);
      if (result && result.startsWith('ok:')) {
        showToast('🔍 Lens нәтижелері жүктелуде...');
      } else if (result && result.startsWith('fail:')) {
        showToast('⚠️ Автоматты жүктеу сәтсіз — бетте қолмен жүктеңіз');
      }
    })
    .catch(err => {
      console.error('[Galamtor Lens] Injection error:', err);
      showToast('⚠️ Lens қатесі — бетте қолмен жүктеңіз');
    });
}

/**
 * URL-based image search — works directly for externally-hosted images.
 */
function openLensWithUrl(imageUrl) {
  showToast('🔍 Galamtor Lens іздеуде...');
  const lensUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
  navigateTo(lensUrl);
}

// Lens button click → open file picker
btnLens.addEventListener('click', () => lensFileInput.click());
btnLensWelcome.addEventListener('click', () => lensFileInput.click());

lensFileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) {
    openLensWithFile(e.target.files[0]);
    e.target.value = '';
  }
});

// ── Image Drag & Drop on URL Bar ──
urlBar.addEventListener('dragover', (e) => {
  if (draggedTabId) return; // ignore tab drags
  const hasImage = Array.from(e.dataTransfer.types).some(t =>
    t === 'Files' || t.includes('image') || t === 'text/uri-list'
  );
  if (hasImage) {
    e.preventDefault();
    urlBar.classList.add('lens-drag-over');
  }
});

urlBar.addEventListener('dragleave', () => {
  urlBar.classList.remove('lens-drag-over');
});

urlBar.addEventListener('drop', (e) => {
  urlBar.classList.remove('lens-drag-over');
  if (draggedTabId) return;

  // Check for image URL
  const imageUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (imageUrl && (imageUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)/i) || imageUrl.startsWith('data:image'))) {
    e.preventDefault();
    openLensWithUrl(imageUrl);
    return;
  }

  // Check for file
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0];
    if (file.type.startsWith('image/')) {
      e.preventDefault();
      openLensWithFile(file);
      return;
    }
  }
});

// ── Image Drag & Drop on Welcome Search Box ──
welcomeSearchBox.addEventListener('dragover', (e) => {
  if (draggedTabId) return;
  const hasImage = Array.from(e.dataTransfer.types).some(t =>
    t === 'Files' || t.includes('image') || t === 'text/uri-list'
  );
  if (hasImage) {
    e.preventDefault();
    welcomeSearchBox.classList.add('lens-drag-over');
    lensDropOverlay.classList.add('visible');
  }
});

welcomeSearchBox.addEventListener('dragleave', (e) => {
  if (!welcomeSearchBox.contains(e.relatedTarget)) {
    welcomeSearchBox.classList.remove('lens-drag-over');
    lensDropOverlay.classList.remove('visible');
  }
});

welcomeSearchBox.addEventListener('drop', (e) => {
  welcomeSearchBox.classList.remove('lens-drag-over');
  lensDropOverlay.classList.remove('visible');
  if (draggedTabId) return;

  const imageUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (imageUrl && (imageUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)/i) || imageUrl.startsWith('data:image'))) {
    e.preventDefault();
    openLensWithUrl(imageUrl);
    return;
  }

  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0];
    if (file.type.startsWith('image/')) {
      e.preventDefault();
      openLensWithFile(file);
    }
  }
});

// ── Global drag overlay for welcome screen ──
const welcomeForm = document.getElementById('welcome-search-form');
welcomeForm.addEventListener('dragover', (e) => {
  if (draggedTabId) return;
  const hasImage = Array.from(e.dataTransfer.types).some(t => t === 'Files');
  if (hasImage) {
    e.preventDefault();
    lensDropOverlay.classList.add('visible');
    welcomeSearchBox.classList.add('lens-drag-over');
  }
});

welcomeForm.addEventListener('dragleave', (e) => {
  if (!welcomeForm.contains(e.relatedTarget)) {
    lensDropOverlay.classList.remove('visible');
    welcomeSearchBox.classList.remove('lens-drag-over');
  }
});

welcomeForm.addEventListener('drop', (e) => {
  lensDropOverlay.classList.remove('visible');
  welcomeSearchBox.classList.remove('lens-drag-over');

  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0];
    if (file.type.startsWith('image/')) {
      e.preventDefault();
      openLensWithFile(file);
    }
  }
});

// ════════════════════════════════════════
//  PIP MUSIC DOCK
// ════════════════════════════════════════

function togglePip() {
  if (pipState.visible) {
    pipDock.classList.remove('animate-in');
    setTimeout(() => {
      pipDock.classList.remove('visible');
      pipState.visible = false;
    }, 300);
  } else {
    pipDock.classList.add('visible');
    // Force reflow for animation
    requestAnimationFrame(() => {
      pipDock.classList.add('animate-in');
    });
    pipState.visible = true;
  }
}

function pipUpdateFromYTMusic(title) {
  // Parse "Song - Artist" format from YouTube Music page title
  const trackName = document.querySelector('.pip-track-name');
  const trackArtist = document.querySelector('.pip-track-artist');

  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    trackName.textContent = parts[0].trim();
    trackArtist.textContent = parts.slice(1).join(' - ').replace(' - YouTube Music', '').trim();
  } else {
    trackName.textContent = title.replace(' - YouTube Music', '').trim();
    trackArtist.textContent = 'YouTube Music';
  }

  // Auto-show PIP if not visible
  if (!pipState.visible) {
    togglePip();
  }
}

btnPipToggle.addEventListener('click', togglePip);
pipClose.addEventListener('click', togglePip);

pipExpand.addEventListener('click', () => {
  // Navigate to YouTube Music tab or create one
  const ytTab = tabs.find(t => t.url && t.url.includes('music.youtube.com'));
  if (ytTab) {
    activateTab(ytTab.id);
  } else {
    createTab('https://music.youtube.com');
  }
});

// PIP play/pause simulation
pipPlay.addEventListener('click', () => {
  pipState.playing = !pipState.playing;

  // Toggle play/pause icon
  if (pipState.playing) {
    pipPlay.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    // Simulate progress
    if (pipState.interval) clearInterval(pipState.interval);
    pipState.interval = setInterval(() => {
      pipState.progress = Math.min(pipState.progress + 0.5, 100);
      pipProgressBar.style.width = pipState.progress + '%';
      if (pipState.progress >= 100) {
        clearInterval(pipState.interval);
        pipState.playing = false;
        pipPlay.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      }
    }, 300);
  } else {
    pipPlay.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    if (pipState.interval) clearInterval(pipState.interval);
  }

  // Try to control actual YouTube Music webview
  const ytTab = tabs.find(t => t.url && t.url.includes('music.youtube.com'));
  if (ytTab) {
    const wrapper = document.querySelector(`.webview-wrapper[data-tab-id="${ytTab.id}"]`);
    if (wrapper) {
      const wv = wrapper.querySelector('webview');
      try {
        wv.executeJavaScript(`
          const playBtn = document.querySelector('tp-yt-paper-icon-button.play-pause-button, [aria-label="Play"], [aria-label="Pause"]');
          if (playBtn) playBtn.click();
        `);
      } catch (e) { /* ignore */ }
    }
  }
});

pipPrev.addEventListener('click', () => {
  pipState.progress = 0;
  pipProgressBar.style.width = '0%';
  showToast('⏮ Алдыңғы трек');
});

pipNext.addEventListener('click', () => {
  pipState.progress = 0;
  pipProgressBar.style.width = '0%';
  showToast('⏭ Келесі трек');
});

// ════════════════════════════════════════
//  EVENT LISTENERS
// ════════════════════════════════════════

urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  navigateTo(urlInput.value);
  urlInput.blur();
});

welcomeSearchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  navigateTo(welcomeSearchInput.value);
  welcomeSearchInput.value = '';
});

btnBack.addEventListener('click', () => {
  const wv = getActiveWebview();
  if (wv && wv.canGoBack()) wv.goBack();
});

btnForward.addEventListener('click', () => {
  const wv = getActiveWebview();
  if (wv && wv.canGoForward()) wv.goForward();
});

btnRefresh.addEventListener('click', () => {
  const wv = getActiveWebview();
  if (wv) wv.reload();
});

btnHome.addEventListener('click', navigateHome);
btnNewTab.addEventListener('click', () => createTab());

// Shortcut cards
document.querySelectorAll('.shortcut-card').forEach(card => {
  card.addEventListener('click', () => {
    const url = card.dataset.url;
    if (url) navigateTo(url);
  });
});

// Sidebar dock clicks
dockIcons.querySelectorAll('.dock-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const url = btn.dataset.url;
    if (url) navigateTo(url);
  });
});

// Clear cache
btnClearCache.addEventListener('click', () => {
  const wv = getActiveWebview();
  if (wv) { try { wv.clearHistory(); } catch {} }
  showToast('🧹 Кэш пен тарих сәтті тазартылды!');
});

// ── Keyboard Shortcuts ──
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 't') {
    e.preventDefault();
    createTab();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
    e.preventDefault();
    if (activeTabId) closeTab(activeTabId);
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
    e.preventDefault();
    urlInput.focus();
    urlInput.select();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
    e.preventDefault();
    const wv = getActiveWebview();
    if (wv) wv.reload();
  }
  // Cmd+Shift+M — toggle PIP
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'm') {
    e.preventDefault();
    togglePip();
  }
});

// ════════════════════════════════════════
//  INIT
// ════════════════════════════════════════
createTab();
