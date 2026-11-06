import { sound } from '../audio/sound';
import { playIntroVideo } from './introVideo';
import { ICONS, type IconName } from './icons';
import type { Settings } from '../game/save';
import { buildSettingsPanel } from './settingsPanel';
import type { ChallengeDef } from '../game/challenges';
import type { PlayLevel } from '../ai/engine';
import type { Colour } from '../game/rules';

// Menu flow over the painted screen images: Start -> Choose Side -> Choose Arena -> Play.
// Buttons are painted into the art, so each is an invisible HTML hotspot (public/data/screens.json,
// percentages of the image) with hover glow, pressed state, click sound and keyboard focus.

interface Rect { left: number; top: number; width: number; height: number }
interface ScreenData { image: string; blur: string; hotspots: Record<string, Rect> }
export interface ScreensJson { image_size: [number, number]; screens: Record<'start' | 'side' | 'arena' | 'play', ScreenData> }

export interface MatchSetup {
  side: Colour;
  arena: ArenaId;
  opponent: 'computer' | 'local';
  level: PlayLevel;
  timeMs: number | null;
  challenge: ChallengeDef | null;
  practice: boolean;
}

export type ArenaId = 'palace-gardens' | 'dark-kingdom' | 'frozen-kingdom' | 'jungle-temple' | 'arabian-palace';
export const ARENAS: { id: ArenaId; name: string }[] = [
  { id: 'palace-gardens', name: 'Palace Gardens' },
  { id: 'dark-kingdom', name: 'Dark Kingdom' },
  { id: 'frozen-kingdom', name: 'Frozen Kingdom' },
  { id: 'jungle-temple', name: 'Jungle Temple' },
  { id: 'arabian-palace', name: 'Arabian Palace' },
];

