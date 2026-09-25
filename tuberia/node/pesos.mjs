// pesos.mjs: por nivel de un tileset, bytes en disco y megapixeles de textura
// asignados (lo que ocupa en GPU: ~5,3 bytes/px en RGBA8 con mipmaps).
// Uso: node pesos.mjs <dir-tileset>
import fs from 'node:fs'; import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const dir = process.argv[2];
const ts = JSON.parse(fs.readFileSync(path.join(dir, 'tileset.json'), 'utf8'));
const niveles = {};
async function walk(t, d) {
  if (t.content?.uri) {
    const f = path.join(dir, t.content.uri); const doc = await io.read(f);
    let px = 0; for (const x of doc.getRoot().listTextures()) { const s = x.getSize(); if (s) px += s[0] * s[1]; }
    const n = (niveles[d] ||= { teselas: 0, mb: 0, mpx: 0, maxMpx: 0, maxMb: 0 });
    const mb = fs.statSync(f).size / 1e6;
    n.teselas++; n.mb += mb; n.mpx += px / 1e6; n.maxMpx = Math.max(n.maxMpx, px / 1e6); n.maxMb = Math.max(n.maxMb, mb);
  }
  for (const c of t.children || []) await walk(c, d + 1);
}
await walk(ts.root, 0);
for (const [d, n] of Object.entries(niveles)) console.log(`nivel ${d}: ${n.teselas} teselas, ${n.mb.toFixed(0)} MB disco (max ${n.maxMb.toFixed(1)}), textura ${n.mpx.toFixed(0)} Mpx (max ${n.maxMpx.toFixed(1)} por tesela = ${(n.maxMpx * 5.33).toFixed(0)} MB GPU)`);
