import * as THREE from 'three';
import { BloomEffect, EffectComposer, EffectPass, SMAAEffect, SMAAPreset, VignetteEffect } from 'postprocessing';
import { MatchedCamera, type CameraData, type ViewRect } from './MatchedCamera';

const sameView = (a: ViewRect, b: ViewRect) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
import { CompositePass } from './CompositePass';
import { sound } from '../audio/sound';
import { createBoard, type BoardObjects } from './board';
import { Ambience, type AmbienceKind } from './ambience';
import type { MarblePalette, Weather } from './marble';
import { HALF_BOARD } from './boardLayout';
import { FRAME_OUTER, TURN_FRAME_OUTER } from './board';

const SCENE_DIR = 'assets/scene/';

/** One arena's look (public/data/arenas.json). */
export interface ArenaStyle {
  name: string; prefix: string; frameOffset: number;
  glows: [number, number, number][];
  palette: MarblePalette; weather: Weather; strip: string; cover: string;
  hemi: [string, string, number]; sun: [string, number, [number, number, number]]; rim: [string, number, [number, number, number]];
  grade: { gain: [number, number, number]; lift: [number, number, number]; exposure: number };
  ambience: AmbienceKind;
}

interface ArenaAssets { cam: CameraData; bg: THREE.Texture; fg: THREE.Texture; env: THREE.Texture }

export interface StageOptions { container: HTMLElement; maxPixelRatio?: number }

