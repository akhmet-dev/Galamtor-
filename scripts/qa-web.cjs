const { _electron: electron, webkit } = require('playwright');
const engine = process.env.GALAMTOR_QA_WEB_ENGINE || 'electron';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', `qa-${require('../package.json').version}`, engine);
fs.mkdirSync(output, { recursive:true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'galamtor-web-qa-'));
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  const file = path.join(root,'public',pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!file.startsWith(path.join(root,'public') + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type',{'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}[path.extname(file)]||'text/plain');
  res.end(fs.readFileSync(file));
});
const passed = [], errors = [];
const check = async (name, run) => { await run(); passed.push(name); console.log(`PASS ${name}`); };
let app, browser, page;
const fakeFirebase = `
(() => {
  class Provider { setCustomParameters() {} }
  // Match the real SDK: the modular extractor cannot read a compat result.
  Provider.credentialFromResult = result => result?._tokenResponse ? ({providerId:'google.com',idToken:result._tokenResponse.oauthIdToken,accessToken:null}) : null;
  function auth() { return {
    setPersistence: async value => { window.__qaPersistence = value; if(window.__qaPersistenceFailure) throw Object.assign(new Error('fixture'),{code:'auth/network-request-failed'}); },
    getRedirectResult: async () => null,
    signOut: async () => {},
    signInWithRedirect: () => { throw new Error('Redirect must never start'); },
    signInWithPopup: () => {
      window.__qaPopups = (window.__qaPopups || 0) + 1;
      window.__qaUserGesture = navigator.userActivation.isActive;
      if(window.__qaPopupMode === 'blocked') return Promise.reject(Object.assign(new Error('fixture'),{code:'auth/popup-blocked'}));
      if(window.__qaPopupMode === 'closed') return Promise.reject(Object.assign(new Error('fixture'),{code:'auth/popup-closed-by-user'}));
      if(window.__qaPopupMode === 'pending') return new Promise(resolve=>{window.__qaResolvePopup=resolve});
      if(window.__qaPopupMode === 'empty') return Promise.resolve({user:{},credential:null});
      if(window.__qaPopupMode === 'invalid') return Promise.reject(Object.assign(new Error('fixture'),{code:'auth/invalid-credential'}));
      if(window.__qaPopupMode === 'wrong-provider') return Promise.resolve({user:{},credential:{providerId:'github.com',accessToken:'qa-fake-other-provider'}});
      return Promise.resolve({user:{},credential:{providerId:'google.com',idToken:'qa-fake-credential',accessToken:null}});
    }
  }; }
  auth.GoogleAuthProvider = Provider;
  auth.Auth = {Persistence:{NONE:'none'}};
  window.firebase = {initializeApp(){},auth};
})();`;

