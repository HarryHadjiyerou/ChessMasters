import * as THREE from 'three';

// Square highlights drawn on the board plane: legal-move dots, capture rings, last move,
// selection, hover and the red check glow under the king. Additive, unlit, pooled.

function radialTexture(draw: (ctx: CanvasRenderingContext2D, s: number) => void, size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const dotTex = () => radialTexture((ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(255,240,200,0.95)');
  g.addColorStop(0.42, 'rgba(255,200,90,0.35)');
  g.addColorStop(1, 'rgba(255,180,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

const ringTex = () => radialTexture((ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.28, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,90,60,0)');
  g.addColorStop(0.55, 'rgba(255,140,90,1)');
  g.addColorStop(0.75, 'rgba(255,90,50,0.6)');
  g.addColorStop(1, 'rgba(255,60,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

const squareTex = () => radialTexture((ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.72);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

const glowTex = () => radialTexture((ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,60,40,1)');
  g.addColorStop(0.5, 'rgba(255,30,20,0.5)');
  g.addColorStop(1, 'rgba(255,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

/**
 * Flat arrow on the board plane from one square centre to another. UV: x = distance along the
 * arrow in squares, y = -1..1 across it (for the animated chevrons in the shader).
 */
function arrowGeometry(from: { x: number; z: number }, to: { x: number; z: number }): THREE.BufferGeometry {
  const dx = to.x - from.x, dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  const start = 0.18, end = len - 0.12;
  const shaft = 0.17, head = 0.42, headLen = Math.min(0.55, (end - start) * 0.6);
  const pts: [number, number][] = [
    [start, -shaft], [end - headLen, -shaft], [end - headLen, -head], [end, 0],
    [end - headLen, head], [end - headLen, shaft], [start, shaft],
  ];
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ShapeGeometry(shape);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i); uv[i * 2 + 1] = pos.getY(i) / head; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // Local x along the arrow, y across -> world: rotate onto XZ, then aim and place.
  g.rotateX(-Math.PI / 2);
  g.rotateY(-Math.atan2(dz, dx));
  g.translate(from.x, 0, from.z);
  return g;
}

export class Highlights {
  readonly group = new THREE.Group();
  private readonly dots: THREE.Mesh[] = [];
  private readonly rings: THREE.Mesh[] = [];
  private readonly lastMove: THREE.Mesh[];
  private readonly selected: THREE.Mesh;
  private readonly hover: THREE.Mesh;
  private readonly check: THREE.Mesh;
  private readonly hint: THREE.Mesh[];
  private readonly dotMat: THREE.MeshBasicMaterial;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  hintsEnabled = true;

  constructor() {
    this.group.name = 'highlights';
    const additive = (map: THREE.Texture, colour: number, opacity = 1) =>
      new THREE.MeshBasicMaterial({ map, color: colour, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    this.dotMat = additive(dotTex(), 0xffffff, 0.9);
    this.dotMat.color.setRGB(2.4, 2.0, 1.3); // HDR so the dots glow through tone mapping
    this.ringMat = additive(ringTex(), 0xffffff, 1);
    this.ringMat.color.setRGB(2.0, 1.5, 1.2);
    const sq = squareTex();
    this.lastMove = [0, 1].map(() => this.mesh(additive(sq, 0xffb347, 0.35), 0.0015));
    this.selected = this.mesh(additive(sq, 0x7fd6ff, 0.5), 0.0016);
    this.hover = this.mesh(additive(sq, 0xffffff, 0.18), 0.0014);
    this.check = this.mesh(additive(glowTex(), 0xffffff, 1), 0.0018);
    this.check.scale.setScalar(1.5);
    this.hint = [0, 1].map(() => {
      const m = this.mesh(additive(sq, 0x66ff99, 0.6), 0.0017);
      (m.material as THREE.MeshBasicMaterial).color.setRGB(0.6, 2.2, 1.1);
      return m;
    });
  }

  /** Suggested move (Hint / coach): pulsing squares plus a big animated arrow. */
  setHint(from: { x: number; z: number } | null, to: { x: number; z: number } | null): void {
    this.place(this.hint[0], from);
    this.place(this.hint[1], to);
    if (this.arrow) { this.group.remove(this.arrow); this.arrow.geometry.dispose(); this.arrow = null; }
    if (from && to) {
      this.arrow = new THREE.Mesh(arrowGeometry(from, to), this.arrowMat);
      this.arrow.position.y = 0.02;
      this.arrow.renderOrder = 10; // drawn over the pieces so it can't be missed
      this.group.add(this.arrow);
    }
  }

  /** Pieces in danger (guidance mode): pulsing red squares. */
  setDanger(squares: { x: number; z: number }[]): void {
    while (this.danger.length < squares.length) {
      const m = this.mesh(this.dangerMat, 0.0019);
      this.danger.push(m);
    }
    this.danger.forEach((m, i) => this.place(m, squares[i] ?? null));
  }

  private arrow: THREE.Mesh | null = null;
  private readonly danger: THREE.Mesh[] = [];
  private readonly dangerMat = new THREE.MeshBasicMaterial({ map: squareTex(), color: new THREE.Color(2.4, 0.25, 0.2), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  private readonly arrowMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv;
      void main() {
        // vUv.x = distance along the arrow (squares), vUv.y = 0 at the centre line, 1 at the edge.
        float chevron = fract(vUv.x * 1.6 - abs(vUv.y) * 0.5 - uTime * 1.4);
        float bands = smoothstep(0.0, 0.15, chevron) * (1.0 - smoothstep(0.45, 0.6, chevron));
        float edge = 1.0 - smoothstep(0.75, 1.0, abs(vUv.y));
        vec3 base = vec3(0.7, 2.6, 0.95);
        vec3 col = base * (0.6 + 0.9 * bands) + vec3(1.0) * bands * 0.35;
        gl_FragColor = vec4(col, edge * (0.62 + 0.38 * bands));
      }`,
  });

  private mesh(mat: THREE.Material, y: number): THREE.Mesh {
    const m = new THREE.Mesh(this.geo, mat);
    m.position.y = y;
    m.visible = false;
    m.renderOrder = 2;
    this.group.add(m);
    return m;
  }

  private place(m: THREE.Mesh, p: { x: number; z: number } | null): void {
    m.visible = !!p;
    if (p) m.position.set(p.x, m.position.y, p.z);
  }

  /** Legal destinations: gold dots, capture rings; `unsafe` ones (guide mode) are red. */
  showTargets(targets: { pos: { x: number; z: number }; capture: boolean; unsafe?: boolean }[]): void {
    this.clearTargets();
    if (!this.hintsEnabled) return;
    let dots = 0, rings = 0;
    for (const t of targets) {
      const pool = t.capture ? this.rings : this.dots;
      const used = t.capture ? rings++ : dots++;
      let m = pool[used];
      if (!m) {
        m = this.mesh(this.dotMat, 0.002);
        pool.push(m);
      }
      m.material = t.unsafe ? (t.capture ? this.unsafeRingMat : this.unsafeDotMat) : (t.capture ? this.ringMat : this.dotMat);
      m.scale.setScalar(t.capture ? 1.0 : 0.5);
      this.place(m, t.pos);
    }
  }

  private readonly unsafeDotMat = new THREE.MeshBasicMaterial({ map: dotTex(), color: new THREE.Color(2.6, 0.35, 0.3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  private readonly unsafeRingMat = new THREE.MeshBasicMaterial({ map: ringTex(), color: new THREE.Color(2.6, 0.3, 0.25), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });

  clearTargets(): void {
    for (const m of [...this.dots, ...this.rings]) m.visible = false;
  }

  setLastMove(from: { x: number; z: number } | null, to: { x: number; z: number } | null): void {
    this.place(this.lastMove[0], from);
    this.place(this.lastMove[1], to);
  }

  setSelected(p: { x: number; z: number } | null): void { this.place(this.selected, p); }
  setHover(p: { x: number; z: number } | null): void { this.place(this.hover, p); }
  setCheck(p: { x: number; z: number } | null): void { this.place(this.check, p); }

  update(t: number): void {
    const pulse = 0.75 + 0.25 * Math.sin(t * 5);
    this.dotMat.opacity = 0.65 + 0.3 * Math.sin(t * 4);
    this.ringMat.opacity = 0.7 + 0.3 * Math.sin(t * 4);
    (this.check.material as THREE.MeshBasicMaterial).opacity = pulse;
    for (const h of this.hint) (h.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.4 * Math.sin(t * 6);
    this.dangerMat.opacity = 0.45 + 0.35 * Math.sin(t * 7);
    this.arrowMat.uniforms.uTime.value = t;
  }
}
