import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Colour, PieceType } from '../game/rules';
import { ROLES, type PieceRoles, type RealPieceSource, type Role } from './manifest';
import { createPlaceholder, PIECE_HEIGHT } from './placeholders';

// One piece on the board. Hierarchy:
//   root   - board position and facing (yaw)
//   rig    - procedural motion layer: hop height, squash/stretch, tilt, shake, rear-up
//   model  - real Meshy model (with AnimationMixer) or lathe placeholder
// Real pieces play clips by ROLE (public/data/animations.json). Lists of clips are per-piece
// variants: `variant` (pawn file 0-7, or 0/1 for queen's/king's side) picks one, so no two
// pieces mirror each other. Knights are centaurs: clips drive the rider while the four horse
// legs (leg_fl/fr/bl/br_*) gallop procedurally.

const MESHY_FORWARD_YAW = 0; // Meshy exports face +z (verified on every character's toes)

interface HorseLeg { bone: THREE.Bone; rest: THREE.Quaternion; axis: THREE.Vector3; seg: number; front: boolean; phase: number }
const LEG_PHASE: Record<string, number> = { fl: 0, fr: 0.12, bl: 0.5, br: 0.62 }; // gallop footfall order

export class PieceActor {
  readonly root = new THREE.Group();
  readonly rig = new THREE.Group();
  model!: THREE.Object3D;
  readonly hitProxy: THREE.Mesh;
  type!: PieceType;
  readonly colour: Colour;
  square: string;
  /** Which variant of each role list this piece uses. */
  readonly variant: number;
  /** Yaw that faces the opponent. */
  readonly homeYaw: number;
  real = false;
  centaur = false;
  height = 1;
  roles: PieceRoles = {};
  private mixer: THREE.AnimationMixer | null = null;
  private clips = new Map<string, THREE.AnimationClip>();
  private current: THREE.AnimationAction | null = null;
  private readonly phase = Math.random() * Math.PI * 2;
  private legs: HorseLeg[] = [];
  private gaitPhase = 0;
  /** 0..1: how much the horse legs gallop (set while travelling). */
  gait = 0;
  private gaitNow = 0;
  /** 0..1: knight rears up on its hind legs (celebrations). */
  rear = 0;
  /** Placeholder idle bob on/off (off while procedural animations drive the rig). */
  idleBob = true;
  /** 0..1 lift used by move/hop helpers; added to idle bob. */
  lift = 0;
  /** Bounces on the spot to say "move me!" (hint / coach suggestion). */
  hintBounce = false;
  private shakeT = -1;
  private limits: { action: THREE.AnimationAction; until: number; elapsed: number; finish: () => void }[] = [];

  /** Quick "no!" wobble for an invalid move. */
  shake(): void { this.shakeT = 0; }

