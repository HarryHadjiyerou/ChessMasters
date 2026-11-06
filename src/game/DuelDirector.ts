import * as THREE from 'three';
import type { Stage } from '../scene/Stage';
import type { Effects } from '../fx/effects';
import type { PieceActor } from '../pieces/PieceActor';
import { attack, cheer, defeat, flinch, leap, settle, travel, turnTo, yawTowards } from '../pieces/motion';
import { ease, lerp, Timeline } from '../util/timeline';
import { sound } from '../audio/sound';

// Capture duels. The chess result is already decided (the capturer always wins); this is
// presentation only. Full ~3-5 s, Short <= 1.5 s, Off = instant poof. Any click, tap or Space
// calls skip(), which collapses the whole sequence to its end state within a frame.

export type DuelMode = 'full' | 'short' | 'off';

export interface DuelRequest {
  attacker: PieceActor;
  defender: PieceActor;
  /** Where the attacker ends (the capture square; differs from defender square for en passant). */
  to: THREE.Vector3;
  knight: boolean;
}

const ZOOM = 1.8;

export class DuelDirector {
  readonly tl = new Timeline();
  private active = false;
  lastDurationMs = 0;

  private readonly unsubscribe: () => void;
  /** Duration of the last duel in animation time (immune to frame stalls, e.g. screenshots). */
  lastAnimSeconds = 0;
  private animSeconds = 0;

  constructor(private readonly stage: Stage, private readonly fx: Effects) {
    this.unsubscribe = stage.onUpdate((dt) => {
      if (this.active) this.animSeconds += dt;
      this.tl.update(dt);
    });
  }

  dispose(): void {
    this.tl.skip();
    this.unsubscribe();
  }

  get playing(): boolean { return this.active; }

  /** Called once per duel at the moment of impact (set by the game before each duel). */
  onImpact: (() => void) | null = null;

  private impact(): void {
    const f = this.onImpact;
    this.onImpact = null;
    f?.();
  }

  skip(): void {
    if (this.active) this.tl.skip();
  }

  async play(mode: DuelMode, req: DuelRequest): Promise<void> {
    const { attacker: A, defender: D } = req;
    const started = performance.now();
    this.animSeconds = 0;
    this.active = true;
    this.tl.reset();
    try {
      if (mode === 'off') await this.instant(req);
      else await this.sequence(mode === 'short', req);
    } finally {
      // Guarantee the end state whatever happened (skip, error).
      D.root.visible = false;
      A.root.position.copy(req.to);
      A.root.rotation.y = A.homeYaw;
      settle(A);
      this.setFocus(0);
      this.stage.camera.resetView();
      this.impact(); // skipped before contact: still report it
      this.active = false;
      this.tl.reset();
      this.lastDurationMs = performance.now() - started;
      this.lastAnimSeconds = this.animSeconds;
    }
  }

  /** Off: the attacker moves normally; the defender poofs on contact. */
  private async instant(req: DuelRequest): Promise<void> {
    const { attacker: A, defender: D } = req;
    const poofed = () => {
      this.impact();
      sound.play('poof');
      this.fx.poof(D.root.position, D.height * 0.8);
      D.root.visible = false;
    };
    if (req.knight) await leap(this.tl, A, req.to);
    else await travel(this.tl, A, req.to);
    if (D.root.visible) poofed();
  }

