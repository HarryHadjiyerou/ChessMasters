import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel-decorative/700.css';
import './ui/hud.css';
import './ui/menus.css';
import { App } from './app';
import { sound } from './audio/sound';
import type { DuelMode } from './game/DuelDirector';
import type { PlayLevel } from './ai/engine';

// Normal start shows the menus. Test/debug URL options skip them:
//   ?play  (straight into a local game)  ?vs=easy  ?side=b  ?duel=short|off  ?time=600  ?fen=...  ?challenge=<id>
//   ?overlay  ?noambience  ?empty (scene only)  ?menu=side|arena|play  ?intro (show the opening zoom)
async function boot() {
  const loading = document.getElementById('loading')!;
  const bar = document.getElementById('loading-bar')!;
  const label = document.getElementById('loading-label')!;
  const started = performance.now();
  if (new URLSearchParams(location.search).has('mute')) sound.disabled = true;
  const app = await App.boot((frac, text) => {
    bar.style.width = `${Math.round(frac * 100)}%`;
    label.textContent = text;
  });
  const params = new URLSearchParams(location.search);
  if (params.has('overlay')) app.stage.setOverlayTest(true);
  if (params.has('noambience')) app.stage.ambience.enabled = false;
  if (params.has('duel')) app.save.data.settings.duelMode = params.get('duel') as DuelMode;
  if (params.has('guide')) app.save.data.settings.guidance = params.get('guide') !== '0';

  if (params.has('play') || params.has('vs') || params.has('fen')) {
    if (params.has('intro')) loading.classList.add('done');
    await app.quickStart({
      intro: params.has('intro'),
      side: params.get('side') === 'b' ? 'b' : 'w',
      opponent: params.has('vs') ? 'computer' : 'local',
      level: (params.get('vs') as PlayLevel) || 'easy',
      timeMs: params.has('time') ? Number(params.get('time')) * 1000 : null,
      fen: params.get('fen') ?? undefined,
      challengeId: params.get('challenge') ?? undefined,
      arena: (params.get('arena') as 'palace-gardens') ?? undefined,
    });
    // Gallery test: ?fen=<one of each piece>&anim=<role>[&pick=n] makes every piece play a role.
    const role = params.get('anim');
    const g = (window as unknown as { __cm: { game?: { view: { actors: Map<string, { play: (r: string, o: object) => Promise<boolean>; rear: number; gait: number; centaur: boolean }> } } } }).__cm.game;
    if (role && g) {
      for (const a of g.view.actors.values()) {
        if (role === 'gallop') { a.gait = 1; void a.play('move', { loop: true }); continue; }
        if (role === 'rear') { a.rear = 1; continue; }
        void a.play(role, { loop: !['defeat', 'lose'].includes(role), pick: params.has('pick') ? Number(params.get('pick')) : undefined });
      }
    }
  } else if (params.has('empty')) {
    if (params.has('arena')) await app.stage.setArena(params.get('arena')!);
    app.stage.board.setSide(params.get('side') === 'b' ? 'b' : 'w');
    (window as unknown as { __cm: unknown }).__cm = { app, stage: app.stage, ready: true };
  } else {
    await app.showMenu((params.get('menu') as 'start') ?? 'start');
    (window as unknown as { __cm: unknown }).__cm = { app, stage: app.stage, ready: true };
  }
  if (params.has('fps')) {
    // On-screen frame counter for checking performance on a real display.
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:50;padding:4px 8px;font:700 13px monospace;color:#9f9;background:rgba(0,0,0,.7);border-radius:4px;pointer-events:none';
    document.body.appendChild(box);
    let frames = 0, worst = 0, last = performance.now(), windowStart = last;
    const tick = (now: number) => {
      frames++;
      worst = Math.max(worst, now - last);
      last = now;
      if (now - windowStart >= 1000) {
        box.textContent = `${Math.round((frames * 1000) / (now - windowStart))} fps · worst ${Math.round(worst)} ms`;
        frames = 0; worst = 0; windowStart = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 600);
  document.body.dataset.loadMs = String(Math.round(performance.now() - started));
  document.body.dataset.ready = '1';
}

boot().catch((err) => {
  console.error(err);
  const l = document.getElementById('loading-label');
  if (l) l.textContent = `Something went wrong: ${err}`;
});
