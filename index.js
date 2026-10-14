const { app, BrowserWindow, nativeImage, Menu, MenuItem, ipcMain, shell, session, systemPreferences, safeStorage, webContents, dialog } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const crypto = require('crypto');
const { fetchRelease, isNewerVersion } = require('./public/release-utils');
const unsignedMacPreview = process.platform === 'darwin' && require('./package.json').galamtorRelease?.unsignedPreview === true;
const { readJsonFile, writeJsonAtomic } = require('./profile-storage');
const { createAuthCallbackServer } = require('./auth-server');
const { isPhishingOrScam, isYouTubeURL } = require('./security-utils');
const { checkOllamaStatus, pullOllamaModel } = require('./ollama-client');
const { createChatGPTPlanClient, ChatGPTPlanError } = require('./chatgpt-plan');
const { checkNcaLayer } = require('./ncalayer-diagnostics');
const {
  createLegalExplanationPrompts,
  hasVerifiableLegalEvidence,
  extractLegalPurposeSentence
} = require('./legal-assistant');
const { isRecord, webURL, normalizeHistory, normalizeSessionTabs, normalizeBookmarks, changeBookmark, normalizeDownloads } = require('./browser-state');

if (!app.isPackaged || app.commandLine.hasSwitch('galamtor-qa')) {
  const developmentProfile = process.env.GALAMTOR_DEV_PROFILE
    ? path.resolve(process.env.GALAMTOR_DEV_PROFILE)
    : path.join(app.getPath('appData'), app.isPackaged ? 'Galamtor QA' : 'Galamtor Development');
  fs.mkdirSync(developmentProfile, { recursive: true });
  app.setPath('userData', developmentProfile);
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

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

// Keep Chromium's normal user-gesture rules for media and browser automation.
app.commandLine.appendSwitch('enable-features', 'PasswordGeneration,PasswordImport,OverlayScrollbar');

let mainWindow = null;
let chatGPTPlanClient = null;
let authServer = null;
let authState = null;
let authFlow = null;
let pendingAuth = null;
let currentLanguage = 'kk'; // Default system-wide context-menu language
const recentPopupTimes = new WeakMap();

// The Firebase Hosting origins that the auth-redirect page is served from.
const AUTH_REDIRECT_ORIGIN = 'https://galamtor.web.app';
const ALLOWED_AUTH_ORIGINS = [
  'https://galamtor.web.app',
  'https://galamtor.firebaseapp.com',
  'https://galamtor-browser-974cc.web.app',
  'https://galamtor-browser-974cc.firebaseapp.com',
  'http://localhost:3000'
];



// ── Unified Context Menu Translations ──
const CONTEXT_MENU_TRANSLATIONS = {
  kk: {
    openLinkInNewTab: 'Сілтемені жаңа қойындыда ашу',
    copyLinkAddress: 'Сілтемені көшіру',
    cut: 'Қиып алу',
    openImageInNewTab: 'Суретті жаңа қойындыда ашу',
    copyImage: 'Суретті көшіру',
    copyImageAddress: 'Сурет сілтемесін көшіру',
    copy: 'Көшіру',
    paste: 'Қою',
    selectAll: 'Барлығын таңдау',
    inspectElement: 'Кодты көру'
  },
  ru: {
    openLinkInNewTab: 'Открыть ссылку в новой вкладке',
    copyLinkAddress: 'Копировать адрес ссылки',
    cut: 'Вырезать',
    openImageInNewTab: 'Открыть изображение в новой вкладке',
    copyImage: 'Копировать изображение',
    copyImageAddress: 'Копировать адрес изображения',
    copy: 'Копировать',
    paste: 'Вставить',
    selectAll: 'Выбрать все',
    inspectElement: 'Просмотреть код'
  },
  en: {
    openLinkInNewTab: 'Open Link in New Tab',
    copyLinkAddress: 'Copy Link Address',
    cut: 'Cut',
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

// ── Native macOS / Application Menu (Full Kazakh Localization & Shortcuts) ──
function sendMenuAction(action, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (['focus-address', 'find-in-page', 'find-next', 'find-previous', 'command-palette', 'new-tab',
      'new-incognito-tab', 'open-settings', 'open-history', 'open-bookmarks', 'open-downloads',
      'customize-startpage', 'toggle-ai'].includes(action)) mainWindow.webContents.focus();
    mainWindow.webContents.send('menu-action', action, data);
  }
}

function setApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [];
  
  if (isMac) {
    template.push({
      label: 'Galamtor',
      submenu: [
        { role: 'about', label: 'Galamtor туралы' },
        {
          label: 'Жаңартуларды тексеру...',
          click: () => sendMenuAction('check-update')
        },
        { type: 'separator' },
        {
          label: 'Баптаулар...',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendMenuAction('open-settings')
        },
        { type: 'separator' },
        { role: 'services', label: 'Қызметтер' },
        { type: 'separator' },
        { role: 'hide', label: 'Ғаламторды жасыру' },
        { role: 'hideOthers', label: 'Басқаларын жасыру' },
        { role: 'unhide', label: 'Барлығын көрсету' },
        { type: 'separator' },
        { role: 'quit', label: 'Ғаламтордан шығу' }
      ]
    });
  }

  // Файл
  template.push({
    label: 'Файл',
    submenu: [
      {
        label: 'Жаңа қойынды',
        accelerator: 'CmdOrCtrl+T',
        click: () => sendMenuAction('new-tab')
      },
      {
        label: 'Жаңа жеке қойынды (Инкогнито)',
        accelerator: 'Shift+CmdOrCtrl+N',
        click: () => sendMenuAction('new-incognito-tab')
      },
      {
        label: 'Қойындыны жабу',
        accelerator: 'CmdOrCtrl+W',
        click: () => sendMenuAction('close-tab')
      },
      {
        label: 'Жабылған қойындыны қайта ашу',
        accelerator: 'Shift+CmdOrCtrl+T',
        click: () => sendMenuAction('reopen-tab')
      },
      { label: 'Қойындыны көшіру', click: () => sendMenuAction('duplicate-tab') },
      { label: 'Қойынды дыбысын қосу/өшіру', click: () => sendMenuAction('mute-tab') },
      { type: 'separator' },
      {
        label: 'Бетті сақтау...',
        accelerator: 'CmdOrCtrl+S',
        click: () => sendMenuAction('save-page')
      },
      {
        label: 'Басып шығару...',
        accelerator: 'CmdOrCtrl+P',
        click: () => sendMenuAction('print')
      },
      ...(!isMac ? [
        { type: 'separator' },
        { role: 'quit', label: 'Шығу' }
      ] : [])
    ]
  });

  // Өңдеу
  template.push({
    label: 'Өңдеу',
    submenu: [
      { role: 'undo', label: 'Болдырмау' },
      { role: 'redo', label: 'Қайталау' },
      { type: 'separator' },
      { role: 'cut', label: 'Қиып алу' },
      { role: 'copy', label: 'Көшіру' },
      { role: 'paste', label: 'Қою' },
      { role: 'selectAll', label: 'Барлығын таңдау' },
      { type: 'separator' },
      {
        label: 'Беттен іздеу...',
        accelerator: 'CmdOrCtrl+F',
        click: () => sendMenuAction('find-in-page')
      },
      { label: 'Келесі сәйкестік', accelerator: 'CmdOrCtrl+G', click: () => sendMenuAction('find-next') },
      { label: 'Алдыңғы сәйкестік', accelerator: 'Shift+CmdOrCtrl+G', click: () => sendMenuAction('find-previous') },
      { type: 'separator' },
      { label: 'Мекенжайды енгізу', accelerator: 'CmdOrCtrl+L', click: () => sendMenuAction('focus-address') }
    ]
  });

  // Көрініс
  template.push({
    label: 'Көрініс',
    submenu: [
      { label: 'Қойындылар мен әрекеттерді іздеу...', accelerator: 'CmdOrCtrl+K', click: () => sendMenuAction('command-palette') },
      { type: 'separator' },
      {
        label: 'Қайта жүктеу',
        accelerator: 'CmdOrCtrl+R',
        click: () => sendMenuAction('reload')
      },
      {
        label: 'Мәжбүрлі қайта жүктеу',
        accelerator: 'Shift+CmdOrCtrl+R',
        click: () => sendMenuAction('force-reload')
      },
      { type: 'separator' },
      {
        label: 'Үлкейту',
        accelerator: 'CmdOrCtrl+=',
        click: () => sendMenuAction('zoom-in')
      },
      {
        label: 'Кішірейту',
        accelerator: 'CmdOrCtrl+-',
        click: () => sendMenuAction('zoom-out')
      },
      {
        label: 'Масштабты қалпына келтіру',
        accelerator: 'CmdOrCtrl+0',
        click: () => sendMenuAction('zoom-reset')
      },
      { type: 'separator' },
      {
        label: 'Galamtor AI Көмекшісі',
        accelerator: 'CmdOrCtrl+/',
        click: () => sendMenuAction('toggle-ai')
      },
      {
        label: 'Тарих тақтасы',
        accelerator: 'CmdOrCtrl+Y',
        click: () => sendMenuAction('open-history')
      },
      {
        label: 'Бетбелгілер тақтасы',
        accelerator: 'CmdOrCtrl+B',
        click: () => sendMenuAction('open-bookmarks')
      },
      {
        label: 'Жүктеулер тақтасы',
        accelerator: 'CmdOrCtrl+J',
        click: () => sendMenuAction('open-downloads')
      },
      {
        label: 'Басты бетті баптау (Тұсқағаз, MP4, Виджеттер)...',
        accelerator: 'CmdOrCtrl+Shift+P',
        click: () => sendMenuAction('customize-startpage')
      },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Толық экран режимі' },
      { role: 'toggleDevTools', label: 'Әзірлеуші құралдары (DevTools)' }
    ]
  });

  // Тарих
  template.push({
    label: 'Тарих',
    submenu: [
      {
        label: 'Артқа',
        accelerator: 'CmdOrCtrl+[',
        click: () => sendMenuAction('go-back')
      },
      {
        label: 'Алға',
        accelerator: 'CmdOrCtrl+]',
        click: () => sendMenuAction('go-forward')
      },
      {
        label: 'Басты бетке өту',
        accelerator: 'Shift+CmdOrCtrl+H',
        click: () => sendMenuAction('go-home')
      },
      { type: 'separator' },
      {
        label: 'Тарихты ашу...',
        click: () => sendMenuAction('open-history')
      },
      {
        label: 'Тарихты тазарту...',
        click: () => sendMenuAction('clear-history')
      }
    ]
  });

  // Бетбелгілер
  template.push({
    label: 'Бетбелгілер',
    submenu: [
      {
        label: 'Осы бетті бетбелгіге қосу',
        accelerator: 'CmdOrCtrl+D',
        click: () => sendMenuAction('add-bookmark')
      },
      {
        label: 'Бетбелгілерді қарау...',
        accelerator: 'Shift+CmdOrCtrl+B',
        click: () => sendMenuAction('open-bookmarks')
      }
    ]
  });

  // Терезе
  template.push({
    label: 'Терезе',
    submenu: [
      { label: 'Келесі қойынды', accelerator: 'Control+Tab', click: () => sendMenuAction('next-tab') },
      { label: 'Алдыңғы қойынды', accelerator: 'Control+Shift+Tab', click: () => sendMenuAction('previous-tab') },
      { type: 'separator' },
      { role: 'minimize', label: 'Кішірейту' },
      { role: 'zoom', label: 'Масштабтау' },
      ...(isMac ? [
        { type: 'separator' },
        { role: 'front', label: 'Барлығын алға шығару' },
        { role: 'window', label: 'Терезе' }
      ] : [
        { role: 'close', label: 'Жабу' }
      ])
    ]
  });

  // Анықтама
  template.push({
    label: 'Анықтама',
    submenu: [
      {
        label: 'Galamtor ресми сайты',
        click: () => shell.openExternal('https://galamtor.web.app')
      },
      {
        label: 'Кибер-Қалқан қауіпсіздік жүйесі туралы',
        click: () => sendMenuAction('about-qalqan')
      },
      { type: 'separator' },
      {
        label: 'Қазақ тілді қолдау қызметі',
        click: () => shell.openExternal('https://github.com/akhmet-dev/Galamtor-')
      }
    ]
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ── IPC Sender Validation ──
function validateSender(event) {
  const senderUrl = event.senderFrame ? event.senderFrame.url : '';
  const mainFrame = mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.mainFrame;
  if (event.sender === mainWindow?.webContents && event.senderFrame === mainFrame &&
      senderUrl === url.pathToFileURL(path.join(__dirname, 'index.html')).href) return true;
  console.warn('[Security] Blocked untrusted IPC sender');
  return false;
}

function isIncognitoWebContents(contents) {
  try {
    return contents?.session === session.fromPartition('incognito');
  } catch {
    return false;
  }
}

// ── History Manager System ──
const MAX_HISTORY = 10000;
function getHistoryPath() {
  return path.join(app.getPath('userData'), 'history.json');
}

function loadHistory() {
  return normalizeHistory(readJsonFile(getHistoryPath(), [], Array.isArray));
}

function saveHistory(history, options = {}) {
  try { return writeJsonAtomic(getHistoryPath(), normalizeHistory(history), { ...options, isValid: Array.isArray }); }
  catch (error) { console.error('[History] Failed to save:', error.message); return false; }
}

// ── Settings Persistence ──
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  return readJsonFile(getSettingsPath(), {}, isRecord);
}

function saveSettings(settings) {
  if (!isRecord(settings)) return false;
  try { return writeJsonAtomic(getSettingsPath(), { ...loadSettings(), ...settings }, { isValid: isRecord }); }
  catch (error) { console.error('[Settings] Failed to save:', error.message); return false; }
}

function addHistoryEntry(entry) {
  const [clean] = normalizeHistory([entry]);
  if (!clean) return false;
  const history = loadHistory();
  const previous = history[0];
  if (previous?.url === clean.url && Math.abs(clean.timestamp - previous.timestamp) < 2000) history.shift();
  history.unshift(clean);
  return saveHistory(history.slice(0, MAX_HISTORY));
}

// ── Session Auto-Restore System ──
function getSessionPath() {
  return path.join(app.getPath('userData'), 'session.json');
}

function loadSession() {
  return normalizeSessionTabs(readJsonFile(getSessionPath(), [], Array.isArray));
}

function saveSession(sessionTabs) {
  try { return writeJsonAtomic(getSessionPath(), normalizeSessionTabs(sessionTabs), { isValid: Array.isArray }); }
  catch (error) { console.error('[Session] Failed to save:', error.message); return false; }
}

// ── Bookmarks Manager System ──
function getBookmarksPath() {
  return path.join(app.getPath('userData'), 'bookmarks.json');
}

function loadBookmarks() {
  const stored = readJsonFile(getBookmarksPath(), null, Array.isArray);
  if (stored !== null) return normalizeBookmarks(stored);
  // Default Kazakh digital ecosystem bookmarks
  return normalizeBookmarks([
    { id: 'bm_1', title: 'Kaspi.kz', url: 'https://kaspi.kz', favicon: 'https://kaspi.kz/favicon.ico', createdAt: Date.now() },
    { id: 'bm_2', title: 'eGov.kz', url: 'https://egov.kz', favicon: 'https://egov.kz/favicon.ico', createdAt: Date.now() },
    { id: 'bm_3', title: 'Tengrinews.kz', url: 'https://tengrinews.kz', favicon: 'https://tengrinews.kz/favicon.ico', createdAt: Date.now() },
    { id: 'bm_4', title: 'Enbek.kz', url: 'https://enbek.kz', favicon: 'https://enbek.kz/favicon.ico', createdAt: Date.now() },
    { id: 'bm_5', title: 'Kolesa.kz', url: 'https://kolesa.kz', favicon: 'https://kolesa.kz/favicon.ico', createdAt: Date.now() },
    { id: 'bm_6', title: 'Krisha.kz', url: 'https://krisha.kz', favicon: 'https://krisha.kz/favicon.ico', createdAt: Date.now() }
  ]);
}

function saveBookmarks(bookmarks) {
  try { return writeJsonAtomic(getBookmarksPath(), normalizeBookmarks(bookmarks), { isValid: Array.isArray }); }
  catch (error) { console.error('[Bookmarks] Failed to save:', error.message); return false; }
}

// ── Exchange rates from open.er-api.com ──
let exchangeRatesRequest = null;
let cachedRates = { USD: null, EUR: null, RUB: null, CNY: null, updatedAt: 0, fetchedAt: 0 };

async function fetchLiveExchangeRates() {
  return new Promise((resolve) => {
    const req = https.get('https://open.er-api.com/v6/latest/USD', (res) => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        if (data.length > 256000) req.destroy(new Error('Response too large'));
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed?.result === 'success' && parsed.rates && Number.isFinite(parsed.rates.KZT) && parsed.rates.KZT > 0) {
            const usdKzt = parsed.rates.KZT;
            const eurKzt = parsed.rates.EUR ? (usdKzt / parsed.rates.EUR) : null;
            const rubKzt = parsed.rates.RUB ? (usdKzt / parsed.rates.RUB) : null;
            const cnyKzt = parsed.rates.CNY ? (usdKzt / parsed.rates.CNY) : null;
            cachedRates = {
              USD: parseFloat(usdKzt.toFixed(1)),
              EUR: !Number.isFinite(eurKzt) ? null : parseFloat(eurKzt.toFixed(1)),
              RUB: !Number.isFinite(rubKzt) ? null : parseFloat(rubKzt.toFixed(2)),
              CNY: !Number.isFinite(cnyKzt) ? null : parseFloat(cnyKzt.toFixed(1)),
              updatedAt: Number.isFinite(parsed.time_last_update_unix) ? parsed.time_last_update_unix * 1000 : 0,
              fetchedAt: Date.now()
            };
            EXCHANGE_RATES.USD = cachedRates.USD;
            EXCHANGE_RATES.EUR = cachedRates.EUR;
            EXCHANGE_RATES.RUB = cachedRates.RUB;
            EXCHANGE_RATES.CNY = cachedRates.CNY;
            resolve(cachedRates);
            return;
          }
        } catch (e) {}
        resolve({ ...cachedRates, refreshFailed: true });
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('Timed out')));
    req.on('error', () => resolve({ ...cachedRates, refreshFailed: true }));
  });
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
  
  const handleRequest = (details, callback) => {
    if (details.resourceType === 'mainFrame') {
      const scan = isPhishingOrScam(details.url);
      if (scan.isScam) {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('qalqan-blocked', {
          url: details.url, reason: scan.reason, contentsId: details.webContentsId
        });
        return callback({ cancel: true });
      }
    }
    if (!adBlockEnabled) {
      return callback({ cancel: false });
    }

    try {
      const parsedUrl = new url.URL(details.url);
      const hostname = parsedUrl.hostname.toLowerCase();
      
      // CRITICAL: Protect YouTube & Google Video player media streams
      // Canceling ad/telemetry endpoints from youtube.com triggers YouTube's anti-adblock video crash ("Что-то пошло не так")
      const isYouTubeContext = [details.initiator, details.referrer, details.url].some(isYouTubeURL);

      if (isYouTubeContext) {
        return callback({ cancel: false });
      }

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
  };

  session.defaultSession.webRequest.onBeforeRequest(filter, handleRequest);
  try {
    session.fromPartition('incognito').webRequest.onBeforeRequest(filter, handleRequest);
  } catch (e) {}
}

// ── Ұлттық Кибер-Қалқан (Cyber Qalqan Anti-Phishing) ──
// ── Gov & Fintech Secure Vault ──
const BANKING_DOMAINS = ['kaspi.kz', 'egov.kz', 'halykbank.kz', 'homebank.kz', 'enbek.kz', 'cabinet.salyk.kz', 'stat.gov.kz'];
let isBankingShieldActive = false;

function checkBankingShield(targetUrl) {
  let host = '';
  try {
    host = new url.URL(targetUrl).hostname.toLowerCase();
  } catch {}
  const isBanking = !!host && BANKING_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  isBankingShieldActive = isBanking;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (typeof mainWindow.setContentProtection === 'function') {
      mainWindow.setContentProtection(isBanking);
    }
    mainWindow.webContents.send('banking-shield-status', { active: isBanking, host });
  }
}

