'use strict';
// Static file server for the smoke test (SPEC 10.3). Node built-ins only.
// Usage: node scripts/serve.cjs [--port 4395] [--root <dir>]
// Binds 127.0.0.1 only, serves GET and HEAD only, refuses port 4317, never lists directories.
const http = require('http');
const fs = require('fs');
const path = require('path');

const RESERVED_PORT = 4317;
const DEFAULT_PORT = 4395;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function send(res, code, text, head) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(head ? undefined : text);
}

// Maps a request URL to a file inside root, or returns {code} for 403.
function resolvePath(root, url) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname); } catch (e) { return { code: 403 }; }
  if (pathname.indexOf('\0') >= 0) return { code: 403 };
  const segments = pathname.split(/[\\/]+/);
  if (segments.some((s) => s === '..')) return { code: 403 };
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const file = path.resolve(root, '.' + pathname);
  const rel = path.relative(root, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return { code: 403 };
  return { file };
}

function createServer(root) {
  root = path.resolve(root);
  return http.createServer((req, res) => {
    const head = req.method === 'HEAD';
    if (req.method !== 'GET' && !head) { res.setHeader('Allow', 'GET, HEAD'); send(res, 405, 'Method not allowed', false); return; }
    const r = resolvePath(root, req.url || '/');
    if (r.code) { send(res, r.code, 'Forbidden', head); return; }
    fs.stat(r.file, (err, st) => {
      if (err || !st.isFile()) { send(res, 404, 'Not found', head); return; }
      const type = MIME[path.extname(r.file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      if (head) { res.end(); return; }
      fs.createReadStream(r.file).on('error', () => res.destroy()).pipe(res);
    });
  });
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def; };
  const port = Number(arg('--port', String(DEFAULT_PORT)));
  const root = path.resolve(arg('--root', path.resolve(__dirname, '..')));
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('Invalid --port.'); process.exit(2); }
  if (port === RESERVED_PORT) { console.error('Port ' + RESERVED_PORT + ' is reserved for another local tool.'); process.exit(2); }
  const server = createServer(root);
  server.on('error', (e) => { console.error('Server error: ' + e.message); process.exit(1); });
  server.listen(port, '127.0.0.1', () => { console.log('Serving on http://127.0.0.1:' + port + '/'); });
}

if (require.main === module) main();
module.exports = { createServer, resolvePath, MIME, RESERVED_PORT, DEFAULT_PORT };
