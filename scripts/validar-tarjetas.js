// Comprueba, sobre el HTML generado por `npm run build`, que cada tarjeta del
// explorador sea UNA sola parada de tabulación: un solo enlace a la ficha del
// vuelo (el .stretched-link del título), y que el <noscript> no rompa la cuenta.
const fs = require('fs')

let fallas = 0
const c = (t, b, d) => {
  if (!b) fallas++
  console.log(`  [${b ? 'OK ' : 'FALLA'}] ${t}${d ? ' — ' + d : ''}`)
}

function articulos(html) {
  // Corta el __NEXT_DATA__: ahí van los datos crudos y ensucian el conteo.
  const corte = html.indexOf('<script id="__NEXT_DATA__"')
  const visible = corte > 0 ? html.slice(0, corte) : html
  return visible.split('<article').slice(1).map((x) => '<article' + x.split('</article>')[0])
}

const ruta = '.next/server/pages/index.html'
if (!fs.existsSync(ruta)) {
  console.log(`No existe ${ruta}: corre \`npm run build\` primero.`)
  process.exit(1)
}

const arts = articulos(fs.readFileSync(ruta, 'utf8'))
console.log(`\nEXPLORADOR — ${arts.length} tarjetas`)
c('hay tarjetas', arts.length > 0)

let peor = 0
for (const art of arts) {
  const n = (art.match(/href="\/vuelos\/[^"]*"/g) || []).length
  if (n > peor) peor = n
}
c('máximo 1 enlace a la ficha por tarjeta', peor <= 1, `peor caso: ${peor}`)
c(
  'usa .stretched-link',
  arts.some((a) => a.includes('stretched-link')),
  `${arts.filter((a) => a.includes('stretched-link')).length} tarjetas`
)

console.log(fallas === 0 ? '\n✓ TODO PASA\n' : `\n✗ ${fallas} FALLAS\n`)
process.exit(fallas ? 1 : 0)
