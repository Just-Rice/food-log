// A tiny static file server for the browser tests (no dependencies).
//
// Food Log loads Food is Medicine's data from ../food-is-medicine/, exactly as
// on GitHub Pages, so this serves the folder that holds both checkouts and the
// site lives at /food-log/.
//
//   const { base, close } = await startServer();   // base: http://localhost:PORT/food-log/

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_DIR = path.resolve(here, '..', '..');
export const ROOT_DIR = path.resolve(REPO_DIR, '..');
const SITE = path.basename(REPO_DIR);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

/** Starts the server on a random free port. Resolves to { base, port, close }. */
export function startServer({ root = ROOT_DIR } = {}) {
  const server = http.createServer((req, res) => {
    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch (e) { res.writeHead(400); res.end(); return; }
    if (urlPath === '/' + SITE) { res.writeHead(301, { Location: '/' + SITE + '/' }); res.end(); return; }
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const file = path.join(root, urlPath);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Loopback only: the root is the parent folder, which may hold other work.
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        base: 'http://localhost:' + port + '/' + SITE + '/',
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); })
      });
    });
  });
}
