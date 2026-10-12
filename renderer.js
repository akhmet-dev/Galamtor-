// ════════════════════════════════════════════════════════════
//  GALAMTOR — Renderer Process v2
//  Tab Drag & Drop · Sidebar Pinning · Lens · PIP Dock
// ════════════════════════════════════════════════════════════

// ipcRenderer is disabled under context isolation. galamtorAPI is exposed via preload.js.

// ── Firebase Configuration & Initialization ──
const firebaseConfig = {
  apiKey: "AIzaSyDkEReqxwG0_IR12_lNFioKSPEdipqcPZ8",
  authDomain: "galamtor.web.app",
  projectId: "galamtor-browser-974cc",
  storageBucket: "galamtor-browser-974cc.firebasestorage.app",
  messagingSenderId: "984286831243",
  appId: "1:984286831243:web:e694bfabf858f946eeaa8e"
};

// Initialize Firebase compat SDK
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
function getRegistrationDate() {
  const created = auth.currentUser?.metadata?.creationTime;
  if (created) return new Date(created).toISOString().slice(0, 10);
  let localCreated = localStorage.getItem('galamtor_created_at');
  if (!localCreated) {
    localCreated = new Date().toISOString().slice(0, 10);
    localStorage.setItem('galamtor_created_at', localCreated);
  }
  return localCreated;
}

async function syncProfileStats(userId, stats) {
  try {
    if (!userId || !auth.currentUser) return;
    const profileRef = db.collection('users').doc(userId).collection('profileData').doc('stats');
    await profileRef.set({
      openTabsCount: stats.openTabsCount,
      pinnedTabsCount: stats.pinnedTabsCount,
      vibesCount: stats.vibesCount,
      registrationDate: stats.registrationDate || getRegistrationDate(),
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log('[Firebase] Stats successfully synchronized.');
  } catch (err) {
    console.warn('[Firebase] Sync skipped or failed:', err?.message || err);
  }
}

function updateWorkspaceTooltip() {
  try {
    const btn = document.getElementById('btn-workspace');
    if (!btn) return;
    
    const openTabsCount = (typeof tabs !== 'undefined' && tabs) ? tabs.length : 0;
    const pinnedCount = dockIcons ? dockIcons.querySelectorAll('.dock-btn[data-url]').length : 0;
    let vibesCount = 0;
    let prof = null;
    try {
      if (typeof window !== 'undefined' && window.GalamtorStore) {
        vibesCount = window.GalamtorStore.getVibes().length;
        prof = window.GalamtorStore.getProfile();
      }
    } catch (e) {}
    const userName = (prof && prof.name) ? prof.name : 'Galamtor Пайдаланушысы';
    
    let text = `${userName} | Workspace\n`;
    text += `• Қойындылар саны: ${openTabsCount}\n`;
    text += `• Бекітілген сайттар: ${pinnedCount}\n`;
    text += `• Вайбтар саны: ${vibesCount}`;
    
    btn.title = text;
  } catch (err) {
    console.error("Error in updateWorkspaceTooltip:", err);
  }
}

function gpTriggerAutoSync() {
  try {
    // Update workspace tooltip and persist current tab session automatically
    updateWorkspaceTooltip();
    persistCurrentSession();

    const user = auth.currentUser;
    if (!user) return;
    
    if (window.gpSyncTimeout) clearTimeout(window.gpSyncTimeout);
    window.gpSyncTimeout = setTimeout(() => {
      try {
        const stats = {
          openTabsCount: tabs.length,
          pinnedTabsCount: dockIcons.querySelectorAll('.dock-btn[data-url]').length,
          vibesCount: GalamtorStore.getVibes().length,
          registrationDate: getRegistrationDate()
        };
        syncProfileStats(user.uid, stats);
      } catch (innerErr) {
        console.error("Error running debounced syncProfileStats:", innerErr);
      }
    }, 1000);
  } catch (err) {
    console.error("Error in gpTriggerAutoSync:", err);
  }
}

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
  // The guest browser opens network pages only.
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return '';
  // Match domains (including TLDs), localhost, and IP addresses
  const urlPattern = /^(https?:\/\/)?(www\.)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}/;
  const ipPattern = /^(https?:\/\/)?\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/;
  if (urlPattern.test(trimmed) || ipPattern.test(trimmed) || trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) {
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
  try {
    const domain = extractDomain(url || '');
    return domain ? domain.charAt(0).toUpperCase() : 'G';
  } catch { return 'G'; }
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

function createTab(url = null, isIncognito = false) {
  const tabId = generateTabId();
  const defaultTitle = isIncognito ? 'Жеке қойынды' : 'Жаңа қойынды';
  const tab = { 
    id: tabId, 
    title: defaultTitle, 
    url, 
    isHome: !url, 
    isIncognito, 
    isSleeping: false, 
    lastActiveTime: Date.now() 
  };
  tabs.push(tab);

  const tabEl = document.createElement('div');
  tabEl.className = isIncognito ? 'tab incognito-tab' : 'tab';
  tabEl.dataset.tabId = tabId;
  tabEl.setAttribute('draggable', 'true');
  // Use textContent to prevent XSS from tab titles
  const titleSpan = document.createElement('span');
  titleSpan.className = 'tab-title';
  titleSpan.textContent = tab.title;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-close';
  closeBtn.title = 'Жабу';
  closeBtn.textContent = '×';
  tabEl.appendChild(titleSpan);
  tabEl.appendChild(closeBtn);

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

  if (url) createWebview(tabId, url, isIncognito);
  activateTab(tabId);
  gpTriggerAutoSync();
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

// ── YouTube Smooth Playback & Anti-AdBlock Shield Engine ──

function injectYouTubeOptimizations(webview) {
  try {
    const currentUrl = (webview.getURL && webview.getURL()) || (webview.getAttribute && webview.getAttribute('src')) || '';
    if (!currentUrl || !currentUrl.includes('youtube.com')) return;

    const ytScript = `
      (() => {
        if (window.__galamtor_yt_guard_active) return;
        window.__galamtor_yt_guard_active = true;

        // 1. Hide ad overlays, promos, and banners cleanly via CSS
        if (!document.getElementById('galamtor-yt-ad-styles')) {
          const style = document.createElement('style');
          style.id = 'galamtor-yt-ad-styles';
          style.textContent = \`
            .video-ads, .ytp-ad-module, .ytp-ad-overlay-container,
            ytd-banner-promo-renderer, ytd-ad-slot-renderer,
            #player-ads, ytd-promoted-sparkles-web-renderer,
            ytd-companion-slot-renderer, ytd-action-companion-ad-renderer,
            ytd-single-hero-badge-renderer, ytd-statement-banner-renderer,
            #masthead-ad, .ytd-in-feed-ad-layout-renderer,
            ytd-ad-slot-renderer, #panels ytd-ads-engagement-panel-content-renderer,
            ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
            tp-yt-paper-dialog:has(.ytd-enforcement-message-view-model) {
              display: none !important;
            }
          \`;
          (document.head || document.documentElement).appendChild(style);
        }

        // 2. High-speed video ad auto-skip without breaking media source buffers
        let lastSkipTs = 0;
        const processYouTubeAds = () => {
          try {
            const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
            const video = document.querySelector('video');

            // Click skip ad button if present
            const skipSelectors = [
              '.ytp-ad-skip-button',
              '.ytp-ad-skip-button-modern',
              '.ytp-skip-ad-button',
              '.ytp-ad-skip-button-slot button',
              'button.ytp-ad-skip-button-modern',
              '.ytp-ad-overlay-close-button'
            ];
            for (const sel of skipSelectors) {
              const btn = document.querySelector(sel);
              if (btn && btn.offsetParent !== null) {
                btn.click();
                break;
              }
            }

            // If an ad is actively playing inside video element
            const isAdShowing = player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
            if (isAdShowing && video) {
              const now = Date.now();
              if (now - lastSkipTs > 150) {
                lastSkipTs = now;
                video.muted = true;
                if (!isNaN(video.duration) && video.duration > 0) {
                  video.playbackRate = 16.0;
                  video.currentTime = video.duration - 0.05;
                }
                if (video.paused) {
                  video.play().catch(() => {});
                }
              }
            } else if (video && !isAdShowing && video.playbackRate === 16.0) {
              // Restore normal playback speed when main video starts
              video.playbackRate = 1.0;
            }

            // Automatically dismiss any anti-adblock enforcement dialog and resume playback
            const modal = document.querySelector('tp-yt-paper-dialog:has(.ytd-enforcement-message-view-model)') ||
                          document.querySelector('ytd-enforcement-message-view-model');
            if (modal) {
              const parentDialog = modal.closest('tp-yt-paper-dialog') || modal;
              parentDialog.remove();
              const playBtn = document.querySelector('.ytp-play-button');
              if (video && video.paused) {
                video.play().catch(() => {});
              }
            }
          } catch (e) {}
        };

        setInterval(processYouTubeAds, 120);
      })();
    `;

    webview.executeJavaScript(ytScript).catch(() => {});
  } catch (err) {}
}

function createWebview(tabId, url, isIncognito = false) {
  let wrapper = document.querySelector(`.webview-wrapper[data-tab-id="${tabId}"]`);
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'webview-wrapper';
    wrapper.dataset.tabId = tabId;
    webviewsContainer.appendChild(wrapper);
  } else {
    wrapper.innerHTML = ''; // Clean up existing content if re-creating
  }

  const webview = document.createElement('webview');
  webview.setAttribute('src', url);
  webview.setAttribute('allowpopups', '');
  if (isIncognito) {
    webview.setAttribute('partition', 'incognito');
  }
  wrapper.appendChild(webview);

  // Setup YouTube optimization triggers
  const applyYTShield = () => injectYouTubeOptimizations(webview);
  webview.addEventListener('dom-ready', applyYTShield);
  webview.addEventListener('did-navigate', applyYTShield);
  webview.addEventListener('did-navigate-in-page', applyYTShield);

  // Popup requests are checked in the main process and returned as tabs.

  webview.addEventListener('did-start-loading', () => {
    if (activeTabId === tabId) showLoadingBar();
  });

  webview.addEventListener('did-stop-loading', () => {
    // Always hide loading bar if this was the tab that started it, even if user switched tabs
    if (activeTabId === tabId) {
      hideLoadingBar();
      updateNavButtons(webview);
    } else {
      // If a background tab finished loading while we were viewing it before switching,
      // make sure the loading bar isn't stuck from this tab
      hideLoadingBar();
    }
  });

  webview.addEventListener('did-navigate', (event) => {
    try {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.url = event.url;
        if (!tab.isIncognito && window.galamtorAPI?.addHistory) {
          window.galamtorAPI.addHistory({
            url: event.url,
            title: tab.title || event.url,
            timestamp: Date.now()
          }).catch(err => console.error('[History] Failed to add entry:', err));
        }

        // Sync media state URL if active
        if (GlobalMediaState.activeTabId === tabId) {
          GlobalMediaState.serviceUrl = event.url;
        }
      }
      if (activeTabId === tabId) {
        window.galamtorAPI?.setActiveBankingUrl?.(event.url);
        urlInput.value = event.url;
        updateNavButtons(webview);
        if (typeof updateBookmarkButtonState === 'function') updateBookmarkButtonState();
      }
      // Auto-save session on navigation
      persistCurrentSession();
    } catch (err) {
      console.error("Error in did-navigate listener:", err);
    }
  });

  webview.addEventListener('did-navigate-in-page', (event) => {
    try {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.url = event.url;
        if (!tab.isIncognito && window.galamtorAPI?.addHistory) {
          window.galamtorAPI.addHistory({
            url: event.url,
            title: tab.title || event.url,
            timestamp: Date.now()
          }).catch(err => console.error('[History] Failed to add entry:', err));
        }

        // Sync media state URL if active
        if (GlobalMediaState.activeTabId === tabId) {
          GlobalMediaState.serviceUrl = event.url;
        }
      }
      if (activeTabId === tabId) {
        window.galamtorAPI?.setActiveBankingUrl?.(event.url);
        urlInput.value = event.url;
        const wv = getActiveWebview();
        if (wv) updateNavButtons(wv);
      }
    } catch (err) {
      console.error("Error in did-navigate-in-page listener:", err);
    }
  });

  webview.addEventListener('page-title-updated', (event) => {
    try {
      const tab = tabs.find(t => t.id === tabId);
      if (tab) {
        tab.title = event.title || 'Жаңа қойынды';
        updateTabTitle(tabId, tab.title);

        // Sync track title if this is the active media tab
        if (GlobalMediaState.activeTabId === tabId) {
          GlobalMediaState.trackTitle = tab.title;
          updateMediaPlayerUI();
        }

        // Detect YouTube Music for PIP
        if (tab.url && tab.url.includes('music.youtube.com') && activeTabId === tabId) {
          pipUpdateFromYTMusic(tab.title);
        }
      }
    } catch (err) {
      console.error("Error in page-title-updated listener:", err);
    }
  });

  webview.addEventListener('page-favicon-updated', (event) => {
    if (event.favicons && event.favicons.length > 0) {
      const tab = tabs.find(t => t.id === tabId);
      let faviconUrl = event.favicons[0];
      // Fix relative favicon URLs by resolving against the page origin
      if (faviconUrl && !faviconUrl.startsWith('http') && !faviconUrl.startsWith('data:')) {
        try {
          const pageUrl = tab && tab.url ? tab.url : webview.getURL();
          faviconUrl = new URL(faviconUrl, pageUrl).href;
        } catch { /* keep original */ }
      }
      if (tab) tab.favicon = faviconUrl;
      updateTabFavicon(tabId, faviconUrl);
    }
  });

  webview.addEventListener('media-started-playing', () => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) tab.isPlaying = true;
    handleMediaStart(tabId);
  });
  webview.addEventListener('media-paused', () => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) tab.isPlaying = false;
    handleMediaPause(tabId);
  });

  webview.addEventListener('found-in-page', (event) => {
    if (activeTabId === tabId) {
      const countEl = document.getElementById('find-count');
      if (countEl && event.result) {
        countEl.textContent = `${event.result.activeMatchOrdinal || 0}/${event.result.matches || 0}`;
      }
    }
  });

  // Error handling: show error page on load failure
  webview.addEventListener('did-fail-load', (event) => {
    // Ignore aborted loads (user navigated away) and sub-frame errors
    if (event.errorCode === -3 || event.isMainFrame === false) return;
    const tab = tabs.find(t => t.id === tabId);
    const errorMessages = {
      '-6': { title: 'Файл табылмады', desc: 'Сұралған файл жоқ немесе жойылған.' },
      '-105': { title: 'DNS табылмады', desc: 'Сайттың мекенжайын табу мүмкін болмады. Интернет байланысын тексеріңіз.' },
      '-106': { title: 'Интернет жоқ', desc: 'Интернет байланысы жоқ. Wi-Fi немесе мобильді деректерді тексеріңіз.' },
      '-118': { title: 'Байланыс уақыты бітті', desc: 'Сервер тым ұзақ жауап бермеді.' },
      '-200': { title: 'Сертификат қатесі', desc: 'Бұл сайттың қауіпсіздік сертификаты жарамсыз.' },
    };
    const errInfo = errorMessages[String(event.errorCode)] || { title: 'Бет жүктелмеді', desc: event.errorDescription || `Қате коды: ${event.errorCode}` };
    const errorHTML = `<html><head><meta charset='UTF-8'><style>
      body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0c0e;color:#fff;font-family:'Inter',system-ui,sans-serif;}
      .err{text-align:center;max-width:420px;padding:40px;}
      .err-icon{font-size:64px;margin-bottom:20px;opacity:0.6;}
      .err h2{color:#00f2fe;margin:0 0 12px;font-size:22px;}
      .err p{color:rgba(255,255,255,0.55);line-height:1.6;margin:0 0 24px;}
      .err button{background:linear-gradient(135deg,#00f2fe,#648cff);border:none;color:#fff;padding:10px 28px;border-radius:10px;font-size:14px;cursor:pointer;font-weight:600;transition:transform 0.2s,box-shadow 0.2s;}
      .err button:hover{transform:translateY(-2px);box-shadow:0 4px 20px rgba(0,242,254,0.3);}
    </style></head><body><div class='err'><div class='err-icon'>🌐</div><h2>${errInfo.title}</h2><p>${errInfo.desc}</p><button onclick='location.reload()'>Қайта жүктеу</button></div></body></html>`;
    try {
      webview.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHTML)}`);
    } catch (e) {
      webview.setAttribute('src', `data:text/html;charset=utf-8,${encodeURIComponent(errorHTML)}`);
    }
  });

  // Handle renderer process crash
  webview.addEventListener('render-process-gone', (event) => {
    console.error(`[Webview] Renderer process gone for tab ${tabId}:`, event.details);
    const tab = tabs.find(t => t.id === tabId);
    if (tab && tab.url) {
      // Attempt to reload
      setTimeout(() => {
        try { webview.loadURL(tab.url); } catch {}
      }, 1000);
    }
  });
}

function sleepTab(tab) {
  if (!tab || tab.isSleeping || tab.id === activeTabId || tab.isIncognito) return;
  // Don't sleep tabs that are actively playing media
  if (tab.isPlaying) return;
  const wvWrapper = document.querySelector(`.webview-wrapper[data-tab-id="${tab.id}"]`);
  if (wvWrapper) {
    const wv = wvWrapper.querySelector('webview');
    // Use tab.url (tracks actual navigation) instead of getAttribute('src') (initial URL only)
    if (wv) {
      try { tab.url = wv.getURL() || tab.url; } catch { /* keep existing tab.url */ }
    }
    wvWrapper.innerHTML = '';
  }
  tab.isSleeping = true;
  const tabEl = document.querySelector(`.tab[data-tab-id="${tab.id}"]`);
  if (tabEl && !tabEl.querySelector('.tab-sleep-badge')) {
    const badge = document.createElement('span');
    badge.className = 'tab-sleep-badge';
    badge.title = 'Жадты үнемдеу үшін ұйқы режимінде';
    badge.textContent = '(ұйқыда)';
    const titleEl = tabEl.querySelector('.tab-title');
    if (titleEl) titleEl.before(badge);
  }
}

function wakeTab(tab) {
  if (!tab || !tab.isSleeping) return;
  tab.isSleeping = false;
  const tabEl = document.querySelector(`.tab[data-tab-id="${tab.id}"]`);
  if (tabEl) {
    const sleepBadge = tabEl.querySelector('.tab-sleep-badge');
    if (sleepBadge) sleepBadge.remove();
  }
  if (tab.url) {
    createWebview(tab.id, tab.url, tab.isIncognito);
  }
}

// Periodic check to put inactive tabs to sleep (>15 mins)
setInterval(() => {
  const FIFTEEN_MINS = 15 * 60 * 1000;
  const now = Date.now();
  tabs.forEach(t => {
    // Initialize lastActiveTime for restored tabs that are missing it
    if (!t.lastActiveTime) t.lastActiveTime = now;
    if (t.id !== activeTabId && !t.isIncognito && !t.isSleeping && !t.isPlaying && (now - t.lastActiveTime) > FIFTEEN_MINS) {
      sleepTab(t);
    }
  });
}, 60000);

function activateTab(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  // Guard: Don't activate a non-existent tab
  if (!tab) {
    console.warn(`[Tab] Attempted to activate non-existent tab: ${tabId}`);
    return;
  }

  activeTabId = tabId;
  window.galamtorAPI?.setActiveBankingUrl?.(tab.url || '');
  tab.lastActiveTime = Date.now();
  if (tab.isSleeping) wakeTab(tab);

  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  const activeTabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (activeTabEl) activeTabEl.classList.add('active');

  document.querySelectorAll('.webview-wrapper').forEach(el => {
    el.classList.toggle('active', el.dataset.tabId === tabId);
  });

  if (tab.isHome) {
    welcomeScreen.classList.remove('hidden-view');
    urlInput.value = '';
    btnBack.disabled = true;
    btnForward.disabled = true;
    if (typeof refreshGalamtorState === 'function') refreshGalamtorState();
    if (typeof updateBookmarkButtonState === 'function') updateBookmarkButtonState();
  } else {
    welcomeScreen.classList.add('hidden-view');
    urlInput.value = tab.url || '';
    const wv = getActiveWebview();
    if (wv) updateNavButtons(wv);
    if (typeof updateBookmarkButtonState === 'function') updateBookmarkButtonState();
  }
}

function closeTab(tabId) {
  try {
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

    // If the closed tab was the active media player tab, reset media state
    if (GlobalMediaState.activeTabId === tabId) {
      GlobalMediaState.reset();
      try {
        updateMediaPlayerUI();
      } catch (mediaUiErr) {
        console.error("Error updating media player UI on tab close:", mediaUiErr);
      }
    }

    gpTriggerAutoSync();
  } catch (err) {
    console.error("Error in closeTab:", err);
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
  if (!parsedUrl) { showToast('Тек HTTP және HTTPS сілтемелері қолдау табады'); return; }
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return; // Guard against undefined tab

  if (tab.isHome) {
    tab.isHome = false;
    tab.url = parsedUrl;
    createWebview(activeTabId, parsedUrl);
    welcomeScreen.classList.add('hidden-view');
    document.querySelectorAll('.webview-wrapper').forEach(el => {
      el.classList.toggle('active', el.dataset.tabId === activeTabId);
    });
  } else {
    // Wake sleeping tab before navigating
    if (tab.isSleeping) wakeTab(tab);
    const wv = getActiveWebview();
    if (wv) {
      try {
        Promise.resolve(wv.loadURL(parsedUrl)).catch(err => console.warn('[Navigation] Failed:', err));
      } catch (e) {
        wv.setAttribute('src', parsedUrl);
      }
      tab.url = parsedUrl;
    } else {
      // Webview missing — recreate it
      tab.url = parsedUrl;
      createWebview(activeTabId, parsedUrl, tab.isIncognito);
    }
  }
  urlInput.value = parsedUrl;
  window.galamtorAPI?.setActiveBankingUrl?.(parsedUrl);
}

function navigateHome() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) {
    tab.isHome = true;
    tab.url = null;
    tab.title = 'Жаңа қойынды';
    tab.favicon = null; // Reset favicon to prevent stale icons
    updateTabTitle(activeTabId, tab.title);
    // Remove stale favicon from tab element
    const tabEl = document.querySelector(`.tab[data-tab-id="${activeTabId}"] .tab-favicon`);
    if (tabEl) tabEl.remove();
  }
  const wvWrapper = document.querySelector(`.webview-wrapper[data-tab-id="${activeTabId}"]`);
  if (wvWrapper) wvWrapper.remove();
  welcomeScreen.classList.remove('hidden-view');
  urlInput.value = '';
  window.galamtorAPI?.setActiveBankingUrl?.('');
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
  try {
    if (!dockIcons) return;

    // Check if already pinned safely
    const existing = [...dockIcons.querySelectorAll('.dock-btn[data-url]')].find(button => button.dataset.url === url);
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

    // Generate a deterministic safe ID based on URL or domain
    let safeId = '';
    if (url.includes('music.youtube.com')) {
      safeId = 'ytm-btn';
    } else if (url.includes('spotify.com')) {
      safeId = 'spotify-btn';
    } else {
      const sanitizedDomain = domain.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
      safeId = `btn-${sanitizedDomain}`;
    }
    
    // Ensure the ID is unique in DOM to prevent duplicate id conflicts
    let finalId = safeId;
    let counter = 1;
    while (document.getElementById(finalId)) {
      finalId = `${safeId}-${counter}`;
      counter++;
    }
    btn.id = finalId;

    const finalFaviconUrl = faviconUrl || `https://www.google.com/s2/favicons?domain=${domain}`;

    const badge = document.createElement('span');
    badge.className = 'dock-badge pinned-bg';
    const icon = document.createElement('img');
    icon.width = 16;
    icon.height = 16;
    icon.style.borderRadius = '2px';
    icon.src = safeHttpUrl(finalFaviconUrl) || '';
    icon.onerror = () => { badge.textContent = initial; };
    badge.appendChild(icon);
    btn.appendChild(badge);

    // Click to navigate or open new tab
    btn.addEventListener('click', () => {
      try {
        if (tabs.length === 0 || !activeTabId) {
          createTab(url);
        } else {
          navigateTo(url);
        }
      } catch (clickErr) {
        console.error("Error handling sidebar click:", clickErr);
      }
    });

    // Context menu
    btn.addEventListener('contextmenu', (e) => {
      try {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, btn, url);
      } catch (ctxErr) {
        console.error("Error showing context menu:", ctxErr);
      }
    });

    // Vibe switching resiliency: if the button is recreated, instantly pull current state
    try {
      if (GlobalMediaState.isPlaying && GlobalMediaState.activeTabId) {
        const isYTM = url.includes('music.youtube.com') && GlobalMediaState.serviceUrl.includes('music.youtube.com');
        const isSpotify = url.includes('spotify.com') && GlobalMediaState.serviceUrl.includes('spotify.com');
        if (isYTM || isSpotify) {
          const tab = (tabs || []).find(t => t.id === GlobalMediaState.activeTabId);
          const songTitle = GlobalMediaState.trackTitle || (tab ? tab.title : 'Медиа ойнатылуда');
          btn.title = `Ойнатылуда: ${songTitle}`;
        }
      }
    } catch (mediaRestoreErr) {
      console.error("Error restoring media state on sidebar button:", mediaRestoreErr);
    }

    dockIcons.appendChild(btn);
    showToast(`📌 ${domain} бекітілді`);
    updateWorkspaceTooltip();
    gpTriggerAutoSync();
  } catch (err) {
    console.error("Error in pinToSidebar:", err);
  }
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
    gpTriggerAutoSync();
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
if (btnLensWelcome) {
  btnLensWelcome.addEventListener('click', () => lensFileInput.click());
}

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

