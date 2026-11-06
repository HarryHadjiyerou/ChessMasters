import { formatClock } from '../game/clock';
import type { Guide, CoachMessage, PopStyle } from '../game/guide';
import type { Tactic } from '../game/tactics';
import type { GameController, GameEndInfo } from '../game/GameController';
import type { ChallengeDef, ChallengeTracker } from '../game/challenges';
import { buildSettingsPanel } from './settingsPanel';
import type { Settings } from '../game/save';
import type { Colour, PieceType, PromotionType } from '../game/rules';
import { squareToWorld } from '../scene/boardLayout';
import { sound } from '../audio/sound';
import { voice } from '../audio/voice';
import { ICONS, type IconName } from './icons';

// In-game HUD in the "royal plate" style (Harry's reference, 29 Oct 2026): dark charcoal plates
// with bevelled gold frames, cream Cinzel capitals, red ribbons and round gold medallions.
// Layout keeps clear of the board: banners along the top, medallions down the left, the board
// turner with the minimap above it bottom-left, the coach top-right and the piece card
// bottom-right. Moves and PGN live in Settings.

const GLYPH: Record<Colour, Record<PieceType, string>> = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};
const SIDE_NAME: Record<Colour, string> = { w: 'Light', b: 'Dark' };
const KINGDOM: Record<Colour, string> = { w: 'Light Kingdom', b: 'Dark Kingdom' };
const PIECE_FILE: Record<PieceType, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const PIECE_NAME: Record<PieceType, string> = { k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn' };
const PIECE_WORTH: Record<PieceType, string> = { k: 'Priceless', q: 'Worth 9', r: 'Worth 5', b: 'Worth 3', n: 'Worth 3', p: 'Worth 1' };
const PIECE_HELP: Record<PieceType, string> = {
  k: 'Moves one square in any direction. Keep him safe: if he is trapped, the game is over!',
  q: 'The strongest piece. Moves any distance in a straight line or diagonally.',
  r: 'Moves any distance up, down or sideways. Joins the king when castling.',
  b: 'Moves any distance diagonally, so it always stays on one colour.',
  n: 'Jumps in an L shape: two squares one way, then one to the side. It can leap over pieces!',
  p: 'Marches forward one square (two on its first move) and captures diagonally. Reach the far side to promote!',
};

export interface HudCallbacks {
  onMenu?: () => void;
  onRematch?: () => void;
  onSettings?: (patch: Partial<Settings>) => void;
  /** For the Settings card's challenge picker. */
  challenges?: ChallengeDef[];
  getStars?: (id: string) => number;
  /** Called once when the game ends; returns lines for the end screen (challenge, points). */
  onEnd?: (result: GameEndInfo) => HTMLElement[];
}

export interface HudNames { w: string; b: string }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Writes text/classes only when they change, so per-frame clock updates cost nothing. */
function setText(e: HTMLElement, text: string): void { if (e.textContent !== text) e.textContent = text; }
function setClass(e: HTMLElement, cls: string, on: boolean): void { if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on); }

export const portraitUrl = (c: Colour, t: PieceType) => `assets/ui/portraits/${c === 'w' ? 'light' : 'dark'}_${PIECE_FILE[t]}.webp`;

/** Move pattern on a 7x7 grid around the piece: 1 = move, 2 = capture only, 3 = first move only. */
function pattern(t: PieceType): number[][] {
  const g = Array.from({ length: 7 }, () => Array(7).fill(0));
  const set = (dx: number, dy: number, v = 1) => { const x = 3 + dx, y = 3 - dy; if (x >= 0 && x < 7 && y >= 0 && y < 7) g[y][x] = v; };
  const ray = (dx: number, dy: number) => { for (let i = 1; i <= 3; i++) set(dx * i, dy * i); };
  if (t === 'k') for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) set(dx, dy);
  if (t === 'q' || t === 'r') for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ray(dx, dy);
  if (t === 'q' || t === 'b') for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) ray(dx, dy);
  if (t === 'n') for (const [dx, dy] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) set(dx, dy);
  if (t === 'p') { set(0, 1); set(0, 2, 3); set(1, 1, 2); set(-1, 1, 2); }
  return g;
}

