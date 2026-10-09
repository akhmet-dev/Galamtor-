const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const PORT = 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.dmg': 'application/x-apple-diskimage',
  '.zip': 'application/zip'
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURI(req.url.split('?')[0]);
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  let filePath = path.join(PUBLIC_DIR, reqPath);

  // If path is outside public, 403
  if (!filePath.startsWith(PUBLIC_DIR) && !filePath.startsWith(path.resolve(__dirname, 'dist'))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  // Check if file exists in public
  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(filePath).pipe(res);
    } else if (reqPath.startsWith('/dist/')) {
      // Support download files from dist folder
      const distPath = path.join(__dirname, reqPath);
      fs.stat(distPath, (dErr, dStats) => {
        if (!dErr && dStats.isFile()) {
          const ext = path.extname(distPath).toLowerCase();
          res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream'
          });
          fs.createReadStream(distPath).pipe(res);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>404 Not Found</h1>');
        }
      });
    } else {
      // Try appending .html
      const htmlPath = filePath + '.html';
      fs.stat(htmlPath, (hErr, hStats) => {
        if (!hErr && hStats.isFile()) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          fs.createReadStream(htmlPath).pipe(res);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>404 Not Found</h1>');
        }
      });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Galamtor Portal is live at http://localhost:${PORT}`);
});
