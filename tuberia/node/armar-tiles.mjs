// armar-tiles.mjs: de la salida de Obj2Tiles (3D Tiles 1.0, b3dm) a un tileset
// 3D Tiles 1.1 listo para el visor del sitio (glb + meshopt + JPEG/KTX2).
//
// De Obj2Tiles se usan SOLO las hojas (LOD-0: la malla original cortada, sin
// decimar) y la jerarquia del tileset.json. Todo lo demas se rehace aqui. Por que,
// en orden de importancia (todo medido en el Tintal el 23-sep-2026):
//
// 1. EJES. Obj2Tiles copia las coordenadas del OBJ tal cual al glTF. Un OBJ de
//    fotogrametria georreferenciado es Z-up (x = este, y = norte, z = altura),
//    pero glTF es Y-up por norma y el runtime de 3D Tiles rota cada glb con
//    (x, y, z) -> (x, -z, y). Resultado: en el marco del tileset la altura
//    quedaba en -Y y el norte en +Z; el visor con up '+y' mostraba el modelo
//    visto desde abajo (por eso hacia falta DoubleSide). Arreglo: root.transform
//    = rotacion de -90 grados en X, que deja el marco del tileset en (este,
//    norte, altura), el Z-up de la norma. Rotacion propia (det +1): no espeja.
//    Los glb no se tocan. Para ponerlo en ECEF: georref-tileset.mjs.
//
// 2. geometricError. Los de Obj2Tiles salen de la diagonal del modelo
//    (1050/525/262), sin relacion con la resolucion. Aqui cada tesela recibe
//        geometricError = FACTOR_GE * tamano_del_texel (m)
//    medido en su geometria y textura (texdens.mjs). Con FACTOR_GE = 16 y el
//    errorTarget por defecto (16 px), una tesela se refina cuando su texel pasa
//    de ~1 px CSS en pantalla. Las hojas llevan 0.
//
// 3. NIVELES GRUESOS. Los de Obj2Tiles no sirven: su decimador deja agujeros
//    (triangulos blancos en pantalla) y su reempaque de texturas copia el
//    rectangulo entero de cada isla UV, asi que un atlas de LOD-1 tenia ~5 % de
//    texeles utiles y llegaba a 81 Mpx (430 MB de GPU por tesela): la cache del
//    renderer se llenaba y dejaba de cargar hijos. Aqui cada padre se arma con
//    sus hijos: se juntan, sus texturas van a un atlas a la mitad de resolucion
//    (unirAtlas) y la malla se simplifica a la mitad con el borde de la tesela
//    bloqueado (simplificarDoc), para que vecinas simplificadas por separado
//    sigan encajando. La raiz sale igual, con topes de triangulos y Mpx.
//
// 4. HOJAS. Resolucion nativa: Obj2Tiles 1.6.2 recodifica las texturas de
//    LOD-0 a JPEG 75 fijo y, con --max-texture-size por defecto (4096), las
//    reduce a la mitad desde los atlas de 8192. Por eso Obj2Tiles corre con
//    --max-texture-size 0 sobre un OBJ con texturas PNG (a-png.mjs) y aqui se
//    codifican una sola vez a JPEG --calidad. Ademas se recorta cada atlas al
//    rectangulo que usan sus UV (sin perdida; ~40 % de cada atlas era negro).
//
// 5. PESO. Geometria EXT_meshopt_compression cuantizada (16 bits de posicion, 14
//    de UV: < 1 mm en una hoja). Con --ktx-gruesos, las texturas de los niveles
//    intermedios van en KTX2 ETC1S (en GPU 1 byte/px en vez de 4); hojas y raiz
//    siguen en JPEG (ETC1S se nota de cerca).
//
// Uso:
//   node armar-tiles.mjs <entrada-obj2tiles> <salida> [opciones]
//     --calidad 90        JPEG de hojas (y de intermedios sin --ktx-gruesos)
//     --factor-ge 16      geometricError = factor * texel (m)
//     --ratio 0.5         triangulos que conserva cada nivel respecto a sus hijos
//     --raiz-tris 120000  tope de triangulos de la raiz
//     --raiz-mpx 3.5      tope de megapixeles de textura de la raiz
//     --raiz-calidad 85   JPEG de la raiz (solo se ve de lejos)
//     --ktx-gruesos       KTX2 ETC1S en niveles intermedios (ktx.exe de KTX-Software)
//     --qlevel 128        calidad ETC1S (1-255)
//     --hilos 6
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { meshopt, prune, dedup, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { densidadGlb } from './texdens.mjs';
import { unirAtlas, simplificarDoc } from './simplificar.mjs';

sharp.cache(false);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [ENTRADA, SALIDA] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--ktx-gruesos'].includes(args[i - 1])));
const CALIDAD = +opt('calidad', 90);
const FACTOR_GE = +opt('factor-ge', 16);
const RATIO = +opt('ratio', 0.5);
const RAIZ_TRIS = +opt('raiz-tris', 120000);
const RAIZ_MPX = +opt('raiz-mpx', 3.5);
const RAIZ_CALIDAD = +opt('raiz-calidad', 85);
const HILOS = +opt('hilos', 6);
const KTX_GRUESOS = args.includes('--ktx-gruesos');
const KTX = opt('ktx', process.env.KTX || 'D:/geoai-vuelos/tools/KTX/bin/ktx.exe');
const QLEVEL = +opt('qlevel', 128);
const FUENTE = path.join(SALIDA, '.fuente'); // intermedios sin perdida (PNG, float); se borran al final

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder,
});

