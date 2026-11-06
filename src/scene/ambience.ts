import * as THREE from 'three';
import type { MatchedCamera } from './MatchedCamera';
import { HALF_BOARD } from './boardLayout';

// Slow petals and warm dust motes drawn on a 2D canvas over the scene. They live in image
// space, never enter the board or the space above it, and follow duel punch-ins.
// Every so often a gust sweeps through, themed per arena: a sand blast across the Arabian
// Palace, a blizzard in the Frozen Kingdom, ember bursts from the Dark Kingdom's braziers,
// falling leaves in the Jungle Temple and a petal breeze in the Palace Gardens. Gust
// particles may cross the board, but faintly there so the pieces stay easy to see.

interface Mote { x: number; y: number; vx: number; vy: number; r: number; phase: number; petal: boolean; spin: number }

const COUNT = 34;
const PIECE_HEIGHT = 2.2; // world units above the board kept clear

function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function inside(poly: [number, number][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export type AmbienceKind = 'petals' | 'embers' | 'snow' | 'fireflies' | 'dust';

/** One particle of a gust. */
interface GustPart { x: number; y: number; vx: number; vy: number; r: number; delay: number; life: number; age: number; spin: number; vspin: number; col: string; alpha?: number; shape: 'streak' | 'flake' | 'spark' | 'leaf' | 'petal' }
interface Gust { age: number; dur: number; parts: GustPart[]; haze: string | null; dir: 1 | -1; clouds: GustPart[] }

/** Seconds between gusts (random in this range); the first comes sooner. */
const GUST_GAP: [number, number] = [9, 16];
const KIND_COUNT: Record<AmbienceKind, number> = { petals: COUNT, embers: 30, snow: 80, fireflies: 26, dust: 40 };

/** Big soft puffs of sand or snow rolling across with a gust (alpha scaled by `opacity`). */
function cloudParts(n: number, dir: 1 | -1, W: number, H: number, col: string, speed: number, opacity: number): GustPart[] {
  const R = Math.random;
  return Array.from({ length: n }, () => ({
    x: dir > 0 ? -200 - R() * 300 : W + 200 + R() * 300, y: H * (0.2 + R() * 0.8), vx: dir * speed * (0.8 + R() * 0.5), vy: -10 + R() * 20,
    r: 110 + R() * 160, delay: R() * 1.4, life: 4, age: 0, spin: 0, vspin: 0, col, alpha: opacity, shape: 'flake' as const,
  }));
}

export class Ambience {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly motes: Mote[] = [];
  private readonly keepOut: [number, number][];
  private readonly W: number;
  private readonly H: number;
  enabled = true;
  private gust: Gust | null = null;
  private nextGust = 3 + Math.random() * 3;
  /** Called when a wind-type gust starts (the stage plays a gust of wind). */
  onGust: ((kind: AmbienceKind) => void) | null = null;

  constructor(private readonly camera: MatchedCamera, readonly kind: AmbienceKind = 'petals', private readonly sources: [number, number, number][] = []) {
    this.canvas.className = 'ambience';
    this.ctx = this.canvas.getContext('2d')!;
    this.W = camera.imageWidth;
    this.H = camera.imageHeight;
    const m = HALF_BOARD + 0.9;
    const pts: [number, number][] = [];
    for (const [x, z] of [[-m, -m], [m, -m], [m, m], [-m, m]]) {
      for (const y of [0, PIECE_HEIGHT]) pts.push(camera.toImagePx(new THREE.Vector3(x, y, z)));
    }
    this.keepOut = convexHull(pts);
    for (let i = 0; i < KIND_COUNT[kind]; i++) this.motes.push(this.spawn(true));
  }

  private spawn(anywhere: boolean): Mote {
    const k = this.kind;
    const R = Math.random;
    for (;;) {
      const petal = k === 'petals' && R() < 0.35;
      const m: Mote = {
        x: R() * this.W,
        y: anywhere ? R() * this.H : k === 'embers' ? this.H + 10 : -10,
        vx: k === 'snow' ? -4 + R() * 8 : k === 'dust' ? 22 + R() * 18 : k === 'fireflies' ? -5 + R() * 10 : k === 'embers' ? -3 + R() * 6 : 6 + R() * 10,
        vy: k === 'snow' ? 14 + R() * 14 : k === 'embers' ? -(10 + R() * 12) : k === 'fireflies' ? -4 + R() * 8 : k === 'dust' ? -2 + R() * 4 : petal ? 10 + R() * 8 : -2 + R() * 4,
        r: k === 'snow' ? 1 + R() * 1.8 : petal ? 2.2 + R() * 1.6 : 0.8 + R() * 1.2,
        phase: R() * Math.PI * 2,
        petal,
        spin: R() * Math.PI,
      };
      if (k === 'dust' && !anywhere) { m.x = -10; m.y = R() * this.H; }
      if (!inside(this.keepOut, m.x, m.y)) return m;
    }
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  /** Builds the arena's gust: a burst of themed particles that sweeps through and fades. */
  private makeGust(): Gust {
    const R = Math.random, W = this.W, H = this.H;
    const dir: 1 | -1 = R() < 0.5 ? 1 : -1;
    const parts: GustPart[] = [];
    const add = (n: number, f: () => Partial<GustPart>) => {
      for (let i = 0; i < n; i++) parts.push({ x: 0, y: 0, vx: 0, vy: 0, r: 1, delay: 0, life: 3, age: 0, spin: R() * 6, vspin: 0, col: '255,255,255', shape: 'streak', ...f() });
    };
    const edgeX = () => (dir > 0 ? -40 - R() * 120 : W + 40 + R() * 120);
    switch (this.kind) {
      case 'dust': { // sand blast across the arena, low and fast, with rolling clouds of sand
        add(130, () => ({ x: edgeX(), y: H * (0.1 + R() * 0.9), vx: dir * (800 + R() * 700), vy: -40 + R() * 80, r: 1.6 + R() * 2.4, delay: R() * 1.6, life: 4, col: R() < 0.5 ? '232,188,124' : '196,146,84' }));
        const clouds = cloudParts(7, dir, W, H, '206,158,96', 560, 0.2);
        return { age: 0, dur: 3.6, parts, haze: '226,186,128', dir, clouds };
      }
      case 'snow': { // blizzard: a wall of driving snow
        add(140, () => ({ x: edgeX(), y: -60 + R() * H, vx: dir * (500 + R() * 500), vy: 140 + R() * 180, r: 2 + R() * 3.5, delay: R() * 1.8, life: 4, shape: R() < 0.65 ? 'flake' : 'streak' }));
        const clouds = cloudParts(6, dir, W, H, '246,250,255', 600, 0.18);
        return { age: 0, dur: 3.8, parts, haze: '235,245,255', dir, clouds };
      }
      case 'embers': { // sparks bursting out of a brazier
        const pick = () => (this.sources.length ? this.sources[Math.floor(R() * this.sources.length)] : [W * R(), H * 0.9, 40]);
        for (const src of [pick(), pick()]) {
          add(70, () => ({ x: src[0] + (R() - 0.5) * src[2] * 0.6, y: src[1], vx: (R() - 0.5) * 200, vy: -(200 + R() * 300), r: 1.5 + R() * 2.2, delay: R() * 0.6, life: 1.4 + R() * 1.6, col: R() < 0.7 ? '255,170,70' : '200,130,255', shape: 'spark' }));
        }
        return { age: 0, dur: 3.2, parts, haze: null, dir, clouds: [] };
      }
      case 'fireflies': // jungle leaves tumbling down on the breeze
        add(34, () => ({ x: dir > 0 ? -60 + R() * W * 0.5 : W * 0.5 + R() * W * 0.6, y: -40 - R() * H * 0.4, vx: dir * (120 + R() * 140), vy: 70 + R() * 70, r: 3.5 + R() * 3, delay: R() * 2, life: 7, vspin: (R() - 0.5) * 6, col: ['96,170,60', '140,190,70', '200,170,60'][Math.floor(R() * 3)], shape: 'leaf' }));
        return { age: 0, dur: 7, parts, haze: null, dir, clouds: [] };
      default: // petal breeze
        add(70, () => ({ x: edgeX(), y: H * R() * 0.9, vx: dir * (260 + R() * 220), vy: 20 + R() * 50, r: 2.2 + R() * 1.8, delay: R() * 1.8, life: 6, vspin: (R() - 0.5) * 8, col: R() < 0.7 ? '255,196,205' : '255,235,240', shape: 'petal' }));
        return { age: 0, dur: 5, parts, haze: null, dir, clouds: [] };
    }
  }

  private drawGust(g: Gust, dt: number, t: number, v: { x: number; y: number }, sx: number, sy: number): void {
    const { ctx, canvas } = this;
    g.age += dt;
    // Haze band sweeping across with the gust (sand / snow): soft, never hides the board.
    if (g.haze) {
      const k = Math.min(1, g.age / g.dur);
      const fade = Math.sin(Math.PI * k);
      const cx = (g.dir > 0 ? -0.4 + 1.8 * k : 1.4 - 1.8 * k) * canvas.width;
      const band = ctx.createLinearGradient(cx - canvas.width * 0.45, 0, cx + canvas.width * 0.45, 0);
      band.addColorStop(0, `rgba(${g.haze}, 0)`);
      band.addColorStop(0.5, `rgba(${g.haze}, ${0.14 * fade})`);
      band.addColorStop(1, `rgba(${g.haze}, 0)`);
      ctx.fillStyle = band;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // Rolling clouds (sand, snow): big soft puffs travelling with the gust.
    for (const c of g.clouds) {
      if (g.age < c.delay) continue;
      c.age += dt;
      if (c.age > c.life) continue;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      // Clouds thin out over the board so the pieces stay clear.
      const a = Math.min(1, c.age / 0.6, (c.life - c.age) / 0.9) * (c.alpha ?? 1) * (inside(this.keepOut, c.x, c.y) ? 0.35 : 1);
      const px = (c.x - v.x) * sx, py = (c.y - v.y) * sy, r = c.r * sx;
      const puff = ctx.createRadialGradient(px, py, 0, px, py, r);
      puff.addColorStop(0, `rgba(${c.col}, ${a})`);
      puff.addColorStop(1, `rgba(${c.col}, 0)`);
      ctx.fillStyle = puff;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
    for (const p of g.parts) {
      if (g.age < p.delay) continue;
      p.age += dt;
      if (p.age > p.life) continue;
      if (p.shape === 'spark') p.vy += 90 * dt; // sparks slow and drift
      p.x += (p.vx + (p.shape === 'leaf' || p.shape === 'petal' ? Math.sin(t * 2 + p.spin) * 40 : 0)) * dt;
      p.y += p.vy * dt;
      p.spin += p.vspin * dt;
      const px = (p.x - v.x) * sx, py = (p.y - v.y) * sy;
      if (px < -60 || py < -60 || px > canvas.width + 60 || py > canvas.height + 60) continue;
      // Fade in and out over the particle's life, and keep it faint over the board.
      let a = Math.min(1, p.age / 0.25, (p.life - p.age) / 0.6);
      if (inside(this.keepOut, p.x, p.y)) a *= 0.25;
      if (a <= 0) continue;
      const r = p.r * sx;
      ctx.save();
      ctx.translate(px, py);
      if (p.shape === 'streak') {
        const len = Math.hypot(p.vx, p.vy) * 0.05 * sx;
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.strokeStyle = `rgba(${p.col}, ${0.6 * a})`;
        ctx.lineWidth = r;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(0, 0); ctx.stroke();
      } else if (p.shape === 'flake' || p.shape === 'spark') {
        const flick = p.shape === 'spark' ? 0.6 + 0.4 * Math.sin(t * 30 + p.spin * 7) : 1;
        ctx.fillStyle = `rgba(${p.col}, ${0.9 * a * flick})`;
        if (p.shape === 'spark') { ctx.shadowColor = `rgba(${p.col}, 0.9)`; ctx.shadowBlur = r * 4; }
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.rotate(p.spin);
        ctx.scale(1, 0.35 + 0.55 * Math.abs(Math.sin(p.spin * 1.3)));
        ctx.fillStyle = `rgba(${p.col}, ${0.85 * a})`;
        ctx.beginPath();
        if (p.shape === 'leaf') { ctx.moveTo(-r * 1.6, 0); ctx.quadraticCurveTo(0, -r, r * 1.6, 0); ctx.quadraticCurveTo(0, r, -r * 1.6, 0); }
        else ctx.ellipse(0, 0, r, r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Starts the arena's gust now (also used by tests and screenshots). */
  triggerGust(): void {
    this.gust = this.makeGust();
    this.nextGust = GUST_GAP[0] + Math.random() * (GUST_GAP[1] - GUST_GAP[0]);
    if (this.kind !== 'embers') this.onGust?.(this.kind);
  }

  update(dt: number, t: number): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.enabled) return;
    const v = this.camera.viewRect;
    const sx = canvas.width / v.w, sy = canvas.height / v.h;
    this.nextGust -= dt;
    if (this.nextGust <= 0 && !this.gust) this.triggerGust();
    if (this.gust) {
      this.drawGust(this.gust, dt, t, v, sx, sy);
      if (this.gust.age > this.gust.dur + 3) this.gust = null;
    }
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      m.x += (m.vx + Math.sin(t * 0.7 + m.phase) * 6) * dt;
      m.y += (m.vy + Math.cos(t * 0.9 + m.phase) * 4) * dt;
      m.spin += dt * 1.5;
      const blocked = inside(this.keepOut, m.x, m.y);
      if (m.x > this.W + 20 || m.x < -20 || m.y > this.H + 20 || m.y < -20 || blocked) {
        this.motes[i] = this.spawn(false);
        if (!blocked && this.kind === 'petals') this.motes[i].x = Math.random() * this.W * 0.6;
        continue;
      }
      const px = (m.x - v.x) * sx, py = (m.y - v.y) * sy;
      const a = 0.35 + 0.25 * Math.sin(t * 1.3 + m.phase);
      ctx.save();
      ctx.translate(px, py);
      if (m.petal) {
        ctx.rotate(m.spin);
        ctx.scale(1, 0.45 + 0.35 * Math.abs(Math.sin(m.spin)));
        ctx.fillStyle = `rgba(255, 200, 205, ${a + 0.2})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, m.r * sx, m.r * 0.6 * sx, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const k = this.kind;
        const blink = k === 'fireflies' ? Math.max(0, Math.sin(t * 2.2 + m.phase * 3)) : 1;
        const r = m.r * sx * (k === 'snow' ? 1.6 : k === 'fireflies' ? 3.2 : 2.5);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        const col = k === 'snow' ? '255, 255, 255' : k === 'fireflies' ? '220, 255, 120' : k === 'dust' ? '235, 190, 130'
          : k === 'embers' ? (m.phase > Math.PI ? '190, 120, 255' : '255, 160, 80') : '255, 225, 160';
        const alpha = (k === 'snow' ? 0.85 : k === 'fireflies' ? 0.9 : a) * blink;
        g.addColorStop(0, `rgba(${col}, ${alpha})`);
        g.addColorStop(1, `rgba(${col}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}
