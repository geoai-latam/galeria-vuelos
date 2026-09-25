// huella_tileset.mjs: la huella real de una malla 3D Tiles georreferenciada, como
// un polígono lon/lat de pocas decenas de vértices (GeoJSON).
//
// Para qué: la escena del sitio (components/ui/VisorEscena.js) la usa para hundir
// el terreno debajo de la malla y para quitar del mapa base los edificios 3D, los
// nombres y los POI que chocan con ella. Un rectángulo (el bbox) se queda corto
// en las esquinas y se pasa en los bordes irregulares; esto sigue el borde real.
//
// Método:
//   1. Recorre el tileset.json y toma las hojas (teselas sin hijos: el detalle
//      más fino). De cada .glb lee SOLO las posiciones: meshopt + cuantización,
//      el nodo (traslación/rotación/escala), glTF Y-arriba -> Z-arriba, y la
//      transform del tileset a ECEF. Las texturas no se tocan.
//   2. ECEF -> lon/lat -> metros este/norte en el centro. Cada triángulo que no
//      es pared marca las celdas que cubre, visto desde arriba, en una grilla de
//      --celda m (2). Con --modo vertices, cada vértice marca su celda.
//   3. Una celda cuenta si tiene al menos --min-conteo vértices (2): así no la
//      marca un vértice suelto de un fragmento del borde. Apertura morfológica
//      de --apertura celdas (1: quita flecos de una celda de ancho), cierre de
//      --cierre celdas (tapa huecos entre vértices), relleno de huecos
//      interiores y queda la mancha más grande.
//   4. Se sigue el borde de la mancha (contorno por bordes de celda) y se
//      simplifica con Douglas-Peucker, subiendo la tolerancia hasta que queden
//      como mucho --max vértices (96), pero sin pasar de --tol-max metros (3).
//
// Por qué los topes (25-sep-2026): la huella del Humedal El Burro salía hasta
// 15 m más grande que la malla al sur y al oeste. Con --max 48 la tolerancia
// de Douglas-Peucker había subido a 14,5 m, y el polígono simplificado se sale
// de la mancha hasta esa distancia. La escena hunde el terreno y quita los
// edificios en todo el polígono, así que lo que sobra se ve como un vacío. Con
// la tolerancia acotada a 3 m (menos que un píxel del terreno en z15, 4,8 m)
// el polígono queda pegado al borde real; cuesta unos vértices más.
//
// --diag <png>: dibuja la grilla (gris: celdas con vértices; verde: la mancha
// final) y el polígono en rojo, para revisar a ojo.
//
// Sin dependencias fuera de Node: el decodificador meshopt es el de three.js
// (--three apunta a su carpeta en cualquier node_modules).
//
// Uso:
//   node huella_tileset.mjs --tileset D:/geoai-vuelos/tintal/tintal-geo/tileset.json
//        --salida <repo>/content/vuelos/tintal.huella.geojson [--celda 2] [--max 48]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, arr) => {
    if (v.startsWith('--')) acc.push([v.slice(2), arr[i + 1]])
    return acc
  }, [])
)
if (!args.tileset || !args.salida) {
  console.error('Uso: node huella_tileset.mjs --tileset <tileset.json> --salida <x.geojson> [--celda 2] [--cierre 3] [--apertura 1] [--min-conteo 2] [--max 96] [--tol-max 3] [--paso 1] [--diag x.png]')
  process.exit(1)
}
const CELDA = Number(args.celda || 2)
const CIERRE = Number(args.cierre || 3)
const APERTURA = Number(args.apertura ?? 1)
// --modo triangulos (por defecto): la huella sale de los triángulos que no
// son pared; --modo vertices: de los vértices, como hasta el 25-sep-2026.
const MODO = args.modo === 'vertices' ? 'vertices' : 'triangulos'
const MIN_HORIZONTAL = Number(args['min-horizontal'] || 0.3)
const MIN_CONTEO = Number(args['min-conteo'] || (MODO === 'vertices' ? 2 : 1))
const MAX_V = Number(args.max || 96)
const TOL_MAX = Number(args['tol-max'] || 3)
// --paso N: toma 1 de cada N vertices (vuelos grandes: no cargar decenas de millones en memoria). 1 = todos.
const PASO = Math.max(1, Number(args.paso || 1))
// Por defecto, el three.js de la app (npm install en la raíz del repo).
const THREE_DIR =
  args.three || process.env.THREE_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'three')
