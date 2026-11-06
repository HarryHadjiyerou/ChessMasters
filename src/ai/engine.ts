import { Chess } from 'chess.js';
import { B, Board, K, N, P, Q, R, mFrom, mPromo, mTo, sqName } from './board0x88';

// Compact chess engine: negamax alpha-beta on a fast 0x88 board (board0x88.ts, perft-tested),
// MVV-LVA move ordering, quiescence search on captures and promotions, iterative deepening
// under a time limit, material + piece-square evaluation. chess.js is used only to read the
// position and to name the chosen move.
// Difficulty = search depth + choosing among near-best moves, so weaker levels make believable
// second-best choices rather than random blunders.

export type Level = 'beginner' | 'easy' | 'medium' | 'hard' | 'coach';
/** Levels a player can choose as an opponent ('coach' is for hints only). */
export type PlayLevel = Exclude<Level, 'coach'>;

interface LevelProfile { depth: number; qDepth: number; marginCp: number; timeMs: number }

export const LEVELS: Record<Level, LevelProfile> = {
  beginner: { depth: 1, qDepth: 4, marginCp: 140, timeMs: 300 },
  easy: { depth: 2, qDepth: 6, marginCp: 60, timeMs: 600 },
  medium: { depth: 3, qDepth: 8, marginCp: 18, timeMs: 1200 },
  hard: { depth: 6, qDepth: 10, marginCp: 0, timeMs: 2000 },
  // Hints and guidance: always the best move found, a little quicker than Hard.
  // Hints and guidance: every root move gets a true score (full window, tiny margin) so the
  // coach can compare a suggestion against the best; always plays the best itself.
  coach: { depth: 4, qDepth: 10, marginCp: 1, timeMs: 1600 },
};

const VALUE = [0, 100, 320, 330, 500, 900, 0];
const MATE = 100_000;

// Piece-square tables from White's point of view, a8 first (index = (7 - rank) * 8 + file).
const PST: number[][] = [];
PST[P] = [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0];
PST[N] = [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50];
PST[B] = [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20];
PST[R] = [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0];
PST[Q] = [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20];
PST[K] = [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20];
const K_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

/** Static evaluation in centipawns from the side to move's point of view. */
export function evaluateBoard(b: Board): number {
  const sq = b.sq;
  let nonPawn = 0;
  for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const t = Math.abs(sq[s]); if (t >= N && t <= Q) nonPawn += VALUE[t]; }
  const endgame = nonPawn <= 1300 * 2;
  let score = 0;
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const p = sq[s];
    if (!p) continue;
    const t = Math.abs(p), rank = s >> 4, file = s & 7;
    const idx = p > 0 ? (7 - rank) * 8 + file : rank * 8 + file;
    const v = VALUE[t] + (t === K && endgame ? K_END[idx] : PST[t][idx]);
    score += p > 0 ? v : -v;
  }
  return score * b.side;
}

export function evaluate(chess: Chess): number {
  return evaluateBoard(new Board(chess.fen()));
}

class Search {
  nodes = 0;
  aborted = false;
  private deadline = Infinity;
  private killers: number[][] = Array.from({ length: 64 }, () => [0, 0]);

  constructor(private readonly b: Board, private readonly qDepth: number) {}

  setDeadline(t: number): void { this.deadline = t; }

  private timeUp(): boolean {
    if ((this.nodes & 1023) === 0 && performance.now() > this.deadline) this.aborted = true;
    return this.aborted;
  }

  order(moves: number[], ply: number): void {
    const b = this.b;
    const k = this.killers[ply] ?? [0, 0];
    const key = (m: number) => {
      const victim = b.capturedBy(m);
      let s = 0;
      if (victim) s += 10_000 + 10 * VALUE[victim] - VALUE[Math.abs(b.sq[mFrom(m)])];
      if (mPromo(m)) s += 9_000 + VALUE[mPromo(m)];
      if (m === k[0] || m === k[1]) s += 5_000;
      return s;
    };
    const keys = new Map<number, number>();
    for (const m of moves) keys.set(m, key(m));
    moves.sort((x, y) => keys.get(y)! - keys.get(x)!);
  }

