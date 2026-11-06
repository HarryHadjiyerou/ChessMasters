import * as THREE from 'three';
import { isDarkCell } from './boardLayout';

// Procedural marble for the 8x8 playing surface. Texture row 0 is the near edge (world row 0),
// column 0 is world column 0 (a-file for Light), matching a PlaneGeometry laid flat with
// DataTexture's default flipY = false.

export interface MarblePalette {
  light: [number, number, number]; // linear albedo
  lightVein: [number, number, number];
  dark: [number, number, number];
  darkVein: [number, number, number]; // warm gold
}

export const DEFAULT_PALETTE: MarblePalette = {
  light: [0.84, 0.55, 0.44],
  lightVein: [0.46, 0.29, 0.24],
  dark: [0.003, 0.036, 0.11],
  darkVein: [0.46, 0.26, 0.12],
};

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 17);
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

export interface MarbleTextures { map: THREE.DataTexture; metalRough: THREE.DataTexture; normalMap: THREE.DataTexture }

export type Weather = 'none' | 'snow' | 'sand' | 'moss';

/** Weather painted over the marble: snow drifts in the grooves and corners, wind-blown sand, or moss and vines. */
const WEATHER_COLOUR: Record<Exclude<Weather, 'none'>, [number, number, number]> = {
  snow: [0.92, 0.95, 1.0], sand: [0.72, 0.5, 0.3], moss: [0.12, 0.24, 0.06],
};

export function createMarbleTextures(size = 1024, palette = DEFAULT_PALETTE, weather: Weather = 'none'): MarbleTextures {
  const cell = size / 8;
  const albedo = new Uint8Array(size * size * 4);
  const orm = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const toSrgb = (c: number) => Math.round(255 * Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));

  for (let py = 0; py < size; py++) {
    const row = Math.floor(py / cell);
    for (let px = 0; px < size; px++) {
      const col = Math.floor(px / cell);
      const dark = isDarkCell(col, row);
      const seed = col * 8 + row + 1;
      // Each tile is its own slab: random vein angle and offset.
      const ang = hash(col, row, 91) * Math.PI;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const u = px / cell, v = py / cell;
      const ru = u * ca - v * sa;
      const warp = fbm(u * 1.6, v * 1.6, seed, 5);
      const marble = Math.abs(Math.sin((ru * 2.2 + warp * 5.5 + hash(col, row, 7) * 6) * Math.PI));
      const fine = fbm(u * 7, v * 7, seed + 50, 3);
      let vein = Math.pow(1 - marble, dark ? 60 : 30) * (0.4 + 0.6 * fine) * (dark ? 0.6 : 0.5);
      // Crackle network (the painting's dominant pattern): two thin-line noise layers.
      const c1 = Math.abs(fbm(u * 3.4, v * 3.4, seed + 200, 4) - 0.5);
      const c2 = Math.abs(fbm(u * 6.8 + 3.1, v * 6.8, seed + 400, 3) - 0.5);
      const w = dark ? 70 : 48;
      const crack = Math.max(Math.pow(Math.max(0, 1 - c1 * w), 2), 0.6 * Math.pow(Math.max(0, 1 - c2 * w), 2));
      vein = Math.max(vein, crack * (dark ? 0.8 : 0.75));

      const cloud = fbm(u * 2.5, v * 2.5, seed + 300, 4) - 0.5;
      const tileTone = 1 + (hash(col, row, 3) - 0.5) * 0.08;
      const base = dark ? palette.dark : palette.light;
      const vc = dark ? palette.darkVein : palette.lightVein;
      // Soft groove between tiles (wide enough not to alias at board distance)
      const ex = Math.min(px % cell, cell - 1 - (px % cell));
      const ey = Math.min(py % cell, cell - 1 - (py % cell));
      const edge = Math.min(ex, ey);
      const groove = 0.6 + 0.4 * Math.min(1, edge / 3.5);

      const i = (py * size + px) * 4;
      // Weather cover 0..1: gathers in grooves and along the board edge, in patchy drifts.
      let cover = 0;
      if (weather !== 'none') {
        const drift = fbm(u * (weather === 'sand' ? 0.9 : 1.8), v * (weather === 'sand' ? 2.4 : 1.8), 700, 4);
        const speck = fbm(u * 14, v * 14, 800, 2);
        const boardEdge = Math.min(px, py, size - 1 - px, size - 1 - py) / cell; // squares from the rim
        const nearGroove = 1 - Math.min(1, edge / (weather === 'moss' ? 9 : 6));
        const base0 = weather === 'snow' ? 0.62 : weather === 'sand' ? 0.58 : 0.66;
        cover = Math.max(0, (drift - base0) * 4) + nearGroove * (weather === 'sand' ? 0.25 : 0.55) * (drift > 0.45 ? 1 : 0.3);
        cover += Math.max(0, 1 - boardEdge * 2.2) * (weather === 'moss' ? 0.6 : 0.8) * drift;
        if (weather === 'snow' && speck > 0.68) cover += 0.5;
        // Mostly on the light tiles and along the rim, so dark squares stay dark and readable.
        if (dark) cover *= weather === 'moss' ? 0.45 : 0.3;
        cover = Math.min(1, cover);
      }
      const wc = weather === 'none' ? null : WEATHER_COLOUR[weather];
      for (let k = 0; k < 3; k++) {
        const b = base[k] * tileTone * (1 + cloud * (dark ? 0.6 : 0.3));
        let c = (b + (vc[k] - b) * Math.min(1, vein)) * groove;
        if (wc) c += (wc[k] * (0.85 + 0.3 * fine) - c) * cover;
        albedo[i + k] = toSrgb(c);
      }
      albedo[i + 3] = 255;
      const veinMetal = dark ? Math.min(1, vein * 1.4) : 0;
      orm[i] = 255;
      orm[i + 1] = Math.round(255 * Math.min(1, (dark ? 0.42 : 0.38) + 0.12 * fine - veinMetal * 0.1 + (1 - groove) * 0.6 + cover * 0.5));
      orm[i + 2] = Math.round(255 * veinMetal * (1 - cover));
      orm[i + 3] = 255;

      // Bevelled tile edges: slope only along the axis whose edge is nearer.
      const bevel = 7, strength = 0.9;
      let dx = 0, dy = 0;
      if (edge < bevel) {
        const fx = px % cell, fy = py % cell;
        if (ex <= ey) dx = (fx < cell / 2 ? 1 : -1) / bevel;
        else dy = (fy < cell / 2 ? 1 : -1) / bevel;
      }
      const nx = -dx * strength * cell * 0.1, ny = -dy * strength * cell * 0.1;
      const inv = 1 / Math.hypot(nx, ny, 1);
      normal[i] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      normal[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      normal[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      normal[i + 3] = 255;
    }
  }

  const make = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: make(albedo, true), metalRough: make(orm, false), normalMap: make(normal, false) };
}
