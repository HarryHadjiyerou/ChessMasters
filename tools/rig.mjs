// Rig tools for the asset pipeline (run in Node on gltf-transform documents):
//  - repairLeg(): adds a missing 4-joint leg chain to a centaur rig and re-weights that leg.
//  - mapRig(): gives custom rigs (generic "Bone_000" names) standard humanoid names
//    (pelvis, spine_01..03, neck_01, head, clavicle/upperarm/lowerarm/hand _l/_r,
//    thigh/calf/foot/ball _l/_r) by reading the skeleton's shape, and names horse legs
//    leg_{fl,fr,bl,br}_{0..n} for the procedural gallop. Characters face +z; their left is +x.
import * as THREE from 'three';

const v3 = () => new THREE.Vector3();
export const worldMat = (node) => new THREE.Matrix4().fromArray(node.getWorldMatrix());
export const worldPos = (node) => v3().setFromMatrixPosition(worldMat(node));

export function skinInfo(doc) {
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const meshNode = root.listNodes().find((n) => n.getMesh() && n.getSkin() === skin);
  const parentOf = new Map();
  for (const j of joints) for (const c of j.listChildren()) parentOf.set(c, j);
  const childJoints = (j) => j.listChildren().filter((c) => joints.includes(c));
  return { skin, joints, meshNode, parentOf, childJoints };
}

/** Vertices of all skinned primitives in model (world) space with their skin data. */
function forEachVertex(doc, info, fn) {
  const M = worldMat(info.meshNode);
  const p = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
  for (const prim of info.meshNode.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p); J.getElement(i, j); W.getElement(i, w);
      const v = v3().fromArray(p).applyMatrix4(M);
      const res = fn(v, j.slice(), w.slice());
      if (res) { J.setElement(i, res.j); W.setElement(i, res.w); }
    }
  }
}

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/**
 * Adds a leg chain for vertices selected by `select(v, dominantJointName)` and re-weights them.
 * Joints are placed at the centroids of the leg's own geometry at four heights, so the chain
 * follows the real leg. `parentName` = body joint the leg hangs from.
 */
