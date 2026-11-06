import * as THREE from 'three';
import { Pass } from 'postprocessing';
import type { MatchedCamera } from './MatchedCamera';

// Renders the 3D layer into its own half-float target, then composites:
//   background plate  ->  ACES-tone-mapped, colour-graded 3D layer  ->  foreground plate
// Tone mapping and grading apply to the 3D layer only, so the painting keeps its own colours.
// Plates are cropped with the camera's view rectangle so duel punch-ins stay aligned.

const MAX_GLOWS = 8;

const fragmentShader = /* glsl */ `
#include <common>
#include <tonemapping_pars_fragment>

uniform sampler2D tBg;
uniform sampler2D tFg;
uniform sampler2D tScene;
uniform vec4 uView;          // x, y, w, h of the view in normalised image coords (y down)
uniform vec2 uImageSize;
uniform float uExposure;
uniform vec3 uGradeLift;
uniform vec3 uGradeGain;
uniform float uSaturation;
uniform float uSceneOpacity; // 0.5 in the alignment overlay test
uniform float uTime;
uniform vec3 uGlows[${MAX_GLOWS}]; // x, y in image px, radius px
uniform int uGlowCount;
uniform float uFocus;        // 0..1 duel focus: darken and soften away from uFocusCentre
uniform vec2 uFocusCentre;   // normalised image coords (y down)
uniform float uFocusRadius;

varying vec2 vUv;

vec2 plateUv(vec2 uv) {
  vec2 img = uView.xy + vec2(uv.x, 1.0 - uv.y) * uView.zw; // y down
  return vec2(img.x, 1.0 - img.y);
}

vec3 softSample(sampler2D t, vec2 uv, float r) {
  if (r <= 0.0) return texture2D(t, uv).rgb;
  vec2 px = r / uImageSize;
  vec3 c = texture2D(t, uv).rgb * 0.36;
  c += texture2D(t, uv + vec2(px.x, 0.0)).rgb * 0.16;
  c += texture2D(t, uv - vec2(px.x, 0.0)).rgb * 0.16;
  c += texture2D(t, uv + vec2(0.0, px.y)).rgb * 0.16;
  c += texture2D(t, uv - vec2(0.0, px.y)).rgb * 0.16;
  return c;
}

void main() {
  vec2 puv = plateUv(vUv);
  vec2 imgPx = vec2(puv.x, 1.0 - puv.y) * uImageSize;

  float focusMask = 0.0;
  if (uFocus > 0.0) {
    float d = distance(imgPx, uFocusCentre * uImageSize) / (uFocusRadius * uImageSize.y);
    focusMask = uFocus * smoothstep(0.6, 1.4, d);
  }
  float blurR = focusMask * 3.0;

  vec3 col = softSample(tBg, puv, blurR);

  // Brazier flicker: soft additive warm glow on the painted flames.
  for (int i = 0; i < ${MAX_GLOWS}; i++) {
    if (i >= uGlowCount) break;
    vec3 g = uGlows[i];
    float d = distance(imgPx, g.xy) / g.z;
    float flicker = 0.55 + 0.25 * sin(uTime * 7.3 + float(i) * 1.7) + 0.2 * sin(uTime * 13.1 + float(i) * 4.1);
    col += vec3(1.0, 0.55, 0.2) * exp(-d * d * 2.5) * 0.12 * flicker;
  }

  vec4 s = texture2D(tScene, vUv);
  if (s.a > 0.0) {
    vec3 c = s.rgb / max(s.a, 1e-4);
    c = ACESFilmicToneMapping(c * uExposure);
    c = c * uGradeGain + uGradeLift;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSaturation);
    col = mix(col, max(c, 0.0), s.a * uSceneOpacity);
  }

  vec4 fg = texture2D(tFg, puv);
  if (blurR > 0.0) fg.rgb = softSample(tFg, puv, blurR);
  col = mix(col, fg.rgb, fg.a);

  col *= 1.0 - focusMask * 0.45;
  gl_FragColor = vec4(col, 1.0);
}
`;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class CompositePass extends Pass {
  readonly sceneTarget: THREE.WebGLRenderTarget;
  readonly material: THREE.ShaderMaterial;
  private readonly world: THREE.Scene;
  private readonly cam: MatchedCamera;
  private time = 0;

  constructor(world: THREE.Scene, cam: MatchedCamera, bg: THREE.Texture, fg: THREE.Texture) {
    super('CompositePass');
    this.world = world;
    this.cam = cam;
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.sceneTarget.texture.name = 'Composite.scene';
    this.material = new THREE.ShaderMaterial({
      name: 'CompositeMaterial',
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tBg: { value: bg },
        tFg: { value: fg },
        tScene: { value: this.sceneTarget.texture },
        uView: { value: new THREE.Vector4(0, 0, 1, 1) },
        uImageSize: { value: new THREE.Vector2(cam.imageWidth, cam.imageHeight) },
        uExposure: { value: 1.0 },
        uGradeLift: { value: new THREE.Vector3(0.003, 0.0015, 0.0) },
        uGradeGain: { value: new THREE.Vector3(1.04, 0.98, 0.9) },
        uSaturation: { value: 1.0 },
        uSceneOpacity: { value: 1.0 },
        uTime: { value: 0 },
        uGlows: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Vector3()) },
        uGlowCount: { value: 0 },
        uFocus: { value: 0 },
        uFocusCentre: { value: new THREE.Vector2(0.5, 0.5) },
        uFocusRadius: { value: 0.3 },
        toneMappingExposure: { value: 1.0 },
      },
    });
    this.fullscreenMaterial = this.material;
  }

  setGlows(glows: [number, number, number][]): void {
    const arr = this.material.uniforms.uGlows.value as THREE.Vector3[];
    glows.slice(0, MAX_GLOWS).forEach((g, i) => arr[i].set(g[0], g[1], g[2]));
    this.material.uniforms.uGlowCount.value = Math.min(glows.length, MAX_GLOWS);
  }

  override setSize(width: number, height: number): void {
    this.sceneTarget.setSize(width, height);
  }

  override render(renderer: THREE.WebGLRenderer, _input: THREE.WebGLRenderTarget | null, output: THREE.WebGLRenderTarget | null, delta = 0): void {
    this.time += delta;
    const u = this.material.uniforms;
    const v = this.cam.viewRect;
    u.uView.value.set(v.x / this.cam.imageWidth, v.y / this.cam.imageHeight, v.w / this.cam.imageWidth, v.h / this.cam.imageHeight);
    u.uTime.value = this.time;

    const prevAlpha = renderer.getClearAlpha();
    const prevColour = renderer.getClearColor(new THREE.Color());
    renderer.setRenderTarget(this.sceneTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(this.world, this.cam);
    renderer.setClearColor(prevColour, prevAlpha);

    renderer.setRenderTarget(this.renderToScreen ? null : output);
    renderer.render(this.scene, this.camera);
  }
}
