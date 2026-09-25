// simplificar.mjs: atlas unico + simplificacion de mallas de fotogrametria texturizadas.
//
// El problema: una malla de fotogrametria tiene el atlas UV partido en miles de
// islas. Cada borde de isla es una "costura": el mismo punto del espacio con dos
// UV distintas, o sea dos vertices. El simplificador normal no mueve costuras y
// se atasca en ~60 % de los triangulos. El modo agresivo (gltfpack -sa,
// simplifySloppy) ignora la topologia y deja agujeros y astillas: probado en el
// Tintal, no sirve. El decimador de Obj2Tiles tambien deja agujeros (se ven en
// sus LOD gruesos y en su raiz).
//
// Lo que se usa aqui:
//  1. unirAtlas: todas las texturas del documento a UN atlas (reducidas por
//     `escala`) y todas las primitivas a una sola. Los bordes entre texturas
//     dejan de ser bordes de malla y pasan a ser costuras UV.
//  2. simplificarDoc: posiciones redondeadas a 1 mm y soldadas (los cortes entre
//     teselas de Obj2Tiles dejan dos filas de vertices casi iguales; sin soldar se
//     abren grietas en cuadricula, se vio en pantalla), y meshoptimizer
//     simplifyWithAttributes con 'Permissive' y mucho peso en las UV (con peso
//     0,5 la textura quedaba hecha trizas). Con `bloquearBorde` no se mueve el
//     borde abierto de la malla: es el borde de la tesela, y asi dos teselas
//     vecinas simplificadas por separado siguen encajando sin grietas.
//
// Uso como modulo:
//   await unirAtlas(doc, { escala, maxMpx, formato: 'png' | 'jpeg', calidad })
//   await simplificarDoc(doc, { ratio, error, pesoUV, bloquearBorde })
// Uso suelto: ATLAS=escala node simplificar.mjs entrada.glb|b3dm salida.glb ratio [error] [pesoUV]
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, compactPrimitive, prune, joinPrimitives } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const m4 = (v) => Math.max(4, Math.round(v / 4) * 4);

