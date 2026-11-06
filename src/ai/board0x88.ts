// Fast 0x88 board for the engine's search only (chess.js stays the referee for the actual
// game). Make/unmake with an undo stack; legality by "does my king end up attacked".
// Verified against standard perft counts in tests/board0x88.test.ts.

export const EMPTY = 0, P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
// Pieces: white positive, black negative.

export const FLAG_EP = 1, FLAG_CASTLE = 2, FLAG_DOUBLE = 4;

// Move int: from (7 bits) | to << 7 | promo << 14 (3 bits) | flags << 17
export const mFrom = (m: number) => m & 127;
export const mTo = (m: number) => (m >> 7) & 127;
export const mPromo = (m: number) => (m >> 14) & 7;
export const mFlags = (m: number) => (m >> 17) & 7;
const enc = (from: number, to: number, promo = 0, flags = 0) => from | (to << 7) | (promo << 14) | (flags << 17);

const KNIGHT = [33, 31, 18, 14, -33, -31, -18, -14];
const KING = [1, -1, 16, -16, 17, 15, -17, -15];
const BISHOP = [17, 15, -17, -15];
const ROOK = [1, -1, 16, -16];

// Castling rights: 1 = white king side, 2 = white queen side, 4 = black king side, 8 = black queen side.
const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[0x00] = 15 & ~2; CASTLE_MASK[0x07] = 15 & ~1; CASTLE_MASK[0x04] = 15 & ~3;
CASTLE_MASK[0x70] = 15 & ~8; CASTLE_MASK[0x77] = 15 & ~4; CASTLE_MASK[0x74] = 15 & ~12;

export const sqName = (s: number) => 'abcdefgh'[s & 7] + String((s >> 4) + 1);
export const sqIndex = (n: string) => (Number(n[1]) - 1) * 16 + 'abcdefgh'.indexOf(n[0]);

interface Undo { move: number; captured: number; castling: number; ep: number; half: number }

export class Board {
  sq = new Int8Array(128);
  side = 1; // 1 white, -1 black
  castling = 0;
  ep = -1;
  half = 0;
  kings = [0, 0]; // [white, black]
  private stack: Undo[] = [];

  constructor(fen: string) { this.load(fen); }

  load(fen: string): void {
    const [placement, side, castle, ep, half] = fen.split(' ');
    this.sq.fill(0);
    const map: Record<string, number> = { p: P, n: N, b: B, r: R, q: Q, k: K };
    let rank = 7, file = 0;
    for (const ch of placement) {
      if (ch === '/') { rank--; file = 0; continue; }
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      const v = map[ch.toLowerCase()];
      const s = rank * 16 + file;
      this.sq[s] = ch === ch.toUpperCase() ? v : -v;
      if (v === K) this.kings[ch === 'K' ? 0 : 1] = s;
      file++;
    }
    this.side = side === 'b' ? -1 : 1;
    this.castling = (castle.includes('K') ? 1 : 0) | (castle.includes('Q') ? 2 : 0) | (castle.includes('k') ? 4 : 0) | (castle.includes('q') ? 8 : 0);
    this.ep = ep && ep !== '-' ? sqIndex(ep) : -1;
    this.half = Number(half ?? 0);
    this.stack = [];
  }

  attacked(s: number, by: number): boolean {
    const sq = this.sq;
    // Pawns
    const pd = by === 1 ? -16 : 16;
    for (const d of [pd - 1, pd + 1]) { const t = s + d; if (!(t & 0x88) && sq[t] === P * by) return true; }
    for (const d of KNIGHT) { const t = s + d; if (!(t & 0x88) && sq[t] === N * by) return true; }
    for (const d of KING) { const t = s + d; if (!(t & 0x88) && sq[t] === K * by) return true; }
    for (const d of BISHOP) {
      for (let t = s + d; !(t & 0x88); t += d) { const p = sq[t]; if (p) { if (p === B * by || p === Q * by) return true; break; } }
    }
    for (const d of ROOK) {
      for (let t = s + d; !(t & 0x88); t += d) { const p = sq[t]; if (p) { if (p === R * by || p === Q * by) return true; break; } }
    }
    return false;
  }

  inCheck(): boolean { return this.attacked(this.kings[this.side === 1 ? 0 : 1], -this.side); }

