// ════════════════════════════════════════════════════════════
//  GALAMTOR — Renderer Process v2
//  Tab Drag & Drop · Sidebar Pinning · Lens · PIP Dock
// ════════════════════════════════════════════════════════════

// ── DOM References ──
const tabsContainer = document.getElementById('tabs-container');
const btnNewTab = document.getElementById('btn-new-tab');
// Relocate "+" new tab button to sit inline inside tabs-container
if (tabsContainer && btnNewTab) tabsContainer.appendChild(btnNewTab);

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
    
    const tab = tabs.find(t => t.id === tabId);
    const tabUrl = tab ? (tab.url || '') : '';
    const tabTitle = tab ? (tab.title || '') : '';

    e.dataTransfer.setData('text/plain', tabUrl);
    e.dataTransfer.setData('text/title', tabTitle);
    e.dataTransfer.setData('application/x-galamtor-tab', tabId);
    e.dataTransfer.effectAllowed = 'copyMove';
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

  tabsContainer.insertBefore(tabEl, btnNewTab);

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

  webview.addEventListener('media-started-playing', () => {
    handleMediaStart(tabId);
  });
  webview.addEventListener('media-paused', () => {
    handleMediaPause(tabId);
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
    if (typeof refreshGalamtorState === 'function') refreshGalamtorState();
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
  if (typeof refreshGalamtorState === 'function') refreshGalamtorState();
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

  const url = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
  const title = e.dataTransfer.getData('text/title') || '';

  if (!url) return;

  let faviconUrl = '';
  const tab = draggedTabId ? tabs.find(t => t.id === draggedTabId) : null;
  if (tab && tab.favicon) {
    faviconUrl = tab.favicon;
  } else {
    try {
      const domain = extractDomain(url);
      faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}`;
    } catch (err) {
      console.error(err);
    }
  }

  pinToSidebar(url, title, faviconUrl);
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

  const finalFaviconUrl = faviconUrl || `https://www.google.com/s2/favicons?domain=${domain}`;

  btn.innerHTML = `<span class="dock-badge pinned-bg"><img src="${finalFaviconUrl}" width="16" height="16" style="border-radius:2px;" onerror="this.parentElement.textContent='${initial}'"></span>`;

  // Click to navigate or open new tab
  btn.addEventListener('click', () => {
    if (tabs.length === 0 || !activeTabId) {
      createTab(url);
    } else {
      navigateTo(url);
    }
  });

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
//  SIDEBAR MEDIA PLAYER (Arc-Style)
// ════════════════════════════════════════

// Inject styles for the Siri-like pulsing gradient and custom elements
const styleEl = document.createElement('style');
styleEl.innerHTML = `
  @keyframes siriPulse {
    0% { box-shadow: 0 0 4px rgba(255, 100, 150, 0.4), inset 0 0 0 2px transparent; border-color: rgba(255, 100, 150, 0.6); }
    50% { box-shadow: 0 0 14px rgba(100, 180, 255, 0.8), inset 0 0 0 2px transparent; border-color: rgba(100, 180, 255, 0.9); }
    100% { box-shadow: 0 0 4px rgba(255, 100, 150, 0.4), inset 0 0 0 2px transparent; border-color: rgba(255, 100, 150, 0.6); }
  }
  @keyframes rainbowBorder {
    0% { border-color: #ff6b6b; }
    33% { border-color: #4ea8de; }
    66% { border-color: #70e000; }
    100% { border-color: #ff6b6b; }
  }
  .media-player-active {
    animation: siriPulse 2s infinite ease-in-out, rainbowBorder 4s infinite linear !important;
    border: 2px solid transparent !important;
  }
  .media-player-badge {
    position: relative;
    background: linear-gradient(135deg, #1e1e24, #121214);
    border: 1px solid rgba(255,255,255,0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 50% !important;
    overflow: visible;
  }
  .media-player-badge svg {
    color: #ffffff;
    transition: all 0.2s ease;
  }
  .media-player-overlay {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #00b4d8;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #121214;
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  .media-player-active .media-player-overlay {
    opacity: 1;
  }

  /* Minimalist Sidebar Logo styles */
  .sidebar-logo {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    transition: opacity 0.2s ease !important;
    font-size: 22px !important;
    font-weight: 800 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    pointer-events: auto !important;
    cursor: pointer !important;
  }
  .sidebar-logo:hover {
    opacity: 0.8 !important;
  }

  /* Inline New Tab Plus Button Alignment */
  #tabs-container {
    display: flex !important;
    align-items: center !important;
  }
  #btn-new-tab {
    margin: 0 8px !important;
    position: static !important;
    top: auto !important;
  }

  /* Animated Equalizer Wave Styles */
  .media-equalizer {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 12px;
    width: 12px;
  }
  .eq-bar {
    width: 2px;
    height: 3px;
    background-color: #ffffff;
    border-radius: 1px;
    transition: height 0.2s ease;
  }
  .media-player-active .eq-bar-1 {
    animation: eqWave 0.8s infinite ease-in-out alternate;
  }
  .media-player-active .eq-bar-2 {
    animation: eqWave 0.6s infinite ease-in-out alternate 0.2s;
  }
  .media-player-active .eq-bar-3 {
    animation: eqWave 1s infinite ease-in-out alternate 0.1s;
  }
  @keyframes eqWave {
    0% { height: 3px; }
    100% { height: 12px; }
  }

  /* Sidebar-restricted Ambient Glow & Click Safety Layering */
  @keyframes appleGlow {
    0% { filter: hue-rotate(0deg); }
    100% { filter: hue-rotate(360deg); }
  }
  #sidebar {
    overflow: visible !important;
  }
  .dock-icons, .sidebar-logo, .dock-bottom {
    position: relative !important;
    z-index: 2 !important;
  }
  #sidebar-ambient-glow {
    position: absolute;
    inset: 6px 6px;
    pointer-events: none !important;
    z-index: 1 !important; /* Raised above background but behind content */
    border-radius: 30px;
    opacity: 0;
    transition: opacity 0.8s cubic-bezier(0.25, 1, 0.5, 1);
    box-sizing: border-box;
  }
  #sidebar-ambient-glow::before {
    content: "";
    position: absolute;
    inset: 0;
    padding: 2px;
    border-radius: inherit;
    background: linear-gradient(135deg, #7209b7, #3f37c9, #4895ef, #f72585, #7209b7);
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none !important;
  }
  #sidebar-ambient-glow.active-glow {
    opacity: 1;
    box-shadow: 0 0 15px rgba(114, 9, 183, 0.6), 0 0 25px rgba(72, 149, 239, 0.4);
  }
  #sidebar-ambient-glow.active-glow::before {
    animation: appleGlow 6s infinite linear;
  }
`;
document.head.appendChild(styleEl);

let activeMediaTabId = null;
let isMediaPlaying = false;
let lastPlayedAlbumArtUrl = null;

function fetchAlbumArt() {
  if (!activeMediaTabId) return;
  const wrapper = document.querySelector(`.webview-wrapper[data-tab-id="${activeMediaTabId}"]`);
  if (!wrapper) return;
  const wv = wrapper.querySelector('webview');
  if (!wv) return;

  const getArtScript = `
    (() => {
      if (navigator.mediaSession && navigator.mediaSession.metadata && navigator.mediaSession.metadata.artwork && navigator.mediaSession.metadata.artwork.length > 0) {
        return navigator.mediaSession.metadata.artwork[navigator.mediaSession.metadata.artwork.length - 1].src;
      }
      const ytMusicArt = document.querySelector('ytmusic-player img#img');
      if (ytMusicArt && ytMusicArt.src) return ytMusicArt.src;
      
      if (window.location.hostname.includes('youtube.com')) {
        const urlParams = new URLSearchParams(window.location.search);
        const videoId = urlParams.get('v');
        if (videoId) return 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg';
      }
      
      const ogImg = document.querySelector('meta[name="twitter:image"], meta[property="og:image"]');
      if (ogImg && ogImg.content) return ogImg.content;
      
      return null;
    })()
  `;

  wv.executeJavaScript(getArtScript)
    .then(artUrl => {
      if (artUrl) {
        lastPlayedAlbumArtUrl = artUrl;
        // If currently paused, update the paused display to show the newly fetched album art
        if (!isMediaPlaying) {
          updateMediaPlayerUI();
        }
      }
    })
    .catch(err => console.log('Error fetching album art:', err));
}

function togglePip() {
  toggleMediaPlayback();
}

function handleMediaStart(tabId) {
  activeMediaTabId = tabId;
  isMediaPlaying = true;
  updateMediaPlayerUI();
  
  // Attempt to capture the album art after loading transitions
  setTimeout(fetchAlbumArt, 200);
  setTimeout(fetchAlbumArt, 1000);
  setTimeout(fetchAlbumArt, 3000);
}

function handleMediaPause(tabId) {
  if (activeMediaTabId === tabId) {
    isMediaPlaying = false;
    updateMediaPlayerUI();
  }
}

function updateMediaPlayerUI() {
  const mediaPlayer = document.getElementById('sidebar-media-player');
  const glowContainer = document.getElementById('sidebar-ambient-glow');
  if (!mediaPlayer) return;

  const overlayIcon = mediaPlayer.querySelector('.overlay-icon');
  const badge = mediaPlayer.querySelector('.media-player-badge');
  const staticIcon = mediaPlayer.querySelector('.media-static-icon');

  if (isMediaPlaying && activeMediaTabId) {
    const tab = tabs.find(t => t.id === activeMediaTabId);
    mediaPlayer.title = tab ? `Ойнатылуда: ${tab.title}` : 'Медиа ойнатылуда';
    badge.classList.add('media-player-active');
    badge.style.backgroundImage = 'none';
    badge.style.setProperty('display', 'inline-flex', 'important');
    mediaPlayer.style.setProperty('display', 'flex', 'important');
    if (staticIcon) {
      staticIcon.style.removeProperty('display');
    }
    if (glowContainer) glowContainer.classList.add('active-glow');
    if (overlayIcon) {
      overlayIcon.outerHTML = `
        <svg class="overlay-icon" viewBox="0 0 24 24" width="6" height="6" fill="currentColor">
          <rect x="5" y="4" width="4" height="16"/>
          <rect x="15" y="4" width="4" height="16"/>
        </svg>
      `;
    }
  } else {
    mediaPlayer.title = 'Медиа ойнатқыш (Күтуде)';
    badge.classList.remove('media-player-active');
    badge.style.setProperty('display', 'inline-flex', 'important');
    mediaPlayer.style.setProperty('display', 'flex', 'important');
    
    if (lastPlayedAlbumArtUrl) {
      badge.style.backgroundImage = `url('${lastPlayedAlbumArtUrl}')`;
      badge.style.backgroundSize = 'cover';
      badge.style.backgroundPosition = 'center';
      if (staticIcon) {
        staticIcon.style.setProperty('display', 'none', 'important');
      }
    } else {
      badge.style.backgroundImage = 'none';
      if (staticIcon) {
        staticIcon.style.removeProperty('display');
      }
    }

    if (glowContainer) glowContainer.classList.remove('active-glow');
    if (overlayIcon) {
      overlayIcon.outerHTML = `
        <svg class="overlay-icon" viewBox="0 0 24 24" width="6" height="6" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      `;
    }
  }
}

function toggleMediaPlayback() {
  if (!activeMediaTabId) {
    const musicTab = tabs.find(t => t.url && (t.url.includes('music.youtube.com') || t.url.includes('youtube.com')));
    if (musicTab) {
      activeMediaTabId = musicTab.id;
    } else {
      return;
    }
  }

  const wrapper = document.querySelector(`.webview-wrapper[data-tab-id="${activeMediaTabId}"]`);
  if (!wrapper) return;
  const wv = wrapper.querySelector('webview');
  if (!wv) return;

  wv.executeJavaScript(`
    (() => {
      const media = document.querySelector('video, audio');
      if (media) {
        if (media.paused) {
          media.play();
          return 'playing';
        } else {
          media.pause();
          return 'paused';
        }
      }
      const playBtn = document.querySelector('tp-yt-paper-icon-button.play-pause-button, [aria-label="Play"], [aria-label="Pause"]');
      if (playBtn) {
        playBtn.click();
        return 'clicked';
      }
      return 'none';
    })()
  `).then((res) => {
    if (res === 'playing') {
      isMediaPlaying = true;
      updateMediaPlayerUI();
    } else if (res === 'paused') {
      isMediaPlaying = false;
      updateMediaPlayerUI();
    }
  }).catch(err => console.error('Failed to toggle playback:', err));
}

function openMediaTab() {
  if (activeMediaTabId) {
    activateTab(activeMediaTabId);
  } else {
    const ytTab = tabs.find(t => t.url && t.url.includes('music.youtube.com'));
    if (ytTab) {
      activateTab(ytTab.id);
    } else {
      createTab('https://music.youtube.com');
    }
  }
}

function pipUpdateFromYTMusic(title) {
  let trackInfo = title.replace(' - YouTube Music', '').trim();
  const mediaPlayer = document.getElementById('sidebar-media-player');
  if (mediaPlayer) {
    mediaPlayer.title = `Ойнатылуда: ${trackInfo}`;
  }
}

function makeDockIconsDraggable() {
  document.querySelectorAll('.dock-btn').forEach(btn => {
    if (!btn.hasAttribute('draggable')) {
      btn.setAttribute('draggable', 'true');
    }
  });

  let draggedIcon = null;

  dockIcons.addEventListener('dragstart', (e) => {
    const btn = e.target.closest('.dock-btn');
    if (!btn) return;
    draggedIcon = btn;
    btn.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  dockIcons.addEventListener('dragend', (e) => {
    if (draggedIcon) {
      draggedIcon.classList.remove('dragging');
      draggedIcon = null;
    }
  });

  dockIcons.addEventListener('dragover', (e) => {
    e.preventDefault();
    const btn = e.target.closest('.dock-btn');
    if (!btn || btn === draggedIcon) return;

    const rect = btn.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      dockIcons.insertBefore(draggedIcon, btn);
    } else {
      dockIcons.insertBefore(draggedIcon, btn.nextSibling);
    }
  });
}

function initSidebarMediaPlayer() {
  // Create sidebar ambient glow container
  sidebar.style.position = 'relative';
  const glowContainer = document.createElement('div');
  glowContainer.id = 'sidebar-ambient-glow';
  sidebar.appendChild(glowContainer);

  const mediaPlayer = document.createElement('div');
  mediaPlayer.id = 'sidebar-media-player';
  mediaPlayer.className = 'dock-btn';
  mediaPlayer.setAttribute('draggable', 'true');
  mediaPlayer.title = 'Медиа ойнатқыш';
  
  mediaPlayer.innerHTML = `
    <span class="dock-badge media-player-badge">
      <span class="media-equalizer">
        <span class="eq-bar eq-bar-1"></span>
        <span class="eq-bar eq-bar-2"></span>
        <span class="eq-bar eq-bar-3"></span>
      </span>
      <svg class="media-static-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #ffffff; display: none;">
        <path d="M9 18V5l12-2v13"/>
        <circle cx="6" cy="18" r="3"/>
        <circle cx="18" cy="16" r="3"/>
      </svg>
    </span>
  `;

  dockIcons.appendChild(mediaPlayer);

  mediaPlayer.addEventListener('click', toggleMediaPlayback);

  let dragStartPageX = 0;
  mediaPlayer.addEventListener('dragstart', (e) => {
    dragStartPageX = e.clientX;
    mediaPlayer.classList.add('dragging');
  });

  mediaPlayer.addEventListener('dragend', (e) => {
    mediaPlayer.classList.remove('dragging');
    const diffX = e.clientX - dragStartPageX;
    if (diffX > 100) {
      openMediaTab();
    }
  });

  makeDockIconsDraggable();
}

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

// Clear cache — Cinematic Mage + Browser Tab Animation
btnClearCache.addEventListener('click', () => {
  if (document.getElementById('cache-burn-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'cache-burn-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0;
    width: 100vw; height: 100vh;
    background: rgba(4,5,8,0.92);
    z-index: 999999; overflow: hidden;
    pointer-events: all; opacity: 0;
    transition: opacity 0.35s ease;
  `;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
  overlay.appendChild(canvas);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });

  const ctx = canvas.getContext('2d');
  const resizeCanvas = () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // ── DRAW MAGE SILHOUETTE ──────────────────────────────────────────────────
  // Full 2D vector mage: head, hood, torso, robe hem, two extended arms
  // with glowing palm orbs, a staff line and a levitating crystal orb.
  const drawMage = (cx, cy, hoverY) => {
    const y = cy + hoverY;
    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#00f2fe';
    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';

    // Head
    ctx.fillStyle   = '#1a1f2e';
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth   = 1.4;
    ctx.beginPath();
    ctx.arc(cx, y - 90, 18, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // Hood collar
    ctx.beginPath();
    ctx.moveTo(cx - 22, y - 76);
    ctx.bezierCurveTo(cx - 32, y - 62, cx - 28, y - 50, cx - 20, y - 42);
    ctx.lineTo(cx + 20, y - 42);
    ctx.bezierCurveTo(cx + 28, y - 50, cx + 32, y - 62, cx + 22, y - 76);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Torso / robe body
    ctx.beginPath();
    ctx.moveTo(cx - 20, y - 42);
    ctx.bezierCurveTo(cx - 30, y - 20, cx - 32, y + 2, cx - 23, y + 30);
    ctx.lineTo(cx + 23, y + 30);
    ctx.bezierCurveTo(cx + 32, y + 2, cx + 30, y - 20, cx + 20, y - 42);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Robe hem
    ctx.beginPath();
    ctx.moveTo(cx - 23, y + 28);
    ctx.bezierCurveTo(cx - 38, y + 46, cx - 22, y + 60, cx, y + 57);
    ctx.bezierCurveTo(cx + 22, y + 60, cx + 38, y + 46, cx + 23, y + 28);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Staff spine
    ctx.save();
    ctx.shadowColor = '#c084fc'; ctx.shadowBlur = 14;
    ctx.strokeStyle = '#c084fc'; ctx.lineWidth = 2.8;
    ctx.beginPath(); ctx.moveTo(cx, y - 44); ctx.lineTo(cx, y + 12); ctx.stroke();
    ctx.restore();

    // Left arm (silhouette fill first, then neon outline)
    ctx.strokeStyle = '#1a1f2e'; ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(cx - 20, y - 28);
    ctx.bezierCurveTo(cx - 52, y - 22, cx - 88, y - 12, cx - 114, y - 5);
    ctx.stroke();
    ctx.shadowBlur = 18; ctx.shadowColor = '#00f2fe';
    ctx.strokeStyle = '#00f2fe'; ctx.lineWidth = 1.5;
    ctx.stroke();

    // Left palm orb
    ctx.beginPath();
    ctx.arc(cx - 114, y - 5, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#0d1117'; ctx.fill();
    ctx.strokeStyle = '#00f2fe'; ctx.lineWidth = 1.5; ctx.stroke();
    const lg = ctx.createRadialGradient(cx-114,y-5,0,cx-114,y-5,14);
    lg.addColorStop(0,'rgba(0,242,254,0.55)'); lg.addColorStop(1,'rgba(0,242,254,0)');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.arc(cx-114,y-5,14,0,Math.PI*2); ctx.fill();

    // Right arm
    ctx.strokeStyle = '#1a1f2e'; ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(cx + 20, y - 28);
    ctx.bezierCurveTo(cx + 52, y - 22, cx + 88, y - 12, cx + 114, y - 5);
    ctx.stroke();
    ctx.shadowBlur = 18; ctx.shadowColor = '#00f2fe';
    ctx.strokeStyle = '#00f2fe'; ctx.lineWidth = 1.5;
    ctx.stroke();

    // Right palm orb
    ctx.beginPath();
    ctx.arc(cx + 114, y - 5, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#0d1117'; ctx.fill();
    ctx.strokeStyle = '#00f2fe'; ctx.lineWidth = 1.5; ctx.stroke();
    const rg = ctx.createRadialGradient(cx+114,y-5,0,cx+114,y-5,14);
    rg.addColorStop(0,'rgba(0,242,254,0.55)'); rg.addColorStop(1,'rgba(0,242,254,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(cx+114,y-5,14,0,Math.PI*2); ctx.fill();

    // Crystal orb above head
    ctx.save();
    ctx.shadowBlur = 22; ctx.shadowColor = '#a259ff';
    const og = ctx.createRadialGradient(cx-3,y-112,1,cx,y-109,9);
    og.addColorStop(0,'rgba(255,255,255,0.95)');
    og.addColorStop(0.45,'rgba(162,89,255,0.85)');
    og.addColorStop(1,'rgba(0,242,254,0.25)');
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(cx, y - 109, 9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.restore();
  };

  // ── FAVICON DRAWERS ────────────────────────────────────────────────────────
  const drawFavicon = (fctx, fx, fy, r, brand) => {
    fctx.save();
    fctx.translate(fx, fy);
    const rr = (x, y, w, h, rad) => { fctx.beginPath(); fctx.roundRect(x,y,w,h,rad); };

    if (brand === 'youtube') {
      fctx.fillStyle = '#ff0000';
      rr(-r,-r,r*2,r*2,r*0.32); fctx.fill();
      fctx.fillStyle = '#fff';
      fctx.beginPath();
      fctx.moveTo(-r*0.3,-r*0.44); fctx.lineTo(r*0.5,0); fctx.lineTo(-r*0.3,r*0.44);
      fctx.closePath(); fctx.fill();

    } else if (brand === 'github') {
      fctx.fillStyle = '#24292e';
      rr(-r,-r,r*2,r*2,r*0.32); fctx.fill();
      // Octocat: head circle + two legs
      fctx.fillStyle = '#fff';
      fctx.beginPath(); fctx.arc(0,-r*0.08,r*0.42,0,Math.PI*2); fctx.fill();
      fctx.fillStyle = '#24292e';
      fctx.beginPath(); fctx.arc(0,-r*0.08,r*0.18,0,Math.PI*2); fctx.fill();
      fctx.fillStyle = '#fff';
      fctx.beginPath(); fctx.ellipse(-r*0.22,r*0.5,r*0.11,r*0.22,0,0,Math.PI*2); fctx.fill();
      fctx.beginPath(); fctx.ellipse( r*0.22,r*0.5,r*0.11,r*0.22,0,0,Math.PI*2); fctx.fill();

    } else if (brand === 'spotify') {
      fctx.fillStyle = '#1db954';
      rr(-r,-r,r*2,r*2,r*0.32); fctx.fill();
      fctx.strokeStyle = '#fff'; fctx.lineWidth = r*0.17; fctx.lineCap = 'round';
      const arcs = [[r*0.32,r*0.68],[r*0.22,r*0.52],[r*0.12,r*0.36]];
      arcs.forEach(([rad,cy]) => {
        fctx.beginPath(); fctx.arc(0,cy-r*0.28,rad,Math.PI*1.22,Math.PI*1.78); fctx.stroke();
      });

    } else if (brand === 'google') {
      fctx.fillStyle = '#fff';
      rr(-r,-r,r*2,r*2,r*0.32); fctx.fill();
      fctx.lineWidth = r*0.3;
      const gr = r*0.58;
      [{c:'#ea4335',s:Math.PI*1.12,e:Math.PI*1.88},
       {c:'#fbbc05',s:Math.PI*0.87,e:Math.PI*1.12},
       {c:'#34a853',s:Math.PI*0.12,e:Math.PI*0.87},
       {c:'#4285f4',s:-Math.PI*0.12,e:Math.PI*0.12}].forEach(sg=>{
        fctx.strokeStyle=sg.c; fctx.beginPath(); fctx.arc(0,0,gr,sg.s,sg.e); fctx.stroke();
      });
      fctx.strokeStyle='#4285f4';
      fctx.beginPath(); fctx.moveTo(0,0); fctx.lineTo(gr,0); fctx.stroke();

    } else if (brand === 'reddit') {
      fctx.fillStyle = '#ff4500';
      rr(-r,-r,r*2,r*2,r*0.32); fctx.fill();
      // Simple alien face
      fctx.fillStyle = '#fff';
      fctx.beginPath(); fctx.arc(-r*0.22,-r*0.05,r*0.18,0,Math.PI*2); fctx.fill();
      fctx.beginPath(); fctx.arc( r*0.22,-r*0.05,r*0.18,0,Math.PI*2); fctx.fill();
      fctx.fillStyle = '#ff4500';
      fctx.beginPath(); fctx.arc(-r*0.22,-r*0.05,r*0.09,0,Math.PI*2); fctx.fill();
      fctx.beginPath(); fctx.arc( r*0.22,-r*0.05,r*0.09,0,Math.PI*2); fctx.fill();
      fctx.strokeStyle = '#fff'; fctx.lineWidth = r*0.13;
      fctx.beginPath(); fctx.arc(0,r*0.18,r*0.3,0.2,Math.PI-0.2); fctx.stroke();

    } else { // figma
      fctx.fillStyle = '#1e1e2e';
      rr(-r,-r,r*2,r*2,r*0.32); fctx.fill();
      fctx.fillStyle = '#0acf83';
      fctx.fillRect(-r*0.45,-r*0.65,r*0.9,r*0.18);
      fctx.fillRect(-r*0.45,-r*0.15,r*0.7,r*0.18);
      fctx.fillRect(-r*0.45,-r*0.65,r*0.16,r*1.3);
    }
    fctx.restore();
  };

  // ── DRAW BROWSER TAB ─────────────────────────────────────────────────────
  const TAB_W = 122, TAB_H = 33;

  const drawTabBody = (tab, alpha) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(tab.x, tab.y);
    ctx.rotate(tab.angle);
    ctx.shadowBlur = 12; ctx.shadowColor = 'rgba(0,242,254,0.22)';
    ctx.fillStyle   = 'rgba(22,23,30,0.93)';
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(-TAB_W/2,-TAB_H/2,TAB_W,TAB_H,6); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    drawFavicon(ctx, -TAB_W/2+16, 0, 7.5, tab.brand);
    ctx.fillStyle = 'rgba(255,255,255,0.84)';
    ctx.font = '500 11px -apple-system,"Inter","Segoe UI",sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(tab.label, -TAB_W/2+30, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath(); ctx.arc(TAB_W/2-9,-TAB_H/2+8,3.5,0,Math.PI*2); ctx.fill();
    ctx.restore();
  };

  const drawTabGhost = (tab, intensity) => {
    if (intensity <= 0) return;
    for (let i = 1; i <= 4; i++) {
      const f = i / 4;
      ctx.save();
      ctx.globalAlpha = (1-f)*0.14*intensity;
      ctx.translate(tab.x - Math.cos(tab.angle)*i*14, tab.y - Math.sin(tab.angle)*i*14);
      ctx.rotate(tab.angle);
      ctx.fillStyle = 'rgba(0,242,254,0.18)';
      ctx.beginPath(); ctx.roundRect(-TAB_W/2,-TAB_H/2,TAB_W,TAB_H,6); ctx.fill();
      ctx.restore();
    }
  };

  // ── TAB DEFINITIONS ─────────────────────────────────────────────────────
  const TAB_DEFS = [
    { brand:'youtube', label:'YouTube' },
    { brand:'github',  label:'GitHub'  },
    { brand:'spotify', label:'Spotify' },
    { brand:'google',  label:'Google'  },
    { brand:'reddit',  label:'Reddit'  },
    { brand:'figma',   label:'Figma'   }
  ];

  const spawnEdge = () => {
    const cw=canvas.width, ch=canvas.height;
    const e=Math.floor(Math.random()*4);
    if(e===0) return {x:Math.random()*cw,y:-70};
    if(e===1) return {x:cw+70,y:Math.random()*ch};
    if(e===2) return {x:Math.random()*cw,y:ch+70};
    return {x:-70,y:Math.random()*ch};
  };

  const tabObjects = TAB_DEFS.map((def,i) => {
    const pos = spawnEdge();
    return {
      ...def,
      x:pos.x, y:pos.y, startX:pos.x, startY:pos.y,
      angle:0,
      state:'waiting',
      delayFrames: i * 34,
      frameCount: 0,
      isLeft: (i % 2 === 0),
      approachProgress: 0,
      approachSpeed: 0.015 + Math.random()*0.010,
      orbitAngle: Math.random()*Math.PI*2,
      orbitSpeed: (0.036+Math.random()*0.012) * (i%2===0?1:-1),
      orbitStartAngle: 0,
      orbitTraversed: 0,
      orbitRadius: 52 + Math.random()*22,
      discardProgress: 0,
      discardSpeed: 0.022 + Math.random()*0.010,
      discardStartX:0, discardStartY:0,
      scale:1.0
    };
  });

  let animationId;
  let frameCounter = 0;
  let hoverPhase   = 0;

  const animate = () => {
    frameCounter++;
    hoverPhase += 0.024;
    const hoverY = Math.sin(hoverPhase) * 5;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Motion-blur smear
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle   = 'rgba(4,5,8,0.11)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // Ambient aura behind mage
    ctx.save();
    const aura=ctx.createRadialGradient(cx,cy+hoverY,8,cx,cy+hoverY,200);
    aura.addColorStop(0,'rgba(0,242,254,0.05)');
    aura.addColorStop(0.5,'rgba(100,50,255,0.025)');
    aura.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=aura; ctx.beginPath(); ctx.arc(cx,cy+hoverY,200,0,Math.PI*2); ctx.fill();
    ctx.restore();

    drawMage(cx, cy, hoverY);

    // Palm world positions
    const lPX=cx-114, lPY=cy+hoverY-5;
    const rPX=cx+114, rPY=cy+hoverY-5;

    let allDone = true;

    tabObjects.forEach(tab => {
      if (tab.state === 'done') return;
      allDone = false;
      tab.frameCount++;

      // WAITING
      if (tab.state === 'waiting') {
        if (tab.frameCount >= tab.delayFrames) {
          tab.state = 'approach';
          const pos = spawnEdge();
          tab.x=pos.x; tab.y=pos.y; tab.startX=pos.x; tab.startY=pos.y;
        }
        return;
      }

      const palmX = tab.isLeft ? lPX : rPX;
      const palmY = tab.isLeft ? lPY : rPY;

      // APPROACH
      if (tab.state === 'approach') {
        tab.approachProgress = Math.min(1, tab.approachProgress + tab.approachSpeed);
        const t = 1 - Math.pow(1 - tab.approachProgress, 3); // ease-out cubic
        const targetX = palmX + Math.cos(tab.orbitAngle)*tab.orbitRadius;
        const targetY = palmY + Math.sin(tab.orbitAngle)*tab.orbitRadius;
        const prevX=tab.x, prevY=tab.y;
        tab.x = tab.startX + (targetX-tab.startX)*t;
        tab.y = tab.startY + (targetY-tab.startY)*t;
        const dx=tab.x-prevX, dy=tab.y-prevY;
        if(Math.hypot(dx,dy)>0.3) tab.angle=Math.atan2(dy,dx);
        if(tab.approachProgress>=1){
          tab.state='orbit'; tab.orbitStartAngle=tab.orbitAngle; tab.orbitTraversed=0;
        }
        drawTabGhost(tab, Math.min(1,tab.approachProgress*2.5));
        drawTabBody(tab, 1.0);
        return;
      }

      // ORBIT
      if (tab.state === 'orbit') {
        tab.orbitAngle    += tab.orbitSpeed;
        tab.orbitTraversed+= Math.abs(tab.orbitSpeed);
        tab.x = palmX + Math.cos(tab.orbitAngle)*tab.orbitRadius;
        tab.y = palmY + Math.sin(tab.orbitAngle)*tab.orbitRadius;
        // Tangent: always facing forward along orbit
        tab.angle = tab.orbitAngle + (tab.orbitSpeed>0 ? Math.PI/2 : -Math.PI/2);
        if(tab.orbitTraversed>=Math.PI*2){
          tab.state='discard';
          tab.discardStartX=tab.x; tab.discardStartY=tab.y;
          tab.discardProgress=0; tab.scale=1.0;
        }
        drawTabGhost(tab,1.0); drawTabBody(tab,1.0);
        return;
      }

      // DISCARD
      if (tab.state === 'discard') {
        tab.discardProgress = Math.min(1, tab.discardProgress + tab.discardSpeed);
        const t = Math.pow(tab.discardProgress, 1.8); // ease-in
        const tr = btnClearCache.getBoundingClientRect();
        const trashX = tr.left + tr.width/2;
        const trashY = tr.top  + tr.height/2;
        const prevX=tab.x, prevY=tab.y;
        tab.x = tab.discardStartX + (trashX-tab.discardStartX)*t;
        tab.y = tab.discardStartY + (trashY-tab.discardStartY)*t;
        const dx=tab.x-prevX, dy=tab.y-prevY;
        if(Math.hypot(dx,dy)>0.3) tab.angle=Math.atan2(dy,dx);
        // Depth-illusion: shrink 1.0 → 0.08
        tab.scale = 1.0 - tab.discardProgress*0.92;
        if(tab.discardProgress>=1){
          tab.state='done';
          btnClearCache.style.transition='transform 0.07s ease';
          btnClearCache.style.transform='scale(1.22)';
          setTimeout(()=>{ btnClearCache.style.transform=''; },100);
        }
        ctx.save();
        ctx.translate(tab.x,tab.y); ctx.scale(tab.scale,tab.scale); ctx.translate(-tab.x,-tab.y);
        drawTabGhost(tab, Math.max(0,1-tab.discardProgress*1.5));
        drawTabBody(tab, 1.0-tab.discardProgress*0.5);
        ctx.restore();
        return;
      }
    });

    if(allDone && tabObjects.length>0 && frameCounter>10){
      triggerTrashFinisher();
      return;
    }
    animationId = requestAnimationFrame(animate);
  };

  const triggerTrashFinisher = () => {
    cancelAnimationFrame(animationId);
    window.removeEventListener('resize', resizeCanvas);

    // Big trash-bin impact bounce
    btnClearCache.style.transition='transform 0.15s cubic-bezier(0.175,0.885,0.32,1.275)';
    btnClearCache.style.transform='scale(1.4) translateY(-8px)';

    // Actual cache purge
    const wv = getActiveWebview();
    if(wv){ try{ wv.clearHistory(); } catch(e){ console.error(e); } }

    // Sidebar shake
    if(sidebar){
      const shakes=['-5px','5px','-4px','4px','-2px','0px'];
      sidebar.style.transition='transform 0.06s ease';
      shakes.reduce((p,v)=>p.then(()=>new Promise(r=>{
        sidebar.style.transform=`translateX(${v})`; setTimeout(r,55);
      })),Promise.resolve()).then(()=>{
        sidebar.style.transform=''; sidebar.style.transition='';
      });
    }

    // White flash
    const flash=document.createElement('div');
    flash.style.cssText=`
      position:fixed;top:0;left:0;width:100vw;height:100vh;
      background:#fff;z-index:9999999;pointer-events:none;
      opacity:0.82;transition:opacity 0.4s cubic-bezier(0.16,1,0.3,1);
    `;
    document.body.appendChild(flash);
    overlay.remove();
    requestAnimationFrame(()=>{
      flash.style.opacity='0';
      setTimeout(()=>{ flash.remove(); showToast('🧹 Кэш пен тарих сәтті тазартылды!'); },420);
    });

    setTimeout(()=>{
      btnClearCache.style.transform='scale(0.9) translateY(2px)';
      setTimeout(()=>{ btnClearCache.style.transform=''; btnClearCache.style.transition=''; },140);
    },140);
  };

  animate();
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

// ── Galamtor State Sync & Dynamic Refresh ──
const galamtorShortcuts = [
  {
    url: 'https://kaspi.kz',
    label: 'Kaspi.kz',
    desc: 'Төлемдер, аударымдар',
    iconHTML: '<div class="sc-icon kaspi-bg">K</div>'
  },
  {
    url: 'https://youtube.com',
    label: 'YouTube',
    desc: 'Бейнероликтер',
    iconHTML: `<div class="sc-icon youtube-bg"><svg viewBox="0 0 24 24" width="20" height="20" fill="white"><path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.107C19.522 3.5 12 3.5 12 3.5s-7.522 0-9.388.556a3.003 3.003 0 0 0-2.11 2.107C0 8.029 0 12 0 12s0 3.971.502 5.837a3.003 3.003 0 0 0 2.11 2.107C4.478 20.5 12 20.5 12 20.5s7.522 0 9.388-.556a3.003 3.003 0 0 0 2.11-2.107C24 15.971 24 12 24 12s0-3.971-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></div>`
  },
  {
    url: 'https://kinopoisk.ru',
    label: 'Кинопоиск',
    desc: 'Фильмдер, сериалдар',
    iconHTML: '<div class="sc-icon kino-bg">К</div>'
  },
  {
    url: 'https://egov.kz',
    label: 'egov.kz',
    desc: 'Мемлекеттік қызметтер',
    iconHTML: `<div class="sc-icon egov-bg"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>`
  }
];

// Initialize localStorage if empty
if (!localStorage.getItem('galamtor_shortcuts')) {
  localStorage.setItem('galamtor_shortcuts', JSON.stringify(galamtorShortcuts));
}

function loadShortcuts() {
  const saved = localStorage.getItem('galamtor_shortcuts');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }
  return galamtorShortcuts;
}

function refreshGalamtorState() {
  // 1. Reset inputs & search states
  if (welcomeSearchInput) {
    welcomeSearchInput.value = '';
    welcomeSearchInput.blur();
  }
  if (welcomeSearchBox) {
    welcomeSearchBox.classList.remove('lens-drag-over');
    welcomeSearchBox.blur();
  }
  if (urlInput) {
    urlInput.blur();
  }

  // 2. Remove shortcuts grid entirely for absolute clean canvas look
  const shortcutsGrid = document.querySelector('.shortcuts-grid');
  if (shortcutsGrid) {
    shortcutsGrid.remove();
  }

  // 3. Matrix Scramble Reveal Effect
  const logoEl = document.querySelector('.welcome-logo');
  if (logoEl) {
    scrambleLogoText(logoEl, 'Galamtor');
  }
}

function scrambleLogoText(element, targetText = 'Galamtor') {
  if (!element) return;
  
  if (element.scrambleInterval) {
    clearInterval(element.scrambleInterval);
  }
  
  const len = targetText.length;
  
  // Precalculate independent random unlock times (in ms) for each letter position
  // to model an organic combination-lock mechanism
  const unlockTimes = [];
  for (let i = 0; i < len; i++) {
    unlockTimes.push(1000 + Math.random() * 4500); // organic lock duration from 1.0s to 5.5s
  }
  
  // Guarantee that at least one random column takes between 6.0s and 6.8s to lock
  const finalIndex = Math.floor(Math.random() * len);
  unlockTimes[finalIndex] = 6000 + Math.random() * 800;
  
  const startTime = Date.now();
  const intervalTime = 250; // 250ms slow, heavy updates
  
  // Set initial state to full binary scramble immediately to prevent any flicker of clear text
  let initialBinary = '';
  for (let i = 0; i < len; i++) {
    initialBinary += Math.random() > 0.5 ? '1' : '0';
  }
  element.textContent = initialBinary;
  
  element.scrambleInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    let output = '';
    let allLocked = true;
    
    for (let i = 0; i < len; i++) {
      if (elapsed >= unlockTimes[i]) {
        // Locked into final character
        if (targetText[i] === 't') {
          output += '<span class="logo-t">t</span>';
        } else {
          output += targetText[i];
        }
      } else {
        // Still spinning in binary
        output += Math.random() > 0.5 ? '1' : '0';
        allLocked = false;
      }
    }
    
    element.innerHTML = output;
    
    if (allLocked) {
      clearInterval(element.scrambleInterval);
      element.scrambleInterval = null;
    }
  }, intervalTime);
}

// ── Sidebar Pinned Shortcuts Cleanup ──
function cleanupSidebarElements() {
  // Only remove default pinned web shortcut icons (Kaspi, YouTube, Kinopoisk, eGov)
  if (dockIcons) {
    dockIcons.querySelectorAll('.dock-btn[data-url]').forEach(btn => btn.remove());
  }
}

// ════════════════════════════════════════
//  INIT
// ════════════════════════════════════════
cleanupSidebarElements();
createTab();
initSidebarMediaPlayer(); // Restored and kept fully active!
injectPremiumNewTabStyles();

// ── Inject Premium New Tab Redesign Styles ──
function injectPremiumNewTabStyles() {
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700&family=Inter:wght@400;500;600&display=swap');

    .welcome-logo {
      font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 3rem !important;
      font-weight: 700 !important;
      letter-spacing: -1px !important;
      background: linear-gradient(135deg, #ffffff 40%, #a3a3c2 100%) !important;
      -webkit-background-clip: text !important;
      -webkit-text-fill-color: transparent !important;
      background-clip: text !important;
      text-shadow: none !important;
      margin-bottom: 28px !important;
      opacity: 0.95;
    }

    .welcome-logo .logo-t {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-weight: 700 !important;
      display: inline-block !important;
      letter-spacing: -1px !important;
    }

    .welcome-search-box {
      background: rgba(9, 10, 15, 0.6) !important;
      backdrop-filter: blur(24px) saturate(120%) !important;
      -webkit-backdrop-filter: blur(24px) saturate(120%) !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-radius: 14px !important;
      padding: 6px 6px 6px 16px !important;
      gap: 12px !important;
      transition: border-color 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }

    .welcome-search-box:focus-within {
      background: rgba(9, 10, 15, 0.8) !important;
      border-color: rgba(255, 255, 255, 0.18) !important;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.08) !important;
    }

    #welcome-search-input {
      font-family: 'Inter', -apple-system, sans-serif !important;
      font-size: 14px !important;
      color: #ffffff !important;
    }

    #welcome-search-input::placeholder {
      color: rgba(255, 255, 255, 0.35) !important;
    }

    .search-icon-svg {
      color: rgba(255, 255, 255, 0.4) !important;
    }

    .welcome-search-box:focus-within .search-icon-svg {
      color: rgba(255, 255, 255, 0.7) !important;
    }

    .search-submit-btn {
      height: 36px !important;
      padding: 0 18px !important;
      background: rgba(255, 255, 255, 0.08) !important;
      color: rgba(255, 255, 255, 0.9) !important;
      border: 1px solid rgba(255, 255, 255, 0.04) !important;
      border-radius: 10px !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      transition: all 0.2s ease !important;
    }

    .search-submit-btn:hover {
      background: rgba(255, 255, 255, 0.15) !important;
      color: #ffffff !important;
      border-color: rgba(255, 255, 255, 0.1) !important;
    }

    .search-submit-btn:active {
      transform: scale(0.97) !important;
    }

    .welcome-search-form {
      margin-bottom: 0 !important;
    }

    .shortcuts-grid {
      display: none !important;
    }

    .shortcut-card {
      background: rgba(14, 16, 22, 0.45) !important;
      backdrop-filter: blur(24px) saturate(120%) !important;
      -webkit-backdrop-filter: blur(24px) saturate(120%) !important;
      border: 1px solid rgba(255, 255, 255, 0.03) !important;
      border-radius: 16px !important;
      padding: 24px 16px 20px !important;
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.3s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }

    .shortcut-card:hover {
      transform: translateY(-4px) !important;
      border-color: rgba(255, 255, 255, 0.08) !important;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6) !important;
      background: rgba(20, 22, 30, 0.65) !important;
    }

    .shortcut-card:active {
      transform: translateY(-1px) scale(0.98) !important;
    }

    .shortcut-card .sc-icon {
      width: 48px !important;
      height: 48px !important;
      border-radius: 12px !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25) !important;
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
      margin-bottom: 12px !important;
    }

    .shortcut-card:hover .sc-icon {
      transform: scale(1.06) !important;
    }

    .shortcut-card .kaspi-bg {
      background: linear-gradient(135deg, #e33e3d, #ff5e5d) !important;
    }

    .shortcut-card .egov-bg {
      background: linear-gradient(135deg, #0096c7, #005f73) !important;
    }

    .shortcut-card .youtube-bg {
      background: linear-gradient(135deg, #e63946, #b70919) !important;
    }

    .shortcut-card .kino-bg {
      background: linear-gradient(135deg, #f77f00, #fcbf49) !important;
    }

    .shortcut-card .sc-label {
      font-family: 'Inter', -apple-system, sans-serif !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      color: rgba(255, 255, 255, 0.9) !important;
      margin-bottom: 4px !important;
    }

    .shortcut-card .sc-desc {
      font-family: 'Inter', -apple-system, sans-serif !important;
      font-size: 11px !important;
      color: rgba(255, 255, 255, 0.4) !important;
      line-height: 1.4 !important;
    }
  `;
  document.head.appendChild(styleEl);
}

// ── Settings Button Centering Hotfix ──
const settingsGlowStyle = document.createElement('style');
settingsGlowStyle.textContent = `
  .dock-bottom .dock-btn,
  #btn-clear-cache {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 0 !important;
    margin: 0 !important;
    position: relative !important;
    line-height: 1 !important;
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
  }

  .dock-bottom .dock-badge,
  #btn-clear-cache .dock-badge {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    margin: 0 !important;
    padding: 0 !important;
    position: static !important;
    line-height: 1 !important;
    transform: translateY(-2px) !important;
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
  }

  /* Reset any child element inside the badge to prevent font baseline offset issues */
  .dock-bottom .dock-badge *,
  #btn-clear-cache .dock-badge * {
    margin: 0 !important;
    padding: 0 !important;
    position: static !important;
    line-height: 1 !important;
  }

  /* Re-enable media player container to be always visible in the dock */
  #sidebar-media-player {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }

  .media-player-badge {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    background: transparent;
    border: none !important;
    box-shadow: none !important;
    width: 26px !important;
    height: 26px !important;
    border-radius: 50% !important;
    overflow: hidden !important;
  }

  /* Active state transitions: show visualizer waves, hide static music note */
  .media-player-active .media-equalizer {
    display: flex !important;
  }
  .media-player-active .media-static-icon {
    display: none !important;
  }

  /* Inactive state transitions: hide visualizer waves, show static music note */
  .media-player-badge:not(.media-player-active) .media-equalizer {
    display: none !important;
  }
  .media-player-badge:not(.media-player-active) .media-static-icon {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }

  /* Completely remove/hide legacy blue pause/media overlay */
  .media-player-overlay {
    display: none !important;
  }

  /* Stealth Native Matte-Glass Toast Notifications */
  .toast-notification {
    background: rgba(20, 20, 25, 0.85) !important;
    backdrop-filter: blur(20px) !important;
    -webkit-backdrop-filter: blur(20px) !important;
    border: 1px solid rgba(255, 255, 255, 0.05) !important;
    border-radius: 10px !important;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6) !important;
    padding: 10px 22px !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    color: #ffffff !important;
    display: inline-block !important;
  }
`;
document.head.appendChild(settingsGlowStyle);

// ════════════════════════════════════════════════════════════════════
//  GALAMTOR PROFILE & SETTINGS HUB — ULTRA-PREMIUM CYBERPUNK EDITION
//  Vibe Profiles · Secure Lock · Export/Import
//  All UI dynamically injected — zero changes to index.html/style.css
// ════════════════════════════════════════════════════════════════════

// ── 1. CSS INJECTION ─────────────────────────────────────────────
(function injectProfileHubStyles() {
  const s = document.createElement('style');
  s.id = 'galamtor-profile-hub-css';
  s.textContent = `
    /* ── Overlay & Modal ────────────────────────── */
    .gp-overlay {
      position: fixed; inset: 0; z-index: 900000;
      background: rgba(4, 5, 8, 0.25) !important;
      backdrop-filter: blur(8px) !important; -webkit-backdrop-filter: blur(8px) !important;
      display: flex; align-items: center; justify-content: flex-start;
      opacity: 0; pointer-events: none;
      transition: opacity 0.4s cubic-bezier(0.16,1,0.3,1);
    }
    .gp-overlay.gp-visible { opacity: 1; pointer-events: auto; }
    .gp-modal {
      position: fixed; top: 0; left: 80px; width: 420px; height: 100vh !important; max-height: 100vh !important;
      background: rgba(10, 11, 16, 0.5) !important;
      backdrop-filter: blur(60px) saturate(180%) !important; -webkit-backdrop-filter: blur(60px) saturate(180%) !important;
      border: none !important;
      border-right: 1px solid rgba(255, 255, 255, 0.06) !important;
      border-radius: 0 !important;
      box-shadow: 20px 0 80px rgba(0, 0, 0, 0.7) !important;
      display: flex; flex-direction: column;
      transform: translateX(-100%);
      transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .gp-overlay.gp-visible .gp-modal { transform: translateX(0); }

    /* ── Header ─────────────────────────────────── */
    .gp-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 24px 24px 0; flex-shrink: 0;
    }
    .gp-title {
      font-size: 16px; font-weight: 700; color: #fff;
      letter-spacing: -0.3px; margin: 0;
      background: linear-gradient(135deg, #ffffff 40%, #a3a3c2 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .gp-close {
      width: 28px; height: 28px; border-radius: 50%;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.4); font-size: 16px;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease;
    }
    .gp-close:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.12); color: #fff; transform: rotate(90deg); }

    /* ── Floating Pill Navigation Tabs ──────────── */
    .gp-tabs {
      display: flex; gap: 8px; padding: 18px 24px 10px;
      border-bottom: none;
      flex-shrink: 0;
    }
    .gp-tab-btn {
      flex: 1; padding: 8px 0; border: 1px solid transparent; background: transparent;
      border-radius: 20px !important;
      color: rgba(255,255,255,0.4); font-size: 11px; font-weight: 600;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.16,1,0.3,1); display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 4px; font-family: inherit;
      letter-spacing: 0.5px; text-transform: uppercase;
    }
    .gp-tab-btn:hover { color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.02); }
    .gp-tab-btn.active {
      color: #fff !important;
      background: rgba(255, 255, 255, 0.08) !important;
      border-color: rgba(255, 255, 255, 0.06) !important;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15) !important;
      text-shadow: none !important;
    }
    .gp-tab-btn svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.8; transition: transform 0.2s ease; }

    /* ── Body & Panels ──────────────────────────── */
    .gp-body { flex: 1; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; padding: 10px 24px 24px; }
    .gp-body::-webkit-scrollbar { width: 4px; }
    .gp-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 4px; }
    .gp-panel { display: none; animation: gpFadePanel 0.28s ease-out; height: 100%; width: 100%; box-sizing: border-box; }
    .gp-panel.active { display: flex; flex-direction: column; flex: 1; height: 100%; overflow-y: auto; overflow-x: hidden; }
    @keyframes gpFadePanel { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

    /* ── Profile Tab ────────────────────────────── */
    .gp-avatar-section { display: flex; flex-direction: column; align-items: center; margin-bottom: 24px; }
    .gp-avatar {
      width: 76px; height: 76px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 30px; font-weight: 800; color: #fff;
      letter-spacing: -1px; margin-bottom: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5), inset 0 0 16px rgba(255,255,255,0.1);
      transition: transform 0.3s cubic-bezier(0.16,1,0.3,1);
      border: 1px solid rgba(255,255,255,0.15);
    }
    .gp-avatar:hover { transform: scale(1.08) rotate(3deg); }
    .gp-color-row { display: flex; gap: 8px; margin-bottom: 6px; }
    .gp-color-swatch {
      width: 24px; height: 24px; border-radius: 50%; cursor: pointer;
      border: 2px solid transparent; transition: all 0.2s cubic-bezier(0.16,1,0.3,1);
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .gp-color-swatch:hover { transform: scale(1.2); }
    .gp-color-swatch.active { border-color: #fff; box-shadow: 0 0 0 3px rgba(255,255,255,0.15), 0 2px 10px rgba(0,0,0,0.4); }

    .gp-field { margin-bottom: 20px; }
    .gp-label { font-size: 9px; font-weight: 700; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 8px; display: block; }
    .gp-input {
      width: 100%; padding: 11px 15px; border-radius: 14px !important;
      background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.05);
      color: #fff; font-size: 14px; font-family: inherit; outline: none;
      transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
      box-sizing: border-box;
    }
    .gp-input:focus {
      background: rgba(255,255,255,0.06);
      border-color: rgba(255,255,255,0.12) !important;
      box-shadow: none !important;
    }
    .gp-input::placeholder { color: rgba(255,255,255,0.18); }

    .gp-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 8px; }
    .gp-stat {
      background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.03);
      border-radius: 16px !important; padding: 14px 8px; text-align: center;
      transition: all 0.2s ease;
    }
    .gp-stat:hover { background: rgba(255,255,255,0.035); border-color: rgba(255,255,255,0.06); }
    .gp-stat-val { font-size: 24px; font-weight: 800; color: #fff; line-height: 1.1; }
    .gp-stat-label { font-size: 9px; color: rgba(255,255,255,0.3); margin-top: 5px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }

    /* ── Vibe Cards ──────────────────────────────── */
    .gp-vibes-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .gp-vibes-header h3 { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.7); margin: 0; }
    .gp-vibe-card {
      background: transparent !important;
      border: none !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04) !important;
      border-radius: 0 !important;
      padding: 14px 4px !important;
      margin-bottom: 0 !important;
      display: flex; align-items: center; gap: 14px;
      transition: all 0.25s cubic-bezier(0.16,1,0.3,1); position: relative;
      cursor: pointer;
    }
    .gp-vibe-card:hover {
      background: var(--vibe-hover-bg, rgba(255,255,255,0.02)) !important;
      padding-left: 12px !important;
      padding-right: 12px !important;
    }
    .gp-vibe-info { flex: 1; min-width: 0; text-align: left; }
    .gp-vibe-name { font-size: 13px; font-weight: 600; color: #fff; margin-bottom: 2px; }
    .gp-vibe-meta { font-size: 11px; color: rgba(255,255,255,0.35); }
    .gp-vibe-actions {
      display: flex; gap: 14px; align-items: center; flex-shrink: 0; z-index: 5;
    }
    .gp-vibe-apply-btn {
      background: transparent !important; border: none !important;
      color: var(--vibe-accent, #fff) !important; padding: 0 !important;
      font-size: 11px; font-weight: 600; cursor: pointer;
      text-transform: uppercase; letter-spacing: 0.5px;
      opacity: 0; transition: opacity 0.2s ease;
    }
    .gp-vibe-card:hover .gp-vibe-apply-btn { opacity: 1; }
    .gp-vibe-apply-btn:hover { text-decoration: underline; }
    .gp-vibe-delete-btn {
      background: transparent !important; border: none !important;
      color: rgba(255,255,255,0.3) !important; padding: 0 !important;
      font-size: 14px; cursor: pointer;
      opacity: 0; transition: opacity 0.2s ease;
    }
    .gp-vibe-card:hover .gp-vibe-delete-btn { opacity: 1; }
    .gp-vibe-delete-btn:hover { color: #ff416c !important; }
    .gp-vibe-active-label {
      font-size: 9px; font-weight: 700; color: var(--vibe-accent, #fff);
      letter-spacing: 0.8px; text-transform: uppercase;
      opacity: 1;
    }

    /* ── Sleek Cyber Buttons ────────────────────── */
    .gp-btn {
      padding: 7px 15px; border-radius: 10px; border: 1px solid transparent;
      font-size: 11px; font-weight: 600; cursor: pointer;
      font-family: inherit; transition: all 0.2s cubic-bezier(0.16,1,0.3,1);
    }
    .gp-btn-primary {
      background: rgba(255,255,255,0.08) !important; border-color: rgba(255,255,255,0.06) !important; color: #fff !important;
    }
    .gp-btn-primary:hover {
      background: rgba(255,255,255,0.12) !important; border-color: rgba(255,255,255,0.1) !important;
      box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    }
    .gp-btn-danger {
      background: rgba(255,65,108,0.08) !important; border-color: rgba(255,65,108,0.12) !important; color: #ff416c !important;
    }
    .gp-btn-danger:hover {
      background: rgba(255,65,108,0.16) !important; border-color: rgba(255,65,108,0.25) !important;
    }
    .gp-btn-ghost {
      background: rgba(255,255,255,0.03) !important; border-color: rgba(255,255,255,0.05) !important; color: rgba(255,255,255,0.5) !important;
    }
    .gp-btn-ghost:hover {
      background: rgba(255,255,255,0.08) !important; border-color: rgba(255,255,255,0.12) !important; color: #fff !important;
    }
    .gp-btn-lg { padding: 11px 20px; font-size: 13px; border-radius: 12px; width: 100%; }
    .gp-btn-lg:active { transform: scale(0.975); }

    /* ── Create Vibe Form ───────────────────────── */
    .gp-create-form {
      background: rgba(255,255,255,0.015); border: 1px dashed rgba(255,255,255,0.07);
      border-radius: 16px; padding: 18px; margin-top: 14px;
      display: none;
    }
    .gp-create-form.open { display: block; animation: gpFadePanel 0.25s ease; }
    .gp-create-title { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.8px; }
    .gp-emoji-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
    .gp-emoji-btn {
      width: 36px; height: 36px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05);
      background: rgba(255,255,255,0.02); font-size: 18px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s cubic-bezier(0.16,1,0.3,1);
    }
    .gp-emoji-btn:hover { background: rgba(255,255,255,0.08); transform: scale(1.12); }
    .gp-emoji-btn.active { border-color: rgba(255,255,255,0.3); background: rgba(255,255,255,0.08); }

    /* ── Lock / PIN Pad ─────────────────────────── */
    .gp-lock-row {
      display: flex; align-items: center; justify-content: space-between;
      background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.03);
      border-radius: 14px !important; padding: 14px 18px; margin-bottom: 16px;
    }
    .gp-lock-label { font-size: 13px; font-weight: 600; color: #fff; display: flex; align-items: center; gap: 8px; }
    .gp-toggle {
      width: 46px; height: 24px; border-radius: 12px; border: none;
      background: rgba(255,255,255,0.08); cursor: pointer;
      position: relative; transition: background 0.25s ease; padding: 0;
    }
    .gp-toggle::after {
      content: ''; position: absolute; top: 3px; left: 3px;
      width: 18px; height: 18px; border-radius: 50%;
      background: #fff; transition: transform 0.25s cubic-bezier(0.16,1,0.3,1);
      box-shadow: 0 1px 4px rgba(0,0,0,0.35);
    }
    .gp-toggle.on { background: rgba(255,255,255,0.22); }
    .gp-toggle.on::after { transform: translateX(22px); }

    .gp-pin-section { text-align: center; padding: 10px 0; }
    .gp-pin-label { font-size: 12px; color: rgba(255,255,255,0.35); margin-bottom: 18px; }
    .gp-pin-dots { display: flex; gap: 14px; justify-content: center; margin-bottom: 24px; }
    .gp-pin-dot {
      width: 12px; height: 12px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.15); background: transparent;
      transition: all 0.25s cubic-bezier(0.16,1,0.3,1);
    }
    .gp-pin-dot.filled { background: #fff !important; border-color: #fff !important; box-shadow: 0 0 12px rgba(255,255,255,0.5); transform: scale(1.2); }
    .gp-pin-dot.error { border-color: #ff416c; background: #ff416c; box-shadow: 0 0 12px rgba(255,65,108,0.6); }

    /* ── Transparent Round Numpad keys ─────────── */
    .gp-pin-pad {
      display: grid; grid-template-columns: repeat(3,1fr); gap: 14px;
      max-width: 240px; margin: 0 auto;
    }
    .gp-pin-key {
      width: 58px; height: 58px; border-radius: 50%;
      background: transparent !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      color: #fff; font-size: 22px; font-weight: 500; font-family: inherit;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: all 0.2s cubic-bezier(0.16,1,0.3,1); margin: 0 auto;
      box-shadow: none !important;
    }
    .gp-pin-key:hover {
      background: rgba(255, 255, 255, 0.04) !important;
      border-color: rgba(255, 255, 255, 0.2) !important;
      transform: scale(1.08);
      box-shadow: none !important;
    }
    .gp-pin-key:active {
      transform: scale(0.92);
      background: rgba(255, 255, 255, 0.08) !important;
      border-color: rgba(255, 255, 255, 0.3) !important;
      transition: all 0.05s ease;
    }
    .gp-pin-key.fn {
      font-size: 16px;
      color: rgba(255, 255, 255, 0.5);
      border-color: rgba(255, 255, 255, 0.04) !important;
    }
    .gp-pin-key.fn:hover {
      border-color: rgba(255, 255, 255, 0.15) !important;
      box-shadow: none !important;
    }
    .gp-pin-error { font-size: 12px; color: #ff416c; margin-top: 14px; min-height: 18px; font-weight: 500; }

    @keyframes gpShake {
      0%,100% { transform: translateX(0); }
      20% { transform: translateX(-10px); }
      40% { transform: translateX(10px); }
      60% { transform: translateX(-6px); }
      80% { transform: translateX(6px); }
    }
    .gp-shake { animation: gpShake 0.4s ease; }

    .gp-pin-status { font-size: 12px; color: rgba(255,255,255,0.35); margin-bottom: 16px; padding: 11px; background: rgba(255,255,255,0.015); border-radius: 12px; border: 1px solid rgba(255,255,255,0.03); }
    .gp-pin-status em { color: #fff; font-style: normal; font-weight: 600; }

    .gp-lock-now-btn { margin-top: 12px; }

    /* ── Private Items ──────────────────────────── */
    .gp-private-section { margin-top: 22px; }
    .gp-private-item {
      display: flex; align-items: center; gap: 10px; padding: 9px 12px;
      background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.03);
      border-radius: 10px; margin-bottom: 6px;
      transition: all 0.15s ease;
    }
    .gp-private-item:hover { background: rgba(255,255,255,0.035); border-color: rgba(255,255,255,0.06); }
    .gp-private-item label { flex: 1; font-size: 12px; color: rgba(255,255,255,0.6); cursor: pointer; }
    .gp-private-cb {
      appearance: none; width: 16px; height: 16px; border-radius: 5px;
      border: 1.5px solid rgba(255,255,255,0.18); background: transparent;
      cursor: pointer; position: relative; transition: all 0.15s ease; flex-shrink: 0;
    }
    .gp-private-cb:checked { background: #fff; border-color: #fff; }
    .gp-private-cb:checked::after {
      content: '✓'; position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; color: #000; font-weight: 800;
    }

    /* ── Data / Export Cards ────────────────────── */
    .gp-export-card {
      background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.03);
      border-radius: 14px !important; padding: 18px; margin-bottom: 14px;
      display: flex; flex-direction: column; gap: 16px;
    }
    .gp-export-row {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
    }
    .gp-export-title {
      font-size: 13px; font-weight: 600; color: #fff;
    }

    /* ── Apple-style Download Toast ────────────── */
    .gp-download-toast {
      position: fixed; bottom: 24px; right: 24px; z-index: 999999;
      width: 320px; padding: 16px;
      background: rgba(10, 11, 16, 0.45) !important;
      backdrop-filter: blur(80px) saturate(200%) !important; -webkit-backdrop-filter: blur(80px) saturate(200%) !important;
      border: 1px solid rgba(255, 255, 255, 0.06) !important;
      border-radius: 14px !important;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4) !important;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      transform: translateY(100px) scale(0.9); opacity: 0;
      transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      box-sizing: border-box; pointer-events: none;
    }
    .gp-download-toast.gp-toast-show {
      transform: translateY(0) scale(1); opacity: 1;
    }
    .gp-toast-title {
      font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 4px;
      text-align: left;
    }
    .gp-toast-subtext {
      font-size: 11px; color: rgba(255, 255, 255, 0.45); line-height: 1.4;
      text-align: left;
    }

    /* ── Lock Badge on G Logo ───────────────────── */
    .gp-lock-badge {
      position: absolute !important; bottom: -2px; right: -4px;
      font-size: 8px !important; line-height: 1 !important;
      background: rgba(12,13,18,0.95) !important; border-radius: 4px !important;
      padding: 1px 2px !important; pointer-events: none !important;
      z-index: 3 !important;
    }

    /* ── PIN Gate (fullscreen unlock) ──────────── */
    .gp-pin-gate {
      position: fixed; inset: 0; z-index: 910000;
      background: rgba(4, 5, 8, 0.4) !important;
      backdrop-filter: blur(25px) !important; -webkit-backdrop-filter: blur(25px) !important;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; pointer-events: none;
      transition: opacity 0.3s cubic-bezier(0.16,1,0.3,1);
    }
    .gp-pin-gate.gp-visible { opacity: 1; pointer-events: auto; }
    .gp-pin-gate-card {
      text-align: center; max-width: 320px; width: 100%;
      transform: scale(0.94); transition: transform 0.35s cubic-bezier(0.16,1,0.3,1);
    }
    .gp-pin-gate.gp-visible .gp-pin-gate-card { transform: scale(1); }
    .gp-pin-gate-icon { font-size: 40px; margin-bottom: 16px; }
    .gp-pin-gate h3 { font-size: 16px; font-weight: 600; color: #fff; margin: 0 0 6px; font-family: 'Inter',sans-serif; }
    .gp-pin-gate .gp-pin-subtitle { font-size: 12px; color: rgba(255,255,255,0.3); margin-bottom: 24px; }
    .gp-pin-gate .gp-pin-cancel { margin-top: 20px; }

    /* ── Confirm Dialog ─────────────────────────── */
    .gp-confirm-overlay {
      position: fixed; inset: 0; z-index: 920000;
      background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      animation: gpFadePanel 0.2s ease;
    }
    .gp-confirm-card {
      background: rgba(18,19,26,0.98); border: 1px solid rgba(255,255,255,0.06);
      border-radius: 16px; padding: 24px; max-width: 340px; width: 90%; text-align: center;
      box-shadow: 0 24px 60px rgba(0,0,0,0.6);
    }
    .gp-confirm-card h4 { font-size: 15px; color: #fff; font-weight: 600; margin: 0 0 8px; font-family: 'Inter',sans-serif; }
    .gp-confirm-card p { font-size: 12px; color: rgba(255,255,255,0.4); margin: 0 0 20px; line-height: 1.5; }
    .gp-confirm-actions { display: flex; gap: 10px; }
    .gp-confirm-actions .gp-btn { flex: 1; padding: 10px; font-size: 13px; border-radius: 10px; }

    /* ── Typography & Borderless Inputs ────────── */
    .gp-stat-val-huge {
      font-size: 38px !important;
      font-weight: 200 !important;
      color: #fff !important;
      line-height: 1.0 !important;
      font-family: 'Inter', -apple-system, sans-serif;
    }
    .gp-stat-label-micro {
      font-size: 8px !important;
      color: rgba(255,255,255,0.25) !important;
      margin-top: 6px !important;
      text-transform: uppercase !important;
      letter-spacing: 1px !important;
      font-weight: 500 !important;
    }
    .gp-input-borderless {
      border: none !important;
      border-radius: 0 !important;
      border-bottom: 1px solid rgba(255,255,255,0.1) !important;
      background: transparent !important;
      padding: 8px 0 !important;
      font-size: 16px !important;
      font-weight: 500 !important;
      box-shadow: none !important;
    }
    .gp-input-borderless:focus {
      border-bottom-color: rgba(255,255,255,0.3) !important;
      background: transparent !important;
      box-shadow: none !important;
    }

    /* ── Minimal Accent & Vibe Scrolling ───────── */
    .gp-vibes-list-container {
      flex: 1;
      overflow-y: auto;
      margin-bottom: 16px;
      padding-right: 4px;
    }
    .gp-vibes-list-container::-webkit-scrollbar { width: 4px; }
    .gp-vibes-list-container::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 4px; }
    
    .gp-color-line {
      height: 3px;
      flex: 1;
      border-radius: 2px;
      cursor: pointer;
      opacity: 0.35;
      transition: all 0.2s cubic-bezier(0.16,1,0.3,1);
    }
    .gp-color-line:hover {
      opacity: 0.75;
      height: 4px;
    }
    .gp-color-line.active {
      opacity: 1;
      height: 5px;
    }

    /* ── Sidebar Logo Spring Transitions ───────── */
    .sidebar-logo {
      transition: transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
    }
    .sidebar-logo.gp-pull-open {
      transform: translateY(15px) scaleY(1.15) rotate(10deg) !important;
    }
    .sidebar-logo.gp-pull-close {
      transform: translateY(-8px) scaleY(0.9) rotate(-6deg) !important;
    }
  `;
  document.head.appendChild(s);
})();

// ── 2. CONSTANTS ─────────────────────────────────────────────────
const GP_AVATAR_COLORS = [
  { id:'cyan',   grad:'linear-gradient(135deg,#00f2fe,#4facfe)' },
  { id:'purple', grad:'linear-gradient(135deg,#a259ff,#6c3ce0)' },
  { id:'gold',   grad:'linear-gradient(135deg,#f7971e,#ffd200)' },
  { id:'pink',   grad:'linear-gradient(135deg,#f72585,#b5179e)' },
  { id:'green',  grad:'linear-gradient(135deg,#00b09b,#96c93d)' },
  { id:'silver', grad:'linear-gradient(135deg,#8e9eab,#485563)' },
  { id:'red',    grad:'linear-gradient(135deg,#ff416c,#ff4b2b)' },
  { id:'arctic', grad:'linear-gradient(135deg,#667eea,#764ba2)' }
];
const GP_EMOJIS = ['💻','🎵','🔬','🎮','📚','☕','🎨','🚀','🌙','🔥','⚡','🎯'];
const GP_DEFAULT_VIBES = [
  { id:'vibe_coding', name:'Бағдарламалау вайбы', emoji:'💻', accentColor:'#00f2fe', pinnedSites:[
    {url:'https://github.com',title:'GitHub'},{url:'https://stackoverflow.com',title:'Stack Overflow'},{url:'https://developer.mozilla.org',title:'MDN Docs'}
  ], tabGroup:['https://github.com'], isPreset:true, createdAt:Date.now() },
  { id:'vibe_media', name:'Медиа вайбы', emoji:'🎵', accentColor:'#f72585', pinnedSites:[
    {url:'https://music.youtube.com',title:'YouTube Music'},{url:'https://open.spotify.com',title:'Spotify'},{url:'https://kinopoisk.ru',title:'Кинопоиск'}
  ], tabGroup:['https://music.youtube.com'], isPreset:true, createdAt:Date.now() },
  { id:'vibe_research', name:'Зерттеу вайбы', emoji:'🔬', accentColor:'#4ea8de', pinnedSites:[
    {url:'https://scholar.google.com',title:'Google Scholar'},{url:'https://wikipedia.org',title:'Wikipedia'},{url:'https://arxiv.org',title:'arXiv'}
  ], tabGroup:['https://scholar.google.com'], isPreset:true, createdAt:Date.now() }
];

// ── 3. STATE ─────────────────────────────────────────────────────
const _gp = {
  overlayEl: null,
  gateEl: null,
  activeTab: 'profile',
  pinBuffer: '',
  sessionUnlocked: false,
  pinMode: 'verify', // 'verify' | 'set' | 'confirm'
  pinFirstEntry: '',
  createFormOpen: false,
  newVibe: { name:'', emoji:'💻', color:'#00f2fe' },
  hiddenItems: [], // sidebar elements hidden by lock
  lockedOpenTabs: [] // tabs closed/hidden by lock
};

// ── 4. STORAGE LAYER (GalamtorStore) ─────────────────────────────
const GalamtorStore = {
  _get(key, fallback) { try { const v=localStorage.getItem(key); return v?JSON.parse(v):fallback; } catch { return fallback; } },
  _set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },

  getProfile() { return this._get('gp_profile', { name:'Galamtor Пайдаланушысы', colorId:'cyan', createdAt:Date.now() }); },
  saveProfile(p) { this._set('gp_profile', p); },

  getVibes() { return this._get('gp_vibes', null) || GP_DEFAULT_VIBES; },
  saveVibes(v) { this._set('gp_vibes', v); },
  addVibe(v) { const all=this.getVibes(); all.push(v); this.saveVibes(all); },
  deleteVibe(id) { this.saveVibes(this.getVibes().filter(v=>v.id!==id)); },
  getActiveVibeId() { return localStorage.getItem('gp_active_vibe') || ''; },
  setActiveVibeId(id) { localStorage.setItem('gp_active_vibe', id); },

  getLock() { return this._get('gp_lock', { enabled:false, pinHash:'', hiddenUrls:[] }); },
  saveLock(l) { this._set('gp_lock', l); },

  async hashPin(pin) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(pin+'_galamtor_2026'));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  },

  captureBrowserState() {
    const pinned = [];
    dockIcons.querySelectorAll('.dock-btn[data-url]').forEach(b => {
      pinned.push({ url:b.dataset.url, title:b.title||'' });
    });
    const openTabs = tabs.map(t=>({ url:t.url, title:t.title, isHome:t.isHome }));
    return { pinned, openTabs, capturedAt:Date.now() };
  },

  exportAll() {
    const data = { profile:this.getProfile(), vibes:this.getVibes(), lock:this.getLock(),
      activeVibe:this.getActiveVibeId(), browserState:this.captureBrowserState(),
      exportedAt:new Date().toISOString(), version:'1.0' };
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `galamtor_profile_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  importAll(callback) {
    const inp = document.createElement('input');
    inp.type='file'; inp.accept='.json';
    inp.addEventListener('change', e => {
      const f=e.target.files[0]; if(!f) return;
      const r=new FileReader();
      r.onload = ev => {
        try {
          const d=JSON.parse(ev.target.result);
          if(d.profile) this.saveProfile(d.profile);
          if(d.vibes) this.saveVibes(d.vibes);
          if(d.lock) this.saveLock(d.lock);
          if(d.activeVibe) this.setActiveVibeId(d.activeVibe);
          showToast('✅ Профиль сәтті импортталды!');
          if(callback) callback();
        } catch { showToast('⚠️ Импорт қатесі — файл форматы дұрыс емес'); }
      };
      r.readAsText(f);
    });
    inp.click();
  },

  resetAll() {
    ['gp_profile','gp_vibes','gp_lock','gp_active_vibe'].forEach(k=>localStorage.removeItem(k));
    showToast('🔄 Профиль параметрлері қалпына келтірілді');
  }
};

// ── 5. INIT DEFAULT VIBES ON FIRST RUN ───────────────────────────
if (!localStorage.getItem('gp_vibes')) {
  GalamtorStore.saveVibes(GP_DEFAULT_VIBES);
}

// ── 6. MODAL BUILDER ─────────────────────────────────────────────

function gpBuildOverlay() {
  const ov = document.createElement('div');
  ov.className = 'gp-overlay';
  ov.id = 'gp-overlay';
  ov.innerHTML = `
    <div class="gp-modal">
      <div class="gp-header">
        <h2 class="gp-title">Galamtor Profile Settings</h2>
        <button class="gp-close" id="gp-close-btn">&times;</button>
      </div>
      <div class="gp-tabs">
        <button class="gp-tab-btn active" data-gptab="profile">
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Профиль
        </button>
        <button class="gp-tab-btn" data-gptab="vibes">
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Вайбтар
        </button>
        <button class="gp-tab-btn" data-gptab="lock">
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Құлыптау
        </button>
        <button class="gp-tab-btn" data-gptab="export">
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Деректер
        </button>
      </div>
      <div class="gp-body">
        <div class="gp-panel active" id="gp-panel-profile"></div>
        <div class="gp-panel" id="gp-panel-vibes"></div>
        <div class="gp-panel" id="gp-panel-lock"></div>
        <div class="gp-panel" id="gp-panel-export"></div>
      </div>
    </div>
  `;

  // Close button
  ov.querySelector('#gp-close-btn').addEventListener('click', gpCloseModal);
  ov.addEventListener('click', e => { if (e.target === ov) gpCloseModal(); });

  // Tab switching
  ov.querySelectorAll('.gp-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => gpSwitchTab(btn.dataset.gptab));
  });

  return ov;
}

function gpSwitchTab(tabName) {
  _gp.activeTab = tabName;
  const ov = _gp.overlayEl;
  ov.querySelectorAll('.gp-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.gptab === tabName));
  ov.querySelectorAll('.gp-panel').forEach(p => p.classList.toggle('active', p.id === `gp-panel-${tabName}`));
  
  // Cinematic drop shadow
  const modal = ov.querySelector('.gp-modal');
  if (modal) {
    modal.style.setProperty('box-shadow', '0 50px 100px rgba(0, 0, 0, 0.8)', 'important');
  }

  // Render the active tab content
  if (tabName === 'profile') gpRenderProfileTab();
  else if (tabName === 'vibes') gpRenderVibesTab();
  else if (tabName === 'lock') gpRenderLockTab();
  else if (tabName === 'export') gpRenderExportTab();
}

// ── 6a. PROFILE TAB ──────────────────────────────────────────────
function gpRenderProfileTab() {
  const panel = _gp.overlayEl.querySelector('#gp-panel-profile');
  const prof = GalamtorStore.getProfile();
  const activeColor = GP_AVATAR_COLORS.find(c=>c.id===prof.colorId) || GP_AVATAR_COLORS[0];
  const initial = (prof.name||'G').charAt(0).toUpperCase();
  const created = new Date(prof.createdAt).toLocaleDateString('kk-KZ',{year:'numeric',month:'long',day:'numeric'});
  const vibeCount = GalamtorStore.getVibes().length;
  const pinnedCount = dockIcons.querySelectorAll('.dock-btn[data-url]').length;

  panel.innerHTML = `
    <div class="gp-field" style="margin-top:10px; margin-bottom:32px;">
      <label class="gp-label" style="font-size:9px; letter-spacing:1.5px; color:rgba(255,255,255,0.25);">ПАЙДАЛАНУШЫ АТЫ</label>
      <input class="gp-input gp-input-borderless" id="gp-name-input" value="${(prof.name||'').replace(/"/g,'&quot;')}" placeholder="Атыңызды енгізіңіз..." maxlength="32">
    </div>
    <div class="gp-stats" style="margin-top:24px; margin-bottom:32px;">
      <div class="gp-stat" style="background:transparent !important; border:none !important;">
        <div class="gp-stat-val-huge">${tabs.length}</div>
        <div class="gp-stat-label-micro">АШЫҚ ТАБТАР</div>
      </div>
      <div class="gp-stat" style="background:transparent !important; border:none !important;">
        <div class="gp-stat-val-huge">${pinnedCount}</div>
        <div class="gp-stat-label-micro">БЕКІТІЛГЕН</div>
      </div>
      <div class="gp-stat" style="background:transparent !important; border:none !important;">
        <div class="gp-stat-val-huge">${vibeCount}</div>
        <div class="gp-stat-label-micro">ВАЙБТАР САНЫ</div>
      </div>
    </div>
    <div style="margin-top:20px; text-align: center;">
      <label class="gp-label" style="font-size:9px; letter-spacing:1.5px; color:rgba(255,255,255,0.25);">ТІРКЕЛГЕН КҮНІ</label>
      <div style="font-size:13px;color:rgba(255,255,255,0.45); font-weight:500; margin-top:6px;">${created}</div>
    </div>
  `;

  // Name input
  const nameInput = panel.querySelector('#gp-name-input');
  let nameTimeout;
  nameInput.addEventListener('input', () => {
    clearTimeout(nameTimeout);
    nameTimeout = setTimeout(() => {
      const p = GalamtorStore.getProfile();
      p.name = nameInput.value.trim() || 'Galamtor Пайдаланушысы';
      GalamtorStore.saveProfile(p);
      // Update avatar initial
      const av = panel.querySelector('.gp-avatar');
      if (av) av.textContent = p.name.charAt(0).toUpperCase();
    }, 300);
  });
}

// ── 6b. VIBES TAB ────────────────────────────────────────────────
function gpRenderVibesTab() {
  const panel = _gp.overlayEl.querySelector('#gp-panel-vibes');
  const vibes = GalamtorStore.getVibes();
  const activeId = GalamtorStore.getActiveVibeId();

  let vibesHtml = vibes.map(v => {
    const pinCount = (v.pinnedSites||[]).length;
    const tabCount = (v.tabGroup||[]).length;
    const isActive = v.id === activeId;
    const color = v.accentColor || '#00f2fe';
    return `
      <div class="gp-vibe-card ${isActive?'active-vibe':''}" data-vibeid="${v.id}" style="--vibe-accent:${color}; --vibe-hover-bg:${color}0b;">
        <div class="gp-vibe-info">
          <div class="gp-vibe-name">${v.name}</div>
          <div class="gp-vibe-meta">${pinCount} бекітілген · ${tabCount} таб</div>
        </div>
        <div class="gp-vibe-actions">
          ${isActive ? `
            <span class="gp-vibe-active-label">Белсенді</span>
          ` : `
            <button class="gp-vibe-apply-btn gp-apply-vibe" data-vibeid="${v.id}">Қолдану</button>
          `}
          <button class="gp-vibe-delete-btn gp-delete-vibe" data-vibeid="${v.id}">✕</button>
        </div>
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <div class="gp-vibes-header">
      <h3>Вайб профильдері</h3>
      <button class="gp-btn gp-btn-primary" id="gp-create-vibe-btn">+ Жаңа</button>
    </div>
    <div class="gp-vibes-list-container">
      ${vibesHtml || '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.25);font-size:13px;">Вайбтар жоқ — жаңасын жасаңыз!</div>'}
    </div>
    <div class="gp-create-form ${_gp.createFormOpen?'open':''}" id="gp-create-form" style="margin-top:auto;">
      <div class="gp-create-title">ЖАҢА ВАЙБ ЖАСАУ</div>
      <div class="gp-field">
        <label class="gp-label">АТАУЫ</label>
        <input class="gp-input gp-input-borderless" id="gp-vibe-name-input" value="${_gp.newVibe.name.replace(/"/g,'&quot;')}" placeholder="мыс. Жұмыс, Оқу..." maxlength="40">
      </div>
      <div class="gp-field">
        <label class="gp-label">АКЦЕНТ</label>
        <div class="gp-color-line-row" style="display:flex; gap:6px; margin-top:8px;">
          ${GP_AVATAR_COLORS.map(c=>`<div class="gp-color-line ${(_gp.newVibe.color===c.grad.match(/#[a-f0-9]+/i)?.[0] || _gp.newVibe.color===c.id)?'active':''}" data-vcolor="${c.id}" data-vgrad="${c.grad}" style="background:${c.grad}"></div>`).join('')}
        </div>
      </div>
      <button class="gp-btn gp-btn-primary gp-btn-lg" id="gp-capture-vibe" style="margin-top:12px;">Қазіргі күйді сақтау</button>
    </div>
  `;

  // Create form toggle
  panel.querySelector('#gp-create-vibe-btn').addEventListener('click', () => {
    _gp.createFormOpen = !_gp.createFormOpen;
    panel.querySelector('#gp-create-form').classList.toggle('open', _gp.createFormOpen);
  });

  // Vibe name input
  const vibeNameInput = panel.querySelector('#gp-vibe-name-input');
  if (vibeNameInput) vibeNameInput.addEventListener('input', () => { _gp.newVibe.name = vibeNameInput.value; });

  // Accent color selection
  panel.querySelectorAll('[data-vcolor]').forEach(sw => {
    sw.addEventListener('click', () => {
      _gp.newVibe.color = sw.dataset.vgrad.match(/#[a-f0-9]+/i)?.[0] || '#00f2fe';
      panel.querySelectorAll('[data-vcolor]').forEach(s=>s.classList.remove('active'));
      sw.classList.add('active');
    });
  });

  // Capture & save
  const captureBtn = panel.querySelector('#gp-capture-vibe');
  if (captureBtn) {
    captureBtn.addEventListener('click', () => {
      const name = _gp.newVibe.name.trim();
      if (!name) { showToast('Вайбқа атау беріңіз'); return; }
      const state = GalamtorStore.captureBrowserState();
      const vibe = {
        id: 'vibe_' + Date.now(),
        name, emoji: '',
        accentColor: _gp.newVibe.color,
        pinnedSites: state.pinned,
        tabGroup: state.openTabs.filter(t=>t.url).map(t=>t.url),
        isPreset: false,
        createdAt: Date.now()
      };
      GalamtorStore.addVibe(vibe);
      _gp.newVibe = { name:'', emoji:'', color:'#00f2fe' };
      _gp.createFormOpen = false;
      showToast(`"${name}" вайбы сақталды!`);
      gpRenderVibesTab();
    });
  }

  // Apply vibe
  panel.querySelectorAll('.gp-apply-vibe').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      gpApplyVibe(btn.dataset.vibeid);
    });
  });

  // Delete vibe
  panel.querySelectorAll('.gp-delete-vibe').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const vid = btn.dataset.vibeid;
      const v = GalamtorStore.getVibes().find(x=>x.id===vid);
      gpConfirm(`"${v?v.name:'вайб'}" жою керек пе?`, 'Бұл вайб профилі біржолата өшіріледі.', () => {
        GalamtorStore.deleteVibe(vid);
        if (GalamtorStore.getActiveVibeId() === vid) GalamtorStore.setActiveVibeId('');
        showToast('Вайб жойылды');
        gpRenderVibesTab();
      });
    });
  });
}

// ── VIBE APPLICATOR ──────────────────────────────────────────────
function gpApplyVibe(vibeId) {
  const vibes = GalamtorStore.getVibes();
  const vibe = vibes.find(v=>v.id===vibeId);
  if (!vibe) return;

  // Clear current pinned sidebar items (preserve media player)
  dockIcons.querySelectorAll('.dock-btn[data-url]').forEach(b=>b.remove());

  // Pin vibe sites
  (vibe.pinnedSites||[]).forEach(site => {
    const domain = extractDomain(site.url);
    const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    pinToSidebar(site.url, site.title||domain, favicon);
  });

  // Open vibe tab group
  if (vibe.tabGroup && vibe.tabGroup.length > 0) {
    const oldTabs = [...tabs];
    // Create new vibe tabs first to prevent tabs.length reaching 0 and causing recursive auto-creation
    vibe.tabGroup.forEach(url => createTab(url));
    // Close the old tabs afterwards
    oldTabs.forEach(t => {
      if (tabs.some(x => x.id === t.id)) {
        closeTab(t.id);
      }
    });
  }

  GalamtorStore.setActiveVibeId(vibeId);
  showToast(`🎨 "${vibe.name}" вайбына ауыстырылды`);
  gpCloseModal();
}

// ── 6c. LOCK TAB ─────────────────────────────────────────────────
function gpRenderLockTab() {
  const panel = _gp.overlayEl.querySelector('#gp-panel-lock');
  const lock = GalamtorStore.getLock();
  const hasPIN = !!lock.pinHash;

  panel.innerHTML = `
    <div class="gp-lock-row">
      <div class="gp-lock-label">Қауіпсіз құлып</div>
      <button class="gp-toggle ${lock.enabled?'on':''}" id="gp-lock-toggle"></button>
    </div>
    ${lock.enabled ? `
      ${hasPIN ? `
        <div class="gp-pin-status">PIN код орнатылған. <em>Сессия ${_gp.sessionUnlocked?'ашық ✓':'құлыпталған'}</em></div>
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <button class="gp-btn gp-btn-ghost" style="flex:1" id="gp-change-pin">PIN өзгерту</button>
          <button class="gp-btn gp-btn-danger" style="flex:1" id="gp-remove-pin">PIN жою</button>
        </div>
        <button class="gp-btn gp-btn-primary gp-btn-lg gp-lock-now-btn" id="gp-lock-now">Сессияны құлыптау</button>
      ` : `
        <div class="gp-pin-section" id="gp-pin-set-section">
          <div class="gp-pin-label">4 таңбалы PIN код орнату</div>
          <div class="gp-pin-dots" id="gp-set-dots">
            <span class="gp-pin-dot"></span><span class="gp-pin-dot"></span><span class="gp-pin-dot"></span><span class="gp-pin-dot"></span>
          </div>
          ${gpBuildPinPad('set')}
          <div class="gp-pin-error" id="gp-set-error"></div>
        </div>
      `}
      <div class="gp-private-section">
        <label class="gp-label" style="margin-bottom:10px;">Құлыпталғанда жасыру</label>
        <div id="gp-private-list">${gpBuildPrivateList(lock)}</div>
      </div>
    ` : `
      <div style="text-align:center;padding:24px 0;color:rgba(255,255,255,0.25);font-size:13px;">
        Профильді 4 таңбалы PIN кодпен қорғау үшін Қауіпсіз құлыпты қосыңыз.
      </div>
    `}
  `;

  // Toggle
  panel.querySelector('#gp-lock-toggle')?.addEventListener('click', () => {
    const l = GalamtorStore.getLock();
    l.enabled = !l.enabled;
    if (!l.enabled) { l.pinHash = ''; l.hiddenUrls = []; _gp.sessionUnlocked = false; gpShowLockedItems(); }
    else { _gp.sessionUnlocked = true; } // unlocked when user just enabled
    GalamtorStore.saveLock(l);
    gpUpdateLockBadge();
    gpRenderLockTab();
  });

  // Change PIN
  panel.querySelector('#gp-change-pin')?.addEventListener('click', () => {
    const l = GalamtorStore.getLock();
    l.pinHash = '';
    GalamtorStore.saveLock(l);
    _gp.pinBuffer = '';
    _gp.pinMode = 'set';
    _gp.pinFirstEntry = '';
    gpRenderLockTab();
  });

  // Remove PIN
  panel.querySelector('#gp-remove-pin')?.addEventListener('click', () => {
    gpConfirm('PIN кодты жою керек пе?', 'Құлып белсенді болып қалады, бірақ PIN сұралмайды.', () => {
      const l = GalamtorStore.getLock();
      l.pinHash = '';
      GalamtorStore.saveLock(l);
      gpRenderLockTab();
      showToast('🔓 PIN жойылды');
    });
  });

  // Lock Now
  panel.querySelector('#gp-lock-now')?.addEventListener('click', () => {
    _gp.sessionUnlocked = false;
    gpHideLockedItems();
    gpUpdateLockBadge();
    gpCloseModal();
    showToast('🔒 Сессия құлыпталды');
  });

  // PIN pad events for set mode
  gpBindPinPad(panel, 'set');

  // Private items checkboxes
  panel.querySelectorAll('.gp-private-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const l = GalamtorStore.getLock();
      const url = cb.dataset.url;
      if (cb.checked) { if (!l.hiddenUrls.includes(url)) l.hiddenUrls.push(url); }
      else { l.hiddenUrls = l.hiddenUrls.filter(u=>u!==url); }
      GalamtorStore.saveLock(l);
    });
  });
}

function gpBuildPinPad(mode) {
  const keys = [1,2,3,4,5,6,7,8,9,'⌫',0,'✓'];
  return `<div class="gp-pin-pad" data-pinmode="${mode}">${keys.map(k => {
    const cls = (typeof k==='string') ? 'gp-pin-key fn' : 'gp-pin-key';
    return `<button class="${cls}" data-pinkey="${k}">${k}</button>`;
  }).join('')}</div>`;
}

function gpBindPinPad(container, mode) {
  container.querySelectorAll(`.gp-pin-pad[data-pinmode="${mode}"] .gp-pin-key`).forEach(key => {
    key.addEventListener('click', () => {
      const k = key.dataset.pinkey;
      if (k === '⌫') {
        _gp.pinBuffer = _gp.pinBuffer.slice(0,-1);
      } else if (k === '✓') {
        if (_gp.pinBuffer.length === 4) gpHandlePinSubmit(mode, container);
        return;
      } else {
        if (_gp.pinBuffer.length < 4) _gp.pinBuffer += k;
      }
      gpUpdatePinDots(container, mode);
      // Auto-submit on 4 digits for verify mode
      if (_gp.pinBuffer.length === 4 && mode === 'verify') {
        setTimeout(() => gpHandlePinSubmit(mode, container), 150);
      }
    });
  });
}

function gpUpdatePinDots(container, mode) {
  const dotsId = mode === 'verify' ? 'gp-gate-dots' : 'gp-set-dots';
  const dots = container.querySelectorAll(`#${dotsId} .gp-pin-dot`);
  dots.forEach((d,i) => d.classList.toggle('filled', i < _gp.pinBuffer.length));
}

async function gpHandlePinSubmit(mode, container) {
  if (mode === 'verify') {
    // Verify PIN for gate unlock
    const lock = GalamtorStore.getLock();
    const hash = await GalamtorStore.hashPin(_gp.pinBuffer);
    if (hash === lock.pinHash) {
      _gp.sessionUnlocked = true;
      _gp.pinBuffer = '';
      gpShowLockedItems();
      gpUpdateLockBadge();
      gpCloseGate();
      gpOpenModal();
    } else {
      const dots = container.querySelector('#gp-gate-dots');
      const err = container.querySelector('.gp-pin-error');
      if (dots) { dots.classList.add('gp-shake'); setTimeout(()=>dots.classList.remove('gp-shake'),400); }
      container.querySelectorAll('#gp-gate-dots .gp-pin-dot').forEach(d=>{ d.classList.remove('filled'); d.classList.add('error'); setTimeout(()=>d.classList.remove('error'),600); });
      if (err) err.textContent = 'Қате PIN — қайта енгізіңіз';
      _gp.pinBuffer = '';
      setTimeout(()=>{ if(err) err.textContent=''; }, 2000);
    }
  } else if (mode === 'set') {
    // Setting new PIN: need confirmation
    if (!_gp.pinFirstEntry) {
      _gp.pinFirstEntry = _gp.pinBuffer;
      _gp.pinBuffer = '';
      const label = container.querySelector('.gp-pin-label');
      if (label) label.textContent = 'PIN кодты растаңыз';
      gpUpdatePinDots(container, mode);
    } else {
      if (_gp.pinBuffer === _gp.pinFirstEntry) {
        const hash = await GalamtorStore.hashPin(_gp.pinBuffer);
        const l = GalamtorStore.getLock();
        l.pinHash = hash;
        GalamtorStore.saveLock(l);
        _gp.pinBuffer = '';
        _gp.pinFirstEntry = '';
        _gp.sessionUnlocked = true;
        gpUpdateLockBadge();
        showToast('🔐 PIN сәтті орнатылды!');
        gpRenderLockTab();
      } else {
        const err = container.querySelector('#gp-set-error');
        const dots = container.querySelector('#gp-set-dots');
        if (dots) { dots.classList.add('gp-shake'); setTimeout(()=>dots.classList.remove('gp-shake'),400); }
        if (err) err.textContent = 'PIN сәйкес келмеді — қайта орнатыңыз';
        _gp.pinBuffer = '';
        _gp.pinFirstEntry = '';
        const label = container.querySelector('.gp-pin-label');
        if (label) label.textContent = '4 таңбалы PIN код орнату';
        gpUpdatePinDots(container, mode);
        setTimeout(()=>{ if(err) err.textContent=''; }, 2500);
      }
    }
  }
}

function gpBuildPrivateList(lock) {
  const items = [];
  dockIcons.querySelectorAll('.dock-btn[data-url]').forEach(btn => {
    const url = btn.dataset.url;
    const title = btn.title || extractDomain(url);
    const checked = (lock.hiddenUrls||[]).includes(url);
    items.push(`<div class="gp-private-item"><input type="checkbox" class="gp-private-cb" data-url="${url}" ${checked?'checked':''}><label>${title}</label></div>`);
  });
  // Also include hidden items that aren't currently visible
  (lock.hiddenUrls||[]).forEach(url => {
    if (!items.some(i=>i.includes(`data-url="${url}"`))) {
      items.push(`<div class="gp-private-item"><input type="checkbox" class="gp-private-cb" data-url="${url}" checked><label>${extractDomain(url)}</label></div>`);
    }
  });
  return items.length ? items.join('') : '<div style="font-size:12px;color:rgba(255,255,255,0.2);padding:8px 0;">Жасыратын бекітілген элементтер жоқ.</div>';
}

// ── 6d. EXPORT TAB ───────────────────────────────────────────────
function gpShowDownloadToast(title, subtext) {
  const toast = document.createElement('div');
  toast.className = 'gp-download-toast';
  toast.innerHTML = `
    <div class="gp-toast-title">${title}</div>
    <div class="gp-toast-subtext">${subtext}</div>
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add('gp-toast-show');
  });
  setTimeout(() => {
    toast.classList.remove('gp-toast-show');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

function gpRenderExportTab() {
  const panel = _gp.overlayEl.querySelector('#gp-panel-export');
  panel.innerHTML = `
    <div class="gp-export-card">
      <div class="gp-export-row">
        <span class="gp-export-title">Профильді экспорттау</span>
        <button class="gp-btn gp-btn-primary" id="gp-export-btn">Экспорттау</button>
      </div>
      <div class="gp-export-row">
        <span class="gp-export-title">Профильді импорттау</span>
        <button class="gp-btn gp-btn-ghost" id="gp-import-btn">Импорттау</button>
      </div>
      <div class="gp-export-row" style="margin-top:8px; padding-top:16px; border-top:1px solid rgba(255,255,255,0.04);">
        <span class="gp-export-title" style="color:#ff416c;">Бастапқы қалпына келтіру</span>
        <button class="gp-btn gp-btn-danger" id="gp-reset-btn">Өшіру</button>
      </div>
    </div>
  `;

  panel.querySelector('#gp-export-btn').addEventListener('click', () => {
    GalamtorStore.exportAll();
    gpShowDownloadToast('📋 Профиль сақталды', 'Файл \'Downloads\' папкасына сәтті жүктелді.');
  });

  panel.querySelector('#gp-import-btn').addEventListener('click', () => {
    GalamtorStore.importAll(() => {
      gpCloseModal();
      setTimeout(gpOpenModal, 300);
    });
  });

  panel.querySelector('#gp-reset-btn').addEventListener('click', () => {
    gpConfirm('Барлығын өшіру керек пе?', 'Барлық профиль деректері, вайбтар және құлыптау параметрлері біржолата жойылады.', () => {
      GalamtorStore.resetAll();
      _gp.sessionUnlocked = false;
      gpShowLockedItems();
      gpUpdateLockBadge();
      gpCloseModal();
      setTimeout(gpOpenModal, 300);
    });
  });
}

// ── 7. CONFIRM DIALOG ────────────────────────────────────────────
function gpConfirm(title, message, onConfirm) {
  const ov = document.createElement('div');
  ov.className = 'gp-confirm-overlay';
  ov.innerHTML = `
    <div class="gp-confirm-card">
      <h4>${title}</h4>
      <p>${message}</p>
      <div class="gp-confirm-actions">
        <button class="gp-btn gp-btn-ghost gp-confirm-cancel">Бас тарту</button>
        <button class="gp-btn gp-btn-danger gp-confirm-yes">Растау</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
  ov.querySelector('.gp-confirm-cancel').addEventListener('click', ()=>ov.remove());
  ov.querySelector('.gp-confirm-yes').addEventListener('click', ()=>{ ov.remove(); onConfirm(); });
  ov.addEventListener('click', e=>{ if(e.target===ov) ov.remove(); });
}

// ── 8. PIN GATE (fullscreen unlock) ──────────────
function gpBuildGate() {
  const gate = document.createElement('div');
  gate.className = 'gp-pin-gate';
  gate.id = 'gp-pin-gate';
  gate.innerHTML = `
    <div class="gp-pin-gate-card">
      <div class="gp-pin-gate-icon">🔐</div>
      <h3>Galamtor құлыпталған</h3>
      <div class="gp-pin-subtitle">Жалғастыру үшін 4 таңбалы PIN кодты енгізіңіз</div>
      <div class="gp-pin-dots" id="gp-gate-dots">
        <span class="gp-pin-dot"></span><span class="gp-pin-dot"></span><span class="gp-pin-dot"></span><span class="gp-pin-dot"></span>
      </div>
      ${gpBuildPinPad('verify')}
      <div class="gp-pin-error"></div>
      <button class="gp-btn gp-btn-ghost gp-pin-cancel" style="margin-top:20px;">Cancel</button>
    </div>
  `;
  gate.querySelector('.gp-pin-cancel').addEventListener('click', gpCloseGate);
  gpBindPinPad(gate, 'verify');
  return gate;
}

function gpOpenGate() {
  if (!_gp.gateEl) {
    _gp.gateEl = gpBuildGate();
    document.body.appendChild(_gp.gateEl);
  }
  _gp.pinBuffer = '';
  // Reset dots
  _gp.gateEl.querySelectorAll('.gp-pin-dot').forEach(d=>d.classList.remove('filled','error'));
  _gp.gateEl.querySelector('.gp-pin-error').textContent = '';
  requestAnimationFrame(()=> _gp.gateEl.classList.add('gp-visible'));
}

function gpCloseGate() {
  if (_gp.gateEl) {
    _gp.gateEl.classList.remove('gp-visible');
    _gp.pinBuffer = '';
  }
}

// ── 9. LOCK ITEM HIDE/SHOW ───────────────────────────────────────
function gpHideLockedItems() {
  const lock = GalamtorStore.getLock();
  if (!lock.enabled || !lock.hiddenUrls || lock.hiddenUrls.length === 0) return;
  
  // Hide pinned sidebar items
  lock.hiddenUrls.forEach(url => {
    const btn = dockIcons.querySelector(`.dock-btn[data-url="${url}"]`);
    if (btn) {
      btn.style.display = 'none';
      if (!_gp.hiddenItems.includes(btn)) _gp.hiddenItems.push(btn);
    }
  });

  // Hide matching open tabs (close and save to state)
  _gp.lockedOpenTabs = [];
  const tabsToClose = [];
  tabs.forEach(tab => {
    if (tab.url) {
      const match = lock.hiddenUrls.some(hiddenUrl => {
        try {
          const hu = new URL(hiddenUrl).hostname;
          const tu = new URL(tab.url).hostname;
          return tu.includes(hu) || hu.includes(tu);
        } catch {
          return tab.url.includes(hiddenUrl) || hiddenUrl.includes(tab.url);
        }
      });
      if (match) tabsToClose.push(tab);
    }
  });

  tabsToClose.forEach(tab => {
    _gp.lockedOpenTabs.push({ url: tab.url, title: tab.title });
    closeTab(tab.id);
  });
}

function gpShowLockedItems() {
  // Restore pinned sidebar items
  _gp.hiddenItems.forEach(btn => { btn.style.display = ''; });
  _gp.hiddenItems = [];

  // Restore matching open tabs
  if (_gp.lockedOpenTabs && _gp.lockedOpenTabs.length > 0) {
    _gp.lockedOpenTabs.forEach(t => {
      createTab(t.url);
    });
    _gp.lockedOpenTabs = [];
  }
}

function gpUpdateLockBadge() {
  const logo = document.querySelector('.sidebar-logo');
  if (!logo) return;
  let badge = logo.querySelector('.gp-lock-badge');
  const lock = GalamtorStore.getLock();
  if (lock.enabled && lock.pinHash && !_gp.sessionUnlocked) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'gp-lock-badge';
      badge.textContent = '🔒';
      logo.style.position = 'relative';
      logo.appendChild(badge);
    }
  } else {
    if (badge) badge.remove();
  }
}