(async () => {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const env = {...process.env,GALAMTOR_DEV_PROFILE:profile}; delete env.ELECTRON_RUN_AS_NODE; delete env.GEMINI_API_KEY;
    if (engine === 'webkit') {
      browser = await webkit.launch();
      page = await browser.newPage({viewport:{width:1360,height:900}});
      await page.goto(base);
    } else {
      app = await electron.launch({args:[root],env});
      await app.firstWindow();
      const created = app.waitForEvent('window');
      await app.evaluate(({BrowserWindow},base) => {
        globalThis.__qaWeb = new BrowserWindow({width:1360,height:900,webPreferences:{partition:'qa-web'}});
        globalThis.__qaWeb.loadURL(base);
      }, base);
      page = await created;
    }
    page.setDefaultTimeout(12000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://fonts.googleapis.com/**',route=>route.abort());
    await page.route('https://fonts.gstatic.com/**',route=>route.abort());
    const release = {tag_name:'v1.5.1',html_url:'https://github.com/akhmet-dev/Galamtor-/releases/tag/v1.5.1',published_at:'2026-10-13T15:00:00Z',body:'Preview',assets:[
      {name:'Galamtor-1.5.1-arm64.dmg',size:100,browser_download_url:'https://github.com/akhmet-dev/Galamtor-/releases/download/v1.5.1/Galamtor-1.5.1-arm64.dmg'},
      {name:'Galamtor-1.5.1.dmg',size:100,browser_download_url:'https://github.com/akhmet-dev/Galamtor-/releases/download/v1.5.1/Galamtor-1.5.1.dmg'}
    ]};
    await page.route('https://api.github.com/repos/akhmet-dev/Galamtor-/releases/latest',route=>route.fulfill({json:release}));
    await check('website corrupt cache still fetches release and both Mac downloads',async()=>{
      await page.evaluate(()=>localStorage.setItem('galamtor_github_release_cache_v4','{invalid'));
      await page.reload();
      await page.waitForFunction(()=>document.getElementById('dl-platform-dropdown').querySelectorAll('a').length===2);
      assert.equal(await page.locator('#dl-main-btn').getAttribute('href'),release.html_url);
      await page.locator('#dl-platform-dropdown summary').click();
      assert.equal(await page.locator('#dl-platform-dropdown a').count(),2);
    });
    await check('website navigation and responsive layouts at 390, 768 and 1360 pixels',async()=>{
      for(const width of [390,768,1360]) {
        await page.setViewportSize({width,height:900});
        await page.locator('.sec-nav a[href="#download"]').click();
        assert.equal(await page.evaluate(()=>location.hash),'#download');
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({path:path.join(output,`website-${width}.png`),fullPage:true});
      }
    });
    await check('website blocked storage and API failure keep the official fallback usable',async()=>{
      await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('QA blocked')};Storage.prototype.setItem=()=>{throw new Error('QA blocked')};});
      await page.reload();
      await page.waitForFunction(()=>document.getElementById('dl-platform-dropdown').querySelectorAll('a').length===2);
      await page.unroute('https://api.github.com/repos/akhmet-dev/Galamtor-/releases/latest');
      await page.route('https://api.github.com/repos/akhmet-dev/Galamtor-/releases/latest',route=>route.fulfill({status:503,body:'unavailable'}));
      await page.reload();
      assert.equal(await page.locator('#dl-main-btn').getAttribute('href'),'https://github.com/akhmet-dev/Galamtor-/releases/latest');
    });
    let authPage;
    if (browser) authPage = await browser.newPage({viewport:{width:800,height:700}});
    else {
      const authCreated = app.waitForEvent('window');
      await app.evaluate(({BrowserWindow})=>{
        globalThis.__qaAuth = new BrowserWindow({width:800,height:700,webPreferences:{partition:'qa-auth'}});
        globalThis.__qaAuth.loadURL('about:blank');
      });
      authPage = await authCreated;
    }
    authPage.setDefaultTimeout(12000);
    authPage.on('pageerror',error=>errors.push(error.message));
    await authPage.route('https://www.gstatic.com/firebasejs/**',route=>route.abort());
    const state='a'.repeat(64), authURL=`${base}/auth.html?mode=login&state=${state}`;
    await check('auth SDK loading failure displays retry without an exception',async()=>{
      await authPage.goto(authURL);
      await authPage.locator('#retry-btn').waitFor();
      assert.match(await authPage.locator('#status').textContent(),/модулі жүктелмеді/);
      await authPage.unroute('https://www.gstatic.com/firebasejs/**');
      await authPage.route('https://www.gstatic.com/firebasejs/**',route=>route.fulfill({body:fakeFirebase,contentType:'application/javascript'}));
      await authPage.locator('#retry-btn').click();
      await authPage.locator('#login-btn').waitFor();
      assert.equal(await authPage.evaluate(()=>window.__qaPopups || 0),0);
    });
    let fields, callbackMode='ok', callbacks=0, cancellations=0;
    await authPage.route('http://127.0.0.1:4242/callback',route=>{
      callbacks++; fields=Object.keys(JSON.parse(route.request().postData()));
      if(callbackMode==='network') return route.abort();
      if(callbackMode==='legacy') return route.fulfill({status:200,body:'Legacy app receipt',headers:{'Access-Control-Allow-Origin':'*'}});
      return route.fulfill({status:callbackMode==='rejected'?401:200,json:{ok:callbackMode!=='rejected',code:callbackMode==='rejected'?'auth/failed':'complete'},headers:{'Access-Control-Allow-Origin':'*'}});
    });
    await authPage.route('http://127.0.0.1:4242/cancel',route=>{
      cancellations++; assert.deepEqual(Object.keys(JSON.parse(route.request().postData())),['state']);
      return route.fulfill({json:{ok:true},headers:{'Access-Control-Allow-Origin':'*'}});
    });
    await check('legacy empty redirect and repeated reloads stay manual; popup keeps a real user gesture',async()=>{
      await authPage.goto(`${base}/auth.html`); await authPage.locator('#login-btn').waitFor();
      for(let i=0;i<3;i++) {await authPage.reload();await authPage.locator('#login-btn').waitFor();}
      assert.equal(await authPage.evaluate(()=>window.__qaPopups || 0),0);
      await authPage.locator('#login-btn').click();
      await authPage.waitForFunction(()=>document.getElementById('status').textContent.includes('кіруі расталды'));
      assert.equal(await authPage.evaluate(()=>window.__qaPopups),1);
      assert.equal(await authPage.evaluate(()=>window.__qaUserGesture),true);
      assert.equal(await authPage.evaluate(()=>window.__qaPersistence),'none');
      assert.deepEqual(fields.sort(),['googleAccessToken','googleIdToken','state']);
      assert.equal(await authPage.evaluate(()=>sessionStorage.getItem('galamtor-login-state')),null);
    });
    await check('blocked and closed Google popup display an actionable manual retry',async()=>{
      await authPage.goto(authURL); await authPage.locator('#login-btn').waitFor();
      await authPage.evaluate(()=>window.__qaPopupMode='blocked');
      await authPage.locator('#login-btn').click();await authPage.locator('#retry-btn').waitFor();
      assert.match(await authPage.locator('#status').textContent(),/бұғатталды/);
      await authPage.evaluate(()=>window.__qaPopupMode='closed');
      await authPage.locator('#retry-btn').click();await authPage.locator('#retry-btn').waitFor();
      assert.match(await authPage.locator('#status').textContent(),/жабылды/);
      await authPage.evaluate(()=>window.__qaPopupMode='success');
      await authPage.locator('#retry-btn').click();
      await authPage.waitForFunction(()=>document.getElementById('status').textContent.includes('кіруі расталды'));
    });
    await check('missing or non-Google credentials stay retryable and never reach the desktop',async()=>{
      for (const mode of ['empty','wrong-provider']) {
        await authPage.goto(authURL); await authPage.locator('#login-btn').waitFor();
        const before = callbacks;
        await authPage.evaluate(mode=>window.__qaPopupMode=mode,mode);
        await authPage.locator('#login-btn').click();
        await authPage.waitForFunction(()=>document.getElementById('logs').textContent.includes('auth/missing-google-credential'));
        assert.equal(callbacks,before);
        assert.equal(await authPage.locator('#spinner').isVisible(),false);
        await authPage.evaluate(()=>window.__qaPopupMode='success');
        await authPage.locator('#retry-btn').click();
        await authPage.waitForFunction(()=>document.getElementById('status').textContent.includes('кіруі расталды'));
      }
    });
    await check('a Firebase provider rejection has a distinct safe diagnostic and manual retry',async()=>{
      await authPage.goto(authURL); await authPage.locator('#login-btn').waitFor();
      const before = callbacks;
      await authPage.evaluate(()=>window.__qaPopupMode='invalid');
      await authPage.locator('#login-btn').click();
      await authPage.waitForFunction(()=>document.getElementById('logs').textContent.includes('auth/invalid-credential'));
      assert.equal(callbacks,before);
      assert.ok(!(await authPage.locator('#logs').textContent()).includes('auth/missing-google-credential'));
      await authPage.evaluate(()=>window.__qaPopupMode='success');
      await authPage.locator('#retry-btn').click();
      await authPage.waitForFunction(()=>document.getElementById('status').textContent.includes('кіруі расталды'));
    });
    await check('desktop rejection never shows successful sign-in',async()=>{
      callbackMode='rejected'; await authPage.goto(authURL);await authPage.locator('#login-btn').waitFor();
      await authPage.locator('#login-btn').click();
      await authPage.waitForFunction(()=>document.getElementById('status').textContent.includes('растамады'));
      assert.equal(await authPage.locator('#retry-btn').count(),0);
    });
    await check('an older app receipt does not falsely claim confirmed authentication',async()=>{
      callbackMode='legacy';await authPage.goto(authURL);await authPage.locator('#login-btn').waitFor();
      await authPage.locator('#login-btn').click();
      await authPage.waitForFunction(()=>document.getElementById('status').textContent.includes('1.5.1'));
      assert.ok(!(await authPage.locator('#status').textContent()).includes('кіруі расталды'));
    });
    await check('callback network retry resends credentials without reopening the account chooser',async()=>{
      callbackMode='network'; await authPage.goto(authURL);await authPage.locator('#login-btn').waitFor();
      await authPage.locator('#login-btn').click();await authPage.locator('#retry-btn').waitFor();
      const before=callbacks;callbackMode='ok';await authPage.locator('#direct-retry-btn').click();
      await authPage.waitForFunction(()=>document.getElementById('status').textContent.includes('кіруі расталды'));
      assert.equal(callbacks,before+1);assert.equal(await authPage.evaluate(()=>window.__qaPopups),1);
    });
    await check('cancellation reaches the desktop and ignores a late popup result',async()=>{
      await authPage.goto(authURL);await authPage.locator('#login-btn').waitFor();
      await authPage.evaluate(()=>window.__qaPopupMode='pending');
      const before=callbacks;await authPage.locator('#login-btn').click();await authPage.locator('#cancel-btn').click();
      await authPage.waitForFunction(()=>document.getElementById('status').textContent.includes('тоқтатылды'));
      await authPage.evaluate(()=>window.__qaResolvePopup({user:{}}));
      assert.equal(callbacks,before);assert.ok(cancellations>0);
    });
    await check('memory-only popup flow works with blocked session storage and narrow screens',async()=>{
      await authPage.addInitScript(()=>{if(location.search.includes('blocked-storage=1')) Object.defineProperty(window,'sessionStorage',{get(){throw new Error('QA storage blocked')}});});
      await authPage.goto(authURL+'&blocked-storage=1');await authPage.locator('#login-btn').waitFor();
      for(const width of [320,390,800]) {
        await authPage.setViewportSize({width,height:700});
        assert.ok(await authPage.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1));
        await authPage.screenshot({path:path.join(output,`auth-${width}.png`)});
      }
      await authPage.locator('#login-btn').click();
      await authPage.waitForFunction(()=>document.getElementById('status').textContent.includes('кіруі расталды'));
    });
    await check('persistence setup failure cannot start a popup before recovery',async()=>{
      await authPage.addInitScript(()=>window.__qaPersistenceFailure=true);
      await authPage.goto(authURL);await authPage.locator('#retry-btn').waitFor();
      assert.equal(await authPage.evaluate(()=>window.__qaPopups || 0),0);
      await authPage.evaluate(()=>window.__qaPersistenceFailure=false);
      await authPage.locator('#retry-btn').click();await authPage.locator('#login-btn').waitFor();
      assert.equal(await authPage.evaluate(()=>window.__qaPopups || 0),0);
    });
    await authPage.screenshot({path:path.join(output,'auth-popup-ready.png')});
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'web-results.json'),JSON.stringify({passed,rendererErrors:errors,engine, providers:'deterministic fixtures; no real account'},null,2));
    console.log(`Completed ${passed.length} website/auth checks; no renderer exceptions.`);
  } catch(error) {
    if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'web-failure.png')}).catch(()=>{});
    throw error;
  } finally {
    if(app)await app.close().catch(()=>{});
    if(browser)await browser.close().catch(()=>{});
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
