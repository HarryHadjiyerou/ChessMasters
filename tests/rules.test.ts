import { describe, expect, it } from 'vitest';
import { GameRules } from '../src/game/rules';

describe('rules wrapper', () => {
  it('starts with 32 pieces and 20 legal moves for white', () => {
    const g = new GameRules();
    expect(g.pieces()).toHaveLength(32);
    const total = g.pieces().filter((p) => p.colour === 'w').reduce((n, p) => n + g.legalTargets(p.square).length, 0);
    expect(total).toBe(20);
  });

  it('rejects illegal moves without throwing', () => {
    const g = new GameRules();
    expect(g.move('e2', 'e5')).toBeNull();
    expect(g.move('e7', 'e5')).toBeNull(); // not black's turn
    expect(g.move('e2', 'e4')?.san).toBe('e4');
  });

  it('castles both sides and reports the rook move', () => {
    const g = new GameRules('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const ks = g.move('e1', 'g1')!;
    expect(ks.san).toBe('O-O');
    expect(ks.castle).toEqual({ rookFrom: 'h1', rookTo: 'f1', side: 'king' });
    const qs = g.move('e8', 'c8')!;
    expect(qs.san).toBe('O-O-O');
    expect(qs.castle).toEqual({ rookFrom: 'a8', rookTo: 'd8', side: 'queen' });
    expect(g.pieceAt('f1')?.type).toBe('r');
    expect(g.pieceAt('d8')?.type).toBe('r');
  });

  it('does not allow castling through check', () => {
    const g = new GameRules('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1'); // f2 rook attacks f1
    expect(g.legalTargets('e1').map((t) => t.to)).not.toContain('g1');
  });

  it('handles en passant and reports the captured square', () => {
    const g = new GameRules('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const t = g.legalTargets('e5').find((x) => x.to === 'd6');
    expect(t?.capture).toBe(true);
    const m = g.move('e5', 'd6')!;
    expect(m.enPassant).toBe(true);
    expect(m.captured).toBe('p');
    expect(m.capturedSquare).toBe('d5');
    expect(g.pieceAt('d5')).toBeNull();
  });

  it('promotes to the chosen piece', () => {
    const g = new GameRules('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    expect(g.isPromotionMove('a7', 'a8')).toBe(true);
    const m = g.move('a7', 'a8', 'n')!;
    expect(m.promotion).toBe('n');
    expect(g.pieceAt('a8')).toEqual({ square: 'a8', type: 'n', colour: 'w' });
  });

  it('detects checkmate (Scholar’s Mate)', () => {
    const g = new GameRules();
    for (const [f, t] of [['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'], ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7']]) {
      expect(g.move(f, t)).not.toBeNull();
    }
    expect(g.status()).toEqual({ over: true, reason: 'checkmate', winner: 'w' });
    expect(g.history().at(-1)).toBe('Qxf7#');
  });

  it('detects stalemate', () => {
    const g = new GameRules('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(g.status()).toEqual({ over: true, reason: 'stalemate', winner: null });
  });

  it('detects threefold repetition', () => {
    const g = new GameRules();
    const shuffle = [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']];
    for (let i = 0; i < 2; i++) for (const [f, t] of shuffle) g.move(f, t);
    expect(g.status()).toEqual({ over: true, reason: 'repetition', winner: null });
  });

  it('detects the 50-move rule', () => {
    const g = new GameRules('4k3/8/8/8/8/8/8/R3K3 w - - 99 80');
    g.move('a1', 'a2');
    expect(g.status()).toEqual({ over: true, reason: 'fifty-move', winner: null });
  });

  it('detects insufficient material', () => {
    expect(new GameRules('4k3/8/8/8/8/8/8/4KB2 w - - 0 1').status()).toEqual({ over: true, reason: 'insufficient-material', winner: null });
  });

  it('undoes moves', () => {
    const g = new GameRules();
    g.move('e2', 'e4');
    expect(g.undo()).toBe(true);
    expect(g.pieceAt('e2')?.type).toBe('p');
    expect(g.undo()).toBe(false);
  });

  it('exports PGN with headers', () => {
    const g = new GameRules();
    g.move('e2', 'e4');
    const pgn = g.pgn({ Event: 'Chess Masters' });
    expect(pgn).toContain('[Event "Chess Masters"]');
    expect(pgn).toContain('1. e4');
  });
});