// b3dm -> glb: Obj2Tiles escribe feature table {"BATCH_LENGTH":0}, sin
// RTC_CENTER ni batch table, asi que el glb va tal cual despues de las tablas.
function glbDeB3dm(buf) {
  if (buf.toString('ascii', 0, 4) !== 'b3dm') return buf; // ya es glb
  const ftj = buf.readUInt32LE(12), ftb = buf.readUInt32LE(16), btj = buf.readUInt32LE(20), btb = buf.readUInt32LE(24);
  const ft = ftj ? JSON.parse(buf.toString('utf8', 28, 28 + ftj)) : {};
  if (ft.RTC_CENTER) throw new Error('b3dm con RTC_CENTER: no soportado en este script');
  return buf.subarray(28 + ftj + ftb + btj + btb);
}

async function texturasAJpeg(doc, calidad) {
  for (const tex of doc.getRoot().listTextures()) {
    if (tex.getMimeType() === 'image/jpeg') continue;
    const jpg = await sharp(Buffer.from(tex.getImage()), { limitInputPixels: false }).jpeg({ quality: calidad, chromaSubsampling: '4:2:0' }).toBuffer();
    tex.setImage(new Uint8Array(jpg)).setMimeType('image/jpeg');
    const uri = tex.getURI(); if (uri) tex.setURI(uri.replace(/\.\w+$/, '.jpg'));
  }
}

let nTmp = 0;
async function texturasAKtx2(doc) {
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  for (const tex of doc.getRoot().listTextures()) {
    const base = path.join(SALIDA, '.tmp-ktx', process.pid + '-' + (nTmp++));
    fs.mkdirSync(path.dirname(base), { recursive: true });
    await sharp(Buffer.from(tex.getImage()), { limitInputPixels: false }).png({ compressionLevel: 1 }).toFile(base + '.png');
    await promisify(execFile)(KTX, ['create', '--format', 'R8G8B8_SRGB', '--assign-tf', 'srgb', '--encode', 'basis-lz',
      '--qlevel', String(QLEVEL), '--clevel', '1', '--generate-mipmap', '--threads', '2', base + '.png', base + '.ktx2']);
    tex.setImage(new Uint8Array(fs.readFileSync(base + '.ktx2'))).setMimeType('image/ktx2');
    const uri = tex.getURI(); if (uri) tex.setURI(uri.replace(/\.\w+$/, '.ktx2'));
    fs.rmSync(base + '.png'); fs.rmSync(base + '.ktx2');
  }
}

// Recorta cada textura al rectangulo que usan sus UV (mas 4 px) y reescala las
// UV. Sin perdida: los texeles que quedan son los mismos. Sale en PNG.
async function recortarAtlas(doc) {
  const usos = new Map(); // textura -> primitivas
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const t = p.getMaterial()?.getBaseColorTexture(); if (!t || !p.getAttribute('TEXCOORD_0')) continue;
    (usos.get(t) || usos.set(t, []).get(t)).push(p);
  }
  const vistos = new Set();
  for (const [t, prims] of usos) {
    const [W, H] = t.getSize(); let u0 = 1, v0 = 1, u1 = 0, v1 = 0; const e = [0, 0];
    for (const p of prims) {
      let uv = p.getAttribute('TEXCOORD_0');
      if (vistos.has(uv)) { uv = uv.clone(); p.setAttribute('TEXCOORD_0', uv); } // no compartir entre texturas
      vistos.add(uv);
      for (let i = 0; i < uv.getCount(); i++) { uv.getElement(i, e); u0 = Math.min(u0, e[0]); u1 = Math.max(u1, e[0]); v0 = Math.min(v0, e[1]); v1 = Math.max(v1, e[1]); }
    }
    const x0 = Math.max(0, Math.floor(u0 * W) - 4) & ~3, y0 = Math.max(0, Math.floor(v0 * H) - 4) & ~3;
    let w = Math.min(W - x0, Math.ceil(u1 * W) + 4 - x0), h = Math.min(H - y0, Math.ceil(v1 * H) + 4 - y0);
    w = Math.min(W - x0, (w + 3) & ~3); h = Math.min(H - y0, (h + 3) & ~3);
    if (w * h > 0.9 * W * H) continue; // no vale la pena
    const png = await sharp(Buffer.from(t.getImage()), { limitInputPixels: false }).extract({ left: x0, top: y0, width: w, height: h }).png({ compressionLevel: 1 }).toBuffer();
    t.setImage(new Uint8Array(png)).setMimeType('image/png');
    for (const p of prims) {
      const uv = p.getAttribute('TEXCOORD_0');
      for (let i = 0; i < uv.getCount(); i++) { uv.getElement(i, e); uv.setElement(i, [(e[0] * W - x0) / w, (e[1] * H - y0) / h]); }
    }
  }
}

