const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

esbuild.build({
  entryPoints: [path.join(__dirname, 'firebase-entry.js')],
  outfile: path.join(__dirname, '..', 'vendor', 'firebase-compat.js'),
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  legalComments: 'eof'
}).then(async () => {
  const output = path.join(__dirname, '..', 'vendor', 'firebase-compat.js');
  const bundle = await fs.promises.readFile(output, 'utf8');
  await fs.promises.writeFile(output, bundle.replace(/[\t ]+$/gm, ''));
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
