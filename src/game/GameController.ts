import type { Stage } from '../scene/Stage';
import type { RealPieceLibrary } from '../pieces/manifest';
import { leap, travel, settle } from '../pieces/motion';
import { ease, Timeline } from '../util/timeline';
import { SurrenderFlag } from '../fx/flag';
import * as THREE from 'three';
import { BoardView } from './BoardView';
import { ChessClock } from './clock';
import { DuelDirector, type DuelMode } from './DuelDirector';
import { EventBus, type GameEvent } from './events';
import { invalidReason } from './invalid';
import { GameRules, START_FEN, type Colour, type MoveResult, type PromotionType } from './rules';

export interface GameOptions {
  playerSide: Colour; // side on the near edge
  /** Which sides a human controls (both for local 2-player). */
  humans: Colour[];
  timeMs: number | null;
  practice: boolean; // undo allowed
  duelMode: DuelMode;
  fen?: string;
}

export type GameEndInfo = Extract<GameEvent, { type: 'end' }>['result'];

/**
 * Runs one game: input -> rules -> presentation. The move is committed to the rules first;
 * walking, duels and effects are playback of an already-decided result.
 */
export class GameController {
  readonly rules: GameRules;
  readonly clock: ChessClock;
  readonly view: BoardView;
  readonly duel: DuelDirector;
  readonly events = new EventBus();
  readonly tl = new Timeline();
  duelMode: DuelMode;
  /** Set by the promotion UI; resolves with the chosen piece. */
  choosePromotion: (colour: Colour) => Promise<PromotionType> = async () => 'q';
  /** Supplies computer moves (step 7). */
  computerMove: ((fen: string) => Promise<{ from: string; to: string; promotion?: PromotionType }>) | null = null;
  /** Guide mode: returns a warning if a move would lose material (set by the app). */
  caution: ((from: string, to: string) => string | null) | null = null;
  private cautioned: string | null = null;

  /** True if the move should wait: it is risky and the player hasn't confirmed it yet. */
  private needsConfirm(from: string, to: string): boolean {
    const reason = this.caution?.(from, to);
    if (!reason || this.cautioned === from + to) return false;
    this.cautioned = from + to;
    this.events.emit({ type: 'caution', square: from, reason: `${reason} Tap the square again to play it anyway.` });
    return true;
  }
  ended: GameEndInfo | null = null;
  readonly captured: Record<Colour, string[]> = { w: [], b: [] }; // pieces captured BY each side
  private selected: string | null = null;
  private busy = false;
  private drag: { from: string; startX: number; startY: number; active: boolean } | null = null;
  private lastTick = performance.now();
  private disposed = false;
  private readonly disposers: (() => void)[] = [];

  constructor(readonly stage: Stage, lib: RealPieceLibrary, readonly opts: GameOptions) {
    this.rules = new GameRules(opts.fen ?? START_FEN);
    this.clock = new ChessClock(opts.timeMs);
    this.duelMode = opts.duelMode;
    this.view = new BoardView(stage, lib, opts.playerSide);
    this.duel = new DuelDirector(stage, this.view.fx);
    this.view.setPosition(this.rules.pieces());
    this.disposers.push(stage.onUpdate((dt) => this.tl.update(dt)));
    this.disposers.push(stage.onUpdate(() => this.tickClock()));
    this.bindInput();
  }

  start(): void {
    this.clock.start(this.rules.turn);
    this.events.emit({ type: 'start', fen: this.rules.fen });
    this.updateCheck();
    this.openingCheers();
    void this.maybeComputer();
  }

  /**
   * Game start: every pawn plays its own start clip (Light pawns cheer, Dark pawns taunt), each
   * with its own delay and pace so no two match. Moving a pawn simply takes over its animation.
   */
  private openingCheers(): void {
    if (this.rules.moveCount() > 0) return;
    let any = false;
    for (const a of this.view.actors.values()) {
      if (a.type !== 'p' || !a.real || !a.has('start')) continue;
      any = true;
      const clip = a.clipFor('start');
      const delay = 0.15 + ((a.variant * 0.37) % 0.6) + (a.colour === 'b' ? 0.25 : 0);
      const home = a.square;
      setTimeout(() => {
        if (this.disposed || a.square !== home || this.busy) return; // already moved: leave it
        void a.play('start', { loop: true, timeScale: 0.9 + ((a.variant * 0.13) % 0.3), maxSeconds: 3.2, fade: 0.25 }).then(() => {
          if (!this.disposed && a.currentClip() === clip) a.toIdle();
        });
      }, delay * 1000);
    }
    if (any) setTimeout(() => { if (!this.disposed) this.events.emit({ type: 'cheer' }); }, 300);
  }


