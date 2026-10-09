const { app, BrowserWindow, nativeImage, Menu, MenuItem, globalShortcut, ipcMain, shell, session, systemPreferences } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');

// ── Auto-Updater System ──
let autoUpdater = null;
let log = console;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  try {
    log = require('electron-log');
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = 'info';
  } catch (logErr) {
    autoUpdater.logger = console;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
} catch (updaterErr) {
  console.log('[AutoUpdater] electron-updater available during packaged release builds.');
}

// Enable macOS autofill and password generation features at Chromium engine level
app.commandLine.appendSwitch('enable-features', 'PasswordGeneration,PasswordImport');

if (!app.isPackaged) {
  require('electron-reload')(__dirname, {
    electron: path.join(__dirname, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  });
}

let mainWindow = null;
let authServer = null;
let currentLanguage = 'kk'; // Default system-wide context-menu language

// The Firebase Hosting origins that the auth-redirect page is served from.
const AUTH_REDIRECT_ORIGIN = 'https://galamtor.web.app';
const ALLOWED_AUTH_ORIGINS = [
  'https://galamtor.web.app',
  'https://galamtor.firebaseapp.com',
  'https://galamtor-browser-974cc.web.app',
  'https://galamtor-browser-974cc.firebaseapp.com',
  'http://localhost:3000'
];

function getCorsHeaders(req) {
  const origin = req && req.headers ? req.headers.origin : null;
  const allowOrigin = ALLOWED_AUTH_ORIGINS.includes(origin) ? origin : AUTH_REDIRECT_ORIGIN;
  return {
    'Access-Control-Allow-Origin':          allowOrigin,
    'Access-Control-Allow-Methods':         'POST, OPTIONS',
    'Access-Control-Allow-Headers':         'Content-Type, Access-Control-Allow-Private-Network',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age':               '86400'
  };
}
const CORS_HEADERS = getCorsHeaders();

// ── Unified Context Menu Translations ──
const CONTEXT_MENU_TRANSLATIONS = {
  kk: {
    openImageInNewTab: 'Суретті жаңа қойындыда ашу',
    copyImage: 'Суретті көшіру',
    copyImageAddress: 'Сурет сілтемесін көшіру',
    copy: 'Көшіру',
    paste: 'Қою',
    selectAll: 'Барлығын таңдау',
    inspectElement: 'Кодты көру'
  },
  ru: {
    openImageInNewTab: 'Открыть изображение в новой вкладке',
    copyImage: 'Копировать изображение',
    copyImageAddress: 'Копировать адрес изображения',
    copy: 'Копировать',
    paste: 'Вставить',
    selectAll: 'Выбрать все',
    inspectElement: 'Просмотреть код'
  },
  en: {
    openImageInNewTab: 'Open Image in New Tab',
    copyImage: 'Copy Image',
    copyImageAddress: 'Copy Image Address',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    inspectElement: 'Inspect Element'
  }
};

function getContextTranslation(key) {
  const trans = CONTEXT_MENU_TRANSLATIONS[currentLanguage] || CONTEXT_MENU_TRANSLATIONS.kk;
  return trans[key] || key;
}

// ── Native macOS / Application Menu template (ensures Cmd+C / Cmd+V shortcuts work natively) ──
function setApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [];
  
  if (isMac) {
    template.push({
      label: 'Galamtor',
      submenu: [
        { role: 'about', label: 'Galamtor туралы' },
        { type: 'separator' },
        { role: 'services', label: 'Қызметтер' },
        { type: 'separator' },
        { role: 'hide', label: 'Жасыру' },
        { role: 'hideOthers', label: 'Басқаларын жасыру' },
        { role: 'unhide', label: 'Барлығын көрсету' },
        { type: 'separator' },
        { role: 'quit', label: 'Шығу' }
      ]
    });
  }

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo', label: 'Болдырмау (Undo)' },
      { role: 'redo', label: 'Қайталау (Redo)' },
      { type: 'separator' },
      { role: 'cut', label: 'Қию (Cut)' },
      { role: 'copy', label: 'Көшіру (Copy)' },
      { role: 'paste', label: 'Қою (Paste)' },
      { role: 'selectAll', label: 'Барлығын таңдау (Select All)' }
    ]
  });

  template.push({
    label: 'View',
    submenu: [
      { role: 'reload', label: 'Қайта жүктеу' },
      { role: 'forceReload', label: 'Мәжбүрлі қайта жүктеу' },
      { role: 'toggleDevTools', label: 'Әзірлеуші құралдары' },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Масштабты қалпына келтіру' },
      { role: 'zoomIn', label: 'Үлкейту' },
      { role: 'zoomOut', label: 'Кішірейту' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Толық экран режимі' }
    ]
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ── IPC Sender Validation ──
function validateSender(event) {
  const senderUrl = event.senderFrame ? event.senderFrame.url : '';
  if (senderUrl.startsWith('file://') || senderUrl.startsWith('devtools://')) {
    return true;
  }
  if (!senderUrl) {
    return false;
  }
  console.warn(`[Security Alert] Blocked invalid IPC sender: ${senderUrl}`);
  return false;
}

// ── History Manager System ──
const MAX_HISTORY = 10000;
function getHistoryPath() {
  return path.join(app.getPath('userData'), 'history.json');
}

function loadHistory() {
  try {
    const historyPath = getHistoryPath();
    if (fs.existsSync(historyPath)) {
      const data = fs.readFileSync(historyPath, 'utf8');
      return JSON.parse(data) || [];
    }
  } catch (err) {
    console.error('[History] Failed to load history:', err);
  }
  return [];
}

function saveHistory(history) {
  try {
    const historyPath = getHistoryPath();
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('[History] Failed to save history:', err);
  }
}

// ── Settings Persistence ──
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(data) || {};
    }
  } catch (err) {
    console.error('[Settings] Failed to load:', err);
  }
  return {};
}

