const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, 'dist');
const { openDatabase } = require('./server/local-db.cjs');
const { calculate } = require('./dist/scoring.js');
const dataDirectory = path.join(__dirname, '.local-data');
fs.mkdirSync(dataDirectory, { recursive: true });
const db = openDatabase(path.join(dataDirectory, 'scores.sqlite'));
const apiPromise = import('./server/api.mjs').then(({ createApi }) => createApi(calculate));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
 if (req.url.startsWith('/api/')) {
  try {
   const chunks = []; let size = 0;
   for await (const chunk of req) { size += chunk.length; if (size > 64000) { res.writeHead(413).end(); return; } chunks.push(chunk); }
   const localOrigin = req.headers.host === 'localhost:4173' ? 'http://localhost:4173' : 'http://127.0.0.1:4173';
   const request = new Request(localOrigin + req.url, { method: req.method, headers: req.headers, ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }) });
   const response = await (await apiPromise)(request, { DB: db });
   res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500).end('Local service error'); }
  return;
 }
  let name;
  try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (!['index.html', 'styles.css', 'app.js', 'scoring.js', 'cloud.js', 'favicon.svg'].includes(path.relative(root, file))) { res.writeHead(404).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
server.listen(4173, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4173'));
