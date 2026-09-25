// slpk_a_tiles.mjs: de un SLPK de malla integrada (I3S 1.9, IntegratedMesh) a un
// tileset 3D Tiles 1.1 georreferenciado (ECEF), listo para el explorador de vuelos
// del sitio (components/ui/EscenaVuelos.js), mas su huella y un informe de alturas.
//
// Uso:
//   node D:/geoai-vuelos/tools/slpk_a_tiles.mjs <archivo.slpk> <slug> [opciones]
//     --salida D:/geoai-vuelos/<slug>   carpeta del vuelo (por defecto esa)
//     --sin-ktx          JPEG tambien en los niveles intermedios
//     --factor-ge 16     geometricError = factor * tamano del texel (m), como el Tintal
//     --solo-medir       no convierte: rehace huella + informe sobre <slug>-geo existente
//   Conviene correrlo con TMP/TEMP en D: y --max-old-space-size=3072.
//
// Salidas, en <salida>/:
//   <slug>-geo/tileset.json + <n>.glb   el tileset (n = indice del nodo I3S)
//   <slug>.huella.geojson                huella (huella_tileset.mjs, con --paso)
//   informe.json                         pesos, niveles, texel, residuo contra AWS,
//                                        geoide_m y ajuste_altura_m sugeridos
//   aws-terrarium/                       teselas de terreno bajadas (cache, KB)
//
// POR QUE NO @loaders.gl/tile-converter (se probo con el piloto, rotonda-kennedy,
// el 24-sep-2026; su salida quedo en rotonda-kennedy/tc):
//   - Suma la ondulacion del geoide solo al centro de las CAJAS
//     (i3s-obb-to-3d-tiles-obb.ts), no a los vertices: la geometria queda con la
//     altura ortometrica tratada como elipsoidal y las cajas ~20 m por encima de
//     ella. El recorte por frustum puede botar teselas que si se ven.
//   - Mete las texturas KTX2 del SLPK como image/ktx2 sin declarar
//     KHR_texture_basisu: un cargador glTF estricto no las abre.
//   - geometricError sale de lodThreshold (maxScreenThresholdSQ) con una formula
//     que no tiene que ver con la resolucion de la textura.
//   - Geometria sin indices ni compresion (float32 plano): 484 MB contra ~250.
//
// QUE HACE ESTE SCRIPT (lectura directa del SLPK, sin reprocesar imagenes):
//   1. ZIP: el SLPK es un zip sin compresion (metodo 0) con .gz adentro. Se lee
//      el directorio central (con ZIP64) y cada entrada se lee por desplazamiento:
//      no se descomprime el SLPK entero ni se carga en memoria.
//   2. JERARQUIA: la de los nodepages del SLPK tal cual (node-switching de I3S =
//      refine REPLACE de 3D Tiles). Los niveles gruesos del SLPK los hizo el
//      software de fotogrametria y son buenos: no hace falta rehacerlos como en
//      el Tintal (alli Obj2Tiles dejaba huecos y atlas enormes).
//   3. GEOMETRIA: geometries/0.bin.gz (sin Draco): vertexCount, featureCount,
//      posiciones float32 como desplazamientos desde obb.center (x, y en GRADOS,
//      z en metros), uv0 float32. Triangulos sueltos (sin indices): se sueldan
//      los vertices identicos (posicion + uv del origen) y quedan indexados.
//   4. ALTURAS: el SLPK trae altura ortometrica EGM96 (vcsWkid 5773). Se le suma
//      N = ondulacion EGM96 en el centro (bilineal sobre us_nga_egm96_15.tif) y
//      queda altura elipsoidal WGS84, que es lo que espera 3D Tiles. El visor
//      baja escena.geoide_m = ese mismo N, porque el terreno Terrarium de AWS es
//      ortometrico EGM96 puesto sobre el elipsoide. N constante: en 1-2 km
//      EGM96 cambia centimetros.
//   5. MARCO: todo el tileset en un solo marco local ENU (este, norte, arriba) con
//      origen en el centro del extent a la altura del nodo raiz, y root.transform
//      = ENU -> ECEF. En el glb van (este, arriba, -norte) porque glTF es Y-arriba
//      y el runtime rota Y->Z. Rotacion propia: no espeja ni cambia el giro.
//   6. TEXTURAS: hojas y primer nivel con el JPEG original del SLPK (resolucion de
//      origen, sin recodificar: el texel de las hojas ES el del SLPK). Niveles
//      intermedios con el KTX2 ETC1S (con mipmaps) que tambien trae el SLPK, con
//      KHR_texture_basisu: en GPU 1 byte/px en vez de 4, como el Tintal.
//   7. geometricError = FACTOR_GE * texel (mediana por triangulo ponderada por
//      area, igual que texdens.mjs); hojas 0; un padre nunca menos que 1.01 x sus
//      hijos. Con errorTarget 24 (el del sitio) se refina cuando el texel pasa
//      de ~1,5 px en pantalla.
//   8. GIRO: el visor dibuja solo caras frontales. Se mide en unas hojas si las
//      normales del suelo apuntan arriba; si no, se invierte el orden.
//   9. PESO: EXT_meshopt_compression, posicion 16 bits, UV 14 (como el Tintal).
//  10. HUELLA: huella_tileset.mjs sobre las hojas, con --paso para no cargar en
//      memoria todos los vertices en los vuelos grandes.
//  11. INFORME DE ALTURA: de una muestra de vertices de las hojas (lon, lat, H
//      ortometrica), celdas de 10 m; suelo = percentil 5; solo celdas de suelo
//      abierto (p95 - p5 < 1 m); terreno = Terrarium z15 bilineal (lo mismo que
//      residuo_terreno_aws.py). residuo = terreno - suelo. Como el visor muestra
//      la malla en H + ajuste, la sugerencia de escena.ajuste_altura_m es la
//      mediana del residuo en suelo abierto.
//
// Reanudable: cada nodo terminado queda en <slug>-geo/.progreso.jsonl; si el
// proceso muere (poca memoria) se vuelve a correr igual y sigue donde iba.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// TOOLS es la carpeta de este script (tuberia/ en el repo); RAIZ, la de los
// datos de los vuelos, que no están en el repo. Las dependencias de Node van en
// tuberia/node (npm install ahí), y el geoide EGM96 en <RAIZ>/tools/geoide.
const TOOLS = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const RAIZ = process.env.VUELOS_RAIZ || 'D:/geoai-vuelos';
const require = createRequire(`${TOOLS}/node/package.json`);
const { Document, NodeIO, Logger } = require('@gltf-transform/core');
const { ALL_EXTENSIONS, KHRTextureBasisu } = require('@gltf-transform/extensions');
const { meshopt } = require('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder } = require('meshoptimizer');
const sharp = require('sharp');
sharp.cache(false);

const PYTHON = process.env.PYTHON || `${RAIZ}/venv/Scripts/python.exe`;
const EGM96 = process.env.VUELOS_GEOIDE || `${RAIZ}/tools/geoide/us_nga_egm96_15.tif`;

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const BANDERAS = ['--sin-ktx', '--solo-medir'];
const [SLPK, SLUG] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !BANDERAS.includes(args[i - 1])));
if (!SLPK || !SLUG) { console.error('uso: node slpk_a_tiles.mjs <archivo.slpk> <slug> [--salida dir] [--sin-ktx] [--factor-ge 16] [--solo-medir]'); process.exit(1); }
const SALIDA = opt('salida', `${RAIZ}/${SLUG}`);
const GEO = path.join(SALIDA, `${SLUG}-geo`);
const FACTOR_GE = +opt('factor-ge', 16);
const KTX_INTERMEDIOS = !args.includes('--sin-ktx');
const SOLO_MEDIR = args.includes('--solo-medir');
const MUESTRA_MAX = 3e6; // vertices de hojas para el informe de altura
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s]`, ...a);

// ─── 1. ZIP (con ZIP64) ──────────────────────────────────────────────────
function abrirZip(archivo) {
  const fd = fs.openSync(archivo, 'r');
  const tam = fs.fstatSync(fd).size;
  const nCola = Math.min(tam, 65557 + 20);
  const cola = Buffer.alloc(nCola);
  fs.readSync(fd, cola, 0, nCola, tam - nCola);
  const e = cola.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (e < 0) throw new Error('no es un zip (sin EOCD)');
  let n = cola.readUInt16LE(e + 10), cdTam = cola.readUInt32LE(e + 12), cdOff = cola.readUInt32LE(e + 16);
  if (n === 0xffff || cdTam === 0xffffffff || cdOff === 0xffffffff) {
    const loc = e - 20;
    if (cola.readUInt32LE(loc) !== 0x07064b50) throw new Error('ZIP64 sin localizador');
    const b = Buffer.alloc(56);
    fs.readSync(fd, b, 0, 56, Number(cola.readBigUInt64LE(loc + 8)));
    if (b.readUInt32LE(0) !== 0x06064b50) throw new Error('ZIP64 EOCD invalido');
    n = Number(b.readBigUInt64LE(32)); cdTam = Number(b.readBigUInt64LE(40)); cdOff = Number(b.readBigUInt64LE(48));
  }
  const cd = Buffer.alloc(cdTam);
  fs.readSync(fd, cd, 0, cdTam, cdOff);
  const entradas = new Map();
  for (let i = 0, p = 0; i < n; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('directorio central roto');
    const metodo = cd.readUInt16LE(p + 10);
    let comp = cd.readUInt32LE(p + 20), sinComp = cd.readUInt32LE(p + 24), off = cd.readUInt32LE(p + 42);
    const ln = cd.readUInt16LE(p + 28), lx = cd.readUInt16LE(p + 30), lc = cd.readUInt16LE(p + 32);
    const nombre = cd.toString('utf8', p + 46, p + 46 + ln).replace(/\\/g, '/');
    for (let x = p + 46 + ln; x < p + 46 + ln + lx;) { // campo extra ZIP64 (0x0001)
      const id = cd.readUInt16LE(x), l = cd.readUInt16LE(x + 2);
      if (id === 1) {
        let q = x + 4;
        if (sinComp === 0xffffffff) { sinComp = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (comp === 0xffffffff) { comp = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (off === 0xffffffff) { off = Number(cd.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + l;
    }
    entradas.set(nombre, { metodo, comp, off });
    p += 46 + ln + lx + lc;
  }
  const cab = Buffer.alloc(30);
  const leer = (nombre) => {
    const en = entradas.get(nombre);
    if (!en) return null;
    fs.readSync(fd, cab, 0, 30, en.off);
    const ini = en.off + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
    const b = Buffer.alloc(en.comp);
    fs.readSync(fd, b, 0, en.comp, ini);
    const datos = en.metodo === 8 ? zlib.inflateRawSync(b) : b;
    return nombre.endsWith('.gz') ? zlib.gunzipSync(datos) : datos;
  };
  return { leer, tiene: (n) => entradas.has(n), cerrar: () => fs.closeSync(fd) };
}

// ─── WGS84 y matrices (columna mayor) ────────────────────────────────────
const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), RAD = Math.PI / 180;
function geoAEcef(lon, lat, h) {
  const la = lat * RAD, lo = lon * RAD, sl = Math.sin(la), cl = Math.cos(la);
  const N = A / Math.sqrt(1 - E2 * sl * sl);
  return [(N + h) * cl * Math.cos(lo), (N + h) * cl * Math.sin(lo), (N * (1 - E2) + h) * sl];
}
function enuAEcef(lat, lon, h) {
  const la = lat * RAD, lo = lon * RAD, sl = Math.sin(la), cl = Math.cos(la), so = Math.sin(lo), co = Math.cos(lo);
  const [x, y, z] = geoAEcef(lon, lat, h);
  return [-so, co, 0, 0, -sl * co, -sl * so, cl, 0, cl * co, cl * so, sl, 0, x, y, z, 1];
}

// Ondulacion EGM96, bilineal sobre la grilla de 15' (rasterio del venv).
function geoideEgm96(lat, lon) {
  const py = `
