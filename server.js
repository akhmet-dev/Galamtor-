const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const DIST_DIR = path.resolve(__dirname, 'dist');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.dmg': 'application/x-apple-diskimage',
  '.zip': 'application/zip'
};

function reject(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

// Never follow links within the public tree, including directory symlinks.
// This also prevents a locally created preview asset from exposing other files.
async function statWithinRoot(root, relative) {
  let current = root;
  let stat = await fs.promises.lstat(root);
  if (stat.isSymbolicLink()) throw Object.assign(new Error('Forbidden'), { code: 'EACCES' });
  for (const part of relative.split('/').filter(Boolean)) {
    current = path.join(current, part);
    stat = await fs.promises.lstat(current);
    if (stat.isSymbolicLink()) throw Object.assign(new Error('Forbidden'), { code: 'EACCES' });
  }
  return { filePath: current, stat };
}

http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  let pathname, url;
  try {
    url = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(req.url.split(/[?#]/, 1)[0]);
  }
  catch { res.writeHead(400); res.end(); return; }
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') ||
      pathname.split('/').some(part => part.startsWith('.'))) {
    reject(res, 403, 'Forbidden'); return;
  }
  const isDist = pathname.startsWith('/dist/');
  const root = isDist ? DIST_DIR : PUBLIC_DIR;
  let relative = isDist ? pathname.slice(6) : pathname.slice(1);
  const filePath = path.resolve(root, relative);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    reject(res, 403, 'Forbidden');
    return;
  }
  try {
    let resolved = await statWithinRoot(root, relative);
    if (resolved.stat.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { Location: `${url.pathname}/${url.search}` });
        res.end(); return;
      }
      relative = path.join(relative, 'index.html');
      resolved = await statWithinRoot(root, relative);
    }
    if (!resolved.stat.isFile()) { reject(res, 404, 'Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(resolved.filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': resolved.stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(resolved.filePath).on('error', () => res.destroy()).pipe(res);
  } catch (error) {
    reject(res, error.code === 'EACCES' ? 403 : 404, error.code === 'EACCES' ? 'Forbidden' : 'Not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Galamtor preview: http://127.0.0.1:${PORT}`);
});
