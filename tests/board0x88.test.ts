import { describe, expect, it } from 'vitest';
import { Board } from '../src/ai/board0x88';

// Published perft counts (chessprogramming.org "Perft Results").
describe('engine move generator (perft)', () => {
  it('start position', () => {
    const b = new Board('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect([1, 2, 3, 4].map((d) => b.perft(d))).toEqual([20, 400, 8902, 197281]);
  });
  it('Kiwipete (castling, en passant, promotions, pins)', () => {
    const b = new Board('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    expect([1, 2, 3].map((d) => b.perft(d))).toEqual([48, 2039, 97862]);
  });
  it('position 3 (en passant edge cases)', () => {
    const b = new Board('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
    expect([1, 2, 3, 4].map((d) => b.perft(d))).toEqual([14, 191, 2812, 43238]);
  });
  it('position 4 (promotions, checks)', () => {
    const b = new Board('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
    expect([1, 2, 3].map((d) => b.perft(d))).toEqual([6, 264, 9467]);
  });
  it('position 5', () => {
    const b = new Board('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8');
    expect([1, 2, 3].map((d) => b.perft(d))).toEqual([44, 1486, 62379]);
  });
});
