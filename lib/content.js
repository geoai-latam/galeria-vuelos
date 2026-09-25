// Lectura de content/vuelos/ en el servidor (usa fs: no importarlo desde un
// componente de cliente; lo puro está en lib/vuelos.js).
import fs from 'fs'
import path from 'path'

const vuelosDir = path.join(process.cwd(), 'content', 'vuelos')

// Cada vuelo viaja con su huella (content/vuelos/<slug>.huella.geojson, la
// arma tuberia/huella_tileset.mjs) cuando la tiene: la escena hunde el terreno
// y limpia el mapa dentro de ella, y el explorador dibuja su contorno. Son
// pocas decenas de vértices, un KB y medio por vuelo.
function leerVuelo(file) {
  const data = JSON.parse(fs.readFileSync(path.join(vuelosDir, file), 'utf8'))
  const slug = file.replace(/\.json$/, '')
  const vuelo = { slug, ...data }
  const huella = path.join(vuelosDir, `${slug}.huella.geojson`)
  if (fs.existsSync(huella)) {
    vuelo.huella = JSON.parse(fs.readFileSync(huella, 'utf8'))
  }
  return vuelo
}

export function getAllVuelos() {
  if (!fs.existsSync(vuelosDir)) return []

  return (
    fs
      .readdirSync(vuelosDir)
      // _template.json y cualquier auxiliar con prefijo _ no son vuelos.
      .filter((file) => file.endsWith('.json') && !file.startsWith('_'))
      .map(leerVuelo)
      // La fecha es ISO, a veces solo "AAAA-MM", así que se compara como texto:
      // "2026-02" queda después de "2026-01-31", que es lo que se quiere.
      // Desempate por slug: readdirSync no ordena igual en Windows que en el
      // Linux de Vercel.
      .sort(
        (a, b) =>
          String(b.fecha || '').localeCompare(String(a.fecha || '')) ||
          a.slug.localeCompare(b.slug)
      )
  )
}

export function getVueloBySlug(slug) {
  const filePath = path.join(vuelosDir, `${slug}.json`)
  if (slug.startsWith('_') || !fs.existsSync(filePath)) return null
  return leerVuelo(`${slug}.json`)
}
