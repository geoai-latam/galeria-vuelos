// La huella de la malla de un vuelo (content/vuelos/<slug>.huella.geojson) y lo
// que VisorEscena hace con ella: hundir el terreno debajo y quitar del mapa lo
// que choca con la malla. Solo geometría, sin three.js ni MapLibre.

const R_TIERRA = 6378137
const RAD = Math.PI / 180

/** El anillo exterior [[lon, lat], ...] de un Polygon, Feature o FeatureCollection. */
export function anilloHuella(geo) {
  const g = geo?.type === 'FeatureCollection' ? geo.features?.[0]?.geometry : geo?.type === 'Feature' ? geo.geometry : geo
  const anillo = g?.type === 'Polygon' ? g.coordinates?.[0] : null
  return Array.isArray(anillo) && anillo.length >= 4 ? anillo : null
}

/**
 * Peso de hundimiento de un punto: 0 fuera de la huella y en su borde, 1 a
 * `rampa` metros o más hacia adentro, lineal entre los dos. Devuelve también la
 * caja lon/lat para descartar rápido las teselas que no tocan la huella.
 */
export function crearPesoHuella(anillo, rampa) {
  let lon0 = 0, lat0 = 0
  for (const [lon, lat] of anillo) { lon0 += lon; lat0 += lat }
  lon0 /= anillo.length
  lat0 /= anillo.length
  const kx = R_TIERRA * Math.cos(lat0 * RAD) * RAD
  const ky = R_TIERRA * RAD
  const xs = anillo.map(([lon]) => (lon - lon0) * kx)
  const ys = anillo.map(([, lat]) => (lat - lat0) * ky)
  const n = anillo.length - 1 // el último repite el primero
  const caja = anillo.reduce(
    (c, [lon, lat]) => [Math.min(c[0], lon), Math.min(c[1], lat), Math.max(c[2], lon), Math.max(c[3], lat)],
    [Infinity, Infinity, -Infinity, -Infinity]
  )

  function peso(lon, lat) {
    if (lon < caja[0] || lon > caja[2] || lat < caja[1] || lat > caja[3]) return 0
    const x = (lon - lon0) * kx
    const y = (lat - lat0) * ky
    let dentro = false
    let d2 = Infinity
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = xs[i], yi = ys[i], xj = xs[j], yj = ys[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro
      const dx = xj - xi, dy = yj - yi
      const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy || 1)))
      const ex = xi + t * dx - x, ey = yi + t * dy - y
      d2 = Math.min(d2, ex * ex + ey * ey)
    }
    if (!dentro) return 0
    return Math.min(1, Math.sqrt(d2) / rampa)
  }

  return { peso, caja }
}

/**
 * Filtro de estilo que deja solo lo que NO toca la huella. `within` quita lo
 * que queda entero adentro; `distance` (MapLibre 4.2+) quita además lo que la
 * cruza o queda a menos de `margen` metros: el edificio que se sale por un
 * lado de la malla también se va, que es justo el que se asomaba a través de
 * ella.
 */
export function filtroFueraDeHuella(anillo, margen) {
  const poligono = { type: 'Polygon', coordinates: [anillo] }
  return ['all', ['!', ['within', poligono]], ['>', ['distance', poligono], margen]]
}

/**
 * Lo mismo que crearPesoHuella para varias huellas a la vez (el explorador
 * tiene todos los vuelos en una escena): el peso de un punto es el mayor de
 * los de cada huella, y `cajas` deja descartar una tesela que no toca ninguna.
 */
export function crearPesoHuellas(anillos, rampa) {
  const pesos = anillos.map((a) => crearPesoHuella(a, rampa))
  return {
    cajas: pesos.map((p) => p.caja),
    peso(lon, lat) {
      let w = 0
      for (const p of pesos) {
        w = Math.max(w, p.peso(lon, lat))
        if (w >= 1) break
      }
      return w
    },
  }
}

/** filtroFueraDeHuella para varias huellas: fuera de todas. */
export function filtroFueraDeHuellas(anillos, margen) {
  if (anillos.length === 1) return filtroFueraDeHuella(anillos[0], margen)
  return ['all', ...anillos.map((a) => filtroFueraDeHuella(a, margen))]
}
