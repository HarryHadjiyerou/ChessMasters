import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { detectTactics, explainMove, hangingPieces, mateThreats } from '../src/game/tactics';
import { bookMove, currentOpening, openingForMove, openingJustReached } from '../src/game/openings';

const ids = (fen: string, from: string, to: string, history: string[] = []) => detectTactics(fen, { from, to }, history).map((t) => t.id);

function play(moves: string[]): { fen: string; history: string[] } {
  const c = new Chess();
  for (const m of moves) c.move(m);
  return { fen: c.fen(), history: c.history() };
}

describe('tactic detection', () => {
  it('finds a knight fork of king and rook', () => {
    expect(ids('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'd5', 'c7')).toContain('fork');
  });
  it('finds a royal fork (king and queen)', () => {
    expect(ids('4k3/8/8/3N4/8/8/q7/4K3 w - - 0 1', 'd5', 'c7')).not.toContain('royal-fork');
    expect(ids('r3k3/8/q7/3N4/8/8/8/4K3 w - - 0 1', 'd5', 'c7')).toContain('royal-fork');
  });
  it('does not call it a fork when the forking piece is simply lost', () => {
    // Knight c7 attacked by the queen d8 and undefended, and not giving check.
    expect(ids('r2qk3/8/8/3N4/8/8/8/R3K3 w - - 0 1', 'd5', 'b6')).not.toContain('fork');
  });
  it('finds an absolute pin', () => {
    expect(ids('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', 'f1', 'b5')).toContain('pin');
  });
  it('finds a skewer', () => {
    expect(ids('4q3/8/8/8/4k3/8/8/R6K w - - 0 1', 'a1', 'e1')).toContain('skewer');
  });
  it('finds discovered and double checks', () => {
    expect(ids('4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', 'e4', 'c5')).toContain('discovered-check');
    expect(ids('4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', 'e4', 'f6')).toContain('double-check');
  });
  it('names checkmates', () => {
    expect(ids('6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', 'g5', 'f7')).toEqual(['smothered-mate']);
    expect(ids('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1', 'a8')).toEqual(['back-rank-mate']);
    const s = play(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6']);
    expect(ids(s.fen, 'h5', 'f7', s.history)).toEqual(['scholars-mate']);
    const f = play(['f3', 'e5', 'g4']);
    expect(ids(f.fen, 'd8', 'h4', f.history)).toEqual(['fools-mate']);
  });
  it('recognises castling, en passant and promotion', () => {
    expect(ids('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1', 'g1')).toContain('castling');
    expect(ids('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5', 'd6')).toContain('en-passant');
    expect(detectTactics('8/P6k/8/8/8/8/8/K7 w - - 0 1', { from: 'a7', to: 'a8', promotion: 'n' }).map((t) => t.id)).toContain('underpromotion');
  });
  it('announces an opening when its line is completed', () => {
    const s = play(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(ids(s.fen, 'f1', 'c4', s.history)).toContain('opening:Italian Game');
  });
});

describe('threats', () => {
  it('lists hanging pieces, most valuable first', () => {
    const c = new Chess('4k3/8/8/3q4/8/2N5/8/4K2B b - - 0 1');
    // Black queen d5 attacked by the c3 knight (cheaper) and the h1 bishop.
    expect(hangingPieces(c, 'b')[0]).toEqual({ square: 'd5', type: 'q' });
  });
  it('spots a threatened checkmate', () => {
    // White threatens Qxf7# (queen h5 + bishop c4) with Black to move.
    const s = play(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5']);
    expect(mateThreats(s.fen)).toContain('Qxf7#');
  });
});

describe('openings', () => {
  it('names the opening being played', () => {
    expect(currentOpening(['e4', 'c5'])?.name).toBe('Sicilian Defence');
    expect(currentOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'])?.name).toBe('Italian Game');
    expect(openingJustReached(['d4', 'd5', 'c4'])?.name).toBe("Queen's Gambit");
  });
  it('suggests legal book moves that continue a named line', () => {
    const b = bookMove(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(b?.san).toBe('Bc4');
    const c = new Chess();
    for (const m of ['e4', 'e5', 'Nf3', 'Nc6']) c.move(m);
    expect(() => c.move(b!.san)).not.toThrow();
    expect(bookMove(['h4', 'a5'])).toBeNull();
  });
  it('explains a book move by the opening it reaches, not a deeper line', () => {
    expect(openingForMove([], 'e4')?.name).toBe("King's Pawn Opening");
    expect(openingForMove(['e4', 'e5', 'Nf3', 'Nc6'], 'Bc4')?.name).toBe('Italian Game');
    expect(openingForMove(['e4'], 'c5')?.name).toBe('Sicilian Defence');
  });
});

describe('explanations', () => {
  it('explains captures, checks and escapes in plain English', () => {
    expect(explainMove('4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1', { from: 'd1', to: 'd5' })).toMatch(/free piece/);
    expect(explainMove('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', { from: 'a1', to: 'a8' })).toMatch(/Check/);
    // Knight on c3 attacked by a pawn: moving it is "to safety".
    expect(explainMove('4k3/8/8/8/1p6/2N5/8/4K3 w - - 0 1', { from: 'c3', to: 'e4' })).toMatch(/safety/);
  });
  it('uses the opening idea for book moves', () => {
    const s = play(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(explainMove(s.fen, { from: 'f1', to: 'c4' }, s.history, { name: 'Italian Game', idea: 'aims at f7' })).toMatch(/Italian Game/);
  });
});

import { isSafeSuggestion, pickSuggestion } from '../src/game/tactics';

describe('coach suggestions are safe', () => {
  it('never recommends a Bishop grabbing a pawn that a pawn recaptures', () => {
    // White bishop c4 can take on d5, but the e6 pawn recaptures.
    const fen = 'rnbqkbnr/ppp2ppp/4p3/3p4/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 3';
    expect(isSafeSuggestion(fen, { from: 'c4', to: 'd5' })).toBe(false);
    const ranked = [{ from: 'c4', to: 'd5', score: 10 }, { from: 'c4', to: 'b3', score: 5 }];
    expect(pickSuggestion(fen, ranked, null)).toMatchObject({ from: 'c4', to: 'b3' });
  });
  it('allows a fair trade and any checkmate', () => {
    expect(isSafeSuggestion('4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1', { from: 'd1', to: 'd5' })).toBe(true);
    expect(isSafeSuggestion('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', { from: 'h5', to: 'f7' })).toBe(true);
  });
  it('rejects a move that leaves another piece hanging', () => {
    // Knight e5 is attacked by the e8 rook and guarded only by the d4 pawn; d4-d5 abandons it.
    const fen = '4r1k1/8/8/4N3/3P4/8/8/6K1 w - - 0 1';
    expect(isSafeSuggestion(fen, { from: 'd4', to: 'd5' })).toBe(false);
  });
  it('prefers a safe book move but drops it if the engine dislikes it', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
    const ranked = [{ from: 'b8', to: 'c6', score: 20 }, { from: 'g8', to: 'f6', score: 15 }, { from: 'f7', to: 'f6', score: -80 }];
    expect(pickSuggestion(fen, ranked, { from: 'g8', to: 'f6' })).toMatchObject({ to: 'f6', from: 'g8' });
    expect(pickSuggestion(fen, ranked, { from: 'f7', to: 'f6' })).toMatchObject({ from: 'b8' });
  });
});