// ── 10. MODAL OPEN / CLOSE ───────────────────────────────────────
function gpOpenModal() {
  if (!_gp.overlayEl) {
    _gp.overlayEl = gpBuildOverlay();
    document.body.appendChild(_gp.overlayEl);
  }
  // Render the active tab
  gpSwitchTab(_gp.activeTab);

  // Trigger inertial pull animation on logo
  const logo = document.querySelector('.sidebar-logo');
  if (logo) {
    logo.classList.remove('gp-pull-close');
    logo.classList.add('gp-pull-open');
    setTimeout(() => {
      logo.classList.remove('gp-pull-open');
    }, 450);
  }

  requestAnimationFrame(() => _gp.overlayEl.classList.add('gp-visible'));

  if (logo) { logo.style.textShadow = '0 0 16px rgba(0,242,254,0.5)'; logo.style.color = '#00f2fe'; }
}

function gpCloseModal() {
  if (_gp.overlayEl) _gp.overlayEl.classList.remove('gp-visible');

  // Trigger reverse compression animation on logo
  const logo = document.querySelector('.sidebar-logo');
  if (logo) {
    logo.classList.remove('gp-pull-open');
    logo.classList.add('gp-pull-close');
    setTimeout(() => {
      logo.classList.remove('gp-pull-close');
    }, 450);
  }

  if (logo) { logo.style.textShadow = ''; logo.style.color = ''; }
}