// ── Centralized Media State ──
let activeMediaTabId = null;
let isMediaPlaying = false;
const GlobalMediaState = {
  activeTabId: null,      // Source of truth for the active media tab
  isPlaying: false,       // Play state
  albumArtUrl: null,      // Saved album art URL
  trackTitle: '',         // Track name
  serviceUrl: '',         // Media service URL (e.g. music.youtube.com or spotify)
  
  reset() {
    this.activeTabId = null;
    this.isPlaying = false;
    this.albumArtUrl = null;
    this.trackTitle = '';
    this.serviceUrl = '';
  }
};

function fetchAlbumArt() {
  try {
    if (!GlobalMediaState.activeTabId) return;
    const wrapper = document.querySelector(`.webview-wrapper[data-tab-id="${GlobalMediaState.activeTabId}"]`);
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
        try {
          if (artUrl) {
            GlobalMediaState.albumArtUrl = artUrl;
            if (!GlobalMediaState.isPlaying) {
              updateMediaPlayerUI();
            }
          }
        } catch (e) {
          console.error("Error setting album art URL:", e);
        }
      })
      .catch(err => console.log('Error fetching album art:', err));
  } catch (err) {
    console.error("Error in fetchAlbumArt:", err);
  }
}

function togglePip() {
  try {
    toggleMediaPlayback();
  } catch (err) {
    console.error("Error in togglePip:", err);
  }
}

function handleMediaStart(tabId) {
  try {
    const tab = (tabs || []).find(t => t.id === tabId);
    GlobalMediaState.activeTabId = tabId;
    GlobalMediaState.isPlaying = true;
    if (tab) {
      GlobalMediaState.serviceUrl = tab.url || '';
      GlobalMediaState.trackTitle = tab.title || '';
    }
    
    updateMediaPlayerUI();
    
    // Attempt to capture the album art after loading transitions
    setTimeout(fetchAlbumArt, 200);
    setTimeout(fetchAlbumArt, 1000);
    setTimeout(fetchAlbumArt, 3000);
  } catch (err) {
    console.error("Error in handleMediaStart:", err);
  }
}

function handleMediaPause(tabId) {
  try {
    if (GlobalMediaState.activeTabId === tabId) {
      GlobalMediaState.isPlaying = false;
      updateMediaPlayerUI();
    }
  } catch (err) {
    console.error("Error in handleMediaPause:", err);
  }
}

function getMediaTargetButton() {
  try {
    if (GlobalMediaState.serviceUrl) {
      if (GlobalMediaState.serviceUrl.includes('music.youtube.com')) {
        const ytmBtn = document.getElementById('ytm-btn') || document.querySelector('.dock-btn[data-url*="music.youtube.com"]');
        if (ytmBtn) return ytmBtn;
      }
      if (GlobalMediaState.serviceUrl.includes('spotify.com')) {
        const spotifyBtn = document.getElementById('spotify-btn') || document.querySelector('.dock-btn[data-url*="spotify.com"]');
        if (spotifyBtn) return spotifyBtn;
      }
    }

    const ytmBtn = document.getElementById('ytm-btn') || document.querySelector('.dock-btn[data-url*="music.youtube.com"]');
    if (ytmBtn) return ytmBtn;

    const spotifyBtn = document.getElementById('spotify-btn') || document.querySelector('.dock-btn[data-url*="spotify.com"]');
    if (spotifyBtn) return spotifyBtn;

    return document.getElementById('sidebar-media-player');
  } catch (err) {
    console.error("Error in getMediaTargetButton:", err);
    return document.getElementById('sidebar-media-player');
  }
}

function resetMediaButtonsTitle() {
  try {
    const ytmBtn = document.getElementById('ytm-btn') || document.querySelector('.dock-btn[data-url*="music.youtube.com"]');
    if (ytmBtn) {
      ytmBtn.title = 'YouTube Music';
    }
    const spotifyBtn = document.getElementById('spotify-btn') || document.querySelector('.dock-btn[data-url*="spotify.com"]');
    if (spotifyBtn) {
      spotifyBtn.title = 'Spotify';
    }
    const mediaPlayer = document.getElementById('sidebar-media-player');
    if (mediaPlayer) {
      mediaPlayer.title = 'Медиа ойнатқыш (Күтуде)';
    }
  } catch (err) {
    console.error("Error in resetMediaButtonsTitle:", err);
  }
}

function updateMediaPlayerUI() {
  try {
    const mediaPlayer = document.getElementById('sidebar-media-player');
    const glowContainer = document.getElementById('sidebar-ambient-glow');

    // Reset default titles first
    const ytmBtn = document.getElementById('ytm-btn') || document.querySelector('.dock-btn[data-url*="music.youtube.com"]');
    if (ytmBtn) {
      ytmBtn.title = 'YouTube Music';
    }
    const spotifyBtn = document.getElementById('spotify-btn') || document.querySelector('.dock-btn[data-url*="spotify.com"]');
    if (spotifyBtn) {
      spotifyBtn.title = 'Spotify';
    }
    if (mediaPlayer) {
      mediaPlayer.title = 'Медиа ойнатқыш (Күтуде)';
    }

    const targetBtn = getMediaTargetButton() || mediaPlayer;
    const badge = mediaPlayer ? mediaPlayer.querySelector('.media-player-badge') : null;
    const staticIcon = mediaPlayer ? mediaPlayer.querySelector('.media-static-icon') : null;
    const overlayIcon = mediaPlayer ? mediaPlayer.querySelector('.overlay-icon') : null;

    if (GlobalMediaState.isPlaying && GlobalMediaState.activeTabId) {
      const tab = (tabs || []).find(t => t.id === GlobalMediaState.activeTabId);
      const songTitle = GlobalMediaState.trackTitle || (tab ? tab.title : 'Медиа ойнатылуда');
      
      if (targetBtn && targetBtn.id !== 'btn-workspace') {
        targetBtn.title = `Ойнатылуда: ${songTitle}`;
      }

      if (badge) {
        badge.classList.add('media-player-active');
        badge.style.backgroundImage = 'none';
        badge.style.setProperty('display', 'inline-flex', 'important');
      }
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
      resetMediaButtonsTitle();
      if (glowContainer) glowContainer.classList.remove('active-glow');
      if (badge) {
        badge.classList.remove('media-player-active');
        badge.style.setProperty('display', 'inline-flex', 'important');
      }
      const albumArt = GlobalMediaState.albumArtUrl;
      if (safeHttpUrl(albumArt) && badge) {
        badge.style.backgroundImage = `url('${safeHttpUrl(albumArt)}')`;
        badge.style.backgroundSize = 'cover';
        badge.style.backgroundPosition = 'center';
        if (staticIcon) {
          staticIcon.style.setProperty('display', 'none', 'important');
        }
      } else {
        if (badge) badge.style.backgroundImage = 'none';
        if (staticIcon) {
          staticIcon.style.removeProperty('display');
        }
      }

      if (overlayIcon) {
        overlayIcon.outerHTML = `
          <svg class="overlay-icon" viewBox="0 0 24 24" width="6" height="6" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        `;
      }
    }

    // Sync Floating PIP Dock UI
    if (pipDock) {
      const pipTrackName = pipDock.querySelector('.pip-track-name');
      const pipTrackArtist = pipDock.querySelector('.pip-track-artist');
      const pipPlayBtn = document.getElementById('pip-play');
      const pipAlbumArt = pipDock.querySelector('.pip-album-art');
      if (GlobalMediaState.isPlaying && GlobalMediaState.trackTitle) {
        if (pipTrackName) pipTrackName.textContent = GlobalMediaState.trackTitle;
        if (pipTrackArtist) pipTrackArtist.textContent = (GlobalMediaState.serviceUrl && GlobalMediaState.serviceUrl.includes('youtube')) ? 'YouTube Music' : 'Медиа ойнатылуда';
        if (pipPlayBtn) {
          pipPlayBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
        }
        if (pipAlbumArt && safeHttpUrl(GlobalMediaState.albumArtUrl)) {
          const cover = document.createElement('img');
          cover.src = safeHttpUrl(GlobalMediaState.albumArtUrl);
          cover.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px;';
          pipAlbumArt.replaceChildren(cover);
        }
      } else {
        if (pipPlayBtn) {
          pipPlayBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        }
      }
    }
  } catch (err) {
    console.error("Error in updateMediaPlayerUI:", err);
  }
}

function getMediaServiceUrl() {
  return localStorage.getItem('galamtor_media_service') || 'https://music.youtube.com';
}

function toggleMediaPlaybackForTab(tabId) {
  if (!tabId) return;
  const wrapper = document.querySelector(`.webview-wrapper[data-tab-id="${tabId}"]`);
  if (!wrapper) return;
  const wv = wrapper.querySelector('webview');
  if (!wv) return;

  wv.executeJavaScript(`
    (() => {
      // 1. Try audio/video tags first
      const mediaElements = Array.from(document.querySelectorAll('video, audio'));
      // Find one that is active/playing or has a source
      const media = mediaElements.find(m => m.src || m.querySelector('source')) || mediaElements[0];
      if (media) {
        if (media.paused) {
          media.play();
          return 'playing';
        } else {
          media.pause();
          return 'paused';
        }
      }
      // 2. Fallback to common play/pause button selectors
      const selectors = [
        'tp-yt-paper-icon-button.play-pause-button',
        '[data-testid="control-button-playpause"]',
        '.player-controls__btn_play',
        '[aria-label="Play"]',
        '[aria-label="Pause"]',
        '[aria-label="play"]',
        '[aria-label="pause"]',
        '.play-pause',
        '.chrome-controls-playpause'
      ];
      for (const selector of selectors) {
        const btn = document.querySelector(selector);
        if (btn) {
          btn.click();
          return 'clicked';
        }
      }
      return 'none';
    })()
  `).then((res) => {
    if (res === 'playing' || res === 'clicked') {
      activeMediaTabId = tabId;
      isMediaPlaying = true;
      updateMediaPlayerUI();
    } else if (res === 'paused') {
      isMediaPlaying = false;
      updateMediaPlayerUI();
    }
  }).catch(err => console.error('Failed to toggle playback for tab:', err));
}

function toggleMediaPlayback() {
  if (!activeMediaTabId) {
    const mediaUrl = getMediaServiceUrl();
    const musicTab = (tabs || []).find(t => {
      if (!t.url) return false;
      if (mediaUrl.includes('music.youtube.com') && t.url.includes('music.youtube.com')) return true;
      if (mediaUrl.includes('music.yandex.ru') && t.url.includes('music.yandex.ru')) return true;
      if (mediaUrl.includes('open.spotify.com') && t.url.includes('open.spotify.com')) return true;
      return t.url.startsWith(mediaUrl) || mediaUrl.startsWith(t.url);
    }) || (tabs || []).find(t => t.url && (t.url.includes('music.youtube.com') || t.url.includes('youtube.com') || t.url.includes('music.yandex.ru') || t.url.includes('spotify.com')));

    if (musicTab) {
      activeMediaTabId = musicTab.id;
    } else {
      openMediaTab();
      return;
    }
  }
  toggleMediaPlaybackForTab(activeMediaTabId);
}

function handleMediaButtonClick() {
  const mediaUrl = getMediaServiceUrl();
  const existingTab = tabs.find(t => {
    if (!t.url) return false;
    if (mediaUrl.includes('music.youtube.com') && t.url.includes('music.youtube.com')) return true;
    if (mediaUrl.includes('music.yandex.ru') && t.url.includes('music.yandex.ru')) return true;
    if (mediaUrl.includes('open.spotify.com') && t.url.includes('open.spotify.com')) return true;
    return t.url.startsWith(mediaUrl) || mediaUrl.startsWith(t.url);
  });

  if (existingTab) {
    if (activeTabId === existingTab.id) {
      toggleMediaPlaybackForTab(existingTab.id);
    } else {
      activateTab(existingTab.id);
    }
  } else {
    createTab(mediaUrl);
  }
}

function openMediaTab() {
  const mediaUrl = getMediaServiceUrl();
  const existingTab = tabs.find(t => {
    if (!t.url) return false;
    if (mediaUrl.includes('music.youtube.com') && t.url.includes('music.youtube.com')) return true;
    if (mediaUrl.includes('music.yandex.ru') && t.url.includes('music.yandex.ru')) return true;
    if (mediaUrl.includes('open.spotify.com') && t.url.includes('open.spotify.com')) return true;
    return t.url.startsWith(mediaUrl) || mediaUrl.startsWith(t.url);
  });

  if (existingTab) {
    activateTab(existingTab.id);
  } else {
    createTab(mediaUrl);
  }
}

function pipUpdateFromYTMusic(title) {
  try {
    let trackInfo = title.replace(' - YouTube Music', '').trim();
    if (GlobalMediaState.activeTabId) {
      GlobalMediaState.trackTitle = trackInfo;
    }
    updateMediaPlayerUI();
  } catch (err) {
    console.error("Error in pipUpdateFromYTMusic:", err);
  }
}

function skipMediaTrack(direction = 'next') {
  const targetId = activeMediaTabId || GlobalMediaState.activeTabId;
  if (!targetId) return;
  const wrapper = document.querySelector(`.webview-wrapper[data-tab-id="${targetId}"]`);
  if (!wrapper) return;
  const wv = wrapper.querySelector('webview');
  if (!wv) return;

  const script = direction === 'next' ? `
    (() => {
      const nextBtn = document.querySelector('.next-button, [aria-label="Next"], [aria-label="next"], [data-testid="control-button-skip-forward"], .player-controls__btn_next');
      if (nextBtn) nextBtn.click();
    })()
  ` : `
    (() => {
      const prevBtn = document.querySelector('.previous-button, [aria-label="Previous"], [aria-label="previous"], [data-testid="control-button-skip-back"], .player-controls__btn_prev');
      if (prevBtn) prevBtn.click();
    })()
  `;
  try {
    wv.executeJavaScript(script).catch(() => {});
  } catch (e) {}
}

function initPipDockControls() {
  if (btnPipToggle) {
    btnPipToggle.addEventListener('click', () => {
      if (pipDock) {
        pipDock.classList.toggle('visible');
        pipState.visible = pipDock.classList.contains('visible');
      }
    });
  }

  if (pipClose) {
    pipClose.addEventListener('click', () => {
      if (pipDock) {
        pipDock.classList.remove('visible');
        pipState.visible = false;
      }
    });
  }

  if (pipExpand) {
    pipExpand.addEventListener('click', () => {
      openMediaTab();
      if (pipDock) pipDock.classList.remove('visible');
      pipState.visible = false;
    });
  }

  if (pipPlay) {
    pipPlay.addEventListener('click', () => {
      toggleMediaPlayback();
    });
  }

  if (pipPrev) {
    pipPrev.addEventListener('click', () => {
      skipMediaTrack('prev');
    });
  }

  if (pipNext) {
    pipNext.addEventListener('click', () => {
      skipMediaTrack('next');
    });
  }
}
initPipDockControls();

function makeDockIconsDraggable() {
  try {
    const btns = document.querySelectorAll('.dock-btn');
    if (!btns) return;

    btns.forEach(btn => {
      if (!btn.hasAttribute('draggable')) {
        btn.setAttribute('draggable', 'true');
      }
      
      // Explicit DOM tracking: Ensure every button has an explicit unique ID
      if (!btn.id) {
        const url = btn.dataset.url;
        if (url) {
          const domain = extractDomain(url);
          const sanitizedDomain = domain.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
          let baseId = `btn-${sanitizedDomain}`;
          let uniqueId = baseId;
          let counter = 1;
          while (document.getElementById(uniqueId)) {
            uniqueId = `${baseId}-${counter}`;
            counter++;
          }
          btn.id = uniqueId;
        } else if (btn.classList.contains('media-player-badge') || btn.id === 'sidebar-media-player') {
          btn.id = 'sidebar-media-player';
        } else {
          btn.id = `btn-dock-${Math.random().toString(36).substr(2, 9)}`;
        }
      }
    });

    if (!dockIcons) return;
    
    // Prevent duplicate event listeners by checking a custom dataset property
    if (!dockIcons.dataset.dragInitialized) {
      let draggedIcon = null;

      dockIcons.addEventListener('dragstart', (e) => {
        try {
          const btn = e.target.closest('.dock-btn');
          if (!btn) return;
          draggedIcon = btn;
          btn.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        } catch (err) {
          console.error("Error in dragstart listener:", err);
        }
      });

      dockIcons.addEventListener('dragend', (e) => {
        try {
          if (draggedIcon) {
            draggedIcon.classList.remove('dragging');
            draggedIcon = null;
          }
        } catch (err) {
          console.error("Error in dragend listener:", err);
        }
      });

      dockIcons.addEventListener('dragover', (e) => {
        try {
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
        } catch (err) {
          console.error("Error in dragover listener:", err);
        }
      });

      dockIcons.dataset.dragInitialized = 'true';
    }
  } catch (err) {
    console.error("Error in makeDockIconsDraggable:", err);
  }
}

function initSidebarMediaPlayer() {
  try {
    if (!sidebar || !dockIcons) return;

    // Create sidebar ambient glow container safely if it doesn't exist
    let glowContainer = document.getElementById('sidebar-ambient-glow');
    if (!glowContainer) {
      sidebar.style.position = 'relative';
      glowContainer = document.createElement('div');
      glowContainer.id = 'sidebar-ambient-glow';
      sidebar.appendChild(glowContainer);
    }

    // Check if media player already exists
    let mediaPlayer = document.getElementById('sidebar-media-player');
    if (!mediaPlayer) {
      mediaPlayer = document.createElement('div');
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

      // Toggle/focus/create media tab on main button click
      mediaPlayer.addEventListener('click', (e) => {
        try {
          handleMediaButtonClick();
        } catch (err) {
          console.error("Error in media player click:", err);
        }
      });

      let dragStartPageX = 0;
      mediaPlayer.addEventListener('dragstart', (e) => {
        dragStartPageX = e.clientX;
        mediaPlayer.classList.add('dragging');
      });

      mediaPlayer.addEventListener('dragend', (e) => {
        mediaPlayer.classList.remove('dragging');
        const diffX = e.clientX - dragStartPageX;
        if (diffX > 100) {
          try {
            openMediaTab();
          } catch (err) {
            console.error("Error opening media tab on dragend:", err);
          }
        }
      });
    } else {
      // Re-append the existing media player so it sits at the bottom of the dock
      dockIcons.appendChild(mediaPlayer);
    }

    makeDockIconsDraggable();
  } catch (err) {
    console.error("Error in initSidebarMediaPlayer:", err);
  }
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
  if (wv) {
    try {
      if (wv.canGoBack()) wv.goBack();
    } catch (e) {
      console.warn('btnBack warning:', e);
    }
  }
});

btnForward.addEventListener('click', () => {
  const wv = getActiveWebview();
  if (wv) {
    try {
      if (wv.canGoForward()) wv.goForward();
    } catch (e) {
      console.warn('btnForward warning:', e);
    }
  }
});

btnRefresh.addEventListener('click', () => {
  const wv = getActiveWebview();
  if (wv) {
    try {
      wv.reload();
    } catch (e) {
      console.warn('btnRefresh warning:', e);
    }
  }
});

btnHome.addEventListener('click', navigateHome);
btnNewTab.addEventListener('click', () => createTab());

// Shortcut cards
document.querySelectorAll('.shortcut-card').forEach(card => {
  card.addEventListener('click', () => {
    const url = card.dataset.url;
    if (url) {
      if (!tabs || tabs.length === 0 || !activeTabId) {
        createTab(url);
      } else {
        navigateTo(url);
      }
    }
  });
});

// Sidebar dock clicks
dockIcons.querySelectorAll('.dock-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const url = btn.dataset.url;
    if (url) {
      if (!tabs || tabs.length === 0 || !activeTabId) {
        createTab(url);
      } else {
        navigateTo(url);
      }
    }
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
  // Cmd+F — Find in page
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    if (window.openFindInPage) window.openFindInPage();
  }
  // Cmd+D — Bookmark current page
  if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
    e.preventDefault();
    if (typeof toggleBookmarkCurrent === 'function') toggleBookmarkCurrent();
  }
  // Cmd+B — Open bookmarks
  if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
    e.preventDefault();
    if (typeof gpOpenModal === 'function') gpOpenModal('bookmarks');
  }
  // Cmd+Y — Open history
  if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
    e.preventDefault();
    if (typeof gpOpenModal === 'function') gpOpenModal('history');
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
    iconHTML: `<div class="sc-icon youtube-bg"><svg viewBox="0 0 24 24" width="20" height="20" fill="white"><path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.107C19.522 3.5 12 3.5 12 3.5s-7.522 0-9.388.556a3.003 3.003 0 0 0-2.11 2.107C0 8.029 0 12 0 12s0 3.971.502 5.837a3.003 3.003 0 0 0 2.11 2.107C4.478 20.5 12 20.5 12 20.5s7.522 0 9.388-.556a3.003 3.003 0 0 0 2.11 2.107C24 15.971 24 12 24 12s0-3.971-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></div>`
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

  // 2. Refresh live exchange rates
  if (typeof updateLiveExchangeRatesUI === 'function') {
    updateLiveExchangeRatesUI();
  }

  // 3. Matrix Scramble Reveal Effect
  const logoEl = document.querySelector('.welcome-logo');
  if (logoEl) {
    scrambleLogoText(logoEl, 'Galamtor');
  }
}

