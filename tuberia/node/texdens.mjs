// texdens.mjs: densidad de textura (texeles por m2 de superficie) de una malla.
//
// Para cada triangulo: area en el mundo (m2) y area en UV * ancho * alto de su
// textura (texeles). La densidad es la suma de texeles sobre la suma de m2, y
// de ahi el tamano del texel en cm = 100 / sqrt(densidad).
//
// Sirve para dos cosas:
//   1. comprobar que las hojas (LOD-0) conservan la densidad del OBJ original;
//   2. derivar el geometricError de cada tesela desde el tamano de su texel
//      (lo usa armar-tiles.mjs, que importa `densidadGlb`).
//
// Uso:
//   node texdens.mjs archivo.obj            (lee el .mtl y el tamano de cada jpg)
//   node texdens.mjs a.glb b.glb ...         (glb, con o sin meshopt)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

function triAreas(p, t) {
  // p: 9 floats (3 vertices xyz), t: 6 floats (3 uv)
  const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2];
  const bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  const w = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
  const u = 0.5 * Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1]));
  return [w, u];
}

let io = null;
async function getIO() {
  if (io) return io;
  await MeshoptDecoder.ready;
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io;
}

// Devuelve { m2, texeles, cm, cmMediana } de un glb. `cm` es el promedio global
// (texeles totales / m2 totales); `cmMediana` es la mediana por triangulo
// ponderada por area, que es la que vale para el geometricError: al simplificar
// con 'Permissive' quedan unas pocas astillas con area UV enorme que inflan el
// promedio (en el Tintal, la raiz daba 45 cm de promedio y 130 cm de mediana).
export async function densidadGlb(file, docIn) {
  const doc = docIn || (await (await getIO()).read(file));
  let m2 = 0, tx = 0; const lista = [];
  const p = new Float64Array(9), t = new Float64Array(6), e = [0, 0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const W = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const tex = prim.getMaterial()?.getBaseColorTexture();
      const size = tex?.getSize();
      const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0');
      if (!size || !uv) continue;
      const npx = size[0] * size[1];
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i < n; i += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = idx ? idx.getScalar(i + k) : i + k;
          pos.getElement(vi, e);
          p[k * 3] = W[0] * e[0] + W[4] * e[1] + W[8] * e[2] + W[12];
          p[k * 3 + 1] = W[1] * e[0] + W[5] * e[1] + W[9] * e[2] + W[13];
          p[k * 3 + 2] = W[2] * e[0] + W[6] * e[1] + W[10] * e[2] + W[14];
          uv.getElement(vi, e); t[k * 2] = e[0]; t[k * 2 + 1] = e[1];
        }
        const [w, u] = triAreas(p, t);
        if (w < 1e-8) continue;
        m2 += w; tx += u * npx; lista.push([u * npx / w, w]);
      }
    }
  }
  lista.sort((a, b) => a[0] - b[0]);
  let acum = 0, med = 0; for (const [d, w] of lista) { acum += w; if (acum >= m2 / 2) { med = d; break; } }
  return { m2, texeles: tx, cm: tx > 0 ? 100 / Math.sqrt(tx / m2) : Infinity, cmMediana: med > 0 ? 100 / Math.sqrt(med) : Infinity };
}

async function densidadObj(file) {
  const dir = path.dirname(file);
  const v = [], vt = [];
  const sizes = {};
  let mtlFile = null, cur = null;
  const mats = {}; // material -> jpg
  const acc = {}; // material -> [m2, uvArea]
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const p = new Float64Array(9), t = new Float64Array(6);
  for await (const line of rl) {
    const c0 = line.charCodeAt(0), c1 = line.charCodeAt(1);
    if (c0 === 118 && c1 === 32) { const s = line.split(/\s+/); v.push(+s[1], +s[2], +s[3]); }
    else if (c0 === 118 && c1 === 116) { const s = line.split(/\s+/); vt.push(+s[1], +s[2]); }
    else if (c0 === 102 && c1 === 32) {
      const s = line.trim().split(/\s+/).slice(1).map(x => x.split('/'));
      for (let j = 1; j + 1 < s.length; j++) {
        const tri = [s[0], s[j], s[j + 1]];
        for (let k = 0; k < 3; k++) {
          const vi = (+tri[k][0] - 1) * 3, ti = (+tri[k][1] - 1) * 2;
          p[k * 3] = v[vi]; p[k * 3 + 1] = v[vi + 1]; p[k * 3 + 2] = v[vi + 2];
          t[k * 2] = vt[ti]; t[k * 2 + 1] = vt[ti + 1];
        }
        const [w, u] = triAreas(p, t);
        if (w < 1e-8) continue;
        const a = (acc[cur] ||= [0, 0]); a[0] += w; a[1] += u;
      }
    } else if (line.startsWith('usemtl ')) cur = line.slice(7).trim();
    else if (line.startsWith('mtllib ')) mtlFile = line.slice(7).trim();
  }
  let m = null;
  for (const l of fs.readFileSync(path.join(dir, mtlFile), 'utf8').split(/\r?\n/)) {
    if (l.startsWith('newmtl ')) m = l.slice(7).trim();
    else if (l.trim().startsWith('map_Kd ')) mats[m] = l.trim().slice(7).trim();
  }
  let m2 = 0, tx = 0;
  for (const [mat, [w, u]] of Object.entries(acc)) {
    const jpg = mats[mat];
    if (!jpg) continue;
    sizes[jpg] ||= await sharp(path.join(dir, jpg)).metadata();
    const npx = sizes[jpg].width * sizes[jpg].height;
    m2 += w; tx += u * npx;
    console.log(' ', mat, jpg, sizes[jpg].width + 'x' + sizes[jpg].height, 'm2', w.toFixed(0), 'cm/texel', (100 / Math.sqrt(u * npx / w)).toFixed(2));
  }
  return { m2, texeles: tx, cm: 100 / Math.sqrt(tx / m2) };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('texdens.mjs')) {
  let M = 0, T = 0;
  for (const f of process.argv.slice(2)) {
    const r = f.toLowerCase().endsWith('.obj') ? await densidadObj(f) : await densidadGlb(f);
    M += r.m2; T += r.texeles;
    console.log(path.basename(f), 'm2', r.m2.toFixed(1), 'Mtexeles', (r.texeles / 1e6).toFixed(2), 'cm/texel', r.cm.toFixed(2), r.cmMediana ? 'mediana ' + r.cmMediana.toFixed(2) : '');
  }
  if (process.argv.length > 3) console.log('TOTAL m2', M.toFixed(0), 'Mtexeles', (T / 1e6).toFixed(1), 'cm/texel', (100 / Math.sqrt(T / M)).toFixed(2));
}
