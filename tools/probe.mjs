// Performance probe. `node tools/probe.mjs fps [url]` measures frame times; otherwise
// CPU-profiles a duel skip on the Légal position before 6.Bxf7+ to find a main-thread stall.
if (process.argv[2] === 'cost') {
  // Average fps at 1080p with one feature changed at a time.
  const { chromium: c } = await import('playwright');
  const b = await c.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto(`${process.argv[3] ?? 'http://localhost:4173'}/?play`);
  await p.waitForFunction(() => document.body.dataset.ready === '1');
  await p.waitForTimeout(2000);
  const variants = {
    baseline: '',
    'shadow map 1024': "s.sun.shadow.map?.dispose(); s.sun.shadow.map = null; s.sun.shadow.mapSize.set(1024,1024)",
    'shadows off': 's.renderer.shadowMap.enabled = false; s.scene.traverse(o => { if (o.material) o.material.needsUpdate = true })',
    'no bloom/vignette pass': 's.composer.passes[1].enabled = false',
    'no SMAA pass': 's.composer.passes[2].enabled = false',
    'pixel ratio 1': 's.maxPixelRatio = 1; s.resize()',
    'HUD hidden': "document.querySelector('.hud').style.display = 'none'",
    'ambience off': 's.ambience.enabled = false',
    'pieces hidden': 'window.__cm.game.view.group.visible = false',
  };
  const res = {};
  for (const [name, code] of Object.entries(variants)) {
    await p.reload();
    await p.waitForFunction(() => document.body.dataset.ready === '1');
    await p.waitForTimeout(1500);
    res[name] = await p.evaluate(async (code) => {
      const s = window.__cm.stage;
      new Function('s', code)(s);
      await new Promise((r) => setTimeout(r, 500));
      const n = 120; let last = performance.now(); const t = [];
      await new Promise((r) => { const f = (now) => { t.push(now - last); last = now; t.length < n ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); });
      return +(1000 / (t.reduce((a, b) => a + b, 0) / n)).toFixed(1);
    }, code);
  }
  console.log(JSON.stringify({ dpr: await p.evaluate(() => devicePixelRatio), fps: res }, null, 2));
  await b.close();
  process.exit(0);
}
if (process.argv[2] === 'stall') {
  const { chromium: c } = await import('playwright');
  const b = await c.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto(`${process.argv[3] ?? 'http://localhost:4173'}/?play&duel=full${process.argv.includes('--mute') ? '&mute' : ''}`);
  await p.waitForFunction(() => document.body.dataset.ready === '1');
  await p.waitForTimeout(2000);
  const idle = await p.evaluate(async () => {
    const gaps = []; let last = performance.now();
    await new Promise((res) => { let n = 0; const f = (now) => { if (now - last > 50) gaps.push(Math.round(now - last)); last = now; if (++n < 180) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    return gaps;
  });
  console.log('idle gaps (ms):', JSON.stringify(idle));
  const r = await p.evaluate(async () => {
    const g = window.__cm.game, s = window.__cm.stage;
    const long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); }).observe({ type: 'longtask' });
    const progs0 = s.renderer.info.programs.length;
    const frames = [];
    let last = performance.now(), stop = false;
    const f = (now) => { if (now - last > 50) frames.push({ at: Math.round(last), gap: Math.round(now - last), duel: g.duel.playing }); last = now; if (!stop) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    await g.commit('e2', 'e4'); await g.commit('d7', 'd5'); await g.commit('e4', 'd5');
    await new Promise((res) => setTimeout(res, 1500));
    stop = true;
    return { newPrograms: s.renderer.info.programs.length - progs0, longTasks: long, bigGaps: frames, textures: s.renderer.info.memory.textures };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
  process.exit(0);
}
if (process.argv[2] === 'fps') {
  const { chromium: c } = await import('playwright');
  const base = process.argv[3] ?? 'http://localhost:4173';
  const uncapped = process.argv.includes('--uncapped');
  const b = await c.launch({ headless: !process.argv.includes('--headed'), args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', ...(uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])] });
  const out = {};
  for (const [label, w, h, q] of [['1080p board idle', 1920, 1080, 'play&mute'], ['1080p full duel', 1920, 1080, 'play&mute&duel=full']]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto(`${base}/?${q}`);
    await p.waitForFunction(() => document.body.dataset.ready === '1');
    await p.waitForTimeout(2000);
    out[label] = await p.evaluate(async (duel) => {
      const g = window.__cm.game;
      if (duel) { await g.commit('e2', 'e4'); await g.commit('d7', 'd5'); void g.commit('e4', 'd5'); }
      const times = [];
      let last = performance.now();
      await new Promise((res) => {
        const step = (t) => { times.push(t - last); last = t; if (times.length < 240) requestAnimationFrame(step); else res(); };
        requestAnimationFrame(step);
      });
      times.sort((a, b) => a - b);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { avgFps: +(1000 / avg).toFixed(1), p95FrameMs: +times[Math.floor(times.length * 0.95)].toFixed(1), worstMs: +times.at(-1).toFixed(1), pieces: g.view.actors.size };
    }, q.includes('duel'));
    await p.close();
  }
  console.log(JSON.stringify(out, null, 2));
  await b.close();
  process.exit(0);
}
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
await page.goto('http://localhost:5173/?noambience&fen=' + encodeURIComponent('rn1qkbnr/ppp2p1p/3p2p1/4N3/2B1P3/2N5/PPPP1PPP/R1BbK2R w KQkq - 0 6'));
await page.waitForFunction(() => document.body.dataset.ready === '1');
await page.waitForTimeout(1500);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await page.evaluate(() => { window.__p = window.__cm.game.commit('c4', 'f7'); });
await page.waitForTimeout(600);
await cdp.send('Profiler.start');
const ms = await page.evaluate(async () => {
  const r = window.__cm.stage.renderer;
  const before = new Set(r.info.programs.map((p) => p.cacheKey));
  const t0 = performance.now();
  window.__cm.game.duel.skip();
  await window.__p;
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  window.__newPrograms = r.info.programs.filter((p) => !before.has(p.cacheKey)).map((p) => p.name + ' | ' + p.cacheKey.slice(0, 400));
  return Math.round(performance.now() - t0);
});
console.log('new programs:', JSON.stringify(await page.evaluate(() => window.__newPrograms), null, 1));
console.log('existing sprite programs:', JSON.stringify(await page.evaluate(() => window.__cm.stage.renderer.info.programs.filter((p) => p.cacheKey.startsWith('sprite')).map((p) => p.cacheKey.slice(0, 400))), null, 1));
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => {
  const n = byId.get(id);
  const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
});
console.log('skip + 2 frames:', ms, 'ms');
console.log([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${v.toFixed(1)} ms  ${k}`).join('\n'));
await browser.close();