function contarTris(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  return n;
}

// Caja alineada a ejes en el marco del tileset: el runtime aplica
// (x, y, z)_gltf -> (x, -z, y) antes de root.transform.
function cajaGlb(doc) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], e = [0, 0, 0];
  for (const n of doc.getRoot().listNodes()) {
    const m = n.getMesh(); if (!m) continue; const W = n.getWorldMatrix();
    for (const p of m.listPrimitives()) {
      const a = p.getAttribute('POSITION');
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        const x = W[0] * e[0] + W[4] * e[1] + W[8] * e[2] + W[12];
        const y = W[1] * e[0] + W[5] * e[1] + W[9] * e[2] + W[13];
        const z = W[2] * e[0] + W[6] * e[1] + W[10] * e[2] + W[14];
        const v = [x, -z, y];
        for (let k = 0; k < 3; k++) { if (v[k] < mn[k]) mn[k] = v[k]; if (v[k] > mx[k]) mx[k] = v[k]; }
      }
    }
  }
  return [mn, mx];
}

const nombreFuente = (t) => path.join(FUENTE, t.content.uri.replace(/\.\w+$/, '.glb'));

// Documento con todos los hijos juntos en una escena.
async function juntarHijos(t) {
  const doc = await io.read(nombreFuente(t.children[0]));
  for (const c of t.children.slice(1)) mergeDocuments(doc, await io.read(nombreFuente(c)));
  const [escena, ...otras] = doc.getRoot().listScenes();
  for (const s of otras) { for (const n of s.listChildren()) escena.addChild(n); s.dispose(); }
  await doc.transform(unpartition());
  return doc;
}

async function procesar(t, esRaiz, esHoja) {
  let doc, trisAntes;
  if (esHoja) {
    doc = await io.readBinary(new Uint8Array(glbDeB3dm(fs.readFileSync(path.join(ENTRADA, t.content.uri)))));
    trisAntes = contarTris(doc);
    await recortarAtlas(doc);
  } else {
    doc = await juntarHijos(t);
    trisAntes = contarTris(doc);
    await unirAtlas(doc, { escala: 0.5, maxMpx: esRaiz ? RAIZ_MPX : Infinity, formato: 'png' });
    const ratio = esRaiz ? Math.min(RATIO, RAIZ_TRIS / trisAntes) : RATIO;
    // La raiz no tiene vecinas: su borde es el del modelo y puede moverse.
    await simplificarDoc(doc, { ratio, error: 0.02, pesoUV: 200, bloquearBorde: !esRaiz });
  }
  if (!esRaiz) {
    const f = nombreFuente(t); fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, await io.writeBinary(doc));
  }
  const dens = await densidadGlb(null, doc);
  const [mn, mx] = cajaGlb(doc);
  if (KTX_GRUESOS && !esRaiz && !esHoja) await texturasAKtx2(doc);
  else await texturasAJpeg(doc, esRaiz ? RAIZ_CALIDAD : CALIDAD);
  // La raiz solo se ve de lejos: 14 bits de posicion (5 cm en 830 m) y 12 de UV.
  await doc.transform(dedup(), prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: esRaiz ? 14 : 16, quantizeTexcoord: esRaiz ? 12 : 14, quantizeNormal: 10 }));
  const salida = t.content.uri.replace(/\.\w+$/, '.glb');
  fs.mkdirSync(path.dirname(path.join(SALIDA, salida)), { recursive: true });
  const bin = await io.writeBinary(doc);
  fs.writeFileSync(path.join(SALIDA, salida), bin);
  t.content.uri = salida;
  return { mn, mx, texel: dens.cmMediana / 100, bytes: bin.byteLength, tris: contarTris(doc), trisAntes };
}