const { MeshoptDecoder } = await import(
  pathToFileURL(path.join(THREE_DIR, 'examples/jsm/libs/meshopt_decoder.module.js')).href
)
await MeshoptDecoder.ready

// ─── matrices 4x4 column-major (como en glTF y 3D Tiles) ──────────────
const mul = (a, b) => {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
// glTF (Y arriba) -> 3D Tiles (Z arriba): rotación de +90° en X
const Y_A_Z = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]
function trs(n) {
  if (n.matrix) return n.matrix
  const [tx, ty, tz] = n.translation || [0, 0, 0]
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1]
  const [sx, sy, sz] = n.scale || [1, 1, 1]
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ]
}

// ─── WGS84 ────────────────────────────────────────────────────────────
const A = 6378137, E2 = 6.69437999014e-3, RAD = Math.PI / 180
function ecefAGeo(x, y, z) {
  const lon = Math.atan2(y, x)
  const p = Math.hypot(x, y)
  let lat = Math.atan2(z, p * (1 - E2)), h = 0
  for (let i = 0; i < 5; i++) {
    const N = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2)
    h = p / Math.cos(lat) - N
    lat = Math.atan2(z, p * (1 - (E2 * N) / (N + h)))
  }
  return [lon / RAD, lat / RAD, h]
}

// ─── posiciones de un .glb ────────────────────────────────────────────
const COMP = { 5120: [Int8Array, 127], 5121: [Uint8Array, 255], 5122: [Int16Array, 32767], 5123: [Uint16Array, 65535], 5126: [Float32Array, 0] }
function leerGlb(archivo, pasoV = PASO, tris = null) {
  const b = fs.readFileSync(archivo)
  const lj = b.readUInt32LE(12)
  const j = JSON.parse(b.subarray(20, 20 + lj).toString('utf8'))
  const bin = b.subarray(20 + lj + 8)
  const vistas = new Map()
  const vista = (i) => {
    if (vistas.has(i)) return vistas.get(i)
    const bv = j.bufferViews[i]
    const ext = bv.extensions?.EXT_meshopt_compression
    let datos
    if (ext) {
      const fuente = new Uint8Array(bin.buffer, bin.byteOffset + (ext.byteOffset || 0), ext.byteLength)
      datos = new Uint8Array(ext.count * ext.byteStride)
      MeshoptDecoder.decodeGltfBuffer(datos, ext.count, ext.byteStride, fuente, ext.mode, ext.filter || 'NONE')
    } else {
      datos = new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength)
    }
    const r = { datos, stride: bv.byteStride || ext?.byteStride }
    vistas.set(i, r)
    return r
  }
  const salida = []
  const recorrer = (ni, padre) => {
    const n = j.nodes[ni]
    const m = mul(padre, trs(n))
    if (n.mesh != null) {
      for (const prim of j.meshes[n.mesh].primitives) {
        const acc = j.accessors[prim.attributes.POSITION]
        const { datos, stride } = vista(acc.bufferView)
        const [Tipo, maxv] = COMP[acc.componentType]
        const tam = Tipo.BYTES_PER_ELEMENT
        const paso = stride || tam * 3
        const dv = new DataView(datos.buffer, datos.byteOffset, datos.byteLength)
        const leer = (o) =>
          tam === 4 ? dv.getFloat32(o, true) : tam === 2 ? (acc.componentType === 5122 ? dv.getInt16(o, true) : dv.getUint16(o, true)) : acc.componentType === 5120 ? dv.getInt8(o) : dv.getUint8(o)
        const base = salida.length / 3
        if (tris) {
          // Los triángulos del primitivo, con índices sobre `salida`.
          if (prim.indices != null) {
            const ai = j.accessors[prim.indices]
            const vi = vista(ai.bufferView)
            const ti = COMP[ai.componentType][0].BYTES_PER_ELEMENT
            const dvi = new DataView(vi.datos.buffer, vi.datos.byteOffset, vi.datos.byteLength)
            const o0 = ai.byteOffset || 0
            for (let q = 0; q < ai.count; q++) {
              const o = o0 + q * ti
              tris.push(base + (ti === 4 ? dvi.getUint32(o, true) : ti === 2 ? dvi.getUint16(o, true) : dvi.getUint8(o)))
            }
          } else for (let q = 0; q < acc.count; q++) tris.push(base + q)
        }
        for (let k = 0; k < acc.count; k += pasoV) {
          const o = (acc.byteOffset || 0) + k * paso
          let x = leer(o), y = leer(o + tam), z = leer(o + 2 * tam)
          if (acc.normalized && maxv) { x = Math.max(x / maxv, -1); y = Math.max(y / maxv, -1); z = Math.max(z / maxv, -1) }
          salida.push(
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14]
          )
        }
      }
    }
    for (const c of n.children || []) recorrer(c, m)
  }
  const escena = j.scenes[j.scene || 0]
  for (const ni of escena.nodes) recorrer(ni, ID)
  return salida
}

