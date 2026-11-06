import { Chess, type Square } from 'chess.js';

// Thin, presentation-friendly wrapper over chess.js. All rules (castling, en passant,
// promotion, check, mate, stalemate, repetition, 50-move rule, insufficient material) come
// from chess.js; this file only reshapes results for the game.

export type Colour = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PromotionType = 'q' | 'r' | 'b' | 'n';

export interface PieceOnSquare { square: string; type: PieceType; colour: Colour }

export interface LegalTarget { to: string; capture: boolean; promotion: boolean }

export interface MoveResult {
  from: string;
  to: string;
  san: string;
  colour: Colour;
  piece: PieceType;
  captured?: PieceType;
  /** Square the captured piece stood on (differs from `to` for en passant). */
  capturedSquare?: string;
  promotion?: PromotionType;
  castle?: { rookFrom: string; rookTo: string; side: 'king' | 'queen' };
  enPassant: boolean;
  check: boolean;
  fen: string;
}

export type GameEnd =
  | { over: false }
  | { over: true; reason: 'checkmate'; winner: Colour }
  | { over: true; reason: 'stalemate' | 'repetition' | 'fifty-move' | 'insufficient-material'; winner: null };

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class GameRules {
  private chess: Chess;

  constructor(fen: string = START_FEN) {
    this.chess = new Chess(fen);
  }

  get fen(): string { return this.chess.fen(); }
  get turn(): Colour { return this.chess.turn(); }
  inCheck(): boolean { return this.chess.inCheck(); }

  pieces(): PieceOnSquare[] {
    const out: PieceOnSquare[] = [];
    for (const row of this.chess.board()) for (const cell of row) {
      if (cell) out.push({ square: cell.square, type: cell.type, colour: cell.color });
    }
    return out;
  }

  pieceAt(square: string): PieceOnSquare | null {
    const p = this.chess.get(square as Square);
    return p ? { square, type: p.type, colour: p.color } : null;
  }

  kingSquare(colour: Colour): string {
    return this.chess.findPiece({ type: 'k', color: colour })[0];
  }

  legalTargets(from: string): LegalTarget[] {
    const moves = this.chess.moves({ square: from as Square, verbose: true });
    const seen = new Map<string, LegalTarget>();
    for (const m of moves) {
      // chess.js isCapture() does not include en passant, so check both.
      if (!seen.has(m.to)) seen.set(m.to, { to: m.to, capture: m.isCapture() || m.isEnPassant(), promotion: m.isPromotion() });
    }
    return [...seen.values()];
  }

  isPromotionMove(from: string, to: string): boolean {
    return this.legalTargets(from).some((t) => t.to === to && t.promotion);
  }

  /** Plays a move if legal. Returns null for illegal moves (never throws). */
  move(from: string, to: string, promotion?: PromotionType): MoveResult | null {
    if (this.isPromotionMove(from, to) && !promotion) promotion = 'q';
    let m;
    try {
      m = this.chess.move({ from, to, promotion });
    } catch {
      return null;
    }
    const enPassant = m.isEnPassant();
    const res: MoveResult = {
      from: m.from, to: m.to, san: m.san, colour: m.color, piece: m.piece,
      enPassant, check: this.chess.inCheck(), fen: m.after,
    };
    if (m.captured) {
      res.captured = m.captured;
      res.capturedSquare = enPassant ? m.to[0] + m.from[1] : m.to;
    }
    if (m.promotion) res.promotion = m.promotion as PromotionType;
    if (m.isKingsideCastle() || m.isQueensideCastle()) {
      const rank = m.from[1];
      const king = m.isKingsideCastle();
      res.castle = { rookFrom: (king ? 'h' : 'a') + rank, rookTo: (king ? 'f' : 'd') + rank, side: king ? 'king' : 'queen' };
    }
    return res;
  }

  undo(): boolean {
    return this.chess.undo() !== null;
  }

  history(): string[] { return this.chess.history(); }
  moveCount(): number { return this.chess.history().length; }

  status(): GameEnd {
    const c = this.chess;
    if (c.isCheckmate()) return { over: true, reason: 'checkmate', winner: c.turn() === 'w' ? 'b' : 'w' };
    if (c.isStalemate()) return { over: true, reason: 'stalemate', winner: null };
    if (c.isInsufficientMaterial()) return { over: true, reason: 'insufficient-material', winner: null };
    if (c.isThreefoldRepetition()) return { over: true, reason: 'repetition', winner: null };
    if (c.isDrawByFiftyMoves()) return { over: true, reason: 'fifty-move', winner: null };
    return { over: false };
  }

  pgn(headers: Record<string, string> = {}): string {
    for (const [k, v] of Object.entries(headers)) this.chess.setHeader(k, v);
    return this.chess.pgn();
  }
}
