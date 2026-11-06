// Playwright: checks the teaching / feedback features through real clicks and screenshots them.
//  1. invalid move -> piece shakes + reason tip
//  2. Hint button -> arrow + bouncing piece + hint card with a reason
//  3. Scholar's Mate -> pop-up words on capture, "CHECKMATE!", Scholar's Mate badge
//  4. Guide mode vs computer -> coach panel names the opening and suggests a move
// Usage: node tools/features.mjs [--url http://localhost:5173] [--out dir]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const base = opt('url', 'http://localhost:5173');
const outDir = opt('out', path.join('docs', 'screenshots', new Date().toISOString().slice(0, 10), 'features'));
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const checks = {};
let n = 0;
const snap = async (name) => page.screenshot({ path: path.join(outDir, `${String(++n).padStart(2, '0')}-${name}.png`) });
const ready = () => page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
const sq = (s) => page.evaluate((x) => window.__cm.game.view.squareToClient(x), s);
const click = async (s) => { const p = await sq(s); await page.mouse.click(p.x, p.y); };
const idle = () => page.waitForFunction(() => !window.__cm.game.isBusy, null, { timeout: 20000 });
const move = async (a, b) => { await click(a); await page.waitForTimeout(120); await click(b); await page.waitForTimeout(100); await idle(); };

// ---- 1-3: local game, guide off ----
await page.goto(`${base}/?play&mute&noambience&duel=short&guide=0`);
await ready();
await page.waitForTimeout(1200);

await click('e2');
await page.waitForTimeout(150);
await click('e5');
await page.waitForTimeout(150);
checks.invalidTipShown = await page.isVisible('[data-id="tip"]');
checks.invalidReason = await page.textContent('[data-id="tip"]');
await snap('invalid-move-tip');

await page.click('.medal[data-id="hint"]');
await page.waitForFunction(() => document.querySelector('[data-id="coach-box"]')?.textContent?.includes('Best move'), null, { timeout: 15000 });
await page.waitForTimeout(500);
checks.hintText = (await page.textContent('[data-id="coach-box"]')).replace(/\s+/g, ' ').trim();
checks.hintArrow = await page.evaluate(() => window.__cm.game.view.highlights.group.children.some((c) => c.geometry?.type === 'ShapeGeometry'));
checks.hintBadgeNow = await page.textContent('.medal[data-id="hint"] .medal-badge');
await snap('hint-arrow-and-card');

// Scholar's Mate (local: both sides by click)
await page.evaluate(() => { window.__pops = []; new MutationObserver((ms) => { for (const m of ms) for (const nd of m.addedNodes) if (nd.classList?.contains('pop-word')) window.__pops.push(nd.textContent); }).observe(document.querySelector('.pop-layer'), { childList: true }); });
await move('e2', 'e4');
checks.centreBadge = await page.evaluate(() => document.querySelector('[data-id="badge"]')?.textContent ?? '');
await move('e7', 'e5');
await move('f1', 'c4');
await move('b8', 'c6');
await move('d1', 'h5');
await move('g8', 'f6');
await click('h5');
await page.waitForTimeout(120);
await click('f7');
await page.waitForFunction(() => window.__pops.length >= 1, null, { timeout: 10000 });
await page.waitForTimeout(180);
await snap('capture-pop-word');
await idle();
await page.waitForTimeout(300);
await snap('checkmate-badge');
checks.pops = await page.evaluate(() => window.__pops);
checks.mateBadge = await page.evaluate(() => document.querySelector('[data-id="badge"]')?.textContent ?? '');

// ---- 4: guide mode vs computer ----
await page.goto(`${base}/?vs=beginner&mute&noambience&duel=off&guide`);
await ready();
await page.waitForFunction(() => document.querySelector('[data-id="coach-box"]')?.textContent?.includes('Best move'), null, { timeout: 15000 });
await page.waitForTimeout(400);
await snap('guide-first-move');
checks.guideFirst = (await page.textContent('[data-id="coach-box"]')).replace(/\s+/g, ' ').trim();
await move('e2', 'e4');
await page.waitForFunction(() => window.__cm.game.rules.moveCount() >= 2 && !window.__cm.game.isBusy, null, { timeout: 20000 });
await page.waitForFunction(() => document.querySelector('[data-id="coach-box"]')?.textContent?.includes('Best move'), null, { timeout: 15000 });
await page.waitForTimeout(400);
await snap('guide-after-reply');
checks.guideSecond = (await page.textContent('[data-id="coach-box"]')).replace(/\s+/g, ' ').trim();

checks.noConsoleErrors = errors.length === 0;
checks.errors = errors;
await browser.close();
fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(checks, null, 2));
console.log(JSON.stringify(checks, null, 2));