// ── Qazaq AI Context Engine: Currency & Measurement Conversion ──
const EXCHANGE_RATES = { USD: null, EUR: null, RUB: null, CNY: null };

function convertUnitsAndCurrency(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  // USD to KZT
  out = out.replace(/\$(\d+(?:\.\d{1,2})?)/g, (match, val) => {
    if (!EXCHANGE_RATES.USD) return match;
    const kzt = Math.round(parseFloat(val) * EXCHANGE_RATES.USD);
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
  return normalizeDownloads(readJsonFile(getDownloadsPath(), [], Array.isArray));
}

function saveDownloads(downloads, options = {}) {
  try { return writeJsonAtomic(getDownloadsPath(), normalizeDownloads(downloads), { ...options, isValid: Array.isArray }); }
  catch (error) { console.error('[Downloads] Failed to save:', error.message); return false; }
}

function addDownloadEntry(entry) {
  let downloads = loadDownloads();
  downloads.unshift(entry);
  saveDownloads(downloads);
}

// ── OAuth Handshake Loopback Server ──
function startAuthServer(win, state) {
  if (authServer) return;
  authState = state;
  const target = win || mainWindow;
  const report = code => { if (target && !target.isDestroyed()) target.webContents.send('auth-server-error', code); };
  const flow = createAuthCallbackServer({
    state, origins: ALLOWED_AUTH_ORIGINS,
    onExpire: () => report('auth/timeout'),
    onCancel: () => { report('auth/cancelled'); stopAuthServer(); },
    onCredential: payload => new Promise(resolve => {
      if (!target || target.isDestroyed()) { resolve({ ok: false, code: 'auth/app-unavailable' }); return; }
      const requestId = crypto.randomUUID();
      pendingAuth = { requestId, resolve };
      target.webContents.send('firebase-auth-token', { ...payload, requestId });
    })
  });
  authFlow = flow;
  authServer = flow.server;
  flow.server.on('error', error => { stopAuthServer(); report(error.code === 'EADDRINUSE' ? 'auth/port-in-use' : 'auth/server-failed'); });
  flow.server.on('close', () => { if (authFlow === flow) stopAuthServer(); });
  flow.server.listen(4242, '127.0.0.1', () => {
    shell.openExternal(`${AUTH_REDIRECT_ORIGIN}/auth.html?mode=login&state=${state}`).catch(() => {
      stopAuthServer(); report('auth/open-failed');
    });
  });
}

function stopAuthServer() {
  if (pendingAuth) { pendingAuth.resolve({ ok: false, code: 'auth/cancelled' }); pendingAuth = null; }
  authFlow?.stop();
  authFlow = null;
  authServer = null;
  authState = null;
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

  const createdWindow = mainWindow;
  createdWindow.once('closed', () => { if (mainWindow === createdWindow) mainWindow = null; stopAuthServer(); });
  createdWindow.webContents.on('render-process-gone', stopAuthServer);
  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged || unsignedMacPreview) return;
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

  autoUpdater.on('update-not-available', info => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-not-available', { version: info.version });
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

  // Enable spellcheck languages at session level
  session.defaultSession.setSpellCheckerLanguages(['kk', 'ru', 'en']);

  // ── Setup AdBlocker & Privacy Shield Engine ──
  setupAdBlocker();

  // Protect the application shell; guest sites retain their own response headers.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url === url.pathToFileURL(path.join(__dirname, 'index.html')).href) {
      return callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; media-src 'self' https: blob: data:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://*.googleapis.com wss://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebaseapp.com https://open.er-api.com wss://127.0.0.1:13579; frame-src 'none'; object-src 'none'; base-uri 'none'"]
        }
      });
    }
    callback({ responseHeaders: details.responseHeaders });
  });

  const permittedTypes = new Set(['media', 'geolocation', 'notifications', 'clipboard-read', 'display-capture']);
  for (const browserSession of [session.defaultSession, session.fromPartition('incognito')]) {
    const permissionGrants = new Set(); // Grants never cross normal/private sessions.
    browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      let origin;
      try { origin = new URL(details.requestingUrl || webContents.getURL()).origin; } catch { callback(false); return; }
      if (!origin.startsWith('https://') || !permittedTypes.has(permission)) { callback(false); return; }
      const grantKey = `${origin}:${permission}`;
      if (permission !== 'media' && permissionGrants.has(grantKey)) { callback(true); return; }
      const { dialog } = require('electron');
      dialog.showMessageBox(mainWindow, {
        type: 'question',
        message: `${origin} — ${permission} рұқсатын беру керек пе?`,
        buttons: ['Рұқсат беру', 'Бас тарту'],
        defaultId: 1,
        cancelId: 1
      }).then(({ response }) => {
        if (response === 0 && permission !== 'media') permissionGrants.add(grantKey);
        callback(response === 0);
      }).catch(() => callback(false));
    });
    browserSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
      permissionGrants.has(`${requestingOrigin}:${permission}`));
  }

  // ── Setup Downloads Monitor System ──
  for (const downloadSession of [session.defaultSession, session.fromPartition('incognito')]) {
  downloadSession.on('will-download', (event, item, contents) => {
    const isIncognito = isIncognitoWebContents(contents);
    const downloadId = 'dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const fileName = item.getFilename();
    let totalBytes = item.getTotalBytes();

    item.on('updated', (event, state) => {
      if (state === 'progressing') {
        totalBytes = item.getTotalBytes();
        const receivedBytes = item.getReceivedBytes();
        const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            isIncognito,
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
            isIncognito,
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
        isIncognito,
        filename: fileName,
        savePath: item.getSavePath(),
        totalBytes,
        state,
        completedAt: Date.now()
      };

      if (state === 'completed' && !isIncognito) {
        addDownloadEntry(meta);
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-done', meta);
      }
    });
  });
  }

  createWindow();
  setupAutoUpdater();
  setApplicationMenu();


  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', stopAuthServer);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// ── Native Right-Click Context Menu for Webviews ──
