import { Chess, type Square } from 'chess.js';
import type { Colour, PieceType } from './rules';
import { openingJustReached } from './openings';

// Chess-teaching analysis (pure logic, unit-tested): named tactics in a move, pieces in danger,
// mate threats and a plain-English reason for a suggested move. Used by the coach, the Hint
// button and the "Well done!" badges.

export const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
export const PIECE_NAME: Record<PieceType, string> = { k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn' };
const FILES = 'abcdefgh';
const sq = (f: number, r: number) => (FILES[f] + (r + 1)) as Square;
const fr = (s: string): [number, number] => [FILES.indexOf(s[0]), Number(s[1]) - 1];
const other = (c: Colour): Colour => (c === 'w' ? 'b' : 'w');
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

export interface MoveLike { from: string; to: string; promotion?: string }

export interface Tactic {
  id: string; // e.g. 'fork', 'pin', 'smothered-mate'
  name: string; // shown to players, e.g. "Royal Fork"
  text: string; // one-line kid-friendly explanation
  squares: string[]; // squares involved (for highlights)
}

/** Squares a piece attacks (pawns: diagonals only). */
export function attacksFrom(chess: Chess, s: string): string[] {
  const p = chess.get(s as Square);
  if (!p) return [];
  const [f, r] = fr(s);
  const out: string[] = [];
  const ray = (df: number, dr: number, slide: boolean) => {
    let x = f + df, y = r + dr;
    while (x >= 0 && x < 8 && y >= 0 && y < 8) {
      const t = sq(x, y);
      out.push(t);
      if (!slide || chess.get(t)) break;
      x += df; y += dr;
    }
  };
  if (p.type === 'p') { const d = p.color === 'w' ? 1 : -1; for (const df of [-1, 1]) ray(df, d, false); }
  if (p.type === 'n') for (const [a, b] of KNIGHT) ray(a, b, false);
  if (p.type === 'k') for (const [a, b] of [...ORTH, ...DIAG]) ray(a, b, false);
  if (p.type === 'b' || p.type === 'q') for (const [a, b] of DIAG) ray(a, b, true);
  if (p.type === 'r' || p.type === 'q') for (const [a, b] of ORTH) ray(a, b, true);
  return out;
}

/** A piece that can be captured without a fair trade: attacked and undefended, or attacked by something cheaper. */
export function isHanging(chess: Chess, s: string): boolean {
  const p = chess.get(s as Square);
  if (!p || p.type === 'k') return false;
  const attackers = chess.attackers(s as Square, other(p.color));
  if (!attackers.length) return false;
  if (!chess.attackers(s as Square, p.color).length) return true;
  return attackers.some((a) => VALUE[chess.get(a)!.type] < VALUE[p.type]);
}

/** A colour's hanging pieces, most valuable first. */
export function hangingPieces(chess: Chess, colour: Colour): { square: string; type: PieceType }[] {
  const out: { square: string; type: PieceType }[] = [];
  for (const row of chess.board()) for (const c of row) {
    if (c && c.color === colour && isHanging(chess, c.square)) out.push({ square: c.square, type: c.type });
  }
  return out.sort((a, b) => VALUE[b.type] - VALUE[a.type]);
}

/** Moves the opponent could mate with if it were their turn now (empty if none or not checkable). */
export function mateThreats(fen: string): string[] {
  const c = new Chess(fen);
  if (c.inCheck()) return [];
  const them = other(c.turn());
  // Flip the side to move (clearing en passant, which would be invalid for the other side).
  const parts = fen.split(' ');
  parts[1] = them;
  parts[3] = '-';
  let t: Chess;
  try { t = new Chess(parts.join(' ')); } catch { return []; }
  const mates: string[] = [];
  for (const m of t.moves({ verbose: true })) {
    t.move(m);
    if (t.isCheckmate()) mates.push(m.san);
    t.undo();
  }
  return mates;
}

function rayPieces(chess: Chess, from: string, df: number, dr: number, limit = 2): { square: string; type: PieceType; colour: Colour }[] {
  const [f, r] = fr(from);
  const out: { square: string; type: PieceType; colour: Colour }[] = [];
  let x = f + df, y = r + dr;
  while (x >= 0 && x < 8 && y >= 0 && y < 8 && out.length < limit) {
    const p = chess.get(sq(x, y));
    if (p) out.push({ square: sq(x, y), type: p.type, colour: p.color });
    x += df; y += dr;
  }
  return out;
}

function sliderDirs(type: PieceType): number[][] {
  return type === 'b' ? DIAG : type === 'r' ? ORTH : type === 'q' ? [...ORTH, ...DIAG] : [];
}

/** Named tactics created by `move` in position `fen` (most important first). */
export function detectTactics(fen: string, move: MoveLike, history: string[] = []): Tactic[] {
  const before = new Chess(fen);
  const mover = before.turn();
  const enemy = other(mover);
  const after = new Chess(fen);
  let m;
  try { m = after.move(move); } catch { return []; }
  const to = m.to, piece = after.get(to as Square)!;
  const out: Tactic[] = [];
  const fullHistory = [...history, m.san];
  const ply = fullHistory.length;
  const enemyKing = after.findPiece({ type: 'k', color: enemy })[0];

  // --- Checkmates (named patterns first) ---
  if (after.isCheckmate()) {
    const kingNbrs = (() => { const [f, r] = fr(enemyKing); const n: string[] = []; for (const [a, b] of [...ORTH, ...DIAG]) { const x = f + a, y = r + b; if (x >= 0 && x < 8 && y >= 0 && y < 8) n.push(sq(x, y)); } return n; })();
    const backRank = enemy === 'w' ? '1' : '8';
    if (m.piece === 'q' && ply <= 4 && mover === 'b') out.push({ id: 'fools-mate', name: "Fool's Mate", text: 'The fastest checkmate in chess, in just two moves!', squares: [to, enemyKing] });
    else if (m.piece === 'q' && (to === 'f7' || to === 'f2') && ply <= 14) out.push({ id: 'scholars-mate', name: "Scholar's Mate", text: 'Queen and Bishop teamed up on the weak f-pawn square!', squares: [to, enemyKing] });
    else if (m.piece === 'n' && kingNbrs.every((s) => after.get(s as Square)?.color === enemy)) out.push({ id: 'smothered-mate', name: 'Smothered Mate', text: 'The King was trapped by his own pieces, and the Knight jumped in!', squares: [to, enemyKing] });
    else if ((m.piece === 'r' || m.piece === 'q') && to[1] === backRank && enemyKing[1] === backRank) out.push({ id: 'back-rank-mate', name: 'Back-Rank Mate', text: 'The King was stuck behind his own pawns on the back row!', squares: [to, enemyKing] });
    else out.push({ id: 'checkmate', name: 'Checkmate', text: 'The King is attacked and has no escape. You win!', squares: [to, enemyKing] });
    return out;
  }

  // --- Double and discovered checks / attacks ---
  if (after.inCheck()) {
    const checkers = after.attackers(enemyKing as Square, mover);
    if (checkers.length >= 2) out.push({ id: 'double-check', name: 'Double Check', text: 'Two pieces give check at once, so the King has to move!', squares: [...checkers, enemyKing] });
    else if (checkers.length === 1 && checkers[0] !== to && !m.isKingsideCastle() && !m.isQueensideCastle()) out.push({ id: 'discovered-check', name: 'Discovered Check', text: 'Moving one piece revealed a check from another!', squares: [checkers[0], enemyKing] });
  }
  if (!out.length) {
    // Discovered attack: a friendly slider now sees a valuable enemy through the square we left.
    for (const row of after.board()) for (const c of row) {
      if (!c || c.color !== mover || c.square === to) continue;
      for (const [df, dr] of sliderDirs(c.type)) {
        const [first] = rayPieces(after, c.square, df, dr, 1);
        const [bfirst] = rayPieces(before, c.square, df, dr, 1);
        if (first && first.colour === enemy && VALUE[first.type] >= 3 && bfirst?.square === m.from && first.type !== 'k' && VALUE[first.type] > VALUE[c.type] - 1 && !out.length) {
          out.push({ id: 'discovered-attack', name: 'Discovered Attack', text: `Moving out of the way let your ${PIECE_NAME[c.type]} attack the ${PIECE_NAME[first.type]}!`, squares: [c.square, first.square] });
        }
      }
    }
  }

  const safe = !isHanging(after, to) || after.inCheck();

  // --- Fork: one piece attacks two worthwhile targets ---
  const targets = attacksFrom(after, to)
    .map((s) => ({ s, p: after.get(s as Square) }))
    .filter((x) => x.p && x.p.color === enemy)
    .filter((x) => x.p!.type === 'k' || VALUE[x.p!.type] > VALUE[piece.type] || !after.attackers(x.s as Square, enemy).length)
    .filter((x) => x.p!.type !== 'p');
  if (targets.length >= 2 && safe) {
    const types = targets.map((t) => t.p!.type);
    const royal = types.includes('k') && types.includes('q');
    const names = targets.slice(0, 3).map((t) => PIECE_NAME[t.p!.type]);
    out.push({
      id: royal ? 'royal-fork' : 'fork',
      name: royal ? 'Royal Fork' : 'Fork',
      text: `Your ${PIECE_NAME[piece.type]} attacks the ${names.slice(0, -1).join(', ')} and ${names.at(-1)} at the same time!`,
      squares: [to, ...targets.map((t) => t.s)],
    });
  }

  // --- Pin and skewer along the moved slider's lines ---
  if (safe) for (const [df, dr] of sliderDirs(piece.type)) {
    const [a, b] = rayPieces(after, to, df, dr, 2);
    if (!a || !b || a.colour !== enemy || b.colour !== enemy) continue;
    // Absolute pin (against the King) or relative pin in front of a Queen or Rook worth more.
    if (a.type !== 'k' && (b.type === 'k' || ((b.type === 'q' || b.type === 'r') && VALUE[b.type] > VALUE[a.type]))) {
      out.push({
        id: 'pin', name: 'Pin',
        text: b.type === 'k'
          ? `The ${PIECE_NAME[a.type]} can't move, or its King would be in check!`
          : `The ${PIECE_NAME[a.type]} is stuck: if it moves, you capture the ${PIECE_NAME[b.type]} behind it.`,
        squares: [to, a.square, b.square],
      });
      break;
    }
    if ((a.type === 'k' || a.type === 'q') && b.type !== 'p' && VALUE[b.type] < VALUE[a.type]) {
      out.push({ id: 'skewer', name: 'Skewer', text: `The ${PIECE_NAME[a.type]} must move away, and then you capture the ${PIECE_NAME[b.type]} behind it!`, squares: [to, a.square, b.square] });
      break;
    }
  }

  // --- Special moves ---
  if (m.isEnPassant()) out.push({ id: 'en-passant', name: 'En Passant', text: 'A special pawn capture: you took the pawn that rushed past you!', squares: [m.from, to] });
  if (m.isKingsideCastle() || m.isQueensideCastle()) out.push({ id: 'castling', name: 'Castling', text: 'Your King is safely tucked away and your Rook joins the game.', squares: [m.from, to] });
  if (m.promotion) out.push({ id: m.promotion === 'q' ? 'promotion' : 'underpromotion', name: m.promotion === 'q' ? 'Promotion' : 'Underpromotion', text: m.promotion === 'q' ? 'Your pawn reached the far side and became a Queen!' : `A clever choice: your pawn became a ${PIECE_NAME[m.promotion as PieceType]}!`, squares: [to] });

  // --- Positional ideas ---
  const opening = openingJustReached(fullHistory);
  // Only named lines of 3+ moves earn an opening badge (not just "1.e4").
  if (opening && opening.moves.length >= 3) out.push({ id: `opening:${opening.name}`, name: opening.name, text: opening.idea, squares: [to] });
  if (m.piece === 'b' && ['b2', 'g2', 'b7', 'g7'].includes(to)) {
    const pawnSq = to[0] + (mover === 'w' ? '3' : '6');
    if (after.get(pawnSq as Square)?.type === 'p') out.push({ id: 'fianchetto', name: 'Fianchetto', text: 'Your Bishop sits on the long diagonal, like a laser across the board!', squares: [to] });
  }
  if (m.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(to) && ply <= 12) out.push({ id: 'centre-control', name: 'Centre Control', text: 'Pawns in the centre give your pieces more room to move.', squares: [to] });
  if ((m.piece === 'n' || m.piece === 'b') && ply <= 24) {
    const back = mover === 'w' ? '1' : '8';
    const minors = after.board().flat().filter((c) => c && c.color === mover && (c.type === 'n' || c.type === 'b'));
    if (minors.length === 4 && minors.every((c) => c!.square[1] !== back)) out.push({ id: 'development', name: 'All Developed', text: 'All your Knights and Bishops are in the game. Brilliant development!', squares: minors.map((c) => c!.square) });
  }
  return out;
}

/** A short reason why a suggested move is good. `opening` = book line it follows, if any. */
export function explainMove(fen: string, move: MoveLike, history: string[] = [], openingIdea?: { name: string; idea: string }): string {
  const before = new Chess(fen);
  const mover = before.turn();
  const after = new Chess(fen);
  const m = after.move(move);
  const pn = PIECE_NAME[m.piece];

  const tactics = detectTactics(fen, move, history).filter((t) => !t.id.startsWith('opening:') && t.id !== 'centre-control' && t.id !== 'development');
  if (tactics[0]) {
    const t = tactics[0];
    if (t.id.endsWith('mate')) return `${t.name}! ${t.text}`;
    return `This sets up a ${t.name}: ${t.text.replace(/^Your /, 'your ')}`;
  }
  if (m.captured) {
    const cn = PIECE_NAME[m.captured as PieceType];
    const wasDefended = before.attackers(m.to as Square, other(mover)).length > 0 && !m.isEnPassant();
    if (!wasDefended) return `Capture the ${cn} on ${m.to}: nobody is protecting it, so it's a free piece!`;
    if (VALUE[m.captured as PieceType] > VALUE[m.piece]) return `Your ${pn} can win the ${cn}, which is worth more. A great trade!`;
    return `Trade pieces: take the ${cn} on ${m.to}.`;
  }
  if (after.inCheck()) return `Check! Attack the King with your ${pn} so it has to escape.`;
  if (isHanging(before, m.from) && !isHanging(after, m.to)) return `Your ${pn} is in danger. Move it to safety on ${m.to}!`;
  const hb = hangingPieces(before, mover).filter((h) => h.square !== m.from);
  const ha = hangingPieces(after, mover);
  const saved = hb.find((h) => !ha.some((a) => a.square === h.square));
  if (saved) return `This protects your ${PIECE_NAME[saved.type]} on ${saved.square}.`;
  if (m.isKingsideCastle() || m.isQueensideCastle()) return 'Castle! It keeps your King safe and brings your Rook into the game.';
  if (m.promotion) return 'Promote your pawn into a new Queen!';
  if (openingIdea) return `${openingIdea.name}: ${openingIdea.idea}`;
  const ply = history.length;
  if ((m.piece === 'n' || m.piece === 'b') && m.from[1] === (mover === 'w' ? '1' : '8') && ply < 24) return `Develop your ${pn}: bring it towards the centre so it can join the fight.`;
  if (m.piece === 'p' && ['d4', 'e4', 'd5', 'e5', 'c4', 'c5'].includes(m.to) && ply < 16) return 'Grab the centre with a pawn: the centre is the most important part of the board.';
  return `Your ${pn} does the most good on ${m.to}.`;
}

/** "Knight from g1 to f3" style description. */
export function describeMove(fen: string, move: MoveLike): string {
  const p = new Chess(fen).get(move.from as Square);
  return `${p ? PIECE_NAME[p.type] : 'Piece'} from ${move.from} to ${move.to}`;
}

/**
 * Is this a safe move to recommend to a learner? Not safe when the moved piece can simply be
 * taken afterwards (e.g. a Bishop grabbing a pawn that a pawn then recaptures), or when it
 * leaves another of your pieces newly hanging. Checkmates are always safe; winning something
 * worth at least as much as the piece you risk counts as a fair trade.
 */
export function isSafeSuggestion(fen: string, move: MoveLike): boolean {
  const before = new Chess(fen);
  const after = new Chess(fen);
  let m;
  try { m = after.move(move); } catch { return false; }
  if (after.isCheckmate()) return true;
  const mover = before.turn();
  const piece = after.get(m.to as Square)!;
  const gained = m.captured ? VALUE[m.captured as PieceType] : 0;
  if (isHanging(after, m.to) && gained < VALUE[piece.type]) return false;
  const was = new Set(hangingPieces(before, mover).map((h) => h.square));
  const worth = (sqs: { square: string; type: PieceType }[]) => sqs.reduce((a, h) => a + VALUE[h.type], 0);
  const newly = hangingPieces(after, mover).filter((h) => h.square !== m.to && !was.has(h.square));
  return worth(newly) <= gained;
}

export interface Candidate { from: string; to: string; promotion?: string; score: number; san?: string }

/**
 * Picks the coach's suggestion: the book move when the engine rates it close to the best and it
 * is safe; otherwise the highest-rated safe move within a small margin of the best; otherwise
 * the engine's best.
 */
export function pickSuggestion<C extends Candidate>(fen: string, ranked: C[], book: MoveLike | null, marginCp = 40): C | null {
  if (!ranked.length) return null;
  const best = ranked[0].score;
  const near = (c: Candidate) => c.score >= best - marginCp;
  if (book) {
    const r = ranked.find((c) => c.from === book.from && c.to === book.to);
    if (r && near(r) && isSafeSuggestion(fen, r)) return r;
  }
  return ranked.find((c) => near(c) && isSafeSuggestion(fen, c)) ?? ranked[0];
}

/**
 * Why a move is risky, in a child's words (or null if it is safe): the moved piece can be taken
 * for free, or it leaves another piece unprotected. Used to warn BEFORE the move is played.
 */
export function unsafeReason(fen: string, move: MoveLike): string | null {
  if (isSafeSuggestion(fen, move)) return null;
  const after = new Chess(fen);
  let m;
  try { m = after.move(move); } catch { return null; }
  const enemy = after.turn();
  const pn = PIECE_NAME[m.promotion ? (m.promotion as PieceType) : m.piece];
  if (isHanging(after, m.to)) {
    const attackers = after.attackers(m.to as Square, enemy).map((sq) => ({ sq, t: after.get(sq)!.type })).sort((a, b) => VALUE[a.t] - VALUE[b.t]);
    const a = attackers[0];
    return a ? `Careful! The ${PIECE_NAME[a.t]} on ${a.sq} could capture your ${pn} on ${m.to}.` : `Careful! Your ${pn} could be captured on ${m.to}.`;
  }
  const before = new Set(hangingPieces(new Chess(fen), m.color).map((h) => h.square));
  const h = hangingPieces(after, m.color).find((x) => x.square !== m.to && !before.has(x.square));
  return h ? `Careful! That move leaves your ${PIECE_NAME[h.type]} on ${h.square} unprotected.` : 'Careful! That move could lose a piece.';
}
