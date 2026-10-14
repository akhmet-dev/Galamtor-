// Real main-process IPC and HTTP callbacks, always against disposable data.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'galamtor-backend-qa-'));
const output = path.join(root, 'dist', `qa-${require('../package.json').version}`);
fs.mkdirSync(output, { recursive: true });
const passed = [], errors = [];
let app, page;
const check = async (name, run) => { await run(); passed.push(name); console.log(`PASS ${name}`); };
async function start() {
  await page.locator('#gp-sync-auth-btn').click();
  await page.locator('#gp-sync-cancel-btn').waitFor();
  const target = await app.evaluate(() => globalThis.__qaLoginURL);
  return new URL(target).searchParams.get('state');
}
async function post(state, extra = { googleIdToken: 'qa-fake-token' }, origin = 'https://galamtor.web.app') {
  return fetch('http://127.0.0.1:4242/callback', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ state, ...extra }), signal: AbortSignal.timeout(6000) });
}
async function fault(file) {
  await app.evaluate((_, file) => {
    const fs = process.getBuiltinModule('fs');
    globalThis.__qaRename = fs.renameSync;
    fs.renameSync = function (source, target) {
      if (String(target).endsWith('/' + file)) throw Object.assign(new Error('QA disk write failure'), { code: 'EACCES' });
      return globalThis.__qaRename.apply(this, arguments);
    };
  }, file);
}
async function recover() { await app.evaluate(() => { process.getBuiltinModule('fs').renameSync = globalThis.__qaRename; }); }
(async () => {
  const env = { ...process.env, GALAMTOR_DEV_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.GEMINI_API_KEY;
  try {
    app = await electron.launch({ ...(process.env.GALAMTOR_QA_EXECUTABLE ? { executablePath: process.env.GALAMTOR_QA_EXECUTABLE, args: ['--galamtor-qa'] } : { args: [root] }), env });
    page = await app.firstWindow(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof _sessionRestoreComplete !== 'undefined' && _sessionRestoreComplete && _gp.authSession);
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
    await app.evaluate(({ shell, safeStorage }) => {
      safeStorage.isEncryptionAvailable = () => false;
      globalThis.__qaExternal = shell.openExternal;
      shell.openExternal = async target => { globalThis.__qaLoginURL = target; };
    });
    await page.evaluate(() => {
      window.__qaOriginalSignIn = auth.signInWithCredential;
      window.__qaOriginalSignOut = auth.signOut;
      window.__qaOriginalUpdate = auth.updateCurrentUser;
      window.__qaUserDescriptor = Object.getOwnPropertyDescriptor(auth, 'currentUser');
      window.__qaCollection = db.collection;
      window.__qaUser = null;
      Object.defineProperty(auth, 'currentUser', { configurable: true, get: () => window.__qaUser });
      auth.signOut = async () => { window.__qaUser = null; };
      auth.updateCurrentUser = async user => { window.__qaUser = user; };
      auth.signInWithCredential = async () => {
        if (window.__qaCredentialMode === 'reject') throw Object.assign(new Error('QA rejected'), { code: 'auth/invalid-credential' });
        if (window.__qaCredentialMode === 'pending') await new Promise(resolve => { window.__qaReleaseCredential = resolve; });
        window.__qaUser = { uid: 'qa-synthetic-user', photoURL: null, metadata: {}, email: '' };
        return { user: window.__qaUser };
      };
      db.collection = () => ({ doc: () => ({ collection: () => ({ doc: () => ({ set: async () => {
        window.__qaCloudWrites = (window.__qaCloudWrites || 0) + 1;
        if (window.__qaCloudMode === 'offline') await new Promise(() => {});
      } }) }) }) });
    });
    await page.locator('#btn-workspace').click(); await page.locator('#gp-sync-auth-btn').waitFor();
    await check('real loopback rejects foreign origin, wrong state and empty credential', async () => {
      const state = await start();
      assert.equal((await post(state, undefined, 'https://evil.example')).status, 403);
      assert.equal((await post('b'.repeat(64))).status, 403);
      assert.equal((await post(state, {})).status, 422);
      assert.equal(await page.evaluate(() => _gp.syncState), 'connecting');
      await page.locator('#gp-sync-cancel-btn').click();
    });
    await check('desktop Firebase rejection reaches the web callback and remains retryable', async () => {
      await page.evaluate(() => window.__qaCredentialMode = 'reject');
      const response = await post(await start()); assert.ok(response.status >= 400);
      await page.locator('#gp-sync-auth-btn').waitFor();
      assert.equal(await page.evaluate(() => _gp.syncState), 'disconnected');
    });
    await check('Firebase acknowledgment and logout stay responsive while cloud storage is offline; retry saves', async () => {
      await page.evaluate(() => { window.__qaCredentialMode = 'success'; window.__qaCloudMode = 'offline'; });
      const response = await post(await start()); assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
      await page.locator('#gp-sync-auth-btn').waitFor();
      assert.equal(await page.evaluate(() => _gp.syncState), 'connected');
      assert.match(await page.locator('.gp-sync-text').textContent(), /Google/);
      assert.match(await page.locator('#gp-cloud-write-status').textContent(), /сақталуда/);
      await page.waitForFunction(() => document.getElementById('gp-cloud-write-status').textContent.includes('аяқталмады'));
      await page.evaluate(() => window.__qaCloudMode = 'online');
      await page.locator('#gp-cloud-write-retry').click();
      await page.waitForFunction(() => document.getElementById('gp-cloud-write-status').textContent.includes('сақталды'));
      assert.equal(await page.evaluate(() => window.__qaCloudWrites), 2);
      await page.screenshot({ path: path.join(output, 'backend-cloud-status.png') });
      await page.locator('#gp-sync-auth-btn').click();
      await page.waitForFunction(() => _gp.syncState === 'disconnected');
    });
    await check('cancel during credential exchange rejects the callback and discards late authentication', async () => {
      await page.evaluate(() => window.__qaCredentialMode = 'pending');
      const request = post(await start());
      await page.waitForFunction(() => typeof window.__qaReleaseCredential === 'function');
      await page.locator('#gp-sync-cancel-btn').click();
      assert.equal((await request).status, 410);
      await page.evaluate(() => window.__qaReleaseCredential());
      await page.waitForFunction(() => _gp.authSession.user === null && auth.currentUser === null);
      assert.equal(await page.evaluate(() => _gp.syncState), 'disconnected');
    });
    await check('failed AdBlock settings write preserves both live state and the saved setting', async () => {
      await page.evaluate(() => gpCloseModal());
      const before = await page.evaluate(() => galamtorAPI.getAdBlockStats());
      await fault('settings.json'); await page.locator('#btn-adblock').click();
      await page.waitForFunction(() => [...document.querySelectorAll('.toast-notification')].some(node => node.textContent.includes('баптауы сақталмады')));
      assert.equal((await page.evaluate(() => galamtorAPI.getAdBlockStats())).enabled, before.enabled);
      await recover(); await page.locator('#btn-adblock').click();
      const saved = await page.evaluate(() => galamtorAPI.getAdBlockStats()); assert.notEqual(saved.enabled, before.enabled);
      assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'))).adBlockEnabled, saved.enabled);
    });
    await check('history and downloads clearing report disk failure and preserve the existing records', async () => {
      await page.evaluate(() => galamtorAPI.addHistory({ url: 'https://qa.example/history', title: 'QA fixture', timestamp: Date.now() }));
      fs.writeFileSync(path.join(profile, 'downloads.json'), JSON.stringify([{ id:'qa', filename:'fixture.txt', savePath:path.join(profile,'fixture.txt'), url:'https://qa.example/file', totalBytes:4, completedAt:Date.now(), state:'completed' }]));
      await page.evaluate(() => gpOpenModal('history')); await page.locator('#gp-clear-history-btn').waitFor();
      await fault('history.json'); await page.locator('#gp-clear-history-btn').click();await page.locator('.gp-confirm-yes').click();
      await page.waitForFunction(() => [...document.querySelectorAll('.toast-notification')].some(node => node.textContent.includes('Тарихты тазалау сәтсіз')));
      assert.equal((await page.evaluate(() => galamtorAPI.getHistory())).length, 1);
      await recover(); await page.locator('#gp-clear-history-btn').click();await page.locator('.gp-confirm-yes').click();
      await page.waitForFunction(async () => (await galamtorAPI.getHistory()).length === 0);
      await page.evaluate(() => gpOpenModal('downloads'));await page.locator('#gp-clear-downloads-btn').waitFor();
      await fault('downloads.json');await page.locator('#gp-clear-downloads-btn').click();await page.locator('.gp-confirm-yes').click();
      await page.waitForFunction(() => [...document.querySelectorAll('.toast-notification')].some(node => node.textContent.includes('Жүктеу тарихын тазалау сәтсіз')));
      assert.equal((await page.evaluate(() => galamtorAPI.getDownloads())).length, 1);
      await recover();await page.locator('#gp-clear-downloads-btn').click();await page.locator('.gp-confirm-yes').click();
      await page.waitForFunction(async () => (await galamtorAPI.getDownloads()).length === 0);
      await page.evaluate(() => gpCloseModal());
    });
    await check('failed session writes warn once, keep the previous file and recover after retry', async () => {
      const saved = await page.evaluate(() => galamtorAPI.loadSession());
      await fault('session.json');await page.evaluate(() => { createTab(null);persistCurrentSession();persistCurrentSession(); });
      await page.waitForFunction(() => window._sessionSaveWarning === true);
      assert.deepEqual(await page.evaluate(() => galamtorAPI.loadSession()), saved);
      assert.equal(await page.locator('.toast-notification').filter({hasText:'Қойындылар сессиясы сақталмады'}).count(),1);
      await recover();await page.evaluate(() => persistCurrentSession());await page.waitForFunction(() => !window._sessionSaveWarning);
      assert.ok((await page.evaluate(() => galamtorAPI.loadSession())).length > saved.length);
    });
    await check('a second untrusted window cannot read or mutate the browser profile over preload IPC', async () => {
      const preload = await app.evaluate(({ app }) => process.getBuiltinModule('path').join(app.getAppPath(), 'preload.js'));
      const windowEvent = app.waitForEvent('window');
      await app.evaluate(({BrowserWindow}, preload) => {
        globalThis.__qaUntrusted = new BrowserWindow({webPreferences:{preload,contextIsolation:true,sandbox:true,partition:'qa-untrusted'}});
        globalThis.__qaUntrusted.loadURL('data:text/html,<h1>Disposable IPC test</h1>');
      }, preload);
      const untrusted = await windowEvent;
      await untrusted.waitForFunction(() => !!window.galamtorAPI);
      assert.deepEqual(await untrusted.evaluate(() => galamtorAPI.getBookmarks()), []);
      assert.equal(await untrusted.evaluate(() => galamtorAPI.addBookmark({url:'https://evil.example',title:'Blocked'})), false);
      assert.equal(await untrusted.evaluate(() => galamtorAPI.clearCache()), false);
      await app.evaluate(() => globalThis.__qaUntrusted.close());
      assert.ok((await page.evaluate(() => galamtorAPI.getBookmarks())).length > 0);
    });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'backend-results.json'), JSON.stringify({passed,rendererErrors:errors,packaged:await app.evaluate(({app})=>app.isPackaged),architecture:await app.evaluate(()=>process.arch),profile:'disposable; synthetic credentials; no real account'},null,2));
    console.log(`Completed ${passed.length} backend runtime checks; no renderer exceptions.`);
  } catch (error) {
    if(page&&!page.isClosed()) await page.screenshot({path:path.join(output,'backend-failure.png')}).catch(()=>{});
    throw error;
  } finally { if(app) await app.close().catch(()=>{}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