function scrambleLogoText(element, targetText = 'Galamtor') {
  if (!element) return;
  element.innerHTML = 'Galamtor';
}

// ── Sidebar Pinned Shortcuts Setup ──
function setupSidebarElements() {
  // Ensure default dock buttons have click listeners and context menus
  if (dockIcons) {
    dockIcons.querySelectorAll('.dock-btn[data-url]').forEach(btn => {
      const url = btn.dataset.url;
      if (url && !btn.dataset.clickBound) {
        btn.dataset.clickBound = 'true';
        btn.addEventListener('click', () => {
          if (tabs.length === 0 || !activeTabId) createTab(url);
          else navigateTo(url);
        });
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showContextMenu(e.clientX, e.clientY, btn, url);
        });
      }
    });
  }
}

// ════════════════════════════════════════
//  INIT
// ════════════════════════════════════════
setupSidebarElements();
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
      margin-bottom: 20px !important;
    }

    .shortcuts-grid {
      display: grid !important;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)) !important;
      gap: 14px !important;
      width: 100% !important;
      margin-top: 18px !important;
    }

    .safari-favorites-row {
      display: grid !important;
      grid-template-columns: repeat(7, 1fr) !important;
      gap: 10px !important;
      width: 100% !important;
      margin-top: 0 !important;
    }

    .safari-favorites-row .shortcut-card,
    .safari-fav-item {
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      padding: 6px 4px !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: flex-start !important;
      cursor: pointer !important;
      transition: all 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.2) !important;
      border-radius: 16px !important;
    }

    .safari-favorites-row .shortcut-card:hover,
    .safari-fav-item:hover {
      background: rgba(255, 255, 255, 0.08) !important;
      backdrop-filter: blur(16px) !important;
      -webkit-backdrop-filter: blur(16px) !important;
      transform: translateY(-3px) scale(1.03) !important;
      box-shadow: none !important;
      border: none !important;
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
    /* ── Overlay & Modal (B&W Minimalist Liquid Glass) ────────────────────────── */
    .gp-overlay {
      position: fixed; inset: 0; z-index: 900000;
      background: rgba(0, 0, 0, 0.3) !important;
      backdrop-filter: blur(8px) !important; -webkit-backdrop-filter: blur(8px) !important;
      display: flex; align-items: center; justify-content: flex-start;
      opacity: 0; pointer-events: none;
      transition: opacity 0.3s cubic-bezier(0.25, 1, 0.5, 1);
    }
    .gp-overlay.gp-visible { opacity: 1; pointer-events: auto; }
    .gp-modal {
      position: fixed;
      top: 24px;
      left: 88px;
      bottom: 24px;
      width: 488px;
      max-height: calc(100vh - 48px) !important;
      background: rgba(20, 20, 24, 0.74) !important;
      backdrop-filter: blur(50px) saturate(130%) !important;
      -webkit-backdrop-filter: blur(50px) saturate(130%) !important;
      border: 1.5px solid rgba(255, 255, 255, 0.78) !important;
      border-radius: 28px !important;
      display: flex;
      flex-direction: column;
      transform: translateX(calc(-100% - 60px));
      opacity: 0;
      visibility: hidden;
      box-shadow: 0 0 32px rgba(255, 255, 255, 0.25), 0 35px 90px rgba(0, 0, 0, 0.75), inset 0 1px 1px rgba(255, 255, 255, 0.45) !important;
      transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease, visibility 0.4s !important;
      will-change: transform, opacity;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", sans-serif;
    }
    .gp-overlay.gp-visible .gp-modal {
      transform: translateX(0);
      opacity: 1;
      visibility: visible;
      box-shadow: 0 0 35px rgba(255, 255, 255, 0.3), 0 35px 90px rgba(0, 0, 0, 0.8), inset 0 1px 1px rgba(255, 255, 255, 0.5) !important;
    }

    /* Laser Charging Edge Beam disabled for pure monochrome */
    .gp-modal::after {
      display: none !important;
    }

    /* ── Header ─────────────────────────────────── */
    .gp-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 24px 20px 0; flex-shrink: 0;
    }
    .gp-title {
      font-size: 17px; font-weight: 700; color: #ffffff !important;
      letter-spacing: -0.4px; margin: 0;
      background: none !important;
      -webkit-background-clip: unset !important;
      -webkit-text-fill-color: #ffffff !important;
    }
    .gp-close {
      width: 30px; height: 30px; border-radius: 50%;
      background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16);
      color: rgba(255, 255, 255, 0.75); font-size: 16px;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease;
    }
    .gp-close:hover {
      background: rgba(255, 255, 255, 0.18); border-color: #ffffff; color: #ffffff; transform: rotate(90deg);
    }

    /* ── Unified Segmented Control Strip ────────── */
    .gp-tabs {
      display: flex; gap: 3px; padding: 3px !important;
      margin: 10px 20px 16px;
      background: rgba(0, 0, 0, 0.35) !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-radius: 14px !important;
      overflow: hidden;
      flex-shrink: 0;
      position: relative;
    }
    .gp-tab-btn {
      flex: 1; padding: 7px 3px !important; font-size: 10px !important; font-weight: 500 !important;
      letter-spacing: -0.2px;
      border: 1px solid transparent !important; background: transparent !important;
      border-radius: 10px !important;
      color: rgba(255, 255, 255, 0.5) !important;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
      display: inline-flex; align-items: center; justify-content: center; gap: 3px;
      font-family: inherit;
      white-space: nowrap;
    }
    .gp-tab-btn:hover { color: #ffffff !important; }
    .gp-tab-btn:active { transform: scale(0.97); }
    .gp-tab-btn.active {
      color: #ffffff !important;
      background: rgba(255, 255, 255, 0.18) !important;
      border-color: rgba(255, 255, 255, 0.28) !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
      font-weight: 600 !important;
    }
    .gp-tab-btn svg { width: 11px; height: 11px; stroke: currentColor; fill: none; stroke-width: 2.0; flex-shrink: 0; }

    /* ── Body & Panels ──────────────────────────── */
    .gp-body { flex: 1; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; padding: 10px 20px 24px; }
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

    .gp-field { margin-bottom: 22px; }
    .gp-label { font-size: 9.5px; font-weight: 700; color: rgba(255, 255, 255, 0.4); text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 8px; display: block; }
    .gp-input {
      width: 100%; padding: 12px 16px; border-radius: 14px !important;
      background: rgba(255, 255, 255, 0.04) !important; border: 1px solid rgba(255, 255, 255, 0.1) !important;
      color: #fff; font-size: 13.5px; font-family: inherit; outline: none;
      transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
      box-sizing: border-box;
    }
    .gp-input:focus {
      background: rgba(255, 255, 255, 0.07) !important;
      border-color: rgba(255, 255, 255, 0.4) !important;
      box-shadow: 0 0 12px rgba(255, 255, 255, 0.15) !important;
    }
    .gp-input::placeholder { color: rgba(255, 255, 255, 0.25); }

    .gp-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 12px; }
    .gp-stat {
      background: rgba(255, 255, 255, 0.03) !important; border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-radius: 16px !important; padding: 16px 8px; text-align: center;
      transition: all 0.2s ease;
    }
    .gp-stat:hover { background: rgba(255, 255, 255, 0.06) !important; border-color: rgba(255, 255, 255, 0.2) !important; }
    .gp-stat-val { font-size: 26px; font-weight: 800; color: #fff; line-height: 1.1; }
    .gp-stat-label { font-size: 9px; color: rgba(255, 255, 255, 0.4); margin-top: 5px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }

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
    .gp-pin-gate .gp-pin-cancel { margin-top: 0; }
    .gp-gate-footer {
      margin-top: 18px; display: flex; flex-direction: column; align-items: center; gap: 10px;
    }
    .gp-btn-touchid {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      background: rgba(255, 255, 255, 0.08) !important; border: 1px solid rgba(255, 255, 255, 0.25) !important;
      color: #ffffff !important; padding: 10px 22px; border-radius: 20px;
      font-size: 13px; font-weight: 600; cursor: pointer;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      transition: all 0.2s cubic-bezier(0.16,1,0.3,1);
    }
    .gp-btn-touchid:hover {
      background: rgba(255, 255, 255, 0.16) !important; border-color: #ffffff !important;
      box-shadow: 0 0 16px rgba(255, 255, 255, 0.35); transform: scale(1.02);
    }
    .gp-btn-touchid svg { stroke: #ffffff; }
    .gp-forgot-pin-btn {
      background: transparent; border: none; color: rgba(255, 255, 255, 0.45);
      font-size: 12px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px;
      transition: color 0.2s ease; padding: 4px 8px; font-family: inherit;
    }
    .gp-forgot-pin-btn:hover { color: #ffffff; }

    /* ── Confirm Dialog ─────────────────────────── */
    .gp-confirm-overlay {
      position: fixed; inset: 0; z-index: 920000;
      background: rgba(0,0,0,0.6); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      display: flex; align-items: center; justify-content: center;
      animation: gpFadePanel 0.2s ease;
    }
    .gp-confirm-card {
      background: rgba(20, 20, 24, 0.88); backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
      border: 1.5px solid rgba(255, 255, 255, 0.78);
      border-radius: 24px; padding: 26px; max-width: 360px; width: 90%; text-align: center;
      box-shadow: 0 0 28px rgba(255, 255, 255, 0.25), 0 30px 80px rgba(0,0,0,0.8), inset 0 1px 1px rgba(255, 255, 255, 0.45);
    }
    .gp-confirm-card h4 { font-size: 15px; color: #fff; font-weight: 600; margin: 0 0 8px; font-family: 'Inter',sans-serif; }
    .gp-confirm-card p { font-size: 12px; color: rgba(255,255,255,0.5); margin: 0 0 20px; line-height: 1.5; }
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
      transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1) !important;
      will-change: transform;
    }
    .sidebar-logo.gp-pull-open {
      transform: translateY(15px) scaleY(1.15) rotate(10deg) !important;
    }
    .sidebar-logo.gp-pull-close {
      transform: translateY(-8px) scaleY(0.9) rotate(-6deg) !important;
    }

    /* ── Cloud Sync Status Light & Spinner ─────── */
    .gp-sync-dot {
      width: 6px; height: 6px; border-radius: 50%; display: inline-block;
      will-change: opacity;
    }
    .gp-sync-dot-disconnected {
      background: #ff5f56;
      box-shadow: 0 0 8px #ff5f56;
      animation: gpPulseRed 1.8s infinite ease-in-out;
    }
    .gp-sync-dot-connecting {
      background: #ffbd2e;
      box-shadow: 0 0 8px #ffbd2e;
      animation: gpPulseOrange 1s infinite ease-in-out;
    }
    .gp-sync-dot-connected {
      background: #27c93f;
      box-shadow: 0 0 8px #27c93f;
    }
    @keyframes gpPulseRed {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
    @keyframes gpPulseOrange {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
    .gp-spinner {
      width: 12px; height: 12px; border: 1.5px solid rgba(255,255,255,0.2);
      border-top-color: #fff; border-radius: 50%; display: inline-block;
      animation: gpSpin 0.6s linear infinite;
      will-change: transform;
    }
    @keyframes gpSpin {
      to { transform: rotate(360deg); }
    }

    /* ── Download Items Premium Overhaul ───────── */
    .gp-download-item {
      display: flex; flex-direction: column; padding: 12px 14px !important;
      background: rgba(255, 255, 255, 0.02) !important;
      border: 1px solid rgba(255, 255, 255, 0.03) !important;
      border-radius: 12px !important;
      gap: 4px; margin-bottom: 8px;
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.25s ease, background-color 0.25s ease !important;
    }
    .gp-download-item:hover {
      transform: translateY(-1px) !important;
      background: rgba(255, 255, 255, 0.04) !important;
      border-color: rgba(255, 255, 255, 0.08) !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
    }
    .gp-download-item:active {
      transform: translateY(0) scale(0.995) !important;
    }
    .gp-action-link {
      font-size: 11px !important;
      font-weight: 600 !important;
      color: var(--accent-blue, #00f2fe) !important;
      background: transparent !important;
      border: none !important;
      cursor: pointer;
      padding: 3px 8px !important;
      border-radius: 6px;
      transition: all 0.2s ease;
      font-family: inherit;
    }
    .gp-action-link:hover {
      background: rgba(0, 242, 254, 0.08) !important;
      color: #fff !important;
    }

    /* ── Minimalist Link Buttons ────────────────── */
    .gp-link-btn-danger {
      background: transparent !important;
      border: none !important;
      color: rgba(255, 65, 108, 0.6) !important;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      padding: 4px 8px !important;
      transition: all 0.2s ease !important;
      text-decoration: none;
      border-radius: 6px;
      font-family: inherit;
    }
    .gp-link-btn-danger:hover {
      color: #ff416c !important;
      text-shadow: 0 0 8px rgba(255, 65, 108, 0.5) !important;
      background: rgba(255, 65, 108, 0.06) !important;
    }

    .gp-history-item:hover {
      background: rgba(255,255,255,0.035) !important;
      border-color: rgba(255,255,255,0.06) !important;
    }
    .gp-history-item:active {
      transform: scale(0.995);
    }
  `;
  document.head.appendChild(s);
})();

// ── 1.5 LOCALIZATION & TRANSLATIONS ──────────────────────────────
const UI_TRANSLATIONS = {
  kk: {
    profileTab: 'Профиль',
    vibesTab: 'Вайбтар',
    lockTab: 'Құлыптау',
    dataTab: 'Деректер',
    historyTab: 'Тарих',
    downloadsTab: 'Жүктеулер',
    searchPlaceholder: 'Іздеу немесе URL енгізу...',
    welcomeSearchPlaceholder: 'Ғаламтордан іздеу...',
    searchSubmit: 'Іздеу',
    regDate: 'ТІРКЕЛГЕН КҮНІ',
    openTabs: 'АШЫҚ ТАБТАР',
    pinnedSites: 'БЕКІТІЛГЕН',
    vibeCountLabel: 'ВАЙБТАР САНЫ',
    syncStatusLabel: 'БҰЛТТЫ СИНХРОНИЗАЦИЯ',
    syncConnected: 'Бұлтпен синхрондалған',
    syncDisconnected: 'Бұлтқа қосылмаған',
    syncConnecting: 'Бұлтқа қосылуда...',
    syncButtonLogout: 'Шығу',
    syncButtonLogin: 'Google-мен синхрондау',
    mediaServiceLabel: 'Медиа Қызметі',
    customUrlLabel: 'Жеке URL сілтемесі',
    userNameLabel: 'ПАЙДАЛАНУШЫ АТЫ',
    langLabel: 'Тіл / Язык / Language',
    welcomeFooter: 'Қазақ тіліндегі браузер'
  },
  ru: {
    profileTab: 'Профиль',
    vibesTab: 'Вайбы',
    lockTab: 'Блокировка',
    dataTab: 'Данные',
    historyTab: 'История',
    downloadsTab: 'Загрузки',
    searchPlaceholder: 'Поиск или ввод URL...',
    welcomeSearchPlaceholder: 'Искать в Интернете...',
    searchSubmit: 'Поиск',
    regDate: 'ДАТА РЕГИСТРАЦИИ',
    openTabs: 'ОТКРЫТЫЕ ВКЛАДКИ',
    pinnedSites: 'ЗАКРЕПЛЕНО',
    vibeCountLabel: 'КОЛ-ВО ВАЙБОВ',
    syncStatusLabel: 'ОБЛАЧНАЯ СИНХРОНИЗАЦИЯ',
    syncConnected: 'Синхронизировано с облаком',
    syncDisconnected: 'Не подключено к облаку',
    syncConnecting: 'Подключение...',
    syncButtonLogout: 'Выйти',
    syncButtonLogin: 'Синхронизация с Google',
    mediaServiceLabel: 'Медиа Сервис',
    customUrlLabel: 'Кастомный URL',
    userNameLabel: 'ИМЯ ПОЛЬЗОВАТЕЛЯ',
    langLabel: 'Язык / Тіл / Language',
    welcomeFooter: 'Национальный браузер Казахстана'
  },
  en: {
    profileTab: 'Profile',
    vibesTab: 'Vibes',
    lockTab: 'Lock',
    dataTab: 'Data',
    historyTab: 'History',
    downloadsTab: 'Downloads',
    searchPlaceholder: 'Search or enter URL...',
    welcomeSearchPlaceholder: 'Search the Web...',
    searchSubmit: 'Search',
    regDate: 'REGISTRATION DATE',
    openTabs: 'OPEN TABS',
    pinnedSites: 'PINNED',
    vibeCountLabel: 'VIBES COUNT',
    syncStatusLabel: 'CLOUD SYNC',
    syncConnected: 'Synced with Cloud',
    syncDisconnected: 'Not connected to Cloud',
    syncConnecting: 'Connecting to Cloud...',
    syncButtonLogout: 'Logout',
    syncButtonLogin: 'Sync with Google',
    mediaServiceLabel: 'Media Service',
    customUrlLabel: 'Custom URL',
    userNameLabel: 'USER NAME',
    langLabel: 'Language / Тіл / Язык',
    welcomeFooter: 'National Browser of Kazakhstan'
  }
};

function gpApplyLanguage(lang) {
  const trans = UI_TRANSLATIONS[lang] || UI_TRANSLATIONS.kk;
  
  if (urlInput) urlInput.placeholder = trans.searchPlaceholder;
  if (welcomeSearchInput) welcomeSearchInput.placeholder = trans.welcomeSearchPlaceholder;
  
  const submitBtn = document.querySelector('.search-submit-btn');
  if (submitBtn) submitBtn.textContent = trans.searchSubmit;

  const footer = document.querySelector('.welcome-footer span');
  if (footer) footer.textContent = trans.welcomeFooter;

  if (_gp.overlayEl) {
    const tabsList = _gp.overlayEl.querySelectorAll('.gp-tab-btn');
    tabsList.forEach(btn => {
      const gptab = btn.dataset.gptab;
      if (gptab === 'profile') {
        btn.innerHTML = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${trans.profileTab}`;
      } else if (gptab === 'vibes') {
        btn.innerHTML = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> ${trans.vibesTab}`;
      } else if (gptab === 'lock') {
        btn.innerHTML = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> ${trans.lockTab}`;
      } else if (gptab === 'export') {
        btn.innerHTML = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ${trans.dataTab}`;
      } else if (gptab === 'history') {
        btn.innerHTML = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${trans.historyTab}`;
      } else if (gptab === 'downloads') {
        btn.innerHTML = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ${trans.downloadsTab}`;
      }
    });

    const title = _gp.overlayEl.querySelector('.gp-title');
    if (title) title.textContent = `Galamtor ${trans.profileTab}`;

    if (_gp.overlayEl.classList.contains('gp-visible')) {
      if (!window._gpSwitchingLang) {
        window._gpSwitchingLang = true;
        try {
          gpSwitchTab(_gp.activeTab);
        } finally {
          window._gpSwitchingLang = false;
        }
      }
    }
  }
}

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
  lockedOpenTabs: [], // tabs closed/hidden by lock
  syncState: localStorage.getItem('gp_sync_state') || 'disconnected',
  syncUser: null
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

  getLock() { return this._get('gp_lock', { enabled:false, pinHash:'', hiddenUrls:[], touchIdEnabled:true }); },
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
  const currentLang = localStorage.getItem('galamtor_language') || 'kk';
  const trans = UI_TRANSLATIONS[currentLang] || UI_TRANSLATIONS.kk;

  const openTabsCount = (tabs || []).length;
  const activeVibe = GalamtorStore.getVibes().find(v => v.id === GalamtorStore.getActiveVibeId()) || { name: 'Әдепкі (Default)' };

  const ov = document.createElement('div');
  ov.className = 'gp-overlay';
  ov.id = 'gp-overlay';
  ov.innerHTML = `
    <div class="gp-modal">
      <div class="gp-header">
        <h2 class="gp-title">Galamtor Workspace</h2>
        <button class="gp-close" id="gp-close-btn">&times;</button>
      </div>

      <!-- Quick Stats Banner (Monochrome Liquid Glass) -->
      <div class="gp-stats-banner" style="display:flex;align-items:center;justify-content:space-between;margin:12px 20px 8px;padding:12px 18px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.08);border-radius:16px;font-size:11px;color:rgba(255,255,255,0.6);">
        <div style="flex:1;text-align:center;"><strong style="color:#ffffff;display:block;font-size:16px;font-weight:700;line-height:1.2;">${openTabsCount}</strong><span style="font-size:9.5px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Қойынды</span></div>
        <div style="width:1px;height:24px;background:rgba(255,255,255,0.08);"></div>
        <div style="flex:1;text-align:center;" id="gp-drawer-blocked-stat"><strong style="color:#ffffff;display:block;font-size:16px;font-weight:700;line-height:1.2;" id="gp-drawer-ad-count">0</strong><span style="font-size:9.5px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Бұғатталды</span></div>
        <div style="width:1px;height:24px;background:rgba(255,255,255,0.08);"></div>
        <div style="flex:1;text-align:center;"><strong style="color:#ffffff;display:block;font-size:16px;font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${activeVibe.name}</strong><span style="font-size:9.5px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Вайб</span></div>
      </div>

      <div class="gp-tabs">
        <button class="gp-tab-btn active" data-gptab="profile">
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Профиль
        </button>
        <button class="gp-tab-btn" data-gptab="bookmarks">
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          Бетбелгілер
        </button>
        <button class="gp-tab-btn" data-gptab="history">
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Тарих
        </button>
        <button class="gp-tab-btn" data-gptab="downloads">
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Жүктеулер
        </button>
        <button class="gp-tab-btn" data-gptab="vibes">
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Вайбтар
        </button>
        <button class="gp-tab-btn" data-gptab="lock">
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Қауіпсіздік
        </button>
      </div>
      <div class="gp-body">
        <div class="gp-panel active" id="gp-panel-profile"></div>
        <div class="gp-panel" id="gp-panel-bookmarks"></div>
        <div class="gp-panel" id="gp-panel-history"></div>
        <div class="gp-panel" id="gp-panel-downloads"></div>
        <div class="gp-panel" id="gp-panel-vibes"></div>
        <div class="gp-panel" id="gp-panel-ai"></div>
        <div class="gp-panel" id="gp-panel-lock"></div>
      </div>
    </div>
  `;

  // Update AdBlock stats count in drawer
  if (window.galamtorAPI && window.galamtorAPI.getAdBlockStats) {
    window.galamtorAPI.getAdBlockStats().then(stats => {
      const el = ov.querySelector('#gp-drawer-ad-count');
      if (el) el.textContent = stats.count || 0;
    }).catch(() => {});
  }

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

  // Render the active tab content
  if (tabName === 'profile') gpRenderProfileTab();
  else if (tabName === 'bookmarks') gpRenderBookmarksTab();
  else if (tabName === 'history') gpRenderHistoryTab();
  else if (tabName === 'downloads') gpRenderDownloadsTab();
  else if (tabName === 'vibes') gpRenderVibesTab();
  else if (tabName === 'ai') gpRenderAiTab();
  else if (tabName === 'lock') gpRenderLockTab();
}

// ── 6a. PROFILE TAB ──────────────────────────────────────────────
function gpRenderProfileTab() {
  const panel = _gp.overlayEl.querySelector('#gp-panel-profile');
  const prof = GalamtorStore.getProfile();
  const activeColor = GP_AVATAR_COLORS.find(c=>c.id===prof.colorId) || GP_AVATAR_COLORS[0];
  const initial = (prof.name||'G').charAt(0).toUpperCase();
  
  const currentLang = localStorage.getItem('galamtor_language') || 'kk';
  const trans = UI_TRANSLATIONS[currentLang] || UI_TRANSLATIONS.kk;
  
  const localeMap = { kk: 'kk-KZ', ru: 'ru-RU', en: 'en-US' };
  const created = new Date(prof.createdAt).toLocaleDateString(localeMap[currentLang] || 'kk-KZ', {year:'numeric',month:'long',day:'numeric'});
  
  const vibeCount = GalamtorStore.getVibes().length;
  const pinnedCount = dockIcons.querySelectorAll('.dock-btn[data-url]').length;

  const syncState = _gp.syncState || 'disconnected';
  const syncUser = auth.currentUser;
  let dotClass = 'gp-sync-dot-disconnected';
  let statusText = trans.syncDisconnected;
  let statusColor = 'rgba(255,255,255,0.45)';
  let btnHtml = '';

  if (syncState === 'connecting') {
    dotClass = 'gp-sync-dot-connecting';
    statusText = trans.syncConnecting;
    statusColor = 'gp-sync-dot-connecting';
    btnHtml = `<button class="gp-btn gp-btn-secondary" style="padding: 6px 16px; font-size: 11px; border-radius: 12px; display: flex; align-items: center; justify-content: center;" disabled><span class="gp-spinner"></span></button>`;
  } else if (syncUser) {
    dotClass = 'gp-sync-dot-connected';
    statusText = trans.syncConnected;
    statusColor = '#ffffff';
    btnHtml = `
      <div style="display:flex; align-items:center; gap:8px;">
        <img src="${syncUser.photoURL || 'assets/avatar.png'}" style="width:24px; height:24px; border-radius:50%; border:1px solid rgba(255,255,255,0.2); object-fit:cover;">
        <button class="gp-btn gp-btn-secondary" id="gp-sync-auth-btn" style="padding: 6px 14px; font-size: 11px; font-weight:600; border-radius: 10px; background: rgba(255,255,255,0.1); color:#ffffff; border:1px solid rgba(255,255,255,0.2); cursor:pointer;">${trans.syncButtonLogout}</button>
      </div>
    `;
  } else {
    dotClass = 'gp-sync-dot-disconnected';
    statusText = trans.syncDisconnected;
    statusColor = 'rgba(255,255,255,0.45)';
    btnHtml = `<button class="gp-btn gp-btn-secondary" id="gp-sync-auth-btn" style="padding: 6px 14px; font-size: 11px; font-weight:600; border-radius: 10px; background: rgba(255,255,255,0.1); color:#ffffff; border:1px solid rgba(255,255,255,0.2); cursor:pointer;">${trans.syncButtonLogin}</button>`;
  }

  // Load configured media service selection for the dropdown
  const savedMediaUrl = localStorage.getItem('galamtor_media_service') || 'https://music.youtube.com';
  let selectedService = 'youtube';
  let customUrlVal = '';
  if (savedMediaUrl === 'https://music.youtube.com') {
    selectedService = 'youtube';
  } else if (savedMediaUrl === 'https://music.yandex.ru') {
    selectedService = 'yandex';
  } else if (savedMediaUrl === 'https://open.spotify.com') {
    selectedService = 'spotify';
  } else {
    selectedService = 'custom';
    customUrlVal = savedMediaUrl;
  }

  panel.innerHTML = `
    <div class="gp-field" style="margin-top:6px; margin-bottom:20px;">
      <label class="gp-label">${trans.userNameLabel}</label>
      <input class="gp-input" id="gp-name-input" value="${(prof.name||'').replace(/"/g,'&quot;')}" placeholder="Атыңызды енгізіңіз..." maxlength="32">
    </div>

    <!-- ТІЛ таңдау Dropdown Selector -->
    <div class="gp-field" style="margin-bottom:20px;">
      <label class="gp-label">${trans.langLabel}</label>
      <select class="gp-input" id="gp-language-select" style="background: rgba(18,18,22,0.85); color:#fff; border: 1px solid rgba(255,255,255,0.1); cursor:pointer; outline:none; padding:12px 16px; border-radius:14px; width: 100%;">
        <option value="kk" ${currentLang === 'kk' ? 'selected' : ''} style="background:#141418; color:#fff;">Қазақ тілі (Kazakh)</option>
        <option value="ru" ${currentLang === 'ru' ? 'selected' : ''} style="background:#141418; color:#fff;">Русский (Russian)</option>
        <option value="en" ${currentLang === 'en' ? 'selected' : ''} style="background:#141418; color:#fff;">English</option>
      </select>
    </div>

    <!-- МЕДИА ҚЫЗМЕТІ Dropdown Selector -->
    <div class="gp-field" style="margin-bottom:20px;">
      <label class="gp-label">${trans.mediaServiceLabel}</label>
      <select class="gp-input" id="gp-media-service-select" style="background: rgba(18,18,22,0.85); color:#fff; border: 1px solid rgba(255,255,255,0.1); cursor:pointer; outline:none; padding:12px 16px; border-radius:14px; width: 100%;">
        <option value="https://music.youtube.com" ${selectedService === 'youtube' ? 'selected' : ''} style="background:#141418; color:#fff;">YouTube Music (Default)</option>
        <option value="https://music.yandex.ru" ${selectedService === 'yandex' ? 'selected' : ''} style="background:#141418; color:#fff;">Yandex Music</option>
        <option value="https://open.spotify.com" ${selectedService === 'spotify' ? 'selected' : ''} style="background:#141418; color:#fff;">Spotify</option>
        <option value="custom" ${selectedService === 'custom' ? 'selected' : ''} style="background:#141418; color:#fff;">Жеке URL (Custom URL)</option>
      </select>
    </div>

    <div class="gp-field" id="gp-media-custom-url-container" style="display: ${selectedService === 'custom' ? 'block' : 'none'}; margin-top:10px; margin-bottom:20px; transition: all 0.3s ease;">
      <label class="gp-label">${trans.customUrlLabel}</label>
      <input class="gp-input" id="gp-media-custom-url-input" value="${customUrlVal.replace(/"/g,'&quot;')}" placeholder="https://example.com" type="url">
    </div>

    <!-- Бұлтты Синхронизация UI Block -->
    <div class="gp-sync-card" style="margin-bottom:22px; padding: 12px 16px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; display: flex; align-items: center; justify-content: space-between;">
      <div class="gp-sync-info" style="display: flex; flex-direction: column; gap: 4px;">
        <label class="gp-label" style="font-size: 8.5px; letter-spacing: 1px; margin: 0; color: rgba(255,255,255,0.35);">${trans.syncStatusLabel}</label>
        <div class="gp-sync-status-row" style="display: flex; align-items: center; gap: 8px; margin-top: 3px;">
          <span class="gp-sync-dot ${dotClass}" style="background: #ffffff; box-shadow: 0 0 8px rgba(255,255,255,0.7); width: 8px; height: 8px; border-radius: 50%;"></span>
          <span class="gp-sync-text" style="font-size: 12px; font-weight: 500; color: ${statusColor === 'gp-sync-dot-connecting' ? '#ffffff' : statusColor};">${statusText}</span>
        </div>
      </div>
      <div class="gp-sync-actions">
        ${btnHtml}
      </div>
    </div>

    <div class="gp-stats" style="margin-top:16px; margin-bottom:24px;">
      <div class="gp-stat">
        <div class="gp-stat-val-huge">${tabs.length}</div>
        <div class="gp-stat-label-micro">${trans.openTabs}</div>
      </div>
      <div class="gp-stat">
        <div class="gp-stat-val-huge">${pinnedCount}</div>
        <div class="gp-stat-label-micro">${trans.pinnedSites}</div>
      </div>
      <div class="gp-stat">
        <div class="gp-stat-val-huge">${vibeCount}</div>
        <div class="gp-stat-label-micro">${trans.vibeCountLabel}</div>
      </div>
    </div>
    <div style="margin-top:16px; text-align: center;">
      <label class="gp-label" style="font-size:9px; letter-spacing:1.5px; color:rgba(255,255,255,0.35);">${trans.regDate}</label>
      <div style="font-size:12.5px;color:rgba(255,255,255,0.55); font-weight:500; margin-top:4px;">${created}</div>
    </div>
  `;

  // Sync auth button click
  const authBtn = panel.querySelector('#gp-sync-auth-btn');
  if (authBtn) {
    authBtn.addEventListener('click', () => {
      const user = auth.currentUser;
      if (!user) {
        _gp.syncState = 'connecting';
        localStorage.setItem('gp_sync_state', 'connecting');
        gpRenderProfileTab();
        
        // Clean up current auth state before triggering new redirect flow
        auth.signOut().catch(() => {});
        window.galamtorAPI.startGoogleLogin();
      } else {
        auth.signOut().then(() => {
          _gp.syncState = 'disconnected';
          localStorage.setItem('gp_sync_state', 'disconnected');
          showToast(currentLang === 'en' ? '🚪 Sync signed out' : currentLang === 'ru' ? '🚪 Синхронизация отключена' : '🚪 Синхрондау тоқтатылды');
          gpRenderProfileTab();
        }).catch(err => {
          showToast(currentLang === 'en' ? '⚠️ Signout failed' : '⚠️ Жүйеден шығу қатесі');
          console.error(err);
        });
      }
    });
  }

  // Name input
  const nameInput = panel.querySelector('#gp-name-input');
  let nameTimeout;
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      try {
        clearTimeout(nameTimeout);
        nameTimeout = setTimeout(() => {
          try {
            const p = GalamtorStore.getProfile();
            p.name = nameInput.value.trim() || 'Galamtor Пайдаланушысы';
            GalamtorStore.saveProfile(p);
            updateWorkspaceTooltip();
          } catch (innerErr) {
            console.error("Error saving profile name:", innerErr);
          }
        }, 300);
      } catch (err) {
        console.error("Error in nameInput input listener:", err);
      }
    });
  }

  // Language selector
  const langSelect = panel.querySelector('#gp-language-select');
  if (langSelect) {
    langSelect.addEventListener('change', () => {
      const newLang = langSelect.value;
      localStorage.setItem('galamtor_language', newLang);
      window.galamtorAPI.setLanguage(newLang);
      gpApplyLanguage(newLang);
    });
  }

  // Media Service Selector Events
  const serviceSelect = panel.querySelector('#gp-media-service-select');
  const customUrlContainer = panel.querySelector('#gp-media-custom-url-container');
  const customUrlInput = panel.querySelector('#gp-media-custom-url-input');

  serviceSelect.addEventListener('change', () => {
    const val = serviceSelect.value;
    if (val === 'custom') {
      customUrlContainer.style.display = 'block';
      customUrlContainer.style.opacity = '0';
      customUrlContainer.style.transform = 'translateY(-5px)';
      setTimeout(() => {
        customUrlContainer.style.opacity = '1';
        customUrlContainer.style.transform = 'translateY(0)';
      }, 50);
      const customUrl = customUrlInput.value.trim();
      if (!customUrl || customUrl === 'https://') {
        customUrlInput.value = 'https://';
      }
      localStorage.setItem('galamtor_media_service', customUrlInput.value.trim());
    } else {
      customUrlContainer.style.display = 'none';
      localStorage.setItem('galamtor_media_service', val);
    }
  });

  customUrlInput.addEventListener('input', () => {
    localStorage.setItem('galamtor_media_service', customUrlInput.value.trim());
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
      gpTriggerAutoSync();
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
        gpTriggerAutoSync();
      });
    });
  });
}

// ── VIBE ACCENT COLOR APPLIER ────────────────────────────────────
function gpApplyVibeAccentColor(color) {
  if (!color) return;
  document.documentElement.style.setProperty('--accent-blue', color);
  
  let glowColor = color;
  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      glowColor = `rgba(${r}, ${g}, ${b}, 0.25)`;
    } else if (hex.length === 3) {
      const r = parseInt(hex.substring(0, 1) + hex.substring(0, 1), 16);
      const g = parseInt(hex.substring(1, 2) + hex.substring(1, 2), 16);
      const b = parseInt(hex.substring(2, 3) + hex.substring(2, 3), 16);
      glowColor = `rgba(${r}, ${g}, ${b}, 0.25)`;
    }
  }
  document.documentElement.style.setProperty('--accent-glow', glowColor);
}

// ── VIBE APPLICATOR ──────────────────────────────────────────────
function gpApplyVibe(vibeId) {
  try {
    const vibes = GalamtorStore.getVibes();
    const vibe = vibes.find(v=>v.id===vibeId);
    if (!vibe) return;

    // Clear current pinned sidebar items (preserve media player) safely
    if (dockIcons) {
      dockIcons.querySelectorAll('.dock-btn[data-url]').forEach(b => {
        try {
          b.remove();
        } catch (removeErr) {
          console.error("Error removing button during vibe apply:", removeErr);
        }
      });
    }

    // Pin vibe sites safely
    (vibe.pinnedSites||[]).forEach(site => {
      try {
        const domain = extractDomain(site.url);
        const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        pinToSidebar(site.url, site.title||domain, favicon);
      } catch (pinErr) {
        console.error("Error pinning site during vibe apply:", pinErr);
      }
    });

    // Re-initialize sidebar media player to guarantee it is present in the DOM and has the correct position
    try {
      initSidebarMediaPlayer();
      updateMediaPlayerUI();
    } catch (mediaReinitErr) {
      console.error("Error re-initializing media player on vibe switch:", mediaReinitErr);
    }

    // Open vibe tab group safely
    if (vibe.tabGroup && vibe.tabGroup.length > 0) {
      const oldTabs = [...(tabs || [])];
      // Create new vibe tabs first to prevent tabs.length reaching 0 and causing recursive auto-creation
      vibe.tabGroup.forEach(url => {
        try {
          createTab(url);
        } catch (tabCreateErr) {
          console.error("Error creating tab during vibe apply:", tabCreateErr);
        }
      });
      // Close the old tabs afterwards
      oldTabs.forEach(t => {
        try {
          if (tabs.some(x => x.id === t.id)) {
            closeTab(t.id);
          }
        } catch (tabCloseErr) {
          console.error("Error closing tab during vibe apply:", tabCloseErr);
        }
      });
    }

    GalamtorStore.setActiveVibeId(vibeId);
    if (vibe.accentColor) {
      gpApplyVibeAccentColor(vibe.accentColor);
    }
    showToast(`🎨 "${vibe.name}" вайбына ауыстырылды`);
    
    // Safety check for closing settings modal
    try {
      gpCloseModal();
    } catch (modalErr) {
      console.error("Error closing modal after vibe apply:", modalErr);
    }
    
    // Instantly update workspace tooltip & trigger sync
    updateWorkspaceTooltip();
    gpTriggerAutoSync();
  } catch (err) {
    console.error("Critical error in gpApplyVibe:", err);
    showToast("⚠️ Вайб ауыстыру кезінде қате орын алды");
  }
}

// ── 6b2. AI ASSISTANT & AUTO-DOWNLOADER ───────────────────────────
async function handleAiDownloadCommand(userPrompt) {
  try {
    const prompt = (userPrompt || '').trim();
    const activeTab = tabs.find(t => t.id === activeTabId);
    let targetUrl = '';

    // Check if user provided an explicit http(s) URL
    const urlMatch = prompt.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      targetUrl = urlMatch[0];
    } else if (activeTab && activeTab.url && !activeTab.isHome) {
      targetUrl = activeTab.url;
    }

    if (!targetUrl) {
      showToast('⚠️ Жүктейтін сілтеме немесе ашық сайт табылмады');
      return false;
    }

    // First attempt: simulate direct click on page download button inside active webview
    const wv = getActiveWebview();
    if (wv && !urlMatch) {
      const clicked = await wv.executeJavaScript(`
        (() => {
          const dlSelector = 'a[href*=".dmg"], a[href*=".pkg"], a[href*=".zip"], a[href*=".exe"], a[href*=".mp4"], a[download], [class*="download" i], [id*="download" i], a[href*="download" i], button[onclick*="download" i]';
          const btn = document.querySelector(dlSelector);
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        })()
      `).catch(() => false);

      if (clicked) {
        showToast('AI Авто-Жүктеу: Парақшадағы бағдарлама іске қосылды');
        return true;
      }
    }

    // Fallback: Trigger Electron native download
    if (window.galamtorAPI && window.galamtorAPI.downloadURL) {
      await window.galamtorAPI.downloadURL(targetUrl);
      showToast(`AI Авто-Жүктеу: ${targetUrl.slice(0, 30)}... жүктелуде`);

      if (_gp.overlayEl && _gp.overlayEl.classList.contains('gp-visible')) {
        gpSwitchTab('downloads');
      }
      return true;
    }
  } catch (err) {
    console.error('[AI Downloader] Error:', err);
    showToast('❌ AI Авто-Жүктеу кезінде қате орын алды');
  }
  return false;
}

function gpRenderAiTab() {
  const panel = _gp.overlayEl.querySelector('#gp-panel-ai');
  if (!panel) return;

  const activeTab = tabs.find(t => t.id === activeTabId);
  const currentTitle = activeTab ? (activeTab.title || activeTab.url || 'Парақша') : 'Ашық сайт';
  const currentUrl = activeTab ? (activeTab.url || '') : '';

  panel.innerHTML = `
    <div style="padding: 10px 0;">
      <div style="font-size: 13px; font-weight: 600; color: #fff; margin-bottom: 4px;">AI Көмекші & Авто-Жүктегіш</div>
      <div style="font-size: 11px; color: rgba(255,255,255,0.45); margin-bottom: 16px;">Белсенді сайт: ${escapeHtml(currentTitle)}</div>

      <!-- AI Auto-Download Prompt Box -->
      <div style="margin-bottom: 16px;">
        <label class="gp-label" style="font-size: 9px; letter-spacing: 1px; color: rgba(255,255,255,0.3); margin-bottom: 6px; display: block;">AI ПӘРМЕНІ / АВТО-ЖҮКТЕУ</label>
        <div style="display: flex; gap: 6px;">
          <input type="text" id="gp-ai-prompt-input" class="gp-input" placeholder="Мысалы: осы видеоны жүкте немесе сілтеме..." style="flex:1; font-size:12px; padding:10px 12px;">
          <button class="gp-btn gp-btn-primary" id="gp-ai-download-btn" style="font-size:11px; padding:10px 14px; white-space:nowrap;">
            Авто-Жүктеу
          </button>
        </div>
      </div>

      <!-- Quick Action Buttons -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px;">
        <button class="gp-btn gp-btn-ghost" id="gp-ai-summarize-btn" style="font-size:11px; padding: 10px 8px;">
          Бетті түйіндеу
        </button>
        <button class="gp-btn gp-btn-ghost" id="gp-ai-insights-btn" style="font-size:11px; padding: 10px 8px;">
          Негізгі фактілер
        </button>
      </div>

      <!-- Result Container -->
      <div id="gp-ai-output" style="background: rgba(15, 16, 22, 0.85); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 14px; min-height: 110px; font-size: 12px; line-height: 1.5; color: rgba(255, 255, 255, 0.85);">
        <span style="color: rgba(255,255,255,0.35);">Пәрмен енгізіңіз немесе Авто-Жүктеу батырмасын басыңыз.</span>
      </div>
    </div>
  `;

  const inputEl = panel.querySelector('#gp-ai-prompt-input');

  panel.querySelector('#gp-ai-download-btn').addEventListener('click', async () => {
    const text = inputEl ? inputEl.value : '';
    await handleAiDownloadCommand(text || 'осы бетті жүкте');
  });

  inputEl?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await handleAiDownloadCommand(inputEl.value || 'осы бетті жүкте');
    }
  });

  panel.querySelector('#gp-ai-summarize-btn').addEventListener('click', async () => {
    const out = panel.querySelector('#gp-ai-output');
    out.textContent = 'Бет мәтіні талданып жатыр...';
    try {
      const content = await getActivePageContent();
      const result = await window.galamtorAPI.aiSummarize(content, currentTitle, currentUrl);
      out.textContent = result.text || result.error || 'Түйіндеме алынбады.';
    } catch (err) { out.textContent = `Қате: ${err.message}`; }
  });

  panel.querySelector('#gp-ai-insights-btn').addEventListener('click', async () => {
    const out = panel.querySelector('#gp-ai-output');
    out.textContent = 'Негізгі фактілер талданып жатыр...';
    try {
      const content = await getActivePageContent();
      const result = await window.galamtorAPI.aiChat(`Мына бет мәтінінен дәлелденетін үш негізгі фактіні келтір. Мәтінде жоқ деректі қоспа:\n${content.slice(0, 15000)}`, { title: currentTitle, url: currentUrl }, []);
      out.textContent = result.text || result.error || 'Фактілер алынбады.';
    } catch (err) { out.textContent = `Қате: ${err.message}`; }
  });
}

// ── 6c. LOCK TAB ─────────────────────────────────────────────────
function gpRenderLockTab() {
  const panel = _gp.overlayEl.querySelector('#gp-panel-lock');
  const lock = GalamtorStore.getLock();
  const hasPIN = !!lock.pinHash;

  panel.innerHTML = `
    <div class="gp-lock-row">
      <div class="gp-lock-label">Көрініс құлпы</div>
      <button class="gp-toggle ${lock.enabled?'on':''}" id="gp-lock-toggle"></button>
    </div>
    <p style="font-size:11px;color:rgba(255,255,255,0.5);line-height:1.5;margin:0 0 14px;">Бұл құлып қойындыларды интерфейсте жасырады. Тарих, cookies және файлдар шифрланбайды.</p>
    ${lock.enabled ? `
      ${hasPIN ? `
        <div class="gp-pin-status">PIN код орнатылған. <em>Сессия ${_gp.sessionUnlocked?'ашық ✓':'құлыпталған'}</em></div>
        <div class="gp-lock-row" id="gp-touchid-row" style="display:none; margin-bottom: 14px; padding: 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px;">
          <div>
            <div class="gp-lock-label" style="font-size:12px;">Touch ID (Саусақ ізі)</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:2px;">Mac-та саусақ ізімен жылдам ашу</div>
          </div>
          <button class="gp-toggle ${lock.touchIdEnabled!==false?'on':''}" id="gp-touchid-toggle"></button>
        </div>
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
        Интерфейсті 4 таңбалы PIN кодпен жасыру үшін көрініс құлпын қосыңыз.
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

  // Touch ID check & toggle
  if (window.galamtorAPI?.touchIdCanPrompt) {
    window.galamtorAPI.touchIdCanPrompt().then(canPrompt => {
      const row = panel.querySelector('#gp-touchid-row');
      if (row && canPrompt) row.style.display = 'flex';
    }).catch(()=>{});
  }

  panel.querySelector('#gp-touchid-toggle')?.addEventListener('click', () => {
    const l = GalamtorStore.getLock();
    l.touchIdEnabled = l.touchIdEnabled === false ? true : false;
    GalamtorStore.saveLock(l);
    gpRenderLockTab();
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

// ── 7b. TOUCH ID AUTHENTICATION ──────────────────────────────────
let _gpTouchIdPrompting = false;

async function gpTriggerTouchID(autoTrigger = false) {
  if (_gpTouchIdPrompting) return false;
  if (!window.galamtorAPI?.touchIdPrompt) return false;

  try {
    const canPrompt = await window.galamtorAPI.touchIdCanPrompt();
    if (!canPrompt) return false;

    _gpTouchIdPrompting = true;
    const ok = await window.galamtorAPI.touchIdPrompt('Galamtor сессиясын ашу үшін саусақ ізін қойыңыз');
    _gpTouchIdPrompting = false;

    if (ok) {
      _gp.sessionUnlocked = true;
      _gp.pinBuffer = '';
      gpShowLockedItems();
      gpUpdateLockBadge();
      gpCloseGate();
      showToast('✨ Touch ID арқылы сәтті ашылды!');
      if (_gp.openModalAfterUnlock) {
        _gp.openModalAfterUnlock = false;
        gpOpenModal();
      }
      return true;
    }
  } catch (err) {
    _gpTouchIdPrompting = false;
    console.log('[TouchID] Prompt rejected or cancelled:', err);
    if (!autoTrigger) {
      const errEl = _gp.gateEl?.querySelector('.gp-pin-error');
      if (errEl) {
        errEl.textContent = 'Touch ID қабылданбады немесе бас тартылды';
        setTimeout(() => { if (errEl) errEl.textContent = ''; }, 2500);
      }
    }
    return false;
  }
  return false;
}

// ── 7c. FORGOT PIN RECOVERY DIALOG ───────────────────────────────
function gpShowForgotPinDialog() {
  const authUser = typeof auth !== 'undefined' ? auth?.currentUser : null;
  const userEmail = authUser?.email || '';
  const canTouchIdPromise = window.galamtorAPI?.touchIdCanPrompt ? window.galamtorAPI.touchIdCanPrompt() : Promise.resolve(false);

  canTouchIdPromise.then(canTouchId => {
    const ov = document.createElement('div');
    ov.className = 'gp-confirm-overlay gp-forgot-overlay';
    ov.innerHTML = `
      <div class="gp-confirm-card" style="max-width: 380px;">
        <div style="font-size: 36px; margin-bottom: 12px;">🔑</div>
        <h4>Құпия сөзді ұмыттыңыз ба?</h4>
        <p style="margin-bottom: 16px;">
          ${canTouchId ? 'Сіз сессияны Touch ID саусақ ізімен немесе PIN кодты қалпына келтіру арқылы аша аласыз.' : 'PIN кодты нөлдеп, жасырылған қойындылар мен сайттарды қайта ашу үшін қалпына келтіруді таңдаңыз.'}
        </p>

        ${userEmail ? `
          <div style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 12px; padding: 10px 14px; font-size: 12px; color: #ffffff; margin-bottom: 16px; text-align: left; display: flex; align-items: center; gap: 8px;">
            <span>👤</span>
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Google: <strong>${userEmail}</strong></span>
          </div>
        ` : ''}

        <div class="gp-confirm-actions" style="flex-direction: column; gap: 10px;">
          ${canTouchId ? `
            <button class="gp-btn gp-btn-touchid" id="gp-forgot-touchid-btn" style="width:100%; justify-content:center;">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
                <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
                <path d="M2 16h.01"/>
                <path d="M21.8 16c.2-2 .131-5.354 0-6"/>
                <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/>
                <path d="M8.65 22c.21-.66.45-1.32.57-2"/>
                <path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>
              </svg>
              <span>Touch ID арқылы ашу</span>
            </button>
          ` : ''}

          <button class="gp-btn gp-btn-danger" id="gp-forgot-reset-btn" style="width:100%;">
            PIN кодты қалпына келтіру (Өшіру)
          </button>
          <button class="gp-btn gp-btn-ghost" id="gp-forgot-cancel-btn" style="width:100%;">
            Бас тарту
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(ov);

    ov.querySelector('#gp-forgot-cancel-btn')?.addEventListener('click', () => ov.remove());
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });

    if (canTouchId) {
      ov.querySelector('#gp-forgot-touchid-btn')?.addEventListener('click', async () => {
        ov.remove();
        const ok = await gpTriggerTouchID(false);
        if (ok) {
          const l = GalamtorStore.getLock();
          l.pinHash = '';
          GalamtorStore.saveLock(l);
          showToast('🔓 PIN өшірілді. Жаңа PIN орнатуыңызға болады.');
          gpOpenModal();
          gpSwitchTab('lock');
        }
      });
    }

    ov.querySelector('#gp-forgot-reset-btn')?.addEventListener('click', () => {
      ov.remove();
      gpConfirm('PIN кодты нөлдеу керек пе?', 'Көрініс құлпы өшіріліп, жасырылған барлық беттер қайта көрсетіледі.', () => {
        const l = GalamtorStore.getLock();
        l.pinHash = '';
        l.enabled = false;
        GalamtorStore.saveLock(l);
        _gp.sessionUnlocked = true;
        _gp.pinBuffer = '';
        gpShowLockedItems();
        gpUpdateLockBadge();
        gpCloseGate();
        showToast('🔓 Құпия сөз сәтті қалпына келтірілді');
        gpOpenModal();
        gpSwitchTab('lock');
      });
    });
  });
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
      <div class="gp-gate-footer">
        <button type="button" id="gp-gate-touchid-btn" class="gp-btn gp-btn-touchid" style="display:none;" title="Touch ID арқылы кіру">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
            <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
            <path d="M2 16h.01"/>
            <path d="M21.8 16c.2-2 .131-5.354 0-6"/>
            <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/>
            <path d="M8.65 22c.21-.66.45-1.32.57-2"/>
            <path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>
          </svg>
          <span>Touch ID арқылы ашу</span>
        </button>
        <button type="button" class="gp-forgot-pin-btn" id="gp-forgot-pin">Құпия сөзді ұмыттыңыз ба?</button>
        <button type="button" class="gp-btn gp-btn-ghost gp-pin-cancel">Бас тарту</button>
      </div>
    </div>
  `;
  gate.querySelector('.gp-pin-cancel').addEventListener('click', gpCloseGate);
  gate.querySelector('#gp-forgot-pin').addEventListener('click', gpShowForgotPinDialog);
  gate.querySelector('#gp-gate-touchid-btn').addEventListener('click', () => gpTriggerTouchID(false));
  gpBindPinPad(gate, 'verify');
  return gate;
}

async function gpOpenGate() {
  if (!_gp.gateEl) {
    _gp.gateEl = gpBuildGate();
    document.body.appendChild(_gp.gateEl);
  }
  _gp.pinBuffer = '';
  // Reset dots
  _gp.gateEl.querySelectorAll('.gp-pin-dot').forEach(d=>d.classList.remove('filled','error'));
  _gp.gateEl.querySelector('.gp-pin-error').textContent = '';

  // Check Touch ID capability
  const touchBtn = _gp.gateEl.querySelector('#gp-gate-touchid-btn');
  const lock = GalamtorStore.getLock();
  let canTouchId = false;
  if (window.galamtorAPI?.touchIdCanPrompt && lock.touchIdEnabled !== false) {
    try {
      canTouchId = await window.galamtorAPI.touchIdCanPrompt();
    } catch {
      canTouchId = false;
    }
  }

  if (touchBtn) {
    touchBtn.style.display = canTouchId ? 'inline-flex' : 'none';
  }

  requestAnimationFrame(()=> _gp.gateEl.classList.add('gp-visible'));

  // Automatically prompt Touch ID if supported!
  if (canTouchId) {
    setTimeout(() => {
      if (_gp.gateEl?.classList.contains('gp-visible') && !_gp.sessionUnlocked) {
        gpTriggerTouchID(true);
      }
    }, 280);
  }
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
function gpOpenModal(targetTab) {
  if (!_gp.overlayEl) {
    _gp.overlayEl = gpBuildOverlay();
    document.body.appendChild(_gp.overlayEl);
  }
  if (targetTab) {
    _gp.activeTab = targetTab;
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
    }, 300);
  }

  requestAnimationFrame(() => _gp.overlayEl.classList.add('gp-visible'));

  if (logo) { logo.style.textShadow = '0 0 16px rgba(255,255,255,0.7)'; logo.style.color = '#ffffff'; }
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
    }, 300);
  }

  if (logo) { logo.style.textShadow = ''; logo.style.color = ''; }
}

// ── 11. LOGO CLICK INTERCEPTOR ───────────────────────────────────
function gpInitProfileHub() {
  const logo = document.querySelector('.sidebar-logo');
  if (!logo) { console.warn('[ProfileHub] .sidebar-logo not found'); return; }

  // Set up downloads state and listeners
  _gp.activeDownloads = {};

  if (window.galamtorAPI && typeof window.galamtorAPI.onDownloadProgress === 'function') {
    window.galamtorAPI.onDownloadProgress((progress) => {
      _gp.activeDownloads[progress.id] = progress;
      if (_gp.overlayEl && _gp.overlayEl.classList.contains('gp-visible') && _gp.activeTab === 'downloads') {
        gpRenderDownloadsTab();
      }
    });
  }

  if (window.galamtorAPI && typeof window.galamtorAPI.onDownloadDone === 'function') {
    window.galamtorAPI.onDownloadDone((meta) => {
      delete _gp.activeDownloads[meta.id];
      if (meta.state === 'completed') {
        gpShowDownloadToast('📥 Жүктеу аяқталды', `${meta.filename} сәтті жүктелді.`);
      } else if (meta.state === 'cancelled') {
        gpShowDownloadToast('⚠️ Жүктеу тоқтатылды', `${meta.filename} тоқтатылды.`);
      } else {
        gpShowDownloadToast('❌ Жүктеу қатесі', `${meta.filename} жүктеу сәтсіз аяқталды.`);
      }
      if (_gp.overlayEl && _gp.overlayEl.classList.contains('gp-visible') && _gp.activeTab === 'downloads') {
        gpRenderDownloadsTab();
      }
    });
  }

  logo.addEventListener('click', (e) => {
    e.stopPropagation();
    const lock = GalamtorStore.getLock();
    if (lock.enabled && lock.pinHash && !_gp.sessionUnlocked) {
      _gp.openModalAfterUnlock = true;
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

  // In-App Keydown Route: Toggle settings drawer with plain 'G' key
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const activeEl = document.activeElement;
      if (activeEl) {
        const tagName = activeEl.tagName.toLowerCase();
        if (
          tagName === 'input' ||
          tagName === 'textarea' ||
          activeEl.isContentEditable ||
          tagName === 'webview'
        ) {
          return;
        }
      }

      e.preventDefault();

      const lock = GalamtorStore.getLock();
      if (lock.enabled && lock.pinHash && !_gp.sessionUnlocked) {
        if (_gp.gateEl && _gp.gateEl.classList.contains('gp-visible')) {
          gpCloseGate();
        } else {
          _gp.openModalAfterUnlock = true;
          gpOpenGate();
        }
      } else {
        if (_gp.overlayEl && _gp.overlayEl.classList.contains('gp-visible')) {
          gpCloseModal();
        } else {
          gpOpenModal();
        }
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

  // ── Firebase Auth & IPC Listeners ──

  // Guard flag: prevents onAuthStateChanged from re-rendering the profile UI
  // while signInWithCredential is still in flight. Without this, the intermediate
  // state transitions cause the button to re-paint into 'connecting' and the user
  // sees an infinite spinner.
  let _signInInProgress = false;

  auth.onAuthStateChanged(async (user) => {
    // Do not interrupt a credential sign-in that is already in progress.
    // The .then() handler below will update state and re-render when done.
    if (_signInInProgress) return;

    if (user) {
      _gp.syncState = 'connected';
      localStorage.setItem('gp_sync_state', 'connected');

      const stats = {
        openTabsCount: tabs.length,
        pinnedTabsCount: dockIcons.querySelectorAll('.dock-btn[data-url]').length,
        vibesCount: GalamtorStore.getVibes().length,
        registrationDate: getRegistrationDate()
      };
      await syncProfileStats(user.uid, stats);
    } else {
      _gp.syncState = 'disconnected';
      localStorage.setItem('gp_sync_state', 'disconnected');
    }

    // Refresh modal UI if active — only when not mid sign-in
    if (_gp.overlayEl && _gp.overlayEl.classList.contains('gp-visible') && _gp.activeTab === 'profile') {
      gpRenderProfileTab();
    }
  });

  // ── IPC: Receive Google credential from the Main Process loopback server ──
  //
  // The payload is now an object: { googleIdToken, googleAccessToken, email, ... }
  // sent by index.js after it parsed the JSON POST body from auth-redirect.html.
  //
  // CRITICAL: We must use the Google OIDC ID Token (from result.credential.idToken
  // on the Firebase Hosting page) NOT a Firebase ID Token (from user.getIdToken()).
  // GoogleAuthProvider.credential(idToken, accessToken) requires Google's own token.
  if (window.galamtorAPI && typeof window.galamtorAPI.onFirebaseAuthToken === 'function') {
    window.galamtorAPI.onAuthServerError?.((code) => showToast(`Google кіру сервері қосылмады: ${code}`));
    window.galamtorAPI.onFirebaseAuthToken((payload) => {
    // Normalize: support both the new object shape and a legacy plain-string fallback
    // so that existing sessions during a partial deploy are not broken.
    let googleIdToken, googleAccessToken;
    if (payload && typeof payload === 'object') {
      ({ googleIdToken, googleAccessToken } = payload);
    } else if (typeof payload === 'string') {
      // Legacy path — plain string was a Firebase ID Token; this will likely fail
      // with auth/invalid-credential but at least we log it clearly.
      console.warn('[Auth] Received legacy plain-string token — upgrade auth-redirect.html on Firebase Hosting.');
      googleIdToken = payload;
    }

    if (!googleIdToken && !googleAccessToken) {
      console.error('[Auth] firebase-auth-token payload contained no usable credential tokens.');
      showToast('⚠️ Синхрондау қатесі: токен жоқ');
      _gp.syncState = 'disconnected';
      localStorage.setItem('gp_sync_state', 'disconnected');
      gpRenderProfileTab();
      return;
    }

    // Build a proper Google OAuthCredential.
    // First argument: Google ID Token (OIDC), Second: Google Access Token.
    // Either can be null independently — Firebase accepts a credential with only one.
    const credential = firebase.auth.GoogleAuthProvider.credential(
      googleIdToken   || null,
      googleAccessToken || null
    );

    _signInInProgress = true;
    console.log('[Auth] Calling signInWithCredential with Google credential...');

    auth.signInWithCredential(credential)
      .then(async (result) => {
        _signInInProgress = false;
        _gp.syncState = 'connected';
        localStorage.setItem('gp_sync_state', 'connected');
        showToast('✅ Google-мен синхрондау сәтті аяқталды!');
        console.log('[Auth] signInWithCredential succeeded. User:', result.user.email);

        const stats = {
          openTabsCount: tabs.length,
          pinnedTabsCount: dockIcons.querySelectorAll('.dock-btn[data-url]').length,
          vibesCount: GalamtorStore.getVibes().length,
          registrationDate: getRegistrationDate()
        };
        await syncProfileStats(result.user.uid, stats);

        // Re-render profile tab once, now that state is settled
        if (_gp.overlayEl && _gp.overlayEl.classList.contains('gp-visible') && _gp.activeTab === 'profile') {
          gpRenderProfileTab();
        }
      })
      .catch((err) => {
        _signInInProgress = false;
        _gp.syncState = 'disconnected';
        localStorage.setItem('gp_sync_state', 'disconnected');
        console.error('[Auth] signInWithCredential error:', err.code, err.message);

        // Provide a human-readable toast for the most common error
        if (err.code === 'auth/invalid-credential') {
          showToast('⚠️ Куәлік жарамсыз. Хостингтегі auth-redirect.html нұсқасын тексеріңіз.');
        } else if (err.code === 'auth/account-exists-with-different-credential') {
          showToast('⚠️ Бұл email басқа жүйеге кіру әдісімен тіркелген.');
        } else {
          showToast('⚠️ Синхрондау қатесі: ' + err.code);
        }
        gpRenderProfileTab();
      });
    });
  }
}

// ── 12. INITIALIZE ───────────────────────────────────────────────
gpInitProfileHub();
updateWorkspaceTooltip();

const startupLang = localStorage.getItem('galamtor_language') || 'kk';
if (window.galamtorAPI && typeof window.galamtorAPI.setLanguage === 'function') {
  window.galamtorAPI.setLanguage(startupLang);
}
gpApplyLanguage(startupLang);

// Apply stored active vibe color on startup
const activeVibeId = GalamtorStore.getActiveVibeId();
if (activeVibeId) {
  const vibes = GalamtorStore.getVibes();
  const activeVibe = vibes.find(v => v.id === activeVibeId);
  if (activeVibe && activeVibe.accentColor) {
    gpApplyVibeAccentColor(activeVibe.accentColor);
  }
}

// ── 13. BOOKMARKS, HISTORY & DOWNLOADS PANEL RENDERING ─────────────

async function gpRenderBookmarksTab() {
  const panel = _gp.overlayEl.querySelector('#gp-panel-bookmarks');
  if (!panel) return;
  panel.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:center; padding: 40px;">
      <span class="gp-spinner"></span>
    </div>
  `;

  try {
    const bookmarks = (window.galamtorAPI && window.galamtorAPI.getBookmarks) ? await window.galamtorAPI.getBookmarks() : [];
    let bHtml = '';
    if (bookmarks && bookmarks.length > 0) {
      bHtml = bookmarks.map(b => {
        const domain = extractDomain(b.url);
        const fav = b.favicon || `https://www.google.com/s2/favicons?domain=${domain}`;
        return `
          <div class="gp-bookmark-item" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(255,255,255,0.015);border:1px solid rgba(255,255,255,0.03);border-radius:10px;transition:all 0.2s ease;gap:10px;">
            <img src="${escapeAttr(safeHttpUrl(fav))}" style="width:16px;height:16px;border-radius:3px;flex-shrink:0;" onerror="this.src='https://www.google.com/s2/favicons?domain=google.com'">
            <div style="flex:1;min-width:0;cursor:pointer;" class="gp-bm-click" data-url="${escapeAttr(b.url)}">
              <div style="font-size:13px;font-weight:500;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(b.title)}</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(b.url)}</div>
            </div>
            <button class="gp-btn-delete-bm" data-id="${escapeAttr(b.id)}" style="background:transparent;border:none;color:rgba(255,255,255,0.3);font-size:16px;cursor:pointer;padding:4px;border-radius:4px;" title="Өшіру">×</button>
          </div>
        `;
      }).join('');
    } else {
      bHtml = `<div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.25);font-size:13px;">Бетбелгілер бос. ⌘D арқылы сайттарды қосыңыз.</div>`;
    }

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;margin-top:10px;">
        <h3 style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.7);margin:0;">Бетбелгілер (${bookmarks ? bookmarks.length : 0})</h3>
        <button class="gp-btn gp-btn-primary" id="gp-add-current-bm-btn" style="padding:5px 10px;font-size:10px;">+ Ағымдағы бетті қосу</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto;padding-right:4px;">
        ${bHtml}
      </div>
    `;

    panel.querySelectorAll('.gp-bm-click').forEach(el => {
      el.addEventListener('click', () => {
        navigateTo(el.dataset.url);
        gpCloseModal();
      });
    });

    panel.querySelectorAll('.gp-btn-delete-bm').forEach(btn => {
      btn.addEventListener('click', async () => {
        await window.galamtorAPI.removeBookmark(btn.dataset.id);
        currentBookmarks = await window.galamtorAPI.getBookmarks();
        renderBookmarksBar();
        updateBookmarkButtonState();
        showToast('🗑️ Бетбелгі өшірілді');
        gpRenderBookmarksTab();
      });
    });

    const addBtn = panel.querySelector('#gp-add-current-bm-btn');
    if (addBtn) {
      addBtn.addEventListener('click', async () => {
        await toggleBookmarkCurrent();
        gpRenderBookmarksTab();
      });
    }
  } catch (err) {
    console.error(err);
    panel.textContent = `Қате: ${err.message}`;
  }
}

async function gpRenderHistoryTab() {
  const panel = _gp.overlayEl.querySelector('#gp-panel-history');
  panel.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:center; padding: 40px;">
      <span class="gp-spinner"></span>
    </div>
  `;
  
  try {
    const history = (window.galamtorAPI && window.galamtorAPI.getHistory) ? await window.galamtorAPI.getHistory() : [];
    
    let historyHtml = '';
    if (history && history.length > 0) {
      const groups = {};
      history.forEach(item => {
        const dateStr = new Date(item.timestamp).toLocaleDateString('kk-KZ', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        if (!groups[dateStr]) groups[dateStr] = [];
        groups[dateStr].push(item);
      });
      
      for (const [date, items] of Object.entries(groups)) {
        historyHtml += `
          <div class="gp-history-group" style="margin-bottom: 20px;">
            <div class="gp-label" style="margin-bottom: 8px; color: rgba(255,255,255,0.3); font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">${date}</div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${items.map(item => {
                const timeStr = new Date(item.timestamp).toLocaleTimeString('kk-KZ', { hour: '2-digit', minute: '2-digit' });
                return `
                  <div class="gp-history-item" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.03); border-radius: 10px; transition: all 0.2s ease;">
                    <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; margin-right: 12px;">
                      <div class="gp-history-title" style="font-size: 13px; font-weight: 500; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; text-align: left;" title="${escapeAttr(item.url)}">${escapeHtml(item.title)}</div>
                      <div class="gp-history-url" style="font-size: 11px; color: rgba(255,255,255,0.35); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; text-align: left;" title="${escapeAttr(item.url)}">${escapeHtml(item.url)}</div>
                    </div>
                    <div style="font-size: 11px; color: rgba(255,255,255,0.25); font-weight: 500; flex-shrink: 0;">${timeStr}</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }
    } else {
      historyHtml = `
        <div style="text-align:center; padding: 40px 20px; color: rgba(255,255,255,0.25); font-size: 13px;">
          Тарих таза. Беттерге кіргенде мұнда көрсетіледі.
        </div>
      `;
    }
    
    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; margin-top: 10px;">
        <h3 style="font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.7); margin: 0;">Қарау тарихы</h3>
        ${(history && history.length > 0) ? `<button class="gp-link-btn-danger" id="gp-clear-history-btn">Тарихты тазалау</button>` : ''}
      </div>
      <div class="gp-history-list-container" style="flex: 1; overflow-y: auto; padding-right: 4px;">
        ${historyHtml}
      </div>
    `;
    
    const clearBtn = panel.querySelector('#gp-clear-history-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        gpConfirm('Тарихты тазалау?', 'Қарау тарихыңыз толықтай өшіріледі.', async () => {
          await window.galamtorAPI.clearHistory();
          showToast('🧹 Тарих сәтті тазартылды');
          gpRenderHistoryTab();
        });
      });
    }

    panel.querySelectorAll('.gp-history-title, .gp-history-url').forEach(el => {
      el.addEventListener('click', () => {
        const url = el.getAttribute('title');
        if (url) {
          createTab(url);
          gpCloseModal();
        }
      });
    });
  } catch (err) {
    console.error(err);
    panel.innerHTML = `
      <div style="text-align:center; padding: 20px; color: #ff416c; font-size: 13px;">
        Тарихты жүктеу сәтсіз аяқталды: ${escapeHtml(err.message)}
      </div>
    `;
  }
}

async function gpRenderDownloadsTab() {
  const panel = _gp.overlayEl.querySelector('#gp-panel-downloads');
  panel.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:center; padding: 40px;">
      <span class="gp-spinner"></span>
    </div>
  `;
  
  try {
    const completed = (window.galamtorAPI && window.galamtorAPI.getDownloads) ? await window.galamtorAPI.getDownloads() : [];
    const allDownloads = [];
    
    // Active downloads first
    Object.values(_gp.activeDownloads).forEach(item => {
      allDownloads.push({
        id: item.id,
        filename: item.filename,
        savePath: '',
        totalBytes: item.totalBytes,
        receivedBytes: item.receivedBytes,
        percent: item.percent,
        state: item.state,
        isActive: true,
        completedAt: Date.now()
      });
    });
    
    // Completed/Done downloads
    completed.forEach(item => {
      allDownloads.push({
        id: item.id,
        filename: item.filename,
        savePath: item.savePath,
        totalBytes: item.totalBytes,
        receivedBytes: item.totalBytes,
        percent: 100,
        state: item.state,
        isActive: false,
        completedAt: item.completedAt
      });
    });
    
    let downloadsHtml = '';
    if (allDownloads.length > 0) {
      downloadsHtml = allDownloads.map(item => {
        const sizeStr = formatBytes(item.totalBytes);
        const timeStr = new Date(item.completedAt).toLocaleDateString('kk-KZ') + ' ' + 
                        new Date(item.completedAt).toLocaleTimeString('kk-KZ', { hour: '2-digit', minute: '2-digit' });
        
        let statusText = '';
        let progressHtml = '';
        let actionBtnHtml = '';
        
        if (item.isActive) {
          statusText = `Жүктелуде... ${item.percent}% (${formatBytes(item.receivedBytes)} / ${sizeStr})`;
          progressHtml = `
            <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; margin-top: 6px;">
              <div style="width: ${item.percent}%; height: 100%; background: var(--accent-blue, #00f2fe); transition: width 0.1s ease;"></div>
            </div>
          `;
        } else {
          if (item.state === 'completed') {
            statusText = `Аяқталды · ${sizeStr} · ${timeStr}`;
            actionBtnHtml = `
              <button class="gp-action-link gp-open-file-btn" data-filepath="${escapeAttr(item.savePath)}">Ашу</button>
            `;
          } else if (item.state === 'cancelled') {
            statusText = `Бас тартылды · ${sizeStr}`;
          } else {
            statusText = `Қате немесе тоқтатылды · ${sizeStr}`;
          }
        }
        
        return `
          <div class="gp-download-item">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
              <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                ${getFileIconSVG(item.filename)}
                <div class="gp-download-filename" style="font-size: 13px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;" title="${escapeAttr(item.filename)}">${escapeHtml(item.filename)}</div>
              </div>
              <div style="flex-shrink: 0;">
                ${actionBtnHtml}
              </div>
            </div>
            <div style="font-size: 11px; color: rgba(255,255,255,0.35); text-align: left; padding-left: 26px;">${statusText}</div>
            ${progressHtml}
          </div>
        `;
      }).join('');
    } else {
      downloadsHtml = `
        <div style="text-align:center; padding: 40px 20px; color: rgba(255,255,255,0.25); font-size: 13px;">
          Жүктеулер таза. Файлдар жүктелгенде мұнда көрсетіледі.
        </div>
      `;
    }
    
    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; margin-top: 10px;">
        <h3 style="font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.7); margin: 0;">Жүктеулер</h3>
        ${(completed && completed.length > 0) ? `<button class="gp-link-btn-danger" id="gp-clear-downloads-btn">Тарихты тазалау</button>` : ''}
      </div>
      <div class="gp-downloads-list-container" style="flex: 1; overflow-y: auto; padding-right: 4px;">
        ${downloadsHtml}
      </div>
    `;
    
    const clearBtn = panel.querySelector('#gp-clear-downloads-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        gpConfirm('Жүктеу тарихын тазалау?', 'Жүктелген файлдардың тізімі өшіріледі (файлдардың өздері дискіден жойылмайды).', async () => {
          await window.galamtorAPI.clearDownloads();
          showToast('🧹 Жүктеулер тарихы тазартылды');
          gpRenderDownloadsTab();
        });
      });
    }
    
    panel.querySelectorAll('.gp-open-file-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const filePath = btn.dataset.filepath;
        if (filePath) {
          const res = await window.galamtorAPI.openPath(filePath);
          if (res !== 'success') {
            showToast(`⚠️ Файлды ашу мүмкін емес: ${res}`);
          }
        }
      });
    });
  } catch (err) {
    console.error(err);
    panel.innerHTML = `
      <div style="text-align:center; padding: 20px; color: #ff416c; font-size: 13px;">
        Жүктеулерді алу сәтсіз аяқталды: ${err.message}
      </div>
    `;
  }
}

function getFileIconSVG(filename) {
  try {
    const ext = (filename || '').split('.').pop().toLowerCase();
    
    // SVG paths for modern document, image, archive, code icons
    const documentPath = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>';
    const imagePath = '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>';
    const archivePath = '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>';
    const codePath = '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>';
    
    let path = documentPath;
    let strokeColor = 'rgba(255, 255, 255, 0.45)';
    
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) {
      path = imagePath;
      strokeColor = '#00f2fe'; // cyan
    } else if (['zip', 'rar', '7z', 'tar', 'gz', 'dmg', 'iso'].includes(ext)) {
      path = archivePath;
      strokeColor = '#ffbd2e'; // orange/yellow
    } else if (['js', 'html', 'css', 'py', 'json', 'c', 'cpp', 'ts', 'sh', 'java'].includes(ext)) {
      path = codePath;
      strokeColor = '#27c93f'; // green
    } else if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'].includes(ext)) {
      path = documentPath;
      strokeColor = '#ff5f56'; // red/pink
    }
    
    return `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
        ${path}
      </svg>
    `;
  } catch (err) {
    console.error("Error generating file icon:", err);
    return '📦'; // Safe fallback
  }
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ── AdBlocker UI Handlers ──
const btnAdBlock = document.getElementById('btn-adblock');
if (btnAdBlock) {
  btnAdBlock.addEventListener('click', async () => {
    if (window.galamtorAPI && window.galamtorAPI.toggleAdBlock) {
      const enabled = await window.galamtorAPI.toggleAdBlock();
      btnAdBlock.classList.toggle('active-shield', enabled);
      const stats = await window.galamtorAPI.getAdBlockStats();
      showToast(enabled 
        ? `AdBlock белсенді (${stats.count} жарнама бұғатталды)` 
        : `AdBlock өшірілді`
      );
    }
  });
}

if (window.galamtorAPI && window.galamtorAPI.onAdBlockedCount) {
  window.galamtorAPI.onAdBlockedCount((count) => {
    if (btnAdBlock) {
      btnAdBlock.title = `AdBlock & Privacy Shield (${count} жарнама бұғатталды)`;
    }
  });
}

// ── Session Auto-Save & Auto-Restore System ──
let _sessionRestoreComplete = false;

function persistCurrentSession() {
  try {
    if (!window.galamtorAPI || !window.galamtorAPI.saveSession) return;
    const sessionTabs = tabs
      .filter(t => !t.isIncognito && t.url && !t.isHome)
      .map((t, i) => ({
        url: t.url,
        title: t.title || t.url,
        isActive: t.id === activeTabId
      }));
    window.galamtorAPI.saveSession(sessionTabs).catch(() => {});
  } catch (err) {
    console.error('[Session] Persist error:', err);
  }
}

async function restorePreviousSession() {
  try {
    if (!window.galamtorAPI || !window.galamtorAPI.loadSession) {
      _sessionRestoreComplete = true;
      return;
    }
    const savedTabs = await window.galamtorAPI.loadSession();
    if (Array.isArray(savedTabs) && savedTabs.length > 0) {
      const homeTabs = tabs.filter(t => t.isHome);
      let activeIndex = savedTabs.findIndex(st => st.isActive);
      if (activeIndex === -1) activeIndex = savedTabs.length - 1;

      savedTabs.forEach((st, i) => {
        if (st.url) {
          const tabId = createTab(st.url);
          // Restore saved title immediately (will be overwritten when page loads)
          const tab = tabs.find(t => t.id === tabId);
          if (tab && st.title) {
            tab.title = st.title;
            updateTabTitle(tabId, st.title);
          }
        }
      });

      // Activate the tab that was active when session was saved
      const restoredTabs = tabs.filter(t => !t.isHome);
      if (restoredTabs[activeIndex]) {
        activateTab(restoredTabs[activeIndex].id);
      }

      // Close initial home tabs
      homeTabs.forEach(ht => closeTab(ht.id));
    }
  } catch (err) {
    console.error('[Session] Restore error:', err);
  } finally {
    _sessionRestoreComplete = true;
  }
}

// Restore session immediately on DOMContentLoaded (no race condition delay)
window.addEventListener('DOMContentLoaded', () => {
  restorePreviousSession();
});

// Save session before app closes
window.addEventListener('beforeunload', () => {
  persistCurrentSession();
});

// Secure IPC: handle open-image-in-new-tab from main process (replaces executeJavaScript XSS)
if (window.galamtorAPI && window.galamtorAPI.onOpenImageInNewTab) {
  window.galamtorAPI.onOpenImageInNewTab((url) => {
    if (url) createTab(url);
  });
}
if (window.galamtorAPI?.onPopupTab) {
  window.galamtorAPI.onPopupTab((popupUrl) => createTab(popupUrl));
}

// ── Command Palette (Cmd+K / Ctrl+K) ──
let commandPaletteEl = null;

function openCommandPalette() {
  if (!commandPaletteEl) {
    commandPaletteEl = document.createElement('div');
    commandPaletteEl.className = 'command-palette-overlay';
    commandPaletteEl.innerHTML = `
      <div class="command-palette-card">
        <div class="command-palette-input-wrapper">
          <input type="text" class="command-palette-input" id="cp-input" placeholder="Іздеу (Қойындылар, Тарих, Баптаулар)..." autocomplete="off">
        </div>
        <div class="command-palette-results" id="cp-results"></div>
      </div>
    `;
    document.body.appendChild(commandPaletteEl);
    commandPaletteEl.addEventListener('click', (e) => {
      if (e.target === commandPaletteEl) closeCommandPalette();
    });
  }

  const input = commandPaletteEl.querySelector('#cp-input');
  input.value = '';
  renderCommandPaletteResults('');
  commandPaletteEl.classList.add('active');
  setTimeout(() => input.focus(), 50);

  input.oninput = (e) => renderCommandPaletteResults(e.target.value);
}

function closeCommandPalette() {
  if (commandPaletteEl) commandPaletteEl.classList.remove('active');
}

function renderCommandPaletteResults(query) {
  if (!commandPaletteEl) return;
  const resultsContainer = commandPaletteEl.querySelector('#cp-results');
  resultsContainer.innerHTML = '';
  const q = query.trim().toLowerCase();

  const matches = [];

  // Open Tabs
  tabs.forEach(t => {
    if (!q || (t.title && t.title.toLowerCase().includes(q)) || (t.url && t.url.toLowerCase().includes(q))) {
      matches.push({ type: 'tab', title: t.title || 'Қойынды', sub: t.url || 'Жаңа қойынды', action: () => { activateTab(t.id); closeCommandPalette(); } });
    }
  });

  // Browser Actions
  const commands = [
    { title: 'AI Авто-Жүктеу (Ашық сайтты/файлды сақтау)', sub: 'AI Auto-Downloader', action: () => { handleAiDownloadCommand(''); closeCommandPalette(); } },
    { title: 'Жаңа қойынды ашу', sub: 'Cmd+T', action: () => { createTab(); closeCommandPalette(); } },
    { title: 'Жеке режимде қойынды ашу (Incognito)', sub: 'Cmd+Shift+N', action: () => { createTab('https://www.google.com', true); closeCommandPalette(); } },
    { title: 'AdBlock қосу/өшіру', sub: 'Privacy Shield', action: () => { btnAdBlock?.click(); closeCommandPalette(); } },
    { title: 'Workspace тақтасын ашу', sub: 'Cmd+G', action: () => { gpOpenModal(); closeCommandPalette(); } }
  ];
  commands.forEach(cmd => {
    if (!q || cmd.title.toLowerCase().includes(q)) {
      matches.push({ type: 'command', title: cmd.title, sub: cmd.sub, action: cmd.action });
    }
  });

  matches.slice(0, 10).forEach(item => {
    const row = document.createElement('div');
    row.className = 'cp-item';
    const title = document.createElement('div');
    title.className = 'cp-item-title';
    title.textContent = item.title;
    const subtitle = document.createElement('div');
    subtitle.className = 'cp-item-sub';
    subtitle.textContent = item.sub;
    row.append(title, subtitle);
    row.onclick = item.action;
    resultsContainer.appendChild(row);
  });
}

// ── Global Keyboard Shortcuts ──
window.addEventListener('keydown', (e) => {
  // Cmd+K or Ctrl+K: Command Palette
  if ((e.metaKey || e.ctrlKey) && (e.key === 'K' || e.key === 'k')) {
    e.preventDefault();
    openCommandPalette();
    return;
  }

  // Cmd+Shift+N or Ctrl+Shift+N: New Incognito Tab
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
    e.preventDefault();
    createTab('https://www.google.com', true);
    showToast('Жеке режим қосылды');
    return;
  }

  if (e.key === 'Escape') {
    closeCommandPalette();
  }
});

// ── Welcome Clock & Date Widget ──
const KK_WEEKDAYS = ['жексенбі', 'дүйсенбі', 'сейсенбі', 'сәрсенбі', 'бейсенбі', 'жұма', 'сенбі'];
const KK_MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];

function updateWelcomeClock() {
  try {
    const timeEl = document.getElementById('clock-time-display');
    const dateEl = document.getElementById('clock-date-display');
    if (!timeEl || !dateEl) return;

    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    timeEl.textContent = `${hours}:${minutes}`;

    const day = now.getDate();
    const month = KK_MONTHS[now.getMonth()];
    const weekday = KK_WEEKDAYS[now.getDay()];
    dateEl.textContent = `${day} ${month}, ${weekday}`;
  } catch (err) {
    console.error('Error updating welcome clock:', err);
  }
}

setInterval(updateWelcomeClock, 1000);
updateWelcomeClock();

// ── Galamtor AI Assistant ──

// AI Chat State
const aiChatHistory = [];
let aiIsProcessing = false;

function speakKazakhText(text) {
  try {
    const ttsBtn = document.getElementById('ai-tts-btn');
    if (!('speechSynthesis' in window)) {
      showToast('⚠️ Дыбыстау қолжетімсіз');
      return;
    }
    window.speechSynthesis.cancel();
    ttsBtn?.classList.remove('speaking');

    const cleanText = (text || '').replace(/<[^>]*>/g, '').trim();
    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'kk-KZ';
    utterance.rate = 0.95;

    const voices = window.speechSynthesis.getVoices();
    const kkVoice = voices.find(v => (v.lang && v.lang.includes('kk')) || (v.name && v.name.toLowerCase().includes('kazakh')));
    if (kkVoice) utterance.voice = kkVoice;

    utterance.onstart = () => ttsBtn?.classList.add('speaking');
    utterance.onend = () => ttsBtn?.classList.remove('speaking');
    utterance.onerror = () => ttsBtn?.classList.remove('speaking');

    window.speechSynthesis.speak(utterance);
    showToast('🔊 Қазақша дыбысталуда...');
  } catch (err) {
    console.error('Error speaking text:', err);
  }
}

async function extractPageDownloadableFiles() {
  const activeTab = tabs.find(t => t.id === activeTabId);
  const wv = getActiveWebview();
  if (!wv || !activeTab || activeTab.isHome) return [];

  try {
    const files = await wv.executeJavaScript(`
      (() => {
        const results = [];
        const seen = new Set();
        const fileRegex = /\\.(dmg|pkg|zip|exe|tar|gz|mp4|mp3|pdf|iso|dmg\\?|pkg\\?|zip\\?)/i;
        
        document.querySelectorAll('a[href], button[onclick], source[src]').forEach(el => {
          const href = el.href || el.src || '';
          const text = (el.innerText || el.title || el.getAttribute('aria-label') || '').trim();
          if (href && !seen.has(href)) {
            if (fileRegex.test(href) || el.hasAttribute('download') || href.toLowerCase().includes('download')) {
              seen.add(href);
              let filename = href.split('/').pop().split('?')[0] || 'Файл';
              if (filename.length > 30) filename = filename.slice(0, 27) + '...';
              
              let ext = 'FILE';
              const extMatch = href.match(/\\.(dmg|pkg|zip|exe|mp4|mp3|pdf)/i);
              if (extMatch) ext = extMatch[1].toUpperCase();

              results.push({ url: href, name: text || filename, ext });
            }
          }
        });
        return results.slice(0, 8);
      })()
    `);
    return files || [];
  } catch (err) {
    console.error('[AI File Extractor] Error:', err);
    return [];
  }
}

// ── AI Chat UI Functions ──

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
function escapeAttr(text) {
  return String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function safeHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch { return ''; }
}

function simpleMarkdownToHtml(text) {
  // Convert markdown to HTML for AI responses — enhanced renderer
  let html = text;

  // 1. Extract and preserve code blocks first (prevent inner transformations)
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length;
    const escapedCode = escapeHtml(code.trim());
    const langLabel = lang ? `<div class="code-lang-label">${lang}</div>` : '';
    codeBlocks.push(`<div class="code-block-wrapper">${langLabel}<pre><code class="lang-${lang || 'text'}">${escapedCode}</code></pre></div>`);
    return `%%CODEBLOCK_${idx}%%`;
  });

  // 2. Escape remaining HTML
  html = escapeHtml(html);

  // 3. Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Unordered lists — group consecutive items
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>(?:<br>)?\n?)+)/g, (match) => {
    const cleaned = match.replace(/<br>/g, '');
    return `<ul>${cleaned}</ul>`;
  });

  // Ordered lists — group consecutive numbered items
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, target) => {
    const safeTarget = safeHttpUrl(target.replace(/&amp;/g, '&'));
    return safeTarget ? `<a href="${escapeAttr(safeTarget)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  });

  // Line breaks (but not inside block elements)
  html = html.replace(/\n/g, '<br>');
  // Clean up excessive breaks after block elements
  html = html.replace(/(<\/h[2-4]>)<br>/g, '$1');
  html = html.replace(/(<\/ul>)<br>/g, '$1');
  html = html.replace(/(<\/blockquote>)<br>/g, '$1');
  html = html.replace(/(<hr>)<br>/g, '$1');

  // 4. Restore code blocks
  codeBlocks.forEach((block, idx) => {
    html = html.replace(`%%CODEBLOCK_${idx}%%`, block);
  });

  return html;
}

function formatTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('kk-KZ', { hour: '2-digit', minute: '2-digit' });
}

function addChatMessage(role, content) {
  const container = document.getElementById('ai-chat-messages');
  if (!container) return;

  // Remove welcome message on first interaction
  const welcomeMsg = container.querySelector('.ai-welcome-msg');
  if (welcomeMsg) welcomeMsg.remove();

  const wrapper = document.createElement('div');
  wrapper.className = `ai-msg-wrapper ai-msg-${role}-wrapper`;

  const bubble = document.createElement('div');
  bubble.className = `ai-msg-bubble ai-msg-${role}`;

  if (role === 'user') {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = simpleMarkdownToHtml(content);
  }

  const timestamp = document.createElement('div');
  timestamp.className = 'ai-msg-timestamp';
  timestamp.textContent = formatTimestamp();

  wrapper.appendChild(bubble);
  wrapper.appendChild(timestamp);
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;

  // Store in history for multi-turn conversation
  aiChatHistory.push({ role, content: typeof content === 'string' ? content : '' });

  return bubble;
}

function showTypingIndicator() {
  const container = document.getElementById('ai-chat-messages');
  if (!container) return null;

  const indicator = document.createElement('div');
  indicator.className = 'ai-typing-indicator';
  indicator.id = 'ai-typing';
  indicator.innerHTML = '<span></span><span></span><span></span>';
  container.appendChild(indicator);
  container.scrollTop = container.scrollHeight;
  return indicator;
}

function removeTypingIndicator() {
  const indicator = document.getElementById('ai-typing');
  if (indicator) indicator.remove();
}

async function getActivePageContent() {
  const wv = getActiveWebview();
  if (!wv) return '';
  try {
    const text = await wv.executeJavaScript(`
      (() => {
        const sel = document.querySelector('article') || document.querySelector('main') || document.body;
        return (sel.innerText || '').substring(0, 8000);
      })()
    `);
    return text || '';
  } catch { return ''; }
}

async function sendAiMessage(userPrompt) {
  if (aiIsProcessing || !userPrompt.trim()) return;
  const trimmed = userPrompt.trim();

  // If user pasted an API Key starting with AIza into the chat field
  if (trimmed.startsWith('AIza')) {
    addChatMessage('ai', '🔑 API кілтін чатқа емес, ⚙️ **AI баптауларына** енгізіңіз.');
    return;
  }

  aiIsProcessing = true;

  // Show user message
  addChatMessage('user', userPrompt);

  // Get page context
  const activeTab = tabs.find(t => t.id === activeTabId);
  const pageContext = {
    title: activeTab ? (activeTab.title || '') : '',
    url: activeTab ? (activeTab.url || '') : ''
  };

  // Show typing indicator
  showTypingIndicator();

  try {
    if (!window.galamtorAPI || !window.galamtorAPI.aiChat) {
      removeTypingIndicator();
      addChatMessage('ai', '⚠️ AI қолжетімсіз. Preload bridge табылмады.');
      aiIsProcessing = false;
      return;
    }

    // Build chat history for multi-turn context (last 20 messages)
    const recentHistory = aiChatHistory.slice(-20).filter(msg => msg.content && msg.content.trim());

    const response = await window.galamtorAPI.aiChat(userPrompt, pageContext, recentHistory);
    removeTypingIndicator();

    if (response && response.error) {
      addChatMessage('ai', `⚠️ ${response.error}`);
    } else if (response && response.text) {
      addChatMessage('ai', response.text);
    } else {
      addChatMessage('ai', '🤖 Жауап алу мүмкін болмады. Кейінірек қайталаңыз.');
    }
  } catch (err) {
    removeTypingIndicator();
    addChatMessage('ai', `⚠️ Қате: ${err.message || 'Белгісіз қате'}`);
  }

  aiIsProcessing = false;
}

async function aiSummarizePage() {
  if (aiIsProcessing) return;
  aiIsProcessing = true;

  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab || activeTab.isHome) {
    addChatMessage('ai', '📄 Түйіндеу үшін алдымен бір сайтты ашыңыз.');
    aiIsProcessing = false;
    return;
  }

  addChatMessage('user', `📄 Бетті түйінде: ${activeTab.title || activeTab.url}`);
  showTypingIndicator();

  try {
    const pageContent = await getActivePageContent();
    if (!pageContent || pageContent.trim().length < 50) {
      removeTypingIndicator();
      addChatMessage('ai', '⚠️ Беттен мәтін шығару мүмкін болмады немесе мәтін тым аз.');
      aiIsProcessing = false;
      return;
    }

    const response = await window.galamtorAPI.aiSummarize(pageContent, activeTab.title || '', activeTab.url || '');
    removeTypingIndicator();

    if (response && response.text) {
      addChatMessage('ai', response.text);
    } else if (response && response.error) {
      addChatMessage('ai', `⚠️ ${response.error}`);
    } else {
      addChatMessage('ai', '🤖 Түйіндеу мүмкін болмады.');
    }
  } catch (err) {
    removeTypingIndicator();
    addChatMessage('ai', `⚠️ Қате: ${err.message}`);
  }

  aiIsProcessing = false;
}

async function aiTranslatePage() {
  if (aiIsProcessing) return;
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab || activeTab.isHome) {
    addChatMessage('ai', '🌐 Аудару үшін алдымен бір сайтты ашыңыз.');
    return;
  }

  addChatMessage('user', `🌐 Бетті қазақ тіліне аудар: ${activeTab.title || activeTab.url}`);
  aiIsProcessing = true;
  showTypingIndicator();

  try {
    const pageContent = await getActivePageContent();
    if (!pageContent || pageContent.trim().length < 20) {
      removeTypingIndicator();
      addChatMessage('ai', '⚠️ Беттен мәтін шығару мүмкін болмады.');
      aiIsProcessing = false;
      return;
    }

    // Use aiChat with a translate prompt
    const translatePrompt = `Мына мәтінді қазақ тіліне аудар. Тек аударманы бер, басқа ештеңе жазба:\n\n${pageContent.substring(0, 4000)}`;
    const response = await window.galamtorAPI.aiChat(translatePrompt, { title: activeTab.title, url: activeTab.url });
    removeTypingIndicator();

    if (response && response.text) {
      addChatMessage('ai', response.text);
    } else if (response && response.error) {
      addChatMessage('ai', `⚠️ ${response.error}`);
    }
  } catch (err) {
    removeTypingIndicator();
    addChatMessage('ai', `⚠️ Қате: ${err.message}`);
  }

  aiIsProcessing = false;
}

// ── AI Sidebar Panel Controller ──

function openAiSidebarPanel() {
  const panel = document.getElementById('ai-sidebar-panel');
  if (!panel) return;

  const activeTab = tabs.find(t => t.id === activeTabId);
  const pageTitleEl = document.getElementById('ai-page-title');
  if (pageTitleEl) {
    pageTitleEl.textContent = activeTab ? (activeTab.title || activeTab.url || 'Жаңа қойынды') : 'Жаңа қойынды';
  }

  panel.classList.add('active');
  document.body.classList.add('ai-panel-active');
  document.getElementById('btn-toggle-ai-sidebar')?.classList.add('ai-panel-open');
  updateAiSidebarFilesList();

  // Focus input
  setTimeout(() => {
    const input = document.getElementById('ai-panel-input');
    if (input) input.focus();
  }, 300);
}

function closeAiSidebarPanel() {
  const panel = document.getElementById('ai-sidebar-panel');
  if (panel) panel.classList.remove('active');
  document.body.classList.remove('ai-panel-active');
  document.getElementById('btn-toggle-ai-sidebar')?.classList.remove('ai-panel-open');
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    document.getElementById('ai-tts-btn')?.classList.remove('speaking');
  }
}

