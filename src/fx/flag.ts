import * as THREE from 'three';

// A tall white surrender flag: wooden pole with a gold finial and a waving cloth. The cloth is
// a subdivided plane whose vertices ripple every frame (stronger towards the free edge).

export class SurrenderFlag {
  readonly group = new THREE.Group();
  private readonly cloth: THREE.Mesh;
  private readonly base: Float32Array;
  private t = 0;

  constructor(height = 1.6) {
    this.group.name = 'surrender-flag';
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.022, height, 8).translate(0, height / 2, 0),
      new THREE.MeshStandardMaterial({ color: 0x7a4a1c, roughness: 0.7 }),
    );
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), new THREE.MeshStandardMaterial({ color: 0xf2c45e, metalness: 1, roughness: 0.3 }));
    finial.position.y = height + 0.03;
    const w = height * 0.5, h = height * 0.32;
    const geo = new THREE.PlaneGeometry(w, h, 16, 8).translate(w / 2 + 0.015, height - h / 2 - 0.05, 0);
    this.cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xfcfbf6, roughness: 0.85, side: THREE.DoubleSide, emissive: 0x302c28 }));
    this.base = (geo.attributes.position.array as Float32Array).slice();
    for (const m of [pole, finial, this.cloth]) { m.castShadow = true; m.receiveShadow = true; }
    this.group.add(pole, finial, this.cloth);
  }

  update(dt: number): void {
    this.t += dt;
    const pos = this.cloth.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      const x = this.base[i]; // distance from the pole
      const k = Math.min(1, x / 0.6);
      a[i + 2] = Math.sin(x * 9 - this.t * 7) * 0.07 * k + Math.sin(this.base[i + 1] * 6 + this.t * 3) * 0.02 * k;
      a[i + 1] = this.base[i + 1] - k * k * 0.04 * (1 + Math.sin(this.t * 2));
    }
    pos.needsUpdate = true;
    this.cloth.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  }
}
