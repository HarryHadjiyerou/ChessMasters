import * as THREE from 'three';
import { FILES, HALF_BOARD, type Side } from './boardLayout';
import { createMarbleTextures, type MarblePalette, type Weather } from './marble';

export const STRIP_WIDTH = 0.12; // thin 3D gold lip that hides the painting's uneven checker edge
export const FRAME_OUTER = HALF_BOARD + 0.42; // outer edge of the painted gold frame
/** While the board is turned, a 3D gold frame replaces the painted one. Its outer half-size: */
export const TURN_FRAME_OUTER = HALF_BOARD + STRIP_WIDTH + 0.16;

export interface BoardObjects {
  group: THREE.Group;
  surface: THREE.Mesh;
  labels: THREE.Group;
  overlay: THREE.Group;
  /** Shadow catcher over the painted frame (hidden while the board is turned). */
  catcher: THREE.Mesh;
  /** 3D gold frame shown only while the board is turned off its painted position. */
  turnFrame: THREE.Mesh;
  setSide(side: Side): void;
  /** Re-styles the board for an arena (marble colours, weather, gold lip, painted frame width). */
  applyStyle(style: BoardStyle): void;
}

export interface BoardStyle {
  id: string;
  palette: MarblePalette;
  weather: Weather;
  strip: string;
  frameOffset: number;
  envMap: THREE.Texture | null;
}

function shapeOf(inner: number, outer: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-outer, -outer); shape.lineTo(outer, -outer); shape.lineTo(outer, outer); shape.lineTo(-outer, outer);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-inner, -inner); hole.lineTo(-inner, inner); hole.lineTo(inner, inner); hole.lineTo(inner, -inner);
  hole.closePath();
  shape.holes.push(hole);
  return shape;
}

function ring(inner: number, outer: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-outer, -outer); shape.lineTo(outer, -outer); shape.lineTo(outer, outer); shape.lineTo(-outer, outer);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-inner, -inner); hole.lineTo(-inner, inner); hole.lineTo(inner, inner); hole.lineTo(inner, -inner);
  hole.closePath();
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
}

function labelTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = '700 46px Cinzel, Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(70, 30, 8, 0.9)';
  ctx.fillText(text, 32, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createBoard(envMap: THREE.Texture | null): BoardObjects {
  const group = new THREE.Group();
  group.name = 'board';

  const { map, metalRough, normalMap } = createMarbleTextures();
  const surfaceGeo = new THREE.PlaneGeometry(HALF_BOARD * 2, HALF_BOARD * 2);
  surfaceGeo.rotateX(-Math.PI / 2);
  const surface = new THREE.Mesh(
    surfaceGeo,
    new THREE.MeshStandardMaterial({
      map, metalnessMap: metalRough, roughnessMap: metalRough, metalness: 1, roughness: 1, normalMap,
      envMap, envMapIntensity: 0.18,
    }),
  );
  surface.name = 'board-surface';
  surface.receiveShadow = true;
  group.add(surface);

  const strip = new THREE.Mesh(
    ring(HALF_BOARD, HALF_BOARD + STRIP_WIDTH),
    new THREE.MeshStandardMaterial({ color: 0xe8c98e, metalness: 1, roughness: 0.42, envMap, envMapIntensity: 0.75 }),
  );
  strip.name = 'board-strip';
  strip.position.y = 0.001;
  strip.receiveShadow = true;
  group.add(strip);

  // Catches piece shadows on the painted frame without hiding it.
  const catcher = new THREE.Mesh(ring(HALF_BOARD + STRIP_WIDTH, FRAME_OUTER), new THREE.ShadowMaterial({ opacity: 0.45 }));
  catcher.name = 'frame-shadow-catcher';
  catcher.receiveShadow = true;
  group.add(catcher);

  // Bevelled gold frame for when the board is turned (the painted one stays behind).
  const turnFrame = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shapeOf(HALF_BOARD + STRIP_WIDTH - 0.01, TURN_FRAME_OUTER), { depth: 0.06, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 2 }).rotateX(-Math.PI / 2).translate(0, -0.035, 0),
    new THREE.MeshStandardMaterial({ color: 0xf0c674, metalness: 1, roughness: 0.32, envMap, envMapIntensity: 1.0 }),
  );
  turnFrame.name = 'turn-frame';
  turnFrame.castShadow = true;
  turnFrame.receiveShadow = true;
  turnFrame.visible = false;
  group.add(turnFrame);

  // Coordinates on the painted frame: ranks on the player's left, files along the near edge.
  const labels = new THREE.Group();
  labels.name = 'coordinates';
  const labelGeo = new THREE.PlaneGeometry(0.26, 0.26);
  labelGeo.rotateX(-Math.PI / 2);
  const mid = HALF_BOARD + STRIP_WIDTH + (FRAME_OUTER - HALF_BOARD - STRIP_WIDTH) / 2;
  const fileMats: THREE.MeshBasicMaterial[] = [];
  const rankMats: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < 8; i++) {
    const fm = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const f = new THREE.Mesh(labelGeo, fm);
    f.position.set(-HALF_BOARD + i + 0.5, 0.002, mid);
    labels.add(f);
    fileMats.push(fm);
    const rm = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const r = new THREE.Mesh(labelGeo, rm);
    r.position.set(-mid, 0.002, HALF_BOARD - i - 0.5);
    labels.add(r);
    rankMats.push(rm);
  }
  group.add(labels);

  const setSide = (side: Side) => {
    for (let i = 0; i < 8; i++) {
      const file = side === 'w' ? i : 7 - i;
      const rank = side === 'w' ? i : 7 - i;
      fileMats[i].map?.dispose();
      fileMats[i].map = labelTexture(FILES[file]);
      fileMats[i].needsUpdate = true;
      rankMats[i].map?.dispose();
      rankMats[i].map = labelTexture(String(rank + 1));
      rankMats[i].needsUpdate = true;
    }
  };
  setSide('w');

  const marbleCache = new Map<string, ReturnType<typeof createMarbleTextures>>();
  const applyStyle = (st: BoardStyle) => {
    let tex = marbleCache.get(st.id);
    if (!tex) { tex = createMarbleTextures(1024, st.palette, st.weather); marbleCache.set(st.id, tex); }
    const sm = surface.material as THREE.MeshStandardMaterial;
    Object.assign(sm, { map: tex.map, metalnessMap: tex.metalRough, roughnessMap: tex.metalRough, normalMap: tex.normalMap, envMap: st.envMap });
    sm.needsUpdate = true;
    const stm = strip.material as THREE.MeshStandardMaterial;
    stm.color.set(st.strip);
    stm.envMap = st.envMap;
    stm.needsUpdate = true;
    const tfm = turnFrame.material as THREE.MeshStandardMaterial;
    tfm.color.set(st.strip).offsetHSL(0, 0.05, 0.04);
    tfm.envMap = st.envMap;
    tfm.needsUpdate = true;
    // Shadow catcher and coordinates follow the painted frame's width.
    const outer = HALF_BOARD + st.frameOffset;
    catcher.geometry.dispose();
    catcher.geometry = ring(HALF_BOARD + STRIP_WIDTH, outer);
    const band = outer - HALF_BOARD - STRIP_WIDTH;
    const m = HALF_BOARD + STRIP_WIDTH + band / 2;
    const size = Math.min(0.26, band * 1.1);
    labels.children.forEach((c, i) => {
      const k = Math.floor(i / 2);
      if (i % 2 === 0) c.position.set(-HALF_BOARD + k + 0.5, 0.002, m);
      else c.position.set(-m, 0.002, HALF_BOARD - k - 0.5);
      c.scale.setScalar(size / 0.26);
    });
  };

  // Alignment overlay: the 3D grid lines as thin strips, shown only in the overlay test.
  const overlay = new THREE.Group();
  overlay.name = 'alignment-overlay';
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
  const lineW = 0.035;
  for (let i = 0; i <= 8; i++) {
    const t = -HALF_BOARD + i;
    const a = new THREE.Mesh(new THREE.PlaneGeometry(lineW, HALF_BOARD * 2 + lineW).rotateX(-Math.PI / 2), lineMat);
    a.position.set(t, 0.004, 0);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(HALF_BOARD * 2 + lineW, lineW).rotateX(-Math.PI / 2), lineMat);
    b.position.set(0, 0.004, t);
    overlay.add(a, b);
  }
  overlay.visible = false;
  group.add(overlay);

  return { group, surface, labels, overlay, catcher, turnFrame, setSide, applyStyle };
}