function toggleAiSidebarPanel() {
  const panel = document.getElementById('ai-sidebar-panel');
  if (!panel) return;
  if (panel.classList.contains('active')) closeAiSidebarPanel();
  else openAiSidebarPanel();
}

async function updateAiSidebarFilesList() {
  const filesContainer = document.getElementById('ai-detected-files-list');
  const countBadge = document.getElementById('ai-files-count-badge');
  if (!filesContainer) return;

  filesContainer.innerHTML = '<div class="ai-empty-hint">Парақшадағы файлдар ізделуде...</div>';
  const files = await extractPageDownloadableFiles();

  if (countBadge) countBadge.textContent = `${files.length} файл`;

  // Auto-open details if files found
  const detailsEl = document.getElementById('ai-files-details');
  if (detailsEl && files.length > 0) detailsEl.open = true;

  if (files.length === 0) {
    filesContainer.innerHTML = '<div class="ai-empty-hint">Тікелей жүктелетін файл табылмады.</div>';
    return;
  }

  filesContainer.innerHTML = '';
  files.forEach(f => {
    const extClass = f.ext ? f.ext.toLowerCase() : 'gen';
    const row = document.createElement('div');
    row.className = 'ai-file-item';

    const tag = document.createElement('span');
    tag.className = `ai-file-type-tag ${extClass}`;
    tag.textContent = f.ext || 'FILE';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'ai-file-name';
    nameDiv.title = f.url;
    nameDiv.textContent = f.name;

    const dlBtn = document.createElement('button');
    dlBtn.className = 'ai-file-dl-btn';
    dlBtn.textContent = 'Жүктеу';
    dlBtn.onclick = () => {
      if (window.galamtorAPI && window.galamtorAPI.downloadURL) {
        window.galamtorAPI.downloadURL(f.url);
        showToast(`⬇️ ${f.name} жүктелуде`);
      }
    };

    row.appendChild(tag);
    row.appendChild(nameDiv);
    row.appendChild(dlBtn);
    filesContainer.appendChild(row);
  });
}

