// Cromo del tema O2 (Topografía Viva) para las páginas con navbar y pie: la
// ficha de cada vuelo y el 404. El explorador (/) ocupa la pantalla entera y
// usa solo O2Head.

import Head from 'next/head'
import { NavbarO2, FooterO2 } from '../sections/o2-chrome'
import { siteConfig } from '../../data/site'

// Sin SITE_URL (ver data/site.js) las rutas quedan relativas. og:image debería
// ser absoluta; en Vercel SITE_URL sale sola de VERCEL_PROJECT_PRODUCTION_URL,
// así que lo relativo solo se ve en local.
const absoluta = (ruta) => (ruta.startsWith('http') ? ruta : `${siteConfig.url}${ruta}`)

// La imagen por defecto es la miniatura del Tintal: la galería no tiene una
// tarjeta propia todavía.
const OG_POR_DEFECTO = '/images/vuelos/tintal.jpg'

// Las etiquetas de SEO de una página (title, description, canonical, og:*,
// twitter:*). O2Shell las pone en cada página con cromo; el explorador, que
// ocupa la pantalla entera, las usa solas.
export const O2Head = ({ title, description, path, ogImage, ogType = 'website', noindex = false }) => {
  const imagen = absoluta(ogImage || OG_POR_DEFECTO)
  // El canonical solo con dominio conocido: uno relativo no le dice nada útil
  // a un buscador.
  const canonical = siteConfig.url && typeof path === 'string' ? `${siteConfig.url}${path}` : null

  // Los og:* viven acá y NO en _document: `next/head` no deduplica contra el
  // documento y saldrían dos etiquetas por página.
  return (
    <Head>
      {title && <title>{title}</title>}
      {description && <meta name="description" content={description} />}
      {canonical && <link rel="canonical" href={canonical} />}
      {canonical && <meta property="og:url" content={canonical} />}
      {noindex && <meta name="robots" content="noindex, nofollow" />}

      <meta property="og:site_name" content={siteConfig.name} />
      <meta property="og:type" content={ogType} />
      <meta property="og:locale" content="es_LA" />
      {title && <meta property="og:title" content={title} />}
      {description && <meta property="og:description" content={description} />}
      <meta property="og:image" content={imagen} />

      <meta name="twitter:card" content="summary_large_image" />
      {title && <meta name="twitter:title" content={title} />}
      {description && <meta name="twitter:description" content={description} />}
      <meta name="twitter:image" content={imagen} />
    </Head>
  )
}

export const O2Shell = ({ children, title, description, path, ogImage, ogType = 'website', noindex = false }) => (
  <div className="o2-root flex min-h-screen flex-col overflow-x-hidden">
    <O2Head
      title={title}
      description={description}
      path={path}
      ogImage={ogImage}
      ogType={ogType}
      noindex={noindex}
    />
    <NavbarO2 />
    <main className="flex-1">{children}</main>
    <FooterO2 />
  </div>
)

export default O2Shell
