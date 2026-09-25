// robots.txt dinámico: así el Sitemap apunta al dominio en que corre la app y
// no a uno escrito a mano.
import { baseDe } from '../lib/url'

export async function getServerSideProps({ req, res }) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  res.write(`User-agent: *\nAllow: /\n\nSitemap: ${baseDe(req)}/sitemap.xml\n`)
  res.end()
  return { props: {} }
}

export default function Robots() {
  return null
}
