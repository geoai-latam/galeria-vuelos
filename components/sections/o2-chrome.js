// Cromo del tema O2 — navbar y pie, recortados para la galería.
//
// La galería es un producto de GeoAI LATAM en su propio dominio: el nav no
// enlaza secciones del sitio que no existen acá (blog, proyectos, roadmap,
// boletín), solo el explorador y la vuelta a geoai-latam.inspow.tech.

import Link from 'next/link'
import Image from 'next/image'
import { ArrowUpRight } from 'lucide-react'
import { siteConfig } from '../../data/site'

// Contenedor horizontal compartido (coincide con el lienzo de diseño de 1280px).
export const CONTAINER = 'mx-auto w-full max-w-7xl px-6 md:px-10 lg:px-12'

// ─── Navbar ─────────────────────────────────────────────────────────────

export const NavbarO2 = () => (
  <nav className="relative z-20">
    <div className={`${CONTAINER} flex items-center justify-between gap-4 py-6 lg:py-8`}>
      <Link href="/" className="flex min-w-0 items-center gap-3 transition hover:opacity-90">
        <Image
          src="/favicon.png"
          alt=""
          width={44}
          height={44}
          className="h-10 w-10 shrink-0 object-contain md:h-11 md:w-11"
          priority
        />
        <span className="o2-display o2-h6 leading-tight text-geo-forest">
          Galería de vuelos
          <span className="block text-sm not-italic text-geo-forest/70 md:inline md:text-base">
            <span className="hidden md:inline"> · </span>
            GeoAI <span className="italic text-geo-emerald">LATAM</span>
          </span>
        </span>
      </Link>

      <div className="flex shrink-0 items-center gap-5 md:gap-8">
        <Link
          href="/"
          className="hidden text-[15px] font-medium text-geo-forest transition hover:text-geo-emerald sm:inline"
        >
          Explorador
        </Link>
        <a
          href={siteConfig.geoai}
          className="inline-flex items-center gap-1.5 rounded-full bg-geo-forest px-4 py-2.5 text-sm font-semibold text-geo-paper-warm transition hover:bg-geo-forest-deep md:px-6 md:py-3"
        >
          GeoAI LATAM
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </div>
    </div>
  </nav>
)

// ─── Footer ─────────────────────────────────────────────────────────────

export const FooterO2 = () => {
  const enlaces = [
    { label: 'Explorador', href: '/', interno: true },
    { label: 'GeoAI LATAM', href: siteConfig.geoai },
    { label: 'Código en GitHub', href: siteConfig.repo },
  ]

  return (
    <footer className="relative overflow-hidden bg-geo-forest pb-8 pt-16 text-geo-paper-warm">
      <div className={`${CONTAINER} relative`}>
        <div className="grid grid-cols-1 gap-12 pb-12 md:grid-cols-[1.4fr_1fr] md:gap-16">
          <div>
            <Link href="/" className="inline-flex items-center gap-3 transition hover:opacity-90">
              <Image src="/favicon.png" alt="" width={40} height={40} className="h-10 w-10 object-contain" />
              <span className="o2-display o2-h6 leading-none text-geo-paper-warm">
                Galería de vuelos
              </span>
            </Link>
            <p className="mt-5 max-w-sm text-[14px] leading-[1.55] text-geo-paper-warm/70">
              Vuelos de fotogrametría con dron y el modelo 3D de cada uno, sobre
              un mapa. Un proyecto de GeoAI LATAM.
            </p>
          </div>

          <div>
            <div className="mb-4 o2-mono text-[11px] uppercase tracking-[0.15em] text-geo-emerald-light">
              Enlaces
            </div>
            {enlaces.map((l) =>
              l.interno ? (
                <Link
                  key={l.label}
                  href={l.href}
                  className="block py-1 text-[15px] text-geo-paper-warm transition hover:text-geo-emerald-light"
                >
                  {l.label}
                </Link>
              ) : (
                <a
                  key={l.label}
                  href={l.href}
                  className="block py-1 text-[15px] text-geo-paper-warm transition hover:text-geo-emerald-light"
                >
                  {l.label}
                </a>
              )
            )}
          </div>
        </div>

        <div className="flex flex-col items-start justify-between gap-3 border-t border-geo-paper-warm/20 pt-6 text-[13px] text-geo-paper-warm/70 md:flex-row md:items-center">
          <span>© {new Date().getFullYear()} · GeoAI LATAM · código Apache-2.0</span>
          <span>Modelos e imágenes: {siteConfig.autor}, CC BY 4.0</span>
        </div>
      </div>
    </footer>
  )
}