function saveSettings(settings) {
  try {
    const settingsPath = getSettingsPath();
    const existing = loadSettings();
    const merged = { ...existing, ...settings };
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
  } catch (err) {
    console.error('[Settings] Failed to save:', err);
  }
}

function addHistoryEntry(entry) {
  if (!entry || typeof entry.url !== 'string') return;
  
  const cleanUrl = entry.url.replace(/<[^>]*>/g, '');
  const cleanTitle = (entry.title || 'Жаңа қойынды').replace(/<[^>]*>/g, '');
  const timestamp = entry.timestamp || Date.now();

  let history = loadHistory();
  history.unshift({ url: cleanUrl, title: cleanTitle, timestamp });

  if (history.length > MAX_HISTORY) {
    history = history.slice(0, MAX_HISTORY);
  }

  saveHistory(history);
}

// ── Session Auto-Restore System ──
function getSessionPath() {
  return path.join(app.getPath('userData'), 'session.json');
}

function loadSession() {
  try {
    const sessionPath = getSessionPath();
    if (fs.existsSync(sessionPath)) {
      const data = fs.readFileSync(sessionPath, 'utf8');
      return JSON.parse(data) || [];
    }
  } catch (err) {
    console.error('[Session] Failed to load session:', err);
  }
  return [];
}

function saveSession(sessionTabs) {
  try {
    const sessionPath = getSessionPath();
    fs.writeFileSync(sessionPath, JSON.stringify(sessionTabs || [], null, 2), 'utf8');
  } catch (err) {
    console.error('[Session] Failed to save session:', err);
  }
}

// ── AdBlocker & Privacy Shield Engine ──
let adBlockEnabled = loadSettings().adBlockEnabled !== false; // default true
let totalBlockedAds = 0;

const AD_DOMAINS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'adservice.google.com', 'adnxs.com', 'rubiconproject.com', 'pubmatic.com',
  'criteo.com', 'criteo.net', 'outbrain.com', 'taboola.com', 'adroll.com',
  'popads.net', 'popcash.net', 'exoclick.com', 'propellerads.com',
  'amazon-adsystem.com', 'scorecardresearch.com', 'zedo.com', 'bidswitch.net',
  'casalemedia.com', 'openx.net', 'adsrvr.org', 'quantserve.com',
  'an.yandex.ru', 'mc.yandex.ru', 'ad.mail.ru', 'hotjar.com', 'clarity.ms'
];

function setupAdBlocker() {
  const filter = { urls: ['http://*/*', 'https://*/*'] };
  
  session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    if (!adBlockEnabled) {
      return callback({ cancel: false });
    }

    try {
      const parsedUrl = new url.URL(details.url);
      const hostname = parsedUrl.hostname.toLowerCase();
      
      const isAd = AD_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
      if (isAd) {
        totalBlockedAds++;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ad-blocked-count', totalBlockedAds);
        }
        return callback({ cancel: true });
      }
    } catch (e) {
      // Ignore URL parse errors
    }

    callback({ cancel: false });
  });
}

// ── Ұлттық Кибер-Қалқан (Cyber Qalqan Anti-Phishing) ──
const QALQAN_BLOCKLIST = [
  'invest-kaspi.com', 'kaspi-bonus.kz', 'halyk-invest-bot.com',
  'tengri-coin.net', 'bitcoin-astana.kz', 'egov-kz.online',
  'egov-login.com', 'mygov-kz.ru', 'kaspi-login.ru', 'kaspi-pay.online',
  'kaspi-prize.kz', 'halyk-win.com', 'gos-viplaty.kz', 'fond-kompensatsii.kz',
  'kaspi-credit-online.kz', 'egov-posobie.kz'
];

