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

function sendFile(req, res, filePath) {
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(filePath).pipe(res);
  });
}

http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end(); return; }
  const isDist = pathname.startsWith('/dist/');
  const root = isDist ? DIST_DIR : PUBLIC_DIR;
  const relative = isDist ? pathname.slice(6) : (pathname === '/' ? 'index.html' : pathname.slice(1));
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root + path.sep) || relative.split('/').some(part => part.startsWith('.'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  sendFile(req, res, filePath);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Galamtor preview: http://127.0.0.1:${PORT}`);
});
