const { chromium, webkit, _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const engine = process.env.GALAMTOR_QA_WEB_ENGINE || 'chromium';
if (!['chromium', 'webkit'].includes(engine)) throw new Error('Use GALAMTOR_QA_WEB_ENGINE=chromium or webkit');
const output = path.join(root, 'dist', `qa-${require('../package.json').version}`, `web-app-${engine}`);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'galamtor-web-app-qa-'));
fs.mkdirSync(output, { recursive: true });
const passed = [], errors = [], forbiddenRequests = [];
let browser, electronApp, preview, base, serial = 0, actualEngine = engine;
const pages = new Set();
async function installExternalRoute(context) {
  await context.route('**/*', route => {
    const url = route.request().url();
    if(url.startsWith(base+'/') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>QA external site</title><p>External destination fixture</p>' });
  });
}

// Synthetic Firebase provider outcomes exercise the real web-auth state machine.
// No credentials, cookies or accounts from the user's browser are used.
const fakeFirebase = `(() => {
  class GoogleAuthProvider { setCustomParameters() {} }
  const key = 'firebase:authUser:qa-synthetic-key:galamtor-web';
  const user = {uid:'qa-synthetic-user',displayName:'QA Google',stsTokenManager:{accessToken:'qa-synthetic-access',refreshToken:'qa-synthetic-refresh'}};
  let persistence, initialized=false; const listeners=[];
  const notify = () => listeners.forEach(listener=>listener(auth.currentUser));
  const persist = async () => { if(!persistence)return; if(auth.currentUser)await persistence._set(key,auth.currentUser);else await persistence._remove(key); };
  const auth = {
    currentUser:null,
    _delegate:{
      persistenceManager:{persistence:null},
      async authStateReady(){
        if(window.__qaAuthInitialize==='pending')await new Promise(resolve=>window.__qaResolveAuthReady=resolve);
        if(window.__qaAuthInitialize==='failure')throw Object.assign(new Error('fixture'),{code:'auth/network-request-failed'});
        auth.currentUser=await persistence._get(key);
      },
      async setPersistence(candidate){
        const next = typeof candidate==='function'?new candidate():candidate;
        if(!await next._isAvailable())throw new Error('Unavailable fixture persistence');
        persistence=next;this.persistenceManager.persistence=next;await persist();
      }
    },
    onAuthStateChanged(listener){listeners.push(listener);queueMicrotask(()=>listener(auth.currentUser));return ()=>{};},
    async updateCurrentUser(value){auth.currentUser=value;await persist();notify();},
    async signOut(){auth.currentUser=null;await persist();notify();},
    signInWithPopup(){
      window.__qaPopupCount=(window.__qaPopupCount||0)+1;window.__qaPopupGesture=navigator.userActivation.isActive;
      const mode=window.__qaAuthPopup||'success';
      const codes={blocked:'auth/popup-blocked',closed:'auth/popup-closed-by-user',network:'auth/network-request-failed',invalid:'auth/invalid-credential'};
      if(codes[mode])return Promise.reject(Object.assign(new Error('fixture'),{code:codes[mode]}));
      const result = mode==='pending'?new Promise(resolve=>window.__qaResolveAuthPopup=()=>resolve({user})):Promise.resolve({user});
      return result.then(async result=>{await auth.updateCurrentUser(result.user);return result;});
    }
  };
  const provider = {isInitialized:()=>initialized,initialize(settings){initialized=true;const Type=settings.options.persistence[0];persistence=new Type();auth._delegate.persistenceManager.persistence=persistence;return auth._delegate;}};
  const app={name:'galamtor-web',_delegate:{container:{getProvider:()=>provider}},auth(){if(!initialized)provider.initialize({options:{persistence:[]}});return auth;},firestore(){return {collection(){return {doc(){return {collection(){return {doc(){return {async set(stats){window.__qaCloudFields=Object.keys(stats);if(window.__qaCloudFailure)throw new Error('fixture');}};}};}};}};}};}};
  const authAPI=()=>auth;authAPI.GoogleAuthProvider=GoogleAuthProvider;
  const firestore=()=>app.firestore();firestore.FieldValue={serverTimestamp:()=>({qaTimestamp:true})};
  window.firebase={apps:[],initializeApp(){this.apps.push(app);return app;},auth:authAPI,firestore};
})();`;

async function check(name, operation) {
  await operation(); passed.push(name); console.log(`PASS ${name}`);
}
async function createPage(options = {}) {
  let page, context;
  if (browser) {
    context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
    await installExternalRoute(context);
    page = await context.newPage();
  } else {
    const opened = electronApp.waitForEvent('window');
    await electronApp.evaluate(({ BrowserWindow }, partition) => {
      new BrowserWindow({ width: 1360, height: 900, show: false,
        webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true } }).loadURL('about:blank');
    }, `qa-web-app-${++serial}`);
    page = await opened; context = page.context();
  }
  pages.add(page); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.origin !== base) forbiddenRequests.push('unexpected-loopback');
  });
  await page.route('**/app/firebase-compat.js', route => options.sdkMissing
    ? route.fulfill({ body: '/* unavailable SDK fixture */', contentType: 'application/javascript' })
    : route.fulfill({ body: fakeFirebase, contentType: 'application/javascript' }));
  const rateFixture = { mode: options.rateMode || 'ok', calls: 0, pending: null };
  await page.route('https://open.er-api.com/**', async route => {
    rateFixture.calls++;
    if(rateFixture.mode === 'pending') await new Promise(resolve => { rateFixture.pending = resolve; });
    if(rateFixture.mode === 'error') return route.fulfill({ status: 503, body: 'Unavailable fixture' });
    const rates = rateFixture.mode === 'empty' ? {} : route.request().url().endsWith('/USD')
      ? { KZT: 500, USD: 1, EUR: 0.9, RUB: 80 } : { KZT: 1, USD: 0.002, EUR: 0.0018, RUB: 0.16 };
    return route.fulfill({ json: { result: 'success', base_code: 'USD', time_last_update_unix: 1760400000,
      time_last_update_utc: 'Tue, 14 Oct 2025 00:00:00 +0000', rates } });
  });
  if (options.init) await page.addInitScript(options.init);
  await page.goto(base + '/app/');
  await page.locator('#btn-new-tab').waitFor();
  await page.waitForFunction(()=>document.getElementById('tabs-container').children.length > 0);
  return { page, context, rates: rateFixture, close: async () => {
    pages.delete(page); if(browser) await context.close(); else await page.close();
  } };
}
async function closeDialogs(page) {
  await page.keyboard.press('Escape');
  if(await page.locator('#galamtor-pet-studio').isVisible()) await page.locator('#galamtor-pet-close').click();
}
async function openPanel(page, panel) {
  await closeDialogs(page); await page.locator('#btn-workspace').click();
  await page.locator(`#workspace-nav [data-panel="${panel}"]`).click();
}
async function popup(page, activate, expected) {
  const event = page.waitForEvent('popup');
  await activate(); const target = await event;
  await target.waitForLoadState('domcontentloaded');
  assert.match(target.url(), expected); await target.close();
}
async function menuAction(page, action) {
  await closeDialogs(page); await page.locator('#btn-browser-menu').click();
  await page.locator(`#browser-menu [data-action="${action}"]`).click();
}
async function setRange(locator, value) {
  await locator.focus();await locator.press('Home');
  for(let i=0;i<value;i++) await locator.press('ArrowRight');
}
async function captureExport(page) {
  await page.evaluate(()=>{
    window.__qaExport=null;const original=URL.createObjectURL.bind(URL),blobs=new Map();
    URL.createObjectURL=blob=>{const url=original(blob);blobs.set(url,blob);return url;};
    document.addEventListener('click',event=>{const link=event.target.closest('a[download]');if(!link)return;const blob=blobs.get(link.href);if(blob){event.preventDefault();blob.text().then(text=>window.__qaExport={name:link.download,text});}},true);
  });
  await page.locator('[data-action="export-profile"]').click();
  await page.waitForFunction(()=>window.__qaExport!==null);
  return page.evaluate(()=>window.__qaExport);
}

