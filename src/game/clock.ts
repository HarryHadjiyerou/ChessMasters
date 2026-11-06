import type { Colour } from './rules';

// Chess clock. Time only runs for the side to move, and never while any pause reason is
// active (duels, promotion choice, menus). Pure logic: the game feeds it real elapsed time.

export class ChessClock {
  readonly initialMs: number | null;
  private remaining: Record<Colour, number>;
  private used: Record<Colour, number> = { w: 0, b: 0 };
  private active: Colour | null = null;
  private readonly pauses = new Set<string>();
  flagged: Colour | null = null;

  /** `initialMs` null = untimed (time used is still counted, for challenges). */
  constructor(initialMs: number | null) {
    this.initialMs = initialMs;
    this.remaining = { w: initialMs ?? Infinity, b: initialMs ?? Infinity };
  }

  get running(): boolean { return this.active !== null && this.pauses.size === 0 && !this.flagged; }
  get activeSide(): Colour | null { return this.active; }
  isPaused(reason?: string): boolean { return reason ? this.pauses.has(reason) : this.pauses.size > 0; }

  start(side: Colour): void { this.active = side; }
  stop(): void { this.active = null; }
  /** Called after a move completes. */
  switchTo(side: Colour): void { this.active = side; }

  pause(reason: string): void { this.pauses.add(reason); }
  resume(reason: string): void { this.pauses.delete(reason); }

  /** Advances by real elapsed milliseconds. Returns the side that ran out of time, if any. */
  tick(ms: number): Colour | null {
    if (!this.running || ms <= 0) return null;
    const side = this.active!;
    this.used[side] += ms;
    if (this.initialMs !== null) {
      this.remaining[side] = Math.max(0, this.remaining[side] - ms);
      if (this.remaining[side] === 0) { this.flagged = side; return side; }
    }
    return null;
  }

  remainingMs(side: Colour): number { return this.remaining[side]; }
  usedMs(side: Colour): number { return this.used[side]; }

  restore(state: { remaining: Record<Colour, number>; used: Record<Colour, number> }): void {
    this.remaining = { ...state.remaining };
    this.used = { ...state.used };
  }
  snapshot(): { remaining: Record<Colour, number>; used: Record<Colour, number> } {
    return { remaining: { ...this.remaining }, used: { ...this.used } };
  }
}

export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