/**
 * The arena: fixed matched camera, image plates, 3D board, lights and post-processing. Arenas
 * (Palace Gardens, Dark Kingdom, ...) are switched with setArena(); each has its own painting,
 * solved camera, board style, lighting and ambient particles.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: MatchedCamera;
  readonly composite: CompositePass;
  readonly composer: EffectComposer;
  readonly board: BoardObjects;
  readonly sun: THREE.DirectionalLight;
  readonly boardRoot = new THREE.Group();
  /** Static plinth top that hides the painted board while the 3D board is turned. */
  private turnCover: THREE.Group;
  /** Current board turn in degrees (0 = the painting's own angle). */
  boardTurn = 0;
  private coordinatesWanted = true;
  ambience: Ambience;
  arenaId = '';
  arenas: Record<string, ArenaStyle> = {};
  private readonly hemi: THREE.HemisphereLight;
  private readonly rim: THREE.DirectionalLight;
  private frameOuter = FRAME_OUTER;
  private readonly arenaCache = new Map<string, Promise<ArenaAssets>>();
  readonly frame: HTMLDivElement;
  private readonly timer = new THREE.Timer();
  private readonly updaters = new Set<(dt: number, t: number) => void>();
  private readonly maxPixelRatio: number;
  fps = 0;
  private fpsFrames = 0;
  private fpsTime = 0;

  static async create(opts: StageOptions): Promise<Stage> {
    const [arenas, camData, bg, fg] = await Promise.all([
      fetch('data/arenas.json').then((r) => r.json()).then((d) => d.arenas as Record<string, ArenaStyle>),
      fetch(SCENE_DIR + 'palace_garden_camera.json').then((r) => r.json() as Promise<CameraData>),
      loadTexture('palace_garden_bg.webp'),
      loadTexture('palace_garden_fg.webp'),
    ]);
    await document.fonts?.load('700 46px Cinzel').catch(() => undefined);
    const stage = new Stage(opts, camData, bg, fg);
    stage.arenas = arenas;
    await stage.setArena('palace-gardens');
    return stage;
  }

  /** Loads (once) an arena's camera, plates and reflection map. */
  private loadArena(id: string): Promise<ArenaAssets> {
    let p = this.arenaCache.get(id);
    if (!p) {
      const a = this.arenas[id];
      p = Promise.all([
        fetch(`${SCENE_DIR}${a.prefix}_camera.json`).then((r) => r.json() as Promise<CameraData>),
        loadTexture(`${a.prefix}_bg.webp`),
        loadTexture(`${a.prefix}_fg.webp`),
      ]).then(([cam, bg, fg]) => {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const src = bg.clone();
        src.mapping = THREE.EquirectangularReflectionMapping;
        const env = pmrem.fromEquirectangular(src).texture;
        pmrem.dispose();
        return { cam, bg, fg, env };
      });
      this.arenaCache.set(id, p);
    }
    return p;
  }

  /** Switches the whole scene to another arena. */
  async setArena(id: string): Promise<void> {
    if (id === this.arenaId || !this.arenas[id]) return;
    const a = this.arenas[id];
    const { cam, bg, fg, env } = await this.loadArena(id);
    this.arenaId = id;
    this.camera.setData(cam);
    const u = this.composite.material.uniforms;
    u.tBg.value = bg;
    u.tFg.value = fg;
    u.uGradeGain.value.fromArray(a.grade.gain);
    u.uGradeLift.value.fromArray(a.grade.lift);
    u.uExposure.value = a.grade.exposure;
    this.composite.setGlows(a.glows);
    this.container.style.backgroundImage = `url("${new URL(`${SCENE_DIR}${a.prefix}_blur.jpg`, document.baseURI).href}")`;
    this.board.applyStyle({ id, palette: a.palette, weather: a.weather, strip: a.strip, frameOffset: a.frameOffset, envMap: env });
    this.envMap = env;
    this.hemi.color.set(a.hemi[0]); this.hemi.groundColor.set(a.hemi[1]); this.hemi.intensity = a.hemi[2];
    this.sun.color.set(a.sun[0]); this.sun.intensity = a.sun[1]; this.sun.position.fromArray(a.sun[2]);
    this.rim.color.set(a.rim[0]); this.rim.intensity = a.rim[1]; this.rim.position.fromArray(a.rim[2]);
    this.frameOuter = HALF_BOARD + a.frameOffset;
    const k = this.frameOuter / FRAME_OUTER;
    this.turnCover.scale.set(k, 1, k);
    ((this.turnCover.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set(a.cover);
    const wasEnabled = this.ambience.enabled;
    this.ambience.canvas.remove();
    this.ambience = new Ambience(this.camera, a.ambience, a.glows);
    this.ambience.enabled = wasEnabled;
    this.ambience.onGust = () => { if (this.fill) sound.play('wind', 0.45); };
    this.frame.appendChild(this.ambience.canvas);
    this.resize();
    this.setBoardTurn(this.boardTurn);
  }

  /** Reflection map of the current arena (for new pieces). */
  envMap: THREE.Texture | null = null;
  private container!: HTMLElement;

  private constructor(opts: StageOptions, camData: CameraData, bg: THREE.Texture, fg: THREE.Texture) {
    this.maxPixelRatio = opts.maxPixelRatio ?? 1.5;
    this.container = opts.container;
    opts.container.classList.add('stage-root');
    this.frame = document.createElement('div');
    this.frame.className = 'stage-frame';
    opts.container.appendChild(this.frame);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in r18x; shadow.radius softens PCF
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in CompositePass
    this.frame.appendChild(this.renderer.domElement);

    this.camera = new MatchedCamera(camData);

    // Warm reflections for gold and marble, derived from the backdrop itself.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envSrc = bg.clone();
    envSrc.mapping = THREE.EquirectangularReflectionMapping;
    const env = pmrem.fromEquirectangular(envSrc).texture;
    pmrem.dispose();

    this.board = createBoard(env);
    // Everything on the board (surface, pieces, highlights, effects) lives in boardRoot so the
    // board can be turned; the painting and the plinth stay put.
    this.boardRoot.name = 'board-root';
    this.boardRoot.add(this.board.group);
    this.scene.add(this.boardRoot);
    this.turnCover = createTurnCover();
    this.turnCover.visible = false;
    this.scene.add(this.turnCover);

    // Light matched to the painting: low warm sun from the a-file side (pillar faces turned that
    // way are lit, faces towards the stairs are shaded), warm sky fill, pink-gold sunset rim from
    // the far right where the sky glows.
    this.hemi = new THREE.HemisphereLight(0xffc796, 0x5e3d24, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffb878, 3.0);
    this.sun.position.set(-9, 8.5, 3.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = HALF_BOARD + 1.5;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 30 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target);
    this.rim = new THREE.DirectionalLight(0xff9a6a, 1.2);
    this.rim.position.set(8, 4, -9);
    this.scene.add(this.rim);

    this.ambience = new Ambience(this.camera);
    this.frame.appendChild(this.ambience.canvas);

    this.composite = new CompositePass(this.scene, this.camera, bg, fg);
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(this.composite);
    this.composer.addPass(new EffectPass(this.camera,
      new BloomEffect({ luminanceThreshold: 0.82, luminanceSmoothing: 0.12, intensity: 0.35, mipmapBlur: true, radius: 0.6 }),
      new VignetteEffect({ offset: 0.32, darkness: 0.42 }),
    ));
    this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** In a game the canvas fills the whole window and the view closes in on the board. */
  private fill = false;
  private zoomAnim: { from: ViewRect; t: number; done: () => void } | null = null;
  /** Seconds the wide shot holds before the zoom (covers the menu fading out), and the zoom. */
  private static readonly INTRO_HOLD = 0.5;
  private static readonly INTRO_ZOOM = 1.4;

  /** Image area (px) that must stay visible in the game view: the board and the pieces on it. */
  private static readonly FOCUS = { x0: 255, y0: 30, x1: 1360, y1: 840 };

  /** Largest view of the given aspect that shows FOCUS, centred on it, inside the image. */
  private gameView(aspect: number, focus = Stage.FOCUS): ViewRect {
    const IW = this.camera.imageWidth, IH = this.camera.imageHeight;
    const fw = focus.x1 - focus.x0, fh = focus.y1 - focus.y0;
    let w = fw, h = fw / aspect;
    if (h < fh) { h = fh; w = fh * aspect; }
    if (w > IW) { w = IW; h = w / aspect; }
    if (h > IH) { h = IH; w = h * aspect; }
    const cx = (focus.x0 + focus.x1) / 2, cy = (focus.y0 + focus.y1) / 2;
    return { x: Math.min(Math.max(cx - w / 2, 0), IW - w), y: Math.min(Math.max(cy - h / 2, 0), IH - h), w, h };
  }

  /**
   * Game start: fill the window with the widest full-screen view of the painting (never any
   * bars or a change of shape), then zoom smoothly in on the board. On very wide windows the
   * board view already is that widest view, so there is no zoom. Resolves when it is done.
   */
  enterGameView(animate = true): Promise<void> {
    this.zoomAnim?.done();
    this.zoomAnim = null;
    this.fill = true;
    this.resize();
    if (!animate) return Promise.resolve();
    const home = this.camera.homeView!;
    const IW = this.camera.imageWidth, IH = this.camera.imageHeight;
    const a = home.w / home.h;
    // The largest view of the window's shape that stays inside the painting.
    const w = Math.min(IW, IH * a), h = w / a;
    if (w < home.w * 1.04) return Promise.resolve(); // too little room to zoom: start on the board
    return new Promise((done) => {
      this.zoomAnim = { from: { x: (IW - w) / 2, y: (IH - h) / 2, w, h }, t: -Stage.INTRO_HOLD / Stage.INTRO_ZOOM, done };
      this.camera.setView(this.zoomAnim.from);
    });
  }

  /** Back to the menus' framing (whole image, letterboxed). */
  exitGameView(): void {
    this.fill = false;
    this.zoomAnim?.done();
    this.zoomAnim = null;
    this.camera.homeView = null;
    this.camera.resetView();
    this.resize();
  }

  /** Fits the frame into the window. Menus: the whole 3:2 image with a blurred letterbox. Game:
   *  the whole window, showing a board close-up of the window's shape. */
  resize(): void {
    const parent = this.frame.parentElement!;
    const W = parent.clientWidth, H = parent.clientHeight;
    const aspect = this.camera.imageWidth / this.camera.imageHeight;
    let w = W, h = W / aspect;
    if (h > H) { h = H; w = H * aspect; }
    if (this.fill) {
      w = W; h = H;
      const atHome = !this.camera.homeView || sameView(this.camera.viewRect, this.camera.homeView);
      this.camera.homeView = this.gameView(W / H);
      if (atHome && !this.zoomAnim) this.camera.resetView();
    }
    w = Math.floor(w); h = Math.floor(h);
    Object.assign(this.frame.style, {
      width: `${w}px`, height: `${h}px`, left: `${Math.floor((W - w) / 2)}px`, top: `${Math.floor((H - h) / 2)}px`,
      fontSize: `${Math.max(6, h / 66).toFixed(2)}px`, // UI scales with the frame (down to sideways phones)
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.composer.setSize(w, h, false);
    this.ambience.resize(w, h, Math.min(window.devicePixelRatio || 1, 1.25));
  }

  onUpdate(fn: (dt: number, t: number) => void): () => void {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  /**
   * Turns the board (degrees, -180..180). At multiples of 90 the 3D board lines up with the
   * painting exactly. In between, a plain plinth top covers the painted board, a 3D gold frame
   * replaces the painted one, and the board shrinks just enough to stay on the plinth.
   */
  setBoardTurn(deg: number): void {
    this.boardTurn = deg;
    const r = THREE.MathUtils.degToRad(deg);
    const off = Math.abs(((deg % 90) + 90) % 90);
    const aligned = Math.min(off, 90 - off) < 0.5;
    const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
    const scale = aligned ? 1 : Math.min(1, (this.frameOuter - 0.12) / (TURN_FRAME_OUTER * (c + s)));
    this.boardRoot.rotation.y = r;
    this.boardRoot.scale.setScalar(scale);
    this.turnCover.visible = !aligned;
    this.board.turnFrame.visible = !aligned;
    this.board.catcher.visible = aligned;
    this.board.labels.visible = aligned && this.coordinatesWanted;
  }

  private turnAnim: { from: number; to: number; t: number } | null = null;

  /** Turns the board to a 90-degree position with a short animation (it "clicks" into place). */
  turnBoardTo(deg: number): void {
    this.turnAnim = { from: this.boardTurn, to: deg, t: 0 };
  }

  /** Coordinates on/off (only shown while the board sits on its painted frame). */
  setCoordinates(on: boolean): void {
    this.coordinatesWanted = on;
    this.setBoardTurn(this.boardTurn);
  }

  setOverlayTest(on: boolean): void {
    this.board.overlay.visible = on;
    this.board.surface.visible = !on;
    this.board.group.getObjectByName('board-strip')!.visible = !on;
    this.board.labels.visible = !on;
    this.composite.material.uniforms.uSceneOpacity.value = on ? 0.5 : 1;
  }

  /** Corner alignment check: projected 3D board corners vs the measured image corners (px). */
  cornerErrors(): Record<string, number> {
    const d = this.camera.data;
    const world: Record<string, THREE.Vector3> = {
      a1: new THREE.Vector3(-HALF_BOARD, 0, HALF_BOARD), h1: new THREE.Vector3(HALF_BOARD, 0, HALF_BOARD),
      h8: new THREE.Vector3(HALF_BOARD, 0, -HALF_BOARD), a8: new THREE.Vector3(-HALF_BOARD, 0, -HALF_BOARD),
    };
    const out: Record<string, number> = {};
    for (const k of Object.keys(world) as (keyof typeof world)[]) {
      const [x, y] = this.camera.toImagePx(world[k]);
      const [mx, my] = d.image_corners[k as 'a1'];
      out[k] = Math.hypot(x - mx, y - my);
    }
    return out;
  }

  private tick(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const t = this.timer.getElapsed();
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) { this.fps = this.fpsFrames / this.fpsTime; this.fpsFrames = 0; this.fpsTime = 0; }
    if (this.zoomAnim && this.camera.homeView) {
      const z = this.zoomAnim;
      z.t = Math.min(1, z.t + dt / Stage.INTRO_ZOOM);
      const p = Math.max(0, z.t);
      const k = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // ease in-out cubic
      const to = this.camera.homeView;
      this.camera.setView({ x: z.from.x + (to.x - z.from.x) * k, y: z.from.y + (to.y - z.from.y) * k, w: z.from.w + (to.w - z.from.w) * k, h: z.from.h + (to.h - z.from.h) * k });
      if (z.t >= 1) { this.zoomAnim = null; z.done(); }
    }
    if (this.turnAnim) {
      const a = this.turnAnim;
      a.t = Math.min(1, a.t + dt / 0.55);
      // Ease-out with a small overshoot, then settle: a satisfying click into place.
      const k = 1 + 2.2 * Math.pow(a.t - 1, 3) + 1.2 * Math.pow(a.t - 1, 2);
      this.setBoardTurn(a.t >= 1 ? a.to : a.from + (a.to - a.from) * k);
      if (a.t >= 1) this.turnAnim = null;
    }
    this.ambience.update(dt, t);
    for (const fn of this.updaters) fn(dt, t);
    this.composer.render(dt);
  }
}

/** Plain stone plinth top with a gold rim, covering the painted board area (static). */
function createTurnCover(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'turn-cover';
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(FRAME_OUTER * 2, FRAME_OUTER * 2).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x8c7660, roughness: 0.92 }), // matte stone, darker than the squares
  );
  top.position.y = -0.02;
  top.receiveShadow = true;
  const rimShape = new THREE.Shape();
  const o = FRAME_OUTER, i = FRAME_OUTER - 0.1;
  rimShape.moveTo(-o, -o); rimShape.lineTo(o, -o); rimShape.lineTo(o, o); rimShape.lineTo(-o, o); rimShape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-i, -i); hole.lineTo(-i, i); hole.lineTo(i, i); hole.lineTo(i, -i); hole.closePath();
  rimShape.holes.push(hole);
  const rim = new THREE.Mesh(new THREE.ShapeGeometry(rimShape).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe0b462, metalness: 1, roughness: 0.4 }));
  rim.position.y = -0.015;
  g.add(top, rim);
  return g;
}

function loadTexture(file: string): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(SCENE_DIR + file).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return t;
  });
}