  /** Pseudo-legal moves; `capturesOnly` for quiescence (includes promotions). */
  pseudo(out: number[], capturesOnly = false): void {
    const sq = this.sq, us = this.side;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = sq[s] * us;
      if (p <= 0) continue;
      if (p === P) {
        const fwd = 16 * us, start = us === 1 ? 1 : 6, last = us === 1 ? 7 : 0;
        const t = s + fwd;
        if (!(t & 0x88) && !sq[t]) {
          if ((t >> 4) === last) for (const pr of [Q, R, B, N]) out.push(enc(s, t, pr));
          else if (!capturesOnly) {
            out.push(enc(s, t));
            const t2 = t + fwd;
            if ((s >> 4) === start && !sq[t2]) out.push(enc(s, t2, 0, FLAG_DOUBLE));
          }
        }
        for (const d of [fwd - 1, fwd + 1]) {
          const c = s + d;
          if (c & 0x88) continue;
          if (sq[c] * us < 0) {
            if ((c >> 4) === last) for (const pr of [Q, R, B, N]) out.push(enc(s, c, pr));
            else out.push(enc(s, c));
          } else if (c === this.ep) out.push(enc(s, c, 0, FLAG_EP));
        }
      } else if (p === N || p === K) {
        for (const d of p === N ? KNIGHT : KING) {
          const t = s + d;
          if (t & 0x88) continue;
          const q = sq[t] * us;
          if (q > 0) continue;
          if (capturesOnly && q === 0) continue;
          out.push(enc(s, t));
        }
        if (p === K && !capturesOnly) this.castles(s, out);
      } else {
        const dirs = p === B ? BISHOP : p === R ? ROOK : KING;
        for (const d of dirs) {
          for (let t = s + d; !(t & 0x88); t += d) {
            const q = sq[t] * us;
            if (q > 0) break;
            if (q < 0) { out.push(enc(s, t)); break; }
            if (!capturesOnly) out.push(enc(s, t));
          }
        }
      }
    }
  }

  private castles(s: number, out: number[]): void {
    const sq = this.sq, us = this.side, them = -us;
    if (us === 1 && s === 0x04) {
      if (this.castling & 1 && !sq[0x05] && !sq[0x06] && sq[0x07] === R && !this.attacked(0x04, them) && !this.attacked(0x05, them) && !this.attacked(0x06, them)) out.push(enc(0x04, 0x06, 0, FLAG_CASTLE));
      if (this.castling & 2 && !sq[0x03] && !sq[0x02] && !sq[0x01] && sq[0x00] === R && !this.attacked(0x04, them) && !this.attacked(0x03, them) && !this.attacked(0x02, them)) out.push(enc(0x04, 0x02, 0, FLAG_CASTLE));
    } else if (us === -1 && s === 0x74) {
      if (this.castling & 4 && !sq[0x75] && !sq[0x76] && sq[0x77] === -R && !this.attacked(0x74, them) && !this.attacked(0x75, them) && !this.attacked(0x76, them)) out.push(enc(0x74, 0x76, 0, FLAG_CASTLE));
      if (this.castling & 8 && !sq[0x73] && !sq[0x72] && !sq[0x71] && sq[0x70] === -R && !this.attacked(0x74, them) && !this.attacked(0x73, them) && !this.attacked(0x72, them)) out.push(enc(0x74, 0x72, 0, FLAG_CASTLE));
    }
  }

  /** Makes a pseudo-legal move; returns false (and undoes it) if it leaves the king in check. */
  make(m: number): boolean {
    const sq = this.sq, us = this.side;
    const from = mFrom(m), to = mTo(m), promo = mPromo(m), flags = mFlags(m);
    const piece = sq[from];
    let captured = sq[to];
    this.stack.push({ move: m, captured, castling: this.castling, ep: this.ep, half: this.half });
    sq[to] = promo ? promo * us : piece;
    sq[from] = 0;
    if (flags & FLAG_EP) { const cs = to - 16 * us; captured = sq[cs]; sq[cs] = 0; this.stack[this.stack.length - 1].captured = captured; }
    if (flags & FLAG_CASTLE) {
      if (to === from + 2) { sq[from + 1] = sq[from + 3]; sq[from + 3] = 0; }
      else { sq[from - 1] = sq[from - 4]; sq[from - 4] = 0; }
    }
    if (piece * us === K) this.kings[us === 1 ? 0 : 1] = to;
    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.ep = flags & FLAG_DOUBLE ? from + 16 * us : -1;
    this.half = piece * us === P || captured ? 0 : this.half + 1;
    this.side = -us;
    if (this.attacked(this.kings[us === 1 ? 0 : 1], -us)) { this.unmake(); return false; }
    return true;
  }

  unmake(): void {
    const u = this.stack.pop()!;
    const sq = this.sq;
    this.side = -this.side;
    const us = this.side, m = u.move;
    const from = mFrom(m), to = mTo(m), flags = mFlags(m);
    const moved = mPromo(m) ? P * us : sq[to];
    sq[from] = moved;
    if (flags & FLAG_EP) { sq[to] = 0; sq[to - 16 * us] = u.captured; }
    else sq[to] = u.captured;
    if (flags & FLAG_CASTLE) {
      if (to === from + 2) { sq[from + 3] = sq[from + 1]; sq[from + 1] = 0; }
      else { sq[from - 4] = sq[from - 1]; sq[from - 1] = 0; }
    }
    if (moved * us === K) this.kings[us === 1 ? 0 : 1] = from;
    this.castling = u.castling;
    this.ep = u.ep;
    this.half = u.half;
  }

  legal(): number[] {
    const out: number[] = [], legal: number[] = [];
    this.pseudo(out);
    for (const m of out) if (this.make(m)) { this.unmake(); legal.push(m); }
    return legal;
  }

  /** Captured piece type of a move (0 if none), without making it. */
  capturedBy(m: number): number {
    if (mFlags(m) & FLAG_EP) return P;
    return Math.abs(this.sq[mTo(m)]);
  }

  perft(depth: number): number {
    if (depth === 0) return 1;
    const out: number[] = [];
    this.pseudo(out);
    let n = 0;
    for (const m of out) if (this.make(m)) { n += this.perft(depth - 1); this.unmake(); }
    return n;
  }
}