const ts = JSON.parse(fs.readFileSync(path.join(ENTRADA, 'tileset.json'), 'utf8'));
fs.mkdirSync(SALIDA, { recursive: true });
// Por niveles, de las hojas hacia la raiz: un padre necesita a sus hijos listos.
const porProf = [];
(function juntar(t, d) { (porProf[d] ||= []).push(t); (t.children || []).forEach(c => juntar(c, d + 1)); })(ts.root, 0);
const res = new Map();
let hechos = 0, bytesTot = 0;
for (let d = porProf.length - 1; d >= 0; d--) {
  const cola = porProf[d].filter(t => t.content?.uri);
  await Promise.all(Array.from({ length: HILOS }, async () => {
    while (cola.length) {
      const t = cola.shift();
      const esHoja = !(t.children && t.children.length), esRaiz = t === ts.root;
      const r = await procesar(t, esRaiz, esHoja);
      res.set(t, r); bytesTot += r.bytes; hechos++;
      if (esRaiz) console.log(`raiz: ${r.trisAntes} -> ${r.tris} tris, ${(r.bytes / 1e6).toFixed(2)} MB, texel ${(r.texel * 100).toFixed(1)} cm`);
    }
  }));
  console.log(`profundidad ${d} lista: ${hechos} teselas, ${(bytesTot / 1e6).toFixed(0)} MB`);
}

// Cajas (union con los hijos) y geometricError por texel.
const porNivel = {};
function cerrar(t, nivel) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], geHijos = 0;
  const r = res.get(t);
  if (r) { mn = [...r.mn]; mx = [...r.mx]; }
  for (const c of t.children || []) {
    const [a, b, ge] = cerrar(c, nivel + 1);
    for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a[k]); mx[k] = Math.max(mx[k], b[k]); }
    geHijos = Math.max(geHijos, ge);
  }
  const c = [0, 1, 2].map(k => (mn[k] + mx[k]) / 2), h = [0, 1, 2].map(k => Math.max((mx[k] - mn[k]) / 2, 0.01));
  t.boundingVolume = { box: [c[0], c[1], c[2], h[0], 0, 0, 0, h[1], 0, 0, 0, h[2]] };
  const hoja = !(t.children && t.children.length);
  // Una hoja no se refina: error 0. Un padre nunca menos que sus hijos.
  t.geometricError = hoja ? 0 : Math.max(r ? FACTOR_GE * r.texel : 0, geHijos * 1.01);
  t.refine = 'REPLACE';
  delete t.transform;
  (porNivel[nivel] ||= []).push({ ge: t.geometricError, texel: r?.texel, tris: r?.tris, mb: r ? r.bytes / 1e6 : 0 });
  return [mn, mx, t.geometricError];
}
cerrar(ts.root, 0);

// Ejes: marco del tileset (x, y, z) = (este, -altura, norte) -> (este, norte, altura).
// Rotacion -90 grados en X: (x, y, z) -> (x, z, -y). Columna mayor.
const EJES = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
ts.root.transform = EJES;
ts.asset = { version: '1.1', generator: 'Obj2Tiles 1.6.2 (hojas) + armar-tiles.mjs (GeoAI LATAM)' };
ts.geometricError = ts.root.geometricError * 2;
fs.writeFileSync(path.join(SALIDA, 'tileset.json'), JSON.stringify(ts));
fs.rmSync(FUENTE, { recursive: true, force: true });
fs.rmSync(path.join(SALIDA, '.tmp-ktx'), { recursive: true, force: true });
for (const [n, l] of Object.entries(porNivel)) {
  const tex = l.filter(x => x.texel).map(x => x.texel * 100).sort((a, b) => a - b);
  const tris = l.reduce((a, x) => a + (x.tris || 0), 0), mb = l.reduce((a, x) => a + x.mb, 0);
  console.log(`nivel ${n}: ${l.length} teselas, ${Math.round(tris / l.length)} tris/tesela, ${mb.toFixed(0)} MB, geometricError ${Math.min(...l.map(x => x.ge)).toFixed(2)}-${Math.max(...l.map(x => x.ge)).toFixed(2)}, texel mediano ${tex.length ? tex[tex.length >> 1].toFixed(2) : '-'} cm`);
}
console.log(`listo: ${res.size} teselas, ${(bytesTot / 1e6).toFixed(0)} MB en ${SALIDA}`);
