// Real Firebase SDK + Google chooser, fresh WebKit context, no account selected.
const { webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', `qa-${require('../package.json').version}`, 'webkit');
fs.mkdirSync(output, {recursive:true});
(async () => {
  const browser = await webkit.launch();
  let stage = 'page-load', page;
  try {
    const context = await browser.newContext({locale:'en-US'});
    const files = ['auth.html','auth-page.js','auth-flow.js','async-operations.js','assets/icon.png'];
    await context.route('https://galamtor.web.app/**', route => {
      const file = new URL(route.request().url()).pathname.slice(1);
      if (!files.includes(file)) return route.continue();
      return route.fulfill({path:path.join(root,'public',file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.png')?'image/png':'application/javascript'});
    });
    page = await context.newPage();
    await page.goto(`https://galamtor.web.app/auth.html?mode=login&state=${crypto.randomBytes(32).toString('hex')}`);
    stage = 'SDK-ready';
    await page.locator('#login-btn').waitFor({timeout:30000});
    stage = 'popup-open';
    const opened = page.waitForEvent('popup',{timeout:20000});
    await page.locator('#login-btn').click();
    const popup = await opened;
    stage = 'Google-navigation';
    await popup.waitForURL(url => url.hostname === 'accounts.google.com',{timeout:30000});
    stage = 'Google-form';
    const identifier = popup.getByRole('textbox').first();
    await identifier.waitFor({timeout:30000});
    assert.equal(await identifier.inputValue(),'');
    const emailFormVisible = true;
    await popup.screenshot({path:path.join(output,'google-popup-public-signin.png')});
    const result = {sdk:'real Firebase 13.0.0',engine:'fresh WebKit',googleChooserOpened:true,googleEndpointPath:new URL(popup.url()).pathname,emailFormVisible,accountSelected:false,completedSignIn:false,productionConfigurationChanged:false};
    fs.writeFileSync(path.join(output,'google-popup-result.json'),JSON.stringify(result,null,2));
    console.log('PASS real Firebase popup reaches the official Google authentication endpoint in fresh WebKit; no account selected or completed sign-in.');
  } catch (error) {
    console.error('Smoke stage:',stage);
    if(page) {console.error('Helper status:',await page.locator('#status').textContent().catch(()=>''));await page.screenshot({path:path.join(output,'google-popup-failure.png')}).catch(()=>{});}
    throw error;
  } finally { await browser.close(); }
})().catch(error=>{console.error('Google popup smoke failed:',error.name);process.exitCode=1;});
