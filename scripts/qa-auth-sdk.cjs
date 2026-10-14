// Real browser Firebase compat SDK; only popup/redirect outcomes and desktop ACK
// are synthetic. Fresh WebKit context; no account, password or real token used.
const { webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createAuthCallbackServer } = require('../auth-server');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', `qa-${require('../package.json').version}`, 'auth-hotfix');
const live = process.env.GALAMTOR_QA_AUTH_LIVE === '1';
const files = ['auth.html', 'auth-page.js', 'auth-flow.js', 'async-operations.js', 'assets/icon.png'];
const passed = [], errors = [];
let expectedBlockedFetches = 0;
let stage = 'setup', page;
const check = async (name, run) => { stage = name; await run(); passed.push(name); console.log(`PASS ${name}`); };
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await webkit.launch();
  let flow;
  try {
    const context = await browser.newContext({ locale: 'en-US' });
    if (!live) await context.route('https://galamtor.web.app/**', route => {
      const file = new URL(route.request().url()).pathname.slice(1);
      if (!files.includes(file)) return route.continue();
      return route.fulfill({ path: path.join(root, 'public', file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.png') ? 'image/png' : 'application/javascript' });
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => {
      const text = `${error.name}: ${error.message.replace(/qa-[\w-]+/g,'[fixture]')}`;
      if (/^Fetch API cannot load http: \/127\.0\.0\.1:4242\/(callback|cancel) due to access control checks\.$/.test(text)) expectedBlockedFetches++;
      else errors.push(text);
    });
    let callbacks = 0, canceled = 0, credentialMode = 'ok', confirm;
    const fresh = async () => {
      if (flow) {
        const closed = flow.server.listening ? new Promise(resolve => flow.server.once('close', resolve)) : Promise.resolve();
        flow.stop(); await closed;
      }
      const state = crypto.randomBytes(32).toString('hex');
      flow = createAuthCallbackServer({ state, origins: ['https://galamtor.web.app'],
        bridge: { html: fs.readFileSync(path.join(root,'public/auth-bridge.html'),'utf8'), script: fs.readFileSync(path.join(root,'public/auth-bridge.js'),'utf8') },
        onCancel: () => canceled++,
        onCredential: async body => {
          callbacks++;
          assert.deepEqual(Object.keys(body).sort(), ['googleAccessToken', 'googleIdToken']);
          // Compare internally; never print tokens or an account identity.
          assert.equal(body.googleIdToken, expected.id); assert.equal(body.googleAccessToken, expected.access);
          if (credentialMode === 'pending') return new Promise(resolve => { confirm = resolve; });
          return credentialMode === 'reject' ? { ok:false,code:'auth/invalid-credential' } : { ok:true,code:'complete' };
        }
      });
      await new Promise((resolve,reject) => { flow.server.once('error',reject); flow.server.listen(4242,'127.0.0.1',resolve); });
      await page.goto(`https://galamtor.web.app/auth.html?mode=login&state=${state}`);
      await page.locator('#login-btn').waitFor({ timeout: 30000 });
      assert.equal(await page.evaluate(() => firebase.SDK_VERSION), '13.0.0');
    };
    let expected = { id: 'qa-google-id-placeholder', access: 'qa-google-access-placeholder' };
    const finishInBridge = async () => {
      await page.locator('#retry-btn').waitFor();
      assert.match(await page.locator('#retry-btn').textContent(), /Galamtor-да/);
      const opened = page.waitForEvent('popup');
      await page.locator('#retry-btn').click();
      const bridge = await opened;
      await bridge.waitForURL('http://127.0.0.1:4242/bridge');
      assert.ok(!bridge.url().includes('qa-google-'));
      return bridge;
    };
    await fresh();
    await check('real CDN SDK confirms compat/modular result mismatch and the corrected extractor', async () => {
      const observed = await page.evaluate(() => {
        const provider = firebase.auth.GoogleAuthProvider;
        const result = { user: {}, credential: provider.credential('qa-id-placeholder', 'qa-access-placeholder') };
        const extracted = GalamtorAuthFlow.extractGoogleTokens(result, provider);
        return { oldMissing: provider.credentialFromResult(result) === null, idCorrect: extracted?.googleIdToken === 'qa-id-placeholder', accessCorrect: extracted?.googleAccessToken === 'qa-access-placeholder' };
      });
      assert.deepEqual(observed, { oldMissing: true, idCorrect: true, accessCorrect: true });
    });
    for (const [name, id, access] of [
      ['both Google token fields', 'qa-google-id-placeholder', 'qa-google-access-placeholder'],
      ['Google access token alone', null, 'qa-google-access-placeholder'],
      ['Google ID token alone', 'qa-google-id-placeholder', null]
    ]) await check(`real SDK credential passes through the helper with ${name}`, async () => {
      await fresh(); expected = { id, access };
      await page.evaluate(({ id, access }) => {
        const credential = firebase.auth.GoogleAuthProvider.credential(id, access);
        firebase.auth().signInWithPopup = async () => ({ user: {}, operationType: 'signIn', credential });
      }, expected);
      const before = callbacks;
      await page.locator('#login-btn').click();
      const bridge = await finishInBridge();
      if (id && access) for (const width of [320,520,800]) {
        await bridge.setViewportSize({width,height:600});
        assert.ok(await bridge.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        await bridge.screenshot({path:path.join(output,`local-bridge-${width}.png`)});
      }
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('кіруі расталды'));
      assert.match(await bridge.locator('#status').textContent(), /кіруі расталды/);
      assert.equal(callbacks, before + 1);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('galamtor-login-state')), null);
      const diagnostics = await page.locator('#logs').textContent();
      assert.ok(diagnostics.includes('auth/google-credential-ready'));
      assert.ok(!diagnostics.includes('qa-google-'));
      assert.ok(!diagnostics.includes('auth/invalid-credential'));
    });
    await check('real SDK helper recovers from a missing compat credential through retry', async () => {
      await fresh(); const before = callbacks;
      await page.evaluate(() => { firebase.auth().signInWithPopup = async () => ({ user: {}, credential: null }); });
      await page.locator('#login-btn').click();
      await page.waitForFunction(() => document.getElementById('logs').textContent.includes('auth/missing-google-credential'));
      assert.equal(callbacks, before);
      assert.equal(await page.locator('#spinner').isVisible(), false);
      expected = { id: null, access: 'qa-google-access-placeholder' };
      await page.evaluate(() => {
        firebase.auth().signInWithPopup = async () => ({ user: {}, credential: firebase.auth.GoogleAuthProvider.credential(null, 'qa-google-access-placeholder') });
      });
      await page.locator('#retry-btn').click();
      await finishInBridge();
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('кіруі расталды'));
      assert.equal(callbacks, before + 1);
    });
    await check('real SDK helper keeps cancellation available during a pending popup', async () => {
      await fresh(); const before = callbacks;
      await page.evaluate(() => { firebase.auth().signInWithPopup = () => new Promise(resolve => { window.__qaFinishPopup = resolve; }); });
      await page.locator('#login-btn').click();
      await page.locator('#cancel-btn').click();
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('тоқтатылды'));
      // HTTPS fetch cancellation is blocked too: the explicit local window sends it.
      await page.locator('#retry-btn').waitFor();
      const opened = page.waitForEvent('popup'); await page.locator('#retry-btn').click();
      const bridge = await opened;
      await bridge.waitForFunction(() => document.getElementById('status').textContent.includes('Кіру тоқтатылды'));
      await page.evaluate(() => window.__qaFinishPopup({ user: {}, credential: firebase.auth.GoogleAuthProvider.credential('qa-google-id-placeholder') }));
      assert.equal(callbacks, before); assert.equal(canceled, 1);
    });
    await check('local bridge rejection cannot report a confirmed account', async () => {
      await fresh(); credentialMode='reject'; expected={id:'qa-google-id-placeholder',access:null};
      await page.evaluate(() => { firebase.auth().signInWithPopup = async () => ({user:{},credential:firebase.auth.GoogleAuthProvider.credential('qa-google-id-placeholder')}); });
      await page.locator('#login-btn').click();const bridge=await finishInBridge();
      await page.waitForFunction(()=>document.getElementById('logs').textContent.includes('bridge/rejected'));
      assert.ok(!(await bridge.locator('#status').textContent()).includes('кіруі расталды')); credentialMode='ok';
    });
    await check('local bridge cancellation interrupts an outstanding desktop confirmation', async () => {
      await fresh(); credentialMode='pending'; confirm=null; expected={id:'qa-google-id-placeholder',access:null};
      await page.evaluate(() => { firebase.auth().signInWithPopup = async () => ({user:{},credential:firebase.auth.GoogleAuthProvider.credential('qa-google-id-placeholder')}); });
      await page.locator('#login-btn').click(); const bridge=await finishInBridge();
      await bridge.waitForFunction(()=>document.getElementById('status').textContent.includes('расталуда'));
      for (let i=0;i<100&&!confirm;i++) await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(typeof confirm,'function');
      await page.locator('#cancel-btn').click();
      await page.waitForFunction(()=>document.getElementById('logs').textContent.includes('auth/cancelled'));
      assert.match(await bridge.locator('#status').textContent(), /Кіру тоқтатылды/);
      confirm?.({ok:false,code:'auth/cancelled'}); credentialMode='ok';
    });
    await check('closing the local bridge recovers the helper from its loading state', async () => {
      await fresh(); credentialMode='pending'; confirm=null; expected={id:'qa-google-id-placeholder',access:null};
      await page.evaluate(() => { firebase.auth().signInWithPopup = async () => ({user:{},credential:firebase.auth.GoogleAuthProvider.credential('qa-google-id-placeholder')}); });
      await page.locator('#login-btn').click(); const bridge=await finishInBridge();
      await bridge.waitForFunction(()=>document.getElementById('status').textContent.includes('расталуда'));
      for(let i=0;i<100&&!confirm;i++)await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(typeof confirm,'function');
      await bridge.close();
      await page.waitForFunction(()=>document.getElementById('status').textContent.includes('терезе жабылды'));
      assert.equal(await page.locator('#spinner').isVisible(),false);await page.locator('#retry-btn').waitFor();
      confirm({ok:false,code:'auth/cancelled'});credentialMode='ok';
    });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, live ? 'real-sdk-live.json' : 'real-sdk-local.json'), JSON.stringify({ passed, unexpectedPageErrors: errors, expectedBlockedFetches, sdk: 'real CDN Firebase 13.0.0', source: live ? 'deployed website' : 'local helper', providerOutcomes: 'synthetic; actual SDK OAuthCredential objects', transport: 'actual HTTPS helper, postMessage and loopback HTTP', desktopAcknowledgment: 'fixture', realAccountSignIn: 'not tested' }, null, 2));
    console.log(`Completed ${passed.length} real-SDK helper regressions; real-account sign-in was not performed.`);
  } catch (error) {
    console.error('Failed stage:', stage);
    console.error('Page errors:', errors);
    if (page) console.error('Safe helper diagnostics:', await page.locator('#logs').textContent().catch(() => 'unavailable'));
    throw error;
  } finally { flow?.stop(); await browser.close(); }
})().catch(error => { console.error('Real-SDK helper check failed:', error.name); process.exitCode = 1; });