function isPhishingOrScam(targetUrl) {
  try {
    const parsed = new url.URL(targetUrl);
    const host = parsed.hostname.toLowerCase();
    
    // 1. Direct blocklist check
    if (QALQAN_BLOCKLIST.some(d => host === d || host.endsWith('.' + d))) {
      return { isScam: true, reason: 'Белгілі алаяқтық немесе фишингтік ресурс тізімінде анықталды.' };
    }
    
    // 2. Legitimate KZ service verification
    const isLegitKaspi = host === 'kaspi.kz' || host.endsWith('.kaspi.kz');
    const isLegiteGov = host === 'egov.kz' || host.endsWith('.egov.kz');
    const isLegitHalyk = host === 'halykbank.kz' || host.endsWith('.halykbank.kz') || host === 'homebank.kz' || host.endsWith('.homebank.kz');
    
    // 3. Phishing heuristic checks
    if (!isLegitKaspi && /kaspi.*(?:login|pay|bonus|prize|invest|money|cash)/i.test(host)) {
      return { isScam: true, reason: 'Kaspi.kz брендін заңсыз пайдаланған күдікті фишингтік сілтеме.' };
    }
    if (!isLegiteGov && /egov.*(?:login|free|bonus|viplata|posobie)/i.test(host)) {
      return { isScam: true, reason: 'eGov.kz мемлекеттік порталын қайталаған жалған парақша.' };
    }
    if (!isLegitHalyk && /halyk.*(?:invest|bonus|win|kassa)/i.test(host)) {
      return { isScam: true, reason: 'Halyk Bank атын жамылған жалған инвестициялық сайт.' };
    }
  } catch (e) {}
  return { isScam: false };
}

function getCyberQalqanWarningHtml(urlStr, reason) {
  return `<!DOCTYPE html>
<html lang="kk">
<head>
  <meta charset="UTF-8">
  <title>Кибер-Қалқан Ескертуі | Ғаламтор</title>
  <style>
    body { margin: 0; background: #0c0808; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; }
    .card { max-width: 540px; padding: 40px; background: rgba(36, 12, 12, 0.9); border: 1.5px solid #ff3b30; border-radius: 16px; text-align: center; box-shadow: 0 10px 40px rgba(255, 59, 48, 0.3); }
    .icon { font-size: 56px; margin-bottom: 16px; }
    h1 { color: #ff453a; margin: 0 0 12px; font-size: 26px; }
    .target-url { font-family: monospace; font-size: 13px; color: #ff9f0a; word-break: break-all; background: rgba(0,0,0,0.5); padding: 8px 12px; border-radius: 6px; margin: 12px 0; }
    p { color: #d1d1d6; line-height: 1.6; font-size: 14.5px; margin: 0 0 18px; }
    .btn-back { background: #ff3b30; color: #fff; border: none; padding: 12px 28px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; transition: transform 0.2s; }
    .btn-back:hover { transform: scale(1.04); }
    .sub { font-size: 11.5px; color: #8e8e93; margin-top: 18px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🛡️</div>
    <h1>Ұлттық Кибер-Қалқан Ескертуі</h1>
    <div class="target-url">${urlStr}</div>
    <p>Бұл сайт <strong>Ғаламтордың ұлттық қауіпсіздік сүзгісімен бұғатталды</strong>.<br>${reason}</p>
    <p style="font-size:13px; color:#ff9f0a;">Қаржылық деректеріңіз бен SMS-кодтарды енгізбеңіз!</p>
    <button class="btn-back" onclick="history.back()">← Қауіпсіз орынға қайту</button>
    <div class="sub">Қазақстанның киберқауіпсіздік экожүйесімен қорғалған</div>
  </div>
</body>
</html>`;
}

// ── Gov & Fintech Secure Vault ──
const BANKING_DOMAINS = ['kaspi.kz', 'egov.kz', 'halykbank.kz', 'homebank.kz', 'enbek.kz', 'cabinet.salyk.kz', 'stat.gov.kz'];
let isBankingShieldActive = false;

function checkBankingShield(targetUrl) {
  try {
    const host = new url.URL(targetUrl).hostname.toLowerCase();
    const isBanking = BANKING_DOMAINS.some(d => host === d || host.endsWith('.' + d));
    isBankingShieldActive = isBanking;
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Enable native OS screenshot protection on macOS / Windows
      if (typeof mainWindow.setContentProtection === 'function') {
        mainWindow.setContentProtection(isBanking);
      }
      mainWindow.webContents.send('banking-shield-status', { active: isBanking, host });
    }
  } catch (e) {}
}

// ── Qazaq AI Context Engine: Currency & Measurement Conversion ──
const NBRK_RATES = { USD: 485.5, EUR: 532.0, RUB: 5.25, CNY: 68.2 };

function convertUnitsAndCurrency(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  // USD to KZT
  out = out.replace(/\$(\d+(?:\.\d{1,2})?)/g, (match, val) => {
    const kzt = Math.round(parseFloat(val) * NBRK_RATES.USD);
    return `${match} (≈ ${kzt.toLocaleString('kk-KZ')} ₸)`;
  });
  // Miles to KM
  out = out.replace(/(\d+(?:\.\d+)?)\s*(?:miles|mile)\b/gi, (m, n) => {
    return `${m} (${(parseFloat(n) * 1.60934).toFixed(1)} км)`;
  });
  // °F to °C
  out = out.replace(/(\d+(?:\.\d+)?)\s*°F\b/g, (m, n) => {
    return `${m} (${Math.round((parseFloat(n) - 32) * 5 / 9)}°C)`;
  });
  // lbs to kg
  out = out.replace(/(\d+(?:\.\d+)?)\s*(?:lbs|pounds?)\b/gi, (m, n) => {
    return `${m} (${(parseFloat(n) * 0.453592).toFixed(1)} кг)`;
  });
  // feet to meters
  out = out.replace(/(\d+(?:\.\d+)?)\s*(?:feet|ft)\b/gi, (m, n) => {
    return `${m} (${(parseFloat(n) * 0.3048).toFixed(1)} м)`;
  });
  return out;
}