const LEVEL_NAMES: Record<PlayLevel, string> = { beginner: 'Beginner', easy: 'Easy', medium: 'Medium', hard: 'Hard' };
// Safe region of every screen (logo, buttons and labels), as fractions of the image height.
const SAFE_TOP = 0.03, SAFE_BOTTOM = 0.95;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class Menus {
  readonly root = el('div', 'menu');
  private readonly bg = el('div', 'menu-bg');
  private readonly frame = el('div', 'menu-frame');
  private readonly img = el('img', 'menu-img');
  private readonly layer = el('div', 'menu-layer');
  private readonly modal = el('div', 'menu-modal');
  private current: keyof ScreensJson['screens'] | null = null;
  private side: Colour = 'w';
  private arena: ArenaId = 'palace-gardens';
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  onStartGame: (setup: MatchSetup) => void = () => undefined;
  getPoints: () => number = () => 0;
  getStars: (id: string) => number = () => 0;
  getSettings: () => Settings = () => { throw new Error('getSettings not set'); };
  onSettings: (patch: Partial<Settings>) => void = () => undefined;
  /** Intro video URL (null = none installed) and whether it has played since the game opened. */
  introVideo: string | null = null;
  private introPlayed = false;

  constructor(private readonly data: ScreensJson, private readonly challenges: ChallengeDef[]) {
    this.img.alt = '';
    this.img.draggable = false;
    this.frame.append(this.img, this.layer);
    this.frame.append(this.modal); // inside the frame so sizes scale with it
    this.root.append(this.bg, this.frame);
    window.addEventListener('resize', () => this.fit());
  }

  private fit(): void {
    const [iw, ih] = this.data.image_size;
    const W = window.innerWidth, H = window.innerHeight;
    const aspect = iw / ih;
    // Narrower than the art: fit the width and letterbox top/bottom (blurred fill).
    // Wider: fill the width and crop top/bottom, but never into the safe region; past that
    // point the image shrinks and the sides get the blurred fill instead.
    let w = W, h = W / aspect, top = (H - h) / 2;
    if (h > H) {
      if (H / h < SAFE_BOTTOM - SAFE_TOP) { h = H / (SAFE_BOTTOM - SAFE_TOP); w = h * aspect; }
      top = Math.min(0, Math.max(H - h, H / 2 - ((SAFE_TOP + SAFE_BOTTOM) / 2) * h));
    }
    Object.assign(this.frame.style, { width: `${w}px`, height: `${h}px`, left: `${(W - w) / 2}px`, top: `${top}px`, fontSize: `${Math.max(7, h / 50)}px` }); // scales down to sideways phones
  }

  async show(id: keyof ScreensJson['screens']): Promise<void> {
    const s = this.data.screens[id];
    this.root.classList.add('visible');
    if (this.current) {
      this.frame.classList.add('fading');
      await new Promise((r) => setTimeout(r, 260));
    }
    this.closeModal();
    this.current = id;
    this.img.src = s.image;
    await this.img.decode().catch(() => undefined);
    this.bg.style.backgroundImage = `url("${s.blur}")`;
    this.layer.replaceChildren();
    if (this.keyHandler) { window.removeEventListener('keydown', this.keyHandler); this.keyHandler = null; }
    this.fit();
    ({ start: () => this.buildStart(), side: () => this.buildSide(), arena: () => this.buildArena(), play: () => this.buildPlay() })[id]();
    this.frame.classList.remove('fading');
  }

  async hide(): Promise<void> {
    this.root.classList.add('leaving');
    await new Promise((r) => setTimeout(r, 450));
    this.root.classList.remove('visible', 'leaving');
    if (this.keyHandler) { window.removeEventListener('keydown', this.keyHandler); this.keyHandler = null; }
    this.current = null;
  }

  private hotspot(id: string, label: string, shape: 'hex' | 'tile', onClick: () => void): HTMLButtonElement {
    const r = this.data.screens[this.current!].hotspots[id];
    const b = el('button', `hotspot hotspot-${shape}`);
    b.dataset.id = id;
    b.setAttribute('aria-label', label);
    Object.assign(b.style, { left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%` });
    b.addEventListener('pointerenter', () => sound.play('hover'));
    b.addEventListener('focus', () => sound.play('hover', 0.6));
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    this.layer.append(b);
    return b;
  }

  /** Top-left: Back and Home medallions; top-right: points and the Settings cog. */
  private back(to: keyof ScreensJson['screens']): void {
    const nav = el('div', 'menu-nav');
    const medal = (id: IconName, label: string, fn: () => void) => {
      const wrap = el('div', 'medal-wrap');
      const b = el('button', 'medal');
      b.dataset.id = label.toLowerCase();
      b.setAttribute('aria-label', label);
      b.insertAdjacentHTML('afterbegin', ICONS[id]);
      b.addEventListener('pointerenter', () => sound.play('hover', 0.5));
      b.addEventListener('click', (e) => { e.stopPropagation(); sound.play('click'); fn(); });
      wrap.append(b, el('div', 'medal-label', label));
      nav.append(wrap);
    };
    medal('back', 'Back', () => void this.show(to));
    medal('home', 'Home', () => void this.show('start'));
    this.layer.append(nav);
    const right = el('div', 'menu-right');
    const p = el('div', 'menu-points rp');
    p.insertAdjacentHTML('afterbegin', `<span class="menu-points-star">${ICONS.star}</span>`);
    p.append(el('span', undefined, `${this.getPoints()} points`));
    const cog = el('button', 'medal medal-small');
    cog.dataset.id = 'settings';
    cog.setAttribute('aria-label', 'Settings');
    cog.insertAdjacentHTML('afterbegin', ICONS.settings);
    cog.addEventListener('click', (e) => { e.stopPropagation(); sound.play('click'); this.openSettings(); });
    right.append(p, cog);
    this.layer.append(right);
  }

  private openSettings(): void {
    const panel = buildSettingsPanel({
      settings: this.getSettings(), challenges: this.challenges, getStars: this.getStars,
      onChange: (patch) => this.onSettings(patch), onClose: () => this.closeModal(),
      watchIntro: this.introVideo ? () => { this.closeModal(); void this.playIntro(); } : undefined,
    });
    this.modal.replaceChildren(panel);
    this.modal.classList.add('open');
  }

  private buildStart(): void {
    const prompt = el('div', 'menu-prompt', 'Click to start');
    this.layer.append(prompt);
    const go = async () => {
      sound.play('start');
      if (this.introVideo && !this.introPlayed && this.getSettings().introVideo) await this.playIntro();
      sound.playMusic('menu');
      void this.show('side');
    };
    this.layer.addEventListener('click', go, { once: true });
    this.keyHandler = (e) => { if (e.key !== 'Tab') go(); };
    window.addEventListener('keydown', this.keyHandler, { once: true });
  }

  /** Plays the intro video with the menu music paused. */
  private async playIntro(): Promise<void> {
    if (!this.introVideo) return;
    this.introPlayed = true;
    sound.stopMusic();
    const s = this.getSettings();
    await playIntroVideo(this.introVideo, Math.max(s.musicVolume, s.sfxVolume));
    sound.playMusic('menu');
  }

  private buildSide(): void {
    this.back('start');
    const pick = (c: Colour) => { sound.play('click'); this.side = c; void this.show('arena'); };
    this.hotspot('light', 'Play as Light', 'hex', () => pick('w')).focus();
    this.hotspot('dark', 'Play as Dark', 'hex', () => pick('b'));
  }

  private buildArena(): void {
    this.back('side');
    for (const a of ARENAS) {
      const b = this.hotspot(a.id, a.name, 'tile', () => { sound.play('click'); this.arena = a.id; void this.show('play'); });
      if (a.id === this.arena) b.focus();
    }
  }

  /**
   * Play screen: the painted PLAY button starts the game straight away. Under it, a strip shows
   * the chosen arena and side, with quick options for the opponent and difficulty (the rest is
   * in Settings).
   */
  private buildPlay(): void {
    this.back('arena');
    const s = this.getSettings();
    const strip = el('div', 'play-strip rp');
    strip.dataset.id = 'play-options';
    const arenaName = ARENAS.find((a) => a.id === this.arena)!.name;
    const info = el('div', 'play-info');
    info.append(el('span', 'play-arena', arenaName), el('span', 'play-dot', '\u00B7'), el('span', `play-side side-${this.side}`, this.side === 'w' ? 'Light Kingdom' : 'Dark Kingdom'));
    const seg = <T extends string>(id: string, options: [T, string][], value: T, onPick: (v: T) => void) => {
      const g = el('div', 'seg');
      g.dataset.id = id;
      for (const [v, l] of options) {
        const b = el('button', 'seg-btn', l);
        b.dataset.value = v;
        b.setAttribute('aria-pressed', String(v === value));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          sound.play('click');
          for (const x of g.children) x.setAttribute('aria-pressed', String(x === b));
          onPick(v);
        });
        g.append(b);
      }
      return g;
    };
    const levels = seg<PlayLevel>('level', (Object.keys(LEVEL_NAMES) as PlayLevel[]).map((l) => [l, LEVEL_NAMES[l]]), s.level, (v) => this.onSettings({ level: v }));
    levels.classList.toggle('disabled', s.opponent === 'local');
    const opp = seg<'computer' | 'local'>('opponent', [['computer', 'Computer'], ['local', 'Friend']], s.opponent, (v) => {
      this.onSettings({ opponent: v });
      levels.classList.toggle('disabled', v === 'local');
    });
    const row = el('div', 'play-options');
    row.append(opp, levels);
    strip.append(info, row);
    this.layer.append(strip);
    this.hotspot('play', 'Play', 'hex', () => { sound.play('start'); this.onStartGame(this.setup()); }).focus();
  }

  /** The game to start, from the screens' choices and Settings. */
  private setup(): MatchSetup {
    const s = this.getSettings();
    const challenge = this.challenges.find((c) => c.id === s.challengeId) ?? null;
    return {
      side: this.side, arena: this.arena, opponent: s.opponent, level: s.level,
      timeMs: s.clockMinutes ? s.clockMinutes * 60_000 : null, challenge, practice: !challenge,
    };
  }

  private closeModal(): void {
    this.modal.classList.remove('open');
    this.modal.replaceChildren();
  }
}