  private async sequence(short: boolean, req: DuelRequest): Promise<void> {
    const { attacker: A, defender: D } = req;
    const tl = this.tl;
    const dPos = D.root.position.clone();

    // 1. Punch-in towards the pair.
    const mid = A.root.position.clone().lerp(dPos, 0.5).setY(0.6);
    if (!short) await this.punch(mid, 1, 0.38);

    // Pick the move now: spell casters stay where they are and throw a fireball instead.
    const alt = !short && Math.random() < 0.35; // mostly the signature move, sometimes the second
    const ranged = A.real && A.isSpell(A.clipFor('attack', A.variant + (alt ? 1 : 0)));

    // 2. Approach: stop just short of the defender, facing it; defender turns to meet it.
    const approachDir = dPos.clone().sub(A.root.position).setY(0);
    const dist = approachDir.length();
    approachDir.normalize();
    // Stop just outside the defender's square (pieces never overlap; attack clips are locked in place).
    const stand = dPos.clone().addScaledVector(approachDir, -Math.min(dist, 0.98));
    const faceAttacker = turnTo(tl, D, yawTowards(dPos, A.root.position), short ? 0.1 : 0.2);
    if (dist > 0.7 && !ranged) {
      sound.play('whoosh', 0.7);
      if (req.knight) await leap(tl, A, stand, { faceBack: false, speed: short ? 2.2 : 1.5 });
      else await travel(tl, A, stand, { faceBack: false, speed: short ? 2.6 : 1.3 });
    }
    await faceAttacker;
    await turnTo(tl, A, yawTowards(A.root.position, dPos), short ? 0.05 : 0.1);

    // 3. Attack; on impact the defender reacts, gets dizzy and poofs.
    let reaction: Promise<void> = Promise.resolve();
    await attack(tl, A, dPos, () => {
      this.impact();
      if (!tl.skipped) sound.play('hit');
      this.fx.sparkles(dPos.clone().setY(D.height * 0.6), short ? 6 : 10, 0xfff0b0, 0.8);
      reaction = (async () => {
        await flinch(tl, D, A.root.position, short);
        if (!short) this.fx.dizzy(dPos.clone().setY(D.height + 0.12), 0.9, 0.22);
        await defeat(tl, D, () => { sound.play('poof'); this.fx.poof(dPos, Math.max(0.7, D.height * 0.8)); }, short);
      })();
    }, {
      short,
      alt,
      fireball: async (from, to) => {
        sound.play('whoosh');
        const fb = this.fx.fireball(A.colour === 'w' ? 'ruby' : 'amethyst');
        await tl.tween(short ? 0.18 : 0.38, (t) => fb.set(from, to, t), ease.inOut);
        fb.explode();
      },
    });
    await reaction;

    // 4. Attacker takes the square and celebrates.
    await travel(tl, A, req.to, { faceBack: false, speed: short ? 3.5 : ranged ? 2.4 : 1.8 });
    await turnTo(tl, A, A.homeYaw, short ? 0.06 : 0.12);
    if (!short) await cheer(tl, A);

    // 5. Punch-out.
    if (!short) await this.punch(mid, 0, 0.32);
  }

  /** Zooms the whole composite (3D + both plates) around a world point. `k` 0 = board, 1 = full zoom. */
  private async punch(focusWorld: THREE.Vector3, target: number, time: number): Promise<void> {
    const cam = this.stage.camera;
    const W = cam.imageWidth, H = cam.imageHeight;
    // Zoom relative to the resting view (the whole image on menus, the board close-up in a game).
    const home = cam.homeView ?? { x: 0, y: 0, w: W, h: H };
    const hcx = home.x + home.w / 2, hcy = home.y + home.h / 2;
    const [fx, fy] = cam.toImagePx(this.stage.boardRoot.localToWorld(focusWorld.clone()));
    const startK = (home.w / cam.viewRect.w - 1) / (ZOOM - 1);
    await this.tl.tween(time, (t) => {
      const k = lerp(startK, target, t);
      const scale = 1 + (ZOOM - 1) * k;
      const w = home.w / scale, h = home.h / scale;
      const x = Math.min(Math.max(lerp(hcx, fx, k) - w / 2, 0), W - w);
      const y = Math.min(Math.max(lerp(hcy, fy, k) - h / 2, 0), H - h);
      cam.setView({ x, y, w, h });
      this.setFocus(k, fx / W, fy / H);
    }, ease.inOut);
  }

  private setFocus(k: number, cx = 0.5, cy = 0.5): void {
    const u = this.stage.composite.material.uniforms;
    u.uFocus.value = k;
    u.uFocusCentre.value.set(cx, cy);
    u.uFocusRadius.value = 0.22;
  }
}
