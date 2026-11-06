import { Board, mFrom, mTo, sqIndex } from '../ai/board0x88';
import { Chess, type Square } from 'chess.js';

// Explains, in child-friendly words, why a move can't be made. `to` null = the piece has no moves.

const RULE: Record<string, string> = {
  p: 'Pawns move straight forward, and capture diagonally.',
  n: 'Knights jump in an L shape: two squares one way, then one to the side.',
  b: 'Bishops move diagonally, any number of squares.',
  r: 'Rooks move in straight lines: up, down or sideways.',
  q: 'The Queen moves in straight lines or diagonally.',
  k: 'The King moves one square at a time.',
};
const NAME: Record<string, string> = { k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn' };

export function invalidReason(fen: string, from: string, to: string | null): string {
  const chess = new Chess(fen);
  const p = chess.get(from as Square);
  if (!p) return 'There is no piece there.';
  const inCheck = chess.inCheck();
  if (to === null) {
    if (inCheck) return `Your King is in check! This ${NAME[p.type]} can't help, so try another piece.`;
    return `This ${NAME[p.type]} is blocked and can't move right now.`;
  }
  const target = chess.get(to as Square);
  if (target && target.color === p.color) return "You can't land on your own piece!";

  const board = new Board(fen);
  const pseudo: number[] = [];
  board.pseudo(pseudo);
  const f = sqIndex(from), t = sqIndex(to);
  if (pseudo.some((m) => mFrom(m) === f && mTo(m) === t)) {
    if (inCheck) return 'Your King is in check! You must get him out of danger first.';
    if (p.type === 'k') return "Your King can't move into danger!";
    return 'That would leave your King in check!';
  }
  const df = to.charCodeAt(0) - from.charCodeAt(0), dr = Number(to[1]) - Number(from[1]);
  if (p.type === 'k' && Math.abs(df) === 2 && dr === 0) {
    return inCheck ? "You can't castle while in check." : "You can't castle right now: the King or Rook has moved, or the way is blocked or attacked.";
  }
  const straight = df === 0 || dr === 0, diagonal = Math.abs(df) === Math.abs(dr);
  const slides = (p.type === 'r' && straight) || (p.type === 'b' && diagonal) || (p.type === 'q' && (straight || diagonal));
  if (slides) return 'Something is in the way!';
  if (p.type === 'p') {
    const forward = p.color === 'w' ? dr > 0 : dr < 0;
    if (!forward) return "Pawns can't move backwards!";
    if (df === 0 && target) return 'Pawns capture diagonally, not straight ahead.';
    if (Math.abs(df) === 1 && !target) return 'Pawns only move diagonally when they capture.';
  }
  return RULE[p.type];
}
