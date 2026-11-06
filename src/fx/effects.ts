import * as THREE from 'three';

// Cartoon effects: poof cloud, dizzy stars, sparkles, promotion burst. Sprite pools updated
// every frame; each burst cleans itself up. No gore: defeats always end in a poof.

function tex(draw: (ctx: CanvasRenderingContext2D, s: number) => void, size = 64): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const puffTex = tex((ctx, s) => {
  const g = ctx.createRadialGradient(s * 0.45, s * 0.4, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(250,240,230,0.9)');
  g.addColorStop(1, 'rgba(240,225,215,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  ctx.fill();
});

const starTex = tex((ctx, s) => {
  ctx.translate(s / 2, s / 2);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? s * 0.2 : s * 0.46;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffd84a';
  ctx.fill();
  ctx.lineWidth = s * 0.05;
  ctx.strokeStyle = '#b8741a';
  ctx.stroke();
});

const sparkTex = tex((ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,230,150,0.9)');
  g.addColorStop(1, 'rgba(255,180,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(s / 2 - 1, 4, 2, s - 8);
  ctx.fillRect(4, s / 2 - 1, s - 8, 2);
});

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: [number, number];
  spin: number;
  gravity: number;
  orbit?: { centre: THREE.Vector3; radius: number; speed: number; angle: number };
  fadeIn: number;
  wave?: number;
}

const flagTex = tex((ctx, s) => {
  ctx.strokeStyle = '#7a4a1c';
  ctx.lineWidth = s * 0.05;
  ctx.beginPath(); ctx.moveTo(s * 0.2, s * 0.08); ctx.lineTo(s * 0.2, s * 0.95); ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#c9c2b8';
  ctx.lineWidth = s * 0.025;
  ctx.beginPath();
  ctx.moveTo(s * 0.22, s * 0.1);
  ctx.bezierCurveTo(s * 0.45, s * 0.02, s * 0.6, s * 0.2, s * 0.9, s * 0.12);
  ctx.lineTo(s * 0.88, s * 0.48);
  ctx.bezierCurveTo(s * 0.6, s * 0.56, s * 0.45, s * 0.38, s * 0.22, s * 0.46);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}, 128);

export class Effects {
  readonly group = new THREE.Group();
  private particles: Particle[] = [];

  constructor() { this.group.name = 'effects'; }

  private spawn(map: THREE.Texture, colour: THREE.ColorRepresentation, additive: boolean, p: Omit<Particle, 'sprite' | 'age'>, pos: THREE.Vector3): void {
    const mat = new THREE.SpriteMaterial({
      map, color: colour, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    sprite.scale.setScalar(p.size[0]);
    sprite.renderOrder = 5;
    this.group.add(sprite);
    this.particles.push({ ...p, sprite, age: 0 });
  }

  /** Big cartoon poof cloud with sparkles. `scale` ~ piece height. */
  poof(at: THREE.Vector3, scale = 1): void {
    const c = at.clone();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.random() * 0.4;
      const up = 0.15 + Math.random() * 0.6;
      const pos = c.clone().add(new THREE.Vector3(Math.cos(a) * 0.1, up * scale, Math.sin(a) * 0.1));
      this.spawn(puffTex, i % 3 ? 0xffffff : 0xffe9d6, false, {
        vel: new THREE.Vector3(Math.cos(a) * (0.9 + Math.random() * 0.6), 0.4 + Math.random() * 0.6, Math.sin(a) * (0.9 + Math.random() * 0.6)).multiplyScalar(scale),
        life: 0.55 + Math.random() * 0.25, size: [0.3 * scale, (0.75 + Math.random() * 0.3) * scale],
        spin: 0, gravity: -0.6, fadeIn: 0.05,
      }, pos);
    }
    this.sparkles(c.clone().add(new THREE.Vector3(0, 0.5 * scale, 0)), 14, 0xffe08a, scale);
  }

  sparkles(at: THREE.Vector3, count = 12, colour: THREE.ColorRepresentation = 0xffe08a, scale = 1): void {
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize();
      this.spawn(sparkTex, colour, true, {
        vel: dir.multiplyScalar((1.2 + Math.random() * 1.4) * scale),
        life: 0.5 + Math.random() * 0.4, size: [0.16 * scale, 0.02], spin: 0, gravity: 2.2, fadeIn: 0,
      }, at);
    }
  }

  /** Dizzy stars circling above a head. */
  dizzy(head: THREE.Vector3, duration = 0.9, radius = 0.25): void {
    for (let i = 0; i < 5; i++) {
      this.spawn(starTex, 0xffffff, false, {
        vel: new THREE.Vector3(), life: duration, size: [0.16, 0.16], spin: 4, gravity: 0, fadeIn: 0.08,
        orbit: { centre: head.clone(), radius, speed: 7, angle: (i / 5) * Math.PI * 2 },
      }, head);
    }
  }

  /** Rising column of sparkles for a promotion. */
  promotion(at: THREE.Vector3): void {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.2 + Math.random() * 0.25;
      const pos = at.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.random() * 0.3, Math.sin(a) * r));
      this.spawn(sparkTex, i % 2 ? 0xfff2b0 : 0xffc040, true, {
        vel: new THREE.Vector3(-Math.sin(a) * 0.6, 1.4 + Math.random() * 1.6, Math.cos(a) * 0.6),
        life: 0.8 + Math.random() * 0.6, size: [0.2, 0.04], spin: 0, gravity: 0, fadeIn: 0.1,
      }, pos);
    }
  }

  /**
   * Spell fireball. Returns a handle: `set(from, to, t)` places it along an arc (t 0..1) and
   * leaves a sparkling trail; `explode()` bursts it and removes it. Ruby-gold or amethyst.
   */
  fireball(colour: 'ruby' | 'amethyst'): { set: (from: THREE.Vector3, to: THREE.Vector3, t: number) => void; explode: () => void } {
    const hot = colour === 'ruby' ? new THREE.Color(3.2, 1.3, 0.35) : new THREE.Color(1.9, 0.7, 3.4);
    const trail = colour === 'ruby' ? 0xffb347 : 0xc58cff;
    const mk = (map: THREE.Texture, c: THREE.Color | number, size: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.scale.setScalar(size);
      s.renderOrder = 6;
      this.group.add(s);
      return s;
    };
    const halo = mk(sparkTex, hot, 1.5);
    const core = mk(puffTex, new THREE.Color(3.4, 3, 2.6), 0.42);
    let last = 0;
    const pos = new THREE.Vector3();
    return {
      set: (from, to, t) => {
        pos.lerpVectors(from, to, t);
        pos.y += Math.sin(t * Math.PI) * 0.35;
        halo.position.copy(pos);
        core.position.copy(pos);
        const pulse = 0.85 + 0.25 * Math.sin(t * 40);
        halo.scale.setScalar(1.5 * pulse);
        halo.material.rotation += 0.3;
        if (t - last > 0.04) {
          last = t;
          for (let i = 0; i < 5; i++) {
            this.spawn(sparkTex, trail, true, {
              vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.5, (Math.random() - 0.5) * 0.6),
              life: 0.4 + Math.random() * 0.3, size: [0.32, 0.03], spin: 0, gravity: -0.4, fadeIn: 0,
            }, pos);
          }
        }
      },
      explode: () => {
        for (const s of [halo, core]) { s.removeFromParent(); s.material.dispose(); }
        this.sparkles(pos.clone(), 26, trail, 1.4);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          this.spawn(puffTex, trail, true, {
            vel: new THREE.Vector3(Math.cos(a) * 1.6, 0.3 + Math.random() * 0.6, Math.sin(a) * 1.6),
            life: 0.45 + Math.random() * 0.2, size: [0.25, 0.75], spin: 0, gravity: 0, fadeIn: 0.02,
          }, pos);
        }
      },
    };
  }

  /** Comic surrender: a little white flag pops up and waves above a king's head. */
  whiteFlag(head: THREE.Vector3, duration = 3): void {
    this.spawn(flagTex, 0xffffff, false, {
      vel: new THREE.Vector3(0, 0.25, 0), life: duration, size: [0.45, 0.5], spin: 0, gravity: 0.25, fadeIn: 0.15,
      wave: 0.35,
    }, head.clone().add(new THREE.Vector3(0.18, 0.1, 0)));
  }

  clear(): void {
    for (const p of this.particles) { p.sprite.removeFromParent(); p.sprite.material.dispose(); }
    this.particles = [];
  }

  update(dt: number): void {
    const keep: Particle[] = [];
    for (const p of this.particles) {
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) { p.sprite.removeFromParent(); p.sprite.material.dispose(); continue; }
      if (p.orbit) {
        p.orbit.angle += p.orbit.speed * dt;
        p.sprite.position.set(
          p.orbit.centre.x + Math.cos(p.orbit.angle) * p.orbit.radius,
          p.orbit.centre.y + Math.sin(p.orbit.angle * 2) * 0.03,
          p.orbit.centre.z + Math.sin(p.orbit.angle) * p.orbit.radius,
        );
      } else {
        p.vel.y -= p.gravity * dt;
        p.vel.multiplyScalar(Math.pow(0.12, dt));
        p.sprite.position.addScaledVector(p.vel, dt);
      }
      const s = p.size[0] + (p.size[1] - p.size[0]) * Math.sqrt(k);
      p.sprite.scale.setScalar(s);
      if (p.wave) p.vel.set(0, Math.max(0, p.vel.y), 0);
      p.sprite.material.rotation = p.wave ? Math.sin(p.age * 9) * p.wave : p.sprite.material.rotation + p.spin * dt;
      const fin = p.fadeIn > 0 ? Math.min(1, p.age / p.fadeIn) : 1;
      p.sprite.material.opacity = fin * (p.wave ? 1 - Math.pow(k, 8) : 1 - k * k);
      keep.push(p);
    }
    this.particles = keep;
  }
}
