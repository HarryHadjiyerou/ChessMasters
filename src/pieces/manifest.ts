import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Colour, PieceType } from '../game/rules';
import { addRim } from './placeholders';

// Loads public/assets/pieces.json (written by `npm run assets`), the character GLBs it lists, and
// public/data/animations.json (which clip each piece uses for each moment). The game only ever
// reaches real models through these, so new Meshy characters or recast animations need no code.

export type Role = 'idle' | 'move' | 'run' | 'attack' | 'victory' | 'defeat' | 'start' | 'win' | 'lose';

export interface PieceRoles {
  idle?: string; move?: string; run?: string; speed?: number; defeat?: string;
  attack?: string[]; victory?: string[]; start?: string[]; win?: string[]; lose?: string[];
}

export interface AnimationRoles {
  heights: Record<PieceType, number>;
  /** Optional sideways scale per piece type (e.g. a thinner rook). */
  widths?: Partial<Record<PieceType, number>>;
  spellClips: string[];
  pieces: Record<string, PieceRoles>;
}

interface ManifestEntry {
  faction: 'light' | 'dark';
  piece: 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
  file: string;
  height: number;
  centaur?: boolean;
  clips: string[];
}

export interface RealPieceSource {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  height: number;
  centaur: boolean;
  roles: PieceRoles;
}

const PIECE_CODE: Record<ManifestEntry['piece'], PieceType> = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' };

export type RealPieceLibrary = Map<string, RealPieceSource>; // key: colour + type, e.g. "wk"

export let ROLES: AnimationRoles | null = null;

/**
 * The Dark faction's outfits are near-black in the Meshy textures and get lost on the dark
 * squares: lift their colours and add a soft purple rim light (materials are shared by every
 * copy of that character, so this runs once per character).
 */
function brightenDark(scene: THREE.Object3D): void {
  const done = new Set<THREE.Material>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
      if (done.has(m) || !m.isMeshStandardMaterial) continue;
      done.add(m);
      m.color.multiplyScalar(1.6);
      addRim(m, 0xa070ff, 0.45);
    }
  });
}

export async function loadRealPieces(onProgress?: (loaded: number, total: number) => void): Promise<RealPieceLibrary> {
  const lib: RealPieceLibrary = new Map();
  let manifest: { pieces: ManifestEntry[] };
  try {
    [manifest, ROLES] = await Promise.all([
      fetch('assets/pieces.json').then((r) => r.json()),
      fetch('data/animations.json').then((r) => r.json()),
    ]);
  } catch {
    return lib; // no manifest: all placeholders
  }
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let done = 0;
  const total = manifest.pieces.length;
  await Promise.all(manifest.pieces.map(async (e) => {
    try {
      const gltf = await loader.loadAsync(e.file);
      const clips = new Map(gltf.animations.map((a) => [a.name, a]));
      const colour: Colour = e.faction === 'light' ? 'w' : 'b';
      if (colour === 'b') brightenDark(gltf.scene);
      lib.set(colour + PIECE_CODE[e.piece], {
        scene: gltf.scene, clips, height: e.height, centaur: !!e.centaur,
        roles: ROLES?.pieces[`${e.faction}_${e.piece}`] ?? {},
      });
    } catch (err) {
      console.warn(`Could not load ${e.file}; using placeholder`, err);
    } finally {
      onProgress?.(++done, total);
    }
  }));
  return lib;
}