// ── AI Settings Modal ──

function openAiSettings() {
  const modal = document.getElementById('ai-settings-modal');
  if (!modal) return;
  modal.classList.add('active');

  // Show status only; the saved secret never leaves the main process.
  if (window.galamtorAPI && window.galamtorAPI.aiGetApiKey) {
    window.galamtorAPI.aiGetApiKey().then(settings => {
      const input = document.getElementById('ai-api-key-input');
      const status = document.getElementById('ai-key-status');
      const cloud = document.getElementById('ai-cloud-enabled');
      if (input) input.value = '';
      if (status) status.textContent = settings.hasApiKey ? 'API кілті қауіпсіз сақталған' : 'API кілті сақталмаған';
      if (cloud) cloud.checked = !!settings.cloudEnabled;
    });
  }
}

function closeAiSettings() {
  const modal = document.getElementById('ai-settings-modal');
  if (modal) modal.classList.remove('active');
}

async function saveAiSettings() {
  const input = document.getElementById('ai-api-key-input');
  if (!input) return;

  const apiKey = input.value.trim();
  if (window.galamtorAPI && window.galamtorAPI.aiSetApiKey) {
    if (apiKey && !(await window.galamtorAPI.aiSetApiKey(apiKey))) {
      showToast('API кілтін сақтау мүмкін болмады');
      return;
    }
    const enabled = !!document.getElementById('ai-cloud-enabled')?.checked;
    if (!(await window.galamtorAPI.aiSetCloudEnabled(enabled))) {
      showToast('Бұлттық AI үшін алдымен API кілтін енгізіңіз');
      return;
    }
    showToast('✅ AI баптаулары сақталды');
    closeAiSettings();
  }
}

