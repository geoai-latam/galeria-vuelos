// Leer y escribir las teselas Terrarium (PNG de 8 bits) sin pasar por un
// lienzo. Un <canvas> no devuelve siempre los píxeles que tiene: Brave (y
// Firefox con resistFingerprinting) cambia al azar el bit bajo de algunos al
// leerlos con getImageData, contra la huella digital del navegador. En una
// tesela de color no se nota; en una de alturas, un bit de R son 256 m, y cada
// píxel tocado sale del suelo como una columna (medido el 25-sep-2026 en Brave:
// unos 330 por tesela de 256x256). MapLibre se cuida de eso por su lado; el
// hundimiento bajo la huella tiene que hacerlo aquí. Con fflate, que ya venía
// con 3d-tiles-renderer, los bytes son exactos en cualquier navegador.

import { unzlibSync, zlibSync } from 'fflate'

const FIRMA = [137, 80, 78, 71, 13, 10, 26, 10]
const CANALES = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

const u32 = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0

/**
 * RGB de un PNG de 8 bits sin entrelazar (lo que sirve AWS). Devuelve
 * { W, H, rgb } con 3 bytes por píxel, o null si el PNG es de otra clase: en
 * ese caso quien llama deja la tesela como vino.
 */
export function leerPng(buf) {
  const b = new Uint8Array(buf)
  if (b.length < 8 || FIRMA.some((v, i) => b[i] !== v)) return null
  let W = 0, H = 0, ct = -1, plte = null
  const idat = []
  let largoIdat = 0
  for (let p = 8; p + 8 <= b.length; ) {
    const largo = u32(b, p)
    const tipo = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7])
    const d = b.subarray(p + 8, p + 8 + largo)
    if (tipo === 'IHDR') {
      W = u32(d, 0)
      H = u32(d, 4)
      ct = d[9]
      // 8 bits, compresión y filtro estándar, sin entrelazado.
      if (d[8] !== 8 || d[10] !== 0 || d[11] !== 0 || d[12] !== 0) return null
    } else if (tipo === 'PLTE') plte = d
    else if (tipo === 'IDAT') {
      idat.push(d)
      largoIdat += d.length
    } else if (tipo === 'IEND') break
    p += 12 + largo
  }
  const bpp = CANALES[ct]
  if (!W || !H || !bpp || (ct === 3 && !plte)) return null
  const z = new Uint8Array(largoIdat)
  let o = 0
  for (const d of idat) {
    z.set(d, o)
    o += d.length
  }
  const crudo = unzlibSync(z)
  const paso = W * bpp
  if (crudo.length < H * (paso + 1)) return null

  const rgb = new Uint8Array(W * H * 3)
  let prev = new Uint8Array(paso)
  let fila = new Uint8Array(paso)
  for (let y = 0; y < H; y++) {
    const ini = y * (paso + 1)
    const filtro = crudo[ini]
    for (let i = 0; i < paso; i++) {
      const a = i >= bpp ? fila[i - bpp] : 0
      const arriba = prev[i]
      let v = crudo[ini + 1 + i]
      if (filtro === 1) v += a
      else if (filtro === 2) v += arriba
      else if (filtro === 3) v += (a + arriba) >> 1
      else if (filtro === 4) {
        const c = i >= bpp ? prev[i - bpp] : 0
        const pp = a + arriba - c
        const pa = Math.abs(pp - a), pb = Math.abs(pp - arriba), pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? arriba : c
      } else if (filtro !== 0) return null
      fila[i] = v
    }
    for (let x = 0, k = y * W * 3; x < W; x++, k += 3) {
      if (ct === 2 || ct === 6) {
        rgb[k] = fila[x * bpp]
        rgb[k + 1] = fila[x * bpp + 1]
        rgb[k + 2] = fila[x * bpp + 2]
      } else if (ct === 3) {
        const j = fila[x] * 3
        rgb[k] = plte[j]
        rgb[k + 1] = plte[j + 1]
        rgb[k + 2] = plte[j + 2]
      } else {
        rgb[k] = rgb[k + 1] = rgb[k + 2] = fila[x * bpp]
      }
    }
    ;[prev, fila] = [fila, prev]
  }
  return { W, H, rgb }
}

const TABLA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function bloque(tipo, datos) {
  const out = new Uint8Array(12 + datos.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, datos.length)
  for (let i = 0; i < 4; i++) out[4 + i] = tipo.charCodeAt(i)
  out.set(datos, 8)
  let c = 0xffffffff
  for (let i = 4; i < 8 + datos.length; i++) c = TABLA_CRC[(c ^ out[i]) & 255] ^ (c >>> 8)
  v.setUint32(8 + datos.length, (c ^ 0xffffffff) >>> 0)
  return out
}

/** PNG RGB de 8 bits a partir de { W, H, rgb }. Filtro Sub en cada fila. */
export function escribirPng({ W, H, rgb }) {
  const paso = W * 3
  const crudo = new Uint8Array(H * (paso + 1))
  for (let y = 0; y < H; y++) {
    const ini = y * (paso + 1)
    const fuente = y * paso
    crudo[ini] = 1
    for (let i = 0; i < paso; i++) {
      crudo[ini + 1 + i] = (rgb[fuente + i] - (i >= 3 ? rgb[fuente + i - 3] : 0)) & 255
    }
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, W)
  v.setUint32(4, H)
  ihdr[8] = 8 // bits
  ihdr[9] = 2 // RGB
  const partes = [
    new Uint8Array(FIRMA),
    bloque('IHDR', ihdr),
    bloque('IDAT', zlibSync(crudo, { level: 6 })),
    bloque('IEND', new Uint8Array(0)),
  ]
  const total = new Uint8Array(partes.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of partes) {
    total.set(p, o)
    o += p.length
  }
  return total.buffer
}

/** Altura Terrarium de un píxel: (R*256 + G + B/256) - 32768. */
export const alturaTerrarium = (rgb, k) => rgb[k] * 256 + rgb[k + 1] + rgb[k + 2] / 256 - 32768

/**
 * Escribe una altura en un píxel Terrarium, redondeada al 1/256 de metro y
 * acotada al rango que el formato puede guardar (-32768 a 32767,996 m).
 */
export function escribirAltura(rgb, k, metros) {
  const q = Math.min(0xffffff, Math.max(0, Math.round((metros + 32768) * 256)))
  rgb[k] = q >>> 16
  rgb[k + 1] = (q >>> 8) & 255
  rgb[k + 2] = q & 255
}
