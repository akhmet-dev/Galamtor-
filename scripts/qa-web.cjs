const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'qa-1.5.0');
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
let app, page;
const fakeFirebase = `
(() => {
  class Provider { setCustomParameters() {} }
  Provider.credentialFromResult = () => ({ idToken:'qa-fake-credential', accessToken:null });
  function auth() { return {
    getRedirectResult: async () => {
      const mode = sessionStorage.getItem('qa-auth-mode');
      if (mode === 'error') throw Object.assign(new Error('QA network failure'), {code:'auth/network-request-failed'});
      if (mode === 'success') return {user:{}};
      return null;
    },
    signInWithRedirect: async () => sessionStorage.setItem('qa-redirects', String(Number(sessionStorage.getItem('qa-redirects') || 0) + 1))
  }; }
  auth.GoogleAuthProvider = Provider;
  window.firebase = {initializeApp(){},auth};
})();`;
(async () => {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const env = {...process.env,GALAMTOR_DEV_PROFILE:profile}; delete env.ELECTRON_RUN_AS_NODE; delete env.GEMINI_API_KEY;
    app = await electron.launch({args:[root],env});
    await app.firstWindow();
    const created = app.waitForEvent('window');
    await app.evaluate(({BrowserWindow},base) => {
      globalThis.__qaWeb = new BrowserWindow({width:1360,height:900,webPreferences:{partition:'qa-web'}});
      globalThis.__qaWeb.loadURL(base);
    }, base);
    page = await created; page.setDefaultTimeout(12000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://fonts.googleapis.com/**',route=>route.abort());
    await page.route('https://fonts.gstatic.com/**',route=>route.abort());
    const release = {tag_name:'v1.5.0',html_url:'https://github.com/akhmet-dev/Galamtor-/releases/tag/v1.5.0',published_at:'2026-10-13T15:00:00Z',body:'Preview',assets:[
      {name:'Galamtor-1.5.0-arm64.dmg',size:100,browser_download_url:'https://github.com/akhmet-dev/Galamtor-/releases/download/v1.5.0/Galamtor-1.5.0-arm64.dmg'},
      {name:'Galamtor-1.5.0.dmg',size:100,browser_download_url:'https://github.com/akhmet-dev/Galamtor-/releases/download/v1.5.0/Galamtor-1.5.0.dmg'}
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
    // A separate fresh page has normal session storage for the OAuth state tests.
    const authCreated = app.waitForEvent('window');
    await app.evaluate(({BrowserWindow})=>{
      globalThis.__qaAuth = new BrowserWindow({width:800,height:700,webPreferences:{partition:'qa-auth'}});
      globalThis.__qaAuth.loadURL('about:blank');
    });
    const authPage = await authCreated;
    authPage.setDefaultTimeout(12000);
    authPage.on('pageerror',error=>errors.push(error.message));
    await authPage.route('https://www.gstatic.com/firebasejs/**',route=>route.abort());
    const state='a'.repeat(64);
    await check('auth SDK loading failure displays retry without an exception',async()=>{
      await authPage.goto(`${base}/auth.html?mode=login&state=${state}`);
      await authPage.locator('#retry-btn').waitFor();
      assert.match(await authPage.locator('#status').textContent(),/модулі жүктелмеді/);
      await authPage.unroute('https://www.gstatic.com/firebasejs/**');
      await authPage.route('https://www.gstatic.com/firebasejs/**',route=>route.fulfill({body:fakeFirebase,contentType:'application/javascript'}));
      await authPage.locator('#retry-btn').click();
      await authPage.waitForFunction(()=>sessionStorage.getItem('qa-redirects')==='1');
    });
    await check('auth no-result reloads never loop, manual retry starts exactly once',async()=>{
      for(let i=0;i<3;i++) {await authPage.reload();await authPage.locator('#retry-btn').waitFor();}
      assert.equal(await authPage.evaluate(()=>sessionStorage.getItem('qa-redirects')),'1');
      await authPage.locator('#retry-btn').click();
      await authPage.waitForFunction(()=>sessionStorage.getItem('qa-redirects')==='2');
      await authPage.reload();await authPage.locator('#retry-btn').waitFor();
      assert.equal(await authPage.evaluate(()=>sessionStorage.getItem('qa-redirects')),'2');
    });
    await check('auth provider error remains manual and successful callback excludes identity fields',async()=>{
      await authPage.evaluate(()=>sessionStorage.setItem('qa-auth-mode','error'));
      await authPage.reload();await authPage.locator('#retry-btn').waitFor();
      assert.equal(await authPage.evaluate(()=>sessionStorage.getItem('qa-redirects')),'2');
      let fields;
      await authPage.route('http://127.0.0.1:4242/callback',route=>{
        fields=Object.keys(JSON.parse(route.request().postData()));
        return route.fulfill({status:200,body:'ok',headers:{'Access-Control-Allow-Origin':'*'}});
      });
      await authPage.evaluate(()=>sessionStorage.setItem('qa-auth-mode','success'));
      await authPage.reload();
      await authPage.waitForFunction(()=>document.getElementById('status').textContent.includes('синхрондалды'));
      assert.deepEqual(fields.sort(),['googleAccessToken','googleIdToken','state']);
      assert.equal(await authPage.evaluate(()=>sessionStorage.getItem('galamtor-login-state')),null);
    });
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'web-results.json'),JSON.stringify({passed,rendererErrors:errors,providers:'deterministic fixtures; no real account'},null,2));
    console.log(`Completed ${passed.length} website/auth checks; no renderer exceptions.`);
  } catch(error) {
    if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'web-failure.png')}).catch(()=>{});
    throw error;
  } finally {
    if(app)await app.close().catch(()=>{});
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
