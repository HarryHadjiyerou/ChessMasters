// Minimal static file server for dist/ (used by PLAY CHESS MASTERS.bat). Serves files under
// dist/ and nothing else. Local only (127.0.0.1) unless --lan is given, which also lets phones
// and tablets on the same home Wi-Fi connect (PLAY ON PHONE.bat).
// Usage: node tools/serve.mjs [port] [--open] [--lan]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 4173);
const lan = process.argv.includes('--lan');

/** This computer's addresses on the home network (private IPv4 ranges only). */
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))
    .map((a) => a.address);
}
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.glb': 'model/gltf-binary', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, '.' + rel);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    const headers = {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': rel.startsWith('/assets/index-') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Accept-Ranges': 'bytes',
    };
    // Byte ranges: browsers fetch video in pieces (Safari on iPhone will not play it otherwise).
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
      let end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Port ${port} is already in use: Chess Masters is probably already running.`);
    if (process.argv.includes('--open')) exec(`start "" http://localhost:${port}`);
    process.exit(0);
  }
  throw e;
});

server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Chess Masters is running at http://localhost:${port}`);
  if (lan) {
    const ips = lanAddresses();
    console.log('');
    console.log('  ON YOUR PHONE (same Wi-Fi as this computer), open the browser and type:');
    console.log('');
    for (const ip of ips) console.log(`      http://${ip}:${port}`);
    if (!ips.length) console.log('      (no home network found: is this computer connected to Wi-Fi?)');
    console.log('');
    console.log('  Turn the phone sideways to play.');
    console.log('  If the phone cannot connect, Windows may be blocking Node.js: allow it on Private networks.');
    console.log('');
  }
  console.log('Keep this window open while you play. Close it to stop the game.');
  if (process.argv.includes('--open')) exec(`start "" http://localhost:${port}`);
});