async function run() {
  const portProbe = net.createServer(); await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));
  const port = portProbe.address().port; await new Promise(resolve=>portProbe.close(resolve));
  base = `http://127.0.0.1:${port}`;
  preview = spawn(process.execPath, [path.join(root,'server.js')], { cwd: root, env: {...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe'] });
  await new Promise((resolve,reject)=>{preview.stdout.once('data',resolve);preview.once('error',reject);preview.once('exit',()=>reject(new Error('Preview exited before ready')));});
  if(engine==='webkit') browser = await webkit.launch();
  else if(fs.existsSync(chromium.executablePath())) browser = await chromium.launch();
  else {
    actualEngine = 'chromium-electron';
    const bootstrap = path.join(profile,'qa-browser.cjs');
    fs.writeFileSync(bootstrap, `const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.GALAMTOR_WEB_QA_PROFILE);app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank'));`);
    const env = {...process.env,GALAMTOR_WEB_QA_PROFILE:profile}; delete env.ELECTRON_RUN_AS_NODE; delete env.GEMINI_API_KEY;
    electronApp = await electron.launch({ args: [bootstrap], env }); await electronApp.firstWindow();
  }
  // Every external destination is a local fixture response. The browser really
  // opens its new tab; its content never reaches Google or another account site.
  if(electronApp) await installExternalRoute((await electronApp.firstWindow()).context());
  // Interaction cases are filled after the application UI is available.
  await applicationChecks(createPage);
  assert.deepEqual(errors, []); assert.deepEqual(forbiddenRequests, []);
  fs.writeFileSync(path.join(output,'web-app-results.json'),JSON.stringify({passed,rendererErrors:errors,forbiddenRequests,
    engine:actualEngine,accounts:'synthetic provider fixtures only',server:'real server.js'},null,2));
  console.log(`Completed ${passed.length} Galamtor Web checks (${actualEngine}); no renderer exceptions.`);
}

async function applicationChecks(create) {
  const view = await create(), page = view.page;
  await check('app routes through the real preview and shows a usable empty home',async()=>{
    const redirect = await fetch(base+'/app',{redirect:'manual'});
    assert.equal(redirect.status,301); assert.equal(redirect.headers.get('location'),'/app/');
    assert.equal((await fetch(base+'/app/')).status,200);
    assert.equal(await page.locator('#tabs-container .tab').count(),1);
    assert.equal(await page.locator('#welcome-screen').isVisible(),true);
    assert.match(await page.locator('#clock-time-display').textContent(),/\d{2}:\d{2}/);
    assert.ok((await page.locator('#home-favorites').textContent()).trim().length>0);
    assert.equal(await page.locator('iframe, webview').count(),0);
  });
  await check('home and address searches open native browser tabs and preserve their destinations',async()=>{
    await page.locator('#welcome-search-input').fill('Galamtor QA қазақша');
    await popup(page,()=>page.locator('#welcome-search-form [type="submit"]').click(),/^https:\/\/www\.google\.com\/search\?q=/);
    assert.equal(await page.locator('#web-site-view').isVisible(),true);
    assert.match(await page.locator('#site-url').textContent(),/google\.com\/search/);
    await page.locator('#btn-home').click();
    await page.locator('#url-input').fill('https://example.com/qa-destination');
    await popup(page,()=>page.locator('#url-form [type="submit"]').click(),/^https:\/\/example\.com\/qa-destination$/);
    assert.match(await page.locator('#site-url').textContent(),/example\.com\/qa-destination/);
    await popup(page,()=>page.locator('#site-open').click(),/^https:\/\/example\.com\/qa-destination$/);
    await page.locator('#btn-bookmark-current').click();
    assert.equal(await page.locator('#bookmark-url').inputValue(),'https://example.com/qa-destination');
    await closeDialogs(page); await page.locator('#btn-home').click();
  });
  await check('tab add, close and closed-tab recovery work from visible controls',async()=>{
    const before=await page.locator('#tabs-container .tab').count();
    await page.locator('#btn-new-tab').click();assert.equal(await page.locator('#tabs-container .tab').count(),before+1);
    await page.locator('#tabs-container .tab.active .tab-close').click();assert.equal(await page.locator('#tabs-container .tab').count(),before);
    await page.locator('.welcome-actions [data-action="reopen-tab"]').click();
    assert.equal(await page.locator('#tabs-container .tab').count(),before+1);
    await page.locator('#tabs-container .tab.active .tab-close').click();
    await menuAction(page,'reopen-tab'); assert.equal(await page.locator('#tabs-container .tab').count(),before+1);
  });
  await check('home actions, sidebar panels, customizer and AI link controls respond',async()=>{
    await page.locator('#btn-home').click();
    for(const [selector,panel] of [['.welcome-actions [data-action="open-history"]','history'],['.welcome-actions [data-action="open-bookmarks"]','bookmarks'],['#btn-sidebar-history','history'],['#btn-sidebar-bookmarks','bookmarks']]) {
      await page.locator(selector).click();
      assert.equal(await page.locator('#workspace-dialog').isVisible(),true);
      assert.equal(await page.locator(`#workspace-nav [data-panel="${panel}"]`).getAttribute('class'),'active');
      await closeDialogs(page);
    }
    for(const selector of ['#btn-settings','#btn-open-customizer']) {
      await page.locator(selector).click();assert.equal(await page.locator('#workspace-dialog').isVisible(),true);
      assert.equal(await page.locator('#workspace-nav [data-panel="settings"]').getAttribute('class'),'active');await closeDialogs(page);
    }
    await page.locator('#btn-ai-tools').click(); assert.equal(await page.locator('#ai-tools-dialog').isVisible(),true);
    await popup(page,()=>page.locator('#ai-tools-dialog a[href="https://chatgpt.com"]').click(),/^https:\/\/chatgpt\.com\/?$/);
    await page.locator('#btn-ai-tools').click();
    await popup(page,()=>page.locator('#ai-tools-dialog a[href="https://gemini.google.com"]').click(),/^https:\/\/gemini\.google\.com\/?$/);
    await page.locator('#btn-ai-tools').click();
    await page.locator('#ai-tools-dialog [data-action="lens"]').click();assert.equal(await page.locator('#lens-dialog').isVisible(),true);await closeDialogs(page);
    for(const selector of ['#dock-icons a[href="https://kaspi.kz"]','#dock-icons a[href="https://egov.kz"]','#dock-icons a[href="https://youtube.com"]','#dock-icons a[href="https://music.youtube.com"]']) {
      await popup(page,()=>page.locator(selector).click(),/^https:\/\//);
    }
    await page.locator('#btn-home').click();
    const newsBefore=await page.locator('#portal-news-bar').textContent();await page.locator('#btn-refresh-news').click();
    assert.notEqual(await page.locator('#portal-news-bar').textContent(),newsBefore);
    await popup(page,()=>page.locator('#cs-prayer a').click(),/^https:\/\/www\.muftyat\.kz\/kk\/namaz_times\//);
  });
  await check('Lens rejects private/local image URLs and opens valid Google image search',async()=>{
    await page.locator('#btn-lens').click();
    for(const url of ['http://127.0.0.1/private.jpg','file:///Users/qa/private.jpg','https://localhost/image.jpg']) {
      await page.locator('#lens-url').fill(url);await page.locator('#lens-form [type="submit"]').click();
      assert.ok((await page.locator('#lens-error').textContent()).trim().length>0);
      assert.equal(await page.locator('#lens-dialog').isVisible(),true);
    }
    await page.locator('#lens-url').fill('https://example.com/qa-image.jpg');
    await popup(page,()=>page.locator('#lens-form [type="submit"]').click(),/^https:\/\/(lens\.google|www\.google\.com)/);
    await closeDialogs(page);
  });
  await bookmarkChecks(page);
  await profileSettingsChecks(page);
  await check('pet name, color, accessory and temperament survive reload',async()=>{
    await closeDialogs(page); await page.locator('#btn-home').click();
    await page.locator('#galamtor-pet-customize').click();
    await page.locator('[data-pet-id="qyran"]').click();assert.equal(await page.locator('[data-pet-id="qyran"]').getAttribute('aria-pressed'),'true');
    await page.locator('#galamtor-pet-demo').click();assert.match(await page.locator('#galamtor-pet-save-status').textContent(),/амандасты/);
    await page.locator('#galamtor-pet-randomize').click();assert.match(await page.locator('#galamtor-pet-save-status').textContent(),/образ/);
    await page.locator('#galamtor-pet-reset').click();assert.equal(await page.locator('#galamtor-pet-name').inputValue(),'Самал');
    await page.locator('#galamtor-pet-name').fill('QA Самал');
    await page.locator('[data-pet-color="mint"]').click();
    await page.locator('#galamtor-pet-accessory').selectOption('headphones');
    await page.locator('#galamtor-pet-temperament').selectOption('calm');
    assert.match(await page.locator('#galamtor-pet-save-status').textContent(),/өзгер|сақтал|ат/i);
    await page.reload();await page.locator('#galamtor-pet-customize').click();
    assert.equal(await page.locator('#galamtor-pet-name').inputValue(),'QA Самал');
    assert.equal(await page.locator('[data-pet-color="mint"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#galamtor-pet-accessory').inputValue(),'headphones');
    assert.equal(await page.locator('#galamtor-pet-temperament').inputValue(),'calm');await closeDialogs(page);
  });
  await historyVibeChecks(page);
  await commandMenuExportChecks(page);
  await responsiveChecks(page);
  await view.close();
  await currencyChecks(create);
  await storageChecks(create);
  await authChecks(create);
}

async function bookmarkChecks(page) {
  await check('bookmarks add, reject unsafe/duplicate URLs, search, open, edit and delete consistently',async()=>{
    await closeDialogs(page);await page.locator('#btn-home').click();
    await page.locator('#btn-add-bookmark').click();
    await page.locator('#bookmark-title').fill('QA Favorite');
    await page.locator('#bookmark-url').fill('javascript:alert(1)');
    await page.locator('#bookmark-form [type="submit"]').click();
    assert.ok((await page.locator('#bookmark-error').textContent()).trim().length>0);
    assert.equal(await page.locator('#bookmark-dialog').isVisible(),true);
    await page.locator('#bookmark-url').fill('https://example.com/qa-favorite');
    await page.locator('#bookmark-form [type="submit"]').click();
    assert.equal(await page.locator('#bookmark-dialog').isVisible(),false);
    assert.equal(await page.locator('#bookmarks-bar-items .web-bar-link').filter({hasText:'QA Favorite'}).count(),1);
    assert.equal(await page.locator('#home-favorites .web-favorite').filter({hasText:'QA Favorite'}).count(),1);
    await popup(page,()=>page.locator('#home-favorites [data-site="QA Favorite"]').click(),/^https:\/\/example\.com\/qa-favorite$/);
    await page.locator('#btn-home').click();
    await popup(page,()=>page.locator('#bookmarks-bar-items [data-site="QA Favorite"]').click(),/^https:\/\/example\.com\/qa-favorite$/);
    await page.locator('#btn-home').click();
    await page.locator('.web-favorites [data-action="add-bookmark"]').click();
    await page.locator('#bookmark-title').fill('QA Duplicate');await page.locator('#bookmark-url').fill('https://example.com/qa-favorite');
    await page.locator('#bookmark-form [type="submit"]').click();
    assert.match(await page.locator('#bookmark-error').textContent(),/таңдаулыларда бар/);await closeDialogs(page);
    await openPanel(page,'bookmarks');await page.locator('#bookmark-filter').fill('never-match-qa');
    assert.equal(await page.locator('#bookmark-results .bookmark-row').count(),0);
    assert.match(await page.locator('#bookmark-results').textContent(),/табылмады/);
    await page.locator('#bookmark-filter').fill('qa-favorite');
    assert.equal(await page.locator('#bookmark-results .bookmark-row').count(),1);
    await page.locator('.bookmark-row [data-bookmark-edit]').click();
    await page.locator('#bookmark-title').fill('QA Favorite Edited');await page.locator('#bookmark-url').fill('https://example.com/qa-edited');
    await page.locator('#bookmark-form [type="submit"]').click();await closeDialogs(page);await page.locator('#btn-home').click();
    assert.equal(await page.locator('#bookmarks-bar-items [data-site="QA Favorite Edited"]').getAttribute('href'),'https://example.com/qa-edited');
    assert.equal(await page.locator('#home-favorites [data-site="QA Favorite Edited"]').count(),1);
    await page.reload();await page.locator('#btn-home').click();
    assert.equal(await page.locator('#bookmarks-bar-items [data-site="QA Favorite Edited"]').count(),1);
    await openPanel(page,'bookmarks');await page.locator('#bookmark-filter').fill('QA Favorite Edited');
    await page.locator('.bookmark-row [data-bookmark-edit]').click();await page.locator('#bookmark-delete').click();await closeDialogs(page);await page.locator('#btn-home').click();
    assert.equal(await page.locator('#bookmarks-bar-items [data-site="QA Favorite Edited"]').count(),0);
    assert.equal(await page.locator('#home-favorites [data-site="QA Favorite Edited"]').count(),0);
    // Retain a second bookmark for command search and export tests.
    await page.locator('#btn-add-bookmark').click();await page.locator('#bookmark-title').fill('QA Command Favorite');
    await page.locator('#bookmark-url').fill('https://example.com/qa-command');await page.locator('#bookmark-form [type="submit"]').click();
  });
}
async function profileSettingsChecks(page) {
  await check('profile name saves and survives reload',async()=>{
    await openPanel(page,'profile');await page.locator('#profile-name').fill('QA Galamtor Web');
    await page.locator('#profile-form [type="submit"]').click();assert.match(await page.locator('#web-toast').textContent(),/сақталды/);
    await page.reload();await openPanel(page,'profile');assert.equal(await page.locator('#profile-name').inputValue(),'QA Galamtor Web');await closeDialogs(page);
  });
  await check('widget, wallpaper, dim, style, pet visibility and Reduce Motion settings persist',async()=>{
    await openPanel(page,'settings');
    for(const widget of ['clock','currency','prayer','news']) await page.locator(`[data-widget="${widget}"]`).uncheck();
    await page.locator('[data-wallpaper="kolsai"]').click();
    await setRange(page.locator('[data-setting="dim"]'),70);await setRange(page.locator('[data-setting="blur"]'),3);
    await page.locator('[data-setting="hubStyle"]').selectOption('capsule');
    await page.locator('[data-setting="reduceMotion"]').check();await page.locator('[data-setting="showPet"]').uncheck();await closeDialogs(page);
    for(const selector of ['#welcome-clock-widget','#cs-currency','#cs-prayer','#section-reading-news','#galamtor-bot-widget']) assert.equal(await page.locator(selector).isVisible(),false);
    assert.equal(await page.locator('body').evaluate(element=>element.classList.contains('reduce-motion')),true);
    assert.match(await page.locator('#welcome-bg-image').getAttribute('style'),/kolsai/);
    await page.reload();await openPanel(page,'settings');
    for(const widget of ['clock','currency','prayer','news']) assert.equal(await page.locator(`[data-widget="${widget}"]`).isChecked(),false);
    assert.equal(await page.locator('[data-wallpaper="kolsai"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('[data-setting="dim"]').inputValue(),'70');assert.equal(await page.locator('[data-setting="blur"]').inputValue(),'3');
    assert.equal(await page.locator('[data-setting="hubStyle"]').inputValue(),'capsule');
    assert.equal(await page.locator('[data-setting="reduceMotion"]').isChecked(),true);assert.equal(await page.locator('[data-setting="showPet"]').isChecked(),false);
    await page.locator('[data-action="reset-settings"]').click();
    for(const widget of ['clock','currency','prayer','news']) assert.equal(await page.locator(`[data-widget="${widget}"]`).isChecked(),true);
    assert.equal(await page.locator('[data-setting="showPet"]').isChecked(),true);await closeDialogs(page);
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('body').evaluate(element=>element.classList.contains('reduce-motion')),true);
    await page.emulateMedia({reducedMotion:'no-preference'});
  });
  await check('session restore preserves managed tabs without reopening external sites automatically',async()=>{
    let automaticPopups=0;const record=()=>automaticPopups++;page.on('popup',record);
    const count=await page.locator('#tabs-container .tab').count();await page.reload();assert.equal(await page.locator('#tabs-container .tab').count(),count);
    assert.equal(automaticPopups,0);page.off('popup',record);
    await openPanel(page,'settings');await page.locator('[data-setting="restoreSession"]').uncheck();
    await page.reload();assert.equal(await page.locator('#tabs-container .tab').count(),1);
    assert.equal(await page.locator('#welcome-screen').isVisible(),true);
    await openPanel(page,'settings');assert.equal(await page.locator('[data-setting="restoreSession"]').isChecked(),false);
    await page.locator('[data-setting="restoreSession"]').check();await closeDialogs(page);
  });
}
async function historyVibeChecks(page) {
  await check('history filters, opens entries and clears only the managed history after confirmation',async()=>{
    await openPanel(page,'history');assert.ok(await page.locator('#history-results .history-row').count()>0);
    await page.locator('#history-filter').fill('never-match-qa');assert.equal(await page.locator('#history-results .history-row').count(),0);
    await page.locator('#history-filter').fill('example.com');assert.ok(await page.locator('#history-results .history-row').count()>0);
    await popup(page,()=>page.locator('#history-results .history-row a').first().click(),/^https:\/\/example\.com\//);
    await openPanel(page,'history');await page.locator('#history-filter').fill('');
    page.once('dialog',dialog=>dialog.dismiss());await page.locator('[data-action="clear-history"]').click();
    assert.ok(await page.locator('#history-results .history-row').count()>0);
    page.once('dialog',dialog=>dialog.accept());await page.locator('[data-action="clear-history"]').click();
    assert.equal(await page.locator('#history-results .history-row').count(),0);await closeDialogs(page);
  });
  await check('vibes add, select, edit, persist and delete without affecting bookmarks',async()=>{
    await openPanel(page,'vibes');const before=await page.locator('[data-vibe-id]').count();
    await page.locator('#vibe-name').fill('QA Vibe');await page.locator('#vibe-color').evaluate(input=>{input.value='#22aabb';input.dispatchEvent(new Event('change',{bubbles:true}));});await page.locator('#vibe-form [type="submit"]').click();
    assert.equal(await page.locator('[data-vibe-id]').count(),before+1);
    const selected=page.locator('[data-vibe-id]').filter({hasText:'QA Vibe'});const id=await selected.getAttribute('data-vibe-id');
    assert.match(await selected.textContent(),/✓/);await page.locator('[data-vibe-id="coding"]').click();
    await page.locator(`[data-vibe-id="${id}"]`).click();await page.locator(`[data-vibe-edit="${id}"]`).click();
    await page.locator('#vibe-name').fill('QA Vibe Edited');await page.locator('#vibe-form [type="submit"]').click();
    await page.reload();await openPanel(page,'vibes');assert.match(await page.locator(`[data-vibe-id="${id}"]`).textContent(),/QA Vibe Edited/);
    await page.locator(`[data-vibe-delete="${id}"]`).click();assert.equal(await page.locator('[data-vibe-id]').count(),before);
    assert.equal(await page.locator('#bookmarks-bar-items [data-site="QA Command Favorite"]').count(),1);await closeDialogs(page);
  });
}
async function commandMenuExportChecks(page) {
  await check('commands search supports no result, bookmark Enter and keyboard tab controls',async()=>{
    await page.keyboard.press('Control+k');assert.equal(await page.locator('#commands-dialog').isVisible(),true);
    await page.locator('#command-input').fill('never-match-qa');assert.equal(await page.locator('#command-results .web-command').count(),0);
    assert.match(await page.locator('#command-results').textContent(),/табылмады/);
    await page.locator('#command-input').fill('QA Command Favorite');
    await popup(page,()=>page.locator('#command-input').press('Enter'),/^https:\/\/example\.com\/qa-command$/);
    assert.equal(await page.locator('#commands-dialog').isVisible(),false);
    const before=await page.locator('#tabs-container .tab').count();
    await page.keyboard.press('Alt+t');assert.equal(await page.locator('#tabs-container .tab').count(),before+1);
    await page.keyboard.press('Alt+w');assert.equal(await page.locator('#tabs-container .tab').count(),before);
    await page.keyboard.press('Alt+Shift+t');assert.equal(await page.locator('#tabs-container .tab').count(),before+1);
    await page.keyboard.press('Alt+d');assert.equal(await page.locator('#bookmark-dialog').isVisible(),true);await closeDialogs(page);
    await page.locator('#tabs-container .web-tab-open[aria-selected="true"]').focus();await page.keyboard.press('Home');
    assert.equal(await page.locator('#tabs-container .web-tab-open').first().getAttribute('aria-selected'),'true');
    await page.keyboard.press('End');assert.equal(await page.locator('#tabs-container .web-tab-open').last().getAttribute('aria-selected'),'true');
  });
  await check('every menu action opens its working view or performs its tab action',async()=>{
    const destinations={'open-bookmarks':['#workspace-dialog','bookmarks'],'open-history':['#workspace-dialog','history'],'open-settings':['#workspace-dialog','settings'],'open-profile':['#workspace-dialog','profile'],
      'add-bookmark':['#bookmark-dialog'],'command-palette':['#commands-dialog'],'lens':['#lens-dialog'],'ai-tools':['#ai-tools-dialog']};
    for(const [action,[dialog,panel]] of Object.entries(destinations)) {
      await menuAction(page,action);assert.equal(await page.locator(dialog).isVisible(),true);
      if(panel) assert.equal(await page.locator(`#workspace-nav [data-panel="${panel}"]`).getAttribute('class'),'active');
      await closeDialogs(page);
    }
    await menuAction(page,'home');assert.equal(await page.locator('#welcome-screen').isVisible(),true);
    const before=await page.locator('#tabs-container .tab').count();await menuAction(page,'new-tab');assert.equal(await page.locator('#tabs-container .tab').count(),before+1);
    await page.locator('#tabs-container .tab.active .tab-close').click();await menuAction(page,'reopen-tab');assert.equal(await page.locator('#tabs-container .tab').count(),before+1);
    await page.locator('#btn-browser-menu').click();assert.equal(await page.locator('#btn-browser-menu').getAttribute('aria-expanded'),'true');
    await page.keyboard.press('ArrowDown');assert.equal(await page.locator('#browser-menu button:not(:disabled)').nth(1).evaluate(element=>element===document.activeElement),true);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#browser-menu').isVisible(),false);
  });
  await check('profile export produces valid JSON without credentials and import accepts only valid profiles',async()=>{
    await openPanel(page,'profile');
    // Observe the generated download Blob while preventing writes outside the
    // isolated profile when Electron's default context cannot accept downloads.
    const exported=await captureExport(page),payload=JSON.parse(exported.text);
    assert.equal(exported.name,'Galamtor-Web-profile.json');assert.equal(payload.version,1);assert.equal(payload.profile.name,'QA Galamtor Web');
    assert.ok(payload.bookmarks.some(entry=>entry.title==='QA Command Favorite'));assert.equal(payload.pet.name,'QA Самал');
    assert.ok(!/accessToken|refreshToken|idToken|googleIdToken|googleAccessToken|stsTokenManager|firebase:authUser/.test(exported.text));
    const invalid=Buffer.from('{invalid');await page.locator('#profile-import-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:invalid});
    await page.waitForFunction(()=>document.getElementById('web-toast').textContent.includes('Жарамды'));
    const imported={...payload,profile:{...payload.profile,name:'QA Imported'}};
    page.once('dialog',dialog=>dialog.accept());
    const reload = page.waitForEvent('domcontentloaded');
    await page.locator('#profile-import-file').setInputFiles({name:'profile.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
    await reload;await openPanel(page,'profile');
    assert.equal(await page.locator('#profile-name').inputValue(),'QA Imported');
    await page.locator('#profile-name').fill('QA Galamtor Web');await page.locator('#profile-form [type="submit"]').click();await closeDialogs(page);
  });
}
async function responsiveChecks(page) {
  await check('home, menus and Workspace fit 320, 390, 768, 1360 and 1920 pixel screens',async()=>{
    await closeDialogs(page);await page.locator('#btn-home').click();
    await page.locator('#web-toast').waitFor({state:'hidden',timeout:6000});
    for(const width of [320,390,768,1360,1920]) {
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1));
      assert.equal(await page.locator('#btn-new-tab').isVisible(),true);
      assert.equal(await page.locator('#btn-browser-menu').isVisible(),true);
      await page.screenshot({path:path.join(output,`home-${width}.png`)});
      await page.locator('#btn-browser-menu').click();
      assert.ok(await page.locator('#browser-menu').evaluate(element=>{const rect=element.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth+1;}));
      await page.screenshot({path:path.join(output,`menu-${width}.png`)});await page.keyboard.press('Escape');
      await page.locator('#btn-workspace').click();
      assert.ok(await page.locator('#workspace-dialog').evaluate(element=>{const rect=element.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth+1;}));
      for(const panel of ['profile','bookmarks','history','vibes','settings']) {
        await page.locator(`#workspace-nav [data-panel="${panel}"]`).click();
        assert.ok(await page.locator('#workspace-dialog').evaluate(element=>element.scrollWidth<=element.clientWidth+1));
      }
      await page.screenshot({path:path.join(output,`settings-${width}.png`)});await closeDialogs(page);
      await page.locator('#web-pet-avatar').click();assert.equal(await page.locator('#galamtor-pet-studio').isVisible(),true);
      assert.ok(await page.locator('#galamtor-pet-studio').evaluate(element=>{const rect=element.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth+1;}));
      await page.screenshot({path:path.join(output,`pet-${width}.png`)});await closeDialogs(page);
    }
    await page.setViewportSize({width:1360,height:900});
    assert.equal(await page.locator('iframe,webview').count(),0);
  });
}
async function currencyChecks(create) {
  await check('currency loading, unavailable/empty rates and retry recover without stale loading',async()=>{
    const view=await create({rateMode:'pending'}),page=view.page;
    try {
      await page.waitForFunction(()=>document.getElementById('rates-status').textContent.length>0);
      assert.match(await page.locator('#rates-status').textContent(),/жүкт|жаңарт|күтіңіз/i);
      view.rates.mode='error';view.rates.pending();
      await page.waitForFunction(()=>!document.getElementById('btn-refresh-rates').disabled);
      assert.match(await page.locator('#rates-status').textContent(),/қате|қолжетімсіз|сәтсіз|болмады|желі/i);
      assert.equal(await page.locator('#rate-usd').textContent(),'—');
      view.rates.mode='empty';await page.locator('#btn-refresh-rates').click();
      await page.waitForFunction(()=>!document.getElementById('btn-refresh-rates').disabled);
      assert.equal(await page.locator('#rate-usd').textContent(),'—');
      view.rates.mode='ok';await page.locator('#btn-refresh-rates').click();
      await page.waitForFunction(()=>document.getElementById('rate-usd').textContent!=='—');
      assert.ok(Number((await page.locator('#rate-usd').textContent()).replace(',','.'))>0);
      assert.ok(view.rates.calls>=3);
    } finally { await view.close(); }
  });
}
async function storageChecks(create) {
  await check('storage denied shows a warning while in-memory interactions remain usable',async()=>{
    const view=await create({init:()=>{Object.defineProperty(window,'localStorage',{get(){throw new Error('QA storage blocked');}});}});
    try {
      assert.equal(await view.page.locator('#storage-warning').isVisible(),true);
      const before=await view.page.locator('#tabs-container .tab').count();await view.page.locator('#btn-new-tab').click();
      assert.equal(await view.page.locator('#tabs-container .tab').count(),before+1);
      await view.page.locator('#btn-workspace').click();assert.equal(await view.page.locator('#workspace-dialog').isVisible(),true);
    } finally { await view.close(); }
  });
  await check('corrupt workspace remains recoverable and is never overwritten by normal actions',async()=>{
    const view=await create({init:()=>{localStorage.setItem('galamtor_web_workspace_v1','{qa-corrupt');}});
    try {
      assert.equal(await view.page.locator('#storage-warning').isVisible(),true);
      await view.page.locator('#btn-new-tab').click();
      assert.equal(await view.page.evaluate(()=>localStorage.getItem('galamtor_web_workspace_v1')),'{qa-corrupt');
    } finally { await view.close(); }
  });
}
async function authChecks(create) {
  await check('Google initialization loading and module failure stay actionable without automatic popup loops',async()=>{
    const loading=await create({init:()=>window.__qaAuthInitialize='pending'});
    try {
      await openPanel(loading.page,'profile');assert.equal(await loading.page.locator('#google-login').isDisabled(),true);
      assert.match(await loading.page.locator('#auth-status').textContent(),/жүктел|дайындал/i);
      await loading.page.waitForFunction(()=>typeof window.__qaResolveAuthReady==='function');
      await loading.page.evaluate(()=>window.__qaResolveAuthReady());
      await loading.page.waitForFunction(()=>!document.getElementById('google-login').disabled);
      assert.equal(await loading.page.evaluate(()=>window.__qaPopupCount||0),0);
    } finally { await loading.close(); }
    for(const options of [{sdkMissing:true},{init:()=>window.__qaAuthInitialize='failure'}]) {
      const failure=await create(options);
      try {
        await openPanel(failure.page,'profile');await failure.page.waitForFunction(()=>document.getElementById('auth-status').textContent.includes('іске қосылмады'));
        assert.equal(await failure.page.locator('#google-cancel').isVisible(),false);
        await failure.page.reload();await openPanel(failure.page,'profile');
        assert.equal(await failure.page.evaluate(()=>window.__qaPopupCount||0),0);
        await closeDialogs(failure.page);await failure.page.locator('#btn-new-tab').click();assert.ok(await failure.page.locator('#tabs-container .tab').count()>1);
      } finally { await failure.close(); }
    }
  });
  await check('Google popup errors offer manual retry and cancellation ignores a late success',async()=>{
    const view=await create(),page=view.page;
    try {
      await openPanel(page,'profile');await page.waitForFunction(()=>!document.getElementById('google-login').disabled);
      for(const mode of ['blocked','closed','network','invalid']) {
        await page.evaluate(mode=>window.__qaAuthPopup=mode,mode);await page.locator('#google-login').click();
        await page.waitForFunction(()=>!document.getElementById('google-login').hidden);
        assert.ok((await page.locator('#auth-status').textContent()).trim().length>0);
        assert.equal(await page.locator('#google-signout').isVisible(),false);
        assert.equal(await page.evaluate(()=>window.__qaPopupGesture),true);
      }
      await page.evaluate(()=>window.__qaAuthPopup='pending');await page.locator('#google-login').click();
      assert.equal(await page.locator('#google-cancel').isVisible(),true);await page.locator('#google-cancel').click();
      assert.match(await page.locator('#auth-status').textContent(),/тоқтатылды/);
      await page.evaluate(()=>window.__qaResolveAuthPopup());
      await page.waitForFunction(()=>firebase.auth().currentUser===null);
      assert.equal(await page.locator('#google-signout').isVisible(),false);
      assert.equal(await page.locator('#google-login').isVisible(),true);
    } finally { await view.close(); }
  });
  await check('Google success and statistics error/retry reveal only whitelisted profile counts',async()=>{
    const view=await create(),page=view.page;
    try {
      await openPanel(page,'profile');await page.waitForFunction(()=>!document.getElementById('google-login').disabled);
      await page.evaluate(()=>window.__qaCloudFailure=true);await page.locator('#google-login').click();
      await page.locator('#google-signout').waitFor();assert.match(await page.locator('#auth-status').textContent(),/қосылған/);
      await page.locator('#sync-retry').waitFor();assert.match(await page.locator('#sync-status').textContent(),/орындалмады/);
      await page.evaluate(()=>window.__qaCloudFailure=false);await page.locator('#sync-retry').click();
      await page.waitForFunction(()=>document.getElementById('sync-status').textContent.includes('сақталды'));
      assert.deepEqual((await page.evaluate(()=>window.__qaCloudFields)).sort(),['lastUpdated','openTabsCount','pinnedTabsCount','registrationDate','vibesCount'].sort());
      await page.locator('#google-signout').click();await page.waitForFunction(()=>!document.getElementById('google-login').hidden);
      assert.match(await page.locator('#auth-status').textContent(),/шықтыңыз/);
    } finally { await view.close(); }
  });
  await check('remembered Google session is encrypted, survives reload and is removed when disabled',async()=>{
    const view=await create(),page=view.page;
    try {
      await openPanel(page,'profile');await page.waitForFunction(()=>!document.getElementById('remember-signin').disabled);
      assert.equal(await page.locator('#remember-signin').isChecked(),false);
      await page.locator('#remember-signin').check();await page.waitForFunction(()=>!document.getElementById('remember-signin').disabled);
      await page.locator('#google-login').click();await page.locator('#google-signout').waitFor();
      const exported=await captureExport(page);
      assert.ok(!/qa-synthetic-access|qa-synthetic-refresh|accessToken|refreshToken|idToken|stsTokenManager|firebase:authUser/.test(exported.text));
      const encrypted=await page.evaluate(()=>new Promise((resolve,reject)=>{
        const request=indexedDB.open('galamtor-web-auth-v1');request.onerror=reject;
        request.onsuccess=()=>{const db=request.result,tx=db.transaction(['values','meta'],'readonly');
          const values=tx.objectStore('values').getAll(),key=tx.objectStore('meta').get('encryption-key');
          tx.oncomplete=()=>{resolve({count:values.result.length,encrypted:values.result.every(record=>record.ciphertext instanceof ArrayBuffer&&record.iv instanceof Uint8Array),nonExtractable:key.result.key.extractable===false});db.close();};};
      }));
      assert.ok(encrypted.count>0);assert.equal(encrypted.encrypted,true);assert.equal(encrypted.nonExtractable,true);
      assert.equal(await page.evaluate(()=>Object.values(localStorage).some(value=>String(value).includes('qa-synthetic-access'))),false);
      await page.reload();await openPanel(page,'profile');await page.locator('#google-signout').waitFor();assert.equal(await page.locator('#remember-signin').isChecked(),true);
      await page.locator('#remember-signin').uncheck();await page.waitForFunction(()=>!document.getElementById('remember-signin').disabled);
      await page.reload();await openPanel(page,'profile');await page.waitForFunction(()=>!document.getElementById('google-login').disabled);
      assert.equal(await page.locator('#google-signout').isVisible(),false);assert.equal(await page.locator('#remember-signin').isChecked(),false);
      const count=await page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('galamtor-web-auth-v1');request.onsuccess=()=>{const db=request.result,count=db.transaction('values','readonly').objectStore('values').count();count.onsuccess=()=>{resolve(count.result);db.close();};};}));
      assert.equal(count,0);
    } finally { await view.close(); }
  });
}

run().catch(async error => {
  for(const page of pages) if(!page.isClosed()) await page.screenshot({path:path.join(output,`web-app-failure-${++serial}.png`)}).catch(()=>{});
  console.error(error); process.exitCode=1;
}).finally(async () => {
  if(browser) await browser.close().catch(()=>{});
  if(electronApp) await electronApp.close().catch(()=>{});
  if(preview) preview.kill('SIGTERM');
  fs.rmSync(profile,{recursive:true,force:true});
});
