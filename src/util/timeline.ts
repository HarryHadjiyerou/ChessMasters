// Small in-house tween/timeline helper (no tween library).
//
// A Timeline owns every tween and wait it starts. `skip()` finishes all of them on the spot
// (each tween jumps to t = 1), and anything started afterwards completes immediately, so a
// whole async sequence (e.g. a duel) collapses to its end state within one frame.

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t * t,
  outBack: (t: number) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  outElastic: (t: number) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};

interface Active { elapsed: number; duration: number; fn: (t: number) => void; ease: Ease; resolve: () => void }

export class Timeline {
  private active = new Set<Active>();
  private _skipped = false;
  speed = 1;

  get skipped(): boolean { return this._skipped; }

  update(dt: number): void {
    for (const a of [...this.active]) {
      a.elapsed += dt * this.speed;
      const t = Math.min(1, a.elapsed / a.duration);
      a.fn(a.ease(t));
      if (t >= 1) { this.active.delete(a); a.resolve(); }
    }
  }

  tween(seconds: number, fn: (t: number) => void, e: Ease = ease.inOut): Promise<void> {
    if (this._skipped || seconds <= 0) { fn(1); return Promise.resolve(); }
    return new Promise((resolve) => {
      const a: Active = { elapsed: 0, duration: seconds, fn, ease: e, resolve };
      fn(e(0));
      this.active.add(a);
    });
  }

  wait(seconds: number): Promise<void> {
    return this.tween(seconds, () => undefined, ease.linear);
  }

  /** Finishes everything now and makes all later steps instant. */
  skip(): void {
    this._skipped = true;
    for (const a of [...this.active]) { a.fn(1); this.active.delete(a); a.resolve(); }
  }

  /** Ready for a new sequence. */
  reset(): void {
    this._skipped = false;
  }

  get busy(): boolean { return this.active.size > 0; }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Shortest-path angle interpolation. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