function clearAiChat() {
  const container = document.getElementById('ai-chat-messages');
  if (!container) return;
  aiChatHistory.length = 0;
  container.innerHTML = `
    <div class="ai-welcome-msg">
      <div class="ai-sparkle-hero">🤖</div>
      <div class="ai-welcome-title">Galamtor AI көмекшісі</div>
      <div class="ai-welcome-subtitle">Жергілікті Ollama немесе рұқсат етілген Gemini қызметі</div>
      <div class="ai-welcome-hints">
        <span>📄 Бетті түйіндеу</span>
        <span>💻 Код жазу</span>
        <span>🌐 Аударма</span>
        <span>❓ Сұрақ қою</span>
      </div>
    </div>
  `;
}

// ── Wire up AI Sidebar Event Listeners ──
window.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('ai-panel-close');
  const inputForm = document.getElementById('ai-input-form');
  const inputEl = document.getElementById('ai-panel-input');
  const ttsBtn = document.getElementById('ai-tts-btn');
  const summarizeBtn = document.getElementById('ai-btn-summarize-page');
  const scanBtn = document.getElementById('ai-btn-scan-files');
  const translateBtn = document.getElementById('ai-btn-translate');
  const settingsBtn = document.getElementById('ai-panel-settings');
  const settingsSave = document.getElementById('ai-settings-save');
  const settingsClear = document.getElementById('ai-settings-clear');
  const settingsCancel = document.getElementById('ai-settings-cancel');
  const clearChatBtn = document.getElementById('ai-clear-chat');

  closeBtn?.addEventListener('click', closeAiSidebarPanel);
  clearChatBtn?.addEventListener('click', clearAiChat);

  // Form submit handles both Enter and button click
  inputForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = inputEl ? inputEl.value.trim() : '';
    if (!query) return;
    inputEl.value = '';
    sendAiMessage(query);
  });

  ttsBtn?.addEventListener('click', () => {
    // Speak the last AI message
    const messages = document.querySelectorAll('.ai-msg-ai');
    const lastMsg = messages[messages.length - 1];
    if (lastMsg) speakKazakhText(lastMsg.innerText);
    else showToast('Дыбыстайтын хабарлама жоқ');
  });

  summarizeBtn?.addEventListener('click', aiSummarizePage);

  scanBtn?.addEventListener('click', () => {
    updateAiSidebarFilesList();
    showToast('Парақша файлдары сканерленді');
  });

  translateBtn?.addEventListener('click', aiTranslatePage);

  settingsBtn?.addEventListener('click', openAiSettings);
  settingsSave?.addEventListener('click', saveAiSettings);
  settingsClear?.addEventListener('click', async () => {
    if (await window.galamtorAPI?.aiSetApiKey?.('')) {
      document.getElementById('ai-cloud-enabled').checked = false;
      showToast('🔑 API кілті жойылды');
      closeAiSettings();
    }
  });
  settingsCancel?.addEventListener('click', closeAiSettings);

  // Close settings modal on outside click
  const settingsModal = document.getElementById('ai-settings-modal');
  settingsModal?.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeAiSettings();
  });

  const toggleSidebarAiBtn = document.getElementById('btn-toggle-ai-sidebar');
  toggleSidebarAiBtn?.addEventListener('click', toggleAiSidebarPanel);

  // Initialize Cyber-Steppe Innovation Suite
  initCyberSteppeInnovations();
});

