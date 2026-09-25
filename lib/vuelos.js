// Lo que las páginas de vuelos necesitan de cada JSON de content/vuelos/, ya
// resuelto: las URL de las teselas, los números a la colombiana y los datos de
// la escena. Puro (sin fs ni three.js): lo usan el explorador, la ficha y la
// escena, en el servidor y en el cliente.

import { TILES_BASE } from '../data/escena'

/**
 * URL final de un recurso de un vuelo, o '' si no hay nada que cargar.
 *
 * - URL completa o ruta que empieza por "/": se usa tal cual.
 * - Ruta relativa ("tintal/v1/geo/tileset.json"): se une a TILES_BASE de
 *   data/escena.js (el bucket de R2, o NEXT_PUBLIC_VUELOS_TILES_BASE si está
 *   definida al compilar).
 */
export function urlVuelo(t) {
  if (!t) return ''
  if (/^https?:\/\//.test(t) || t.startsWith('/')) return t
  if (!TILES_BASE) return ''
  return `${TILES_BASE.replace(/\/+$/, '')}/${t.replace(/^\.?\/+/, '')}`
}

export function urlTileset(modelo, campo = 'tileset') {
  return urlVuelo(modelo?.[campo])
}

/**
 * Lo que la escena necesita para poner el modelo de un vuelo sobre el mapa, o
 * null si el vuelo no tiene todavía tileset georreferenciado y geoide.
 */
export function escenaDe(v) {
  const tileset = urlTileset(v.modelo, 'tileset_geo')
  if (!tileset || typeof v.escena?.geoide_m !== 'number') return null
  return {
    tileset,
    geoide: v.escena.geoide_m,
    // Sin el campo va null, y la escena usa AJUSTE_ALTURA_M de data/escena.js.
    ajuste: typeof v.escena.ajuste_altura_m === 'number' ? v.escena.ajuste_altura_m : null,
    camara: v.escena.camara || null,
    // { este, norte, z_pivote }: la malla se endereza con una rotación (ver
    // content/vuelos/README.md, "Inclinación"). Sin el campo, va como viene.
    inclinacion:
      v.escena.inclinacion && Number.isFinite(v.escena.inclinacion.este) && Number.isFinite(v.escena.inclinacion.norte)
        ? v.escena.inclinacion
        : null,
    // Altura del terreno en el borde de la malla: con el terreno apagado el
    // modelo baja eso para apoyarse en el plano de 0 m. Sin el campo se mide
    // en vivo (si el terreno llegó a cargar) o sale del punto más bajo de la malla.
    sueloBorde: typeof v.escena.suelo_borde_m === 'number' ? v.escena.suelo_borde_m : null,
    pesoMb: typeof v.escena.peso_inicial_mb === 'number' ? v.escena.peso_inicial_mb : null,
  }
}

// Números a la colombiana sin depender del ICU del servidor: 2440 -> "2.440",
// 0.95 -> "0,95". Lo mismo en el HTML estático que en la hidratación.
export function numero(n) {
  const [ent, dec] = String(n).split('.')
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return dec ? `${miles},${dec}` : miles
}

export function coordenadas(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return ''
  const ns = lat >= 0 ? 'N' : 'S'
  const eo = lon >= 0 ? 'E' : 'O'
  return `${numero(Math.abs(lat))}° ${ns}, ${numero(Math.abs(lon))}° ${eo}`
}

export const ETIQUETA_ESTADO = {
  publicado: 'Con modelo 3D',
  'en proceso': 'Modelo en proceso',
}

/** La ficha de un vuelo: pares [campo, valor] sin los vacíos. */
export function fichaDe(v, { conLicencia = true } = {}) {
  return [
    // Sin repetir: Zipaquirá en Zipaquirá (Cundinamarca) queda en lo segundo.
    ['Lugar', [v.municipio?.startsWith(v.lugar) ? null : v.lugar, v.municipio].filter(Boolean).join(', ')],
    ['Coordenadas', coordenadas(v.lat, v.lon) + (v.coordenadas_aprox ? ' (aproximadas)' : '')],
    ['Fotos', typeof v.fotos === 'number' ? numero(v.fotos) : null],
    ['Captura', v.captura],
    ['Altura de vuelo', typeof v.altura_m === 'number' ? `${numero(v.altura_m)} m` : null],
    ['GSD', typeof v.gsd_cm === 'number' ? `${numero(v.gsd_cm)} cm/px` : null],
    ['Dron', v.dron],
    ['Cámara', v.camara],
    conLicencia ? ['Licencia del modelo', v.licencia] : null,
  ].filter((f) => f && f[1])
}
