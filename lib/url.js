import { siteConfig } from '../data/site'

// La base absoluta para el sitemap y el robots.txt. Sin SITE_URL
// (data/site.js) se usa el host del pedido: un sitemap necesita URL absolutas.
export function baseDe(req) {
  if (siteConfig.url) return siteConfig.url
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0]
  return `${proto}://${req.headers.host}`
}
