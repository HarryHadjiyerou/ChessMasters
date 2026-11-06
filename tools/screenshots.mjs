// Captures screenshots with Playwright at exactly the backdrop's size (1536x1024), so they are
// pixel-aligned with the source image for comparison.
//
// Usage: node tools/screenshots.mjs [--url http://localhost:5173] [--out docs/screenshots/<date>] name=query ...
//   e.g. node tools/screenshots.mjs board_empty=noambience board_overlay=overlay&noambience
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const base = opt('url', 'http://localhost:5173');
const outDir = opt('out', path.join('docs', 'screenshots', new Date().toISOString().slice(0, 10)));
const width = Number(opt('width', '1536'));
const height = Number(opt('height', '1024'));
const shots = args.map((a) => {
  const i = a.indexOf('=');
  return i < 0 ? { name: a, query: '' } : { name: a.slice(0, i), query: a.slice(i + 1) };
});
if (!shots.length) shots.push({ name: 'board_empty', query: 'noambience' });

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
for (const { name, query } of shots) {
  await page.goto(`${base}/?${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const s = window.__cm?.stage;
    if (!s) return null;
    const gl = s.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const maxErr = Math.max(...Object.values(s.cornerErrors()));
    return { fps: Math.round(s.fps), maxCornerErrorPx: +maxErr.toFixed(4), gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown' };
  });
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`${file}`, JSON.stringify(info));
}
await browser.close();
