import Link from 'next/link'
import { O2Shell } from '../components/layout'
import { PageHero } from '../components/sections/o2-pages'
import { siteConfig } from '../data/site'

export default function NotFound() {
  return (
    <O2Shell
      title={`Página no encontrada | ${siteConfig.name}`}
      description="La página que buscas no existe. Vuelve al explorador de vuelos."
      noindex
    >
      <PageHero
        eyebrow="Error 404"
        title="Esta ruta no existe"
        titleAccent="en el mapa"
        description="El enlace que seguiste apunta a una página que no está aquí. Puede que el vuelo haya cambiado de nombre, o que la dirección tenga una errata."
      />

      <section className="bg-geo-paper pb-24">
        <div className="mx-auto w-full max-w-7xl px-6 md:px-10 lg:px-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full bg-geo-forest px-6 py-3 text-sm font-medium text-geo-paper transition-colors hover:bg-geo-emerald"
          >
            Volver al explorador
          </Link>
        </div>
      </section>
    </O2Shell>
  )
}
