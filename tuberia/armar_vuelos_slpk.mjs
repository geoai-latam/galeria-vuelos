// armar_vuelos_slpk.mjs: junta los informe.json de slpk_a_tiles.mjs en
// D:/geoai-vuelos/vuelos-slpk.json (uno por slug). No toca el sitio ni sube nada.
// Uso: node D:/geoai-vuelos/tools/armar_vuelos_slpk.mjs
import fs from 'node:fs'

// La carpeta de trabajo con los vuelos (no está en el repo: son los datos).
const RAIZ = process.env.VUELOS_RAIZ || 'D:/geoai-vuelos'
const SLUGS = ['rotonda-kennedy', 'ibague-arboleda', 'parque', 'zipaquira', 'castilla', 'cerinza', 'kennedy-81b', 'tintal-slpk']
const NOTAS = JSON.parse(fs.existsSync(`${RAIZ}/tmp/notas-vuelos.json`) ? fs.readFileSync(`${RAIZ}/tmp/notas-vuelos.json`, 'utf8') : '{}')
const salida = { generado: new Date().toISOString().slice(0, 10), script: `${RAIZ}/tools/slpk_a_tiles.mjs`, vuelos: {} }
let total = 0, archivos = 0
for (const s of SLUGS) {
  const f = `${RAIZ}/${s}/informe.json`
  if (!fs.existsSync(f)) { salida.vuelos[s] = { estado: 'fallo', notas: NOTAS[s] || `sin informe: ver ${RAIZ}/${s}/conversion.log` }; continue }
  const i = JSON.parse(fs.readFileSync(f, 'utf8'))
  const hojas = i.niveles?.at(-1)
  salida.vuelos[s] = {
    fuente: i.fuente, fuente_mb: i.fuente_mb, centro: i.centro, bbox: i.bbox,
    tileset: i.tileset, huella: i.huella, huella_area_m2: i.huella_area_m2,
    geoide_m: i.alturas.geoide_m, ajuste_altura_m: i.alturas.ajuste_altura_m,
    residuo_suelo_abierto: i.alturas.residuo.suelo_abierto, residuo_borde: i.alturas.residuo.suelo_abierto_borde,
    total_mb: i.total_mb, archivos: i.archivos, primera_vista_mb: i.primera_vista_mb,
    niveles: i.niveles?.length, texel_hojas_cm: hojas?.texel_mediano_cm, triangulos_hojas: hojas?.tris,
    notas: NOTAS[s] || '',
  }
  total += i.total_mb; archivos += i.archivos
}
salida.total_mb = +total.toFixed(1)
salida.total_archivos = archivos
fs.writeFileSync(`${RAIZ}/vuelos-slpk.json`, JSON.stringify(salida, null, 2) + '\n')
console.log(`vuelos-slpk.json: ${Object.keys(salida.vuelos).length} vuelos, ${salida.total_mb} MB, ${archivos} archivos`)
