// Reports every Meshy GLB: triangles, joints, textures, height, and each clip with its length
// and root travel. Read-only on the source files.
// Usage: node tools/list-clips.mjs [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..', '..', 'MESHY ASSETS');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const ROOT = /^(mixamorig:)?(pelvis|hips?)$/i;
const out = {};

for (const dir of fs.readdirSync(src, { withFileTypes: true })) {
  const m = dir.isDirectory() && dir.name.match(/^(LIGHT|DARK)\s*-\s*(\w+)\s+ANIMATIONS?$/i);
  if (!m) continue;
  const key = `${m[1].toLowerCase()}_${m[2].toLowerCase()}`;
  for (const f of fs.readdirSync(path.join(src, dir.name)).filter((x) => x.toLowerCase().endsWith('.glb'))) {
    const doc = await io.read(path.join(src, dir.name, f));
    const root = doc.getRoot();
    const anims = root.listAnimations();
    if (key === 'light_king' && !f.startsWith('IDLE')) continue;
    let tris = 0;
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
    const b = getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
    const clips = anims.map((a) => {
      const ch = a.listChannels().find((c) => c.getTargetPath() === 'translation' && ROOT.test(c.getTargetNode()?.getName() ?? ''));
      let travel = null;
      if (ch) {
        const arr = ch.getSampler().getOutput().getArray();
        const n = arr.length;
        travel = [arr[n - 3] - arr[0], arr[n - 2] - arr[1], arr[n - 1] - arr[2]].map((v) => +v.toFixed(2));
      }
      const input = a.listSamplers()[0]?.getInput()?.getArray();
      return { name: a.getName(), dur: input ? +input[input.length - 1].toFixed(2) : 0, travel };
    });
    out[key] = {
      file: f, tris: Math.round(tris), joints: root.listSkins()[0]?.listJoints().length ?? 0,
      textures: root.listTextures().map((t) => t.getSize()?.join('x')),
      height: +(b.max[1] - b.min[1]).toFixed(2), clips,
    };
  }
}
const i = process.argv.indexOf('--json');
if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(out, null, 2));
for (const [k, v] of Object.entries(out)) {
  console.log(`\n## ${k}  (${v.file}) tris ${v.tris}, joints ${v.joints}, tex ${v.textures.join(',')}, height ${v.height}, ${v.clips.length} clips`);
  for (const c of v.clips) console.log(`   ${c.name.padEnd(42)} ${String(c.dur).padStart(6)}s  travel ${c.travel ? c.travel.join('/') : '-'}`);
}
