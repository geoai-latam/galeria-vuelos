// Configuración de la galería. Es un producto de GeoAI LATAM, pero vive en su
// propio dominio: nada de acá afirma ser geoai-latam.inspow.tech.

// URL pública de esta app, sin la barra final. De acá salen el canonical, el
// og:url, las og:image absolutas, el sitemap y el robots.txt.
//
// La calcula next.config.js al compilar y la pasa como SITE_URL (así llega
// igual al servidor y al navegador, sin descuadrar la hidratación):
//   1. NEXT_PUBLIC_SITE_URL, si está definida (el dominio propio, cuando lo haya).
//   2. Si no, en Vercel, VERCEL_PROJECT_PRODUCTION_URL, que Vercel expone solo.
//   3. Si no, vacía: el canonical no se emite y el sitemap y el robots.txt
//      toman el host del pedido.
export const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '')

export const siteConfig = {
  name: 'Galería de vuelos · GeoAI LATAM',
  // El nombre corto, para los títulos de las páginas.
  corto: 'Galería de vuelos',
  description:
    'Los vuelos de fotogrametría con dron de Sebastián Forero en Bogotá, Cundinamarca, Boyacá y Tolima, en un mapa 3D con el modelo de cada uno.',
  url: SITE_URL,
  // El sitio de la comunidad: el nav y el pie llevan de vuelta allá.
  geoai: 'https://geoai-latam.inspow.tech',
  repo: 'https://github.com/geoai-latam/galeria-vuelos',
  autor: 'Sebastián Forero',
}

export default siteConfig