// ── 11. LOGO CLICK INTERCEPTOR ───────────────────────────────────
function gpInitProfileHub() {
  const logo = document.querySelector('.sidebar-logo');
  if (!logo) { console.warn('[ProfileHub] .sidebar-logo not found'); return; }

  logo.addEventListener('click', (e) => {
    e.stopPropagation();
    const lock = GalamtorStore.getLock();
    if (lock.enabled && lock.pinHash && !_gp.sessionUnlocked) {
      gpOpenGate();
    } else {
      gpOpenModal();
    }
  });

  // Keyboard shortcut: Escape to close modal, and physical keypad bindings for lock screens
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (_gp.gateEl?.classList.contains('gp-visible')) gpCloseGate();
      else if (_gp.overlayEl?.classList.contains('gp-visible')) gpCloseModal();
      return;
    }

    // Skip lock inputs if the user is typing in a text field
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
      return;
    }

    // Detect if we are on a PIN screen
    let mode = null;
    let container = null;
    if (_gp.gateEl?.classList.contains('gp-visible')) {
      mode = 'verify';
      container = _gp.gateEl;
    } else if (_gp.overlayEl?.classList.contains('gp-visible') && _gp.activeTab === 'lock') {
      // Check if dots wrapper is loaded
      const dots = _gp.overlayEl.querySelector('#gp-set-dots');
      if (dots) {
        mode = 'set';
        container = _gp.overlayEl.querySelector('#gp-panel-lock');
      }
    }

    if (!mode || !container) return;

    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault();
      if (_gp.pinBuffer.length < 4) {
        _gp.pinBuffer += e.key;
        gpUpdatePinDots(container, mode);
        if (_gp.pinBuffer.length === 4 && mode === 'verify') {
          setTimeout(() => gpHandlePinSubmit(mode, container), 150);
        }
      }
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      _gp.pinBuffer = _gp.pinBuffer.slice(0, -1);
      gpUpdatePinDots(container, mode);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_gp.pinBuffer.length === 4) {
        gpHandlePinSubmit(mode, container);
      }
    }
  });

  // Apply lock state on init
  const lock = GalamtorStore.getLock();
  if (lock.enabled && lock.pinHash) {
    _gp.sessionUnlocked = false;
    gpUpdateLockBadge();
    // Delay hiding to let DOM settle (pins are added async)
    setTimeout(gpHideLockedItems, 500);
  }
}

// ── 12. INITIALIZE ───────────────────────────────────────────────
gpInitProfileHub();
