const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'public', 'app');
fs.mkdirSync(path.join(app, 'shared'), { recursive: true });
for (const file of ['browser-state.js', 'url-utils.js', 'welcome-utils.js', 'lens-utils.js', 'pet-companion.js', 'secure-auth-persistence.js']) {
  fs.copyFileSync(path.join(root, file), path.join(app, 'shared', file));
}
fs.copyFileSync(path.join(root, 'style.css'), path.join(app, 'desktop.css'));
fs.copyFileSync(path.join(root, 'vendor', 'firebase-compat.js'), path.join(app, 'firebase-compat.js'));
fs.cpSync(path.join(root, 'assets', 'wallpapers'), path.join(app, 'assets', 'wallpapers'), { recursive: true });
fs.copyFileSync(path.join(root, 'assets', 'icon.png'), path.join(app, 'assets', 'icon.png'));
const desktop = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const studioStart = desktop.indexOf('<aside id="galamtor-pet-studio"');
if (studioStart < 0) throw new Error('Desktop pet studio was not found');
const studio = desktop.slice(studioStart, desktop.indexOf('</aside>', studioStart) + '</aside>'.length);
const pet = `<div id="galamtor-bot-widget" class="galamtor-bot-widget" data-ai-state="idle">
  <button id="web-pet-avatar" class="galamtor-bot-open" type="button" aria-label="Серікті баптау"><div id="galamtor-pet-live-art" class="galamtor-pet-art" aria-hidden="true"></div><span id="galamtor-pet-live-accessory" class="galamtor-pet-accessory galamtor-pet-live-accessory" hidden aria-hidden="true"></span></button>
  <button id="galamtor-pet-customize" class="galamtor-bot-action" type="button" title="Серікті баптау" aria-label="Серікті баптау" aria-haspopup="dialog" aria-expanded="false" aria-controls="galamtor-pet-studio">✎</button>
  ${studio}
</div>`;
const htmlPath = path.join(app, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
if (!/<!-- shared-pet:start -->[\s\S]*?<!-- shared-pet:end -->/.test(html)) throw new Error('Web pet insertion point was not found');
html = html.replace(/<!-- shared-pet:start -->[\s\S]*?<!-- shared-pet:end -->/, `<!-- shared-pet:start -->\n${pet}\n<!-- shared-pet:end -->`);
fs.writeFileSync(htmlPath, html);
console.log('Galamtor Web assets ready');
