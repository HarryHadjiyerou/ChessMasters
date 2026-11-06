// Playwright: walks the whole menu flow through real clicks, screenshots every screen, starts a
// game against the computer with a challenge, plays a move and waits for the computer's reply.
// Usage: node tools/menu-flow.mjs [--url http://localhost:5173] [--out dir] [--width 1920 --height 1080]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const base = opt('url', 'http://localhost:5173');
const width = Number(opt('width', '1920')), height = Number(opt('height', '1080'));
const outDir = opt('out', path.join('docs', 'screenshots', new Date().toISOString().slice(0, 10), `menus-${width}x${height}`));
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
let n = 0;
const snap = async (name) => { await page.screenshot({ path: path.join(outDir, `${String(++n).padStart(2, '0')}-${name}.png`) }); };
const result = { checks: {} };

const t0 = Date.now();
await page.goto(base);
await page.waitForTimeout(300);
await snap('loading');
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
result.loadMs = Number(await page.evaluate(() => document.body.dataset.loadMs));
result.wallLoadMs = Date.now() - t0;
await page.waitForTimeout(800);
await snap('start');

await page.mouse.click(width / 2, height / 2);
await page.waitForSelector('.hotspot[data-id="light"]');
await page.waitForTimeout(700);
await page.hover('.hotspot[data-id="dark"]');
await page.waitForTimeout(400);
await snap('side-hover-dark');
await page.click('.hotspot[data-id="light"]');

await page.waitForSelector('.hotspot[data-id="palace-gardens"]');
await page.waitForTimeout(700);
await page.hover('.hotspot[data-id="palace-gardens"]');
await page.waitForTimeout(300);
await snap('arena');
result.checks.homeButton = await page.isVisible('[data-id="home"]');
await page.click('.hotspot[data-id="palace-gardens"]');

await page.waitForSelector('.hotspot[data-id="play"]');
await page.waitForTimeout(700);
await page.click('[data-id="opponent"] [data-value="computer"]');
await page.click('[data-id="level"] [data-value="beginner"]');
await snap('play');
await page.click('[data-id="settings"]');
await page.waitForSelector('.settings-panel');
await page.click('[data-id="clock"] [data-value="10"]');
await page.click('[data-id="challenge"] [data-value="speed-win"]');
await page.waitForTimeout(300);
await snap('settings-menu');
await page.click('.settings-panel [data-id="close"]');
await page.click('.hotspot[data-id="play"]');

await page.waitForFunction(() => window.__cm?.game, null, { timeout: 20000 });
await page.waitForTimeout(1500);
await snap('game-start');
const sq = (s) => page.evaluate((x) => window.__cm.game.view.squareToClient(x), s);
const a = await sq('e2'), b = await sq('e4');
await page.mouse.click(a.x, a.y);
await page.waitForTimeout(200);
await page.mouse.click(b.x, b.y);
await page.waitForFunction(() => window.__cm.game.rules.moveCount() >= 2, null, { timeout: 20000 });
await page.waitForFunction(() => !window.__cm.game.isBusy, null, { timeout: 20000 });
await page.waitForTimeout(400);
result.history = await page.evaluate(() => window.__cm.game.rules.history());
result.checks.computerReplied = result.history.length === 2;
await snap('after-computer-reply');

await page.click('[data-id="settings"]');
await page.waitForTimeout(400);
await snap('settings');
result.checks.challengePanelShown = await page.isVisible('.objective-ribbon');
await page.click('.settings-panel [data-id="close"]');
const k = await sq('g1');
await page.mouse.move(k.x, k.y);
await page.waitForTimeout(400);
await snap('piece-card-hover');
result.checks.pieceCardShown = await page.isVisible('.piece-card.shown');
await page.click('.medal[data-id="info"]');
await page.waitForTimeout(400);
await snap('info-panel');
await page.click('.medal[data-id="info"]');
await page.click('.medal[data-id="hint"]');
await page.waitForTimeout(2500);
await snap('hint');
await page.click('.medal[data-id="coach"]');
await page.waitForTimeout(300);
await snap('coach');
result.checks.noConsoleErrors = errors.length === 0;
result.checks.loadUnder10s = result.wallLoadMs < 10000;
result.errors = errors;
await browser.close();
fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(Object.values(result.checks).every(Boolean) ? 0 : 1);
