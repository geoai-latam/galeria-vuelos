// Sitemap dinámico: el explorador y la ficha de cada vuelo.
import { getAllVuelos } from '../lib/content'
import { baseDe } from '../lib/url'

function generarSitemap(base, vuelos) {
  const urls = [{ loc: `${base}/` }, ...vuelos.map((v) => ({ loc: `${base}/vuelos/${v.slug}` }))]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(({ loc }) => `  <url><loc>${loc}</loc></url>`).join('\n')}
</urlset>
`
}

export async function getServerSideProps({ req, res }) {
  res.setHeader('Content-Type', 'text/xml')
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  res.write(generarSitemap(baseDe(req), getAllVuelos()))
  res.end()
  return { props: {} }
}

export default function SiteMap() {
  return null
}