app.on('web-contents-created', (event, contents) => {
  // Prevent MaxListenersExceededWarning on guest webviews
  contents.setMaxListeners(50);

  // Propagate spellchecker languages to nested guest webviews
  contents.session.setSpellCheckerLanguages(['kk', 'ru', 'en']);

  contents.on('will-attach-webview', (attachEvent, webPreferences, params) => {
    let parsed;
    try { parsed = new URL(params.src); } catch { attachEvent.preventDefault(); return; }
    if (!['https:', 'http:'].includes(parsed.protocol)) { attachEvent.preventDefault(); return; }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
  });

  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt || input.shift) return;
    if (/^[1-9]$/.test(input.key)) {
      event.preventDefault();
      sendMenuAction('select-tab', Number(input.key));
    }
  });

  contents.setWindowOpenHandler(({ url: popupUrl }) => {
    try {
      const parsed = new URL(popupUrl);
      if (['https:', 'http:'].includes(parsed.protocol) && mainWindow && !mainWindow.isDestroyed()) {
        const recent = (recentPopupTimes.get(contents) || []).filter(time => Date.now() - time < 5000);
        if (recent.length < 3) {
          recent.push(Date.now());
          recentPopupTimes.set(contents, recent);
          mainWindow.webContents.send('open-popup-tab', {
            url: popupUrl,
            isIncognito: isIncognitoWebContents(contents)
          });
        }
      }
    } catch {}
    return { action: 'deny' };
  });

  // ── Кибер-Қалқан & Banking Shield navigation interception ──
  const handleNavSecurity = (e, navUrl) => {
    if (!navUrl || typeof navUrl !== 'string') return;
    if (contents === mainWindow?.webContents) {
      if (navUrl !== url.pathToFileURL(path.join(__dirname, 'index.html')).href) e.preventDefault();
      return;
    }
    let parsed;
    try { parsed = new URL(navUrl); } catch { e.preventDefault(); return; }
    if (!['http:', 'https:'].includes(parsed.protocol)) { e.preventDefault(); return; }
    const scan = isPhishingOrScam(navUrl);
    if (scan.isScam) {
      e.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('qalqan-blocked', { url: navUrl, reason: scan.reason, contentsId: contents.id });
      }
      return;
    }
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
    const menu = new Menu();
    const linkUrl = webURL(params.linkURL);
    if (linkUrl) {
      menu.append(new MenuItem({
        label: getContextTranslation('openLinkInNewTab'),
        click: () => sendMenuAction('open-link-tab', { url: linkUrl, isIncognito: isIncognitoWebContents(contents) })
      }));
      menu.append(new MenuItem({
        label: getContextTranslation('copyLinkAddress'),
        click: () => require('electron').clipboard.writeText(linkUrl)
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // 1. Image-specific options
    if (params.mediaType === 'image') {
      if (params.srcURL) {
        menu.append(new MenuItem({
          label: getContextTranslation('openImageInNewTab'),
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
              win.webContents.send('open-image-in-new-tab', {
                url: params.srcURL,
                isIncognito: isIncognitoWebContents(contents)
              });
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
      menu.append(new MenuItem({ label: getContextTranslation('cut'), role: 'cut' }));
      if (!hasText) menu.append(new MenuItem({ label: getContextTranslation('copy'), role: 'copy' }));
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
let manualUpdateRequest = null;
ipcMain.handle('update:check', async (event) => {
  if (!validateSender(event)) return false;
  if (unsignedMacPreview) {
    if (manualUpdateRequest) return manualUpdateRequest;
    manualUpdateRequest = (async () => {
      try {
        const release = await fetchRelease();
        if (!isNewerVersion(release.tag_name, app.getVersion())) {
          if (!event.sender.isDestroyed()) event.sender.send('update-not-available', { version: app.getVersion() });
        } else {
          const result = await dialog.showMessageBox(mainWindow, {
            type: 'info', title: 'Galamtor жаңартуы',
            message: `${release.tag_name} нұсқасы дайын`,
            detail: 'Қолтаңбасыз preview қолмен жаңартылады. Ресми релизден Mac түріңізге сай DMG жүктеп, қолданбаны жауып, Applications ішіндегі Galamtor-ды ауыстырыңыз. Профиль деректері сақталады.',
            buttons: ['Релизді ашу', 'Кейінірек'], defaultId: 0, cancelId: 1
          });
          if (result.response === 0) await shell.openExternal(release.html_url);
        }
        return { manual: true };
      } catch {
        if (!event.sender.isDestroyed()) event.sender.send('update-error', 'Желі байланысын тексеріп, қайталап көріңіз.');
        return { manual: true };
      } finally { manualUpdateRequest = null; }
    })();
    return manualUpdateRequest;
  }
  if (!autoUpdater || !app.isPackaged) return false;
  autoUpdater.checkForUpdates().catch(err => log.error('Manual update check error:', err));
  return true;
});
ipcMain.handle('browser:info', event => validateSender(event) ? { version: app.getVersion(), updateMode: unsignedMacPreview ? 'manual' : 'automatic' } : {});
ipcMain.handle('update:download', (event) => {
  if (!validateSender(event) || !autoUpdater || unsignedMacPreview || !app.isPackaged) return false;
  autoUpdater.downloadUpdate();
  return true;
});
ipcMain.handle('update:install', (event) => {
  if (!validateSender(event) || !autoUpdater || unsignedMacPreview || !app.isPackaged) return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
});

ipcMain.on('start-google-login', (event) => {
  if (!validateSender(event) || authServer) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  authState = crypto.randomBytes(32).toString('hex');
  startAuthServer(win, authState);
});

ipcMain.on('auth:complete', (event, requestId, errorCode) => {
  if (!validateSender(event) || pendingAuth?.requestId !== requestId) return;
  const code = typeof errorCode === 'string' && /^auth\/[a-z-]{1,64}$/.test(errorCode) ? errorCode : 'auth/failed';
  pendingAuth.resolve(errorCode === null ? { ok: true } : { ok: false, code });
  pendingAuth = null;
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
  return addHistoryEntry(entry);
});

ipcMain.handle('history:get', (event) => {
  if (!validateSender(event)) return [];
  return loadHistory();
});

ipcMain.handle('history:clear', (event) => {
  if (!validateSender(event)) return;
  return saveHistory([], { backup: false });
});

ipcMain.handle('downloads:get', (event) => {
  if (!validateSender(event)) return [];
  return loadDownloads();
});

ipcMain.handle('downloads:clear', (event) => {
  if (!validateSender(event)) return;
  return saveDownloads([], { backup: false });
});

ipcMain.handle('cache:clear', async (event) => {
  if (!validateSender(event)) return false;
  try {
    const sessions = [session.defaultSession, session.fromPartition('incognito')];
    await Promise.all(sessions.map(browserSession => browserSession.clearCache()));
    return true;
  } catch (err) {
    console.error('[Cache] Failed to clear browser cache:', err);
    return false;
  }
});

ipcMain.handle('page:save', async (event, contentsId) => {
  if (!validateSender(event) || !Number.isInteger(contentsId)) return { error: 'Құқық жоқ.' };
  const guest = webContents.fromId(contentsId);
  if (!guest || guest.isDestroyed() || guest.hostWebContents !== mainWindow.webContents || !webURL(guest.getURL())) {
    return { error: 'Алдымен веб-бетті ашыңыз.' };
  }
  try {
    const safeTitle = (guest.getTitle() || 'Galamtor page').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Бетті сақтау', defaultPath: path.join(app.getPath('downloads'), `${safeTitle}.html`),
      filters: [{ name: 'HTML', extensions: ['html'] }]
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    if (guest.isDestroyed()) return { error: 'Қойынды жабылды.' };
    await guest.savePage(result.filePath, 'HTMLComplete');
    return { saved: true };
  } catch (error) { return { error: 'Бетті сақтау сәтсіз аяқталды.' }; }
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
  const next = !adBlockEnabled;
  if (!saveSettings({ adBlockEnabled: next })) return { ok: false, enabled: adBlockEnabled };
  adBlockEnabled = next;
  console.log(`[AdBlocker] Toggled. Active state: ${adBlockEnabled}`);
  return adBlockEnabled;
});

ipcMain.handle('adblock:get-stats', (event) => {
  if (!validateSender(event)) return { enabled: true, count: 0 };
  return { enabled: adBlockEnabled, count: totalBlockedAds };
});

ipcMain.handle('session:save', (event, sessionTabs) => {
  if (!validateSender(event)) return;
  return saveSession(sessionTabs);
});

ipcMain.handle('session:load', (event) => {
  if (!validateSender(event)) return [];
  return loadSession();
});

// ── Bookmarks IPC Handlers ──
ipcMain.handle('bookmarks:get', (event) => {
  if (!validateSender(event)) return [];
  return loadBookmarks();
});

ipcMain.handle('bookmarks:add', (event, bookmark) => {
  if (!validateSender(event)) return false;
  const result = changeBookmark(loadBookmarks(), bookmark);
  return result.ok && saveBookmarks(result.bookmarks);
});

ipcMain.handle('bookmarks:update', (event, id, bookmark) => {
  if (!validateSender(event) || typeof id !== 'string') return { ok: false, error: 'invalid' };
  const result = changeBookmark(loadBookmarks(), bookmark, id);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: saveBookmarks(result.bookmarks), error: 'save' };
});

ipcMain.handle('bookmarks:remove', (event, idOrUrl) => {
  if (!validateSender(event) || !idOrUrl) return false;
  let bookmarks = loadBookmarks();
  const address = webURL(idOrUrl);
  bookmarks = bookmarks.filter(b => b.id !== idOrUrl && b.url !== address);
  return saveBookmarks(bookmarks);
});

ipcMain.handle('bookmarks:check', (event, url) => {
  if (!validateSender(event) || !url) return false;
  const bookmarks = loadBookmarks();
  return bookmarks.some(b => b.url === webURL(url));
});

// ── Rates IPC Handler ──
ipcMain.handle('rates:get', async (event, force = false) => {
  if (!validateSender(event)) return cachedRates;
  if (force === true || Date.now() - cachedRates.fetchedAt > 30 * 60 * 1000) {
    if (!exchangeRatesRequest) exchangeRatesRequest = fetchLiveExchangeRates().finally(() => { exchangeRatesRequest = null; });
    return await exchangeRatesRequest;
  }
  return cachedRates;
});

ipcMain.handle('download:trigger', (event, url) => {
  if (!validateSender(event) || typeof url !== 'string') return false;
  try {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) return false;
  } catch { return false; }
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

function getChatGPTClient() {
  if (!chatGPTPlanClient) {
    chatGPTPlanClient = createChatGPTPlanClient({
      appDataPath: app.getPath('userData'),
      safeStorage,
      openExternal: target => shell.openExternal(target)
    });
  }
  return chatGPTPlanClient;
}

function loadAiSettings() {
  try {
    const settingsPath = getAiSettingsPath();
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (settings.apiKey) {
      if (!safeStorage.isEncryptionAvailable()) return { cloudEnabled: false };
      const migrated = {
        cloudEnabled: false,
        encryptedApiKey: safeStorage.encryptString(settings.apiKey).toString('base64')
      };
      writeJsonAtomic(settingsPath, migrated, { backup: false, isValid: isRecord });
      fs.chmodSync(settingsPath, 0o600);
      return migrated;
    }
    return settings;
  } catch { return { cloudEnabled: false }; }
}

function writeAiSettings(settings) {
  try {
    writeJsonAtomic(getAiSettingsPath(), settings, { backup: false, isValid: isRecord });
    fs.chmodSync(getAiSettingsPath(), 0o600);
    return true;
  } catch (err) {
    console.error('[AI] Failed to save settings:', err);
    return false;
  }
}

function loadGeminiApiKey() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.startsWith('AIza')) {
    return process.env.GEMINI_API_KEY;
  }
  try {
    const settings = loadAiSettings();
    if (settings.encryptedApiKey && safeStorage.isEncryptionAvailable())
      return safeStorage.decryptString(Buffer.from(settings.encryptedApiKey, 'base64'));
  } catch (err) { console.error('[AI] Failed to decrypt key:', err); }
  return '';
}

function saveGeminiApiKey(apiKey) {
  if (apiKey === '') return writeAiSettings({ cloudEnabled: false });
  if (typeof apiKey !== 'string' || !/^AIza[\w-]{20,}$/.test(apiKey) || !safeStorage.isEncryptionAvailable()) return false;
  const settings = loadAiSettings();
  return writeAiSettings({
    cloudEnabled: !!settings.cloudEnabled,
    encryptedApiKey: safeStorage.encryptString(apiKey).toString('base64')
  });
}

function getLocalAIModelName() {
  const modelName = String(process.env.OLLAMA_MODEL || 'hermes3').trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(modelName) ? modelName : 'hermes3';
}

let activeOllamaPull = null;

ipcMain.handle('ai:ollama-status', async (event) => {
  if (!validateSender(event)) return { available: false, installed: false, cloudEnabled: false };
  const modelName = getLocalAIModelName();
  const status = await checkOllamaStatus(modelName);
  return { ...status, modelName, cloudEnabled: !!loadAiSettings().cloudEnabled };
});

ipcMain.handle('ai:ollama-pull', async (event) => {
  if (!validateSender(event)) return { success: false, error: 'Құқық жоқ.' };
  if (activeOllamaPull) return { success: false, error: 'Модель қазір жүктеліп жатыр.' };

  const modelName = getLocalAIModelName();
  const sender = event.sender;
  const controller = new AbortController();
  const onSenderDestroyed = () => controller.abort();
  sender.once('destroyed', onSenderDestroyed);
  activeOllamaPull = { senderId: sender.id, controller };
  try {
    const status = await checkOllamaStatus(modelName);
    if (controller.signal.aborted) return { success: false, cancelled: true, error: 'Модель жүктеуі тоқтатылды.' };
    if (!status.available) {
      return { success: false, error: 'Алдымен Ollama-ны орнатып, іске қосыңыз.' };
    }
    if (status.installed) return { success: true, alreadyInstalled: true };
    const result = await pullOllamaModel(modelName, (progress) => {
      if (sender.isDestroyed()) return;
      try { sender.send('ai:ollama-pull-progress', progress); } catch {}
    }, { signal: controller.signal });
    return result;
  } finally {
    if (activeOllamaPull?.controller === controller) activeOllamaPull = null;
    sender.removeListener('destroyed', onSenderDestroyed);
  }
});

ipcMain.handle('ai:ollama-pull-cancel', (event) => {
  if (!validateSender(event) || activeOllamaPull?.senderId !== event.sender.id) return false;
  activeOllamaPull.controller.abort();
  return true;
});

ipcMain.handle('ai:open-ollama-download', async (event) => {
  if (!validateSender(event)) return false;
  try {
    await shell.openExternal('https://ollama.com/download');
    return true;
  } catch (error) {
    console.error('[AI] Could not open Ollama download page:', error);
    return false;
  }
});

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
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > 2_000_000) req.destroy(new Error('Response too large'));
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            const text = (parsed.candidates?.[0]?.content?.parts || [])
              .filter(part => !part.thought && typeof part.text === 'string')
              .map(part => part.text).join('\n') || 'Жауап бос.';
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

    req.setTimeout(30_000, () => req.destroy(new Error('Request timed out')));

    req.write(payload);
    req.end();
  });
}

async function callGeminiAPI(systemInstruction, userPrompt, chatHistory) {
  if (!loadAiSettings().cloudEnabled) {
    return { error: 'Бұлттық AI өшірулі. ⚙️ Баптауларда Gemini қызметіне рұқсат беріңіз немесе Ollama іске қосыңыз.' };
  }
  const apiKey = loadGeminiApiKey();
  if (!apiKey || !apiKey.startsWith('AIza')) {
    return {
      error: '🔑 **Gemini API кілті орнатылмаған.**\n\nGoogle AI Studio API кілтін [aistudio.google.com/apikey](https://aistudio.google.com/apikey) бетінен алып, ⚙️ **AI баптауларына** енгізіңіз.'
    };
  }

  const targets = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : ['gemini-3.5-flash-lite', 'gemini-2.5-flash'])
    .map(model => ({ apiVersion: 'v1beta', model }));

  let hadQuotaError = false;
  let lastFailure = null;

  for (const target of targets) {
    const res = await requestSingleGeminiModel(target.apiVersion, target.model, apiKey, systemInstruction, userPrompt, chatHistory);
    if (res.success) {
      return { text: res.text };
    }
    lastFailure = res;

    const rawLower = (res.rawError || '').toLowerCase();
    const isQuotaErr = res.statusCode === 429 || rawLower.includes('quota') || rawLower.includes('resource_exhausted');

    if (isQuotaErr) {
      hadQuotaError = true;
      break;
    }
    if (![403, 404].includes(res.statusCode)) break;
  }

  if (hadQuotaError) {
    return {
      error: '⚠️ **Gemini API лимитіне жетті.**\n\nGoogle AI Studio жобасының шектеуін тексеріңіз немесе кейінірек қайталаңыз.'
    };
  }

  if (lastFailure?.statusCode === 403 || lastFailure?.statusCode === 401) {
    return { error: '⚠️ Gemini кілтіне немесе таңдалған модельге қолжетімділік жоқ. AI Studio баптауларын тексеріңіз.' };
  }
  if (lastFailure?.statusCode === 404) {
    return { error: '⚠️ Таңдалған Gemini моделі қолжетімсіз. GEMINI_MODEL баптауын тексеріңіз.' };
  }

  return { error: '⚠️ **Желілік сұраныс сәтсіз.**\n\nБайланысты тексеріп, қайта қайталаңыз.' };
}

async function callConfiguredAI(systemInstruction, userPrompt, chatHistory = [], requestOptions = {}) {
  const provider = loadAiSettings().provider || 'auto';
  if (provider === 'chatgpt') {
    try {
      return await getChatGPTClient().streamResponse({ systemInstruction, userPrompt, chatHistory });
    } catch (error) {
      return { error: error instanceof ChatGPTPlanError ? error.message : 'ChatGPT сұрауын аяқтау мүмкін болмады. Қайталап көріңіз.' };
    }
  }
  if (provider === 'gemini') return await callGeminiAPI(systemInstruction, userPrompt, chatHistory);

  const localRes = await callLocalAIServer(systemInstruction, userPrompt, chatHistory, requestOptions);
  if (localRes.success) return { text: localRes.text };
  if (provider === 'local') {
    return { error: localRes.reason === 'timeout'
      ? 'Жергілікті Ollama ұзақ жауап берді. Қысқарақ сұрақ қойып немесе Ollama күйін тексеріп көріңіз.'
      : 'Жергілікті Ollama іске қосылмаған. AI баптауларынан басқа провайдерді таңдаңыз немесе Ollama-ны іске қосыңыз.' };
  }
  // Legacy auto mode preserves the prior local-first, explicitly opted-in Gemini fallback.
  return await callGeminiAPI(systemInstruction, userPrompt, chatHistory);
}

function callLocalAIServer(systemInstruction, prompt, chatHistory = [], requestOptions = {}) {
  return new Promise((resolve) => {
    const history = Array.isArray(chatHistory) ? chatHistory.slice(-10).filter(message =>
      typeof message?.content === 'string' && ['user', 'assistant'].includes(message.role)) : [];
    const ollamaOptions = {};
    if (Number.isInteger(requestOptions.numCtx)) {
      ollamaOptions.num_ctx = Math.max(1024, Math.min(requestOptions.numCtx, 32768));
    }
    if (Number.isInteger(requestOptions.numPredict)) {
      ollamaOptions.num_predict = Math.max(64, Math.min(requestOptions.numPredict, 2048));
    }
    if (Number.isFinite(requestOptions.temperature)) {
      ollamaOptions.temperature = Math.max(0, Math.min(requestOptions.temperature, 2));
    }
    const payload = JSON.stringify({
      model: getLocalAIModelName(),
      stream: false,
      ...(Object.keys(ollamaOptions).length ? { options: ollamaOptions } : {}),
      messages: [
        { role: 'system', content: systemInstruction },
        ...history.map(message => ({ role: message.role, content: message.content.slice(0, 8000) })),
        { role: 'user', content: String(prompt).slice(0, 20000) }
      ]
    });
    const options = {
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: Number.isInteger(requestOptions.timeoutMs)
        ? Math.max(1000, Math.min(requestOptions.timeoutMs, 180000))
        : 60000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > 2_000_000) req.destroy(new Error('Response too large'));
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            if (parsed.message?.content) resolve({
              success: true,
              text: parsed.message.content,
              truncated: parsed.done_reason === 'length'
            });
            else resolve({ success: false });
          } catch { resolve({ success: false }); }
        } else resolve({ success: false, reason: 'http', statusCode: res.statusCode });
      });
    });

    req.on('error', (error) => resolve({
      success: false,
      reason: error?.code === 'ECONNREFUSED' ? 'unavailable' : 'network'
    }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, reason: 'timeout' });
    });
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
    return { text: 'Сәлеметсіз бе! Мен **Galamtor AI** көмекшісімін. Сізге қалай көмектесе аламын?\n\n- 📄 **Бетті түйіндеу** батырмасын басыңыз\n- ⬇️ **Файл сілтемелері** арқылы беттегі жүктеулерді қараңыз\n- 🌐 **Аудару** арқылы қазақшаға аударыңыз' };
  }

  // The selected provider only receives content after this user-initiated request.
  let userPrompt = String(prompt || '').slice(0, 8000);
  if (pageContext && (pageContext.title || pageContext.url)) {
    userPrompt = `Ашық бет: "${String(pageContext.title || '').slice(0, 500)}"\nURL: ${String(pageContext.url || '').slice(0, 2000)}\n\nСұрақ: ${userPrompt}`;
  }
  return await callConfiguredAI(GALAMTOR_SYSTEM_PROMPT, userPrompt, chatHistory);
});

