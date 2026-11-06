// Chess-accurate board geometry. Pure logic, no three.js, so it can be unit-tested.
//
// World: board on y = 0, centred at the origin, 1 unit = 1 square. World columns run along +x
// (left to right as the player sees it) and world rows run from the near edge (z = +4, by the
// stairs) towards the far edge (z = -4). The camera never moves: when the player chooses Dark,
// squares are mapped 180 degrees so Dark's home rank sits on the near edge.

export type Side = 'w' | 'b';

export const FILES = 'abcdefgh';
export const SQUARE_SIZE = 1;
export const BOARD_SQUARES = 8;
export const HALF_BOARD = (BOARD_SQUARES * SQUARE_SIZE) / 2;

export interface SquareInfo {
  name: string;
  file: number; // 0..7 = a..h
  rank: number; // 0..7 = 1..8
  col: number; // world column 0..7 along +x
  row: number; // world row 0..7 from the near edge
  x: number; // world centre
  z: number;
  size: number;
  dark: boolean;
}

/** a1 is dark, so a square is dark when file + rank is even. */
export function isDarkSquare(file: number, rank: number): boolean {
  return (file + rank) % 2 === 0;
}

/** Parity of a world cell, used to paint the board mesh. Independent of the player's side. */
export function isDarkCell(col: number, row: number): boolean {
  return (col + row) % 2 === 0;
}

export function parseSquare(name: string): { file: number; rank: number } {
  const file = FILES.indexOf(name[0]);
  const rank = Number(name[1]) - 1;
  if (name.length !== 2 || file < 0 || !(rank >= 0 && rank < 8)) throw new Error(`Bad square "${name}"`);
  return { file, rank };
}

export function squareName(file: number, rank: number): string {
  return FILES[file] + String(rank + 1);
}

export function squareToCell(file: number, rank: number, side: Side): { col: number; row: number } {
  return side === 'w' ? { col: file, row: rank } : { col: 7 - file, row: 7 - rank };
}

export function cellToSquare(col: number, row: number, side: Side): { file: number; rank: number } {
  return side === 'w' ? { file: col, rank: row } : { file: 7 - col, rank: 7 - row };
}

export function cellCentre(col: number, row: number): { x: number; z: number } {
  return {
    x: -HALF_BOARD + (col + 0.5) * SQUARE_SIZE,
    z: HALF_BOARD - (row + 0.5) * SQUARE_SIZE,
  };
}

export function squareToWorld(name: string, side: Side): { x: number; z: number } {
  const { file, rank } = parseSquare(name);
  const { col, row } = squareToCell(file, rank, side);
  return cellCentre(col, row);
}

/** Returns the square under a world point on the board plane, or null if off the board. */
export function worldToSquare(x: number, z: number, side: Side): string | null {
  const col = Math.floor((x + HALF_BOARD) / SQUARE_SIZE);
  const row = Math.floor((HALF_BOARD - z) / SQUARE_SIZE);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  const { file, rank } = cellToSquare(col, row, side);
  return squareName(file, rank);
}

export function boardSquares(side: Side): SquareInfo[] {
  const out: SquareInfo[] = [];
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const { col, row } = squareToCell(file, rank, side);
      const { x, z } = cellCentre(col, row);
      out.push({ name: squareName(file, rank), file, rank, col, row, x, z, size: SQUARE_SIZE, dark: isDarkSquare(file, rank) });
    }
  }
  return out;
}