// ── Downloads Manager System ──
function getDownloadsPath() {
  return path.join(app.getPath('userData'), 'downloads.json');
}

function loadDownloads() {
  try {
    const downloadsPath = getDownloadsPath();
    if (fs.existsSync(downloadsPath)) {
      const data = fs.readFileSync(downloadsPath, 'utf8');
      return JSON.parse(data) || [];
    }
  } catch (err) {
    console.error('[Downloads] Failed to load downloads history:', err);
  }
  return [];
}

function saveDownloads(downloads) {
  try {
    const downloadsPath = getDownloadsPath();
    fs.writeFileSync(downloadsPath, JSON.stringify(downloads, null, 2), 'utf8');
  } catch (err) {
    console.error('[Downloads] Failed to save downloads history:', err);
  }
}

function addDownloadEntry(entry) {
  let downloads = loadDownloads();
  downloads.unshift(entry);
  saveDownloads(downloads);
}

// ── OAuth Handshake Loopback Server ──
function startAuthServer(win) {
  if (authServer) {
    console.log('[AuthServer] Stale server detected — closing before restart.');
    authServer.close();
    authServer = null;
  }

  console.log('[AuthServer] Starting local server on port 4242...');

  authServer = http.createServer((req, res) => {
    console.log(`[AuthServer] Incoming: ${req.method} ${req.url}`);
    const parsedUrl = url.parse(req.url, true);

    if (req.method === 'OPTIONS' && parsedUrl.pathname === '/callback') {
      res.writeHead(204, getCorsHeaders(req));
      res.end();
      return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/callback') {
      let rawBody = '';

      const bodyTimeout = setTimeout(() => {
        console.error('[AuthServer] Body read timeout — destroying socket.');
        req.destroy();
      }, 10_000);

      req.setEncoding('utf8');

      req.on('data', chunk => { rawBody += chunk; });

      req.on('end', () => {
        clearTimeout(bodyTimeout);

        let payload;
        try {
          payload = JSON.parse(rawBody);
        } catch (parseErr) {
          console.error('[AuthServer] Failed to parse JSON body:', parseErr.message);
          res.writeHead(400, { ...getCorsHeaders(req), 'Content-Type': 'text/plain' });
          res.end('Bad Request: invalid JSON');
          return;
        }

        const { googleIdToken, googleAccessToken, email, displayName, photoURL, uid } = payload;
        console.log(`[AuthServer] Payload parsed. googleIdToken present: ${!!googleIdToken}, googleAccessToken present: ${!!googleAccessToken}, email: ${email}`);

        if (!googleIdToken && !googleAccessToken) {
          console.warn('[AuthServer] Neither googleIdToken nor googleAccessToken received.');
          res.writeHead(422, { ...getCorsHeaders(req), 'Content-Type': 'text/plain' });
          res.end('Unprocessable: missing credential tokens');
          return;
        }

        const targetWin = win || mainWindow;
        if (targetWin && !targetWin.isDestroyed()) {
          targetWin.webContents.send('firebase-auth-token', {
            googleIdToken,
            googleAccessToken,
            email,
            displayName,
            photoURL,
            uid
          });
          console.log('[AuthServer] Forwarded google credential to Renderer.');
        } else {
          console.warn('[AuthServer] Target window unavailable — token dropped!');
        }

        res.writeHead(200, { ...getCorsHeaders(req), 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Galamtor</title></head>
<body style="font-family:sans-serif;text-align:center;padding-top:50px;background:#090a0f;color:#fff;">
  <h1 style="color:#00f2fe;margin-bottom:8px;">Galamtor синхрондалды! ✅</h1>
  <p style="color:rgba(255,255,255,0.6);">Қосымшаға орала аласыз. Бұл терезені жабуға болады.</p>
  <script>setTimeout(() => window.close(), 2500);<\/script>
</body>
</html>`);

        stopAuthServer();
      });

      req.on('error', (err) => {
        clearTimeout(bodyTimeout);
        console.error('[AuthServer] Request stream error:', err.message);
      });

      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  authServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('[AuthServer] Port 4242 already in use. Killing occupant and retrying...');
      authServer = null;
      setTimeout(() => startAuthServer(win || mainWindow), 500);
    } else {
      console.error('[AuthServer] Server error:', err);
    }
  });

  authServer.listen(4242, '127.0.0.1', () => {
    console.log('[AuthServer] Listening on http://127.0.0.1:4242');
  });
}

function stopAuthServer() {
  if (authServer) {
    authServer.close(() => console.log('[AuthServer] Closed cleanly.'));
    authServer = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Galamtor',
    backgroundColor: '#090a0f',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 12 },
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: true // Explicitly enable Electron Spellchecker
    },
    show: false // Hide window until layout & renderer styles are fully ready
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

function setupAutoUpdater() {
  if (!autoUpdater) return;
  const { dialog } = require('electron');

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => log.error('Auto-updater error on startup:', err));
  }, 5000);

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(err => log.error('Auto-updater interval error:', err));
  }, 4 * 60 * 60 * 1000);

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info);
    if (mainWindow) mainWindow.webContents.send('update-available', info);
    
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Жаңарту',
      message: `Ғаламтордың жаңа ${info.version} нұсқасы дайын! Жаңартасыз ба?`,
      buttons: ['Иә', 'Жоқ'],
      defaultId: 0
    }).then(result => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
        if (mainWindow) mainWindow.webContents.send('update:download');
      }
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow) mainWindow.webContents.send('update-progress', progressObj);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info);
    if (mainWindow) mainWindow.webContents.send('update-downloaded', info);
    
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Жаңарту жүктелді',
      message: 'Жаңарту жүктелді! Қайта іске қосу арқылы орнатылады.',
      buttons: ['Қазір орнату', 'Кейінірек'],
      defaultId: 0
    }).then(result => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    });
  });

  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error:', err);
    if (mainWindow) mainWindow.webContents.send('update-error', err.message);
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const image = nativeImage.createFromPath(path.join(__dirname, 'assets/icon.png'));
    app.dock.setIcon(image);
  }

  createWindow();

  // ── Auto-Updater Initialization ──
  setupAutoUpdater();

  // Establish Apple Shortcuts and Application menu
  setApplicationMenu();

  // Enable spellcheck languages at session level
  session.defaultSession.setSpellCheckerLanguages(['kk', 'ru', 'en']);

  // ── Setup AdBlocker & Privacy Shield Engine ──
  setupAdBlocker();

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' 'unsafe-eval' data: https: wss: blob:;"]
      }
    });
  });

  // ── Setup Downloads Monitor System ──
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const downloadId = 'dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const fileName = item.getFilename();
    const totalBytes = item.getTotalBytes();

    item.on('updated', (event, state) => {
      if (state === 'progressing') {
        const receivedBytes = item.getReceivedBytes();
        const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            filename: fileName,
            receivedBytes,
            totalBytes,
            percent,
            state: 'progressing'
          });
        }
      } else if (state === 'interrupted') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            filename: fileName,
            receivedBytes: item.getReceivedBytes(),
            totalBytes,
            percent: 0,
            state: 'interrupted'
          });
        }
      }
    });

    item.once('done', (event, state) => {
      const meta = {
        id: downloadId,
        filename: fileName,
        savePath: item.getSavePath(),
        totalBytes,
        state,
        completedAt: Date.now()
      };

      if (state === 'completed') {
        addDownloadEntry(meta);
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-done', meta);
      }
    });
  });

  // Register system-wide Command+G recall shortcut
  globalShortcut.register('CommandOrControl+G', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// ── Native Right-Click Context Menu for Webviews ──
app.on('web-contents-created', (event, contents) => {
  // Prevent MaxListenersExceededWarning on guest webviews
  contents.setMaxListeners(50);

  // Propagate spellchecker languages to nested guest webviews
  contents.session.setSpellCheckerLanguages(['kk', 'ru', 'en']);

  // ── Кибер-Қалқан & Banking Shield navigation interception ──
  const handleNavSecurity = (e, navUrl) => {
    if (!navUrl || typeof navUrl !== 'string') return;
    const scan = isPhishingOrScam(navUrl);
    if (scan.isScam) {
      e.preventDefault();
      const warningHTML = getCyberQalqanWarningHtml(navUrl, scan.reason);
      contents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(warningHTML)}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('qalqan-blocked', { url: navUrl, reason: scan.reason });
      }
      return;
    }
    checkBankingShield(navUrl);
  };

  contents.on('will-navigate', handleNavSecurity);
  contents.on('will-redirect', handleNavSecurity);

  contents.on('select-file', (e, path, callback) => {
    e.preventDefault();
    const { dialog } = require('electron');
    dialog.showOpenDialog({
      properties: ['openFile']
    }).then(result => {
      callback(result.canceled ? [] : result.filePaths);
    }).catch(err => {
      console.error('[Galamtor] File picker error:', err);
      callback([]);
    });
  });

  contents.on('context-menu', (e, params) => {
    // If the right-click is on an editable field, allow the native OS context menu (including macOS AutoFill)
    if (params.isEditable) {
      return;
    }
    const menu = new Menu();

    // 1. Image-specific options
    if (params.mediaType === 'image') {
      if (params.srcURL) {
        menu.append(new MenuItem({
          label: getContextTranslation('openImageInNewTab'),
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
              win.webContents.send('open-image-in-new-tab', params.srcURL);
            }
          }
        }));
        menu.append(new MenuItem({
          label: getContextTranslation('copyImage'),
          click: () => {
            contents.copyImageAt(params.x, params.y);
          }
        }));
        menu.append(new MenuItem({
          label: getContextTranslation('copyImageAddress'),
          click: () => {
            const { clipboard } = require('electron');
            clipboard.writeText(params.srcURL);
          }
        }));
        menu.append(new MenuItem({ type: 'separator' }));
      }
    }

    // 2. Standard editing tools
    const hasText = params.selectionText && params.selectionText.trim().length > 0;
    
    if (hasText) {
      menu.append(new MenuItem({
        label: getContextTranslation('copy'),
        role: 'copy'
      }));
    }
    
    if (params.isEditable) {
      menu.append(new MenuItem({
        label: getContextTranslation('paste'),
        role: 'paste'
      }));
      menu.append(new MenuItem({
        label: getContextTranslation('selectAll'),
        role: 'selectAll'
      }));
    } else if (hasText) {
      menu.append(new MenuItem({
        label: getContextTranslation('selectAll'),
        role: 'selectAll'
      }));
    }

    if (menu.items.length > 0) {
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // 3. Inspect Element
    menu.append(new MenuItem({
      label: getContextTranslation('inspectElement'),
      click: () => {
        contents.inspectElement(params.x, params.y);
        if (!contents.isDevToolsOpened()) {
          contents.openDevTools({ mode: 'detach' });
        }
      }
    }));

    menu.popup();
  });
});

// ── IPC Handlers with Sender Validation ──
ipcMain.handle('update:check', (event) => {
  if (!validateSender(event) || !autoUpdater) return false;
  autoUpdater.checkForUpdates().catch(err => log.error('Manual update check error:', err));
  return true;
});
ipcMain.handle('update:download', (event) => {
  if (!validateSender(event) || !autoUpdater) return false;
  autoUpdater.downloadUpdate();
  return true;
});
ipcMain.handle('update:install', (event) => {
  if (!validateSender(event) || !autoUpdater) return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
});

ipcMain.on('start-google-login', (event) => {
  if (!validateSender(event)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  startAuthServer(win);
  shell.openExternal('https://galamtor.web.app/?mode=login');
});

ipcMain.on('stop-auth-server', (event) => {
  if (!validateSender(event)) return;
  stopAuthServer();
});

ipcMain.on('language:set', (event, lang) => {
  if (!validateSender(event)) return;
  if (['kk', 'ru', 'en'].includes(lang)) {
    currentLanguage = lang;
    console.log(`[Localization] Main process context menu language configured to: ${lang}`);
  }
});

ipcMain.handle('history:add', (event, entry) => {
  if (!validateSender(event)) return;
  addHistoryEntry(entry);
});

ipcMain.handle('history:get', (event) => {
  if (!validateSender(event)) return [];
  return loadHistory();
});

ipcMain.handle('history:clear', (event) => {
  if (!validateSender(event)) return;
  saveHistory([]);
});

ipcMain.handle('downloads:get', (event) => {
  if (!validateSender(event)) return [];
  return loadDownloads();
});

ipcMain.handle('downloads:clear', (event) => {
  if (!validateSender(event)) return;
  saveDownloads([]);
});

ipcMain.handle('shell:open-path', async (event, filePath) => {
  if (!validateSender(event)) return 'Blocked';
  if (typeof filePath !== 'string' || filePath.includes('..') || filePath.trim() === '') {
    return 'Invalid path';
  }
  try {
    const error = await shell.openPath(filePath);
    return error || 'success';
  } catch (err) {
    return err.message;
  }
});

ipcMain.handle('adblock:toggle', (event) => {
  if (!validateSender(event)) return false;
  adBlockEnabled = !adBlockEnabled;
  saveSettings({ adBlockEnabled });
  console.log(`[AdBlocker] Toggled. Active state: ${adBlockEnabled}`);
  return adBlockEnabled;
});

ipcMain.handle('adblock:get-stats', (event) => {
  if (!validateSender(event)) return { enabled: true, count: 0 };
  return { enabled: adBlockEnabled, count: totalBlockedAds };
});

ipcMain.handle('session:save', (event, sessionTabs) => {
  if (!validateSender(event)) return;
  saveSession(sessionTabs);
});

ipcMain.handle('session:load', (event) => {
  if (!validateSender(event)) return [];
  return loadSession();
});

ipcMain.handle('download:trigger', (event, url) => {
  if (!validateSender(event) || typeof url !== 'string') return false;
  try {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.downloadURL(url);
      return true;
    }
  } catch (err) {
    console.error('[Download] Trigger error:', err);
  }
  return false;
});

// ── Touch ID / Biometrics API (macOS) ──
ipcMain.handle('touchid:can-prompt', (event) => {
  if (!validateSender(event)) return false;
  try {
    return process.platform === 'darwin' && typeof systemPreferences?.canPromptTouchID === 'function' && systemPreferences.canPromptTouchID();
  } catch (err) {
    console.error('[TouchID] Capability check error:', err);
    return false;
  }
});

ipcMain.handle('touchid:prompt', async (event, reason) => {
  if (!validateSender(event)) return false;
  if (process.platform !== 'darwin' || !systemPreferences?.canPromptTouchID || !systemPreferences.canPromptTouchID()) {
    throw new Error('Touch ID бұл құрылғыда қолжетімді емес');
  }
  const promptReason = typeof reason === 'string' && reason.trim() ? reason : 'Galamtor сессиясын ашу үшін саусақ ізін қойыңыз';
  await systemPreferences.promptTouchID(promptReason);
  return true;
});

// ── Gemini AI API Integration ──

function getAiSettingsPath() {
  return path.join(app.getPath('userData'), 'ai_settings.json');
}

function loadGeminiApiKey() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.startsWith('AIza')) {
    return process.env.GEMINI_API_KEY;
  }
  try {
    const settingsPath = getAiSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(data);
      if (settings.apiKey && settings.apiKey.startsWith('AIza')) return settings.apiKey;
    }
  } catch (err) {
    console.error('[AI] Failed to load settings:', err);
  }
  return '';
}

function saveGeminiApiKey(apiKey) {
  try {
    const settingsPath = getAiSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify({ apiKey }, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[AI] Failed to save settings:', err);
    return false;
  }
}

function requestSingleGeminiModel(apiVersion, modelName, apiKey, systemInstruction, userPrompt, chatHistory) {
  return new Promise((resolve) => {
    let contents;
    if (chatHistory && chatHistory.length > 0) {
      // Build multi-turn conversation
      contents = chatHistory.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));
      // Add the current user prompt
      contents.push({ role: 'user', parts: [{ text: userPrompt }] });
    } else {
      contents = [{ parts: [{ text: userPrompt }] }];
    }
    
    const payload = JSON.stringify({
      system_instruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
      contents
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || 'Жауап бос.';
            resolve({ success: true, text });
          } catch (e) {
            resolve({ success: false, statusCode: res.statusCode, error: 'API жауабын оқу мүмкін болмады.' });
          }
        } else {
          let rawError = '';
          try {
            const errParsed = JSON.parse(data);
            rawError = errParsed.error?.message || '';
          } catch {}
          resolve({ success: false, statusCode: res.statusCode, rawError });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ success: false, statusCode: 0, rawError: e.message });
    });

    req.write(payload);
    req.end();
  });
}

async function callGeminiAPI(systemInstruction, userPrompt, chatHistory) {
  const apiKey = loadGeminiApiKey();
  if (!apiKey || !apiKey.startsWith('AIza')) {
    return {
      error: '🔑 **Gemini API кілті орнатылмаған.**\n\nGoogle AI Studio API кілті `AIza...` әріптерінен басталуы тиіс. [aistudio.google.com/apikey](https://aistudio.google.com/apikey) сайтынан 10 секундта тегін API кілт алып, оң жақ жоғарғы ⚙️ **Баптаулар** батырмасына қойыңыз.'
    };
  }

  const targets = [
    { apiVersion: 'v1beta', model: 'gemini-2.5-flash' },
    { apiVersion: 'v1beta', model: 'gemini-2.0-flash' },
    { apiVersion: 'v1beta', model: 'gemini-2.0-flash-lite' }
  ];

  let hadQuotaError = false;

  for (const target of targets) {
    const res = await requestSingleGeminiModel(target.apiVersion, target.model, apiKey, systemInstruction, userPrompt, chatHistory);
    if (res.success) {
      return { text: res.text };
    }

    const rawLower = (res.rawError || '').toLowerCase();
    const isQuotaErr = res.statusCode === 429 || rawLower.includes('quota') || rawLower.includes('resource_exhausted');

    if (isQuotaErr) {
      hadQuotaError = true;
    }
  }

  if (hadQuotaError) {
    return {
      error: '⚠️ **Gemini API тегін лимиті толды.**\n\nGoogle AI Studio жобаңызда бұл модельге тегін сұраныс лимиті уақытша толысты. [aistudio.google.com/apikey](https://aistudio.google.com/apikey) сайтынан жаңа тегін API Key жасап, ⚙️ **Баптаулар** батырмасына қойыңыз немесе 1 минут күтіңіз.'
    };
  }

  return { error: '⚠️ **Желілік сұраныс сәтсіз.**\n\nБайланысты тексеріп, қайта қайталаңыз.' };
}

const { spawn } = require('child_process');

function startLocalAIServerProcess() {
  try {
    const scriptPath = '/Users/dev/Desktop/galamtor-local-ai/serve_local.py';
    if (fs.existsSync(scriptPath)) {
      const proc = spawn('python3', [scriptPath], { detached: true, stdio: 'ignore' });
      proc.unref();
      console.log('[Local AI] Native M1 Pro Python server launched on port 8080');
    }
  } catch (err) {
    console.error('[Local AI] Server launch error:', err);
  }
}

// Auto-start Local AI server process
startLocalAIServerProcess();

function callLocalAIServer(prompt, pageContext) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ prompt, pageContext });
    const options = {
      hostname: '127.0.0.1',
      port: 8080,
      path: '/ai/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 3000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) resolve({ success: true, text: parsed.text });
            else resolve({ success: false });
          } catch { resolve({ success: false }); }
        } else resolve({ success: false });
      });
    });

    req.on('error', () => resolve({ success: false }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false }); });
    req.write(payload);
    req.end();
  });
}

const GALAMTOR_SYSTEM_PROMPT = `Сен Galamtor браузерінің AI көмекшісісің — қазақ тілді қолданушыларға арналған зерделі ассистент.

Негізгі ережелер:
- Жауапты қазақ тілінде бер (егер қолданушы басқа тілде сұраса, сол тілде жауап бер)
- Markdown форматын қолдан: **қалың**, *курсив*, \`код\`, код блоктары, тізімдер
- Жауап нақты, қысқа және пайдалы болсын
- Код жазғанда syntax highlighting үшін тіл белгісін қой: \`\`\`python, \`\`\`javascript, т.б.
- Қолданушы бет туралы сұраса, контекстегі бет ақпаратын пайдалан
- Сыпайы, достық тонда жауап бер`;

ipcMain.handle('ai:chat', async (event, { prompt, pageContext, chatHistory }) => {
  if (!validateSender(event)) return { error: 'Құқық жоқ.' };

  const cleanPrompt = (prompt || '').trim().toLowerCase();

  // Instant smart response for common Kazakh greetings without API call
  if (['салем', 'сәлем', 'привет', 'hello', 'hi', 'қалайсың', 'хәл қалай', 'сәлеметсіз бе'].includes(cleanPrompt)) {
    return { text: 'Сәлеметсіз бе! Мен **Galamtor AI** көмекшісімін. Сізге қалай көмектесе аламын?\n\n- 📄 **Бетті түйіндеу** батырмасын басыңыз\n- ⬇️ **Авто-жүктеу** арқылы файлдарды сақтаңыз\n- 🌐 **Аудару** арқылы қазақшаға аударыңыз' };
  }

  // 1. Try local M1 Pro AI server first
  const localRes = await callLocalAIServer(prompt, pageContext);
  if (localRes.success) {
    return { text: localRes.text };
  }

  // 2. Fallback to Gemini Cloud API
  let userPrompt = prompt;
  if (pageContext && (pageContext.title || pageContext.url)) {
    userPrompt = `Ашық бет: "${pageContext.title || ''}"\nURL: ${pageContext.url || ''}\n\nСұрақ: ${prompt}`;
  }
  return await callGeminiAPI(GALAMTOR_SYSTEM_PROMPT, userPrompt, chatHistory);
});

ipcMain.handle('ai:summarize', async (event, { pageContent, pageTitle, pageUrl }) => {
  if (!validateSender(event)) return { error: 'Құқық жоқ.' };

  // Try local M1 Pro server first for summary
  const localRes = await callLocalAIServer(`Бетті түйінде: ${pageTitle}`, { title: pageTitle, url: pageUrl });
  if (localRes.success) {
    return { text: localRes.text };
  }

  const systemPrompt = 'Сен веб-беттерді қысқаша түйіндейтін AI көмекшісісің. Жауапты тек қазақ тілінде жаз. Негізгі ойларды нөмірлеп жаз. Markdown қолдан.';
  const userPrompt = `Тақырыбы: ${pageTitle || 'Белгісіз'}\nСілтеме: ${pageUrl || ''}\n\nМәтін:\n${pageContent}\n\nОсы мәтіннің қысқаша түйіндемесін жаз.`;
  return await callGeminiAPI(systemPrompt, userPrompt);
});

ipcMain.handle('ai:get-page-content', async (event) => {
  if (!validateSender(event)) return '';
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return '';
  try {
    return await win.webContents.executeJavaScript(`
      (async () => {
        const activeWebview = document.querySelector('webview:not([style*="display: none"])') || document.querySelector('webview');
        if (activeWebview) {
          return await activeWebview.executeJavaScript('(document.body.innerText || "").substring(0, 50000)');
        }
        return '';
      })();
    `);
  } catch (err) {
    console.error('[AI] get-page-content error:', err);
    return '';
  }
});

ipcMain.handle('ai:set-api-key', (event, apiKey) => {
  if (!validateSender(event)) return false;
  return saveGeminiApiKey(apiKey);
});

ipcMain.handle('ai:get-api-key', (event) => {
  if (!validateSender(event)) return '';
  return loadGeminiApiKey();
});

// ── Ұлттық Кибер-Қалқан & Banking Shield IPC ──
ipcMain.handle('qalqan:check-url', (event, targetUrl) => {
  if (!validateSender(event)) return { isScam: false };
  return isPhishingOrScam(targetUrl);
});

ipcMain.handle('banking:get-status', (event) => {
  if (!validateSender(event)) return false;
  return isBankingShieldActive;
});

// ── Qazaq AI Context Engine IPC ──
ipcMain.handle('ai:context-adapt', async (event, { content, url: pageUrl }) => {
  if (!validateSender(event)) return { error: 'Құқық жоқ.' };
  const preprocessed = convertUnitsAndCurrency(content);
  const prompt = `Мына веб-бет мазмұнын қазақстандық пайдаланушы үшін талдап, жергілікті контекстке бейімде:
1. Шетелдік қызметтер мен өнімдер кездессе, Қазақстандағы баламаларын ұсын (мысалы: Amazon -> Kaspi/Flip, Uber -> InDrive, Deliveroo -> Wolt/Choco, т.б.).
2. Бағаларды теңгеге шағып есепте (1 USD ≈ 485.5 ₸, 1 EUR ≈ 532 ₸).
3. Шетелдік заңнамалық сілтемелер болса, ҚР сәйкес құқықтық нормаларымен салыстырмалы түсінік бер.
4. Қазақ тілінде нақты әрі құрылымды түрде жаз.

Мәтін:
${(preprocessed || '').substring(0, 15000)}`;

  return await callGeminiAPI(GALAMTOR_SYSTEM_PROMPT, prompt);
});