import os, sys
os.environ.pop('PROJ_LIB', None)
import rasterio
lat, lon = float(sys.argv[1]), float(sys.argv[2])
with rasterio.open(sys.argv[3]) as ds:
    c, r = ~ds.transform * (lon, lat)
    c -= 0.5; r -= 0.5
    c0, r0 = int(c // 1), int(r // 1)
    w = ds.read(1, window=((r0, r0 + 2), (c0, c0 + 2))).astype(float)
    dc, dr = c - c0, r - r0
    print(w[0,0]*(1-dc)*(1-dr) + w[0,1]*dc*(1-dr) + w[1,0]*(1-dc)*dr + w[1,1]*dc*dr)
`;
  return +execFileSync(PYTHON, ['-c', py, String(lat), String(lon), EGM96], { encoding: 'utf8' }).trim();
}

function tamJpeg(b) {
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error('JPEG sin SOF');
}

// ─── lectura del SLPK ────────────────────────────────────────────────────
const zip = abrirZip(SLPK);
const capa = JSON.parse(zip.leer('3dSceneLayer.json.gz'));
const sr = capa.spatialReference || {};
if (capa.layerType !== 'IntegratedMesh') throw new Error(`capa ${capa.layerType}: solo IntegratedMesh`);
if (sr.wkid !== 4326) throw new Error(`wkid ${sr.wkid}: solo 4326`);
if (sr.vcsWkid !== 5773) console.warn(`AVISO: vcsWkid ${sr.vcsWkid} (se esperaba 5773, EGM96): el N sumado puede no corresponder`);
const nodos = [];
for (let i = 0; zip.tiene(`nodepages/${i}.json.gz`); i++) nodos.push(...JSON.parse(zip.leer(`nodepages/${i}.json.gz`)).nodes);
const porIndice = new Map(nodos.map((n) => [n.index, n]));
const raizI3s = porIndice.get(capa.nodePages?.rootIndex ?? 0);
const prof = new Map();
(function rec(n, d) { prof.set(n.index, d); for (const c of n.children || []) rec(porIndice.get(c), d + 1); })(raizI3s, 0);
const esHoja = (n) => !(n.children && n.children.length);
const [xmin, ymin, xmax, ymax] = capa.store.extent;
const LON0 = (xmin + xmax) / 2, LAT0 = (ymin + ymax) / 2;
const H0 = Math.round(raizI3s.obb.center[2]);
const N_GEOIDE = +geoideEgm96(LAT0, LON0).toFixed(2);
const H0_ELIP = H0 + N_GEOIDE;
const M_RAIZ = enuAEcef(LAT0, LON0, H0_ELIP);
const O = geoAEcef(LON0, LAT0, H0_ELIP);
const sl0 = Math.sin(LAT0 * RAD), cl0 = Math.cos(LAT0 * RAD), so0 = Math.sin(LON0 * RAD), co0 = Math.cos(LON0 * RAD);
log(`${path.basename(SLPK)}: ${nodos.length} nodos, ${Math.max(...prof.values()) + 1} niveles; origen ${LAT0.toFixed(6)}, ${LON0.toFixed(6)}, H ${H0} m + N EGM96 ${N_GEOIDE} m`);

// Vertices de un nodo en ENU (float64), uv, y geo (lon, lat, H ortometrica).
function leerGeometria(n) {
  const r = n.mesh.geometry.resource;
  const b = zip.leer(`nodes/${r}/geometries/0.bin.gz`);
  if (!b) throw new Error(`nodo ${n.index}: sin geometries/0.bin.gz (solo Draco no esta soportado)`);
  const vc = b.readUInt32LE(0);
  const pos = new Float32Array(b.buffer.slice(b.byteOffset + 8, b.byteOffset + 8 + vc * 12));
  const uv = new Float32Array(b.buffer.slice(b.byteOffset + 8 + vc * 12, b.byteOffset + 8 + vc * 20));
  return { vc, pos, uv, centro: n.obb.center };
}

// Suelda vertices identicos (mismos bytes de posicion y uv en el origen).
function soldar({ vc, pos, uv, centro }, invertir) {
  const pb = new Uint8Array(pos.buffer), ub = new Uint8Array(uv.buffer);
  const mapa = new Map(), idx = new Uint32Array(vc), unicos = [];
  for (let i = 0; i < vc; i++) {
    let k = '';
    for (let j = i * 12; j < i * 12 + 12; j++) k += String.fromCharCode(pb[j]);
    for (let j = i * 8; j < i * 8 + 8; j++) k += String.fromCharCode(ub[j]);
    let v = mapa.get(k);
    if (v === undefined) { v = unicos.length; mapa.set(k, v); unicos.push(i); }
    idx[i] = v;
  }
  if (invertir) for (let i = 0; i + 2 < vc; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const nv = unicos.length;
  const enu = new Float64Array(nv * 3), geo = new Float64Array(nv * 3), uvs = new Float32Array(nv * 2);
  for (let v = 0; v < nv; v++) {
    const i = unicos[v];
    const lon = centro[0] + pos[i * 3], lat = centro[1] + pos[i * 3 + 1], H = centro[2] + pos[i * 3 + 2];
    geo[v * 3] = lon; geo[v * 3 + 1] = lat; geo[v * 3 + 2] = H;
    const [x, y, z] = geoAEcef(lon, lat, H + N_GEOIDE);
    const dx = x - O[0], dy = y - O[1], dz = z - O[2];
    enu[v * 3] = -so0 * dx + co0 * dy;
    enu[v * 3 + 1] = -sl0 * co0 * dx - sl0 * so0 * dy + cl0 * dz;
    enu[v * 3 + 2] = cl0 * co0 * dx + cl0 * so0 * dy + sl0 * dz;
    uvs[v * 2] = uv[i * 2]; uvs[v * 2 + 1] = uv[i * 2 + 1];
  }
  return { nv, idx, enu, geo, uvs };
}

// Suma de (area * componente vertical de la normal): > 0 si el suelo mira arriba.
function giroArriba(enu, idx) {
  let s = 0;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = enu[b] - enu[a], uy = enu[b + 1] - enu[a + 1], vx = enu[c] - enu[a], vy = enu[c + 1] - enu[a + 1];
    s += ux * vy - uy * vx;
  }
  return s;
}

// Tamano del texel (m): mediana por triangulo ponderada por area (texdens.mjs).
function texelM(enu, uvs, idx, W, H) {
  const lista = []; let area = 0;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = enu[b * 3] - enu[a * 3], ay = enu[b * 3 + 1] - enu[a * 3 + 1], az = enu[b * 3 + 2] - enu[a * 3 + 2];
    const bx = enu[c * 3] - enu[a * 3], by = enu[c * 3 + 1] - enu[a * 3 + 1], bz = enu[c * 3 + 2] - enu[a * 3 + 2];
    const w = 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    if (w < 1e-8) continue;
    const u = 0.5 * Math.abs((uvs[b * 2] - uvs[a * 2]) * (uvs[c * 2 + 1] - uvs[a * 2 + 1]) - (uvs[c * 2] - uvs[a * 2]) * (uvs[b * 2 + 1] - uvs[a * 2 + 1])) * W * H;
    lista.push([u / w, w]); area += w;
  }
  lista.sort((p, q) => p[0] - q[0]);
  let acum = 0;
  for (const [d, w] of lista) { acum += w; if (acum >= area / 2) return d > 0 ? 1 / Math.sqrt(d) : Infinity; }
  return Infinity;
}

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

async function glbDeNodo(n, s, conKtx) {
  const r = n.mesh.material?.resource ?? n.mesh.geometry.resource;
  const jpg = zip.leer(`nodes/${r}/textures/0.jpg`);
  const [W, H] = tamJpeg(jpg);
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  const buf = doc.createBuffer();
  // glTF Y-arriba: (este, arriba, -norte)
  const p32 = new Float32Array(s.nv * 3);
  for (let v = 0; v < s.nv; v++) { p32[v * 3] = s.enu[v * 3]; p32[v * 3 + 1] = s.enu[v * 3 + 2]; p32[v * 3 + 2] = -s.enu[v * 3 + 1]; }
  const posA = doc.createAccessor().setType('VEC3').setArray(p32).setBuffer(buf);
  const uvA = doc.createAccessor().setType('VEC2').setArray(s.uvs).setBuffer(buf);
  const idxA = doc.createAccessor().setType('SCALAR').setArray(s.nv > 65535 ? s.idx : Uint16Array.from(s.idx)).setBuffer(buf);
  let tex;
  if (conKtx) {
    doc.createExtension(KHRTextureBasisu).setRequired(true);
    tex = doc.createTexture().setImage(new Uint8Array(zip.leer(`nodes/${r}/textures/1.ktx2`))).setMimeType('image/ktx2').setURI(`${n.index}.ktx2`);
  } else {
    tex = doc.createTexture().setImage(new Uint8Array(jpg)).setMimeType('image/jpeg').setURI(`${n.index}.jpg`);
  }
  const mat = doc.createMaterial().setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(1);
  const prim = doc.createPrimitive().setAttribute('POSITION', posA).setAttribute('TEXCOORD_0', uvA).setIndices(idxA).setMaterial(mat);
  const mesh = doc.createMesh().addPrimitive(prim);
  doc.createScene().addChild(doc.createNode().setMesh(mesh));
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeTexcoord: 14 }));
  return { bin: await io.writeBinary(doc), W, H };
}

fs.mkdirSync(GEO, { recursive: true });
const PROGRESO = path.join(GEO, '.progreso.jsonl');
const MUESTRA = path.join(SALIDA, '.muestra-hojas.f64'); // lon, lat, H ortometrica
const conMalla = nodos.filter((n) => n.mesh);
const vertHojas = conMalla.filter(esHoja).reduce((a, n) => a + n.mesh.geometry.vertexCount, 0);
const PASO_MUESTRA = Math.max(1, Math.ceil(vertHojas / 3 / MUESTRA_MAX)); // ~1/3 queda tras soldar
const hechos = new Map();
let invertir = false;

if (!SOLO_MEDIR) {
  if (fs.existsSync(PROGRESO)) for (const l of fs.readFileSync(PROGRESO, 'utf8').split('\n')) if (l) { const o = JSON.parse(l); hechos.set(o.i, o); }
  // Giro: en hasta 40 hojas, las caras de suelo deben mirar arriba.
  let g = 0;
  for (const n of conMalla.filter(esHoja).slice(0, 40)) { const s = soldar(leerGeometria(n), false); g += giroArriba(s.enu, s.idx); }
  invertir = g < 0;
  log(`giro de las caras: ${invertir ? 'horario visto desde arriba -> se invierte' : 'antihorario (bien)'}; ${hechos.size} nodos ya hechos antes`);
  const fdMuestra = fs.openSync(MUESTRA, hechos.size ? 'a' : 'w');
  const progreso = fs.openSync(PROGRESO, 'a');
  let listos = hechos.size, bytes = [...hechos.values()].reduce((a, o) => a + o.bytes, 0);
  for (const n of conMalla) {
    if (hechos.has(n.index)) continue;
    const s = soldar(leerGeometria(n), invertir);
    const hoja = esHoja(n), d = prof.get(n.index);
    const conKtx = KTX_INTERMEDIOS && !hoja && d > 1; // primer nivel con JPEG: es la primera vista
    const { bin, W, H } = await glbDeNodo(n, s, conKtx);
    fs.writeFileSync(path.join(GEO, `${n.index}.glb`), bin);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < s.nv; v++) for (let k = 0; k < 3; k++) { const x = s.enu[v * 3 + k]; if (x < mn[k]) mn[k] = x; if (x > mx[k]) mx[k] = x; }
    if (hoja) {
      const m = [];
      for (let v = 0; v < s.nv; v += PASO_MUESTRA) m.push(s.geo[v * 3], s.geo[v * 3 + 1], s.geo[v * 3 + 2]);
      fs.writeSync(fdMuestra, Buffer.from(new Float64Array(m).buffer));
    }
    const o = { i: n.index, mn, mx, texel: texelM(s.enu, s.uvs, s.idx, W, H), bytes: bin.byteLength, tris: s.idx.length / 3, tex: `${W}x${H}`, ktx: conKtx };
    fs.writeSync(progreso, JSON.stringify(o) + '\n');
    hechos.set(n.index, o); bytes += o.bytes;
    if (++listos % 250 === 0) log(`${listos}/${conMalla.length} nodos, ${(bytes / 1e6).toFixed(0)} MB, memoria ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`);
  }
  fs.closeSync(fdMuestra); fs.closeSync(progreso);
  log(`${listos} nodos, ${(bytes / 1e6).toFixed(0)} MB`);

  // ─── tileset ───────────────────────────────────────────────────────────
  const porNivel = {};
  function tesela(n) {
    const h = hechos.get(n.index);
    const mn = h ? [...h.mn] : [Infinity, Infinity, Infinity], mx = h ? [...h.mx] : [-Infinity, -Infinity, -Infinity];
    const hijos = (n.children || []).map((c) => tesela(porIndice.get(c)));
    let geHijos = 0;
    for (const c of hijos) {
      geHijos = Math.max(geHijos, c.geometricError);
      const b = c.boundingVolume.box;
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b[k] - b[3 + 4 * k]); mx[k] = Math.max(mx[k], b[k] + b[3 + 4 * k]); }
    }
    const c = [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2), hm = [0, 1, 2].map((k) => Math.max((mx[k] - mn[k]) / 2, 0.01));
    const t = { boundingVolume: { box: [c[0], c[1], c[2], hm[0], 0, 0, 0, hm[1], 0, 0, 0, hm[2]] } };
    const hoja = !hijos.length;
    t.geometricError = hoja ? 0 : Math.max(h && isFinite(h.texel) ? FACTOR_GE * h.texel : 0, geHijos * 1.01, 0.01);
    if (!h && !hoja) t.geometricError = Math.max(t.geometricError, geHijos * 2); // raiz I3S sin malla
    t.refine = 'REPLACE';
    if (h) t.content = { uri: `${n.index}.glb` };
    if (hijos.length) t.children = hijos;
    const d = prof.get(n.index);
    (porNivel[d] ||= []).push({ ge: t.geometricError, texel: h?.texel, tris: h?.tris || 0, bytes: h?.bytes || 0, tex: h?.tex, ktx: h?.ktx });
    return t;
  }
  const raiz = tesela(raizI3s);
  raiz.transform = M_RAIZ;
  const ts = {
    asset: {
      version: '1.1', generator: 'slpk_a_tiles.mjs (GeoAI LATAM)',
      extras: { georreferencia: { origen_wgs84: { lat: LAT0, lon: LON0, h_elipsoidal: H0_ELIP }, geoide_egm96_m: N_GEOIDE, fuente: path.basename(SLPK), marco: 'ENU en el origen; glb Y-arriba (este, arriba, -norte)' } },
    },
    geometricError: raiz.geometricError * 2,
    root: raiz,
  };
  fs.writeFileSync(path.join(GEO, 'tileset.json'), JSON.stringify(ts));
  fs.rmSync(path.join(SALIDA, '.tileset-completo.json'), { force: true }); // se rehace al partir
  const niveles = Object.entries(porNivel).map(([d, l]) => {
    const tex = l.filter((x) => x.texel && isFinite(x.texel)).map((x) => x.texel * 100).sort((a, b) => a - b);
    const cm = tex.length ? +tex[tex.length >> 1].toFixed(2) : null;
    return { nivel: +d, teselas: l.length, tris: l.reduce((a, x) => a + x.tris, 0), mb: +(l.reduce((a, x) => a + x.bytes, 0) / 1e6).toFixed(2),
      ge_min: +Math.min(...l.map((x) => x.ge)).toFixed(3), ge_max: +Math.max(...l.map((x) => x.ge)).toFixed(3), texel_mediano_cm: cm,
      textura: l.some((x) => x.ktx) ? 'KTX2 ETC1S del SLPK' : l.some((x) => x.tex) ? 'JPEG original del SLPK' : '-' };
  });
  for (const n of niveles) log(`nivel ${n.nivel}: ${n.teselas} teselas, ${n.tris} tris, ${n.mb} MB, GE ${n.ge_min}-${n.ge_max}, texel ${n.texel_mediano_cm} cm, ${n.textura}`);
  fs.writeFileSync(path.join(SALIDA, '.niveles.json'), JSON.stringify({ niveles, invertir }));
}
zip.cerrar();

// ─── partir el tileset ──────────────────────────────────────────────────
// Un solo tileset.json con 20.000 teselas pesa 4,6 MB y el visor lo baja entero
// antes de dibujar nada. Se redondean las cajas al milimetro y el geometricError a
// 5 cifras, y si hay mas de 1500 teselas los subarboles desde el primer nivel con
// >= 32 teselas pasan a tilesets externos (sub/<n>.json), que 3d-tiles-renderer
// baja solo cuando se acerca a ellos. La tesela que apunta al externo lleva el
// geometricError de su padre: se abre en cuanto el padre se refina, igual que
// la tesela original. Queda en <salida>/.tileset-completo.json el arbol entero
// (uri relativas a <salida>) para la huella; no se sube.
function partir() {
  const completo = path.join(SALIDA, '.tileset-completo.json');
  if (fs.existsSync(completo)) return;
  const ts = JSON.parse(fs.readFileSync(path.join(GEO, 'tileset.json'), 'utf8'));
  const porProf = [];
  (function r(t, d) {
    t.boundingVolume.box = t.boundingVolume.box.map((x) => +x.toFixed(3));
    t.geometricError = +t.geometricError.toPrecision(5);
    (porProf[d] ||= []).push(t);
    for (const c of t.children || []) r(c, d + 1);
  })(ts.root, 0);
  const copia = JSON.parse(JSON.stringify(ts));
  (function r(t) { if (t.content) t.content.uri = `${SLUG}-geo/${t.content.uri}`; (t.children || []).forEach(r); })(copia.root);
  fs.writeFileSync(completo, JSON.stringify(copia));
  fs.rmSync(path.join(GEO, 'sub'), { recursive: true, force: true });
  const nTeselas = porProf.reduce((a, l) => a + l.length, 0);
  const corte = porProf.findIndex((l, d) => d >= 2 && l.length >= 32);
  if (nTeselas > 1500 && corte > 0) {
    fs.mkdirSync(path.join(GEO, 'sub'));
    for (const padre of porProf[corte - 1]) {
      padre.children = (padre.children || []).map((t) => {
        if (!t.children?.length) return t; // una hoja suelta no vale un archivo
        const nombre = t.content ? path.basename(t.content.uri, '.glb') : `s${Math.random().toString(36).slice(2, 8)}`;
        (function r(x) { if (x.content) x.content.uri = `../${x.content.uri}`; (x.children || []).forEach(r); })(t);
        fs.writeFileSync(path.join(GEO, 'sub', `${nombre}.json`), JSON.stringify({ asset: { version: '1.1' }, geometricError: padre.geometricError, root: t }));
        return { boundingVolume: t.boundingVolume, geometricError: padre.geometricError, refine: 'REPLACE', content: { uri: `sub/${nombre}.json` } };
      });
    }
    log(`tileset partido en el nivel ${corte}: ${fs.readdirSync(path.join(GEO, 'sub')).length} tilesets externos`);
  }
  fs.writeFileSync(path.join(GEO, 'tileset.json'), JSON.stringify(ts));
  log(`tileset.json: ${(fs.statSync(path.join(GEO, 'tileset.json')).size / 1e3).toFixed(0)} kB`);
}
partir();

// ─── huella ──────────────────────────────────────────────────────────────
const HUELLA = path.join(SALIDA, `${SLUG}.huella.geojson`);
const pasoHuella = Math.max(1, Math.ceil(vertHojas / 3 / 8e6));
log(`huella (paso ${pasoHuella})...`);
const rh = spawnSync(process.execPath, ['--max-old-space-size=3072', `${TOOLS}/huella_tileset.mjs`, '--tileset', path.join(SALIDA, '.tileset-completo.json'), '--salida', HUELLA, '--paso', String(pasoHuella)], { encoding: 'utf8' });
process.stdout.write(rh.stdout || ''); process.stderr.write(rh.stderr || '');
const huella = fs.existsSync(HUELLA) ? JSON.parse(fs.readFileSync(HUELLA, 'utf8')) : null;

// ─── informe de altura contra Terrarium de AWS ───────────────────────────
log('residuo contra AWS Terrarium z15...');
const mb = fs.readFileSync(MUESTRA);
const P = new Float64Array(mb.buffer, mb.byteOffset, mb.byteLength / 8);
const nP = P.length / 3;
const CELDA = 10, KX = A * Math.cos(LAT0 * RAD) * RAD, KY = A * RAD;
let ixMin = Infinity, iyMin = Infinity, ixMax = -Infinity, iyMax = -Infinity;
const cx = new Int32Array(nP), cy = new Int32Array(nP);
for (let i = 0; i < nP; i++) {
  cx[i] = Math.floor((P[i * 3] - LON0) * KX / CELDA); cy[i] = Math.floor((P[i * 3 + 1] - LAT0) * KY / CELDA);
  ixMin = Math.min(ixMin, cx[i]); ixMax = Math.max(ixMax, cx[i]); iyMin = Math.min(iyMin, cy[i]); iyMax = Math.max(iyMax, cy[i]);
}
const NX = ixMax - ixMin + 1, NY = iyMax - iyMin + 1;
const cuenta = new Int32Array(NX * NY + 1);
for (let i = 0; i < nP; i++) cuenta[(cy[i] - iyMin) * NX + cx[i] - ixMin + 1]++;
for (let k = 1; k <= NX * NY; k++) cuenta[k] += cuenta[k - 1];
const Hs = new Float64Array(nP), Ls = new Float64Array(nP * 2), llenado = cuenta.slice(0, NX * NY);
for (let i = 0; i < nP; i++) { const k = (cy[i] - iyMin) * NX + cx[i] - ixMin, j = llenado[k]++; Hs[j] = P[i * 3 + 2]; Ls[j * 2] = P[i * 3]; Ls[j * 2 + 1] = P[i * 3 + 1]; }
const cache = path.join(SALIDA, 'aws-terrarium'); fs.mkdirSync(cache, { recursive: true });
const teselas = new Map();
async function teselaT(z, x, y) {
  const k = `${z}_${x}_${y}`;
  if (!teselas.has(k)) {
    const ruta = path.join(cache, `${k}.png`);
    if (!fs.existsSync(ruta)) {
      const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, { headers: { 'User-Agent': 'GeoAI-LATAM slpk_a_tiles.mjs' } });
      if (!r.ok) throw new Error(`terrarium ${k}: HTTP ${r.status}`);
      fs.writeFileSync(ruta, Buffer.from(await r.arrayBuffer()));
    }
    const { data, info } = await sharp(ruta).raw().toBuffer({ resolveWithObject: true });
    const T = new Float64Array(256 * 256);
    for (let i = 0; i < 256 * 256; i++) T[i] = data[i * info.channels] * 256 + data[i * info.channels + 1] + data[i * info.channels + 2] / 256 - 32768;
    teselas.set(k, T);
  }
  return teselas.get(k);
}
async function terreno(lon, lat, z = 15) {
  const n = 2 ** z, fx = (lon + 180) / 360 * n, fy = (1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2 * n;
  const tx = Math.floor(fx), ty = Math.floor(fy);
  const px = Math.min(Math.max((fx - tx) * 256 - 0.5, 0), 254.999), py = Math.min(Math.max((fy - ty) * 256 - 0.5, 0), 254.999);
  const c0 = Math.floor(px), f0 = Math.floor(py), dc = px - c0, df = py - f0, T = await teselaT(z, tx, ty);
  return T[f0 * 256 + c0] * (1 - dc) * (1 - df) + T[f0 * 256 + c0 + 1] * dc * (1 - df) + T[(f0 + 1) * 256 + c0] * (1 - dc) * df + T[(f0 + 1) * 256 + c0 + 1] * dc * df;
}
const pct = (arr, q) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(q * (arr.length - 1))))];
const ocupada = (ix, iy) => ix >= 0 && iy >= 0 && ix < NX && iy < NY && cuenta[iy * NX + ix + 1] - cuenta[iy * NX + ix] > 0;
const celdas = [];
for (let iy = 0; iy < NY; iy++) for (let ix = 0; ix < NX; ix++) {
  const k = iy * NX + ix, a = cuenta[k], b = cuenta[k + 1];
  if (b - a < 20) continue;
  const h = Hs.subarray(a, b).slice().sort();
  const p5 = pct(h, 0.05), p95 = pct(h, 0.95);
  let lo = 0, la = 0;
  for (let j = a; j < b; j++) { lo += Ls[j * 2]; la += Ls[j * 2 + 1]; }
  lo /= b - a; la /= b - a;
  const borde = !ocupada(ix - 1, iy) || !ocupada(ix + 1, iy) || !ocupada(ix, iy - 1) || !ocupada(ix, iy + 1);
  celdas.push({ lo, la, p5, disp: p95 - p5, borde, x: (lo - LON0) * KX, y: (la - LAT0) * KY });
}
for (const c of celdas) c.res = (await terreno(c.lo, c.la)) - c.p5;
function resumen(sel) {
  const r = sel.map((c) => c.res).sort((a, b) => a - b);
  if (!r.length) return { celdas: 0 };
  return { celdas: r.length, mediana_m: +pct(r, 0.5).toFixed(2), q1_m: +pct(r, 0.25).toFixed(2), q3_m: +pct(r, 0.75).toFixed(2), iqr_m: +(pct(r, 0.75) - pct(r, 0.25)).toFixed(2) };
}
const abiertas = celdas.filter((c) => c.disp < 1);
const rTodas = resumen(celdas), rAbiertas = resumen(abiertas), rBorde = resumen(abiertas.filter((c) => c.borde));
// plano de residuos en suelo abierto (minimos cuadrados, 3x3)
let plano = null;
if (abiertas.length >= 3) {
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
  for (const c of abiertas) { const f = [c.x, c.y, 1]; for (let i = 0; i < 3; i++) { v[i] += f[i] * c.res; for (let j = 0; j < 3; j++) S[i][j] += f[i] * f[j]; } }
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(S);
  const sol = [0, 1, 2].map((k) => det(S.map((f, i) => f.map((x, j) => (j === k ? v[i] : x)))) / D);
  plano = { m_por_km_este: +(sol[0] * 1000).toFixed(2), m_por_km_norte: +(sol[1] * 1000).toFixed(2), centro_m: +sol[2].toFixed(2) };
}
const cuadrantes = {};
for (const [q, sx, sy] of [['NE', 1, 1], ['NO', -1, 1], ['SE', 1, -1], ['SO', -1, -1]]) cuadrantes[q] = resumen(abiertas.filter((c) => c.borde && Math.sign(c.x) === sx && Math.sign(c.y) === sy));
const ajuste = rAbiertas.celdas ? rAbiertas.mediana_m : rTodas.mediana_m;
log(`residuo (terreno - suelo de la malla): todas ${JSON.stringify(rTodas)}; suelo abierto ${JSON.stringify(rAbiertas)}; borde ${JSON.stringify(rBorde)}`);
log(`plano ${JSON.stringify(plano)}; sugerencia geoide_m ${N_GEOIDE}, ajuste_altura_m ${ajuste}`);

// ─── pesos e informe ─────────────────────────────────────────────────────
const archivos = fs.readdirSync(GEO, { recursive: true }).map(String).filter((f) => !path.basename(f).startsWith('.') && fs.statSync(path.join(GEO, f)).isFile());
const total = archivos.reduce((a, f) => a + fs.statSync(path.join(GEO, f)).size, 0);
const ts = JSON.parse(fs.readFileSync(path.join(GEO, 'tileset.json'), 'utf8'));
// Primera vista: tileset.json + la primera tesela con contenido (desde la raiz).
let primera = ts.root; while (!primera.content && primera.children?.length === 1) primera = primera.children[0];
const primeraBytes = fs.statSync(path.join(GEO, 'tileset.json')).size + (primera.content ? fs.statSync(path.join(GEO, primera.content.uri)).size : 0);
const nivelesInfo = fs.existsSync(path.join(SALIDA, '.niveles.json')) ? JSON.parse(fs.readFileSync(path.join(SALIDA, '.niveles.json'), 'utf8')) : {};
const informe = {
  slug: SLUG, fuente: SLPK, fuente_mb: +(fs.statSync(SLPK).size / 1e6).toFixed(0),
  fecha: new Date().toISOString().slice(0, 10), script: `${TOOLS}/slpk_a_tiles.mjs`,
  centro: { lon: +LON0.toFixed(7), lat: +LAT0.toFixed(7) }, bbox: [xmin, ymin, xmax, ymax].map((x) => +x.toFixed(7)),
  tileset: path.join(GEO, 'tileset.json').replace(/\\/g, '/'), huella: fs.existsSync(HUELLA) ? HUELLA.replace(/\\/g, '/') : null,
  huella_area_m2: huella?.features?.[0]?.properties?.area_m2 ?? null,
  archivos: archivos.length, total_mb: +(total / 1e6).toFixed(1), primera_vista_mb: +(primeraBytes / 1e6).toFixed(2),
  niveles: nivelesInfo.niveles, caras_invertidas: nivelesInfo.invertir,
  alturas: {
    fuente: `SLPK: altura ortometrica EGM96 (vcsWkid ${sr.vcsWkid}); se le sumo N EGM96 = ${N_GEOIDE} m -> elipsoidal WGS84`,
    origen_h_elipsoidal: H0_ELIP, geoide_m: N_GEOIDE,
    residuo: { definicion: 'terreno AWS Terrarium z15 - suelo de la malla (p5 en celdas de 10 m); positivo = la malla queda por debajo del terreno', todas: rTodas, suelo_abierto: rAbiertas, suelo_abierto_borde: rBorde, cuadrantes_borde: cuadrantes, plano },
    muestra_vertices: nP, paso_muestra: PASO_MUESTRA,
    ajuste_altura_m: ajuste,
    nota: 'El visor pone la malla en h - geoide_m + ajuste_altura_m = H + ajuste. geoide_m es el N sumado aqui.',
  },
};
fs.writeFileSync(path.join(SALIDA, 'informe.json'), JSON.stringify(informe, null, 2));
if (!SOLO_MEDIR) fs.rmSync(PROGRESO, { force: true });
log(`listo: ${archivos.length} archivos, ${informe.total_mb} MB, primera vista ${informe.primera_vista_mb} MB -> ${path.join(SALIDA, 'informe.json')}`);
