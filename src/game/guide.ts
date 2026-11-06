import { Chess } from 'chess.js';
import type { GameController } from './GameController';
import type { Colour, PromotionType } from './rules';
import { bookMove, currentOpening, openingForMove } from './openings';
import { describeMove, detectTactics, explainMove, hangingPieces, mateThreats, pickSuggestion, PIECE_NAME, unsafeReason, type Tactic } from './tactics';
import type { Analysis } from '../ai/engine';

// The coach. Its advice comes from a full-strength engine analysis (engine.ts analyse()): the
// suggestion must score close to the best move AND not leave a piece to be taken, and the coach
// explains a short plan (your move, the likely reply, your follow-up). Jobs:
//  - Hint button: one suggestion on demand (3 per game unless the Guide is on).
//  - Guide mode: every turn it names the opening, warns about danger (hanging pieces, check,
//    mate threats) and suggests a move with a reason, using real opening lines where it can.
// Always on, whatever the mode: "Well done!" badges when the player uses a named strategy.

export type Tone = 'info' | 'warn' | 'good';
export interface CoachLine { text: string; tone?: Tone }
export interface CoachMessage { kind: 'hint' | 'coach'; title: string; lines: CoachLine[] }
export type PopStyle = 'good' | 'bad' | 'warn' | 'info' | 'big';

interface Suggestion {
  from: string; to: string; promotion?: PromotionType; san: string; score: number;
  opening?: { name: string; idea: string };
  reply?: string;
  follow?: { from: string; to: string; promotion?: string; san: string };
}

export interface GuideUI {
  coach(msg: CoachMessage | null): void;
  badge(t: Tactic): void;
  pop(text: string, square: string, style: PopStyle): void;
  setHintsLeft(n: number | null): void; // null = unlimited (Guide on)
}

type EngineFn = (fen: string, extra: { from: string; to: string }[], timeMs: number) => Promise<Analysis>;

/** Badges that should only appear once per game. */
const ONCE = new Set(['castling', 'centre-control', 'development', 'fianchetto']);
const SIDE: Record<Colour, string> = { w: 'Light', b: 'Dark' };

export class Guide {
  private hintsLeft = 3;
  private lastFen: string;
  private seen = new Set<string>();
  private announcedOpening: string | null = null;
  private req = 0;
  private readonly unsub: () => void;

  constructor(private readonly game: GameController, private readonly ui: GuideUI, private readonly engine: EngineFn, public enabled: boolean) {
    this.lastFen = game.rules.fen;
    this.unsub = game.events.on((e) => {
      if (e.type === 'start') { this.lastFen = game.rules.fen; this.ui.setHintsLeft(this.enabled ? null : this.hintsLeft); this.afterTurnChange(); }
      else if (e.type === 'move') this.onMove(e.move.from, e.move.to, e.move.promotion, e.move.colour);
      else if (e.type === 'undo') { this.lastFen = game.rules.fen; this.clear(); this.afterTurnChange(); }
      else if (e.type === 'end') { this.clear(); this.ui.coach(null); }
    });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.ui.setHintsLeft(on ? null : this.hintsLeft);
    if (on) void this.coachTurn();
    else { this.clear(); this.ui.coach(null); }
  }

  dispose(): void { this.unsub(); this.req++; }

  private isHuman(c: Colour): boolean { return this.game.opts.humans.includes(c); }

  private clear(): void {
    this.req++;
    const v = this.game.view;
    v.highlights.setHint(null, null);
    v.highlights.setDanger([]);
    for (const a of v.actors.values()) a.hintBounce = false;
  }

