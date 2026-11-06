import { describe, expect, it } from 'vitest';
import {
  boardSquares, isDarkCell, isDarkSquare, parseSquare, squareToWorld, worldToSquare, HALF_BOARD, type Side,
} from '../src/scene/boardLayout';

const SIDES: Side[] = ['w', 'b'];

describe('board layout', () => {
  it('has exactly 64 squares of equal size in a perfect grid', () => {
    for (const side of SIDES) {
      const squares = boardSquares(side);
      expect(squares).toHaveLength(64);
      expect(new Set(squares.map((s) => s.name)).size).toBe(64);
      const size = squares[0].size;
      for (const s of squares) expect(s.size).toBe(size);
      const xs = [...new Set(squares.map((s) => s.x))].sort((a, b) => a - b);
      const zs = [...new Set(squares.map((s) => s.z))].sort((a, b) => a - b);
      expect(xs).toHaveLength(8);
      expect(zs).toHaveLength(8);
      for (let i = 1; i < 8; i++) {
        expect(xs[i] - xs[i - 1]).toBeCloseTo(size, 10);
        expect(zs[i] - zs[i - 1]).toBeCloseTo(size, 10);
      }
      expect(xs[0] - size / 2).toBeCloseTo(-HALF_BOARD, 10);
      expect(xs[7] + size / 2).toBeCloseTo(HALF_BOARD, 10);
    }
  });

  it('colours a1 dark and h1 light', () => {
    expect(isDarkSquare(0, 0)).toBe(true); // a1
    expect(isDarkSquare(7, 0)).toBe(false); // h1
    expect(isDarkSquare(0, 7)).toBe(false); // a8
    expect(isDarkSquare(7, 7)).toBe(true); // h8
  });

  it('paints every square the right colour in both orientations', () => {
    for (const side of SIDES) {
      for (const s of boardSquares(side)) expect(isDarkCell(s.col, s.row)).toBe(s.dark);
    }
  });

  it('gives each player a light square in their bottom-right corner', () => {
    // Bottom-right as the player sees it = near edge (row 0), rightmost column (col 7).
    for (const side of SIDES) {
      const corner = boardSquares(side).find((s) => s.col === 7 && s.row === 0)!;
      expect(corner.dark).toBe(false);
      expect(corner.name).toBe(side === 'w' ? 'h1' : 'a8');
    }
  });

  it('puts the chosen side on the near edge', () => {
    // Light: rank 1 nearest the stairs (largest z). Dark: rank 8 nearest.
    expect(squareToWorld('e1', 'w').z).toBeGreaterThan(squareToWorld('e8', 'w').z);
    expect(squareToWorld('e8', 'b').z).toBeGreaterThan(squareToWorld('e1', 'b').z);
    // Light sees a-file on the left; Dark sees h-file on the left.
    expect(squareToWorld('a1', 'w').x).toBeLessThan(squareToWorld('h1', 'w').x);
    expect(squareToWorld('h8', 'b').x).toBeLessThan(squareToWorld('a8', 'b').x);
  });

  it('maps world points back to the same square', () => {
    for (const side of SIDES) {
      for (const s of boardSquares(side)) {
        expect(worldToSquare(s.x + 0.3, s.z - 0.3, side)).toBe(s.name);
        const back = squareToWorld(s.name, side);
        expect(back).toEqual({ x: s.x, z: s.z });
      }
    }
    expect(worldToSquare(4.01, 0, 'w')).toBeNull();
    expect(worldToSquare(0, -4.01, 'b')).toBeNull();
  });

  it('rejects bad square names', () => {
    expect(() => parseSquare('i1')).toThrow();
    expect(() => parseSquare('a9')).toThrow();
    expect(() => parseSquare('a')).toThrow();
  });
});
