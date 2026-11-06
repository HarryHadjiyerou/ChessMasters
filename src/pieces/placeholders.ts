import * as THREE from 'three';
import type { Colour, PieceType } from '../game/rules';

// Classic-silhouette placeholder pieces (lathe geometry) in the concept-art faction palettes.
// Light: ivory, gold trim, red band, ruby gems. Dark: black/gunmetal, silver trim, purple band,
// amethyst gems, plus a purple rim light so they stay readable on dark squares.
// Built facing +z at unit scale; height is in squares.

// Same sizes as public/data/animations.json "heights": pawn about 3/4 of the others, then rook <
// bishop < queen < king < knight (tallest).
export const PIECE_HEIGHT: Record<PieceType, number> = { p: 1.06, r: 1.36, b: 1.44, q: 1.52, k: 1.78, n: 1.86 };

interface FactionMaterials { body: THREE.MeshStandardMaterial; trim: THREE.MeshStandardMaterial; band: THREE.MeshStandardMaterial; gem: THREE.MeshStandardMaterial }

/** Adds a view-dependent rim glow (fresnel) to a standard material. */
export function addRim(mat: THREE.MeshStandardMaterial, colour: THREE.ColorRepresentation, strength: number): void {
  const rimColour = new THREE.Color(colour);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColour = { value: rimColour };
    shader.uniforms.uRimStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColour;\nuniform float uRimStrength;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.6);
        totalEmissiveRadiance += uRimColour * rimF * uRimStrength;`);
  };
  mat.customProgramCacheKey = () => `rim-${rimColour.getHexString()}-${strength}`;
}

let cache: Record<Colour, FactionMaterials> | null = null;

export function factionMaterials(envMap: THREE.Texture | null): Record<Colour, FactionMaterials> {
  if (cache) return cache;
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ envMap, ...p });
  const light: FactionMaterials = {
    body: std({ color: 0xf4e7cf, roughness: 0.38, metalness: 0, envMapIntensity: 0.5 }),
    trim: std({ color: 0xf0c060, roughness: 0.28, metalness: 1, envMapIntensity: 1.2 }),
    band: std({ color: 0xb3141e, roughness: 0.45, metalness: 0, envMapIntensity: 0.4 }),
    gem: std({ color: 0xe0102a, roughness: 0.12, metalness: 0.2, emissive: 0x500008, envMapIntensity: 1.5 }),
  };
  const dark: FactionMaterials = {
    body: std({ color: 0x26232b, roughness: 0.32, metalness: 0.55, envMapIntensity: 0.9 }),
    trim: std({ color: 0xb8b8c8, roughness: 0.3, metalness: 1, envMapIntensity: 1.0 }),
    band: std({ color: 0x4a1d7a, roughness: 0.45, metalness: 0.1, envMapIntensity: 0.5 }),
    gem: std({ color: 0x9a4dff, roughness: 0.12, metalness: 0.2, emissive: 0x3a0f80, envMapIntensity: 1.5 }),
  };
  addRim(dark.body, 0x9b5cff, 0.55);
  addRim(dark.band, 0x9b5cff, 0.35);
  cache = { w: light, b: dark };
  return cache;
}

function lathe(points: [number, number][], segments = 40): THREE.LatheGeometry {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

const BASE: [number, number][] = [
  [0, 0], [0.4, 0], [0.42, 0.015], [0.42, 0.05], [0.39, 0.07], [0.36, 0.08], [0.37, 0.1], [0.34, 0.12],
];

function base(m: FactionMaterials): THREE.Object3D {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(lathe(BASE), m.body));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.385, 0.018, 8, 40), m.trim);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.075;
  g.add(ring);
  return g;
}

function collar(m: FactionMaterials, y: number, r: number, band = true): THREE.Object3D {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 10, 36), m.trim);
  t.rotation.x = Math.PI / 2;
  t.position.y = y;
  g.add(t);
  if (band) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 1.04, 0.05, 36, 1, true), m.band);
    b.position.y = y - 0.05;
    g.add(b);
  }
  return g;
}

function gem(m: FactionMaterials, size: number, pos: [number, number, number]): THREE.Mesh {
  const g = new THREE.Mesh(new THREE.OctahedronGeometry(size, 0), m.gem);
  g.position.set(...pos);
  g.scale.y = 1.3;
  return g;
}

function body(m: FactionMaterials, pts: [number, number][]): THREE.Mesh {
  return new THREE.Mesh(lathe(pts), m.body);
}

function buildPawn(m: FactionMaterials): THREE.Object3D {
  const g = new THREE.Group();
  g.add(base(m));
  g.add(body(m, [[0, 0.12], [0.33, 0.12], [0.26, 0.2], [0.18, 0.34], [0.14, 0.5], [0.13, 0.56], [0, 0.56]]));
  g.add(collar(m, 0.57, 0.2));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 20), m.body);
  head.position.y = 0.76;
  g.add(head);
  g.add(gem(m, 0.04, [0, 0.62, 0.2]));
  return g;
}

function buildRook(m: FactionMaterials): THREE.Object3D {
  const g = new THREE.Group();
  g.add(base(m));
  g.add(body(m, [[0, 0.12], [0.34, 0.12], [0.3, 0.2], [0.26, 0.4], [0.25, 0.62], [0.3, 0.7], [0.33, 0.74], [0.33, 0.86], [0, 0.86]]));
  g.add(collar(m, 0.68, 0.29));
  // Crenellations
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.1), m.body);
    merlon.position.set(Math.sin(a) * 0.27, 0.92, Math.cos(a) * 0.27);
    merlon.rotation.y = a;
    g.add(merlon);
  }
  // Banner with gem on the front
  const banner = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.02), m.band);
  banner.position.set(0, 0.42, 0.265);
  banner.rotation.x = -0.08;
  g.add(banner);
  g.add(gem(m, 0.035, [0, 0.44, 0.285]));
  return g;
}

function buildBishop(m: FactionMaterials): THREE.Object3D {
  const g = new THREE.Group();
  g.add(base(m));
  g.add(body(m, [[0, 0.12], [0.33, 0.12], [0.25, 0.22], [0.17, 0.42], [0.13, 0.58], [0.12, 0.62], [0, 0.62]]));
  g.add(collar(m, 0.63, 0.19));
  // Mitre: tall teardrop
  const mitre = body(m, [[0, 0.62], [0.17, 0.66], [0.2, 0.74], [0.19, 0.84], [0.14, 0.94], [0.07, 1.02], [0, 1.06]]);
  g.add(mitre);
  // Mitre slit and front band
  const slit = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.17, 0.3), m.band);
  slit.position.set(0, 0.92, 0.04);
  slit.rotation.x = 0.35;
  slit.rotation.y = Math.PI / 2;
  g.add(slit);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.02), m.trim);
  stripe.position.set(0, 0.82, 0.18);
  stripe.rotation.x = -0.25;
  g.add(stripe);
  g.add(gem(m, 0.04, [0, 0.8, 0.205]));
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 10), m.trim);
  top.position.y = 1.08;
  g.add(top);
  return g;
}

function crownSpikes(m: FactionMaterials, y: number, r: number, count: number, h: number): THREE.Object3D {
  const g = new THREE.Group();
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, 0.08, 36, 1, true), m.trim);
  band.position.y = y;
  g.add(band);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035, h, 8), m.trim);
    spike.position.set(Math.sin(a) * r, y + 0.04 + h / 2, Math.cos(a) * r);
    g.add(spike);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), m.trim);
    ball.position.set(Math.sin(a) * r, y + 0.04 + h, Math.cos(a) * r);
    g.add(ball);
  }
  return g;
}

function buildQueen(m: FactionMaterials): THREE.Object3D {
  const g = new THREE.Group();
  g.add(base(m));
  g.add(body(m, [[0, 0.12], [0.34, 0.12], [0.26, 0.22], [0.17, 0.45], [0.12, 0.7], [0.12, 0.8], [0, 0.8]]));
  g.add(collar(m, 0.8, 0.18));
  g.add(body(m, [[0, 0.8], [0.16, 0.84], [0.21, 0.92], [0.2, 1.0], [0, 1.0]]));
  g.add(crownSpikes(m, 1.02, 0.19, 9, 0.17));
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 14), m.trim);
  orb.position.y = 1.12;
  g.add(orb);
  g.add(gem(m, 0.045, [0, 1.03, 0.2]));
  g.add(gem(m, 0.035, [0, 0.62, 0.15]));
  return g;
}

function buildKing(m: FactionMaterials): THREE.Object3D {
  const g = new THREE.Group();
  g.add(base(m));
  g.add(body(m, [[0, 0.12], [0.35, 0.12], [0.27, 0.22], [0.18, 0.45], [0.14, 0.72], [0.14, 0.84], [0, 0.84]]));
  g.add(collar(m, 0.84, 0.2));
  g.add(body(m, [[0, 0.84], [0.18, 0.88], [0.23, 0.98], [0.22, 1.06], [0, 1.06]]));
  g.add(crownSpikes(m, 1.08, 0.21, 6, 0.1));
  const capW = 0.06;
  const v = new THREE.Mesh(new THREE.BoxGeometry(capW, 0.3, capW), m.trim);
  v.position.y = 1.3;
  const h = new THREE.Mesh(new THREE.BoxGeometry(0.2, capW, capW), m.trim);
  h.position.y = 1.34;
  g.add(v, h);
  g.add(gem(m, 0.05, [0, 1.09, 0.22]));
  g.add(gem(m, 0.035, [0, 0.64, 0.17]));
  return g;
}

function buildKnight(m: FactionMaterials): THREE.Object3D {
  const g = new THREE.Group();
  g.add(base(m));
  g.add(body(m, [[0, 0.12], [0.33, 0.12], [0.27, 0.2], [0.22, 0.3], [0, 0.3]]));
  g.add(collar(m, 0.3, 0.23));
  // Horse head profile (side view, x = forward, y = up), extruded sideways.
  const s = new THREE.Shape();
  const pts: [number, number][] = [
    [-0.2, 0.3], [0.2, 0.3], [0.16, 0.45], [0.1, 0.55], [0.3, 0.66], [0.36, 0.74], [0.34, 0.82],
    [0.2, 0.86], [0.08, 0.98], [0.02, 1.08], [-0.03, 0.98], [-0.12, 0.96], [-0.2, 0.86], [-0.24, 0.7], [-0.25, 0.5],
  ];
  s.moveTo(...pts[0]);
  for (const p of pts.slice(1)) s.lineTo(...p);
  s.closePath();
  const head = new THREE.Mesh(
    new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 4, curveSegments: 8 }),
    m.body,
  );
  head.geometry.translate(0, 0, -0.1);
  head.rotation.y = -Math.PI / 2; // profile x (forward) -> +z
  g.add(head);
  // Mane (trim) and eyes (gems)
  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.1), m.band);
  mane.position.set(0, 0.78, -0.17);
  mane.rotation.x = 0.35;
  g.add(mane);
  for (const side of [-1, 1]) {
    g.add(gem(m, 0.028, [side * 0.125, 0.82, 0.12]));
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 8), m.body);
    ear.position.set(side * 0.07, 1.05, -0.04);
    ear.rotation.set(-0.25, 0, side * -0.25);
    g.add(ear);
  }
  const bridle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 24), m.trim);
  bridle.position.set(0, 0.72, 0.18);
  bridle.rotation.set(0.9, 0, 0);
  g.add(bridle);
  return g;
}

const BUILDERS: Record<PieceType, (m: FactionMaterials) => THREE.Object3D> = {
  p: buildPawn, r: buildRook, b: buildBishop, q: buildQueen, k: buildKing, n: buildKnight,
};

/** Natural (unit) heights of the builders above, used to scale to PIECE_HEIGHT. */
const NATURAL_HEIGHT: Record<PieceType, number> = { p: 0.96, r: 0.985, b: 1.125, q: 1.19, k: 1.45, n: 1.12 };

export function createPlaceholder(type: PieceType, colour: Colour, envMap: THREE.Texture | null): THREE.Object3D {
  const model = BUILDERS[type](factionMaterials(envMap)[colour]);
  model.scale.setScalar(PIECE_HEIGHT[type] / NATURAL_HEIGHT[type]);
  model.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  model.name = `placeholder-${colour}${type}`;
  return model;
}