  quiesce(alpha: number, beta: number, depth: number, ply: number): number {
    this.nodes++;
    const stand = evaluateBoard(this.b);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (depth <= 0 || this.timeUp()) return alpha;
    const moves: number[] = [];
    this.b.pseudo(moves, true);
    this.order(moves, ply);
    for (const m of moves) {
      if (!this.b.make(m)) continue;
      const s = -this.quiesce(-beta, -alpha, depth - 1, ply + 1);
      this.b.unmake();
      if (s >= beta) return beta;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }

  negamax(depth: number, alpha: number, beta: number, ply: number): number {
    this.nodes++;
    if (this.timeUp()) return 0;
    if (ply > 0 && this.b.half >= 100) return 0;
    const inCheck = this.b.inCheck();
    if (depth <= 0 && !inCheck) return this.quiesce(alpha, beta, this.qDepth, ply);
    const moves: number[] = [];
    this.b.pseudo(moves);
    this.order(moves, ply);
    let best = -Infinity, legal = 0;
    for (const m of moves) {
      if (!this.b.make(m)) continue;
      legal++;
      const s = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      this.b.unmake();
      if (this.aborted) return 0;
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) {
        if (!this.b.capturedBy(m)) { const k = this.killers[ply]; if (k && k[0] !== m) { k[1] = k[0]; k[0] = m; } }
        break;
      }
    }
    if (legal === 0) return inCheck ? -MATE + ply : 0;
    return best;
  }
}

export interface RankedMove { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n'; score: number }
export interface EngineResult { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n'; san: string; score: number; depth: number; nodes: number; ms: number; ranked: RankedMove[] }

const PROMO = ['', '', 'n', 'b', 'r', 'q'] as const;

/** Picks a move for the side to move. `rng` is injectable for deterministic tests. */
export function chooseMove(fen: string, level: Level, rng: () => number = Math.random): EngineResult {
  const start = performance.now();
  const profile = LEVELS[level];
  const board = new Board(fen);
  const search = new Search(board, profile.qDepth);
  const roots = board.legal();
  if (roots.length === 0) throw new Error('No legal moves');
  search.order(roots, 0);
  let scored = roots.map((m) => ({ m, s: 0 }));
  let completedDepth = 0;
  search.setDeadline(start + profile.timeMs);

  for (let depth = 1; depth <= profile.depth; depth++) {
    const results: { m: number; s: number }[] = [];
    let alpha = -Infinity;
    for (const { m } of scored) {
      board.make(m);
      // Hard only needs the best move: a null window around alpha proves the rest worse.
      // Weaker levels score every root move fully so near-best alternatives are known.
      let s: number;
      if (profile.marginCp === 0 && alpha > -Infinity) {
        s = -search.negamax(depth - 1, -alpha - 1, -alpha, 1);
        if (s > alpha && !search.aborted) s = -search.negamax(depth - 1, -Infinity, -s + 1, 1);
        else s = Math.min(s, alpha - 1); // only an upper bound: strictly worse than the best
      } else {
        s = -search.negamax(depth - 1, -Infinity, Infinity, 1);
      }
      board.unmake();
      if (search.aborted) break;
      results.push({ m, s });
      if (s > alpha) alpha = s;
    }
    if (search.aborted && completedDepth > 0) {
      // Partial iteration: keep it only if it already found something better than the old best.
      const best = results.sort((a, b) => b.s - a.s)[0];
      if (best && best.s > scored[0].s && best.m !== scored[0].m) scored = [best, ...scored.filter((x) => x.m !== best.m)];
      break;
    }
    const rest = scored.filter((x) => !results.some((r) => r.m === x.m)).map((x) => ({ m: x.m, s: -Infinity }));
    scored = [...results, ...rest].sort((a, b) => b.s - a.s);
    completedDepth = depth;
    if (search.aborted || scored[0].s > MATE - 1000) break;
  }

  const bestScore = scored[0].s;
  let pick = scored[0];
  if (profile.marginCp > 0 && bestScore < MATE - 1000) {
    const near = scored.filter((x) => x.s >= bestScore - profile.marginCp);
    const weights = near.map((x) => Math.exp((x.s - bestScore) / (profile.marginCp / 2)));
    let r = rng() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < near.length; i++) { r -= weights[i]; if (r <= 0) { pick = near[i]; break; } }
  } else {
    const equal = scored.filter((x) => x.s === bestScore);
    pick = equal[Math.floor(rng() * equal.length)];
  }

