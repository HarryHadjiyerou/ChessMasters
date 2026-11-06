import * as THREE from 'three';
import { ease, lerp, lerpAngle, type Timeline } from '../util/timeline';
import type { PieceActor } from './PieceActor';

// Piece motion built on the Timeline (so every step is skippable). Real pieces play their
// clips (walk, attack, defeat); placeholders, or real pieces missing a clip, use procedural
// motion: hops, lunges, flinches, tumbles and cheers.

const STEP_TIME = 0.32; // seconds per square when walking/hopping
const TURN_TIME = 0.16;

export function yawTowards(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export async function turnTo(tl: Timeline, a: PieceActor, yaw: number, time = TURN_TIME): Promise<void> {
  const start = a.root.rotation.y;
  await tl.tween(time, (t) => { a.root.rotation.y = lerpAngle(start, yaw, t); });
}

/** Walk (real) or hop (placeholder) in a straight line to `to`. */
export async function travel(tl: Timeline, a: PieceActor, to: THREE.Vector3, opts: { faceBack?: boolean; speed?: number } = {}): Promise<void> {
  const from = a.root.position.clone();
  const dist = from.distanceTo(to);
  if (dist < 1e-3) return;
  const speed = opts.speed ?? 1;
  await turnTo(tl, a, yawTowards(from, to), TURN_TIME / speed);
  const time = Math.min(1.4, Math.max(0.3, dist * STEP_TIME)) / speed;
  const usesClip = a.real && a.has('move');
  // Each piece has its own walk (and pace); knights gallop.
  if (usesClip) void a.play(dist > 2.5 && a.has('run') && !a.centaur ? 'run' : 'move', { loop: true, fade: 0.12, timeScale: (a.roles.speed ?? 1) * Math.max(1, speed * 0.8) });
  a.gait = 1;
  const hops = Math.max(1, Math.round(dist));
  a.idleBob = usesClip;
  await tl.tween(time, (t) => {
    a.root.position.lerpVectors(from, to, t);
    if (!usesClip) {
      const hp = (t * hops) % 1;
      a.lift = Math.sin(hp * Math.PI) * 0.16;
      const sq = t >= 1 ? 1 : 1 + 0.1 * Math.cos(hp * Math.PI * 2);
      a.rig.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    }
  }, ease.linear);
  a.lift = 0;
  a.gait = 0;
  a.rig.scale.set(1, 1, 1);
  a.idleBob = true;
  if (usesClip) a.toIdle();
  if (opts.faceBack !== false) await turnTo(tl, a, a.homeYaw, TURN_TIME / speed);
}

/** Knight: one high arc with a spin of anticipation and a squashy landing. */
export async function leap(tl: Timeline, a: PieceActor, to: THREE.Vector3, opts: { faceBack?: boolean; speed?: number } = {}): Promise<void> {
  const from = a.root.position.clone();
  const speed = opts.speed ?? 1;
  await turnTo(tl, a, yawTowards(from, to), TURN_TIME / speed);
  a.idleBob = false;
  // Real knights gallop into the jump (legs keep galloping in the air).
  if (a.real && a.has('move')) void a.play('move', { loop: true, fade: 0.12 });
  a.gait = 1;
  await tl.tween(0.12 / speed, (t) => { const s = 1 - 0.18 * t; a.rig.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s)); });
  await tl.tween(0.55 / speed, (t) => {
    a.root.position.lerpVectors(from, to, t);
    a.lift = Math.sin(t * Math.PI) * 0.95;
    const s = 1 + 0.12 * Math.sin(t * Math.PI);
    a.rig.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    a.rig.rotation.x = Math.sin(t * Math.PI * 2) * 0.25;
  }, ease.inOut);
  a.lift = 0;
  a.rig.rotation.x = 0;
  await tl.tween(0.16 / speed, (t) => { const s = 1 - 0.2 * Math.sin(t * Math.PI); a.rig.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s)); });
  a.rig.scale.set(1, 1, 1);
  a.idleBob = true;
  a.gait = 0;
  if (a.real) a.toIdle();
  if (opts.faceBack !== false) await turnTo(tl, a, a.homeYaw, TURN_TIME / speed);
}

/**
 * Attack with this piece's own move (its variant from the casting sheet; `alt` takes the next
 * one). Spell casters (bishops, dark queen) throw a fireball: `fireball(from, to)` resolves when
 * it lands. `onImpact` fires at the moment of contact.
 */