  private onMove(from: string, to: string, promotion: string | undefined, mover: Colour): void {
    const before = this.lastFen;
    const history = this.game.rules.history();
    this.lastFen = this.game.rules.fen;
    this.clear();
    if (!this.enabled) this.ui.coach(null); // a used hint card goes away
    if (this.isHuman(mover)) {
      // Well done badge: the most important named idea in this move (once-only ideas once).
      const tactics = detectTactics(before, { from, to, promotion }, history.slice(0, -1));
      const pick = tactics.find((t) => !(ONCE.has(t.id) || t.id.startsWith('opening:')) || !this.seen.has(t.id));
      if (pick) {
        this.seen.add(pick.id);
        if (pick.id.startsWith('opening:')) this.announcedOpening = pick.name;
        this.ui.badge(pick);
      }
      // Guide: warn straight away if that move left something unprotected.
      if (this.enabled && !this.game.ended) {
        const hang = hangingPieces(new Chess(this.lastFen), mover).filter((h) => h.type !== 'p');
        if (hang[0]) {
          this.ui.pop('CAREFUL!', hang[0].square, 'warn');
          this.game.view.highlights.setDanger(hang.map((h) => this.game.view.squarePos(h.square)));
          this.ui.coach({ kind: 'coach', title: 'Coach', lines: [{ tone: 'warn', text: `Careful! Your ${PIECE_NAME[hang[0].type]} on ${hang[0].square} is not protected now.` }] });
        }
      }
    }
    this.afterTurnChange();
  }

  private afterTurnChange(): void {
    if (this.enabled && !this.game.ended && this.isHuman(this.game.rules.turn)) void this.coachTurn();
  }

  /** Finds the move to suggest: a named book move early on, otherwise the engine's best. */
  /**
   * The move to suggest. The engine scores every move; a named opening move is preferred when the
   * engine agrees it is about as good AND it doesn't leave a piece to be captured for free.
   * Otherwise the best safe move (see pickSuggestion in tactics.ts).
   */
  /**
   * The move to suggest, plus the plan: the opponent's likely reply and our best follow-up.
   * A named opening move is preferred when the engine agrees it is about as good and safe.
   */
  private async suggest(fen: string, history: string[]): Promise<Suggestion | null> {
    let book: { from: string; to: string; san: string } | null = null;
    if (history.length < 20) {
      const b = bookMove(history);
      if (b) {
        try { const m = new Chess(fen).move(b.san); book = { from: m.from, to: m.to, san: m.san }; } catch { /* not legal here */ }
      }
    }
    let a: Analysis;
    try { a = await this.engine(fen, book ? [book] : [], 2600); } catch { return null; }
    const pick = pickSuggestion(fen, a.candidates, book) ?? a.best;
    const isBook = !!book && pick.from === book.from && pick.to === book.to;
    const named = isBook ? openingForMove(history, book!.san) : null;
    // The plan after OUR chosen move (the analysis line belongs to the engine's best move).
    let reply: string | undefined;
    let follow: Suggestion['follow'];
    const c = new Chess(fen);
    c.move(pick);
    if (pick.from === a.best.from && pick.to === a.best.to && a.line.length) {
      reply = a.line[0];
      if (a.line[1]) {
        try { c.move(reply); const m = c.move(a.line[1]); follow = { from: m.from, to: m.to, promotion: m.promotion, san: m.san }; } catch { /* plan is optional */ }
      }
    } else if (!c.isGameOver()) {
      try {
        const b2 = await this.engine(c.fen(), [], 900);
        reply = b2.best.san;
        if (b2.line[0]) { c.move(reply); const m = c.move(b2.line[0]); follow = { from: m.from, to: m.to, promotion: m.promotion, san: m.san }; }
      } catch { /* plan is optional */ }
    }
    return { from: pick.from, to: pick.to, promotion: pick.promotion as PromotionType | undefined, san: pick.san, score: pick.score, opening: named ?? undefined, reply, follow };
  }

  /** Coach lines for a suggestion, kept short: the move, why, and the plan two moves ahead. */
  private planLines(fen: string, history: string[], s: Suggestion): CoachLine[] {
    const me = new Chess(fen).turn();
    const them = SIDE[me === 'w' ? 'b' : 'w'];
    const lines: CoachLine[] = [
      { tone: 'good', text: `Best move: ${shortMove(fen, s)}` },
      { text: explainMove(fen, s, history, s.opening) },
    ];
    if (s.san.endsWith('#')) return lines;
    if (s.reply) {
      const c = new Chess(fen);
      c.move(s);
      const replyMove = c.move(s.reply);
      const taken = replyMove.captured ? ` takes your ${PIECE_NAME[replyMove.captured as keyof typeof PIECE_NAME]}` : ` plays ${s.reply}`;
      lines.push({ tone: 'info', text: s.follow ? `Next: if ${them}${taken}, play ${shortMove(c.fen(), s.follow)}.` : `Next: ${them} will probably reply ${s.reply}.` });
    }
    if (Math.abs(s.score) >= 90_000) {
      lines.push({ tone: s.score > 0 ? 'good' : 'warn', text: s.score > 0 ? 'Forced checkmate! Follow the moves.' : 'Checkmate threat! Defend your King.' });
    }
    return lines;
  }

