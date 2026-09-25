// Topografía Viva (O2): la ficha de un vuelo de dron, /vuelos/<slug>.
//
// El mapa con todos los vuelos es el explorador (/, o2-explorador.js).
// Esta página existe para compartir y para los buscadores: los datos del vuelo,
// un enlace grande que abre el explorador sobre él (/?v=<slug>) y, si el
// modelo ya está publicado, el visor del modelo solo (VisorTiles). El visor no
// se carga hasta que el visitante lo pide: three.js y el renderer de teselas
// pesan, y un modelo de fotogrametría no se baja sin preguntar.

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { ArrowLeft, Box, Navigation } from 'lucide-react'
import { Graticule } from '../ui'
import { CONTAINER } from './o2-chrome'
import { ProjectBlock } from './o2-pages'
import { formatFechaVuelo } from '../../lib/format'
import { ETIQUETA_ESTADO, escenaDe, fichaDe, numero, urlTileset } from '../../lib/vuelos'

const VisorTiles = dynamic(() => import('../ui/VisorTiles'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[15px] text-geo-forest/70">
      Preparando el visor…
    </div>
  ),
})

const MARCO =
  'relative aspect-[4/5] w-full overflow-hidden rounded-3xl border border-geo-forest/15 bg-geo-paper-warm sm:aspect-[16/10] lg:aspect-[16/9]'

export const VueloDetailO2 = ({ vuelo: v }) => {
  const tileset = urlTileset(v.modelo)
  const conModelo = !!escenaDe(v)
  // Sin fecha no va la fila: fichaDe ya quita los demás campos vacíos.
  const fecha = formatFechaVuelo(v.fecha)
  const ficha = [...(fecha ? [['Fecha', fecha]] : []), ...fichaDe(v)]
  const explorador = `/?v=${v.slug}`

  return (
    <>
      <section className="relative overflow-hidden bg-geo-paper pb-12 pt-10">
        <Graticule labelOpacity={0.28} rows={3} />
        <div className={`${CONTAINER} relative`}>
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-2 text-sm text-geo-forest/70 transition hover:text-geo-forest"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Todos los vuelos
          </Link>
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-geo-forest/15 bg-geo-paper-pale/95 px-3 py-1.5 text-xs font-semibold text-geo-forest">
                <span
                  aria-hidden="true"
                  className={`inline-block h-1.5 w-1.5 rounded-full ${conModelo ? 'bg-geo-emerald' : 'bg-geo-ochre-deep'}`}
                />
                {conModelo ? ETIQUETA_ESTADO.publicado : ETIQUETA_ESTADO['en proceso']}
              </span>
              {fecha ? (
                <span className="o2-mono text-[11px] uppercase tracking-[0.12em] text-geo-forest/70">
                  {fecha}
                </span>
              ) : null}
            </div>
            <h1 className="o2-display o2-h2 m-0 text-geo-forest">{v.title}</h1>
            {v.descripcion ? (
              <p className="mt-5 max-w-2xl text-base leading-[1.55] text-geo-forest/75 md:text-lg">
                {v.descripcion}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="bg-geo-paper pb-24">
        <div className={`${CONTAINER} space-y-14`}>
          {/* La vista previa es el enlace al explorador: ahí está el vuelo
              sobre el mapa 3D, junto a los demás. */}
          <Link href={explorador} className={`${MARCO} group block`}>
            {v.miniatura ? (
              <Image
                src={v.miniatura}
                alt=""
                fill
                sizes="(min-width: 1280px) 1216px, 100vw"
                className="object-cover transition duration-500 motion-safe:group-hover:scale-[1.02]"
              />
            ) : (
              <Graticule labels={false} rows={4} cols={6} lineOpacity={0.12} />
            )}
            <span className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-3 bg-gradient-to-t from-geo-forest-deep/80 to-transparent p-6 pt-24 md:p-8 md:pt-32">
              <span className="inline-flex items-center gap-2.5 rounded-full bg-geo-paper-pale px-6 py-3 text-sm font-semibold text-geo-forest transition group-hover:bg-geo-paper-warm">
                <Navigation size={16} aria-hidden="true" />
                Abrir en el explorador
              </span>
              <span className="max-w-lg text-[14px] leading-[1.5] text-geo-paper-pale">
                {conModelo
                  ? 'El modelo 3D sobre el mapa, con terreno y calles, junto a los demás vuelos.'
                  : 'El modelo 3D todavía se está procesando; en el explorador está su ubicación, junto a los demás vuelos.'}
              </span>
            </span>
          </Link>

          {tileset ? (
            <ProjectBlock kicker="Modelo" title="El modelo solo">
              <VisorDiferido
                tileset={tileset}
                zUp={!!v.modelo?.zUp}
                up={v.modelo?.up || undefined}
                pesoMb={v.modelo?.peso_inicial_mb}
              />
              <p className="mt-4 max-w-3xl text-[13px] leading-[1.55] text-geo-forest/70">
                De cada vuelo publico solo el modelo 3D. Las fotos sueltas y el
                ortomosaico a resolución completa no salen de mi disco.
              </p>
            </ProjectBlock>
          ) : null}

          <ProjectBlock kicker="Ficha" title="Datos del vuelo">
            <dl className="grid grid-cols-1 overflow-hidden rounded-2xl border border-geo-forest/15 bg-geo-paper-warm/60 sm:grid-cols-2">
              {ficha.map(([campo, valor]) => (
                <div key={campo} className="border-b border-geo-forest/10 px-5 py-4 sm:odd:border-r">
                  <dt className="o2-mono text-[10.5px] uppercase tracking-[0.14em] text-geo-forest/70">
                    {campo}
                  </dt>
                  <dd className="m-0 mt-1 text-[15px] text-geo-forest">{valor}</dd>
                </div>
              ))}
            </dl>
          </ProjectBlock>
        </div>
      </section>
    </>
  )
}

// Botón y nada más: hasta que alguien lo pulsa no se descarga ni el código del
// visor ni una sola tesela. La misma idea que EmbedDiferido en el blog de GeoAI LATAM.
const VisorDiferido = ({ tileset, zUp, up, pesoMb }) => {
  const [cargar, setCargar] = useState(false)
  if (cargar) {
    return (
      <div className={MARCO}>
        <VisorTiles tileset={tileset} zUp={zUp} up={up} className="h-full w-full" />
      </div>
    )
  }
  return (
    <div className={MARCO}>
      <Graticule labels={false} rows={4} cols={6} lineOpacity={0.12} />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <button
          type="button"
          onClick={() => setCargar(true)}
          className="inline-flex items-center gap-2.5 rounded-full bg-geo-forest px-7 py-3.5 text-sm font-semibold text-geo-paper-warm transition hover:bg-geo-forest-deep"
        >
          <Box size={16} aria-hidden="true" />
          Cargar el modelo 3D
          {typeof pesoMb === 'number' ? `, unos ${numero(pesoMb)} MB` : ''}
        </button>
        <p className="max-w-md rounded-2xl bg-geo-paper-pale/90 px-4 py-2 text-[14px] leading-[1.55] text-geo-forest/85">
          El modelo sin mapa alrededor. Baja por partes: primero una versión
          gruesa, y el detalle a medida que te acercas. Arrastra para girar y
          usa la rueda o dos dedos para acercarte.
        </p>
      </div>
    </div>
  )
}
