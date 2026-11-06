// Screenshots one of each character playing each role (checks retargeting and the knight legs).
// Usage: node tools/gallery.mjs [--url http://localhost:5173] [--out dir]
import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const base = opt('url', 'http://localhost:5173');
const out = opt('out', 'tools/work/gallery');
fs.mkdirSync(out, { recursive: true });
const FEN = '8/8/1nbqkrp1/8/8/1NBQKRP1/8/8 w - - 0 1';
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 1536, height: 1024 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
for (const [role, times] of [['idle', [1.5]], ['gallop', [0.8]], ['rear', [0.6]], ['move', [0.8]], ['attack', [0.6, 1.4]], ['victory', [0.8]], ['win', [1.0, 2.2]], ['lose', [1.6]], ['defeat', [1.2]]]) {
  await p.goto(`${base}/?mute&noambience&duel=off&guide=0&fen=${encodeURIComponent(FEN)}&anim=${role}`);
  await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
  let last = 0;
  for (const t of times) { await p.waitForTimeout((t - last) * 1000); last = t; await p.screenshot({ path: path.join(out, `${role}-${t}s.png`) }); }
}
console.log('errors:', JSON.stringify(errs));
await b.close();