  constructor(type: PieceType, colour: Colour, square: string, nearSide: Colour, envMap: THREE.Texture | null, real?: RealPieceSource, variant = 0) {
    this.colour = colour;
    this.square = square;
    this.variant = variant;
    // Pieces on the near edge face away from the camera (-z) towards the opponent.
    this.homeYaw = colour === nearSide ? Math.PI : 0;
    this.root.rotation.y = this.homeYaw;
    this.root.add(this.rig);
    this.root.name = `piece-${colour}${type}-${square}`;

    this.hitProxy = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1, 12), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitProxy.userData.actor = this;
    this.root.add(this.hitProxy);
    this.setModel(type, envMap, real);
  }

  setModel(type: PieceType, envMap: THREE.Texture | null, real?: RealPieceSource): void {
    if (this.model) this.rig.remove(this.model);
    this.mixer?.stopAllAction();
    this.type = type;
    this.height = ROLES?.heights[type] ?? PIECE_HEIGHT[type];
    this.mixer = null;
    this.current = null;
    this.clips = new Map();
    this.legs = [];
    this.roles = real?.roles ?? {};
    this.centaur = !!real?.centaur;
    if (real) {
      const m = cloneSkinned(real.scene);
      const s = this.height / real.height;
      const w = ROLES?.widths?.[type] ?? 1;
      m.scale.set(s * w, s, s * w);
      m.rotation.y = MESHY_FORWARD_YAW;
      m.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false; // skinned bounds don't follow clips
          const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat && envMap) { mat.envMap = envMap; mat.envMapIntensity = 0.6; }
        }
      });
      this.model = m;
      this.real = true;
      this.clips = real.clips;
      if (this.centaur) this.findHorseLegs(m);
      this.mixer = new THREE.AnimationMixer(m);
      this.toIdle(Math.random());
    } else {
      this.model = createPlaceholder(type, this.colour, envMap);
      this.real = false;
    }
    this.rig.add(this.model);
    this.hitProxy.scale.y = this.height;
    this.hitProxy.position.y = this.height / 2;
  }

  /** Horse leg bones and, for each, the bone-local axis matching the body's sideways axis. */
  private findHorseLegs(m: THREE.Object3D): void {
    m.updateMatrixWorld(true);
    const modelQ = m.getWorldQuaternion(new THREE.Quaternion()).invert();
    m.traverse((o) => {
      const r = /^leg_(fl|fr|bl|br)_(\d)$/.exec(o.name);
      if (!r || !(o as THREE.Bone).isBone || Number(r[2]) > 2) return;
      const wq = modelQ.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));
      const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(wq.invert()).normalize();
      this.legs.push({ bone: o as THREE.Bone, rest: o.quaternion.clone(), axis, seg: Number(r[2]), front: r[1][0] === 'f', phase: LEG_PHASE[r[1]] });
    });
  }

  /** Clip name for a role (variant picks from lists). */
  clipFor(role: Role, pick?: number): string | null {
    const v = this.roles[role as keyof PieceRoles];
    if (!v) return null;
    if (typeof v === 'string') return this.clips.has(v) ? v : null;
    if (!Array.isArray(v) || !v.length) return null;
    const name = v[(pick ?? this.variant) % v.length];
    return this.clips.has(name) ? name : null;
  }

  has(role: Role): boolean { return !!this.clipFor(role); }

  clipDuration(name: string): number { return this.clips.get(name)?.duration ?? 0; }

  isSpell(name: string | null): boolean { return !!name && !!ROLES?.spellClips.includes(name); }

  /** Plays the clip cast for a role. Resolves false if this piece has none (caller falls back). */
  play(role: Role, opts: PlayOpts & { pick?: number } = {}): Promise<boolean> {
    const name = this.clipFor(role, opts.pick);
    return name ? this.playClip(name, opts) : Promise.resolve(false);
  }

  /**
   * Plays a clip by name. Resolves when a one-shot clip ends (or after `maxSeconds`), or
   * immediately for loops.
   */
  playClip(name: string, opts: PlayOpts = {}): Promise<boolean> {
    const clip = this.clips.get(name);
    if (!clip || !this.mixer) return Promise.resolve(false);
    const a = this.mixer.clipAction(clip);
    a.reset();
    a.setLoop(opts.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = opts.clamp ?? !opts.loop;
    a.timeScale = opts.timeScale ?? 1;
    if (opts.offset) a.time = opts.offset * clip.duration;
    a.enabled = true;
    a.setEffectiveWeight(1);
    const fade = opts.fade ?? 0.2;
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, fade, false);
    a.play();
    this.current = a;
    if (opts.loop && !opts.maxSeconds) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.mixer?.removeEventListener('finished', onDone);
        this.limits = this.limits.filter((l) => l.action !== a);
        resolve(true);
      };
      const onDone = (e: { action: THREE.AnimationAction }) => { if (e.action === a) finish(); };
      this.mixer!.addEventListener('finished', onDone);
      // The limit is in animation time, so slow frames never cut a clip short.
      if (opts.maxSeconds) this.limits.push({ action: a, until: opts.maxSeconds, elapsed: 0, finish });
    });
  }

  /** Name of the clip currently playing (or null). */
  currentClip(): string | null { return this.current?.getClip().name ?? null; }

  /** Returns to the idle loop (e.g. after a one-shot clip or a skipped duel). */
  toIdle(offset = 0): void {
    if (!this.real) return;
    if (!this.has('idle')) { this.mixer?.stopAllAction(); this.current = null; return; }
    void this.play('idle', { loop: true, fade: 0.25, offset });
  }

  /** Right hand position (spells) in the pieces' own (board) space; chest height if no hand bone. */
  handPosition(): THREE.Vector3 {
    const hand = this.model.getObjectByName('hand_r') ?? this.model.getObjectByName('hand_l');
    const w = hand ? hand.getWorldPosition(new THREE.Vector3()) : this.root.localToWorld(new THREE.Vector3(0, this.height * 0.6, 0.2));
    return this.root.parent ? this.root.parent.worldToLocal(w) : w;
  }

  update(dt: number, t: number): void {
    this.mixer?.update(dt);
    for (const l of [...this.limits]) {
      l.elapsed += dt; // animation time (dt is already clamped per frame)
      if (l.elapsed >= l.until || !l.action.isRunning()) l.finish();
    }
    const bounce = this.hintBounce ? 0.12 * Math.abs(Math.sin(t * 5.5)) : 0;
    if (!this.real && this.idleBob) {
      this.rig.position.y = 0.012 * (1 + Math.sin(t * 2.1 + this.phase)) + this.lift + bounce;
      const breathe = 1 + 0.012 * Math.sin(t * 2.1 + this.phase + 0.6);
      this.rig.scale.set(1 / Math.sqrt(breathe), breathe, 1 / Math.sqrt(breathe));
    } else {
      this.rig.position.y = this.lift + bounce;
    }
    if (this.legs.length) this.updateHorseLegs(dt);
    this.keepAboveFloor();
    if (this.shakeT >= 0) {
      this.shakeT += dt;
      const k = Math.max(0, 1 - this.shakeT / 0.42);
      this.rig.rotation.z = Math.sin(this.shakeT * 48) * 0.16 * k;
      this.rig.position.x = Math.sin(this.shakeT * 48) * 0.05 * k;
      if (k === 0) { this.shakeT = -1; this.rig.rotation.z = 0; this.rig.position.x = 0; }
    }
  }

  private floorBones: THREE.Object3D[] | null = null;
  private floorLift = 0;

  /**
   * Some clips (flips, handstands, falls) were made for other bodies and would push hands, head
   * or feet through the board. While such a clip plays, lift the model so its lowest point stays
   * on the board (it rises as it flips, like a real flip), then settle back.
   */
  private keepAboveFloor(): void {
    if (!this.real) return;
    const name = this.current?.getClip().name;
    const active = !!name && name !== this.clipFor('idle') && name !== this.clipFor('move') && name !== this.clipFor('run');
    if (!active && this.floorLift === 0) return;
    let target = 0;
    if (active) {
      this.floorBones ??= ['foot_l', 'foot_r', 'ball_l', 'ball_r', 'hand_l', 'hand_r', 'head', 'pelvis', 'spine_03']
        .map((n) => this.model.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
      this.model.position.y = 0;
      this.root.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      let low = Infinity;
      for (const b of this.floorBones) low = Math.min(low, this.root.worldToLocal(b.getWorldPosition(v)).y);
      // Bones sit inside the body, so allow a small margin before lifting.
      if (low < -0.02) target = -low - 0.02;
    }
    this.floorLift += (target - this.floorLift) * (target > this.floorLift ? 1 : 0.15);
    if (Math.abs(this.floorLift) < 1e-3 && target === 0) this.floorLift = 0;
    this.model.position.y = this.floorLift + (this.centaur ? 0.05 * this.rear : 0);
  }

  /** Procedural gallop and rear-up for the centaurs' horse legs (no clips drive these bones). */
  private updateHorseLegs(dt: number): void {
    this.gaitNow += (this.gait - this.gaitNow) * Math.min(1, dt * 8);
    this.gaitPhase = (this.gaitPhase + dt * 2.6) % 1;
    const q = new THREE.Quaternion();
    for (const l of this.legs) {
      const p = (this.gaitPhase + l.phase) * Math.PI * 2;
      let a = 0;
      if (l.seg === 0) a = Math.sin(p) * 0.55;
      else if (l.seg === 1) a = (l.front ? 1 : -1) * Math.max(0, Math.sin(p + 0.9)) * 0.75;
      else a = Math.sin(p + 1.6) * 0.35;
      a *= this.gaitNow;
      if (this.rear > 0 && l.front) a += this.rear * (l.seg === 0 ? -0.9 : l.seg === 1 ? 1.3 : 0.4);
      l.bone.quaternion.copy(l.rest).multiply(q.setFromAxisAngle(l.axis, a));
    }
    // Rear-up pivots the whole body back over the hind hooves.
    this.model.rotation.x = -0.45 * this.rear;
    this.model.position.z = -0.12 * this.rear;
    this.model.position.y = 0.05 * this.rear;
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
  }
}

export interface PlayOpts { loop?: boolean; fade?: number; timeScale?: number; offset?: number; clamp?: boolean; maxSeconds?: number }