export class Hud {
  readonly root = el('div', 'hud royal');
  private readonly banners: Record<Colour, { box: HTMLDivElement; clock: HTMLDivElement; caps: HTMLDivElement }>;
  private readonly turnNo = el('span', 'turn-no');
  private readonly turnClock = el('span', 'turn-clock');
  private readonly turnStatus = el('div', 'turn-status');
  private readonly ribbon = el('div', 'objective-ribbon');
  private readonly card = el('div', 'piece-card glass');
  private readonly mini = el('canvas', 'minimap-canvas');
  private readonly popover = el('div', 'hud-popover');
  private readonly modal = el('div', 'hud-modal');
  private readonly hintBadge = el('span', 'medal-badge', '3');
  private hintsLeft: number | null = 3;
  private guide: Guide | null = null;
  private guideMedal!: HTMLElement;
  private readonly coachBox = el('div', 'coach glass');
  private coachMedal!: HTMLElement;
  /** The player closed the coach box: keep it closed until they press the Coach medal. */
  private coachHidden = false;
  private lastCoach: CoachMessage | null = null;
  private readonly badgeLayer = el('div', 'badge-layer');
  private readonly popLayer = el('div', 'pop-layer');
  private badgeQueue: Tactic[] = [];
  private badgeBusy = false;
  private openPanel: string | null = null;
  private readonly unsub: () => void;
  private tracker: ChallengeTracker | null = null;

  constructor(
    private readonly game: GameController,
    private readonly names: HudNames,
    private settings: Settings,
    private readonly cb: HudCallbacks = {},
  ) {
    const near = game.opts.playerSide, far: Colour = near === 'w' ? 'b' : 'w';
    this.banners = { w: this.banner('w', near === 'w' ? 'left' : 'right'), b: this.banner('b', near === 'b' ? 'left' : 'right') };

    // Top centre: turn plate with timer, ribbon ends.
    const turn = el('div', 'turn-plate');
    const top = el('div', 'turn-top');
    top.insertAdjacentHTML('afterbegin', `<span class="turn-icon">${ICONS.crown}</span>`);
    top.append(this.turnNo);
    const bottom = el('div', 'turn-bottom');
    bottom.insertAdjacentHTML('afterbegin', `<span class="turn-icon">${ICONS.hourglass}</span>`);
    this.turnClock.dataset.id = 'turn-clock';
    bottom.append(this.turnClock);
    turn.append(top, bottom, this.turnStatus);
    this.ribbon.hidden = true;

    // Side medallions.
    const left = el('div', 'medals medals-left');
    left.append(this.medal('info', 'Info', () => this.togglePanel('info')));
    const coachMedal = this.medal('coach', 'Coach', () => this.toggleCoach());
    this.coachMedal = coachMedal.querySelector('.medal')!;
    left.append(coachMedal);
    const guide = this.medal('guide', 'Guide', () => this.toggleGuide());
    this.guideMedal = guide.querySelector('.medal')!;
    left.append(guide);
    const hint = this.medal('hint', 'Hint', () => void this.guide?.requestHint());
    hint.querySelector('.medal')!.append(this.hintBadge);
    left.append(hint);
    if (game.opts.practice) left.append(this.medal('undo', 'Undo', () => { this.game.undo(); }));

    const corner = el('div', 'corner-buttons');
    corner.append(this.roundButton('settings', 'Settings', () => this.openSettings()), this.roundButton('pause', 'Pause', () => this.openPause()));

    // Bottom-left: the minimap sitting on top of the board turner.
    const miniFrame = el('div', 'minimap');
    miniFrame.append(this.mini);
    const dock = el('div', 'board-dock');
    dock.append(miniFrame, this.turnControl());
    this.card.hidden = true;

    this.root.append(this.banners[near].box, this.banners[far].box, turn, this.ribbon, corner, left, dock, this.card, this.coachBox, this.badgeLayer, this.popLayer, this.popover, this.modal);
    this.coachBox.hidden = true;
    for (const ev of ['pointerdown', 'pointerup', 'click']) {
      // Modals and panels too: a click on "Close" must never reach the board underneath.
      for (const n of [this.banners.w.box, this.banners.b.box, turn, corner, left, dock, this.card, this.coachBox, this.popover, this.modal]) n.addEventListener(ev, (e) => e.stopPropagation());
    }

    game.choosePromotion = (c) => this.askPromotion(c);
    this.unsub = game.events.on((e) => {
      if (e.type === 'clock') { this.renderClocks(); if (this.tracker) this.renderObjectives(); }
      else if (e.type === 'end') this.showEnd(e.result);
      else if (e.type === 'duel') this.root.classList.toggle('dueling', e.phase === 'start');
      else if (e.type === 'focus') this.showPieceCard(e.square);
      else if (e.type === 'check') this.flashCheck();
      else this.render();
    });
    this.render();
  }