// ─── 1. hojas del tileset ─────────────────────────────────────────────
const raizDir = path.dirname(args.tileset)
const tileset = JSON.parse(fs.readFileSync(args.tileset, 'utf8'))
const hojas = []
;(function w(t, padre) {
  const m = t.transform ? mul(padre, t.transform) : padre
  if (!t.children?.length && t.content?.uri) hojas.push([t.content.uri, m])
  for (const c of t.children || []) w(c, m)
})(tileset.root, ID)
console.log(`${hojas.length} hojas`)

// Metros este/norte desde el primer vértice, en Float32 (de sobra para unos
// cientos de metros) y en arreglos que crecen de a bloques: así caben todos los
// vértices de un vuelo grande sin --paso (45 millones en el Humedal El Burro).
let lon0 = null, lat0 = null, kx = 0
const ky = A * RAD
let es = new Float32Array(1 << 20), ns = new Float32Array(1 << 20)
let nV = 0
const crecer = (n) => {
  if (nV + n <= es.length) return
  let cap = es.length
  while (cap < nV + n) cap *= 2
  const a = new Float32Array(cap); a.set(es.subarray(0, nV)); es = a
  const b = new Float32Array(cap); b.set(ns.subarray(0, nV)); ns = b
}
for (const [uri, mTile] of hojas) {
  if (!uri.endsWith('.glb')) throw new Error(`Solo .glb por ahora: ${uri}`)
  const pos = leerGlb(path.join(raizDir, uri))
  const m = mul(mTile, Y_A_Z)
  crecer(pos.length / 3)
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2]
    const [lon, lat] = ecefAGeo(
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14]
    )
    if (lon0 === null) { lon0 = lon; lat0 = lat; kx = A * Math.cos(lat0 * RAD) * RAD }
    es[nV] = (lon - lon0) * kx; ns[nV] = (lat - lat0) * ky; nV++
  }
}
es = es.subarray(0, nV); ns = ns.subarray(0, nV)
console.log(`${nV} vértices`)