  get isBusy(): boolean { return this.busy; }
  get turn(): Colour { return this.rules.turn; }
  humanToMove(): boolean { return !this.ended && this.opts.humans.includes(this.rules.turn); }

  // ---------- clock ----------
  private tickClock(): void {
    const now = performance.now();
    const ms = now - this.lastTick;
    this.lastTick = now;
    if (this.ended) return;
    const flagged = this.clock.tick(ms);
    this.events.emit({ type: 'clock', usedMs: { w: this.clock.usedMs('w'), b: this.clock.usedMs('b') }, remainingMs: { w: this.clock.remainingMs('w'), b: this.clock.remainingMs('b') } });
    if (flagged) this.finish({ over: true, reason: 'timeout', winner: flagged === 'w' ? 'b' : 'w' });
  }

  // ---------- input ----------
  private bindInput(): void {
    const el = this.stage.frame;
    const down = (e: PointerEvent) => this.onDown(e);
    const move = (e: PointerEvent) => this.onMove(e);
    const up = (e: PointerEvent) => this.onUp(e);
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space' && this.duel.playing) { e.preventDefault(); this.duel.skip(); }
      if (e.code === 'Escape') this.deselect();
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    this.disposers.push(() => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    });
  }

  private onDown(e: PointerEvent): void {
    if (this.duel.playing) { this.duel.skip(); return; }
    if (this.busy || this.ended) return;
    if (!this.humanToMove()) {
      // Clicking your own piece while the computer is thinking.
      const { square } = this.view.pick(e.clientX, e.clientY);
      const p = square ? this.rules.pieceAt(square) : null;
      if (p && this.opts.humans.includes(p.colour)) this.reject(square!, 'Wait for your turn!');
      return;
    }
    // With a piece selected, a legal destination under the pointer always wins.
    if (this.selected) {
      const planeSq = this.view.squareAtPlane(e.clientX, e.clientY);
      if (planeSq && this.rules.legalTargets(this.selected).some((t) => t.to === planeSq)) {
        if (!this.needsConfirm(this.selected, planeSq)) void this.commit(this.selected, planeSq);
        return;
      }
    }
    const { square } = this.view.pick(e.clientX, e.clientY);
    if (!square) { this.deselect(); return; }
    const piece = this.rules.pieceAt(square);
    if (piece && piece.colour === this.rules.turn) {
      this.select(square);
      if (!this.rules.legalTargets(square).length) this.reject(square, invalidReason(this.rules.fen, square, null));
      this.drag = { from: square, startX: e.clientX, startY: e.clientY, active: false };
      return;
    }
    if (this.selected) {
      const target = this.rules.legalTargets(this.selected).find((t) => t.to === square);
      if (target) { if (!this.needsConfirm(this.selected, square)) void this.commit(this.selected, square); }
      else this.reject(this.selected, invalidReason(this.rules.fen, this.selected, square));
    } else if (piece) {
      this.reject(square, `That's not your piece! Pick one of the ${this.rules.turn === 'w' ? 'Light' : 'Dark'} pieces.`, false);
    }
  }

  /** Shakes a piece and explains why the move can't be made. */
  private reject(square: string, reason: string, shake = true): void {
    if (shake) this.view.actorAt(square)?.shake();
    this.events.emit({ type: 'invalid', square, reason });
  }

  private hovered: string | null = null;

  private onMove(e: PointerEvent): void {
    if (!this.drag) {
      if (this.busy || this.duel.playing) return;
      const { square } = this.view.pick(e.clientX, e.clientY);
      if (this.humanToMove()) this.view.highlights.setHover(square ? this.view.squarePos(square) : null);
      if (square !== this.hovered) {
        this.hovered = square;
        if (!this.selected) this.events.emit({ type: 'focus', square: square && this.rules.pieceAt(square) ? square : null, selected: false });
      }
      return;
    }
    if (!this.drag.active && Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY) > 6) this.drag.active = true;
    if (!this.drag.active) return;
    const a = this.view.actorAt(this.drag.from);
    const p = this.view.planePoint(e.clientX, e.clientY);
    if (a && p) {
      a.root.position.set(p.x, 0, p.z);
      a.lift = 0.3;
      a.idleBob = false;
    }
    const sq = this.view.squareAtPlane(e.clientX, e.clientY);
    this.view.highlights.setHover(sq ? this.view.squarePos(sq) : null);
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || !d.active) return;
    const a = this.view.actorAt(d.from);
    const to = this.view.squareAtPlane(e.clientX, e.clientY);
    const legal = to && this.rules.legalTargets(d.from).some((t) => t.to === to);
    if (a) { a.lift = 0; a.idleBob = true; }
    if (legal && to && this.caution?.(d.from, to) && this.cautioned !== d.from + to) {
      // Risky drop: put the piece back and explain (dropping there again plays it).
      this.needsConfirm(d.from, to);
      const home = this.view.squarePos(d.from);
      if (a) { const start = a.root.position.clone(); void this.tl.tween(0.18, (t) => a.root.position.lerpVectors(start, home, t)); }
    } else if (legal && to) {
      void this.commit(d.from, to, { dropped: true });
    } else if (a) {
      // Fly back home, then shake and explain.
      const home = this.view.squarePos(d.from);
      const start = a.root.position.clone();
      void this.tl.tween(0.18, (t) => a.root.position.lerpVectors(start, home, t)).then(() => {
        if (to && to !== d.from) this.reject(d.from, invalidReason(this.rules.fen, d.from, to));
      });
    }
  }

  private select(square: string): void {
    this.selected = square;
    this.events.emit({ type: 'focus', square, selected: true });
    this.view.highlights.setSelected(this.view.squarePos(square));
    this.view.highlights.showTargets(this.rules.legalTargets(square).map((t) => ({ pos: this.view.squarePos(t.to), capture: t.capture, unsafe: !!this.caution?.(square, t.to) })));
  }

  private deselect(): void {
    if (this.selected) this.events.emit({ type: 'focus', square: null, selected: false });
    this.selected = null;
    this.view.highlights.setSelected(null);
    this.view.highlights.clearTargets();
  }

  // ---------- moves ----------
  /** Plays a move through the full presentation. Public so tests/AI can drive it. */
  async commit(from: string, to: string, opts: { dropped?: boolean; promotion?: PromotionType } = {}): Promise<MoveResult | null> {
    if (this.busy || this.ended) return null;
    this.busy = true;
    this.cautioned = null;
    this.deselect();
    this.view.highlights.setHover(null);
    this.view.highlights.setHint(null, null);
    this.view.highlights.setDanger([]);
    for (const a of this.view.actors.values()) a.hintBounce = false;
    try {
      let promotion = opts.promotion;
      if (!promotion && this.rules.isPromotionMove(from, to)) {
        this.clock.pause('promotion');
        promotion = await this.choosePromotion(this.rules.turn);
        this.clock.resume('promotion');
      }
      const res = this.rules.move(from, to, promotion);
      if (!res) return null;
      await this.present(res, !!opts.dropped);
      const moveNumber = this.rules.moveCount();
      this.events.emit({ type: 'move', move: res, moveNumber });
      if (res.captured) this.events.emit({ type: 'capture', move: res });
      if (res.promotion) this.events.emit({ type: 'promotion', move: res });
      if (res.check) this.events.emit({ type: 'check', colour: this.rules.turn });
      this.clock.switchTo(this.rules.turn);
      const st = this.rules.status();
      if (st.over) this.finish(st);
      return res;
    } finally {
      this.busy = false;
      if (!this.ended) void this.maybeComputer();
    }
  }

  private async present(m: MoveResult, dropped: boolean): Promise<void> {
    const v = this.view;
    const h = v.highlights;
    h.setCheck(null);
    const mover = v.actorAt(m.from)!;
    const dest = v.squarePos(m.to);

    if (m.captured && m.capturedSquare) {
      const defender = v.actorAt(m.capturedSquare)!;
      this.captured[m.colour].push(m.captured);
      v.actors.delete(m.capturedSquare);
      v.relocate(m.from, m.to);
      const mode: DuelMode = dropped && this.duelMode !== 'off' ? 'short' : this.duelMode;
      this.duel.onImpact = () => this.events.emit({ type: 'impact', move: m, at: dest.clone() });
      const paused = mode !== 'off';
      if (paused) this.clock.pause('duel');
      this.events.emit({ type: 'duel', phase: 'start' });
      try {
        await this.duel.play(mode, { attacker: mover, defender, to: dest, knight: m.piece === 'n' });
      } finally {
        if (paused) this.clock.resume('duel');
        defender.dispose();
        this.events.emit({ type: 'duel', phase: 'end', durationMs: this.duel.lastDurationMs, animSeconds: this.duel.lastAnimSeconds });
      }
    } else {
      v.relocate(m.from, m.to);
      const moves: Promise<void>[] = [];
      if (dropped) {
        const start = mover.root.position.clone();
        moves.push(this.tl.tween(0.12, (t) => mover.root.position.lerpVectors(start, dest, t)));
      } else if (m.piece === 'n') {
        moves.push(leap(this.tl, mover, dest));
      } else {
        moves.push(travel(this.tl, mover, dest));
      }
      if (m.castle) {
        const rook = v.relocate(m.castle.rookFrom, m.castle.rookTo);
        if (rook) {
          const rd = v.squarePos(m.castle.rookTo);
          moves.push((async () => { await this.tl.wait(0.15); await leap(this.tl, rook, rd, { speed: 1.2 }); })());
        }
      }
      await Promise.all(moves);
      settle(mover);
    }
    if (m.promotion) v.promote(m.to, m.promotion);
    h.setLastMove(v.squarePos(m.from), dest);
    this.updateCheck();
  }

  private updateCheck(): void {
    this.view.highlights.setCheck(this.rules.inCheck() ? this.view.squarePos(this.rules.kingSquare(this.rules.turn)) : null);
  }

  private async maybeComputer(): Promise<void> {
    if (!this.computerMove || this.ended || this.humanToMove() || this.busy) return;
    const fen = this.rules.fen;
    this.events.emit({ type: 'thinking' });
    let m;
    try {
      m = await this.computerMove(fen);
    } catch (err) {
      console.error('Computer move failed', err);
      return;
    }
    if (this.disposed || this.rules.fen !== fen || this.ended) return; // position changed (undo/new game)
    await this.commit(m.from, m.to, { promotion: m.promotion });
  }

  undo(): boolean {
    if (!this.opts.practice || this.busy || this.duel.playing) return false;
    // Against the computer, take back the human's last move as well as the reply.
    const steps = this.opts.humans.length === 1 && this.rules.turn === this.opts.humans[0] ? 2 : 1;
    let undone = false;
    for (let i = 0; i < steps; i++) if (this.rules.undo()) undone = true;
    if (!undone) return false;
    this.ended = null;
    this.flag?.dispose();
    this.flag = null;
    this.recountCaptures();
    this.view.setPosition(this.rules.pieces());
    this.view.highlights.setLastMove(null, null);
    this.deselect();
    this.updateCheck();
    this.clock.switchTo(this.rules.turn);
    this.events.emit({ type: 'undo' });
    return true;
  }

  private recountCaptures(): void {
    const start: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    for (const side of ['w', 'b'] as Colour[]) {
      const enemy = side === 'w' ? 'b' : 'w';
      const left = this.rules.pieces().filter((p) => p.colour === enemy);
      this.captured[side] = [];
      for (const t of ['q', 'r', 'b', 'n', 'p']) {
        const missing = start[t] - left.filter((p) => p.type === t).length;
        for (let i = 0; i < missing; i++) this.captured[side].push(t);
      }
    }
  }

  finish(result: GameEndInfo): void {
    if (this.ended) return;
    this.ended = result;
    this.clock.stop();
    this.deselect();
    this.events.emit({ type: 'end', result });
    if (result.winner) this.celebrate(result.winner);
    if (result.winner && (result.reason === 'checkmate' || result.reason === 'resign')) void this.surrender(result.winner === 'w' ? 'b' : 'w');
  }

  /** Checkmate finale: the losing king trembles, bows and waves a little white flag. Never harmed. */
  /**
   * Game over: the whole winning team celebrates (dances, flips, cheers; knights rear up), the
   * losing team falls over or stomps the ground, and the losing king bows with a white flag.
   */
  private celebrate(winner: Colour): void {
    const loser: Colour = winner === 'w' ? 'b' : 'w';
    const loserKing = this.rules.kingSquare(loser);
    for (const a of this.view.actors.values()) {
      if (!a.root.visible || !a.real) continue;
      const delay = 0.5 + ((a.variant * 0.29 + (a.type === 'p' ? 0 : 0.2)) % 0.7);
      setTimeout(() => {
        if (this.disposed) return;
        if (a.colour === winner) {
          void a.play('win', { loop: true, fade: 0.3, timeScale: 0.95 + ((a.variant * 0.11) % 0.2) });
          if (a.centaur) void this.tl.tween(6, (t) => { a.rear = Math.max(0, Math.sin(t * Math.PI * 4)); }).then(() => { a.rear = 0; });
        } else if (a.square !== loserKing) {
          void a.play('lose', { fade: 0.25, clamp: true });
        }
      }, delay * 1000);
    }
  }

  private flag: SurrenderFlag | null = null;

  /**
   * Checkmate / resign: the losing king pulls a tall white flag out at his side, raises it and
   * waves it in surrender, then bows. Never harmed. The end screen waits for this (hud.ts).
   */
  private async surrender(loser: Colour): Promise<void> {
    const king = this.view.actorAt(this.rules.kingSquare(loser));
    if (!king) return;
    const tl = this.tl;
    await tl.wait(0.5);
    if (this.disposed) return;
    const flag = new SurrenderFlag(king.height * 1.15);
    this.flag = flag;
    king.root.add(flag.group);
    const local = new THREE.Vector3();
    let wave = 0, raise = 0;
    const off = this.stage.onUpdate((dt) => {
      if (!flag.group.parent) { off(); return; }
      flag.update(dt);
      // Pole base follows the king's right hand (or his right side if the rig has no hand).
      const hand = king.real ? king.model.getObjectByName('hand_r') : null;
      if (hand) king.root.worldToLocal(hand.getWorldPosition(local));
      else local.set(-0.32, king.height * 0.4, 0.12);
      flag.group.position.set(local.x, local.y - 0.25 * (1 - raise) - 0.15, local.z);
      flag.group.scale.setScalar(Math.max(0.001, raise));
      flag.group.rotation.z = Math.sin(wave) * 0.32 * raise - 0.12;
    });
    king.idleBob = false;
    // Pull it out (grow up from the hand), then wave it side to side.
    await tl.tween(0.45, (t) => { raise = t; }, ease.outBack);
    await tl.tween(2.4, (t) => { wave = t * Math.PI * 6; king.rig.rotation.z = Math.sin(t * Math.PI * 12) * 0.03; });
    king.rig.rotation.z = 0;
    if (king.real && king.has('lose')) void king.play('lose', { fade: 0.3, clamp: true });
    else await tl.tween(0.45, (t) => { king.rig.rotation.x = 0.38 * t; });
    await tl.tween(3, (t) => { wave = Math.PI * 6 + t * Math.PI * 4; });
  }

  resign(colour: Colour): void { this.finish({ over: true, reason: 'resign', winner: colour === 'w' ? 'b' : 'w' }); }
  agreeDraw(): void { this.finish({ over: true, reason: 'draw-agreed', winner: null }); }

  pgn(): string {
    const date = new Date();
    return this.rules.pgn({
      Event: 'Chess Masters', Site: 'Palace Gardens',
      Date: `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.flag?.dispose();
    for (const d of this.disposers) d();
    this.duel.dispose();
    this.view.dispose();
  }
}