export function repairLeg(doc, { name, parentName, select }) {
  const info = skinInfo(doc);
  const parent = info.joints.find((j) => j.getName() === parentName);
  if (!parent) throw new Error(`repairLeg: no joint ${parentName}`);
  // 1. Collect the leg's vertices.
  const pts = [];
  forEachVertex(doc, info, (v, j, w) => {
    let best = 0; for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k;
    if (select(v, info.joints[j[best]].getName())) pts.push(v);
  });
  if (pts.length < 20) throw new Error(`repairLeg ${name}: only ${pts.length} vertices selected`);
  const top = Math.max(...pts.map((p) => p.y));
  const bottom = Math.min(...pts.map((p) => p.y));
  const H = top - bottom;
  const heights = [top - H * 0.05, bottom + H * 0.55, bottom + H * 0.2, bottom + H * 0.02];
  const centroid = (y, band) => {
    const s = pts.filter((p) => Math.abs(p.y - y) < band);
    const c = v3(); for (const p of s) c.add(p); return c.multiplyScalar(1 / Math.max(1, s.length)).setY(y);
  };
  const jointPos = heights.map((y) => centroid(y, H * 0.08));
  // 2. Create the joints (parent -> 0 -> 1 -> 2 -> 3).
  const newJoints = [];
  let par = parent;
  for (let i = 0; i < 4; i++) {
    const n = doc.createNode(`leg_${name}_${i}`);
    const local = jointPos[i].clone().applyMatrix4(worldMat(par).invert());
    n.setTranslation(local.toArray());
    par.addChild(n);
    newJoints.push(n);
    par = n;
  }
  // 3. Add them to the skin with inverse bind matrices (mesh space -> joint space).
  const ibmAcc = info.skin.getInverseBindMatrices();
  const old = ibmAcc.getArray();
  const meshW = worldMat(info.meshNode);
  const add = [];
  for (const n of newJoints) {
    info.skin.addJoint(n);
    const ibm = worldMat(n).invert().multiply(meshW);
    add.push(...ibm.toArray());
  }
  const arr = new Float32Array(old.length + add.length);
  arr.set(old); arr.set(add, old.length);
  ibmAcc.setArray(arr);
  const base = info.joints.length; // index of leg joint 0
  // 4. Re-weight: blend along the chain by height; fade into the original body weights at the top.
  forEachVertex(doc, info, (v, j, w) => {
    let best = 0; for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k;
    if (!select(v, info.joints[j[best]].getName())) return null;
    const y = v.y;
    // Weights for segments 0 (upper), 1 (lower), 2 (pastern/hoof).
    const b1 = smooth(heights[1] + H * 0.06, heights[1] - H * 0.06, y); // 0 -> 1
    const b2 = smooth(heights[2] + H * 0.05, heights[2] - H * 0.05, y); // 1 -> 2
    let s0 = 1 - b1, s1 = b1 * (1 - b2), s2 = b1 * b2;
    const legShare = smooth(top + 0.001, top - H * 0.18, y); // 0 at the very top -> 1 below
    const body = 1 - legShare;
    s0 *= legShare; s1 *= legShare; s2 *= legShare;
    const pairs = [[base, s0], [base + 1, s1], [base + 2, s2], [j[best], body]].filter((p) => p[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = pairs.reduce((a, p) => a + p[1], 0);
    const nj = [0, 0, 0, 0], nw = [0, 0, 0, 0];
    pairs.forEach((p, i) => { nj[i] = p[0]; nw[i] = p[1] / sum; });
    return { j: nj, w: nw };
  });
  // JOINTS_0 may be UNSIGNED_BYTE; indices stay well under 256 here.
  return { joints: newJoints.map((n) => n.getName()), vertices: pts.length, top: +top.toFixed(3) };
}

const STD_TORSO = ['spine_01', 'spine_02', 'spine_03'];

/** Standard humanoid names for a custom rig. Returns a report of what was mapped. */
export function mapRig(doc, { centaur = false } = {}) {
  const info = skinInfo(doc);
  const { joints, childJoints, parentOf } = info;
  if (joints.some((j) => j.getName() === 'pelvis')) return { already: true };
  const P = new Map(joints.map((j) => [j, worldPos(j)]));
  const subtree = (j) => [j, ...childJoints(j).flatMap(subtree)];
  const minY = (j) => Math.min(...subtree(j).map((n) => P.get(n).y));
  const maxY = (j) => Math.max(...subtree(j).map((n) => P.get(n).y));
  const maxAbsX = (j) => Math.max(...subtree(j).map((n) => Math.abs(P.get(n).x)));
  const names = new Map();
  const set = (j, n) => { if (j && !names.has(j)) names.set(j, n); };

  // Chest: the joint with two arm branches (wide) and a neck (highest).
  const chest = joints.find((j) => {
    const kids = childJoints(j);
    // Arms reach out sideways, stay roughly level and never touch the ground (legs and tails do).
    const arms = kids.filter((k) => maxAbsX(k) > 0.3 && Math.abs(P.get(k).y - P.get(j).y) < 0.25 && minY(k) > 0.3 && maxY(k) - minY(k) < 0.25);
    return arms.length >= 2 && kids.some((k) => maxY(k) > P.get(j).y + 0.15);
  });
  if (!chest) throw new Error('mapRig: no chest found');
  const kids = childJoints(chest);
  const neck = kids.reduce((a, b) => (maxY(a) > maxY(b) ? a : b));
  set(neck, 'neck_01');
  set(childJoints(neck).reduce((a, b) => (maxY(a) > maxY(b) ? a : b), childJoints(neck)[0]), 'head');
  for (const arm of kids.filter((k) => k !== neck && maxAbsX(k) > 0.3 && minY(k) > 0.3 && maxY(k) - minY(k) < 0.25)) {
    const side = P.get(subtree(arm).reduce((a, b) => (Math.abs(P.get(a).x) > Math.abs(P.get(b).x) ? a : b))).x > 0 ? 'l' : 'r';
    const chain = [arm];
    while (childJoints(chain.at(-1)).length === 1) chain.push(childJoints(chain.at(-1))[0]);
    // Clavicle present when the first joint sits much closer to the centre than the second.
    const hasClav = chain.length >= 4 && Math.abs(P.get(chain[0]).x) < 0.5 * Math.abs(P.get(chain[1]).x);
    const parts = hasClav ? ['clavicle', 'upperarm', 'lowerarm', 'hand'] : ['upperarm', 'lowerarm', 'hand'];
    parts.forEach((p, i) => set(chain[i], `${p}_${side}`));
  }
  // Legs: chains whose lowest point touches the ground. Done before the spine so the hips
  // (where the legs join) are known and the spine walk stops there.
  const feet = joints.filter((j) => childJoints(j).length === 0 && P.get(j).y < 0.09);
  const legs = feet.map((f) => {
    const chain = [f];
    let p = parentOf.get(f);
    while (p && childJoints(p).length === 1 && p !== chest) { chain.unshift(p); p = parentOf.get(p); }
    return { chain, hip: p, foot: P.get(f) };
  });
  const report = { chest: chest.getName(), legs: legs.length };
  let hips = null;
  if (centaur) {
    const midZ = legs.reduce((a, l) => a + l.foot.z, 0) / Math.max(1, legs.length);
    for (const front of [true, false]) {
      const group = legs.filter((l) => (l.foot.z > midZ) === front).sort((a, b) => b.foot.x - a.foot.x);
      group.forEach((l, k) => {
        const existing = l.chain[0].getName().match(/^leg_(\w\w)_/);
        const side = group.length > 1 ? (k === 0 ? 'l' : 'r') : l.foot.x > 0 ? 'l' : 'r';
        const tag = existing ? existing[1] : `${front ? 'f' : 'b'}${side}`;
        l.chain.forEach((j, i) => set(j, `leg_${tag}_${i}`));
      });
    }
    report.horseLegs = legs.map((l) => names.get(l.chain[0]));
  } else {
    for (const l of legs) {
      const side = l.foot.x > 0 ? 'l' : 'r';
      const parts = l.chain.length >= 5 ? ['thigh', 'calf', 'foot', 'ball'] : l.chain.length === 4 ? ['thigh', 'foot', 'ball'] : ['thigh', 'foot'];
      parts.forEach((p, i) => set(l.chain[i], `${p}_${side}`));
      if (l.hip) { set(l.hip, 'pelvis'); hips = l.hip; }
    }
  }
  // Spine: chest and its ancestors (up to three), stopping at the hips. On a centaur only the
  // rider's torso counts (above where the horse legs join), so clips never bend the horse body.
  const legTop = Math.max(...legs.map((l) => P.get(l.chain[0]).y));
  let s = chest;
  for (let i = 2; i >= 0 && s && s !== hips; i--) {
    if (centaur && P.get(s).y < legTop + 0.05) break;
    set(s, STD_TORSO[i]);
    s = parentOf.get(s);
  }
  for (const [j, n] of names) j.setName(n);
  report.mapped = [...names.values()].sort();
  return report;
}