// ─── 2. grilla en metros ──────────────────────────────────────────────
let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity
for (let i = 0; i < nV; i++) {
  if (es[i] < minE) minE = es[i]; if (es[i] > maxE) maxE = es[i]
  if (ns[i] < minN) minN = ns[i]; if (ns[i] > maxN) maxN = ns[i]
}
const M = CIERRE + 2
const W = Math.ceil((maxE - minE) / CELDA) + 2 * M, H = Math.ceil((maxN - minN) / CELDA) + 2 * M
const e0 = minE - M * CELDA, n0 = minN - M * CELDA
const conteo = new Uint32Array(W * H)
if (MODO === 'vertices') {
  for (let i = 0; i < es.length; i++) conteo[Math.floor((ns[i] - n0) / CELDA) * W + Math.floor((es[i] - e0) / CELDA)]++
} else {
  // Segunda pasada, por triángulos: cada triángulo que no es pared (la
  // vertical de su normal pasa de --min-horizontal, 0,3 = unos 72° de
  // pendiente) marca las celdas que cubre visto desde arriba. Así la huella es
  // donde la malla tiene suelo o techo, no donde tiene vértices: en el borde
  // del Humedal El Burro había fachadas sin suelo delante, y la escena hundía
  // el terreno ahí y se veía un vacío (25-sep-2026).
  let nTri = 0, nPared = 0
  const marcar = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) conteo[y * W + x]++ }
  for (const [uri, mTile] of hojas) {
    const tris = []
    const pos = leerGlb(path.join(raizDir, uri), 1, tris)
    const m = mul(mTile, Y_A_Z)
    const nv = pos.length / 3
    const E = new Float64Array(nv), N = new Float64Array(nv), U = new Float64Array(nv)
    for (let i = 0; i < nv; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
      const [lon, lat, h] = ecefAGeo(
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14]
      )
      E[i] = ((lon - lon0) * kx - e0) / CELDA; N[i] = ((lat - lat0) * ky - n0) / CELDA; U[i] = h / CELDA
    }
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2]
      const ux = E[b] - E[a], uy = N[b] - N[a], uz = U[b] - U[a]
      const vx = E[c] - E[a], vy = N[c] - N[a], vz = U[c] - U[a]
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      const L = Math.hypot(nx, ny, nz)
      nTri++
      if (!L || Math.abs(nz) / L < MIN_HORIZONTAL) { nPared++; continue }
      const x0 = Math.floor(Math.min(E[a], E[b], E[c])), x1 = Math.floor(Math.max(E[a], E[b], E[c]))
      const y0 = Math.floor(Math.min(N[a], N[b], N[c])), y1 = Math.floor(Math.max(N[a], N[b], N[c]))
      if (x0 === x1 && y0 === y1) { marcar(x0, y0); continue }
      // celdas cuyo centro cae en el triángulo, y las de los tres vértices
      const d = nz // área firmada * 2 en el plano (este, norte)
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
        const px = xx + 0.5, py = yy + 0.5
        const w0 = (E[b] - px) * (N[c] - py) - (E[c] - px) * (N[b] - py)
        const w1 = (E[c] - px) * (N[a] - py) - (E[a] - px) * (N[c] - py)
        const w2 = (E[a] - px) * (N[b] - py) - (E[b] - px) * (N[a] - py)
        if ((d > 0 && w0 >= 0 && w1 >= 0 && w2 >= 0) || (d < 0 && w0 <= 0 && w1 <= 0 && w2 <= 0)) marcar(xx, yy)
      }
      marcar(Math.floor(E[a]), Math.floor(N[a])); marcar(Math.floor(E[b]), Math.floor(N[b])); marcar(Math.floor(E[c]), Math.floor(N[c]))
    }
  }
  console.log(`${nTri} triángulos, ${nPared} de pared (${((100 * nPared) / Math.max(nTri, 1)).toFixed(1)} %) fuera de la huella`)
}
let g = new Uint8Array(W * H)
for (let i = 0; i < g.length; i++) g[i] = conteo[i] >= MIN_CONTEO ? 1 : 0

