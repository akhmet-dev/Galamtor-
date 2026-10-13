const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('galamtorAPI', {
  // Auth Loopback Server
  startGoogleLogin: () => ipcRenderer.send('start-google-login'),
  stopAuthServer: () => ipcRenderer.send('stop-auth-server'),
  onFirebaseAuthToken: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('firebase-auth-token', listener);
    return () => ipcRenderer.removeListener('firebase-auth-token', listener);
  },
  onAuthServerError: (callback) => {
    const listener = (_event, code) => callback(code);
    ipcRenderer.on('auth-server-error', listener);
    return () => ipcRenderer.removeListener('auth-server-error', listener);
  },
  setLanguage: (lang) => ipcRenderer.send('language:set', lang),

  // History API
  addHistory: (entry) => ipcRenderer.invoke('history:add', entry),
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),

  // Downloads API
  getDownloads: () => ipcRenderer.invoke('downloads:get'),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  onDownloadProgress: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('download-progress', listener);
    return () => ipcRenderer.removeListener('download-progress', listener);
  },
  onDownloadDone: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('download-done', listener);
    return () => ipcRenderer.removeListener('download-done', listener);
  },

  // Secure OS Shell actions
  openPath: (filePath) => ipcRenderer.invoke('shell:open-path', filePath),

  // AdBlocker & Privacy Shield API
  toggleAdBlock: () => ipcRenderer.invoke('adblock:toggle'),
  getAdBlockStats: () => ipcRenderer.invoke('adblock:get-stats'),
  onAdBlockedCount: (callback) => {
    const listener = (event, count) => callback(count);
    ipcRenderer.on('ad-blocked-count', listener);
    return () => ipcRenderer.removeListener('ad-blocked-count', listener);
  },

  // Session Auto-Restore API
  saveSession: (sessionTabs) => ipcRenderer.invoke('session:save', sessionTabs),
  loadSession: () => ipcRenderer.invoke('session:load'),

  // User-initiated download API
  downloadURL: (url) => ipcRenderer.invoke('download:trigger', url),
  savePage: (contentsId) => ipcRenderer.invoke('page:save', contentsId),

  // ── Galamtor AI Assistant API (Gemini) ──
  aiChat: (prompt, pageContext, chatHistory) => ipcRenderer.invoke('ai:chat', { prompt, pageContext, chatHistory }),
  aiSummarize: (pageContent, pageTitle, pageUrl) => ipcRenderer.invoke('ai:summarize', { pageContent, pageTitle, pageUrl }),
  aiExplainKzLaw: (pageContent, pageTitle, pageUrl, language) => ipcRenderer.invoke('ai:explain-kz-law', { pageContent, pageTitle, pageUrl, language }),
  checkNcaLayerStatus: () => ipcRenderer.invoke('egov:ncalayer-status'),
  aiSetApiKey: (apiKey) => ipcRenderer.invoke('ai:set-api-key', apiKey),
  aiGetApiKey: () => ipcRenderer.invoke('ai:get-api-key'),
  aiSetCloudEnabled: (enabled) => ipcRenderer.invoke('ai:set-cloud-enabled', enabled),
  aiSetProvider: (provider) => ipcRenderer.invoke('ai:set-provider', provider),
  aiGetChatGPTState: () => ipcRenderer.invoke('ai:chatgpt-state'),
  aiChatGPTSignIn: (profileId) => ipcRenderer.invoke('ai:chatgpt-sign-in', profileId),
  aiChatGPTCancelSignIn: () => ipcRenderer.invoke('ai:chatgpt-cancel-sign-in'),
  aiChatGPTSetActive: (profileId) => ipcRenderer.invoke('ai:chatgpt-set-active', profileId),
  aiChatGPTDisconnect: (profileId) => ipcRenderer.invoke('ai:chatgpt-disconnect', profileId),
  aiChatGPTOpenUsage: () => ipcRenderer.invoke('ai:chatgpt-open-usage'),
  aiGetLocalStatus: () => ipcRenderer.invoke('ai:ollama-status'),
  aiPullLocalModel: () => ipcRenderer.invoke('ai:ollama-pull'),
  aiCancelLocalModelPull: () => ipcRenderer.invoke('ai:ollama-pull-cancel'),
  aiOpenOllamaDownload: () => ipcRenderer.invoke('ai:open-ollama-download'),
  onAiModelPullProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('ai:ollama-pull-progress', listener);
    return () => ipcRenderer.removeListener('ai:ollama-pull-progress', listener);
  },

  // ── Touch ID / Biometrics API (macOS) ──
  touchIdCanPrompt: () => ipcRenderer.invoke('touchid:can-prompt'),
  touchIdPrompt: (reason) => ipcRenderer.invoke('touchid:prompt', reason),

  // IPC event bridge: open image in new tab (security fix — replaces executeJavaScript)
  onOpenImageInNewTab: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('open-image-in-new-tab', listener);
    return () => ipcRenderer.removeListener('open-image-in-new-tab', listener);
  },
  onPopupTab: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('open-popup-tab', listener);
    return () => ipcRenderer.removeListener('open-popup-tab', listener);
  },

  // Auto-Update API
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  getBrowserInfo: () => ipcRenderer.invoke('browser:info'),
  onUpdateNotAvailable: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('update-not-available', listener);
    return () => ipcRenderer.removeListener('update-not-available', listener);
  },
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateAvailable: (callback) => {
    const listener = (event, info) => callback(info);
    ipcRenderer.on('update-available', listener);
    return () => ipcRenderer.removeListener('update-available', listener);
  },
  onUpdateDownloaded: (callback) => {
    const listener = (event, info) => callback(info);
    ipcRenderer.on('update-downloaded', listener);
    return () => ipcRenderer.removeListener('update-downloaded', listener);
  },
  onUpdateProgress: (callback) => {
    const listener = (event, progress) => callback(progress);
    ipcRenderer.on('update-progress', listener);
    return () => ipcRenderer.removeListener('update-progress', listener);
  },
  onUpdateError: (callback) => {
    const listener = (event, err) => callback(err);
    ipcRenderer.on('update-error', listener);
    return () => ipcRenderer.removeListener('update-error', listener);
  },

  // ── Ұлттық Кибер-Қалқан & Banking Shield APIs ──
  qalqanCheckUrl: (url) => ipcRenderer.invoke('qalqan:check-url', url),
  onQalqanBlocked: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('qalqan-blocked', listener);
    return () => ipcRenderer.removeListener('qalqan-blocked', listener);
  },
  getBankingShieldStatus: () => ipcRenderer.invoke('banking:get-status'),
  setActiveBankingUrl: (activeUrl) => ipcRenderer.send('banking:active-url', activeUrl),
  onBankingShieldStatus: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('banking-shield-status', listener);
    return () => ipcRenderer.removeListener('banking-shield-status', listener);
  },

  // ── Qazaq AI Context Engine API ──
  aiContextAdapt: (content, url) => ipcRenderer.invoke('ai:context-adapt', { content, url }),

  // ── Bookmarks API ──
  getBookmarks: () => ipcRenderer.invoke('bookmarks:get'),
  addBookmark: (bookmark) => ipcRenderer.invoke('bookmarks:add', bookmark),
  removeBookmark: (idOrUrl) => ipcRenderer.invoke('bookmarks:remove', idOrUrl),
  isBookmarked: (url) => ipcRenderer.invoke('bookmarks:check', url),

  // ── Currency Rates API ──
  getExchangeRates: () => ipcRenderer.invoke('rates:get'),

  // ── Native Application Menu Action Bridge ──
  onMenuAction: (callback) => {
    const listener = (event, action, data) => callback(action, data);
    ipcRenderer.on('menu-action', listener);
    return () => ipcRenderer.removeListener('menu-action', listener);
  },

  // ── Start Page Custom Wallpaper API ──
  pickCustomWallpaper: () => ipcRenderer.invoke('wallpaper:pick-media'),
  clearCustomWallpaper: () => ipcRenderer.invoke('wallpaper:clear-custom')
});
