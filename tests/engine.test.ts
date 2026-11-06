import { describe, expect, it } from 'vitest';
import { chooseMove, evaluate, type Level } from '../src/ai/engine';
import { Chess } from 'chess.js';

const LEVELS: Level[] = ['beginner', 'easy', 'medium', 'hard'];

describe('engine', () => {
  it('evaluates the start position as roughly level', () => {
    expect(Math.abs(evaluate(new Chess()))).toBeLessThan(30);
  });

  it('finds mate in one at every level', () => {
    // Scholar's mate pattern: Qxf7#
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    for (const level of LEVELS) expect(chooseMove(fen, level).san).toBe('Qxf7#');
  });

  it('takes a hanging queen at medium and hard', () => {
    const fen = 'rnb1kbnr/pppp1ppp/8/4p3/3qP3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 1'.replace('2N5', '5N2');
    // White knight on f3 attacks the black queen on d4.
    for (const level of ['medium', 'hard'] as Level[]) expect(chooseMove(fen, level).san).toBe('Nxd4');
  }, 30_000);

  it('does not throw away its queen at beginner level', () => {
    // Black to move; the queen is attacked by a pawn. Beginner must still move it to safety.
    const fen = 'rnb1kbnr/pppp1ppp/8/4p3/4q3/3P4/PPP2PPP/RNBQKBNR b KQkq - 0 3';
    for (let i = 0; i < 20; i++) {
      const r = chooseMove(fen, 'beginner');
      const c = new Chess(fen);
      c.move({ from: r.from, to: r.to, promotion: r.promotion });
      const attacked = c.moves({ verbose: true }).some((m) => m.captured === 'q');
      expect(attacked, `beginner left its queen en prise with ${r.san}`).toBe(false);
    }
  });

  it('weaker levels vary their moves from the start position', () => {
    const picks = new Set(Array.from({ length: 12 }, () => chooseMove(new Chess().fen(), 'beginner').san));
    expect(picks.size).toBeGreaterThan(1);
  });

  it('returns a legal move within its time budget', () => {
    const fen = 'r2q1rk1/ppp2ppp/2np1n2/2b1p1B1/2B1P1b1/2NP1N2/PPP2PPP/R2Q1RK1 w - - 0 8';
    for (const level of LEVELS) {
      const r = chooseMove(fen, level);
      expect(new Chess(fen).moves().includes(r.san)).toBe(true);
      expect(r.ms).toBeLessThan(4000);
      console.log(level, r.san, 'depth', r.depth, 'nodes', r.nodes, 'ms', r.ms);
    }
  }, 30_000);
});