export async function attack(tl: Timeline, a: PieceActor, target: THREE.Vector3, onImpact: () => void,
  opts: { short?: boolean; alt?: boolean; fireball?: (from: THREE.Vector3, to: THREE.Vector3) => Promise<void> } = {}): Promise<void> {
  const name = a.real ? a.clipFor('attack', a.variant + (opts.alt ? 1 : 0)) : null;
  if (name) {
    const dur = a.clipDuration(name);
    const spell = a.isSpell(name) && !!opts.fireball;
    const fit = opts.short ? 0.5 : spell ? 1.45 : 1.25;
    const timeScale = Math.max(1, dur / fit);
    const playing = a.playClip(name, { timeScale, fade: 0.1 });
    await tl.wait((dur / timeScale) * (spell ? 0.45 : 0.42));
    if (spell && !tl.skipped) await opts.fireball!(a.handPosition(), target.clone().setY(a.height * 0.45));
    onImpact();
    if (tl.skipped) { a.toIdle(); return; }
    await Promise.race([playing, tl.wait((dur / timeScale) * 0.35)]);
    a.toIdle();
    return;
  }
  const origin = a.root.position.clone();
  const dir = target.clone().sub(origin).setY(0).normalize();
  a.idleBob = false;
  const k = opts.short ? 0.6 : 1;
  await tl.tween(0.22 * k, (t) => { a.rig.rotation.x = -0.35 * t; a.root.position.copy(origin).addScaledVector(dir, -0.12 * t); });
  await tl.tween(0.1 * k, (t) => { a.rig.rotation.x = lerp(-0.35, 0.45, t); a.root.position.copy(origin).addScaledVector(dir, lerp(-0.12, 0.3, t)); }, ease.in);
  onImpact();
  await tl.tween(0.25 * k, (t) => { a.rig.rotation.x = lerp(0.45, 0, t); a.root.position.copy(origin).addScaledVector(dir, lerp(0.3, 0, t)); }, ease.out);
  a.rig.rotation.x = 0;
  a.idleBob = true;
}

/** Hit reaction: a knock-back wobble (none of the Meshy files has a hit clip). */
export async function flinch(tl: Timeline, a: PieceActor, from: THREE.Vector3, short = false): Promise<void> {
  const origin = a.root.position.clone();
  const away = origin.clone().sub(from).setY(0).normalize();
  a.idleBob = false;
  await tl.tween(short ? 0.18 : 0.32, (t) => {
    const k = Math.sin(t * Math.PI);
    a.root.position.copy(origin).addScaledVector(away, 0.18 * k);
    a.rig.rotation.z = Math.sin(t * Math.PI * 5) * 0.18 * (1 - t);
    a.rig.rotation.x = -0.4 * k;
    const s = 1 - 0.15 * k;
    a.rig.scale.set(1 + 0.12 * k, s, 1 + 0.12 * k);
  }, ease.out);
  a.rig.rotation.set(0, 0, 0);
  a.rig.scale.set(1, 1, 1);
  a.root.position.copy(origin);
}

/** Cartoon defeat: dizzy wobble then tumble (or the real fall clip, cut short) ending in a poof. */
export async function defeat(tl: Timeline, a: PieceActor, onPoof: () => void, short = false): Promise<void> {
  a.idleBob = false;
  if (!short && a.real && a.has('defeat')) {
    // The king's fall clip is long and realistic, so it is sped up and cut by the poof
    // before he hits the ground: it reads as a cartoon "knocked silly", never as a death.
    void a.play('defeat', { timeScale: 1.6, fade: 0.1 });
    await tl.wait(0.55);
  } else if (!short) {
    await tl.tween(0.45, (t) => {
      a.rig.rotation.z = Math.sin(t * Math.PI * 4) * 0.25 * (1 - t * 0.5);
      a.rig.rotation.x = -0.15 * t;
    }, ease.linear);
    await tl.tween(0.25, (t) => {
      a.rig.rotation.x = lerp(-0.15, -1.3, t);
      const s = 1 - 0.3 * t;
      a.rig.scale.set(1 + 0.2 * t, s, 1 + 0.2 * t);
    }, ease.in);
  }
  onPoof();
  await tl.tween(short ? 0.08 : 0.12, (t) => { a.rig.scale.setScalar(Math.max(0.001, 1 - t)); });
  a.root.visible = false;
}

/** Victory after a capture: this piece's own celebration clip (knights also rear up),
 *  or a double hop with a little spin for placeholders. */
export async function cheer(tl: Timeline, a: PieceActor, short = false): Promise<void> {
  if (a.real && a.has('victory')) {
    const rearing = a.centaur && !short ? tl.tween(0.8, (t) => { a.rear = Math.sin(t * Math.PI); }) : null;
    await Promise.race([a.play('victory', { timeScale: short ? 2 : 1.25 }), tl.wait(short ? 0.5 : 0.9)]);
    await rearing;
    a.rear = 0;
    a.toIdle();
    return;
  }
  a.idleBob = false;
  const hops = short ? 1 : 2;
  const startYaw = a.root.rotation.y;
  await tl.tween(short ? 0.3 : 0.7, (t) => {
    const hp = (t * hops) % 1;
    a.lift = Math.sin(hp * Math.PI) * 0.28;
    const s = 1 + 0.15 * Math.sin(hp * Math.PI);
    a.rig.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    if (!short) a.root.rotation.y = startYaw + t * Math.PI * 2;
  }, ease.linear);
  a.lift = 0;
  a.rig.scale.set(1, 1, 1);
  a.root.rotation.y = startYaw;
  a.idleBob = true;
}

/** Resets any procedural pose (used after a skip). */
export function settle(a: PieceActor): void {
  a.lift = 0;
  a.gait = 0;
  a.rear = 0;
  a.rig.rotation.set(0, 0, 0);
  a.rig.scale.set(1, 1, 1);
  a.idleBob = true;
  a.toIdle();
}
