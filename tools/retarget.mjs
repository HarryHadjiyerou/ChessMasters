// World-space animation retargeting between skeletons that share bone NAMES but not
// proportions or bone axes (all rigs are in T-pose at rest). For each frame:
//   source delta  D = Wsrc(t) * inverse(Wsrc_rest)        (world rotation change of a bone)
//   target world    = D * Wtgt_rest
//   target local    = inverse(parent world(t)) * target world
// The pelvis also gets the source's world translation change, scaled by hip height.
import * as THREE from 'three';

const FPS = 30;

function sampler(ch) {
  const s = ch.getSampler();
  const input = s.getInput().getArray(), out = s.getOutput().getArray();
  const n = ch.getTargetPath() === 'rotation' ? 4 : 3;
  const step = s.getInterpolation() === 'STEP';
  const cubic = s.getInterpolation() === 'CUBICSPLINE';
  return (t, target) => {
    const stride = cubic ? n * 3 : n, off = cubic ? n : 0;
    if (t <= input[0]) { for (let k = 0; k < n; k++) target[k] = out[off + k]; return; }
    const last = input.length - 1;
    if (t >= input[last]) { for (let k = 0; k < n; k++) target[k] = out[last * stride + off + k]; return; }
    let i = 1; while (input[i] < t) i++;
    const t0 = input[i - 1], t1 = input[i], a = step ? 0 : (t - t0) / (t1 - t0);
    const A = (i - 1) * stride + off, B = i * stride + off;
    if (n === 4) {
      const qa = new THREE.Quaternion(out[A], out[A + 1], out[A + 2], out[A + 3]);
      const qb = new THREE.Quaternion(out[B], out[B + 1], out[B + 2], out[B + 3]);
      qa.slerp(qb, a); target[0] = qa.x; target[1] = qa.y; target[2] = qa.z; target[3] = qa.w;
    } else for (let k = 0; k < 3; k++) target[k] = out[A + k] + (out[B + k] - out[A + k]) * a;
  };
}

/** Skeleton description: joints in parent-first order with rest TRS and static outer transform. */
export function describe(doc) {
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const parentOf = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
  const set = new Set(joints);
  const order = [];
  const visit = (j) => { order.push(j); for (const c of j.listChildren()) if (set.has(c)) visit(c); };
  for (const j of joints) if (!set.has(parentOf.get(j))) visit(j);
  const idx = new Map(order.map((j, i) => [j, i]));
  const bones = order.map((j) => {
    const p = parentOf.get(j);
    return {
      node: j, name: j.getName(),
      parent: set.has(p) ? idx.get(p) : -1,
      outer: !set.has(p) && p ? new THREE.Matrix4().fromArray(p.getWorldMatrix()) : new THREE.Matrix4(),
      t: new THREE.Vector3().fromArray(j.getTranslation()),
      r: new THREE.Quaternion().fromArray(j.getRotation()),
      s: new THREE.Vector3().fromArray(j.getScale()),
    };
  });
  const byName = new Map(bones.map((b, i) => [b.name, i]));
  const rest = pose(bones, () => null);
  const pelvis = byName.get('pelvis');
  const hipHeight = pelvis !== undefined ? new THREE.Vector3().setFromMatrixPosition(rest[pelvis]).y : 1;
  return { bones, byName, rest, pelvis, hipHeight };
}

/** World matrices for all bones; `local(i)` returns {t, r} overrides or null for rest. */
function pose(bones, local) {
  const W = [];
  const m = new THREE.Matrix4();
  bones.forEach((b, i) => {
    const o = local(i);
    m.compose(o?.t ?? b.t, o?.r ?? b.r, b.s);
    W[i] = (b.parent < 0 ? b.outer.clone() : W[b.parent].clone()).multiply(m);
  });
  return W;
}

/** Samples a source clip into per-bone world rotation deltas and pelvis world offsets. */
export function sampleSource(desc, anim) {
  const channels = new Map();
  for (const ch of anim.listChannels()) {
    const i = desc.bones.findIndex((b) => b.node === ch.getTargetNode());
    if (i < 0) continue;
    const e = channels.get(i) ?? {};
    if (ch.getTargetPath() === 'rotation') e.r = sampler(ch);
    if (ch.getTargetPath() === 'translation') e.t = sampler(ch);
    channels.set(i, e);
  }
  const input = anim.listSamplers()[0].getInput().getArray();
  const duration = input[input.length - 1];
  const frames = Math.max(2, Math.round(duration * FPS) + 1);
  const restRot = desc.rest.map((m) => new THREE.Quaternion().setFromRotationMatrix(m));
  const restPelvis = desc.pelvis !== undefined ? new THREE.Vector3().setFromMatrixPosition(desc.rest[desc.pelvis]) : null;
  const deltas = [], pelvis = [];
  const tmp4 = [0, 0, 0, 0], tmp3 = [0, 0, 0];
  for (let f = 0; f < frames; f++) {
    const t = Math.min(duration, f / FPS);
    const W = pose(desc.bones, (i) => {
      const c = channels.get(i);
      if (!c) return null;
      const o = {};
      if (c.r) { c.r(t, tmp4); o.r = new THREE.Quaternion().fromArray(tmp4); }
      if (c.t) { c.t(t, tmp3); o.t = new THREE.Vector3().fromArray(tmp3); }
      return o;
    });
    deltas.push(W.map((m, i) => new THREE.Quaternion().setFromRotationMatrix(m).multiply(restRot[i].clone().invert())));
    pelvis.push(restPelvis ? new THREE.Vector3().setFromMatrixPosition(W[desc.pelvis]).sub(restPelvis) : null);
  }
  return { duration, frames, deltas, pelvis, hipHeight: desc.hipHeight, byName: desc.byName };
}