// ─── 3. cierre, relleno y mancha mayor ────────────────────────────────
function morf(src, r, dilatar) {
  const o = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = dilatar ? 0 : 1
    for (let dy = -r; dy <= r && v === (dilatar ? 0 : 1); dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue
      const xx = x + dx, yy = y + dy
      const s = xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : src[yy * W + xx]
      if (dilatar && s) { v = 1; break }
      if (!dilatar && !s) { v = 0; break }
    }
    o[y * W + x] = v
  }
  return o
}
if (APERTURA > 0) g = morf(morf(g, APERTURA, false), APERTURA, true)
g = morf(morf(g, CIERRE, true), CIERRE, false)
function inundar(src, semilla, valor) {
  const lab = new Int32Array(W * H).fill(-1)
  const pila = [semilla]; lab[semilla] = 0
  let n = 0
  while (pila.length) {
    const i = pila.pop(); n++
    const x = i % W, y = (i / W) | 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
      const j = yy * W + xx
      if (lab[j] === -1 && src[j] === valor) { lab[j] = 0; pila.push(j) }
    }
  }
  return { lab, n }
}
// huecos: lo vacío que no toca el borde de la grilla pasa a lleno
const fuera = inundar(g, 0, 0).lab
for (let i = 0; i < g.length; i++) if (!g[i] && fuera[i] === -1) g[i] = 1
// mancha mayor
let mejor = null
const visto = new Uint8Array(W * H)
for (let i = 0; i < g.length; i++) {
  if (!g[i] || visto[i]) continue
  const r = inundar(g, i, 1)
  for (let k = 0; k < g.length; k++) if (r.lab[k] === 0) visto[k] = 1
  if (!mejor || r.n > mejor.n) mejor = r
}
for (let i = 0; i < g.length; i++) g[i] = mejor.lab[i] === 0 ? 1 : 0
const areaM2 = mejor.n * CELDA * CELDA

// ─── 4. contorno por bordes de celda ──────────────────────────────────
// Aristas dirigidas con la mancha a la izquierda; se encadenan en un anillo.
const lleno = (x, y) => x >= 0 && y >= 0 && x < W && y < H && g[y * W + x] === 1
const sig = new Map()
const clave = (x, y) => `${x},${y}`
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!lleno(x, y)) continue
  if (!lleno(x, y - 1)) sig.set(clave(x, y), [x + 1, y])
  if (!lleno(x + 1, y)) sig.set(clave(x + 1, y), [x + 1, y + 1])
  if (!lleno(x, y + 1)) sig.set(clave(x + 1, y + 1), [x, y + 1])
  if (!lleno(x - 1, y)) sig.set(clave(x, y + 1), [x, y])
}
// (con 4-conexidad y huecos rellenos, cada vértice tiene una sola salida salvo en
// las esquinas en diagonal; ahí se toma cualquiera, el anillo sigue cerrando)
const inicio = sig.keys().next().value
const anillo = []
let k = inicio
do {
  const [x, y] = k.split(',').map(Number)
  anillo.push([e0 + x * CELDA, n0 + y * CELDA])
  const s = sig.get(k)
  sig.delete(k)
  k = clave(s[0], s[1])
} while (k !== inicio && sig.has(k))
if (sig.size) console.warn(`aviso: ${sig.size} aristas del borde sin recorrer (esquinas en diagonal)`)

function dp(pts, tol) {
  if (pts.length < 3) return pts
  let dmax = 0, idx = 0
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1]
  const L = Math.hypot(bx - ax, by - ay) || 1e-9
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L
    if (d > dmax) { dmax = d; idx = i }
  }
  if (dmax <= tol) return [pts[0], pts[pts.length - 1]]
  return [...dp(pts.slice(0, idx + 1), tol).slice(0, -1), ...dp(pts.slice(idx), tol)]
}
// Anillo cerrado: se parte en el punto más lejano del primero para que DP no
// dependa de dónde empezó el recorrido.
let lejos = 0
for (let i = 1; i < anillo.length; i++) if (Math.hypot(anillo[i][0] - anillo[0][0], anillo[i][1] - anillo[0][1]) > Math.hypot(anillo[lejos][0] - anillo[0][0], anillo[lejos][1] - anillo[0][1])) lejos = i
let tol = CELDA / 2, simple
do {
  const a = dp(anillo.slice(0, lejos + 1), tol)
  const b = dp([...anillo.slice(lejos), anillo[0]], tol)
  simple = [...a.slice(0, -1), ...b.slice(0, -1)]
  if (simple.length <= MAX_V || tol * 1.25 > TOL_MAX) break
  tol *= 1.25
} while (true)