  const from = sqName(mFrom(pick.m)), to = sqName(mTo(pick.m));
  const promotion = mPromo(pick.m) ? PROMO[mPromo(pick.m)] as EngineResult['promotion'] : undefined;
  const san = new Chess(fen).move({ from, to, promotion }).san;
  const ranked: RankedMove[] = scored.filter((x) => x.s > -Infinity).slice(0, 12).map((x) => ({
    from: sqName(mFrom(x.m)), to: sqName(mTo(x.m)),
    promotion: mPromo(x.m) ? PROMO[mPromo(x.m)] as RankedMove['promotion'] : undefined, score: x.s,
  }));
  return { from, to, promotion, san, score: pick.s, depth: completedDepth, nodes: search.nodes, ms: Math.round(performance.now() - start), ranked };
}

// ---------------------------------------------------------------------------------------------
// Coach analysis: a full-strength search for the best move, exact scores for the alternatives
// worth considering (so a suggestion can be checked against the best), and the expected line
// for the next few moves (so the coach can explain a plan, not just one move).

export interface AnalysedMove { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n'; san: string; score: number }
export interface Analysis {
  best: AnalysedMove;
  /** Exactly-scored candidates (best first), all at the same depth. */
  candidates: AnalysedMove[];
  /** Expected continuation after `best`, in SAN, e.g. ['Nc6', 'Bc4']. */
  line: string[];
  depth: number;
  ms: number;
}

const toUci = (m: number) => ({ from: sqName(mFrom(m)), to: sqName(mTo(m)), promotion: mPromo(m) ? PROMO[mPromo(m)] as AnalysedMove['promotion'] : undefined });

/** Best move with a null-window (PVS) root search, iterative deepening to the time limit. */
function bestMove(board: Board, search: Search, maxDepth: number, deadline: number): { m: number; s: number; depth: number; order: number[] } {
  let order = board.legal();
  search.order(order, 0);
  let best = { m: order[0], s: 0 }, depth = 0;
  search.aborted = false;
  search.setDeadline(deadline);
  for (let d = 1; d <= maxDepth; d++) {
    let alpha = -Infinity, iterBest = best;
    const scores = new Map<number, number>();
    for (const m of order) {
      board.make(m);
      let s: number;
      if (alpha > -Infinity) {
        s = -search.negamax(d - 1, -alpha - 1, -alpha, 1);
        if (s > alpha && !search.aborted) s = -search.negamax(d - 1, -Infinity, -s + 1, 1);
      } else s = -search.negamax(d - 1, -Infinity, Infinity, 1);
      board.unmake();
      if (search.aborted) break;
      scores.set(m, s);
      if (s > alpha) { alpha = s; iterBest = { m, s }; }
    }
    if (search.aborted) { if (scores.size && iterBest.s > best.s && d > 1) best = iterBest; break; }
    best = iterBest; depth = d;
    order = [best.m, ...order.filter((x) => x !== best.m)];
    if (best.s > MATE - 1000) break;
  }
  return { m: best.m, s: best.s, depth, order };
}

export function analyse(fen: string, opts: { timeMs?: number; maxDepth?: number; extra?: { from: string; to: string }[]; count?: number } = {}): Analysis {
  const start = performance.now();
  const timeMs = opts.timeMs ?? 2500;
  const board = new Board(fen);
  if (!board.legal().length) throw new Error('No legal moves');
  const search = new Search(board, 10);
  // 1. Best move: 55% of the time.
  const b = bestMove(board, search, opts.maxDepth ?? 7, start + timeMs * 0.55);
  const d = Math.max(1, b.depth);
  // 2. Candidates: best, any extra (book) moves, then the next in search order. Each gets an
  //    exact (full-window) score at depth d-1 so they can be compared fairly.
  const extras = (opts.extra ?? []).map((x) => b.order.find((m) => sqName(mFrom(m)) === x.from && sqName(mTo(m)) === x.to)).filter((m): m is number => m !== undefined);
  const pool = [...new Set([b.m, ...extras, ...b.order])].slice(0, opts.count ?? 8);
  const cDepth = Math.max(1, d - 1);
  search.aborted = false;
  search.setDeadline(start + timeMs * 0.85);
  const scored: { m: number; s: number }[] = [];
  for (const m of pool) {
    board.make(m);
    const s = -search.negamax(cDepth - 1, -Infinity, Infinity, 1);
    board.unmake();
    if (search.aborted) break;
    scored.push({ m, s });
  }
  if (!scored.some((x) => x.m === b.m)) scored.unshift({ m: b.m, s: b.s });
  scored.sort((x, y) => y.s - x.s);
  // 3. Expected line: opponent's best reply, then our best follow-up (quick searches).
  const line: string[] = [];
  const chess = new Chess(fen);
  const named = (m: number) => { const u = toUci(m); return { ...u, san: chess.move(u).san }; };
  const bestNamed = named(b.m);
  board.make(b.m);
  for (let ply = 0; ply < 2; ply++) {
    if (!board.legal().length) break;
    const r = bestMove(board, search, Math.max(2, d - 2), performance.now() + timeMs * 0.07);
    line.push(named(r.m).san);
    board.make(r.m);
  }
  const fresh = new Chess(fen);
  const candidates = scored.map((x) => {
    const u = toUci(x.m);
    const san = fresh.move(u).san;
    fresh.undo();
    return { ...u, san, score: x.s };
  });
  return { best: { ...bestNamed, score: b.s }, candidates, line, depth: d, ms: Math.round(performance.now() - start) };
}