  // ---------- building blocks ----------
  private banner(c: Colour, side: 'left' | 'right'): { box: HTMLDivElement; clock: HTMLDivElement; caps: HTMLDivElement } {
    const box = el('div', `banner banner-${side} banner-${c}`);
    box.dataset.id = `banner-${c}`;
    const shield = el('div', `shield shield-${c}`);
    shield.insertAdjacentHTML('afterbegin', ICONS.crown);
    const portrait = el('div', 'portrait');
    const img = el('img');
    img.src = portraitUrl(c, 'k');
    img.alt = '';
    portrait.append(img);
    const plate = el('div', 'banner-plate');
    plate.append(el('div', 'banner-name', this.names[c]), el('div', 'banner-kingdom', KINGDOM[c]));
    const clock = el('div', 'banner-clock');
    clock.dataset.id = `clock-${c}`;
    const caps = el('div', 'banner-caps');
    plate.append(clock);
    box.append(shield, portrait, plate, caps);
    return { box, clock, caps };
  }

  private medal(id: IconName, label: string, fn: () => void): HTMLElement {
    const wrap = el('div', 'medal-wrap');
    const b = el('button', 'medal');
    b.dataset.id = id;
    b.setAttribute('aria-label', label);
    b.insertAdjacentHTML('afterbegin', ICONS[id]);
    b.addEventListener('click', (e) => { e.stopPropagation(); sound.play('click'); fn(); });
    b.addEventListener('pointerenter', () => sound.play('hover', 0.5));
    wrap.append(b, el('div', 'medal-label', label));
    return wrap;
  }

  private roundButton(id: IconName, label: string, fn: () => void): HTMLButtonElement {
    const b = el('button', 'medal medal-small');
    b.dataset.id = id;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.insertAdjacentHTML('afterbegin', ICONS[id]);
    b.addEventListener('click', (e) => { e.stopPropagation(); sound.play('click'); fn(); });
    return b;
  }

  // ---------- rendering ----------
  setChallenge(t: ChallengeTracker | null): void {
    this.tracker = t;
    this.ribbon.hidden = !t;
    this.renderObjectives();
  }

  private renderObjectives(): void {
    const t = this.tracker;
    if (t) {
      const p = t.progress()[0];
      if (this.ribbon.dataset.status !== t.status) this.ribbon.dataset.status = t.status;
      setText(this.ribbon, t.status === 'failed' ? `${t.def.name}: ${t.failReason || 'failed'}` : `${t.def.name} · ${p.label} ${p.text}`);
    }
    if (this.openPanel === 'objectives') this.fillObjectives();
  }

  private renderClocks(): void {
    const g = this.game;
    const timed = g.clock.initialMs !== null;
    for (const c of ['w', 'b'] as Colour[]) {
      const ms = timed ? g.clock.remainingMs(c) : g.clock.usedMs(c);
      const b = this.banners[c];
      setText(b.clock, formatClock(ms));
      setClass(b.clock, 'low', timed && ms < 30_000);
      setClass(b.box, 'active', !g.ended && g.turn === c);
    }
    const ms = timed ? g.clock.remainingMs(g.turn) : g.clock.usedMs(g.turn);
    setText(this.turnClock, formatClock(ms));
    setClass(this.turnClock, 'low', timed && ms < 30_000);
  }

  render(): void {
    const g = this.game;
    this.renderClocks();
    for (const c of ['w', 'b'] as Colour[]) {
      const enemy: Colour = c === 'w' ? 'b' : 'w';
      this.banners[c].caps.textContent = g.captured[c].map((t) => GLYPH[enemy][t as PieceType]).join('');
    }
    this.turnNo.textContent = `Turn ${Math.floor(g.rules.moveCount() / 2) + 1}`;
    const thinking = !g.ended && !g.humanToMove();
    this.turnStatus.textContent = g.ended ? 'Game over' : thinking ? 'Thinking…' : `${this.names[g.turn]} to move`;
    this.turnStatus.classList.toggle('check', !g.ended && g.rules.inCheck());
    if (!g.ended && g.rules.inCheck()) this.turnStatus.textContent = `Check! ${this.turnStatus.textContent}`;
    this.hintBadge.textContent = this.hintsLeft === null ? '∞' : String(this.hintsLeft);
    this.hintBadge.closest('.medal')!.classList.toggle('disabled', this.hintsLeft === 0 || thinking || !!g.ended);
    this.drawMinimap();
    this.renderObjectives();
    if (this.openPanel === 'moves') this.fillMoves();
  }

  private flashCheck(): void {
    this.render();
    this.turnStatus.classList.remove('flash');
    void this.turnStatus.offsetWidth;
    this.turnStatus.classList.add('flash');
  }

