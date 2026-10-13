(function exposeBrowserState(root, factory) {
  const state = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = state;
  if (root) root.GalamtorBrowserState = state;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBrowserState() {
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = (value, fallback = '', limit = 300) => typeof value === 'string' ? value.slice(0, limit) : fallback;
  const timestamp = value => Number.isFinite(value) && value > 0 ? value : Date.now();

  function webURL(value) {
    if (typeof value !== 'string' || value.length > 8192) return '';
    try {
      const parsed = new URL(value);
      if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return '';
      return parsed.href;
    } catch { return ''; }
  }

  function normalizeSessionTabs(value) {
    if (!Array.isArray(value)) return [];
    let hasActive = false;
    return value.flatMap(entry => {
      if (!isRecord(entry) || entry.isIncognito) return [];
      const isHome = entry.isHome === true;
      const url = isHome ? null : webURL(entry.url);
      if (!isHome && !url) return [];
      const isActive = !hasActive && entry.isActive === true;
      if (isActive) hasActive = true;
      return [{ url, isHome, title: text(entry.title, isHome ? 'Жаңа қойынды' : url), isActive, isMuted: entry.isMuted === true }];
    }).slice(0, 200);
  }

  function normalizeHistory(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap(entry => {
      if (!isRecord(entry)) return [];
      const url = webURL(entry.url);
      return url ? [{ url, title: text(entry.title, url), timestamp: timestamp(entry.timestamp) }] : [];
    }).slice(0, 10000);
  }

  function normalizeBookmarks(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.flatMap(entry => {
      if (!isRecord(entry)) return [];
      const url = webURL(entry.url);
      if (!url || seen.has(url)) return [];
      seen.add(url);
      return [{ id: text(entry.id, url), url, title: text(entry.title, url), favicon: webURL(entry.favicon), createdAt: timestamp(entry.createdAt) }];
    }).slice(0, 2000);
  }

  // All mutations share URL canonicalization and preserve record identity.
  // A collision during editing must not silently overwrite another favorite.
  function changeBookmark(value, input, id = null) {
    const bookmarks = normalizeBookmarks(value);
    const url = webURL(input?.url);
    const title = typeof input?.title === 'string' ? input.title.trim().slice(0, 300) : '';
    if (!url || !title) return { ok: false, error: 'invalid' };
    const index = id === null ? bookmarks.findIndex(item => item.url === url) : bookmarks.findIndex(item => item.id === id);
    if (id !== null && index < 0) return { ok: false, error: 'missing' };
    if (id !== null && bookmarks.some((item, i) => i !== index && item.url === url)) return { ok: false, error: 'duplicate' };
    if (index >= 0) {
      const previous = bookmarks[index];
      bookmarks[index] = { ...previous, url, title, favicon: previous.url === url ? previous.favicon : '' };
    } else {
      bookmarks.unshift({ id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`, url, title,
        favicon: webURL(input.favicon), createdAt: Date.now() });
    }
    return { ok: true, bookmarks: bookmarks.slice(0, 2000) };
  }

  function normalizeDownloads(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(entry => isRecord(entry) && !entry.isIncognito && typeof entry.filename === 'string' && typeof entry.savePath === 'string')
      .slice(0, 2000).map(entry => ({
        id: text(entry.id), filename: text(entry.filename, '', 1000), savePath: text(entry.savePath, '', 8192),
        totalBytes: Number.isFinite(entry.totalBytes) && entry.totalBytes >= 0 ? entry.totalBytes : 0,
        state: ['completed', 'cancelled', 'interrupted'].includes(entry.state) ? entry.state : 'interrupted',
        completedAt: timestamp(entry.completedAt)
      }));
  }

  function validateProfileImport(value) {
    if (!isRecord(value) || !['profile', 'vibes', 'lock', 'activeVibe'].some(key => key in value)) return false;
    if ('profile' in value && (!isRecord(value.profile) || typeof value.profile.name !== 'string' || value.profile.name.length > 100 ||
        (value.profile.createdAt !== undefined && !Number.isFinite(value.profile.createdAt)))) return false;
    if ('activeVibe' in value && (typeof value.activeVibe !== 'string' || value.activeVibe.length > 100)) return false;
    if ('lock' in value) {
      const lock = value.lock;
      if (!isRecord(lock) || typeof lock.enabled !== 'boolean' || typeof lock.pinHash !== 'string' ||
          (lock.pinHash !== '' && !/^[a-f0-9]{64}$/i.test(lock.pinHash)) || !Array.isArray(lock.hiddenUrls) ||
          lock.hiddenUrls.length > 200 || !lock.hiddenUrls.every(webURL)) return false;
    }
    if ('vibes' in value) {
      if (!Array.isArray(value.vibes) || value.vibes.length > 100) return false;
      if (!value.vibes.every(vibe => isRecord(vibe) && typeof vibe.id === 'string' && vibe.id.length <= 100 &&
          typeof vibe.name === 'string' && vibe.name.length <= 100 && typeof vibe.emoji === 'string' && vibe.emoji.length <= 20 &&
          /^#[a-f0-9]{6}$/i.test(vibe.accentColor) && Array.isArray(vibe.pinnedSites) && vibe.pinnedSites.length <= 100 &&
          vibe.pinnedSites.every(site => isRecord(site) && webURL(site.url) && typeof site.title === 'string') &&
          Array.isArray(vibe.tabGroup) && vibe.tabGroup.length <= 100 && vibe.tabGroup.every(webURL))) return false;
    }
    return true;
  }

  return { isRecord, webURL, normalizeSessionTabs, normalizeHistory, normalizeBookmarks, changeBookmark, normalizeDownloads, validateProfileImport };
});