ipcMain.handle('ai:summarize', async (event, { pageContent, pageTitle, pageUrl }) => {
  if (!validateSender(event)) return { error: 'Құқық жоқ.' };

  const systemPrompt = 'Сен веб-беттерді қысқаша түйіндейтін AI көмекшісісің. Жауапты тек қазақ тілінде жаз. Негізгі ойларды нөмірлеп жаз. Markdown қолдан.';
  const userPrompt = `Тақырыбы: ${String(pageTitle || 'Белгісіз').slice(0, 500)}\nСілтеме: ${String(pageUrl || '').slice(0, 2000)}\n\nМәтін:\n${String(pageContent || '').slice(0, 20000)}\n\nОсы мәтіннің қысқаша түйіндемесін жаз.`;
  if (!String(pageContent || '').trim()) return { error: 'Бет мәтіні алынбады. Бұл бетті түйіндеу мүмкін емес.' };
  return await callConfiguredAI(systemPrompt, userPrompt);
});

ipcMain.handle('egov:ncalayer-status', async (event) => {
  if (!validateSender(event)) return { available: false, reason: 'unreachable' };
  return await checkNcaLayer();
});

function createLegalExplanationFallback(request, reason) {
  const messages = {
    unverified: 'Жергілікті AI жауабын заң мәтінімен растай алмадым, сондықтан оның түсіндірмесін көрсетпедім.',
    truncated: 'Жергілікті AI жауабы толық келмеді, сондықтан оның түсіндірмесін көрсетпедім.',
    timeout: 'Жергілікті AI жауабы ұзаққа созылды, сондықтан тексерілмеген түсіндірмені көрсетпедім.',
    unavailable: 'Жергілікті Ollama іске қосылмаған. Заң мәтіні басқа AI қызметіне жіберілген жоқ.',
    failed: 'Жергілікті AI заң мәтінін өңдей алмады. Заң мәтіні басқа AI қызметіне жіберілген жоқ.'
  };
  const purpose = extractLegalPurposeSentence(request.sourceContent);
  let summary = '';
  if (purpose) {
    const evidence = purpose.replace(/[.!?]+$/u, '').split(/\s+/u).slice(-8).join(' ');
    summary = request.language === 'ru'
      ? `\n\nПо смыслу фрагмента закон регулирует общественные отношения, связанные с правовыми актами. Подтверждение: «${evidence}».`
      : `\n\nҮзіндідегі мағына: заң құқықтық актілерге қатысты қоғамдық қатынастарды реттейді. Дәлел: «${evidence}».`;
  } else {
    summary = '\n\nҮзіндіден заңның мақсатын анықтайтын сөйлем табылмады. Толық актіні Әділеттің ресми бетінен қараңыз.';
  }
  const excerptNote = request.wasTruncated
    ? `\n\nТек алғашқы ${request.analyzedCharacters} таңба қаралды; бұл толық құжаттың талдауы емес.`
    : '';
  return {
    text: `⚠️ ${messages[reason] || messages.failed}${summary}\n\nДереккөз: ${request.sourceUrl}${excerptNote}\nБұл заңгерлік кеңес емес; қолданыстағы редакцияны ресми беттен тексеріңіз.`
  };
}