  /** Warning for a move the player is about to make (guide mode), or null if it is safe. */
  caution(from: string, to: string): string | null {
    if (!this.enabled) return null;
    const promo = this.game.rules.isPromotionMove(from, to) ? 'q' : undefined;
    return unsafeReason(this.game.rules.fen, { from, to, promotion: promo });
  }

  private showSuggestion(m: { from: string; to: string }): void {
    const v = this.game.view;
    v.highlights.setHint(v.squarePos(m.from), v.squarePos(m.to));
    const a = v.actorAt(m.from);
    if (a) a.hintBounce = true;
  }

  /** Guide mode: full commentary for the player's turn. */
  private async coachTurn(): Promise<void> {
    const id = ++this.req;
    const g = this.game;
    const fen = g.rules.fen, me = g.rules.turn, history = g.rules.history();
    const chess = new Chess(fen);
    const lines: CoachLine[] = [];

    const opening = currentOpening(history);
    if (opening && opening.name !== this.announcedOpening) {
      this.announcedOpening = opening.name;
      lines.push({ tone: 'info', text: `Opening: the ${opening.name}.` });
    }
    if (chess.inCheck()) {
      lines.push({ tone: 'warn', text: "Check! Move your King, block, or capture the attacker." });
    } else {
      const mates = mateThreats(fen);
      if (mates[0]) lines.push({ tone: 'warn', text: `Watch out! ${SIDE[me === 'w' ? 'b' : 'w']} threatens checkmate with ${mates[0]}.` });
    }
    const hang = hangingPieces(chess, me);
    if (hang.length) {
      const h = hang[0];
      lines.push({ tone: 'warn', text: `Your ${PIECE_NAME[h.type]} on ${h.square} is under attack!` });
      g.view.highlights.setDanger(hang.map((x) => g.view.squarePos(x.square)));
      this.ui.pop('LOOK OUT!', h.square, 'warn');
    }
    this.ui.coach({ kind: 'coach', title: 'Coach', lines: [...lines, { tone: 'info', text: 'Thinking…' }] });

    const s = await this.suggest(fen, history);
    if (id !== this.req || g.rules.fen !== fen || !s) return;
    lines.push(...this.planLines(fen, history, s));
    this.ui.coach({ kind: 'coach', title: 'Coach', lines });
    this.showSuggestion(s);
  }

  /** The Hint button. */
  async requestHint(): Promise<void> {
    const g = this.game;
    if (g.ended || g.isBusy || !g.humanToMove()) return;
    if (this.enabled) { void this.coachTurn(); return; }
    if (this.hintsLeft <= 0) {
      this.ui.coach({ kind: 'hint', title: 'Hint', lines: [{ tone: 'warn', text: 'No hints left. Turn on the Guide for help every move!' }] });
      return;
    }
    this.hintsLeft--;
    this.ui.setHintsLeft(this.hintsLeft);
    const id = ++this.req;
    const fen = g.rules.fen, history = g.rules.history();
    this.ui.coach({ kind: 'hint', title: 'Hint', lines: [{ tone: 'info', text: 'Thinking…' }] });
    const s = await this.suggest(fen, history);
    if (id !== this.req || g.rules.fen !== fen || !s) return;
    this.ui.coach({ kind: 'hint', title: 'Hint', lines: this.planLines(fen, history, s) });
    this.showSuggestion(s);
    this.ui.pop('TRY THIS!', s.to, 'info');
  }
}

/** "Knight b1 → c3": short enough for the coach box. */
function shortMove(fen: string, m: { from: string; to: string }): string {
  return describeMove(fen, m).replace(' from ', ' ').replace(' to ', ' → ');
}
