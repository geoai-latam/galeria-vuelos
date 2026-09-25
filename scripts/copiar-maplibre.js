// Copia el worker de MapLibre a public/maplibre/ antes de `next dev` y de
// `next build` (los ganchos predev y prebuild de package.json).
//
// MapLibre 6 corre su worker como un módulo ES aparte que importa
// maplibre-gl-shared.mjs por ruta relativa. Ni webpack ni Turbopack lo
// empaquetan como worker, así que EscenaVuelos le dice dónde está con
// setWorkerUrl('/maplibre/maplibre-gl-worker.mjs'). Se copia en cada build en
// vez de versionarlo para que nunca quede de otra versión que la instalada; la
// carpeta está en .gitignore.
const fs = require('fs')
const path = require('path')

const origen = path.join(__dirname, '..', 'node_modules', 'maplibre-gl', 'dist')
const destino = path.join(__dirname, '..', 'public', 'maplibre')
const ARCHIVOS = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']

fs.mkdirSync(destino, { recursive: true })
for (const f of ARCHIVOS) fs.copyFileSync(path.join(origen, f), path.join(destino, f))
const version = require(path.join(origen, '..', 'package.json')).version
console.log(`maplibre-gl ${version}: worker copiado a public/maplibre/`)
