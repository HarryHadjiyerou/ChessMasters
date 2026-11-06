import type { GameEvent } from './events';
import type { Colour } from './rules';
import { formatClock } from './clock';

// Data-driven challenge rules (public/data/challenges.json). A tracker listens to game events,
// keeps a few stats, fails the challenge as soon as a fail condition is met, and grades the
// result (0-3 stars) at the end. New challenges are new JSON entries, no code.

export type Op = '<' | '<=' | '>' | '>=' | '==';
export interface Condition { stat: string; op: Op; value: number }
export interface ProgressDef { label: string; stat: string; target: number; format: 'count' | 'time' | 'safe' }
export interface ChallengeDef {
  id: string;
  name: string;
  description: string;
  /** Medallion icon name (see src/ui/icons.ts); optional. */
  icon?: string;
  pointsPerStar: number;
  goals: Condition[];
  failWhen: Condition[];
  stars: Condition[][]; // extra conditions for star 2, star 3
  progress: ProgressDef[];
}

export type ChallengeStatus = 'active' | 'failed' | 'complete';

export interface ChallengeOutcome { status: ChallengeStatus; stars: number; points: number; reason: string }

const PIECES = ['p', 'n', 'b', 'r', 'q'];

export function evaluate(c: Condition, stats: Record<string, number>): boolean {
  const v = stats[c.stat] ?? 0;
  switch (c.op) {
    case '<': return v < c.value;
    case '<=': return v <= c.value;
    case '>': return v > c.value;
    case '>=': return v >= c.value;
    case '==': return v === c.value;
  }
}

export class ChallengeTracker {
  readonly stats: Record<string, number> = { playerMoves: 0, playerTimeMs: 0, promotions: 0, checksGiven: 0, lostTotal: 0 };
  status: ChallengeStatus = 'active';
  outcome: ChallengeOutcome | null = null;
  failReason = '';

  constructor(readonly def: ChallengeDef, readonly player: Colour) {
    for (const p of PIECES) { this.stats[`captured.${p}`] = 0; this.stats[`lost.${p}`] = 0; }
  }

  handle(e: GameEvent): void {
    if (this.outcome) return;
    const s = this.stats;
    switch (e.type) {
      case 'move':
        if (e.move.colour === this.player) s.playerMoves++;
        break;
      case 'capture': {
        const t = e.move.captured!;
        if (e.move.colour === this.player) s[`captured.${t}`]++;
        else { s[`lost.${t}`]++; s.lostTotal++; }
        break;
      }
      case 'promotion':
        if (e.move.colour === this.player) s.promotions++;
        break;
      case 'check':
        if (e.colour !== this.player) s.checksGiven++;
        break;
      case 'clock':
        s.playerTimeMs = e.usedMs[this.player];
        break;
      case 'end': {
        const won = e.result.winner === this.player;
        this.finish(won);
        return;
      }
      default:
        return;
    }
    if (this.status === 'active') {
      const hit = this.def.failWhen.find((c) => evaluate(c, s));
      if (hit) { this.status = 'failed'; this.failReason = this.describeFail(hit); }
    }
  }

  private describeFail(c: Condition): string {
    if (c.stat === 'playerMoves') return `More than ${c.value} moves`;
    if (c.stat === 'playerTimeMs') return 'Your clock passed the limit';
    if (c.stat.startsWith('lost.')) return 'Your piece was captured';
    return 'Challenge failed';
  }

  private finish(won: boolean): void {
    let stars = 0, reason = '';
    if (this.status === 'failed') reason = this.failReason;
    else if (!won) reason = 'You need to win the game';
    else if (!this.def.goals.every((c) => evaluate(c, this.stats))) reason = 'Goal not reached';
    else {
      stars = 1;
      for (const tier of this.def.stars) { if (tier.every((c) => evaluate(c, this.stats))) stars++; else break; }
      reason = 'Challenge complete!';
    }
    this.status = stars > 0 ? 'complete' : 'failed';
    this.outcome = { status: this.status, stars, points: stars * this.def.pointsPerStar, reason };
  }

  /** Live progress lines for the HUD. */
  progress(): { label: string; text: string; done: boolean }[] {
    return this.def.progress.map((p) => {
      const v = this.stats[p.stat] ?? 0;
      if (p.format === 'time') return { label: p.label, text: `${formatClock(v)} / ${formatClock(p.target)}`, done: false };
      if (p.format === 'safe') return { label: p.label, text: v === 0 ? 'Yes' : 'Lost', done: v === 0 };
      return { label: p.label, text: `${v} / ${p.target}`, done: v >= p.target && p.stat !== 'playerMoves' };
    });
  }
}

export async function loadChallenges(): Promise<ChallengeDef[]> {
  try {
    const d = await fetch('data/challenges.json').then((r) => r.json());
    return d.challenges as ChallengeDef[];
  } catch {
    return [];
  }
}
