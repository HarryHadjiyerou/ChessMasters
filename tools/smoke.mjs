// Playwright smoke test: plays a game through the real UI (mouse clicks on squares) and checks
// that a duel plays on every capture, the clock is paused during duels, and checkmate shows
// the end screen. Saves a screenshot sequence (and optionally a video).
//
// Usage: node tools/smoke.mjs [--url http://localhost:5173] [--out docs/screenshots/<date>/smoke] [--video]
//        [--game legal|scholar|king|promo] [--duel full|short|off]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i < 0 ? dflt : args[i + 1]; };
const flag = (name) => args.includes(`--${name}`);
const base = opt('url', 'http://localhost:5173');
const gameName = opt('game', 'legal');
const duel = opt('duel', 'full');
const outDir = opt('out', path.join('docs', 'screenshots', new Date().toISOString().slice(0, 10), `smoke-${gameName}-${duel}`));
fs.mkdirSync(outDir, { recursive: true });

const GAMES = {
  // Légal's Mate: three captures (knight, bishop takes queen, bishop with check) and a knight mate.
  legal: { fen: null, moves: ['e2e4', 'e7e5', 'g1f3', 'd7d6', 'f1c4', 'c8g4', 'b1c3', 'g7g6', 'f3e5', 'g4d1', 'c4f7', 'e8e7', 'c3d5'], mate: true },
  scholar: { fen: null, moves: ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'], mate: true },
  // The real Meshy Light King captures, then castling-free king walk.
  king: { fen: '4k3/8/8/8/8/3p4/4K3/8 w - - 0 1', moves: ['e2d3'], mate: false },
  // Promotion with the piece-choice popup (choose knight) and en passant.
  promo: { fen: '4k3/1P6/8/3pP3/8/8/8/4K3 w - d6 0 1', moves: ['e5d6', 'e8f7', 'b7b8=n'], mate: false },
};
const game = GAMES[gameName];

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
const context = await browser.newContext({
  viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1,
  ...(flag('video') ? { recordVideo: { dir: outDir, size: { width: 1536, height: 1024 } } } : {}),
});
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const q = new URLSearchParams({ play: '', duel, time: '600', noambience: '' });
if (game.fen) q.set('fen', game.fen);
if (opt('challenge')) q.set('challenge', opt('challenge'));
await page.goto(`${base}/?${q}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
await page.waitForTimeout(1500);

const results = { game: gameName, duel, moves: [], duels: [], errors };
await page.evaluate(() => {
  window.__long = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ t: Math.round(e.startTime), ms: Math.round(e.duration) }); })
      .observe({ type: 'longtask', buffered: false });
  } catch { /* not supported */ }
  window.__duels = [];
  window.__cm.game.events.on((e) => { if (e.type === 'duel') window.__duels.push({ ...e, t: performance.now() }); });
});
const clocks = () => page.evaluate(() => { const c = window.__cm.game.clock; return { w: c.remainingMs('w'), b: c.remainingMs('b'), paused: c.isPaused('duel') }; });
const clickSquare = async (sq) => {
  const p = await page.evaluate((s) => window.__cm.game.view.squareToClient(s), sq);
  await page.mouse.click(p.x, p.y);
};
let shot = 0;
const snap = async (label) => { await page.screenshot({ path: path.join(outDir, `${String(++shot).padStart(2, '0')}-${label}.png`) }); };
await snap('start');

for (const mv of game.moves) {
  const from = mv.slice(0, 2), to = mv.slice(2, 4), promo = mv.includes('=') ? mv.split('=')[1] : null;
  const capture = await page.evaluate(([f, t]) => window.__cm.game.rules.legalTargets(f).find((x) => x.to === t)?.capture ?? null, [from, to]);
  if (capture === null) throw new Error(`Illegal move in script: ${mv}`);
  let before = await clocks();
  if (flag('drag') && !capture) {
    // Drag-and-drop: press on the piece, move in steps, release on the target square.
    const a = await page.evaluate((s) => window.__cm.game.view.squareToClient(s), from);
    const b = await page.evaluate((s) => window.__cm.game.view.squareToClient(s), to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2 - 20, { steps: 6 });
    if (shot < 3) await snap(`drag-${from}`);
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
  } else {
    await clickSquare(from);
    await page.waitForTimeout(150);
    if (shot < 2) await snap(`select-${from}`);
    before = await clocks();
    await clickSquare(to);
  }
  if (promo) {
    await page.waitForSelector('.promo-btn', { timeout: 5000 });
    await page.waitForTimeout(450);
    await snap('promotion-popup');
    await page.click(`.promo-btn[data-piece="${promo}"]`);
  }
  let duelInfo = null;
  if (capture && duel !== 'off' && flag('skip')) {
    // Skip test: Space part-way through the duel must end it within a couple of frames.
    await page.waitForTimeout(600);
    const playingBefore = await page.evaluate(() => window.__cm.game.duel.playing);
    const t0 = Date.now();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => !window.__cm.game.duel.playing, null, { timeout: 2000 });
    duelInfo = { samples: [{ paused: playingBefore }], skipMs: Date.now() - t0, playingBefore };
    (results.skips ??= []).push(duelInfo.skipMs);
  } else if (capture && duel !== 'off') {
    // Screenshot the duel as it plays and watch the clock.
    const samples = [];
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(duel === 'full' ? 550 : 220);
      samples.push(await clocks());
      if (i === 1 || i === 3) await snap(`duel-${mv}-${i}`);
    }
    duelInfo = { samples };
  }
  await page.waitForFunction(() => !window.__cm.game.isBusy, null, { timeout: 20000 });
  const played = await page.evaluate(() => window.__cm.game.rules.moveCount());
  if (played !== results.moves.length + 1) throw new Error(`Move ${mv} did not register through the UI (moves played: ${played})`);
  const after = await clocks();
  await page.waitForTimeout(250);
  if (capture || game.moves.indexOf(mv) % 4 === 3) await snap(`after-${mv}`);
  const entry = { move: mv, capture, before, after };
  if (duelInfo) {
    const mover = (game.moves.indexOf(mv) % 2 === 0) === (!game.fen || game.fen.includes(' w ')) ? 'w' : 'b';
    entry.duelClockDeltaMs = before[mover] - after[mover];
    entry.pausedDuringDuel = duelInfo.samples.some((s) => s.paused);
  }
  results.moves.push(entry);
}

results.duels = await page.evaluate(() => window.__duels.filter((d) => d.phase === 'end').map((d) => +d.animSeconds.toFixed(2)));
results.end = await page.evaluate(() => window.__cm.game.ended);
if (game.mate) {
  await page.waitForSelector('[data-id="end-screen"]', { timeout: 5000 });
  await page.waitForTimeout(900); // card pop-in animation
  await snap('end-screen');
  results.endScreen = true;
  results.endExtra = await page.evaluate(() => document.querySelector('[data-id="end-extra"]')?.textContent ?? '');
}
results.history = await page.evaluate(() => window.__cm.game.rules.history());
results.longTasks = await page.evaluate(() => window.__long);
const captures = results.moves.filter((m) => m.capture).length;
results.checks = {
  duelPerCapture: duel === 'off' ? 'n/a' : results.duels.length === captures,
  clockPausedInEveryDuel: results.moves.filter((m) => m.capture && duel !== 'off').every((m) => m.pausedDuringDuel),
  skipEndsDuelFast: results.skips ? results.skips.every((ms) => ms < 250) : 'n/a',
  duelLengthsInTarget: duel === 'off' || results.skips ? 'n/a' : results.duels.every((s) => (duel === 'full' ? s >= 2.5 && s <= 5 : s <= 1.5)),
  noConsoleErrors: errors.length === 0,
  endScreenShown: game.mate ? !!results.endScreen : 'n/a',
};
await context.close();
await browser.close();
fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ history: results.history, duelSeconds: results.duels, checks: results.checks, clockDeltas: results.moves.filter((m) => m.capture).map((m) => m.duelClockDeltaMs), errors }, null, 2));
const ok = Object.values(results.checks).every((v) => v === true || v === 'n/a');
process.exit(ok ? 0 : 1);