  private showPieceCard(square: string | null): void {
    const p = square ? this.game.rules.pieceAt(square) : null;
    if (!p) { this.card.classList.remove('shown'); return; }
    this.card.hidden = false;
    this.card.replaceChildren();
    const portrait = el('div', 'portrait card-portrait');
    const img = el('img');
    img.src = portraitUrl(p.colour, p.type);
    img.alt = '';
    portrait.append(img);
    const info = el('div', 'card-info');
    info.append(el('div', 'card-name', PIECE_NAME[p.type]), el('div', 'card-sub', `${SIDE_NAME[p.colour]} · ${PIECE_WORTH[p.type]}`));
    const grid = el('div', 'move-grid');
    for (const row of pattern(p.type)) for (const v of row) {
      const cell = el('div', `mg-cell${v === 1 ? ' mg-move' : v === 2 ? ' mg-capture' : v === 3 ? ' mg-first' : ''}`);
      grid.append(cell);
    }
    (grid.children[24] as HTMLElement).classList.add('mg-self');
    const head = el('div', 'card-head');
    head.append(portrait, info);
    this.card.append(head, el('div', 'card-help', PIECE_HELP[p.type]), grid);
    this.card.classList.add('shown');
  }

  private drawMinimap(): void {
    const c = this.mini;
    const size = 256;
    if (c.width !== size) { c.width = size; c.height = size; }
    const ctx = c.getContext('2d')!;
    const cell = size / 8;
    const side = this.game.opts.playerSide;
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      ctx.fillStyle = (r + f) % 2 === 0 ? '#e9d2ae' : '#4a3226';
      ctx.fillRect(f * cell, r * cell, cell, cell);
    }
    for (const p of this.game.rules.pieces()) {
      const w = squareToWorld(p.square, side);
      const col = Math.floor(w.x + 4), row = Math.floor(4 - w.z); // row 0 = near edge
      const x = (col + 0.5) * cell, y = (7 - row + 0.5) * cell;
      ctx.beginPath();
      ctx.arc(x, y, cell * (p.type === 'k' ? 0.38 : p.type === 'p' ? 0.24 : 0.32), 0, Math.PI * 2);
      ctx.fillStyle = p.colour === 'w' ? '#d8232f' : '#7d3fd6';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = p.colour === 'w' ? '#ffe3a3' : '#d6c2ff';
      ctx.stroke();
      if (p.type !== 'p') {
        ctx.fillStyle = '#fff6dd';
        ctx.font = `700 ${cell * 0.36}px Cinzel, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.type.toUpperCase(), x, y + 1);
      }
    }
  }

  // ---------- popover panels ----------
  private togglePanel(id: 'info' | 'objectives' | 'moves'): void {
    if (this.openPanel === id) { this.closePanel(); return; }
    this.openPanel = id;
    this.popover.className = `hud-popover open popover-${id}`;
    this.popover.dataset.id = `panel-${id}`;
    if (id === 'info') this.fillInfo();
    if (id === 'objectives') this.fillObjectives();
    if (id === 'moves') this.fillMoves();
  }

  private closePanel(): void {
    this.openPanel = null;
    this.popover.className = 'hud-popover';
    this.popover.replaceChildren();
  }

  private panelHeader(title: string): HTMLElement {
    const h = el('div', 'panel-head');
    h.append(el('div', 'panel-title', title));
    const x = el('button', 'panel-close', '×');
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', () => { sound.play('click'); this.closePanel(); });
    h.append(x);
    return h;
  }

  private fillInfo(): void {
    const side = this.game.opts.playerSide;
    this.popover.replaceChildren(this.panelHeader('How the pieces move'));
    const list = el('div', 'info-list');
    for (const t of ['k', 'q', 'r', 'b', 'n', 'p'] as PieceType[]) {
      const row = el('div', 'info-row');
      const portrait = el('div', 'portrait portrait-small');
      const img = el('img');
      img.src = portraitUrl(side, t);
      img.alt = '';
      portrait.append(img);
      const text = el('div');
      text.append(el('div', 'info-name', `${PIECE_NAME[t]} · ${PIECE_WORTH[t]}`), el('div', 'info-help', PIECE_HELP[t]));
      row.append(portrait, text);
      list.append(row);
    }
    this.popover.append(list);
    // Objectives (the challenge, if any) live here too.
    const obj = el('div', 'info-objectives');
    obj.append(el('div', 'panel-title', 'Objectives'));
    const holder = el('div');
    this.fillObjectives(holder);
    obj.append(holder);
    this.popover.append(obj);
  }

  private fillObjectives(target?: HTMLElement): void {
    if (!target) this.popover.replaceChildren(this.panelHeader('Objectives'));
    const t = this.tracker;
    const body = el('div', 'objectives');
    if (!t) {
      body.append(el('div', 'obj-name', 'Win the game!'), el('div', 'obj-desc', 'No challenge this time. Checkmate the enemy king, and pick a challenge from the Play menu to earn stars.'));
    } else {
      body.append(el('div', 'obj-name', t.def.name), el('div', 'obj-desc', t.def.description));
      for (const p of t.progress()) {
        const r = el('div', `obj-row${p.done ? ' done' : ''}`);
        r.append(el('span', undefined, p.label), el('span', 'obj-val', p.text));
        body.append(r);
      }
      const stars = el('div', 'obj-stars', t.status === 'failed' ? (t.failReason || 'Challenge failed') : `Up to ★★★ · ${t.def.pointsPerStar} points per star`);
      if (t.status === 'failed') stars.classList.add('fail');
      body.append(stars);
    }
    (target ?? this.popover).append(body);
  }

  private fillMoves(): void {
    this.popover.replaceChildren(this.panelHeader('Moves'));
    const list = el('ol', 'moves-list');
    const hist = this.game.rules.history();
    for (let i = 0; i < hist.length; i += 2) {
      const li = el('li');
      li.append(el('span', 'mv', hist[i]), el('span', 'mv', hist[i + 1] ?? ''));
      list.append(li);
    }
    if (!hist.length) list.append(el('li', 'moves-empty', 'No moves yet'));
    this.popover.append(list);
    list.scrollTop = list.scrollHeight;
  }

  /**
   * Board turn slider (bottom-left, under the minimap): turns the 3D board to look from another
   * angle in 90-degree clicks. Faded until the player hovers or uses it.
   */
  private turnControl(): HTMLElement {
    const box = el('div', 'turn-control glass');
    let idle = 0;
    const engage = () => {
      box.classList.add('engaged');
      clearTimeout(idle);
      idle = window.setTimeout(() => box.classList.remove('engaged'), 2500);
    };
    box.addEventListener('pointerdown', engage);
    box.addEventListener('pointermove', engage);
    box.dataset.id = 'turn-control';
    const icon = el('span', 'turn-control-icon');
    icon.insertAdjacentHTML('afterbegin', ICONS.rotate);
    // Five fixed positions: -180, -90, 0, 90, 180 degrees. The board clicks into each one.
    const range = el('input', 'royal-range turn-range');
    range.type = 'range'; range.min = '-180'; range.max = '180'; range.step = '90'; range.value = '0';
    range.setAttribute('aria-label', 'Turn the board');
    const ticks = el('div', 'turn-ticks');
    for (const d of [-180, -90, 0, 90, 180]) ticks.append(el('span', undefined, `${d}°`));
    const track = el('div', 'turn-track');
    track.append(range, ticks);
    const reset = el('button', 'turn-reset', 'Reset');
    reset.title = 'Back to the normal view';
    let current = 0;
    const apply = (deg: number) => {
      deg = Math.max(-180, Math.min(180, Math.round(deg / 90) * 90));
      range.value = String(deg);
      if (deg === current) return;
      current = deg;
      sound.play('click');
      this.game.stage.turnBoardTo(deg);
    };
    range.addEventListener('input', () => { engage(); apply(Number(range.value)); });
    reset.addEventListener('click', (e) => { e.stopPropagation(); engage(); apply(0); });
    for (const ev of ['pointerdown', 'pointerup', 'click']) box.addEventListener(ev, (e) => e.stopPropagation());
    box.append(icon, track, reset);
    return box;
  }

  // ---------- coach, badges, pop-up words (GuideUI) ----------
  setGuide(g: Guide): void {
    this.guide = g;
    this.renderGuideMedal();
  }

  private toggleGuide(): void {
    if (!this.guide) return;
    const on = !this.guide.enabled;
    this.guide.setEnabled(on);
    this.cb.onSettings?.({ guidance: on });
    this.renderGuideMedal();
  }

  private renderGuideMedal(): void {
    const on = !!this.guide?.enabled;
    setClass(this.guideMedal, 'on', on);
    const label = this.guideMedal.parentElement!.querySelector('.medal-label')!;
    setText(label as HTMLElement, on ? 'Guide: On' : 'Guide');
  }

  setHintsLeft(n: number | null): void {
    this.hintsLeft = n;
    this.render();
  }

  /** New advice from the coach. Shown unless the player has closed the box (then the Coach
   *  medal glows to say there is something new). Pressing Hint always opens it. */
  coach(msg: CoachMessage | null): void {
    this.lastCoach = msg;
    if (!msg) { voice.stop(); this.coachBox.classList.remove('shown'); setClass(this.coachMedal, 'has-new', false); return; }
    if (msg.kind === 'hint') this.coachHidden = false;
    if (this.coachHidden) { setClass(this.coachMedal, 'has-new', true); return; }
    this.showCoach(msg);
  }

  private showCoach(msg: CoachMessage): void {
    const box = this.coachBox;
    box.hidden = false;
    box.className = `coach glass shown coach-${msg.kind}`;
    box.dataset.id = 'coach-box';
    box.replaceChildren();
    setClass(this.coachMedal, 'has-new', false);
    setClass(this.coachMedal, 'on', true);
    const colour = this.game.opts.humans.length === 1 ? this.game.opts.humans[0] : this.game.turn;
    const portrait = el('div', 'portrait');
    const img = el('img');
    img.src = portraitUrl(colour, 'b');
    img.alt = '';
    portrait.append(img);
    const ribbon = el('div', 'coach-ribbon', msg.kind === 'hint' ? 'Hint' : 'Coach');
    const body = el('div', 'coach-body');
    for (const l of msg.lines) body.append(el('div', `coach-line tone-${l.tone ?? 'plain'}`, l.text));
    const close = el('button', 'panel-close coach-close', '\u00D7');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', (e) => { e.stopPropagation(); this.hideCoach(); });
    box.append(ribbon, portrait, body, close);
    if (voice.supported) {
      // Speaker on the box: switch the coach's voice on or off without opening Settings.
      const talk = el('button', 'coach-voice');
      talk.dataset.id = 'coach-voice';
      const paint = () => {
        talk.replaceChildren();
        talk.insertAdjacentHTML('afterbegin', this.settings.coachVoice ? ICONS.speaker : ICONS.speakerOff);
        talk.setAttribute('aria-label', this.settings.coachVoice ? 'Coach voice on' : 'Coach voice off');
        talk.title = talk.getAttribute('aria-label')!;
      };
      paint();
      talk.addEventListener('click', (e) => {
        e.stopPropagation();
        sound.play('click');
        this.settings = { ...this.settings, coachVoice: !this.settings.coachVoice };
        this.cb.onSettings?.({ coachVoice: this.settings.coachVoice });
        paint();
        if (this.settings.coachVoice) voice.say(msg.lines.map((l) => l.text));
      });
      box.append(talk);
    }
    // Read the advice aloud (not the "Thinking..." placeholder that comes first).
    if (!msg.lines.some((l) => l.text === 'Thinking\u2026')) voice.say(msg.lines.map((l) => l.text));
  }

  private hideCoach(): void {
    voice.stop();
    this.coachHidden = true;
    this.coachBox.classList.remove('shown');
    setClass(this.coachMedal, 'on', false);
  }

  /** The Coach medal: open or close the coach box. */
  private toggleCoach(): void {
    if (this.coachBox.classList.contains('shown')) { this.hideCoach(); return; }
    this.coachHidden = false;
    this.showCoach(this.lastCoach ?? {
      kind: 'coach', title: 'Coach',
      lines: this.guide?.enabled
        ? [{ tone: 'info', text: 'The coach is thinking about your next move…' }]
        : [{ tone: 'info', text: 'Turn on the Guide (the star button) and I will explain every move and plan ahead with you. Or press Hint for one tip.' }],
    });
  }

  badge(t: Tactic): void {
    this.badgeQueue.push(t);
    if (!this.badgeBusy) this.nextBadge();
  }

  private nextBadge(): void {
    const t = this.badgeQueue.shift();
    if (!t) { this.badgeBusy = false; return; }
    this.badgeBusy = true;
    sound.play('badge');
    const b = el('div', 'badge rp');
    b.dataset.id = 'badge';
    const isMate = t.id.endsWith('mate');
    b.append(el('div', 'badge-ribbon', isMate ? 'Amazing!' : t.id.startsWith('opening:') ? 'Opening!' : 'Well done!'));
    b.append(el('div', 'badge-name', t.name), el('div', 'badge-text', t.text));
    const burst = el('div', 'badge-burst');
    for (let i = 0; i < 14; i++) {
      const s = el('span', 'burst-star', '★');
      s.style.setProperty('--a', `${(i / 14) * 360}deg`);
      s.style.setProperty('--d', `${6 + (i % 3) * 2.5}em`);
      s.style.animationDelay = `${(i % 4) * 40}ms`;
      burst.append(s);
    }
    b.append(burst);
    // Keep clear of the action: for a checkmate the losing king must stay visible (he surrenders).
    const focus = isMate ? t.squares[1] : t.squares[0];
    let low = false;
    if (focus) {
      const v = this.game.view.toWorld(this.game.view.squarePos(focus, 1)).project(this.game.stage.camera);
      low = (1 - v.y) / 2 < 0.5;
    }
    this.badgeLayer.classList.toggle('low', low);
    this.badgeLayer.replaceChildren(b);
    const done = () => { b.classList.add('leaving'); setTimeout(() => { b.remove(); this.nextBadge(); }, 350); };
    setTimeout(done, isMate ? 3600 : 3000);
  }

  /** Comic pop-up word above a square. */
  pop(text: string, square: string, style: PopStyle): void {
    const a = this.game.view.actorAt(square);
    const p = this.game.view.squarePos(square, a ? a.height + 0.25 : 0.3);
    this.popWorld(text, p, style);
  }

  popWorld(text: string, at: { x: number; y: number; z: number }, style: PopStyle): void {
    const v = this.game.view.toWorld(at).project(this.game.stage.camera); // `at` is in board coordinates
    const w = el('div', `pop-word pop-${style}`);
    const inner = el('span', undefined, text);
    w.append(inner);
    w.style.left = `${((v.x + 1) / 2) * 100}%`;
    w.style.top = `${((1 - v.y) / 2) * 100}%`;
    w.style.setProperty('--tilt', `${(Math.random() * 16 - 8).toFixed(1)}deg`);
    this.popLayer.append(w);
    setTimeout(() => w.remove(), style === 'big' ? 2200 : 1500);
  }

  /** Small speech bubble next to a piece (why a move isn't allowed, or a guide-mode warning). */
  tip(text: string, square: string, warn = false): void {
    this.popLayer.querySelectorAll('.tip').forEach((t) => t.remove());
    const a = this.game.view.actorAt(square);
    const v = this.game.view.toWorld(this.game.view.squarePos(square, (a?.height ?? 0.8) + 0.15)).project(this.game.stage.camera);
    const t = el('div', warn ? 'tip tip-warn' : 'tip');
    t.dataset.id = 'tip';
    t.textContent = text;
    t.style.left = `${((v.x + 1) / 2) * 100}%`;
    t.style.top = `${((1 - v.y) / 2) * 100}%`;
    this.popLayer.append(t);
    setTimeout(() => t.remove(), warn ? 4200 : 2600);
    if (warn) voice.say([text]); // guide-mode warnings are read out too
  }

  // ---------- modals ----------
  private askPromotion(colour: Colour): Promise<PromotionType> {
    return new Promise((resolve) => {
      const box = this.cardShell('Promote your pawn');
      const row = el('div', 'promo-row');
      for (const t of ['q', 'r', 'b', 'n'] as PromotionType[]) {
        const b = el('button', 'promo-btn');
        b.dataset.piece = t;
        const portrait = el('div', 'portrait portrait-small');
        const img = el('img');
        img.src = portraitUrl(colour, t);
        img.alt = '';
        portrait.append(img);
        b.append(portrait, el('span', 'promo-name', PIECE_NAME[t]));
        b.addEventListener('click', (e) => { e.stopPropagation(); sound.play('click'); this.closeModal(); resolve(t); });
        row.append(b);
      }
      box.append(row);
      this.openModal(box);
      (row.firstElementChild as HTMLElement).focus();
    });
  }

  private cardShell(title: string, sub?: string): HTMLDivElement {
    const box = el('div', 'royal-card');
    const ribbon = el('div', 'card-ribbon');
    ribbon.append(el('span', undefined, title));
    box.append(ribbon);
    if (sub) box.append(el('div', 'royal-sub', sub));
    return box;
  }

  private openSettings(): void {
    const panel = buildSettingsPanel({
      settings: this.settings,
      challenges: this.cb.challenges ?? [],
      getStars: this.cb.getStars ?? (() => 0),
      inGame: true,
      record: {
        moves: () => { this.closeModal(); this.togglePanel('moves'); },
        pgn: () => this.exportPgn(),
      },
      onChange: (patch) => {
        this.settings = { ...this.settings, ...patch };
        if (patch.duelMode) this.game.duelMode = patch.duelMode;
        if (patch.coachVoice !== undefined && this.lastCoach && this.coachBox.classList.contains('shown')) this.showCoach(this.lastCoach);
        this.cb.onSettings?.(patch);
        if (patch.guidance !== undefined) this.renderGuideMedal();
      },
      onClose: () => this.closeModal(),
    });
    this.openModal(panel);
    this.game.clock.pause('settings');
  }

  private openPause(): void {
    const box = this.cardShell('Paused', 'The clock is stopped.');
    box.dataset.id = 'pause';
    const acts: [string, () => void, boolean?][] = [['Resume', () => this.closeModal()]];
    // Restart: a fresh game with the same arena, sides and opponent.
    if (this.cb.onRematch) acts.push(['Restart', () => { this.closeModal(); this.cb.onRematch!(); }, true]);
    if (!this.game.ended) {
      acts.push(['Resign', () => {
        this.closeModal();
        const human = this.game.opts.humans.length === 1 ? this.game.opts.humans[0] : this.game.turn;
        this.game.resign(human);
      }, true]);
      if (this.game.opts.humans.length === 2) acts.push(['Offer draw', () => this.offerDraw(), true]);
    }
    if (this.cb.onMenu) acts.push(['Menu', () => this.cb.onMenu!(), true]);
    box.append(this.buttons(acts, true));
    this.openModal(box);
    this.game.clock.pause('settings');
  }

  private buttons(acts: [string, () => void, boolean?][], column = false): HTMLElement {
    const row = el('div', column ? 'card-buttons column' : 'card-buttons');
    for (const [label, fn, quiet] of acts) {
      const b = el('button', `plate-btn${quiet ? ' quiet' : ''}`, label);
      b.dataset.id = label.toLowerCase().replace(/\s+/g, '-');
      b.addEventListener('click', (e) => { e.stopPropagation(); sound.play('click'); fn(); });
      row.append(b);
    }
    return row;
  }

  private offerDraw(): void {
    const other = SIDE_NAME[this.game.turn === 'w' ? 'b' : 'w'];
    const box = this.cardShell('Draw offered', `${other}, do you accept a draw?`);
    box.append(this.buttons([['Accept', () => { this.closeModal(); this.game.agreeDraw(); }], ['Decline', () => this.closeModal(), true]]));
    this.openModal(box);
  }

  private showEnd(r: GameEndInfo): void {
    this.render();
    this.closePanel();
    const extras = this.cb.onEnd?.(r) ?? [];
    let title: string, sub: string;
    if (r.winner) {
      title = `${SIDE_NAME[r.winner]} wins!`;
      sub = ({ checkmate: 'Checkmate', timeout: 'Out of time', resign: 'Resigned' } as Record<string, string>)[r.reason] ?? '';
    } else {
      title = 'Draw';
      sub = ({ stalemate: 'Stalemate', repetition: 'Threefold repetition', 'fifty-move': '50-move rule', 'insufficient-material': 'Insufficient material', 'draw-agreed': 'Agreed draw' } as Record<string, string>)[r.reason] ?? '';
    }
    const box = this.cardShell(title, sub);
    box.dataset.id = 'end-screen';
    box.classList.add('end-card');
    if (r.winner) {
      const portrait = el('div', 'portrait portrait-hero');
      const img = el('img');
      img.src = portraitUrl(r.winner, 'k');
      img.alt = '';
      portrait.append(img);
      box.insertBefore(portrait, box.children[1]);
    }
    const extra = el('div', 'end-extra');
    extra.dataset.id = 'end-extra';
    extra.append(...extras);
    box.append(extra);
    const acts: [string, () => void, boolean?][] = [];
    if (this.cb.onRematch) acts.push(['Rematch', () => this.cb.onRematch!()]);
    if (this.cb.onMenu) acts.push(['Menu', () => this.cb.onMenu!()]);
    acts.push(['View board', () => this.closeModal(), true]);
    box.append(this.buttons(acts));
    // Let the celebrations and the surrender play for a few seconds first.
    setTimeout(() => this.openModal(box), 3600);
  }

  private openModal(content: HTMLElement): void {
    this.modal.replaceChildren(content);
    this.modal.classList.add('open');
  }

  private closeModal(): void {
    this.modal.classList.remove('open');
    this.modal.replaceChildren();
    this.game.clock.resume('settings');
  }

  private exportPgn(): void {
    const blob = new Blob([this.game.pgn()], { type: 'application/x-chess-pgn' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chess-masters-${new Date().toISOString().slice(0, 10)}.pgn`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  dispose(): void {
    voice.stop();
    this.unsub();
    this.root.remove();
  }
}