ipcMain.handle('ai:explain-kz-law', async (event, { pageContent, pageTitle, pageUrl, language }) => {
  if (!validateSender(event)) return { error: 'Құқық жоқ.' };
  const request = createLegalExplanationPrompts({ pageContent, pageTitle, pageUrl, language });
  if (request.error === 'unsupported-source') {
    return { error: 'Бұл құрал ресми Әділет заң актілерінің бетімен жұмыс істейді.' };
  }
  if (request.error === 'insufficient-content') {
    return { error: 'Заң мәтіні беттен алынбады немесе тым қысқа. Актінің толық мәтінін ашып, қайталап көріңіз.' };
  }

  // Legal page text stays on the local Ollama service. This feature never uses Gemini fallback.
  const localRes = await callLocalAIServer(request.systemPrompt, request.userPrompt, [], {
    numCtx: 4096,
    numPredict: 768,
    temperature: 0,
    timeoutMs: 90000
  });
  if (localRes.success && localRes.truncated) {
    return createLegalExplanationFallback(request, 'truncated');
  }
  if (localRes.success) {
    if (!hasVerifiableLegalEvidence(localRes.text, request.sourceContent)) {
      return createLegalExplanationFallback(request, 'unverified');
    }
    const excerptNote = request.wasTruncated
      ? `\nЕскерту: талдау беттегі алғашқы ${request.analyzedCharacters} таңбамен шектелді; толық құжат бойынша қорытынды емес.`
      : '';
    return { text: `${localRes.text}\n\nДереккөз: ${request.sourceUrl}${excerptNote}\nЕскерту: түсіндірме тек берілген бет мәтініне сүйенеді; қолданыстағы редакцияны ресми беттен тексеріңіз.` };
  }
  return createLegalExplanationFallback(request, localRes.reason || 'failed');
});

