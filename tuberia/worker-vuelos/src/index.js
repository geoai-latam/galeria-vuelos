// Worker de las teselas de los vuelos de GeoAI LATAM.
//
// Sirve el bucket R2 "vuelos" (el mismo que hoy se lee por r2.dev) con lo que
// r2.dev no da:
//
//   - HTTP/2 y HTTP/3. r2.dev responde en HTTP/1.1 (medido con Chromium el
//     25-sep-2026), así que el navegador abre 6 conexiones como mucho y las
//     25 descargas que pide el renderer hacen fila: una tesela pedida a los
//     33 ms recibía la cabecera a los 900 ms.
//   - Caché en el borde (Cache API) para las rutas versionadas
//     /<slug>/v<N>/..., que nunca cambian: subir un modelo nuevo es subir a
//     v<N+1>. Ojo: la Cache API solo funciona con el Worker en un dominio propio
//     de una zona de Cloudflare; en *.workers.dev no guarda nada (ver README).
//   - Cache-Control largo e inmutable para esas rutas (r2.dev manda
//     max-age=300: a los 5 minutos el navegador vuelve a preguntar por cada
//     tesela).
//   - CORS solo para el sitio, localhost y las vistas previas de Vercel;
//     Range; Content-Type correcto por extensión; 404 y 405 limpios.

const VERSIONADA = /^\/[a-z0-9-]+\/v\d+\//
const UN_ANO = 'public, max-age=31536000, immutable'
const CORTO = 'public, max-age=300'

const ORIGENES = new Set([
  'https://galeria-vuelos.vercel.app',
  'https://geoai-latam.inspow.tech',
  'http://localhost:3000',
  'http://localhost:3111',
])
// Vistas previas de Vercel de la galería
// (galeria-vuelos-<hash>-<equipo>.vercel.app, galeria-vuelos-git-<rama>-<equipo>.vercel.app).
const PREVIA = /^https:\/\/galeria-vuelos(-[a-z0-9-]+)?\.vercel\.app$/

const TIPOS = {
  json: 'application/json',
  geojson: 'application/geo+json',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  b3dm: 'application/octet-stream',
  i3dm: 'application/octet-stream',
  pnts: 'application/octet-stream',
  cmpt: 'application/octet-stream',
  subtree: 'application/octet-stream',
  bin: 'application/octet-stream',
  ktx2: 'image/ktx2',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

function origenPermitido(origen) {
  return !!origen && (ORIGENES.has(origen) || PREVIA.test(origen))
}

function conCors(headers, origen) {
  headers.set('Vary', 'Origin')
  if (origenPermitido(origen)) {
    headers.set('Access-Control-Allow-Origin', origen)
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, ETag, Accept-Ranges')
  }
  return headers
}

function respuesta(cuerpo, status, extra, origen) {
  const h = new Headers(extra)
  return new Response(cuerpo, { status, headers: conCors(h, origen) })
}

// Una respuesta sacada de la caché trae los encabezados con que se guardó; se
// le ponen los CORS del que pregunta (la caché no guarda CORS).
function desdeCache(res, origen, cabeza) {
  const h = conCors(new Headers(res.headers), origen)
  h.set('X-Cache', 'HIT')
  return new Response(cabeza ? null : res.body, { status: res.status, headers: h })
}

function tipoDe(clave, guardado) {
  const ext = clave.split('.').pop().toLowerCase()
  return TIPOS[ext] || guardado || 'application/octet-stream'
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const origen = request.headers.get('Origin')

    if (request.method === 'OPTIONS') {
      return respuesta(null, 204, {
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, If-None-Match, If-Modified-Since',
        'Access-Control-Max-Age': '86400',
      }, origen)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return respuesta('Método no permitido', 405, { Allow: 'GET, HEAD, OPTIONS' }, origen)
    }

    let clave
    try {
      clave = decodeURIComponent(url.pathname.slice(1))
    } catch {
      return respuesta('Ruta inválida', 400, {}, origen)
    }
    if (!clave || clave.endsWith('/') || clave.split('/').includes('..')) {
      return respuesta('No encontrado', 404, { 'Cache-Control': CORTO }, origen)
    }

    const versionada = VERSIONADA.test(url.pathname)
    const cabeza = request.method === 'HEAD'
    const rango = request.headers.get('Range')
    // La llave de caché es la ruta sola: la query no cambia el objeto, y así
    // un ?x= no sirve para saltarse la caché ni para llenarla de copias.
    const llave = new Request(`${url.origin}${url.pathname}`, { method: 'GET' })
    const cache = caches.default

    // Solo lo versionado se guarda en el borde, y solo completo (la Cache API
    // no guarda respuestas 206). Un Range va directo a R2.
    if (versionada && !rango) {
      const guardada = await cache.match(llave)
      if (guardada) {
        const etag = guardada.headers.get('ETag')
        if (etag && request.headers.get('If-None-Match') === etag) {
          return respuesta(null, 304, { ETag: etag, 'Cache-Control': UN_ANO, 'X-Cache': 'HIT' }, origen)
        }
        return desdeCache(guardada, origen, cabeza)
      }
    }

    const objeto = cabeza && !rango
      ? await env.TESELAS.head(clave)
      : await env.TESELAS.get(clave, { range: request.headers, onlyIf: request.headers })

    if (!objeto) {
      // 404 corto: una ruta que falta hoy puede existir después de subirla.
      return respuesta('No encontrado', 404, { 'Cache-Control': 'public, max-age=60' }, origen)
    }

    const h = new Headers()
    objeto.writeHttpMetadata(h)
    h.set('Content-Type', tipoDe(clave, h.get('Content-Type')))
    h.set('ETag', objeto.httpEtag)
    h.set('Accept-Ranges', 'bytes')
    h.set('Cache-Control', versionada ? UN_ANO : CORTO)

    // onlyIf no se cumplió (If-None-Match igual, etc.): R2 devuelve el objeto
    // sin cuerpo.
    if (!cabeza && !('body' in objeto)) {
      return respuesta(null, 304, h, origen)
    }

    let status = 200
    if (rango && objeto.range) {
      const r = objeto.range
      const inicio = 'suffix' in r ? objeto.size - r.suffix : r.offset ?? 0
      const largo = 'suffix' in r ? r.suffix : r.length ?? objeto.size - inicio
      h.set('Content-Range', `bytes ${inicio}-${inicio + largo - 1}/${objeto.size}`)
      h.set('Content-Length', String(largo))
      status = 206
    } else {
      h.set('Content-Length', String(objeto.size))
    }

    if (cabeza) return respuesta(null, status, h, origen)

    const res = new Response(objeto.body, { status, headers: h })
    if (versionada && status === 200) {
      // Se guarda sin CORS; desdeCache() los pone por pedido.
      ctx.waitUntil(cache.put(llave, res.clone()))
    }
    h.set('X-Cache', 'MISS')
    return new Response(res.body, { status, headers: conCors(h, origen) })
  },
}