/**
 * Writes a retargeted copy of `src` (from sampleSource) into the target document as a new
 * animation called `name`. Only bones present (by name) in both rigs are driven.
 */
export function writeRetargeted(doc, desc, src, name, { lockXZ = false } = {}) {
  const anim = doc.createAnimation(name);
  const buffer = doc.getRoot().listBuffers()[0];
  const times = new Float32Array(src.frames);
  for (let f = 0; f < src.frames; f++) times[f] = Math.min(src.duration, f / FPS);
  const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
  const mapped = desc.bones.map((b) => src.byName.get(b.name) ?? -1);
  const restRot = desc.rest.map((m) => new THREE.Quaternion().setFromRotationMatrix(m));
  const restPelvis = desc.pelvis !== undefined ? new THREE.Vector3().setFromMatrixPosition(desc.rest[desc.pelvis]) : null;
  const scale = desc.hipHeight / src.hipHeight;
  const rot = desc.bones.map((_, i) => (mapped[i] >= 0 ? new Float32Array(src.frames * 4) : null));
  const tra = desc.pelvis !== undefined && src.pelvis[0] ? new Float32Array(src.frames * 3) : null;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pw = new THREE.Quaternion(), pos = new THREE.Vector3();
  for (let f = 0; f < src.frames; f++) {
    const W = [];
    desc.bones.forEach((b, i) => {
      const parentW = b.parent < 0 ? b.outer : W[b.parent];
      let lr = b.r, lt = b.t;
      if (mapped[i] >= 0) {
        q.copy(src.deltas[f][mapped[i]]).multiply(restRot[i]); // desired world rotation
        pw.setFromRotationMatrix(parentW);
        lr = pw.clone().invert().multiply(q).normalize();
        rot[i].set([lr.x, lr.y, lr.z, lr.w], f * 4);
      }
      if (i === desc.pelvis && tra) {
        const d = src.pelvis[f].clone().multiplyScalar(scale);
        if (lockXZ) { d.x = 0; d.z = 0; }
        pos.copy(restPelvis).add(d).applyMatrix4(parentW.clone().invert());
        lt = pos.clone();
        tra.set([lt.x, lt.y, lt.z], f * 3);
      }
      m.compose(lt, lr, b.s);
      W[i] = parentW.clone().multiply(m);
    });
  }
  desc.bones.forEach((b, i) => {
    if (!rot[i]) return;
    const out = doc.createAccessor().setType('VEC4').setArray(rot[i]).setBuffer(buffer);
    const s = doc.createAnimationSampler().setInput(input).setOutput(out).setInterpolation('LINEAR');
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(b.node).setTargetPath('rotation').setSampler(s));
  });
  if (tra) {
    const out = doc.createAccessor().setType('VEC3').setArray(tra).setBuffer(buffer);
    const s = doc.createAnimationSampler().setInput(input).setOutput(out).setInterpolation('LINEAR');
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(desc.bones[desc.pelvis].node).setTargetPath('translation').setSampler(s));
  }
  return anim;
}

/** Locks the pelvis's horizontal travel in a native clip (in-place loops). */
export function lockRoot(anim) {
  const ch = anim.listChannels().find((c) => c.getTargetPath() === 'translation' && c.getTargetNode()?.getName() === 'pelvis');
  if (!ch) return;
  const s = ch.getSampler();
  const out = s.getOutput().clone();
  const a = out.getArray();
  const x0 = a[0], z0 = a[2];
  for (let i = 0; i < a.length; i += 3) { a[i] = x0; a[i + 2] = z0; }
  out.setArray(a);
  s.setOutput(out);
}

/**
 * A simple standing idle, generated rather than taken from a clip: arms relaxed down at the
 * sides with a slight elbow bend, a gentle breathing sway of the chest and head, and a tiny
 * up-down bob. Built as world-space deltas from the T-pose, so it suits any humanoid rig.
 */
export function simpleIdle({ armDown = 1.2, seconds = 3.2 } = {}) {
  const names = ['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'spine_03', 'neck_01', 'head', 'pelvis'];
  const byName = new Map(names.map((n, i) => [n, i]));
  const frames = Math.round(seconds * FPS) + 1;
  const Z = new THREE.Vector3(0, 0, 1), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
  const deltas = [], pelvis = [];
  for (let f = 0; f < frames; f++) {
    const ph = (f / (frames - 1)) * Math.PI * 2; // one full breath per loop
    const breath = Math.sin(ph);
    // Characters face +z; their left arm points +x in T-pose, so rotate it about +z downwards.
    const downL = new THREE.Quaternion().setFromAxisAngle(Z, -(armDown + 0.04 * breath));
    const downR = new THREE.Quaternion().setFromAxisAngle(Z, armDown + 0.04 * breath);
    // Slight elbow bend, forward, on top of the lowered arm.
    const elbowL = downL.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Y, -0.25));
    const elbowR = downR.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Y, 0.25));
    const chest = new THREE.Quaternion().setFromAxisAngle(X, 0.025 * breath);
    const head = new THREE.Quaternion().setFromAxisAngle(Y, 0.06 * Math.sin(ph * 0.5)).multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.02 * breath));
    deltas.push([downL, downR, elbowL, elbowR, chest, chest.clone(), head, new THREE.Quaternion()]);
    pelvis.push(new THREE.Vector3(0, 0.006 * (breath - 1), 0));
  }
  return { duration: seconds, frames, deltas, pelvis, hipHeight: 1, byName };
}
