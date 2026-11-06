import * as THREE from 'three';
import type { Stage } from '../scene/Stage';
import { squareToWorld, worldToSquare, type Side } from '../scene/boardLayout';
import { PieceActor } from '../pieces/PieceActor';
import type { RealPieceLibrary } from '../pieces/manifest';
import { Effects } from '../fx/effects';
import { Highlights } from './highlights';
import type { Colour, PieceOnSquare, PieceType } from './rules';

/** 3D pieces, highlights and effects on the Palace Garden board, plus pointer picking. */
export class BoardView {
  readonly group = new THREE.Group();
  readonly highlights = new Highlights();
  readonly fx = new Effects();
  readonly actors = new Map<string, PieceActor>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(readonly stage: Stage, private readonly lib: RealPieceLibrary, readonly side: Side) {
    this.group.name = 'pieces';
    stage.boardRoot.add(this.group, this.highlights.group, this.fx.group);
    stage.board.setSide(side);
    // Home rows: a soft glow along each side's starting edge (light gold for Light, purple for
    // Dark), so it stays clear whose side is whose when the board is turned.
    const near = side, far: Colour = side === 'w' ? 'b' : 'w';
    const glowNear = homeGlow(near, true), glowFar = homeGlow(far, false);
    this.group.add(glowNear, glowFar);
    this.unsubscribe = stage.onUpdate((dt, t) => {
      const pulse = 0.75 + 0.25 * Math.sin(t * 1.6);
      (glowNear.material as THREE.MeshBasicMaterial).opacity = 0.55 * pulse;
      (glowFar.material as THREE.MeshBasicMaterial).opacity = 0.45 * pulse;
      for (const a of this.actors.values()) a.update(dt, t);
      this.highlights.update(t);
      this.fx.update(dt);
    });
  }

  private readonly unsubscribe: () => void;

  dispose(): void {
    this.unsubscribe();
    for (const a of this.actors.values()) a.dispose();
    this.actors.clear();
    this.fx.clear();
    this.group.removeFromParent();
    this.highlights.group.removeFromParent();
    this.fx.group.removeFromParent();
  }

  private get env(): THREE.Texture | null {
    return (this.stage.board.surface.material as THREE.MeshStandardMaterial).envMap;
  }

  squarePos(square: string, y = 0): THREE.Vector3 {
    const { x, z } = squareToWorld(square, this.side);
    return new THREE.Vector3(x, y, z);
  }

  createActor(type: PieceType, colour: Colour, square: string): PieceActor {
    // Variant from the starting square: pawns by file (a-h -> 0-7), others queen's side 0 / king's side 1.
    const file = square.charCodeAt(0) - 97;
    const variant = type === 'p' ? file : file < 4 ? 0 : 1;
    const a = new PieceActor(type, colour, square, this.side, this.env, this.lib.get(colour + type), variant);
    a.root.position.copy(this.squarePos(square));
    this.group.add(a.root);
    return a;
  }

  /** Rebuilds every piece from a position (start, undo, load). */
  setPosition(pieces: PieceOnSquare[]): void {
    for (const a of this.actors.values()) a.dispose();
    this.actors.clear();
    this.fx.clear();
    for (const p of pieces) this.actors.set(p.square, this.createActor(p.type, p.colour, p.square));
  }

  actorAt(square: string): PieceActor | undefined { return this.actors.get(square); }

  /** Moves an actor's map entry (presentation catches up separately). */
  relocate(from: string, to: string): PieceActor | undefined {
    const a = this.actors.get(from);
    if (!a) return undefined;
    this.actors.delete(from);
    a.square = to;
    this.actors.set(to, a);
    return a;
  }

  remove(square: string): void {
    const a = this.actors.get(square);
    if (a) { a.dispose(); this.actors.delete(square); }
  }

  promote(square: string, type: PieceType): void {
    const a = this.actors.get(square);
    if (!a) return;
    a.setModel(type, this.env, this.lib.get(a.colour + type));
    this.fx.promotion(a.root.position);
  }

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  /** Point on the board plane under the pointer, in board coordinates (the board may be turned). */
  planePoint(clientX: number, clientY: number, y = 0): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.stage.camera);
    this.plane.constant = -y * this.stage.boardRoot.scale.y;
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.plane, p) ? this.stage.boardRoot.worldToLocal(p) : null;
  }

  /** Board coordinates -> world (for the camera, screen projection and HUD overlays). */
  toWorld(v: THREE.Vector3 | { x: number; y: number; z: number }): THREE.Vector3 {
    return this.stage.boardRoot.localToWorld(new THREE.Vector3(v.x, v.y, v.z));
  }

  /**
   * Square under the pointer. The board square wins when it holds a piece (so a tall piece in
   * front never steals clicks meant for the square behind it); over an empty square, clicking a
   * piece's body (e.g. a king's crown towering over the next rank) selects that piece.
   */
  pick(clientX: number, clientY: number): { square: string | null; actor?: PieceActor } {
    const planeSq = this.squareAtPlane(clientX, clientY);
    const onPlane = planeSq ? this.actors.get(planeSq) : undefined;
    if (onPlane) return { square: planeSq, actor: onPlane };
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.stage.camera);
    const proxies = [...this.actors.values()].filter((a) => a.root.visible).map((a) => a.hitProxy);
    const hit = this.raycaster.intersectObjects(proxies, false)[0];
    if (hit) {
      const actor = hit.object.userData.actor as PieceActor;
      return { square: actor.square, actor };
    }
    return { square: planeSq };
  }

  /** Client (CSS pixel) position of a square's centre; used by UI tests to click squares. */
  squareToClient(square: string): { x: number; y: number } {
    const v = this.toWorld(this.squarePos(square)).project(this.stage.camera);
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** Square under the board-plane point only (used while dragging). */
  squareAtPlane(clientX: number, clientY: number): string | null {
    const p = this.planePoint(clientX, clientY);
    return p ? worldToSquare(p.x, p.z, this.side) : null;
  }
}

let glowTexture: THREE.CanvasTexture | null = null;

/** Glow band along one edge of the board: brightest at the edge, fading over the home row. */
function homeGlow(colour: Colour, nearEdge: boolean): THREE.Mesh {
  if (!glowTexture) {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 128);
    glowTexture = new THREE.CanvasTexture(c);
  }
  const depth = 0.85;
  const geo = new THREE.PlaneGeometry(8.2, depth).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    color: colour === 'w' ? new THREE.Color(1.6, 1.25, 0.55) : new THREE.Color(1.0, 0.45, 2.0),
  });
  const m = new THREE.Mesh(geo, mat);
  m.name = `home-glow-${colour}`;
  // The texture is brightest at the canvas top, which lies on the strip's -z side. The far edge
  // (z = -4) wants exactly that; the near edge (z = +4) is turned round.
  if (nearEdge) geo.rotateY(Math.PI);
  const z = 4 + 0.06 - depth / 2;
  m.position.set(0, 0.0012, nearEdge ? z : -z);
  m.renderOrder = 1;
  return m;
}