export async function unirAtlas(doc, { escala = 1, maxMpx = Infinity, formato = 'jpeg', calidad = 92 } = {}) {
  const root = doc.getRoot();
  const prims = root.listMeshes().flatMap(m => m.listPrimitives());
  const texs = [...new Set(prims.map(p => p.getMaterial()?.getBaseColorTexture()).filter(Boolean))];
  let total = 0; for (const t of texs) { const [w, h] = t.getSize(); total += w * h * escala * escala; }
  const f = escala * Math.min(1, Math.sqrt(maxMpx * 1e6 / total));
  const celdas = [];
  for (const t of texs) {
    const [w0, h0] = t.getSize(); const w = m4(w0 * f), h = m4(h0 * f);
    const img = await sharp(Buffer.from(t.getImage()), { limitInputPixels: false }).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
    celdas.push({ t, w, h, img });
  }
  // estantes, de la mas alta a la mas baja, en un ancho ~ raiz del area total
  const area = celdas.reduce((a, c) => a + c.w * c.h, 0);
  const ancho = m4(Math.max(Math.max(...celdas.map(c => c.w)), Math.sqrt(area * 1.15)));
  let x = 0, y = 0, altoFila = 0;
  for (const c of [...celdas].sort((a, b) => b.h - a.h)) {
    if (x + c.w > ancho) { x = 0; y += altoFila; altoFila = 0; }
    c.x = x; c.y = y; x += c.w; altoFila = Math.max(altoFila, c.h);
  }
  const alto = m4(y + altoFila);
  let atlas = sharp({ create: { width: ancho, height: alto, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite(celdas.map(c => ({ input: c.img, raw: { width: c.w, height: c.h, channels: 3 }, left: c.x, top: c.y })));
  atlas = formato === 'png' ? atlas.png({ compressionLevel: 1 }) : atlas.jpeg({ quality: calidad, chromaSubsampling: '4:2:0' });
  const buf = await atlas.toBuffer();
  const tex = doc.createTexture('atlas').setImage(new Uint8Array(buf)).setMimeType(formato === 'png' ? 'image/png' : 'image/jpeg');
  const mat = doc.createMaterial('atlas').setBaseColorTexture(tex).setRoughnessFactor(1).setMetallicFactor(0);
  const porTex = new Map(celdas.map(c => [c.t, c]));
  const e = [0, 0], hechos = new Set();
  for (const p of prims) {
    const c = porTex.get(p.getMaterial()?.getBaseColorTexture()); if (!c) continue;
    let uv = p.getAttribute('TEXCOORD_0');
    if (hechos.has(uv)) { uv = uv.clone(); p.setAttribute('TEXCOORD_0', uv); }
    hechos.add(uv);
    // medio texel hacia adentro de la celda para que el filtrado no tome la vecina
    const mu = 0.5 / c.w, mv = 0.5 / c.h;
    for (let i = 0; i < uv.getCount(); i++) {
      uv.getElement(i, e);
      const u = Math.min(1 - mu, Math.max(mu, e[0])), v = Math.min(1 - mv, Math.max(mv, e[1]));
      uv.setElement(i, [(c.x + u * c.w) / ancho, (c.y + v * c.h) / alto]);
    }
    p.setMaterial(mat);
  }
  // una sola malla con una sola primitiva
  const meshes = root.listMeshes();
  const todas = meshes.flatMap(m => m.listPrimitives());
  if (todas.length > 1) {
    const j = joinPrimitives(todas);
    for (const m of meshes) for (const q of m.listPrimitives()) m.removePrimitive(q);
    meshes[0].addPrimitive(j);
    for (const n of root.listNodes()) if (n.getMesh() && n.getMesh() !== meshes[0]) n.setMesh(null);
  }
  await doc.transform(prune());
  return { ancho, alto, texturas: celdas.length };
}

export async function simplificarDoc(doc, { ratio = 0.5, error = 0.02, pesoUV = 200, bloquearBorde = false } = {}) {
  await MeshoptSimplifier.ready;
  for (const acc of new Set(doc.getRoot().listMeshes().flatMap(m => m.listPrimitives().map(p => p.getAttribute('POSITION'))))) {
    const a = acc.getArray(); for (let i = 0; i < a.length; i++) a[i] = Math.round(a[i] * 1000) / 1000;
  }
  await doc.transform(weld());
  let antes = 0, despues = 0;
  for (const prim of doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())) {
    const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0'), idx = prim.getIndices();
    if (!pos || !idx) continue;
    const n = pos.getCount();
    const P = new Float32Array(n * 3), A = new Float32Array(n * 2), e = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      pos.getElement(i, e); P[i * 3] = e[0]; P[i * 3 + 1] = e[1]; P[i * 3 + 2] = e[2];
      if (uv) { uv.getElement(i, e); A[i * 2] = e[0]; A[i * 2 + 1] = e[1]; }
    }
    const I = new Uint32Array(idx.getArray());
    const objetivo = Math.max(3, Math.floor((I.length / 3) * ratio) * 3);
    const flags = ['Permissive']; if (bloquearBorde) flags.push('LockBorder');
    const [nuevo] = MeshoptSimplifier.simplifyWithAttributes(I, P, 3, A, 2, [pesoUV, pesoUV], null, objetivo, error, flags);
    antes += I.length / 3; despues += nuevo.length / 3;
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(n > 65535 ? new Uint32Array(nuevo) : new Uint16Array(nuevo)).setBuffer(idx.getBuffer()));
    compactPrimitive(prim);
  }
  await doc.transform(prune());
  return { antes, despues };
}

if (process.argv[1] && process.argv[1].endsWith('simplificar.mjs')) {
  const [inp, out, r, err, w] = process.argv.slice(2);
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  let buf = fs.readFileSync(inp);
  if (buf.toString('ascii', 0, 4) === 'b3dm') buf = buf.subarray(28 + buf.readUInt32LE(12) + buf.readUInt32LE(16) + buf.readUInt32LE(20) + buf.readUInt32LE(24));
  const doc = await io.readBinary(new Uint8Array(buf));
  if (process.env.ATLAS) console.log(await unirAtlas(doc, { escala: +process.env.ATLAS }));
  console.log(await simplificarDoc(doc, { ratio: +(r || 0.5), error: +(err || 0.02), pesoUV: +(w || 200) }));
  fs.writeFileSync(out, await io.writeBinary(doc));
}