// ════════════════════════════════════════════════════════════
//  CYBER-STEPPE INNOVATIONS SUITE (2026 Qazaqstan Standards)
// ════════════════════════════════════════════════════════════

const KAZAKH_QUOTES = [
  { text: "Отан — отбасынан басталады. Білімді ел — бәрін де жеңеді.", author: "Абай Құнанбайұлы" },
  { text: "Өнер-білім бар жұрттар тастан сарай салғызды...", author: "Ыбырай Алтынсарин" },
  { text: "Туған жердің қадірін шетте жүрсең білерсің.", author: "Мағжан Жұмабаев" },
  { text: "Адамның адамшылығы — ақыл, ғылым, жақсы ата, жақсы ана, жақсы құрбы, жақсы ұстаздан болады.", author: "Абай Құнанбайұлы" },
  { text: "Ел боламын десең — бесігіңді түзе.", author: "Мұхтар Әуезов" },
  { text: "Адал еңбекпен табылған нан — бәрінен де тәтті.", author: "Шәкәрім Құдайбердіұлы" },
  { text: "Жүрегіңде от болса, жалыны өшпейді.", author: "Қасым Аманжолов" }
];

function initCyberSteppeInnovations() {
  // 1. Dynamic Daily Quote
  try {
    const quoteEl = document.getElementById('daily-quote-text');
    const authorEl = document.getElementById('daily-quote-author');
    if (quoteEl && authorEl) {
      const dayIndex = Math.floor(Date.now() / (1000 * 60 * 60 * 24)) % KAZAKH_QUOTES.length;
      const q = KAZAKH_QUOTES[dayIndex];
      quoteEl.textContent = q.text;
      authorEl.textContent = `— ${q.author}`;
    }
  } catch (e) {
    console.error('[CyberSteppe] Quote widget error:', e);
  }

  // 3. Gov & Fintech Secure Vault Listener
  if (window.galamtorAPI && window.galamtorAPI.onBankingShieldStatus) {
    window.galamtorAPI.onBankingShieldStatus((status) => {
      const vaultBadge = document.getElementById('badge-banking-vault');
      if (vaultBadge) {
        if (status && status.active) {
          vaultBadge.style.display = 'inline-flex';
          vaultBadge.title = `${status.host}: операциялық жүйе деңгейінде скриншоттан қорғау қосылды`;
          showToast(`🛡️ ${status.host}: скриншоттан қорғау қосылды`);
        } else {
          vaultBadge.style.display = 'none';
        }
      }
    });
  }

  // 4. Кибер-Қалқан Security Alert Listener
  if (window.galamtorAPI && window.galamtorAPI.onQalqanBlocked) {
    window.galamtorAPI.onQalqanBlocked((info) => {
      showToast(`🚨 Кибер-Қалқан: Алаяқтық сілтеме бұғатталды!`);
    });
  }

  // 6. Curated source links; no fabricated headlines or timestamps
  try {
    const NEWS_SVGS = {
      tech: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
      finance: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
      gov: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
      edu: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
      innov: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
      auto: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H6.5a1 1 0 0 0-.8.4L3 11l-2.16.86A1 1 0 0 0 0 12.85V16h3"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>`
    };

    const PORTAL_NEWS_ITEMS = [
      { source: 'Tengrinews.kz', time: 'Дереккөз', title: 'Tengrinews жаңалықтарын ашу', url: 'https://tengrinews.kz', svgKey: 'tech', gradient: 'linear-gradient(135deg, #0288d1 0%, #00bcd4 100%)' },
      { source: 'Informburo.kz', time: 'Дереккөз', title: 'Informburo жаңалықтарын ашу', url: 'https://informburo.kz', svgKey: 'finance', gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' },
      { source: 'eGov.kz', time: 'Ресми сайт', title: 'eGov қызметтерін ашу', url: 'https://egov.kz', svgKey: 'gov', gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' },
      { source: 'Baribar.kz', time: 'Дереккөз', title: 'Baribar материалдарын ашу', url: 'https://baribar.kz', svgKey: 'edu', gradient: 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)' },
      { source: 'Kazinform', time: 'Дереккөз', title: 'Kazinform жаңалықтарын ашу', url: 'https://inform.kz', svgKey: 'innov', gradient: 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)' },
      { source: 'Kolesa.kz', time: 'Дереккөз', title: 'Kolesa материалдарын ашу', url: 'https://kolesa.kz', svgKey: 'auto', gradient: 'linear-gradient(135deg, #0288d1 0%, #1565c0 100%)' }
    ];

    let currentNewsIndex = 0;
    const sourceEl = document.getElementById('portal-news-source');
    const titleEl = document.getElementById('portal-news-title');
    const timeEl = document.getElementById('portal-news-time');
    const contentEl = document.getElementById('portal-news-content');
    const btnPrev = document.getElementById('btn-news-prev');
    const btnNext = document.getElementById('btn-news-next');
    const btnRefresh = document.getElementById('btn-refresh-news');

    const updateCard = (cardId, item) => {
      const card = document.getElementById(cardId);
      if (!card || !item) return;
      const idx = cardId.slice(-1);
      const titleNode = document.getElementById(`safari-news-title-${idx}`);
      const srcNode = document.getElementById(`safari-news-src-${idx}`);
      const timeNode = document.getElementById(`safari-news-time-${idx}`);
      const thumb = card.querySelector('.safari-reading-thumb');

      if (titleNode) titleNode.textContent = item.title;
      if (srcNode) srcNode.textContent = item.source;
      if (timeNode) timeNode.textContent = item.time;
      if (thumb && item.svgKey && NEWS_SVGS[item.svgKey]) {
        thumb.innerHTML = NEWS_SVGS[item.svgKey];
        if (item.gradient) thumb.style.background = item.gradient;
      }
      card.onclick = () => {
        if (tabs.length === 0 || !activeTabId) createTab(item.url);
        else navigateTo(item.url);
      };
    };

    const renderNews = (idx) => {
      const item = PORTAL_NEWS_ITEMS[idx % PORTAL_NEWS_ITEMS.length];
      const itemNext = PORTAL_NEWS_ITEMS[(idx + 1) % PORTAL_NEWS_ITEMS.length];
      if (!item) return;

      // Legacy single news bar (if present)
      if (sourceEl) sourceEl.textContent = item.source;
      if (titleEl) titleEl.textContent = item.title;
      if (timeEl) timeEl.textContent = item.time;
      if (contentEl) {
        contentEl.onclick = () => {
          if (tabs.length === 0 || !activeTabId) createTab(item.url);
          else navigateTo(item.url);
        };
      }

      // Safari Dual Reading Cards
      updateCard('safari-news-card-0', item);
      updateCard('safari-news-card-1', itemNext);
    };

    if (btnPrev) {
      btnPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        currentNewsIndex = (currentNewsIndex - 1 + PORTAL_NEWS_ITEMS.length) % PORTAL_NEWS_ITEMS.length;
        renderNews(currentNewsIndex);
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', (e) => {
        e.stopPropagation();
        currentNewsIndex = (currentNewsIndex + 1) % PORTAL_NEWS_ITEMS.length;
        renderNews(currentNewsIndex);
      });
    }

    if (btnRefresh) {
      btnRefresh.addEventListener('click', (e) => {
        e.stopPropagation();
        currentNewsIndex = (currentNewsIndex + 2) % PORTAL_NEWS_ITEMS.length;
        renderNews(currentNewsIndex);
        showToast('📰 Дереккөздер ауыстырылды');
      });
    }

    renderNews(currentNewsIndex);
    setInterval(() => {
      currentNewsIndex = (currentNewsIndex + 2) % PORTAL_NEWS_ITEMS.length;
      renderNews(currentNewsIndex);
    }, 7000);
  } catch (err) {
    console.error('[PortalNews] Error initializing news feed:', err);
  }
}

// ── NCALayer WebSocket Bridge (eGov.kz ЭЦҚ интеграциясы) ──
class NCALayerBridge {
  constructor() {
    this.ws = null;
    this.NCALAYER_URL = 'wss://127.0.0.1:13579';
    this.isConnected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.NCALAYER_URL);
        this.ws.onopen = () => {
          this.isConnected = true;
          resolve(true);
        };
        this.ws.onerror = (err) => {
          this.isConnected = false;
          reject(new Error('NCALayer қосылмады. NCALayer бағдарламасын іске қосыңыз.'));
        };
        this.ws.onclose = () => {
          this.isConnected = false;
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  signXml(xmlData, storageType = 'PKCS12') {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.ws) {
        return reject(new Error('NCALayer қосылмаған'));
      }
      const request = {
        module: 'kz.gov.pki.knca.commonUtils',
        method: 'signXml',
        args: [storageType, 'SIGNATURE', xmlData, '', '']
      };
      this.ws.onmessage = (event) => {
        try {
          const res = JSON.parse(event.data);
          if (res.code === '200') resolve(res.responseObject);
          else reject(new Error(res.message || 'ЭЦҚ қол қою қатесі'));
        } catch (e) {
          reject(e);
        }
      };
      this.ws.send(JSON.stringify(request));
    });
  }
}

window.NCALayerBridge = NCALayerBridge;

// ════════════════════════════════════════
//  GALAMTOR BOOKMARKS ENGINE
// ════════════════════════════════════════
let currentBookmarks = [];

async function initBookmarks() {
  try {
    if (window.galamtorAPI && window.galamtorAPI.getBookmarks) {
      currentBookmarks = await window.galamtorAPI.getBookmarks();
      renderBookmarksBar();
      updateBookmarkButtonState();
    }
  } catch (err) {
    console.error('[Bookmarks] Init error:', err);
  }
}

function renderBookmarksBar() {
  const container = document.getElementById('bookmarks-bar-items');
  const bar = document.getElementById('bookmarks-bar');
  if (!container || !bar) return;

  if (!currentBookmarks || currentBookmarks.length === 0) {
    bar.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  bar.style.display = 'flex';
  container.replaceChildren();
  currentBookmarks.slice(0, 15).forEach(b => {
    const domain = extractDomain(b.url);
    const fav = b.favicon || `https://www.google.com/s2/favicons?domain=${domain}`;
    const item = document.createElement('div');
    item.className = 'bookmark-bar-item';
    item.dataset.url = b.url;
    item.title = `${b.title} (${b.url})`;
    const img = document.createElement('img');
    img.src = safeHttpUrl(fav) || '';
    img.onerror = () => { img.src = 'https://www.google.com/s2/favicons?domain=google.com'; };
    const label = document.createElement('span');
    label.textContent = b.title;
    item.append(img, label);
    item.addEventListener('click', () => {
      navigateTo(item.dataset.url);
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm(`«${item.querySelector('span').textContent}» бетбелгісін өшіру керек пе?`)) {
        removeBookmarkByUrl(item.dataset.url);
      }
    });
    container.appendChild(item);
  });
}

async function updateBookmarkButtonState() {
  const btn = document.getElementById('btn-bookmark-current');
  if (!btn) return;
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || tab.isHome || !tab.url) {
    btn.classList.remove('bookmarked');
    btn.title = 'Осы бетті бетбелгіге қосу (⌘D)';
    return;
  }

  try {
    const isBm = await window.galamtorAPI.isBookmarked(tab.url);
    btn.classList.toggle('bookmarked', !!isBm);
    btn.title = isBm ? 'Бетбелгілерден алып тастау (⌘D)' : 'Осы бетті бетбелгіге қосу (⌘D)';
  } catch (e) {
    btn.classList.remove('bookmarked');
  }
}

async function toggleBookmarkCurrent() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || tab.isHome || !tab.url) {
    showToast('⚠️ Басты бетті бетбелгіге қосу мүмкін емес');
    return;
  }

  try {
    const isBm = await window.galamtorAPI.isBookmarked(tab.url);
    if (isBm) {
      await removeBookmarkByUrl(tab.url);
    } else {
      const success = await window.galamtorAPI.addBookmark({
        title: tab.title || tab.url,
        url: tab.url,
        favicon: tab.favicon || ''
      });
      if (success) {
        currentBookmarks = await window.galamtorAPI.getBookmarks();
        renderBookmarksBar();
        updateBookmarkButtonState();
        showToast('⭐️ Бетбелгілерге сәтті қосылды!');
      }
    }
  } catch (err) {
    console.error('[Bookmarks] Toggle error:', err);
  }
}

async function removeBookmarkByUrl(url) {
  try {
    await window.galamtorAPI.removeBookmark(url);
    currentBookmarks = await window.galamtorAPI.getBookmarks();
    renderBookmarksBar();
    updateBookmarkButtonState();
    showToast('🗑️ Бетбелгі өшірілді');
  } catch (err) {
    console.error('[Bookmarks] Remove error:', err);
  }
}

// ════════════════════════════════════════
//  LIVE EXCHANGE RATES ENGINE
// ════════════════════════════════════════
async function updateLiveExchangeRatesUI() {
  try {
    if (!window.galamtorAPI || !window.galamtorAPI.getExchangeRates) return;
    const rates = await window.galamtorAPI.getExchangeRates();
    if (!rates) return;

    const usdEl = document.getElementById('rate-usd');
    const eurEl = document.getElementById('rate-eur');
    const rubEl = document.getElementById('rate-rub');

    if (usdEl && rates.USD) usdEl.textContent = rates.USD;
    if (eurEl && rates.EUR) eurEl.textContent = rates.EUR;
    if (rubEl && rates.RUB) rubEl.textContent = rates.RUB;
    const sourceEl = document.getElementById('currency-source');
    if (sourceEl) {
      sourceEl.textContent = rates.updatedAt
        ? `Анықтамалық бағам • ${new Date(rates.updatedAt).toLocaleDateString('kk-KZ')} • open.er-api.com`
        : rates.USD ? 'Анықтамалық бағам • уақыт белгісіз' : 'Бағам дерегі қолжетімсіз • open.er-api.com';
    }
  } catch (err) {
    console.warn('[Rates] Live rates UI error:', err);
  }
}

// ════════════════════════════════════════
//  FIND IN PAGE ENGINE (⌘F)
// ════════════════════════════════════════
let findInPageActive = false;

