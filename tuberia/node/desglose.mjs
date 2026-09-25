// desglose.mjs: por nivel, MB promedio de textura y de geometria por tesela.
import fs from 'node:fs'; import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const dir = process.argv[2]; const ts = JSON.parse(fs.readFileSync(path.join(dir, 'tileset.json'), 'utf8'));
const niv = {};
async function w(t, d) { if (t.content) { const f = path.join(dir, t.content.uri); const tam = fs.statSync(f).size; const doc = await io.read(f); const tex = doc.getRoot().listTextures().reduce((a, x) => a + x.getImage().byteLength, 0);
  const n = niv[d] ||= { k: 0, tot: 0, tex: 0 }; n.k++; n.tot += tam; n.tex += tex; }
  for (const c of t.children || []) await w(c, d + 1); }
await w(ts.root, 0);
for (const [d, n] of Object.entries(niv)) console.log(`nivel ${d}: ${n.k} teselas, promedio ${(n.tot / n.k / 1e6).toFixed(2)} MB (textura ${(n.tex / n.k / 1e6).toFixed(2)}, geometria ${((n.tot - n.tex) / n.k / 1e6).toFixed(2)})`);
