import * as THREE from 'three';
import { Stage } from './scene/Stage';
import { loadRealPieces, type RealPieceLibrary } from './pieces/manifest';
import { GameController, type GameEndInfo } from './game/GameController';
import { ChallengeTracker, loadChallenges, type ChallengeDef } from './game/challenges';
import { SaveStore, type Settings } from './game/save';
import { ComputerOpponent } from './ai/opponent';
import type { PlayLevel } from './ai/engine';
import { Hud } from './ui/hud';
import { Menus, type MatchSetup, type ScreensJson } from './ui/menus';
import { findIntroVideo } from './ui/introVideo';
import { sound } from './audio/sound';
import { voice } from './audio/voice';
import type { Colour, PieceType } from './game/rules';
import { BoardView } from './game/BoardView';
import { Guide } from './game/guide';
import type { GameEvent } from './game/events';

// Top-level flow: loading screen -> menus -> game -> end screen -> rematch / menu.

const WIN_POINTS: Record<PlayLevel, number> = { beginner: 20, easy: 40, medium: 70, hard: 120 };
const LEVEL_NAME: Record<PlayLevel, string> = { beginner: 'Beginner', easy: 'Easy', medium: 'Medium', hard: 'Hard' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class App {
  private game: GameController | null = null;
  private hud: Hud | null = null;
  private opponent: ComputerOpponent | null = null;
  /** Separate engine worker for the Hint button (kept between games). */
  private hinter: ComputerOpponent | null = null;
  private guide: Guide | null = null;
  private tracker: ChallengeTracker | null = null;
  private lastSetup: MatchSetup | null = null;

  private constructor(
    readonly stage: Stage,
    private readonly lib: RealPieceLibrary,
    readonly menus: Menus,
    readonly save: SaveStore,
    readonly challenges: ChallengeDef[],
  ) {
    menus.onStartGame = (setup) => void this.startGame(setup);
    menus.getPoints = () => this.save.data.points;
    menus.getStars = (id) => this.save.data.stars[id] ?? 0;
    menus.getSettings = () => this.save.data.settings;
    menus.onSettings = (patch) => this.updateSettings(patch);
    this.applySettings(save.data.settings);
  }

  static async boot(progress: (frac: number, label: string) => void): Promise<App> {
    const app = document.getElementById('app')!;
    let done = 0;
    const total = 5;
    const step = <T>(label: string, p: Promise<T>) => p.then((v) => { progress(++done / total, label); return v; });
    const save = new SaveStore();
    const [stage, lib, screens, challenges] = await Promise.all([
      step('Building the Palace Gardens', Stage.create({ container: app })),
      step('Waking the pieces', loadRealPieces()),
      step('Painting the menus', fetch('data/screens.json').then((r) => r.json() as Promise<ScreensJson>)),
      step('Preparing challenges', loadChallenges()),
      step('Tuning the trumpets', sound.init()),
    ]);
    progress(1, 'Polishing the crowns');
    await App.warmUp(stage, lib);
    const menus = new Menus(screens, challenges);
    menus.introVideo = findIntroVideo();
    document.body.appendChild(menus.root);
    return new App(stage, lib, menus, save, challenges);
  }

  /**
   * Compiles every shader the game will need while the loading screen is up. Without this,
   * the first poof or highlight compiles mid-duel and stalls for up to a second on this GPU.
   */
  private static async warmUp(stage: Stage, lib: RealPieceLibrary): Promise<void> {
    const view = new BoardView(stage, lib, 'w');
    const types: PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p'];
    types.forEach((t, i) => {
      view.actors.set(`w${t}`, view.createActor(t, 'w', `${'abcdef'[i]}3`));
      view.actors.set(`b${t}`, view.createActor(t, 'b', `${'abcdef'[i]}6`));
    });
    const p = view.squarePos('d4');
    view.fx.poof(p, 1);
    view.fx.dizzy(p.clone().setY(1));
    view.fx.whiteFlag(p.clone().setY(1.2));
    view.fx.promotion(p);
    const h = view.highlights;
    h.showTargets([{ pos: view.squarePos('e4'), capture: false }, { pos: view.squarePos('e5'), capture: true }]);
    h.setLastMove(view.squarePos('a4'), view.squarePos('b4'));
    h.setSelected(p);
    h.setHover(p);
    h.setCheck(p);
    view.fx.update(0.05);
    try {
      await stage.renderer.compileAsync(stage.scene, stage.camera);
    } catch {
      stage.renderer.compile(stage.scene, stage.camera);
    }
    // three.js frees a shader once no live material uses it, so keep one invisible sprite
    // alive for good; otherwise disposing the warm-up effects throws the sprite shader away.
    const keeper = new THREE.Sprite(new THREE.SpriteMaterial({ map: (view.fx.group.children[0] as THREE.Sprite).material.map, transparent: true, depthWrite: false, opacity: 0 }));
    keeper.scale.setScalar(0.001);
    keeper.name = 'sprite-shader-keeper';
    stage.scene.add(keeper);
    stage.composer.render(0);
    view.dispose();
  }

  private applySettings(s: Settings): void {
    sound.setVolumes(s.sfxVolume, s.musicVolume);
    voice.configure({ enabled: s.coachVoice, voiceName: s.voiceName, rate: s.voiceRate, volume: s.voiceVolume });
    this.stage.setCoordinates(s.coordinates);
    if (this.game) {
      this.game.duelMode = s.duelMode;
      this.game.view.highlights.hintsEnabled = s.moveHints;
    }
    if (this.guide && this.guide.enabled !== s.guidance) this.guide.setEnabled(s.guidance);
  }

  private updateSettings(patch: Partial<Settings>): void {
    this.save.updateSettings(patch);
    this.applySettings(this.save.data.settings);
  }

  async showMenu(screen: 'start' | 'play' = 'start'): Promise<void> {
    this.endGame();
    this.stage.exitGameView();
    sound.playMusic('menu');
    await this.menus.show(screen);
  }

  private endGame(): void {
    voice.stop();
    this.guide?.dispose();
    this.guide = null;
    this.hud?.dispose();
    this.game?.dispose();
    this.opponent?.dispose();
    this.hud = null;
    this.game = null;
    this.opponent = null;
    this.tracker = null;
  }

  async startGame(setup: MatchSetup, fen?: string, intro = true): Promise<void> {
    this.endGame();
    this.lastSetup = setup;
    const s = this.save.data.settings;
    const humans: Colour[] = setup.opponent === 'local' ? ['w', 'b'] : [setup.side];
    await this.stage.setArena(setup.arena);
    this.stage.board.setSide(setup.side);
    this.stage.setBoardTurn(0);
    const game = new GameController(this.stage, this.lib, {
      playerSide: setup.side, humans, timeMs: setup.timeMs, practice: setup.practice, duelMode: s.duelMode, fen,
    });
    this.game = game;
    game.view.highlights.hintsEnabled = s.moveHints;
    if (setup.opponent === 'computer') {
      const opp = new ComputerOpponent(setup.level);
      this.opponent = opp;
      game.computerMove = (fen) => opp.move(fen);
    }
    const cpu = `Computer (${LEVEL_NAME[setup.level]})`;
    const names: Record<Colour, string> = setup.opponent === 'local'
      ? { w: 'Light Player', b: 'Dark Player' }
      : setup.side === 'w' ? { w: 'Player', b: cpu } : { w: cpu, b: 'Player' };
    this.hud = new Hud(game, names, s, {
      onMenu: () => void this.showMenu('play'),
      onRematch: () => void this.startGame(this.lastSetup!),
      onSettings: (patch) => this.updateSettings(patch),
      onEnd: (r) => this.award(r, setup),
      challenges: this.challenges,
      getStars: (id) => this.save.data.stars[id] ?? 0,
    });
    const hud = this.hud;
    this.stage.frame.appendChild(hud.root);
    if (setup.challenge) {
      this.tracker = new ChallengeTracker(setup.challenge, setup.side);
      const t = this.tracker;
      game.events.on((e) => t.handle(e));
      hud.setChallenge(t);
    }
    // Coach / Hint / "Well done!" badges.
    this.guide?.dispose();
    this.guide = new Guide(game, hud, (f, extra, timeMs) => {
      this.hinter ??= new ComputerOpponent('coach');
      return this.hinter.analyse(f, extra, timeMs);
    }, s.guidance);
    const guide = this.guide;
    game.caution = (from, to) => guide.caution(from, to);
    hud.setGuide(this.guide);
    game.events.on((e) => this.react(e, game, hud, setup));
    sound.playMusic('game');
    // Wide shot of the whole arena as the menu fades, then a smooth zoom in on the board. The
    // HUD and the game wait for the zoom so pop-ups land in the right place.
    hud.root.classList.add('intro');
    const zoom = this.stage.enterGameView(intro);
    await this.menus.hide();
    await zoom;
    if (this.hud !== hud) return; // left during the intro
    hud.root.classList.remove('intro');
    game.start();
    this.expose();
  }

  /** Instant feedback for kids: comic pop-up words, cheers and clangs. */
  private react(e: GameEvent, game: GameController, hud: Hud, setup: MatchSetup): void {
    const pick = (words: string[]) => words[Math.floor(Math.random() * words.length)];
    // "Mine" = the human's side; in a local game every capture is someone's triumph.
    const mine = (c: Colour) => setup.opponent === 'local' || c === setup.side;
    switch (e.type) {
      case 'start':
        // Chess rule: Light (white) always moves first.
        if (game.rules.moveCount() === 0) setTimeout(() => hud.popWorld('LIGHT MOVES FIRST!', { x: 0, y: 0.6, z: 0 }, 'info'), 1600);
        break;
      case 'impact': {
        const m = e.move;
        const at = { x: e.at.x, y: 1.25, z: e.at.z };
        if (mine(m.colour)) {
          const special = m.captured === 'q' ? (m.piece === 'p' ? 'WHAT AN UPSET!' : 'QUEEN DOWN!') : m.captured === 'r' ? 'TOWER TOPPLED!' : null;
          hud.popWorld(special ?? pick(['POW!', 'BAM!', 'GOTCHA!', 'KAPOW!', 'WHAM!', 'BOOM!', 'NICE ONE!']), at, 'good');
        } else {
          hud.popWorld(pick(['OUCH!', 'OH NO!', 'BONK!', 'YIKES!', 'UH-OH!']), at, 'bad');
        }
        break;
      }
      case 'capture':
        sound.play(mine(e.move.colour) ? 'cheer' : 'clang', 0.9);
        break;
      case 'cheer':
        sound.play('cheer', 0.6);
        break;
      case 'move':
        if (!e.move.captured) sound.play('move');
        if (e.move.castle) hud.pop('CASTLE!', e.move.to, 'info');
        if (e.move.promotion) { sound.play('sparkle'); hud.pop('PROMOTED!', e.move.to, 'good'); }
        break;
      case 'check':
        sound.play('check');
        hud.pop('CHECK!', game.rules.kingSquare(e.colour), 'warn');
        break;
      case 'invalid':
        sound.play('buzz', 0.7);
        hud.tip(e.reason, e.square);
        break;
      case 'caution':
        sound.play('warn', 0.7);
        game.view.actorAt(e.square)?.shake();
        hud.tip(e.reason, e.square, true);
        break;
      case 'end':
        sound.stopMusic();
        if (e.result.reason === 'checkmate') hud.pop('CHECKMATE!', game.rules.kingSquare(e.result.winner === 'w' ? 'b' : 'w'), 'big');
        break;
    }
  }

  /** Works out and saves points and stars; returns lines for the end screen. */
  private award(r: GameEndInfo, setup: MatchSetup): HTMLElement[] {
    const lines: HTMLElement[] = [];
    const won = r.winner === setup.side;
    const vsComputer = setup.opponent === 'computer';
    if (r.winner && (vsComputer ? won : true)) sound.play('victory');
    else sound.play('draw');
    let total = 0;
    if (vsComputer) {
      this.save.recordGame(won);
      if (won) {
        const p = WIN_POINTS[setup.level];
        total += p;
        const l = el('div', 'end-line');
        l.append(el('span', undefined, `Win against ${LEVEL_NAME[setup.level]}`), el('span', undefined, `+${p}`));
        lines.push(l);
      }
    }
    const t = this.tracker;
    if (t && setup.challenge) {
      if (!t.outcome) t.handle({ type: 'end', result: r }); // HUD may hear 'end' before the tracker
      const o = t.outcome!;
      const l = el('div', `end-line${o.stars ? '' : ' fail'}`);
      l.dataset.id = 'challenge-result';
      const name = el('span', undefined, `${setup.challenge.name}: ${o.reason}`);
      l.append(name, el('span', 'end-stars', '★'.repeat(o.stars) + '☆'.repeat(3 - o.stars)));
      lines.push(l);
      if (o.stars) {
        total += o.points;
        const pl = el('div', 'end-line');
        pl.append(el('span', undefined, 'Challenge points'), el('span', undefined, `+${o.points}`));
        lines.push(pl);
        this.save.awardChallenge(setup.challenge.id, o.stars, 0);
      }
    }
    if (total) this.save.addPoints(total);
    if (vsComputer || t) {
      const tl = el('div', 'end-line end-total');
      tl.dataset.id = 'points-total';
      tl.append(el('span', undefined, 'Total points'), el('span', undefined, String(this.save.data.points)));
      lines.push(tl);
    }
    return lines;
  }

  private expose(): void {
    (window as unknown as { __cm: unknown }).__cm = { app: this, stage: this.stage, game: this.game, lib: this.lib, sound, ready: true };
  }

  /** Test/debug entry: jump straight into a game. */
  async quickStart(setup: Partial<MatchSetup> & { fen?: string; challengeId?: string; intro?: boolean }): Promise<void> {
    const { fen, challengeId, intro = false, ...rest } = setup;
    if (challengeId) { rest.challenge = this.challenges.find((c) => c.id === challengeId) ?? null; rest.practice = false; }
    const full: MatchSetup = { side: 'w', arena: 'palace-gardens', opponent: 'local', level: 'easy', timeMs: null, challenge: null, practice: true, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
    await this.startGame(full, fen, intro);
  }
}