function setupFindInPage() {
  const bar = document.getElementById('find-in-page-bar');
  const input = document.getElementById('find-input');
  const count = document.getElementById('find-count');
  const btnPrev = document.getElementById('find-prev');
  const btnNext = document.getElementById('find-next');
  const btnClose = document.getElementById('find-close');

  if (!bar || !input) return;

  function openFindBar() {
    bar.style.display = 'flex';
    input.focus();
    input.select();
    findInPageActive = true;
    if (input.value.trim()) {
      executeFind(input.value.trim());
    }
  }

  function closeFindBar() {
    bar.style.display = 'none';
    findInPageActive = false;
    count.textContent = '0/0';
    const wv = getActiveWebview();
    if (wv) {
      try { wv.stopFindInPage('clearSelection'); } catch (e) {}
    }
  }

  function executeFind(text, forward = true, findNext = false) {
    const wv = getActiveWebview();
    if (!wv || !text) {
      count.textContent = '0/0';
      return;
    }
    try {
      wv.findInPage(text, { forward, findNext });
    } catch (e) {
      console.warn('findInPage error:', e);
    }
  }

  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (val) executeFind(val);
    else {
      count.textContent = '0/0';
      const wv = getActiveWebview();
      if (wv) wv.stopFindInPage('clearSelection');
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeFind(input.value.trim(), !e.shiftKey, true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFindBar();
    }
  });

  if (btnNext) btnNext.addEventListener('click', () => executeFind(input.value.trim(), true, true));
  if (btnPrev) btnPrev.addEventListener('click', () => executeFind(input.value.trim(), false, true));
  if (btnClose) btnClose.addEventListener('click', closeFindBar);

  window.openFindInPage = openFindBar;
  window.closeFindInPage = closeFindBar;
}

// ════════════════════════════════════════
//  NATIVE APPLICATION MENU DISPATCHER
// ════════════════════════════════════════
function setupMenuDispatcher() {
  if (!window.galamtorAPI || !window.galamtorAPI.onMenuAction) return;

  window.galamtorAPI.onMenuAction((action, data) => {
    switch (action) {
      case 'new-tab':
        createTab();
        break;
      case 'new-incognito-tab':
        createTab(null, true);
        break;
      case 'close-tab':
        if (activeTabId) closeTab(activeTabId);
        break;
      case 'reload': {
        const wv = getActiveWebview();
        if (wv) wv.reload();
        break;
      }
      case 'force-reload': {
        const wv = getActiveWebview();
        if (wv) wv.reloadIgnoringCache();
        break;
      }
      case 'zoom-in': {
        const wv = getActiveWebview();
        if (wv) {
          try { wv.setZoomLevel(wv.getZoomLevel() + 0.5); } catch (e) {}
        }
        break;
      }
      case 'zoom-out': {
        const wv = getActiveWebview();
        if (wv) {
          try { wv.setZoomLevel(wv.getZoomLevel() - 0.5); } catch (e) {}
        }
        break;
      }
      case 'zoom-reset': {
        const wv = getActiveWebview();
        if (wv) {
          try { wv.setZoomLevel(0); } catch (e) {}
        }
        break;
      }
      case 'find-in-page':
        if (window.openFindInPage) window.openFindInPage();
        break;
      case 'add-bookmark':
        toggleBookmarkCurrent();
        break;
      case 'open-bookmarks':
        if (typeof gpOpenModal === 'function') gpOpenModal('bookmarks');
        break;
      case 'open-history':
        if (typeof gpOpenModal === 'function') gpOpenModal('history');
        break;
      case 'open-downloads':
        if (typeof gpOpenModal === 'function') gpOpenModal('downloads');
        break;
      case 'open-settings':
        if (typeof gpOpenModal === 'function') gpOpenModal('profile');
        break;
      case 'customize-startpage': {
        const btnOpen = document.getElementById('btn-open-customizer');
        if (btnOpen) btnOpen.click();
        break;
      }
      case 'toggle-ai': {
        const aiPanel = document.getElementById('ai-sidebar-panel');
        if (aiPanel) aiPanel.classList.toggle('active');
        break;
      }
      case 'go-back': {
        const wv = getActiveWebview();
        if (wv && wv.canGoBack()) wv.goBack();
        break;
      }
      case 'go-forward': {
        const wv = getActiveWebview();
        if (wv && wv.canGoForward()) wv.goForward();
        break;
      }
      case 'go-home':
        navigateHome();
        break;
      case 'clear-history':
        if (confirm('Шолу тарихын толық тазартқыңыз келе ме?')) {
          window.galamtorAPI.clearHistory().then(() => {
            showToast('🧹 Тарих сәтті тазартылды');
            if (typeof gpRenderHistoryTab === 'function') gpRenderHistoryTab();
          });
        }
        break;
      case 'print': {
        const wv = getActiveWebview();
        if (wv) wv.print();
        break;
      }
      case 'save-page': {
        const tab = tabs.find(t => t.id === activeTabId);
        if (tab && tab.url) {
          window.galamtorAPI.downloadURL(tab.url);
          showToast('💾 Бетті жүктеу басталды');
        }
        break;
      }
      case 'about-qalqan':
        showToast('🛡️ Кибер-Қалқан: белгілі күдікті мекенжайларға арналған сүзгі');
        break;
    }
  });
}

// ════════════════════════════════════════
//  BOOTSTRAP NEW ENGINES
// ════════════════════════════════════════
initBookmarks();
setupFindInPage();
setupMenuDispatcher();
updateLiveExchangeRatesUI();

// Hook Currency Card click
const csCurrencyCard = document.getElementById('cs-currency');
if (csCurrencyCard) {
  csCurrencyCard.style.cursor = 'pointer';
  csCurrencyCard.addEventListener('click', async () => {
    csCurrencyCard.style.transform = 'scale(0.98)';
    setTimeout(() => { csCurrencyCard.style.transform = ''; }, 150);
    await updateLiveExchangeRatesUI();
    showToast(document.getElementById('rate-usd')?.textContent === '—' ? 'Бағам дерегі қолжетімсіз' : '💱 Валюта бағамы тексерілді');
  });
}

// Hook Bookmark button
const btnBookmark = document.getElementById('btn-bookmark-current');
if (btnBookmark) {
  btnBookmark.addEventListener('click', toggleBookmarkCurrent);
}

// Hook Sidebar buttons
const btnSidebarBm = document.getElementById('btn-sidebar-bookmarks');
if (btnSidebarBm) {
  btnSidebarBm.addEventListener('click', () => gpOpenModal('bookmarks'));
}

const btnSidebarHist = document.getElementById('btn-sidebar-history');
if (btnSidebarHist) {
  btnSidebarHist.addEventListener('click', () => gpOpenModal('history'));
}

const btnSidebarDl = document.getElementById('btn-sidebar-downloads');
if (btnSidebarDl) {
  btnSidebarDl.addEventListener('click', () => gpOpenModal('downloads'));
}

// ══════════════════════════════════════════════════════════════
//  GALAMTOR START PAGE CUSTOMIZER (WALLPAPERS, MP4, WIDGETS)
// ══════════════════════════════════════════════════════════════
const GALAMTOR_PRESET_WALLPAPERS = [
  {
    id: 'alatau',
    name: 'Алатау түні',
    location: 'Іле-Алатау ұлттық паркі, Алматы',
    file: 'assets/wallpapers/alatau.jpg'
  },
  {
    id: 'bozzhira',
    name: 'Бозжыра шатқалы',
    location: 'Үстірт қорығы, Маңғыстау',
    file: 'assets/wallpapers/bozzhira.jpg'
  },
  {
    id: 'kolsai',
    name: 'Көлсай көлі',
    location: 'Күнгей Алатау, Алматы облысы',
    file: 'assets/wallpapers/kolsai.jpg'
  },
  {
    id: 'charyn',
    name: 'Шарын шатқалы',
    location: 'Қамалдар аңғары, Алматы облысы',
    file: 'assets/wallpapers/charyn.jpg'
  },
  {
    id: 'burabay',
    name: 'Бурабай & Оқжетпес',
    location: 'Әулиекөл жағалауы, Ақмола облысы',
    file: 'assets/wallpapers/burabay.jpg'
  },
  {
    id: 'kaindy',
    name: 'Қайыңды көлі',
    location: 'Күнгей Алатау, Алматы облысы',
    file: 'assets/wallpapers/kaindy.jpg'
  },
  {
    id: 'akorda',
    name: 'Ақорда резиденциясы',
    location: 'Есіл жағалауы, Астана қаласы',
    file: 'assets/wallpapers/akorda.jpg'
  },
  {
    id: 'turkestan',
    name: 'Қожа Ахмет Ясауи',
    location: 'Түркістан қаласы',
    file: 'assets/wallpapers/turkestan.jpg'
  },
  {
    id: 'aktau',
    name: 'Каспий теңізі & Ақтау',
    location: 'Ақтау жағалауы, Маңғыстау',
    file: 'assets/wallpapers/aktau.jpg'
  },
  {
    id: 'shymbulak',
    name: 'Шымбұлақ тау шатқалы',
    location: 'Іле-Алатау, Алматы',
    file: 'assets/wallpapers/shymbulak.jpg'
  }
];

function initStartPageCustomizer() {
  const bgVideo = document.getElementById('welcome-bg-video');
  const bgImage = document.getElementById('welcome-bg-image');
  const bgDim = document.getElementById('welcome-bg-dim');
  const btnOpen = document.getElementById('btn-open-customizer');
  const btnClose = document.getElementById('btn-close-customizer');
  const backdrop = document.getElementById('customizer-backdrop');
  const drawer = document.getElementById('customizer-drawer');
  const presetsGrid = document.getElementById('presets-grid');
  const btnUpload = document.getElementById('btn-upload-custom-wallpaper');
  const inputFile = document.getElementById('input-custom-wallpaper-file');
  const customBar = document.getElementById('custom-media-active-bar');
  const customFilename = document.getElementById('custom-media-filename');
  const customBadge = document.getElementById('custom-media-badge');
  const btnReset = document.getElementById('btn-reset-custom-wallpaper');
  const sliderDim = document.getElementById('slider-dim-level');
  const valDim = document.getElementById('dim-level-val');
  const sliderBlur = document.getElementById('slider-blur-level');
  const valBlur = document.getElementById('blur-level-val');

  // Widget Toggles
  const toggleClock = document.getElementById('toggle-widget-clock');
  const toggleCurrency = document.getElementById('toggle-widget-currency');
  const togglePrayer = document.getElementById('toggle-widget-prayer');
  const toggleNews = document.getElementById('toggle-widget-news');
  const toggleWisdom = document.getElementById('toggle-widget-wisdom');
  const toggleShortcuts = document.getElementById('toggle-widget-shortcuts');

  // Widget Target Elements
  const elClock = document.getElementById('welcome-clock-widget');
  const elCurrency = document.getElementById('cs-currency');
  const elPrayer = document.getElementById('cs-prayer');
  const elBentoHero = document.getElementById('section-bento-hero');
  const elNews = document.getElementById('section-reading-news') || document.getElementById('portal-news-bar');
  const elWisdom = document.getElementById('wisdom-quote-widget');
  const elShortcuts = document.getElementById('section-favorites') || document.querySelector('.shortcuts-grid');

  if (!drawer || !btnOpen || !bgImage) return;

  // Open & Close Drawer
  const openDrawer = () => {
    drawer.classList.add('active');
    backdrop.classList.add('active');
  };
  const closeDrawer = () => {
    drawer.classList.remove('active');
    backdrop.classList.remove('active');
  };

  btnOpen.addEventListener('click', openDrawer);
  if (btnClose) btnClose.addEventListener('click', closeDrawer);
  if (backdrop) backdrop.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('active')) {
      closeDrawer();
    }
  });

  // VisionOS Pill Tabs Switching (Wallpapers | Video | Widgets)
  const tabPills = drawer.querySelectorAll('.customizer-tab-pill');
  const tabPanes = {
    wallpapers: document.getElementById('tab-pane-wallpapers'),
    video: document.getElementById('tab-pane-video'),
    widgets: document.getElementById('tab-pane-widgets')
  };

  tabPills.forEach(pill => {
    pill.addEventListener('click', () => {
      const targetTab = pill.dataset.tab;
      tabPills.forEach(p => p.classList.toggle('active', p === pill));
      Object.entries(tabPanes).forEach(([key, pane]) => {
        if (pane) {
          pane.style.display = (key === targetTab) ? 'flex' : 'none';
        }
      });
    });
  });

  // State Management
  const loadState = () => {
    return {
      mode: localStorage.getItem('galamtor_wallpaper_mode') || 'preset',
      presetId: localStorage.getItem('galamtor_wallpaper_preset') || 'alatau',
      customUrl: localStorage.getItem('galamtor_custom_url') || '',
      customType: localStorage.getItem('galamtor_custom_type') || 'image',
      customName: localStorage.getItem('galamtor_custom_name') || '',
      hubStyle: localStorage.getItem('galamtor_hub_style') || 'bento',
      dim: parseInt(localStorage.getItem('galamtor_dim_level') || '35', 10),
      blur: parseInt(localStorage.getItem('galamtor_blur_level') || '0', 10),
      showClock: localStorage.getItem('galamtor_widget_clock') !== 'false',
      showCurrency: localStorage.getItem('galamtor_widget_currency') !== 'false',
      showPrayer: localStorage.getItem('galamtor_widget_prayer') !== 'false',
      showNews: localStorage.getItem('galamtor_widget_news') !== 'false',
      showWisdom: localStorage.getItem('galamtor_widget_wisdom') !== 'false',
      showShortcuts: localStorage.getItem('galamtor_widget_shortcuts') !== 'false'
    };
  };

  const applyWallpaper = (state) => {
    if (state.mode === 'custom' && state.customUrl) {
      if (state.customType === 'video') {
        bgImage.style.display = 'none';
        bgVideo.style.display = 'block';
        if (bgVideo.src !== state.customUrl) {
          bgVideo.src = state.customUrl;
          bgVideo.play().catch(e => console.log('Autoplay handled:', e));
        }
      } else {
        bgVideo.pause();
        bgVideo.style.display = 'none';
        bgImage.style.display = 'block';
        bgImage.style.backgroundImage = `url("${state.customUrl}")`;
      }
      if (customBar) {
        customBar.style.display = 'flex';
        customFilename.textContent = state.customName || (state.customType === 'video' ? 'видео.mp4' : 'сурет.jpg');
        customBadge.textContent = state.customType === 'video' ? 'MP4 ВИДЕО' : 'СУРЕТ';
      }
    } else {
      bgVideo.pause();
      bgVideo.style.display = 'none';
      bgImage.style.display = 'block';
      const preset = GALAMTOR_PRESET_WALLPAPERS.find(p => p.id === state.presetId) || GALAMTOR_PRESET_WALLPAPERS[0];
      bgImage.style.backgroundImage = `url("${preset.file}")`;
      if (customBar) customBar.style.display = 'none';
    }

    // Apply Dim & Blur
    if (bgDim) {
      bgDim.style.setProperty('--dim-opacity', (state.dim / 100).toString());
      bgDim.style.setProperty('--blur-amount', `${state.blur}px`);
    }
    if (sliderDim) sliderDim.value = state.dim;
    if (valDim) valDim.textContent = `${state.dim}%`;
    if (sliderBlur) sliderBlur.value = state.blur;
    if (valBlur) valBlur.textContent = `${state.blur}px`;

    // Apply Widgets
    const setWidgetVisibility = (el, visible) => {
      if (!el) return;
      if (visible) el.style.removeProperty('display');
      else el.style.setProperty('display', 'none', 'important');
    };
    setWidgetVisibility(elClock, state.showClock);
    setWidgetVisibility(elCurrency, state.showCurrency);
    setWidgetVisibility(elPrayer, state.showPrayer);
    setWidgetVisibility(elBentoHero, state.showCurrency || state.showPrayer);
    setWidgetVisibility(elNews, state.showNews);
    setWidgetVisibility(elWisdom, state.showWisdom);
    setWidgetVisibility(elShortcuts, state.showShortcuts);

    // Update checkboxes
    if (toggleClock) toggleClock.checked = state.showClock;
    if (toggleCurrency) toggleCurrency.checked = state.showCurrency;
    if (togglePrayer) togglePrayer.checked = state.showPrayer;
    if (toggleNews) toggleNews.checked = state.showNews;
    if (toggleWisdom) toggleWisdom.checked = state.showWisdom;
    if (toggleShortcuts) toggleShortcuts.checked = state.showShortcuts;

    // Update preset cards active class
    document.querySelectorAll('.preset-card').forEach(card => {
      card.classList.toggle('active', state.mode === 'preset' && card.dataset.preset === state.presetId);
    });

    // Apply 5 Hub Widget Styles
    const hub = document.getElementById('cyber-steppe-hub');
    if (hub) {
      hub.classList.remove(
        'hub-style-astral',
        'hub-style-bento',
        'hub-style-capsule',
        'hub-style-neon',
        'hub-style-ambient'
      );
      if (state.hubStyle) {
        hub.classList.add(`hub-style-${state.hubStyle}`);
      }
    }
    document.querySelectorAll('.hub-style-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.style === state.hubStyle);
    });
  };

  // Render Preset Cards
  if (presetsGrid) {
    presetsGrid.innerHTML = '';
    GALAMTOR_PRESET_WALLPAPERS.forEach(preset => {
      const card = document.createElement('div');
      card.className = 'preset-card';
      card.dataset.preset = preset.id;
      card.innerHTML = `
        <div class="preset-thumb-wrap">
          <img src="${preset.file}" class="preset-thumb" alt="${preset.name}" loading="lazy">
          <span class="preset-badge">✓ Белсенді</span>
        </div>
        <div class="preset-info">
          <span class="preset-name">${preset.name}</span>
          <span class="preset-loc">${preset.location}</span>
        </div>
      `;
      card.addEventListener('click', () => {
        localStorage.setItem('galamtor_wallpaper_mode', 'preset');
        localStorage.setItem('galamtor_wallpaper_preset', preset.id);
        const curr = loadState();
        applyWallpaper(curr);
        showToast(`✓ Тұсқағаз қойылды: ${preset.name}`);
      });
      presetsGrid.appendChild(card);
    });
  }

  // Handle Custom Media Upload
  const handleCustomFile = (url, type, name) => {
    localStorage.setItem('galamtor_wallpaper_mode', 'custom');
    localStorage.setItem('galamtor_custom_url', url);
    localStorage.setItem('galamtor_custom_type', type);
    localStorage.setItem('galamtor_custom_name', name);
    const curr = loadState();
    applyWallpaper(curr);
    showToast(type === 'video' ? '✓ MP4 тірі видео тұсқағаз қойылды' : '✓ Жеке фото тұсқағаз қойылды');
  };

  if (btnUpload) {
    btnUpload.addEventListener('click', async () => {
      if (window.galamtorAPI && window.galamtorAPI.pickCustomWallpaper) {
        try {
          const res = await window.galamtorAPI.pickCustomWallpaper();
          if (res && !res.canceled && res.fileUrl) {
            handleCustomFile(res.fileUrl, res.mediaType, res.originalName);
            return;
          }
        } catch (err) {
          console.error('IPC pickCustomWallpaper error, falling back:', err);
        }
      }
      if (inputFile) inputFile.click();
    });
  }

  if (inputFile) {
    inputFile.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const isVideo = file.type.startsWith('video/') || file.name.match(/\.(mp4|webm|mov)$/i);
      const url = URL.createObjectURL(file);
      handleCustomFile(url, isVideo ? 'video' : 'image', file.name);
    });
  }

  // Reset to default preset
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      localStorage.setItem('galamtor_wallpaper_mode', 'preset');
      const curr = loadState();
      applyWallpaper(curr);
      showToast('✓ Бастапқы тұсқағазға қайтарылды');
    });
  }

  // Sliders
  if (sliderDim) {
    sliderDim.addEventListener('input', (e) => {
      const val = e.target.value;
      if (valDim) valDim.textContent = `${val}%`;
      if (bgDim) bgDim.style.setProperty('--dim-opacity', (val / 100).toString());
      localStorage.setItem('galamtor_dim_level', val);
    });
  }

  if (sliderBlur) {
    sliderBlur.addEventListener('input', (e) => {
      const val = e.target.value;
      if (valBlur) valBlur.textContent = `${val}px`;
      if (bgDim) bgDim.style.setProperty('--blur-amount', `${val}px`);
      localStorage.setItem('galamtor_blur_level', val);
    });
  }

  // Widget Checkboxes with full state synchronization
  const bindToggle = (toggleEl, key, elTarget, label) => {
    if (!toggleEl) return;
    const update = (checked) => {
      localStorage.setItem(key, checked ? 'true' : 'false');
      toggleEl.checked = checked;
      const curr = loadState();
      applyWallpaper(curr);
      showToast(checked ? `✓ ${label} қосылды` : `— ${label} жасырылды`);
    };

    toggleEl.addEventListener('change', (e) => {
      update(e.target.checked);
    });

    const row = toggleEl.closest('.toggle-row');
    if (row) {
      row.addEventListener('click', (e) => {
        if (e.target === toggleEl) return;
        e.preventDefault();
        update(!toggleEl.checked);
      });
    }
  };

  bindToggle(toggleClock, 'galamtor_widget_clock', elClock, 'Сағат виджеті');
  bindToggle(toggleCurrency, 'galamtor_widget_currency', elCurrency, 'Валюта бағамы');
  bindToggle(togglePrayer, 'galamtor_widget_prayer', elPrayer, 'Намаз кестесіне сілтеме');
  bindToggle(toggleNews, 'galamtor_widget_news', elNews, 'Жаңалықтар');
  bindToggle(toggleWisdom, 'galamtor_widget_wisdom', elWisdom, 'Ғұламалар даналығы');
  bindToggle(toggleShortcuts, 'galamtor_widget_shortcuts', elShortcuts, 'Қазақстандық қызметтер');

  // Hub Style Selector Clicks
  document.querySelectorAll('.hub-style-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const style = chip.dataset.style;
      localStorage.setItem('galamtor_hub_style', style);
      const curr = loadState();
      applyWallpaper(curr);
      const title = chip.querySelector('.chip-title') ? chip.querySelector('.chip-title').textContent : style;
      showToast(`✓ Виджет стилі: ${title}`);
    });
  });

  // Initial Apply
  const initial = loadState();
  applyWallpaper(initial);
}

// Bootstrap Start Page Customizer
initStartPageCustomizer();

// ══════════════════════════════════════════════════════════════
//  GLOBAL EXPORTS FOR DIAGNOSTICS, AUTOMATION & TESTING
// ══════════════════════════════════════════════════════════════
Object.defineProperty(window, 'tabs', {
  get: () => tabs,
  configurable: true
});
window.createTab = createTab;
window.closeTab = closeTab;
window.navigateTo = navigateTo;
window.getActiveWebview = getActiveWebview;
window.gpOpenModal = gpOpenModal;
window.gpCloseModal = gpCloseModal;
window.gpSwitchTab = gpSwitchTab;
window.toggleAiSidebarPanel = toggleAiSidebarPanel;
window.openAiSidebarPanel = openAiSidebarPanel;
window.closeAiSidebarPanel = closeAiSidebarPanel;
window.toggleMediaPlayback = toggleMediaPlayback;
window.skipMediaTrack = skipMediaTrack;
window.updateLiveExchangeRatesUI = updateLiveExchangeRatesUI;
