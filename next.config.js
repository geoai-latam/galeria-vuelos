// La URL pública de la app, calculada una vez al compilar y expuesta como
// SITE_URL al servidor y al navegador por igual (data/site.js la lee).
//   1. NEXT_PUBLIC_SITE_URL, si está definida (el dominio propio, cuando lo haya).
//   2. Si no, en Vercel, VERCEL_PROJECT_PRODUCTION_URL (Vercel la expone sola,
//      sin el protocolo): así un despliegue sin variables ya tiene canonical.
//   3. Si no, vacía (en local): el canonical no se emite y el sitemap y el
//      robots.txt toman el host del pedido.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    SITE_URL: siteUrl.replace(/\/+$/, ''),
  },
  images: {
    // AVIF primero: pesa bastante menos que WebP, y el optimizador cae solo a
    // WebP donde no esté soportado.
    formats: ['image/avif', 'image/webp'],
  },
  async redirects() {
    return [
      // En el sitio de GeoAI LATAM el explorador vivía en /vuelos; acá es la
      // raíz. Next pasa la query tal cual, así que /vuelos?v=tintal llega a
      // /?v=tintal. Las fichas (/vuelos/<slug>) siguen donde estaban.
      { source: '/vuelos', destination: '/', permanent: true },
    ]
  },
}

module.exports = nextConfig
