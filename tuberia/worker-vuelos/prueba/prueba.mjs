// Prueba del Worker sin Cloudflare: un R2 y una Cache API de mentira en
// memoria. Uso: node prueba/prueba.mjs (Node 20+).
import assert from 'node:assert/strict'
import worker from '../src/index.js'

const objetos = new Map([
  ['tintal/v1/geo/tileset.json', { cuerpo: Buffer.from('{"asset":{"version":"1.0"}}'), tipo: 'application/octet-stream' }],
  ['tintal/v1/geo/root.glb', { cuerpo: Buffer.alloc(1000, 7), tipo: '' }],
  ['suelto.json', { cuerpo: Buffer.from('{}'), tipo: 'application/json' }],
])
let lecturasR2 = 0

function objetoR2(clave, o, conCuerpo, rango) {
  const etag = `"${clave.length}-${o.cuerpo.length}"`
  const base = {
    key: clave,
    size: o.cuerpo.length,
    httpEtag: etag,
    etag: etag.slice(1, -1),
    writeHttpMetadata(h) {
      if (o.tipo) h.set('Content-Type', o.tipo)
    },
  }
  if (!conCuerpo) return base
  let datos = o.cuerpo
  if (rango) {
    datos = o.cuerpo.subarray(rango.offset, rango.offset + rango.length)
    base.range = rango
  }
  return { ...base, body: new Blob([datos]).stream() }
}

const env = {
  TESELAS: {
    async head(clave) {
      const o = objetos.get(clave)
      return o ? objetoR2(clave, o, false) : null
    },
    async get(clave, { range, onlyIf } = {}) {
      lecturasR2++
      const o = objetos.get(clave)
      if (!o) return null
      const etag = `"${clave.length}-${o.cuerpo.length}"`
      if (onlyIf?.get?.('If-None-Match') === etag) return objetoR2(clave, o, false)
      const r = range?.get?.('Range')?.match(/bytes=(\d+)-(\d+)/)
      return objetoR2(clave, o, true, r ? { offset: +r[1], length: +r[2] - +r[1] + 1 } : null)
    },
  },
}

const guardadas = new Map()
globalThis.caches = {
  default: {
    async match(req) {
      const r = guardadas.get(req.url)
      return r ? r.clone() : undefined
    },
    async put(req, res) {
      guardadas.set(req.url, new Response(await res.arrayBuffer(), { status: res.status, headers: res.headers }))
    },
  },
}
const pendientes = []
const ctx = { waitUntil: (p) => pendientes.push(p) }
const pedir = async (ruta, init = {}) => {
  const r = await worker.fetch(new Request(`https://teselas.ejemplo${ruta}`, init), env, ctx)
  await Promise.all(pendientes.splice(0))
  return r
}
const SITIO = { Origin: 'https://geoai-latam.inspow.tech' }

// 1. Primer pedido: de R2, con tipo por extensión, caché larga y CORS del sitio.
let r = await pedir('/tintal/v1/geo/tileset.json', { headers: SITIO })
assert.equal(r.status, 200)
assert.equal(r.headers.get('Content-Type'), 'application/json')
assert.equal(r.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://geoai-latam.inspow.tech')
assert.equal(r.headers.get('X-Cache'), 'MISS')
assert.equal(await r.text(), '{"asset":{"version":"1.0"}}')

// 2. El segundo sale de la caché del borde, sin tocar R2, y con los CORS del que pregunta.
const antes = lecturasR2
r = await pedir('/tintal/v1/geo/tileset.json?x=1', { headers: { Origin: 'http://localhost:3111' } })
assert.equal(r.status, 200)
assert.equal(r.headers.get('X-Cache'), 'HIT')
assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3111')
assert.equal(lecturasR2, antes)

// 3. Glb: model/gltf-binary. Un origen ajeno no recibe CORS.
r = await pedir('/tintal/v1/geo/root.glb', { headers: { Origin: 'https://otro.ejemplo' } })
assert.equal(r.headers.get('Content-Type'), 'model/gltf-binary')
assert.equal(r.headers.get('Access-Control-Allow-Origin'), null)
assert.equal((await r.arrayBuffer()).byteLength, 1000)

// 4. Vista previa de Vercel: sí.
r = await pedir('/tintal/v1/geo/root.glb', { headers: { Origin: 'https://galeria-vuelos-git-una-rama-geoai-latam.vercel.app' } })
assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://galeria-vuelos-git-una-rama-geoai-latam.vercel.app')

// 5. Range: 206 con Content-Range, directo a R2.
r = await pedir('/tintal/v1/geo/root.glb', { headers: { ...SITIO, Range: 'bytes=0-99' } })
assert.equal(r.status, 206)
assert.equal(r.headers.get('Content-Range'), 'bytes 0-99/1000')
assert.equal((await r.arrayBuffer()).byteLength, 100)

// 6. If-None-Match sobre la copia del borde: 304.
const etag = r.headers.get('ETag')
r = await pedir('/tintal/v1/geo/root.glb', { headers: { ...SITIO, 'If-None-Match': etag } })
assert.equal(r.status, 304)

// 7. Sin versión: caché corta y no se guarda en el borde.
r = await pedir('/suelto.json', { headers: SITIO })
assert.equal(r.headers.get('Cache-Control'), 'public, max-age=300')
assert.ok(!guardadas.has('https://teselas.ejemplo/suelto.json'))

// 8. 404, 405, preflight, HEAD y rutas raras.
assert.equal((await pedir('/tintal/v1/geo/no-existe.glb', { headers: SITIO })).status, 404)
assert.equal((await pedir('/tintal/v1/geo/root.glb', { method: 'POST', headers: SITIO })).status, 405)
r = await pedir('/tintal/v1/geo/root.glb', { method: 'OPTIONS', headers: { ...SITIO, 'Access-Control-Request-Headers': 'range' } })
assert.equal(r.status, 204)
assert.match(r.headers.get('Access-Control-Allow-Headers'), /Range/)
r = await pedir('/suelto.json', { method: 'HEAD', headers: SITIO })
assert.equal(r.status, 200)
assert.equal(r.headers.get('Content-Length'), '2')
assert.equal((await pedir('/tintal/../secreto', { headers: SITIO })).status, 404)
assert.equal((await pedir('/', { headers: SITIO })).status, 404)

console.log('Worker: 8 grupos de pruebas pasan')