const aLonLat = ([e, n]) => [+(lon0 + e / kx).toFixed(7), +(lat0 + n / ky).toFixed(7)]
let coords = simple.map(aLonLat)
// GeoJSON (RFC 7946): anillo exterior en sentido antihorario
const areaFirmada = simple.reduce((s, p, i) => { const q = simple[(i + 1) % simple.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0) / 2
if (areaFirmada < 0) coords.reverse()
coords.push(coords[0])

const fc = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: {
      fuente: path.basename(path.dirname(args.tileset)) + '/' + path.basename(args.tileset),
      metodo: `huella_tileset.mjs: ${MODO === 'vertices' ? `vértices de ${hojas.length} hojas (1 de cada ${PASO})` : `triángulos no verticales (|nz| >= ${MIN_HORIZONTAL}) de ${hojas.length} hojas`}, grilla ${CELDA} m, mínimo ${MIN_CONTEO} vértices por celda, apertura ${APERTURA} y cierre ${CIERRE} celdas, Douglas-Peucker ${tol.toFixed(1)} m`,
      vertices: coords.length - 1,
      area_m2: Math.round(areaM2),
      tolerancia_m: +tol.toFixed(2),
    },
    geometry: { type: 'Polygon', coordinates: [coords] },
  }],
}
fs.writeFileSync(args.salida, JSON.stringify(fc) + '\n')
console.log(`huella: ${coords.length - 1} vértices, tolerancia ${tol.toFixed(2)} m, área ${Math.round(areaM2)} m² -> ${args.salida}`)

if (args.diag) {
  const zlib = await import('node:zlib')
  // PNG RGB mínimo, sin dependencias. La fila de arriba es el norte.
  const fila = 1 + W * 3
  const img = Buffer.alloc(H * fila, 255)
  const pon = (x, y, r, gg, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const o = (H - 1 - y) * fila + 1 + x * 3
    img[o] = r; img[o + 1] = gg; img[o + 2] = b
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (g[i] && conteo[i]) pon(x, y, 120, 190, 135)
    else if (g[i]) pon(x, y, 200, 235, 205)
    else if (conteo[i]) pon(x, y, 110, 110, 110)
  }
  for (let i = 0; i < simple.length; i++) {
    const [ea, na] = simple[i], [eb, nb] = simple[(i + 1) % simple.length]
    const L = Math.ceil(Math.hypot(eb - ea, nb - na) / (CELDA / 2)) + 1
    for (let t = 0; t <= L; t++) {
      const e = ea + ((eb - ea) * t) / L, n = na + ((nb - na) * t) / L
      pon(Math.floor((e - e0) / CELDA), Math.floor((n - n0) / CELDA), 220, 30, 30)
    }
  }
  for (let y = 0; y < H; y++) img[y * fila] = 0
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
  const crc = (buf) => { let c = -1; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
  const trozo = (tipo, datos) => {
    const t = Buffer.concat([Buffer.from(tipo), datos])
    const len = Buffer.alloc(4); len.writeUInt32BE(datos.length)
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(t))
    return Buffer.concat([len, t, c])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2
  fs.writeFileSync(args.diag, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(img)), trozo('IEND', Buffer.alloc(0))]))
  console.log(`diagnóstico -> ${args.diag}`)
}