ipcMain.handle('ai:get-page-content', async (event) => {
  if (!validateSender(event)) return '';
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return '';
  try {
    return await win.webContents.executeJavaScript(`
      (async () => {
        const activeWebview = document.querySelector('.webview-wrapper.active:not(.has-load-error) webview');
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
  if (!validateSender(event)) return { hasApiKey: false, cloudEnabled: false };
  const settings = loadAiSettings();
  return { hasApiKey: !!loadGeminiApiKey(), cloudEnabled: !!settings.cloudEnabled, provider: settings.provider || 'auto' };
});
ipcMain.handle('ai:set-cloud-enabled', (event, enabled) => {
  if (!validateSender(event) || typeof enabled !== 'boolean') return false;
  const settings = loadAiSettings();
  if (enabled && !loadGeminiApiKey()) return false;
  return writeAiSettings({ ...settings, cloudEnabled: enabled });
});

ipcMain.handle('ai:set-provider', (event, provider) => {
  if (!validateSender(event) || !['auto', 'local', 'chatgpt', 'gemini'].includes(provider)) return false;
  const settings = loadAiSettings();
  if (provider === 'gemini' && (!settings.cloudEnabled || !loadGeminiApiKey())) return false;
  if (provider === 'chatgpt') {
    try {
      const state = getChatGPTClient().getPublicState();
      const profile = state.profiles.find(item => item.active);
      if (!profile?.canUsePlan) return false;
    } catch { return false; }
  }
  return writeAiSettings({ ...settings, provider });
});

ipcMain.handle('ai:chatgpt-state', (event) => {
  if (!validateSender(event)) return { connected: false, profiles: [], error: 'Құқық жоқ.' };
  try { return getChatGPTClient().getPublicState(); }
  catch (error) {
    return { connected: false, activeProfileId: null, profiles: [], error: error instanceof ChatGPTPlanError ? error.message : 'ChatGPT күйін оқу мүмкін болмады.' };
  }
});

ipcMain.handle('ai:chatgpt-sign-in', async (event, profileId) => {
  if (!validateSender(event)) return { success: false, error: 'Құқық жоқ.' };
  try {
    const state = await getChatGPTClient().signIn(typeof profileId === 'string' ? profileId : null);
    const active = state.profiles.find(item => item.active);
    if (active?.canUsePlan) writeAiSettings({ ...loadAiSettings(), provider: 'chatgpt' });
    return { success: true, state };
  } catch (error) {
    return { success: false, error: error instanceof ChatGPTPlanError ? error.message : 'ChatGPT-ке кіру аяқталмады. Қайталап көріңіз.' };
  }
});

ipcMain.handle('ai:chatgpt-cancel-sign-in', (event) => {
  if (!validateSender(event)) return false;
  try { return getChatGPTClient().cancelSignIn(); } catch { return false; }
});

ipcMain.handle('ai:chatgpt-set-active', (event, profileId) => {
  if (!validateSender(event) || typeof profileId !== 'string') return false;
  try {
    const client = getChatGPTClient();
    if (!client.setActiveProfile(profileId)) return false;
    const active = client.getPublicState().profiles.find(item => item.active);
    if (active?.canUsePlan) writeAiSettings({ ...loadAiSettings(), provider: 'chatgpt' });
    return true;
  } catch { return false; }
});

ipcMain.handle('ai:chatgpt-disconnect', async (event, profileId) => {
  if (!validateSender(event) || typeof profileId !== 'string') return { success: false, error: 'Құқық жоқ.' };
  try {
    const result = await getChatGPTClient().disconnect(profileId);
    const active = result.state?.profiles.find(item => item.active);
    if (!active?.canUsePlan && loadAiSettings().provider === 'chatgpt') {
      writeAiSettings({ ...loadAiSettings(), provider: 'local' });
    }
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error instanceof ChatGPTPlanError ? error.message : 'ChatGPT байланысын ажырату мүмкін болмады.' };
  }
});

ipcMain.handle('ai:chatgpt-open-usage', async (event) => {
  if (!validateSender(event)) return false;
  try { return await getChatGPTClient().openUsageSettings(); } catch { return false; }
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
ipcMain.on('banking:active-url', (event, activeUrl) => {
  if (!validateSender(event)) return;
  checkBankingShield(typeof activeUrl === 'string' ? activeUrl : '');
});

// ── Qazaq AI Context Engine IPC ──
ipcMain.handle('ai:context-adapt', async (event, { content, url: pageUrl }) => {
  if (!validateSender(event)) return { error: 'Құқық жоқ.' };
  const rates = Date.now() - cachedRates.fetchedAt < 30 * 60 * 1000 ? cachedRates : await fetchLiveExchangeRates();
  const preprocessed = convertUnitsAndCurrency(content);
  const prompt = `Мына веб-бет мазмұнын қазақстандық пайдаланушы үшін талдап, жергілікті контекстке бейімде:
1. Шетелдік қызметтер мен өнімдер кездессе, Қазақстандағы баламаларын ұсын (мысалы: Amazon -> Kaspi/Flip, Uber -> InDrive, Deliveroo -> Wolt/Choco, т.б.).
2. ${rates.USD ? `Бағаларды тек осы алынған жуық бағаммен есепте: 1 USD ≈ ${rates.USD} ₸${rates.EUR ? `, 1 EUR ≈ ${rates.EUR} ₸` : ''}.` : 'Нақты бағам қолжетімсіз, теңгеге есептеме.'}
3. Құқықтық сәйкестік туралы нақты дереккөзсіз мәлімдеме жасама.
4. Қазақ тілінде нақты әрі құрылымды түрде жаз.

Бет URL: ${String(pageUrl || '').slice(0, 2000)}
Мәтін:
${(preprocessed || '').substring(0, 15000)}`;

  const localRes = await callLocalAIServer(GALAMTOR_SYSTEM_PROMPT, prompt);
  if (localRes.success) return { text: localRes.text };
  return await callGeminiAPI(GALAMTOR_SYSTEM_PROMPT, prompt);
});

// ── Start Page Custom Wallpaper / Media IPC ──
ipcMain.handle('wallpaper:pick-media', async (event) => {
  if (!validateSender(event)) return { canceled: true };
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Тұсқағазға сурет немесе MP4 видео таңдаңыз',
    buttonLabel: 'Қою',
    properties: ['openFile'],
    filters: [
      { name: 'Суреттер мен MP4 видеолар', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov'] },
      { name: 'Барлық файлдар', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const srcPath = result.filePaths[0];
  const ext = path.extname(srcPath).toLowerCase();
  const isVideo = ['.mp4', '.webm', '.mov'].includes(ext);

  const wallDir = path.join(app.getPath('userData'), 'wallpapers');
  if (!fs.existsSync(wallDir)) {
    fs.mkdirSync(wallDir, { recursive: true });
  }

  const destName = `custom_wallpaper_${Date.now()}${ext}`;
  const destPath = path.join(wallDir, destName);

  try {
    fs.copyFileSync(srcPath, destPath);
    return {
      canceled: false,
      filePath: destPath,
      fileUrl: `file://${destPath}`,
      mediaType: isVideo ? 'video' : 'image',
      originalName: path.basename(srcPath)
    };
  } catch (err) {
    console.error('Failed to copy wallpaper file:', err);
    return {
      canceled: false,
      filePath: srcPath,
      fileUrl: `file://${srcPath}`,
      mediaType: isVideo ? 'video' : 'image',
      originalName: path.basename(srcPath)
    };
  }
});

ipcMain.handle('wallpaper:clear-custom', async (event) => {
  if (!validateSender(event)) return false;
  try {
    const wallDir = path.join(app.getPath('userData'), 'wallpapers');
    if (fs.existsSync(wallDir)) {
      const files = fs.readdirSync(wallDir);
      for (const f of files) {
        fs.unlinkSync(path.join(wallDir, f));
      }
    }
    return true;
  } catch (e) {
    console.error('Error clearing custom wallpaper:', e);
    return false;
  }
});
