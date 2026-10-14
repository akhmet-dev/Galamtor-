// Runs the actual Electron app against disposable data and deterministic providers.
// No authenticated browser profile or paid/cloud AI is used.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = process.getBuiltinModule('fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'galamtor-global-qa-'));
const output = path.join(root, 'dist', `qa-${require('../package.json').version}`);
fs.mkdirSync(output, { recursive: true });
let application, page;
const passed = [], errors = [];
let failOnce = false;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/retry' && failOnce) { res.destroy(); return; }
  if (pathname === '/slow') { setTimeout(() => { if (!res.destroyed) res.end('<title>Slow</title>Loaded'); }, 1200); return; }
  if (pathname === '/one' || pathname === '/two' || pathname === '/retry') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<title>${pathname.slice(1)}</title><h1>${pathname.slice(1)} QA</h1><a href="/two">Next page</a><p>Find this text</p>`); return;
  }
  const file = path.join(root, 'public', pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png' }[path.extname(file)] || 'text/plain');
  res.end(fs.readFileSync(file));
});
const check = async (name, action) => { await action(); passed.push(name); console.log(`PASS ${name}`); };
async function launch() {
  const env = { ...process.env, GALAMTOR_DEV_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.GEMINI_API_KEY;
  application = await electron.launch({
    ...(process.env.GALAMTOR_QA_EXECUTABLE ? { executablePath: process.env.GALAMTOR_QA_EXECUTABLE, args: ['--galamtor-qa'] } : { args: [root] }), env
  });
  page = await application.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().includes('findInPage error')) console.log(message.text()); });
  await page.waitForFunction(() => typeof _sessionRestoreComplete !== 'undefined' && _sessionRestoreComplete);
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), profile);
  // UI tests never read the user's OS Keychain. Credential encryption and
  // plaintext-backend rejection are covered by the separate unit suite.
  await application.evaluate(({ safeStorage }) => { safeStorage.isEncryptionAvailable = () => false; });
  await application.evaluate(({ session }) => {
    globalThis.__qaRemoteMode = 'result';
    session.defaultSession.protocol.handle('https', async () => {
      if (globalThis.__qaRemoteMode === 'error') throw new Error('QA network failure');
      return new Response(`<title>Remote fixture</title><h1>${globalThis.__qaRemoteMode === 'empty' ? 'Нәтиже табылмады' : 'QA result'}</h1>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    });
  });
}
const state = () => page.evaluate(() => tabs.map(tab => ({ url: tab.url, home: tab.isHome, active: tab.id === activeTabId, private: tab.isIncognito, muted: tab.isMuted })));
const navigate = async url => {
  await page.locator('#url-input').fill(url);
  await page.locator('#url-input').press('Enter');
  await page.waitForFunction(target => { const tab = tabs.find(tab => tab.id === activeTabId); try { return tab?.url === target && !tab.isLoading && (tab.loadFailed || getActiveWebview()?.getURL() === target); } catch { return false; } }, url);
};
const menu = async action => { await page.locator('#btn-browser-menu').click(); await page.locator(`#browser-menu [data-action="${action}"]`).click(); };
const closeOverlay = () => page.evaluate(() => { gpCloseModal(); closeAiSidebarPanel(); closeCommandPalette(); });
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await launch();
    await check('home menu disabled states and new/close/reopen tabs', async () => {
      await page.locator('#btn-browser-menu').click();
      assert.equal(await page.locator('[data-action="save-page"]').isDisabled(), true);
      assert.equal(await page.locator('[data-action="reopen-tab"]').isDisabled(), true);
      await page.locator('[data-action="new-tab"]').click();
      assert.equal((await state()).length, 2);
      await page.locator('.tab.active .tab-close').click();
      await menu('reopen-tab');
      assert.equal((await state()).length, 2);
      await menu('new-incognito-tab');
      assert.equal((await state()).at(-1).private, true);
      await page.locator('.tab.active .tab-close').click();
      await page.locator('#btn-browser-menu').click();
      assert.equal(await page.locator('[data-action="reopen-tab"]').isDisabled(), true);
      await page.locator('#browser-menu [data-action="new-tab"]').press('Escape');
      await page.locator('.tab.active').click({ button: 'right' });
      await page.locator('#browser-menu [data-action="duplicate-tab"]').click();
      assert.equal((await state()).length, 3);
      await page.locator('.tab.active').click({ button: 'right' });
      await page.locator('#browser-menu [data-action="close-tab"]').click();
      while ((await state()).length > 1) await page.locator('.tab.active .tab-close').click();
      await page.locator('.tab.active .tab-close').click();
      assert.equal(await page.evaluate(() => tabs[0].isAutomaticHome), true);
      await menu('reopen-tab');
      assert.equal((await state()).length, 1);
      assert.equal(await page.evaluate(() => tabs[0].isAutomaticHome), false);
    });
    await check('real guest navigation, back, forward, reload and retry', async () => {
      await navigate(`${base}/one`);
      await navigate(`${base}/two`);
      await page.waitForFunction(() => !btnBack.disabled);
      await page.locator('#btn-back').click();
      await page.waitForFunction(() => urlInput.value.endsWith('/one'));
      await page.locator('#btn-forward').click();
      await page.waitForFunction(() => urlInput.value.endsWith('/two'));
      await page.locator('#btn-refresh').click();
      await page.waitForFunction(() => !tabs.find(tab => tab.id === activeTabId).isLoading);
      failOnce = true;
      await navigate(`${base}/retry`);
      await page.locator('.webview-wrapper.active .error-page-retry').waitFor();
      failOnce = false;
      await page.locator('.webview-wrapper.active .error-page-retry').click();
      await page.waitForFunction(() => !tabs.find(tab => tab.id === activeTabId).loadFailed);
      await page.waitForFunction(() => getActiveWebview()?.getTitle() === 'retry');
    });
    await check('load/stop control and a new navigation after stopping', async () => {
      await page.locator('#url-input').fill(`${base}/slow`);
      await page.locator('#url-input').press('Enter');
      await page.waitForFunction(() => btnRefresh.classList.contains('is-loading'));
      await page.locator('#btn-refresh').click();
      await page.waitForFunction(() => !tabs.find(tab => tab.id === activeTabId).isLoading);
      await navigate(`${base}/one`);
    });
    await check('bookmark star prevents double mutation and bar opens its target', async () => {
      await page.locator('#btn-bookmark-current').dblclick();
      await page.waitForFunction(() => currentBookmarks.some(item => item.url.includes('/one')));
      assert.equal((await page.evaluate(() => currentBookmarks.filter(item => item.url.includes('/one')))).length, 1);
      await page.locator('#btn-home').click();
      await page.locator('.bookmark-bar-item').filter({ hasText: 'one' }).click();
      await page.waitForFunction(() => urlInput.value.endsWith('/one'));
    });
    await check('bookmark search, empty state, add, validation, title/URL edit and delete', async () => {
      await menu('open-bookmarks');
      await page.locator('#gp-bookmark-search').fill('not-a-match-qa');
      assert.match(await page.locator('.bookmark-empty').textContent(), /табылмады/);
      await page.locator('#gp-new-bookmark').click();
      await page.locator('.bookmark-editor [type="submit"]').click();
      assert.match(await page.locator('#bookmark-editor-error').textContent(), /Атау/);
      await page.locator('#bookmark-title').fill('QA favorite');
      await page.locator('#bookmark-url').fill(`${base}/two`);
      await page.locator('.bookmark-editor [type="submit"]').click();
      await page.locator('.bookmark-editor-overlay').waitFor({ state: 'detached' });
      await page.locator('#gp-bookmark-search').fill('QA favorite');
      await page.locator('.gp-btn-edit-bm').click();
      await page.locator('#bookmark-title').fill('QA edited');
      await page.locator('#bookmark-url').fill(`${base}/one`);
      await page.locator('.bookmark-editor [type="submit"]').click();
      assert.match(await page.locator('#bookmark-editor-error').textContent(), /басқа бетбелгі/);
      await page.locator('#bookmark-url').fill(`${base}/two?edited=1`);
      await page.locator('.bookmark-editor [type="submit"]').click();
      await page.locator('.bookmark-editor-overlay').waitFor({ state: 'detached' });
      await page.locator('#gp-bookmark-search').fill('QA edited');
      assert.equal(await page.locator('.gp-bm-click').count(), 1);
      await page.locator('.gp-btn-delete-bm').click();
      await page.waitForFunction(() => !currentBookmarks.some(item => item.title === 'QA edited'));
      await closeOverlay();
      await page.locator('.bookmark-bar-item').filter({ hasText: 'one' }).click({ button: 'right' });
      assert.equal(await page.locator('#bookmark-title').inputValue(), 'one');
      await page.locator('#bookmark-editor-cancel').click();
    });
    await check('failed bookmark disk write retains data and presents error with retry', async () => {
      await application.evaluate(() => {
        const fs = process.getBuiltinModule('fs');
        globalThis.__qaRename = fs.renameSync;
        fs.renameSync = (from, to) => { if (String(to).endsWith('bookmarks.json')) throw new Error('QA simulated disk error'); return globalThis.__qaRename(from, to); };
      });
      const before = await page.evaluate(() => window.galamtorAPI.getBookmarks());
      await page.locator('#btn-bookmark-current').click();
      await page.waitForFunction(() => [...document.querySelectorAll('.toast-notification')].some(item => item.textContent.includes('сақталмады')));
      assert.deepEqual(await page.evaluate(() => window.galamtorAPI.getBookmarks()), before);
      await application.evaluate(() => { process.getBuiltinModule('fs').renameSync = globalThis.__qaRename; });
      await page.locator('#btn-bookmark-current').click();
      await page.waitForFunction(() => !currentBookmarks.some(item => item.url.includes('/one')));
    });
    await check('menu history/downloads/settings/palette/customizer/AI all dispatch', async () => {
      for (const [action, panel] of [['open-history','history'],['open-downloads','downloads'],['open-settings','profile']]) {
        await menu(action);
        assert.equal(await page.locator(`#gp-panel-${panel}`).evaluate(el => el.classList.contains('active')), true);
        await closeOverlay();
      }
      await menu('command-palette');
      await page.locator('#cp-input').fill('one');
      await page.locator('.cp-item').first().waitFor();
      await page.locator('#cp-input').press('Enter');
      await closeOverlay();
      await menu('toggle-ai');
      assert.equal(await page.locator('#ai-sidebar-panel').getAttribute('aria-hidden'), 'false');
      await page.locator('#ai-panel-settings').click({ noWaitAfter: true });
      await page.locator('#ai-settings-modal.active').waitFor();
      await page.locator('#ai-settings-cancel').click();
      await page.locator('#ai-panel-close').click();
      assert.equal(await page.locator('#ai-sidebar-panel').getAttribute('aria-hidden'), 'true');
      await menu('customize-startpage');
      await page.locator('#customizer-drawer.active').waitFor();
      await page.locator('#btn-close-customizer').click();
    });
    await check('all top favorites/sidebar links, shield, prayer and native menu dispatch', async () => {
      await page.locator('#btn-home').click();
      for (let index = 0; index < await page.locator('.bookmark-bar-item').count(); index++) {
        const url = await page.locator('.bookmark-bar-item').nth(index).getAttribute('data-url');
        await page.locator('.bookmark-bar-item').nth(index).click();
        await page.waitForFunction(target => tabs.find(tab => tab.id === activeTabId).url === new URL(target).href, url);
        await page.locator('#btn-home').click();
      }
      const links = await page.locator('#dock-icons .dock-btn[data-url]').count();
      for (let index = 0; index < links; index++) {
        const url = await page.locator('#dock-icons .dock-btn[data-url]').nth(index).getAttribute('data-url');
        await page.locator('#dock-icons .dock-btn[data-url]').nth(index).click();
        await page.waitForFunction(target => tabs.find(tab => tab.id === activeTabId).url === new URL(target).href, url);
        await page.locator('#btn-home').click();
      }
      const oldShield = await page.evaluate(() => window.galamtorAPI.getAdBlockStats());
      await page.locator('#btn-adblock').click();
      const newShield = await page.evaluate(() => window.galamtorAPI.getAdBlockStats());
      assert.notEqual(newShield.enabled, oldShield.enabled);
      await page.locator('#btn-adblock').click();
      await page.locator('#cs-prayer a').click();
      await page.waitForFunction(() => tabs.some(tab => tab.url?.includes('muftyat.kz')));
      await page.locator('#btn-home').click();
      const count = (await state()).length;
      await application.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []).find(item => item.accelerator === 'CmdOrCtrl+T').click());
      await page.waitForFunction(count => tabs.length === count + 1, count);
      await application.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []).find(item => item.accelerator === 'CmdOrCtrl+W').click());
      await page.waitForFunction(count => tabs.length === count, count);
      await application.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []).find(item => item.accelerator === 'Shift+CmdOrCtrl+T').click());
      await page.waitForFunction(count => tabs.length === count + 1, count);
      await application.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []).find(item => item.accelerator === 'CmdOrCtrl+K').click());
      await page.locator('.command-palette-overlay.active').waitFor();
      await page.locator('#cp-input').press('Escape');
    });
    await check('page find, save and print dispatch target the active guest', async () => {
      await navigate(`${base}/one`);
      await menu('find-in-page');
      await page.locator('#find-input').fill('QA');
      await page.waitForFunction(() => document.getElementById('find-count').textContent.includes('1'));
      await page.locator('#find-next').click();
      await page.locator('#find-prev').click();
      await page.locator('#find-input').fill('missing QA phrase');
      await page.waitForFunction(() => document.getElementById('find-count').textContent === '0/0');
      await page.locator('#find-close').click();
      const savePath = path.join(profile, 'qa-saved.html');
      await application.evaluate(({ dialog }, filePath) => {
        globalThis.__qaSaveDialog = dialog.showSaveDialog;
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, savePath);
      await menu('save-page');
      await page.waitForFunction(() => [...document.querySelectorAll('.toast-notification')].some(item => item.textContent.includes('файлдары сақталды')));
      assert.ok(fs.existsSync(savePath));
      await application.evaluate(({ dialog }) => { dialog.showSaveDialog = globalThis.__qaSaveDialog; });
      await page.evaluate(() => { const guest = getActiveWebview(); guest.print = () => { window.__qaPrintRequested = true; }; });
      await menu('print');
      assert.equal(await page.evaluate(() => window.__qaPrintRequested), true);
    });
    await check('widgets, preset wallpapers, layout modes and all source controls', async () => {
      await page.locator('#btn-home').click();
      await page.locator('#btn-open-customizer').click();
      await page.locator('[data-tab="widgets"]').click();
      for (const key of ['clock','currency','prayer','news']) {
        await page.locator(`#toggle-widget-${key}`).uncheck();
        assert.equal(await page.evaluate(key => localStorage.getItem(`galamtor_widget_${key}`), key), 'false');
        await page.locator(`#toggle-widget-${key}`).check();
      }
      await page.locator('[data-start-mode="focus"]').click();
      await page.locator('[data-start-mode="daily"]').click();
      await page.locator('[data-start-mode="full"]').click();
      await page.locator('#toggle-widget-prayer').uncheck();
      await page.locator('#hub-style-select').selectOption('capsule');
      await page.locator('[data-tab="wallpapers"]').click();
      await page.locator('.preset-card[data-preset="kolsai"]').click();
      await page.locator('#btn-close-customizer').click();
      const first = await page.locator('#safari-news-title-0').textContent();
      await page.locator('#btn-refresh-news').click();
      assert.notEqual(await page.locator('#safari-news-title-0').textContent(), first);
      await page.locator('#safari-news-card-0').click();
      assert.match((await state()).find(item => item.active).url, /^https:/);
      await page.locator('#btn-home').click();
    });
    await check('currency loading, empty response, cached error and keyboard retry', async () => {
      await application.evaluate(({ ipcMain }) => {
        globalThis.__qaRatesHandler = ipcMain._invokeHandlers.get('rates:get');
        globalThis.__qaRatesMode = 'empty';
        ipcMain.removeHandler('rates:get');
        ipcMain.handle('rates:get', async () => {
          await new Promise(resolve => setTimeout(resolve, 150));
          if (globalThis.__qaRatesMode === 'empty') return { USD:null, EUR:null, RUB:null, updatedAt:0 };
          return { USD:500, EUR:550, RUB:5, updatedAt:Date.now(), refreshFailed:globalThis.__qaRatesMode === 'error' };
        });
      });
      await page.locator('#cs-currency').click();
      await page.waitForFunction(() => document.getElementById('cs-currency').getAttribute('aria-busy') === 'true');
      await page.waitForFunction(() => document.getElementById('rate-usd').textContent === '—');
      await application.evaluate(() => { globalThis.__qaRatesMode = 'error'; });
      await page.locator('#cs-currency').focus();
      await page.locator('#cs-currency').press('Enter');
      await page.waitForFunction(() => document.getElementById('currency-source').textContent.includes('сәтсіз'));
      await application.evaluate(() => { globalThis.__qaRatesMode = 'success'; });
      await page.locator('#cs-currency').press('Space');
      await page.waitForFunction(() => document.getElementById('cs-currency').getAttribute('aria-busy') === 'false' && !document.getElementById('currency-source').textContent.includes('сәтсіз'));
      await application.evaluate(({ ipcMain }) => { ipcMain.removeHandler('rates:get'); ipcMain.handle('rates:get', globalThis.__qaRatesHandler); });
    });
    await check('Lens handoff, invalid/empty URL, provider no-results, failure and retry', async () => {
      await page.evaluate(() => { openLensWithUrl(''); openLensWithUrl('http://127.0.0.1/private.png'); });
      assert.equal((await state()).find(item => item.active).home, true);
      await page.locator('#btn-lens').click();
      await page.waitForFunction(() => getActiveWebview()?.getTitle() === 'Remote fixture');
      assert.match((await state()).find(item => item.active).url, /google\.com/);
      await application.evaluate(() => { globalThis.__qaRemoteMode = 'empty'; });
      await page.evaluate(() => openLensWithUrl('https://example.com/image.png'));
      await page.waitForFunction(() => getActiveWebview()?.getURL().startsWith('https://lens.google.com/'));
      assert.match(await page.evaluate(() => getActiveWebview().executeJavaScript('document.body.innerText')), /Нәтиже табылмады/);
      await application.evaluate(() => { globalThis.__qaRemoteMode = 'error'; });
      await page.locator('#btn-refresh').click();
      await page.locator('.webview-wrapper.active .error-page-retry').waitFor();
      await application.evaluate(() => { globalThis.__qaRemoteMode = 'result'; });
      await page.locator('.webview-wrapper.active .error-page-retry').click();
      await page.waitForFunction(() => !tabs.find(tab => tab.id === activeTabId).loadFailed && getActiveWebview()?.getTitle() === 'Remote fixture');
      await page.locator('#btn-home').click();
    });
    await check('Google chooser launches once, cancels and can be manually retried', async () => {
      await application.evaluate(({ shell }) => {
        globalThis.__qaExternal = shell.openExternal;
        globalThis.__qaChooserCount = 0;
        shell.openExternal = async () => { globalThis.__qaChooserCount++; };
      });
      await menu('open-settings');
      await page.locator('#gp-sync-auth-btn').click();
      await page.locator('#gp-sync-cancel-btn').waitFor();
      await page.evaluate(() => { window.galamtorAPI.startGoogleLogin(); window.galamtorAPI.startGoogleLogin(); });
      await page.waitForFunction(() => _gp.syncState === 'connecting');
      assert.equal(await application.evaluate(() => globalThis.__qaChooserCount), 1);
      await page.locator('#gp-sync-cancel-btn').click();
      await page.locator('#gp-sync-auth-btn').click();
      await page.locator('#gp-sync-cancel-btn').waitFor();
      assert.equal(await application.evaluate(() => globalThis.__qaChooserCount), 2);
      await page.locator('#gp-sync-cancel-btn').click();
      await application.evaluate(({ shell }) => { shell.openExternal = globalThis.__qaExternal; });
      await closeOverlay();
    });
    await check('companion choices/name/color/accessory/temperament/demo/random/reset and motion', async () => {
      await page.locator('#galamtor-pet-customize').click();
      for (const id of ['samal','tumar','qyran','aiyaru','alpamys']) await page.locator(`[data-pet-id="${id}"]`).click();
      await page.locator('#galamtor-pet-name').fill('');
      assert.equal(await page.locator('#galamtor-pet-name').inputValue(), '');
      await page.locator('#galamtor-pet-name').fill('QA companion');
      await page.locator('[data-pet-color="mint"]').click();
      await page.locator('#galamtor-pet-accessory').selectOption('spark');
      await page.locator('#galamtor-pet-temperament').selectOption('calm');
      await page.locator('#galamtor-pet-demo').click();
      for (const activity of ['thinking','speaking','idle']) {
        await page.evaluate(activity => window.GalamtorPetController.setActivity(activity), activity);
        assert.equal(await page.locator('#galamtor-pet-live-art').getAttribute('data-activity'), activity);
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const animations = await page.locator('#galamtor-pet-preview-art .pet-body').evaluate(el => getComputedStyle(el).animationName);
      assert.equal(animations, 'none');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.locator('#galamtor-pet-randomize').click();
      await page.locator('#galamtor-pet-reset').click();
      await page.locator('[data-pet-id="aiyaru"]').click();
      await page.locator('#galamtor-pet-name').fill('QA companion');
      await page.locator('[data-pet-color="mint"]').click();
      await page.locator('#galamtor-pet-accessory').selectOption('spark');
      await page.locator('#galamtor-pet-temperament').selectOption('calm');
      await page.locator('#galamtor-pet-close').click();
    });
    await check('new tabs, muted state and private exclusion survive full application reopen', async () => {
      await menu('new-tab'); await navigate(`${base}/one`);
      await page.locator('.tab.active').click({ button: 'right' });
      await page.locator('#browser-menu [data-action="mute-tab"]').click();
      await menu('new-incognito-tab'); await navigate(`${base}/two?private=1`);
      await menu('new-tab');
      await page.waitForFunction(() => !document.getElementById('welcome-screen').classList.contains('hidden-view'));
      const before = (await state()).filter(item => !item.private);
      const companion = await page.evaluate(() => JSON.parse(localStorage.getItem('galamtor_pet_profile_v1')));
      await page.evaluate(() => { localStorage.setItem('gp_sync_state', 'connecting'); });
      await application.close(); await launch();
      assert.deepEqual(await state(), before);
      assert.ok((await state()).some(item => item.muted));
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('galamtor_pet_profile_v1'))), companion);
      assert.equal(await page.evaluate(() => localStorage.getItem('galamtor_widget_prayer')), 'false');
      assert.equal(await page.locator('#cs-prayer').isVisible(), false);
      assert.equal(await page.evaluate(() => localStorage.getItem('galamtor_wallpaper_preset')), 'kolsai');
      await menu('open-settings');
      await page.locator('#gp-sync-auth-btn').waitFor();
      assert.equal(await page.locator('#gp-sync-auth-btn').isEnabled(), true);
      await closeOverlay();
    });
    await check('manual preview update checker supports no-update and retry after network error', async () => {
      await application.evaluate(() => {
        globalThis.__qaFetch = globalThis.fetch;
        globalThis.fetch = async () => { throw new Error('QA offline'); };
      });
      await menu('check-update');
      await page.waitForFunction(() => [...document.querySelectorAll('.toast-notification')].some(item => item.textContent.includes('сәтсіз')));
      await application.evaluate(({ app }) => {
        const version = app.getVersion();
        globalThis.fetch = async () => ({ ok: true, json: async () => ({ tag_name: `v${version}`, html_url: `https://github.com/akhmet-dev/Galamtor-/releases/tag/v${version}`, assets: [] }) });
      });
      await menu('check-update');
      await page.waitForFunction(() => [...document.querySelectorAll('.toast-notification')].some(item => item.textContent.includes('табылған жоқ')));
      await application.evaluate(({ dialog, shell }) => {
        globalThis.__qaUpdateDialog = dialog.showMessageBox;
        globalThis.__qaUpdateExternal = shell.openExternal;
        globalThis.fetch = async () => ({ ok: true, json: async () => ({ tag_name: 'v99.0.0', html_url: 'https://github.com/akhmet-dev/Galamtor-/releases/tag/v99.0.0', assets: [] }) });
        dialog.showMessageBox = async () => ({ response: 0 });
        shell.openExternal = async target => { globalThis.__qaUpdateOpened = target; };
      });
      await page.evaluate(() => window.checkBrowserUpdate());
      assert.equal(await application.evaluate(() => globalThis.__qaUpdateOpened), 'https://github.com/akhmet-dev/Galamtor-/releases/tag/v99.0.0');
      await application.evaluate(({ dialog, shell }) => {
        globalThis.fetch = globalThis.__qaFetch;
        dialog.showMessageBox = globalThis.__qaUpdateDialog;
        shell.openExternal = globalThis.__qaUpdateExternal;
      });
    });
    await check('responsive desktop home, menus, bookmarks and companion studio screenshots', async () => {
      for (const [width,height] of [[1360,900],[1024,768],[800,600]]) {
        await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width,height]);
        await page.screenshot({ path: path.join(output, `home-${width}.png`) });
        await page.locator('#galamtor-pet-customize').click();
        const bounds = await page.locator('#galamtor-pet-studio').boundingBox();
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1);
        await page.locator('#galamtor-pet-studio').evaluate(el => { el.scrollTop = 0; });
        await page.screenshot({ path: path.join(output, `companion-${width}.png`) });
        await page.locator('#galamtor-pet-close').click();
        await menu('open-bookmarks');
        await page.waitForFunction(() => { const panel = document.querySelector('.gp-modal'); return panel && getComputedStyle(panel).opacity === '1'; });
        await page.screenshot({ path: path.join(output, `bookmarks-${width}.png`) });
        await closeOverlay();
      }
    });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'runtime-results.json'), JSON.stringify({ passed, rendererErrors: errors, profile: 'isolated temporary profile', packaged: !!process.env.GALAMTOR_QA_EXECUTABLE, architecture: await application.evaluate(() => process.arch) }, null, 2));
    console.log(`Completed ${passed.length} runtime checks; no renderer exceptions.`);
  } catch (error) {
    fs.writeFileSync(path.join(output, 'runtime-failure.txt'), error.stack);
    if (page && !page.isClosed()) console.log(await page.evaluate(() => ({ findResult: window.__qaFindResult, guest: getActiveWebview()?.getURL(), flags: tabs.find(tab => tab.id === activeTabId) }))); 
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (application) await application.close().catch(() => {});
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
