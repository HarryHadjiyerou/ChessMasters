import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { analyse } from '../src/ai/engine';
import { pickSuggestion } from '../src/game/tactics';

const play = (moves: string[]) => { const c = new Chess(); for (const m of moves) c.move(m); return c.fen(); };
const suggest = (fen: string, book: { from: string; to: string } | null = null) => {
  const a = analyse(fen, { timeMs: 2500, extra: book ? [book] : [] });
  return { a, pick: pickSuggestion(fen, a.candidates, book) };
};

describe('coach analysis (foresight)', () => {
  it("does not fall for Légal's trap: never takes the queen when it leads to mate", () => {
    const fen = play(['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5']);
    const { a, pick } = suggest(fen);
    expect(a.depth).toBeGreaterThanOrEqual(4);
    expect(pick?.san).not.toBe('Bxd1');
  }, 20_000);

  it('does not suggest a Bishop grabbing a pawn defended by a pawn', () => {
    const fen = 'rnbqkbnr/ppp2ppp/4p3/3p4/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 3';
    expect(suggest(fen).pick?.san).not.toBe('Bxd5');
  }, 20_000);

  it('finds a back-rank mate', () => {
    const { a } = suggest('3r2k1/5ppp/8/8/8/8/5PPP/3QR1K1 w - - 0 1');
    expect(a.best.san).toBe('Qxd8#');
  }, 20_000);

  it('gives the expected next two moves for the plan', () => {
    const { a } = suggest(new Chess().fen());
    expect(a.line).toHaveLength(2);
    const c = new Chess(); c.move(a.best.san);
    for (const m of a.line) expect(() => c.move(m)).not.toThrow();
  }, 20_000);

  it('rejects a book move the engine shows to be a blunder', () => {
    // After 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4? the book-like "Nxe5" falls into Qg5 tricks; any pick must be near-best.
    const fen = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4']);
    const { a, pick } = suggest(fen, { from: 'f3', to: 'e5' });
    const best = a.candidates[0].score;
    expect(pick!.score).toBeGreaterThanOrEqual(best - 40);
  }, 20_000);
});
