(function expose(root, factory) {
  const shared = typeof module === 'object' && module.exports ? require('../../browser-state.js') : root.GalamtorBrowserState;
  const api = factory(shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GalamtorWebState = api;
})(globalThis, function createWebState(shared) {
  'use strict';
  const KEY = 'galamtor_web_workspace_v1';
  const WALLPAPERS = ['alatau', 'bozzhira', 'kolsai', 'charyn', 'burabay', 'kaindy', 'akorda', 'turkestan', 'aktau', 'shymbulak'];
  const STYLES = ['bento', 'capsule', 'astral', 'neon', 'ambient'];
  const id = () => `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const homeTab = () => ({ id: id(), url: null, title: 'Жаңа қойынды' });
  const record = shared.isRecord;
  const bounded = (value, fallback, size = 100) => typeof value === 'string' && value.trim() ? value.trim().slice(0, size) : fallback;
  const choice = (value, choices, fallback) => choices.includes(value) ? value : fallback;
  const boolean = (value, fallback) => typeof value === 'boolean' ? value : fallback;
  const number = (value, fallback, max) => Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;

  function defaults() {
    const tab = homeTab();
    return {
      version: 1,
      profile: { name: 'Galamtor пайдаланушысы', createdAt: new Date().toISOString().slice(0, 10) },
      settings: { wallpaper: 'alatau', dim: 58, blur: 0, hubStyle: 'bento', showPet: true, reduceMotion: false, restoreSession: true,
        widgets: { clock: true, currency: true, prayer: true, news: true } },
      tabs: [tab], activeId: tab.id, bookmarks: [], history: [],
      vibes: [{ id: 'coding', name: 'Coding Vibe', color: '#648cff' }, { id: 'calm', name: 'Сабыр', color: '#67d8ba' }, { id: 'focus', name: 'Оқу', color: '#bb93ff' }],
      activeVibe: 'coding'
    };
  }

  function normalize(input) {
    const base = defaults(), source = record(input) ? input : {};
    const settings = record(source.settings) ? source.settings : {}, widgets = record(settings.widgets) ? settings.widgets : {};
    const tabs = [], ids = new Set();
    for (const entry of Array.isArray(source.tabs) ? source.tabs.slice(0, 50) : []) {
      if (!record(entry)) continue;
      const url = entry.url === null ? null : shared.webURL(entry.url);
      if (url !== null && !url) continue;
      let tabId = bounded(entry.id, id(), 100);
      if (ids.has(tabId)) tabId = id();
      ids.add(tabId);
      tabs.push({ id: tabId, url, title: bounded(entry.title, url ? new URL(url).hostname : 'Жаңа қойынды', 300) });
    }
    const vibes = [], vibeIds = new Set();
    for (const entry of Array.isArray(source.vibes) ? source.vibes.slice(0, 20) : []) {
      if (!record(entry) || !/^#[a-f\d]{6}$/i.test(entry.color || '')) continue;
      const vibeId = bounded(entry.id, id(), 100);
      if (vibeIds.has(vibeId)) continue;
      vibeIds.add(vibeId); vibes.push({ id: vibeId, name: bounded(entry.name, 'Вайб', 50), color: entry.color });
    }
    const safeTabs = tabs.length ? tabs : base.tabs;
    const safeVibes = vibes.length ? vibes : base.vibes;
    return {
      version: 1,
      profile: { name: bounded(source.profile?.name, base.profile.name),
        createdAt: /^\d{4}-\d{2}-\d{2}$/.test(source.profile?.createdAt || '') ? source.profile.createdAt : base.profile.createdAt },
      settings: { wallpaper: choice(settings.wallpaper, WALLPAPERS, 'alatau'), dim: number(settings.dim, 58, 85), blur: number(settings.blur, 0, 12),
        hubStyle: choice(settings.hubStyle, STYLES, 'bento'), showPet: boolean(settings.showPet, true), reduceMotion: boolean(settings.reduceMotion, false),
        restoreSession: boolean(settings.restoreSession, true), widgets: Object.fromEntries(['clock', 'currency', 'prayer', 'news'].map(key => [key, boolean(widgets[key], true)])) },
      tabs: safeTabs, activeId: safeTabs.some(tab => tab.id === source.activeId) ? source.activeId : safeTabs[0].id,
      bookmarks: shared.normalizeBookmarks(source.bookmarks), history: shared.normalizeHistory(source.history).slice(0, 500),
      vibes: safeVibes, activeVibe: safeVibes.some(vibe => vibe.id === source.activeVibe) ? source.activeVibe : safeVibes[0].id
    };
  }

  function validateImport(input) {
    return record(input) && input.version === 1 && record(input.profile) && typeof input.profile.name === 'string' &&
      record(input.settings) && Array.isArray(input.tabs) && Array.isArray(input.bookmarks) && Array.isArray(input.history) && Array.isArray(input.vibes);
  }

  function createRepository(storage) {
    let locked = false;
    return {
      load() {
        let value;
        try { value = storage.getItem(KEY); }
        catch { return { state: defaults(), error: 'unavailable' }; }
        if (!value) return { state: defaults(), error: null };
        try {
          const parsed = JSON.parse(value);
          if (!validateImport(parsed)) throw new Error('Invalid workspace');
          const state = normalize(parsed);
          if (!state.settings.restoreSession) { const tab = homeTab(); state.tabs = [tab]; state.activeId = tab.id; }
          return { state, error: null };
        } catch { locked = true; return { state: defaults(), error: 'corrupt' }; }
      },
      save(state) {
        if (locked) return { ok: false, error: 'corrupt' };
        try { storage.setItem(KEY, JSON.stringify(normalize(state))); return { ok: true }; }
        catch { return { ok: false, error: 'unavailable' }; }
      },
      replace(state) {
        // Explicit import replaces the old value in one storage write. A failed
        // write must retain the user's previous profile, including corrupt data.
        try { storage.setItem(KEY, JSON.stringify(normalize(state))); locked = false; return { ok: true }; }
        catch { return { ok: false, error: 'unavailable' }; }
      },
      reset() {
        try { storage.removeItem(KEY); locked = false; return { ok: true }; }
        catch { return { ok: false, error: 'unavailable' }; }
      }
    };
  }
  return Object.freeze({ KEY, WALLPAPERS, STYLES, id, homeTab, defaults, normalize, validateImport, createRepository });
});
