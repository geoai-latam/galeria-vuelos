// Topografía Viva (O2): las dos piezas de las sub-páginas del sitio de GeoAI
// LATAM que usa la galería (el encabezado del 404 y los bloques de la ficha).

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Graticule } from '../ui'
import { CONTAINER } from './o2-chrome'

// ─── Encabezado compartido de las sub-páginas ─────────────────────────

export const PageHero = ({ eyebrow, title, titleAccent, description, align = 'left', backHref, backLabel }) => (
  <section className="relative overflow-hidden bg-geo-paper pb-16 pt-10 md:pb-20">
    <Graticule labelOpacity={0.32} rows={3} />
    <div className={`${CONTAINER} relative`}>
      {backHref && (
        <Link
          href={backHref}
          className="mb-8 inline-flex items-center gap-2 text-sm text-geo-forest/70 transition hover:text-geo-forest"
        >
          <ArrowLeft size={16} />
          {backLabel || 'Volver'}
        </Link>
      )}
      <div className={`max-w-3xl ${align === 'center' ? 'mx-auto text-center' : ''}`}>
        {eyebrow && <div className="mb-4 o2-eyebrow text-geo-emerald">{eyebrow}</div>}
        <h1 className="o2-display o2-h2 m-0 text-geo-forest">
          {title}{' '}
          {titleAccent && <span className="italic text-geo-emerald">{titleAccent}</span>}
        </h1>
        {description && (
          <p className="mt-5 max-w-2xl text-base leading-[1.55] text-geo-forest/70 md:text-lg">
            {description}
          </p>
        )}
      </div>
    </div>
  </section>
)

// ─── Bloque con kicker y título (la ficha de un vuelo) ────────────────

export const ProjectBlock = ({ kicker, title, children, accent = 'emerald' }) => {
  const accentColor = accent === 'teal' ? 'text-geo-teal' : 'text-geo-emerald'
  const accentLine = accent === 'teal' ? 'bg-geo-teal/50' : 'bg-geo-emerald/50'
  return (
    <div>
      <div className={`mb-3 o2-mono flex items-center gap-3 text-[10.5px] uppercase tracking-[0.14em] ${accentColor}`}>
        <span className={`h-px w-8 ${accentLine}`} />
        <span>{kicker}</span>
      </div>
      <h2 className="o2-display o2-h4 m-0 mb-6 text-geo-forest">{title}</h2>
      {children}
    </div>
  )
}
