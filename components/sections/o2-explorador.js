// Topografía Viva (O2): el explorador de vuelos de dron, la raíz (/).
//
// Pantalla entera: el mapa 3D con todos los vuelos (components/ui/EscenaVuelos,
// que trae MapLibre, three.js y el renderer de teselas y por eso solo se carga
// en esta ruta, con next/dynamic) y encima un panel con la lista. En pantallas
// anchas el panel flota a la izquierda y se puede esconder; en el teléfono es
// una hoja que sube desde abajo.
//
// El panel se renderiza en el servidor: el HTML trae el nombre, el lugar y la
// fecha de cada vuelo aunque el mapa no cargue. Sin JavaScript, un <noscript>
// lista los vuelos con su descripción y el enlace a su ficha.
//
// La página guarda el estado (vuelo elegido, resaltado, capas de modelo
// prendidas) y la escena lo refleja. Elegir un vuelo lo pone en la URL
// (/?v=slug), así que un enlace abre el explorador sobre ese vuelo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FileText,
  Navigation,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { Graticule } from '../ui'
import { formatFechaVuelo } from '../../lib/format'
import { ETIQUETA_ESTADO, coordenadas, escenaDe, fichaDe } from '../../lib/vuelos'
import { siteConfig } from '../../data/site'

const EscenaVuelos = dynamic(() => import('../ui/EscenaVuelos'), {
  ssr: false,
  loading: () => <MapaCargando />,
})

const MapaCargando = () => (
  <div className="absolute inset-0 overflow-hidden bg-geo-paper-warm">
    <Graticule labelOpacity={0.3} rows={5} cols={8} />
  </div>
)

// Medidas del panel. En pantallas anchas flota a 16 px del borde; el mapa
// encuadra en lo que queda a su derecha. En el teléfono la hoja baja mide
// HOJA_BAJA_PX: el nombre, el conteo y la primera tarjeta.
const PANEL_PX = 400
const MARGEN_PX = 16
const HOJA_BAJA_PX = 176

const sinMovimiento = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const ExploradorVuelos = ({ vuelos = [] }) => {
  const router = useRouter()
  const controlRef = useRef(null)
  const listaRef = useRef(null)
  const [seleccionado, setSeleccionado] = useState(null)
  const [resaltado, setResaltado] = useState(null)
  const [visibles, setVisibles] = useState({})
  // Los vuelos que están bajando su modelo ahora (lo avisa la escena).
  const [cargando, setCargando] = useState([])
  const [panelAbierto, setPanelAbierto] = useState(true)
  const [hoja, setHoja] = useState('baja') // solo en el teléfono: 'baja' | 'alta'
  const [movil, setMovil] = useState(false)
  // El vuelo del enlace, leído una vez que el router conoce la URL. La escena
  // no se monta antes: así arranca ya encuadrada en él, sin un vuelo de más.
  const [inicial, setInicial] = useState(undefined)

  const conModelo = vuelos.filter((v) => escenaDe(v)).length
  const enProceso = vuelos.length - conModelo

  // Lo que la escena necesita de cada vuelo, nada más.
  const paraEscena = useMemo(
    () =>
      vuelos.map((v) => ({
        slug: v.slug,
        title: v.title,
        lat: v.lat,
        lon: v.lon,
        estado: v.estado,
        licencia: v.licencia || null,
        huella: v.huella || null,
        escena: escenaDe(v),
      })),
    [vuelos]
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const cambiar = () => setMovil(mq.matches)
    cambiar()
    mq.addEventListener('change', cambiar)
    return () => mq.removeEventListener('change', cambiar)
  }, [])

  // Se lee una sola vez, durante el render (el patrón de React para estado
  // que sale de otro): después, elegir un vuelo cambia la URL y no esto.
  if (inicial === undefined && router.isReady) {
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''
    const pedido = String(router.query.v || hash || '')
    const valido = vuelos.some((v) => v.slug === pedido) ? pedido : null
    setSeleccionado(valido)
    setInicial(valido)
  }

  const relleno = movil
    ? { left: 0, bottom: HOJA_BAJA_PX }
    : { left: panelAbierto ? PANEL_PX + MARGEN_PX : 0, bottom: 0 }

  const ponerEnUrl = useCallback(
    (slug) => {
      router.replace({ pathname: '/', query: slug ? { v: slug } : {} }, undefined, {
        shallow: true,
        scroll: false,
      })
    },
    [router]
  )

  // Elegir un vuelo lo abre en la lista y lleva la cámara hasta él.
  const elegir = useCallback(
    (slug) => {
      setSeleccionado(slug)
      setPanelAbierto(true)
      setHoja('baja')
      ponerEnUrl(slug)
      controlRef.current?.irA(slug)
    },
    [ponerEnUrl]
  )
  const cerrar = () => {
    setSeleccionado(null)
    ponerEnUrl(null)
  }

  // La tarjeta elegida, a la vista dentro de la lista.
  useEffect(() => {
    if (!seleccionado) return
    const el = document.getElementById(`vuelo-${seleccionado}`)
    const lista = listaRef.current
    if (!el || !lista) return
    // La lista es `relative`: offsetTop ya se mide desde ella.
    const top = el.offsetTop - 8
    lista.scrollTo({ top, behavior: sinMovimiento() ? 'auto' : 'smooth' })
  }, [seleccionado])

  const cambiarVisible = useCallback((slug, valor) => {
    setVisibles((v) => ({ ...v, [slug]: valor }))
  }, [])

  // La hoja del teléfono: tocar el asa la sube o la baja; arrastrarla también.
  const arrastre = useRef(null)
  const alBajarAsa = (e) => {
    arrastre.current = { y: e.clientY, t: Date.now() }
  }
  const alSoltarAsa = (e) => {
    const a = arrastre.current
    arrastre.current = null
    if (!a) return
    const dy = e.clientY - a.y
    if (dy < -24) setHoja('alta')
    else if (dy > 24) setHoja('baja')
    else setHoja((h) => (h === 'alta' ? 'baja' : 'alta'))
  }

  const alta = hoja === 'alta'

  return (
    <div className="o2-root fixed inset-0 overflow-hidden bg-geo-paper text-geo-forest">
      {/* Panel: primero en el DOM, así el teclado llega a la lista antes que
          a los controles del mapa. */}
      {/* Escondido en pantallas anchas, `inert`: fuera de la vista y del
          orden de tabulación mientras está corrido a la izquierda. */}
      <aside
        aria-labelledby="titulo-vuelos"
        inert={!panelAbierto && !movil ? true : undefined}
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-2xl border-t border-geo-forest/15 bg-geo-paper-pale shadow-card-hover motion-safe:transition-[height,transform] motion-safe:duration-300 md:inset-x-auto md:bottom-4 md:left-4 md:top-4 md:h-auto md:w-[400px] md:rounded-2xl md:border ${
          alta ? 'h-[82dvh]' : 'h-[176px]'
        } ${panelAbierto ? '' : 'md:-translate-x-[440px]'}`}
      >
        {/* El asa de la hoja (solo en el teléfono). */}
        <button
          type="button"
          onPointerDown={alBajarAsa}
          onPointerUp={alSoltarAsa}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setHoja((h) => (h === 'alta' ? 'baja' : 'alta'))
            }
          }}
          aria-expanded={alta}
          aria-controls="lista-vuelos"
          className="flex w-full shrink-0 touch-none flex-col items-center pb-1 pt-2 md:hidden"
        >
          <span aria-hidden="true" className="block h-1 w-10 rounded-full bg-geo-forest/30" />
          <span className="sr-only">{alta ? 'Bajar la lista de vuelos' : 'Subir la lista de vuelos'}</span>
        </button>

        <header className="shrink-0 border-b border-geo-forest/10 px-4 pb-3 md:px-5 md:pb-4 md:pt-4">
          <div className="hidden items-center justify-between md:flex">
            {/* La galería vive en su propio dominio: el logo lleva de vuelta
                al sitio de GeoAI LATAM, no a la raíz de acá (que es esto). */}
            <a
              href={siteConfig.geoai}
              className="inline-flex items-center gap-2 rounded-full py-1 pr-2 text-[13px] font-medium text-geo-forest/80 transition hover:text-geo-forest"
            >
              <Image src="/favicon.png" alt="" width={22} height={22} className="h-[22px] w-[22px]" />
              GeoAI LATAM
              <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
            </a>
            <button
              type="button"
              onClick={() => setPanelAbierto(false)}
              title="Ocultar el panel"
              className="rounded-lg p-1.5 text-geo-forest/70 transition hover:bg-geo-paper-warm hover:text-geo-forest"
            >
              <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
              <span className="sr-only">Ocultar el panel</span>
            </button>
          </div>

          <div className="flex items-end justify-between gap-3 md:mt-5 md:block">
            <div>
              <h1 id="titulo-vuelos" className="o2-display m-0 text-[24px] leading-none text-geo-forest md:text-[34px]">
                Vuelos de dron
              </h1>
              <p className="m-0 mt-1.5 o2-mono text-[11px] text-geo-forest/70 md:hidden">
                {vuelos.length} vuelos, {conModelo} con modelo 3D
              </p>
            </div>
            <button
              type="button"
              onClick={() => setHoja((h) => (h === 'alta' ? 'baja' : 'alta'))}
              aria-expanded={alta}
              aria-controls="lista-vuelos"
              className="rounded-full border border-geo-forest/15 p-1.5 text-geo-forest md:hidden"
            >
              {alta ? (
                <ChevronDown aria-hidden="true" className="h-4 w-4" />
              ) : (
                <ChevronUp aria-hidden="true" className="h-4 w-4" />
              )}
              <span className="sr-only">{alta ? 'Bajar la lista' : 'Subir la lista'}</span>
            </button>
          </div>
          <p className={`m-0 mt-3 max-w-[34ch] text-[14.5px] leading-[1.5] text-geo-forest/80 ${alta ? '' : 'hidden'} md:block`}>
            Fotogrametría con dron en Bogotá, Cundinamarca, Boyacá y Tolima. Elige un vuelo para
            ir hasta él. Los modelos 3D aparecen solos al acercarte.
          </p>
          <dl className="m-0 mt-4 hidden gap-5 md:flex">
            <Conteo valor={vuelos.length} texto="vuelos" />
            <Conteo valor={conModelo} texto="con modelo 3D" acento="bg-geo-emerald" />
            {enProceso ? <Conteo valor={enProceso} texto="en proceso" acento="bg-geo-ochre-deep" /> : null}
          </dl>
        </header>

        <ul
          id="lista-vuelos"
          ref={listaRef}
          aria-label="Vuelos"
          className="relative m-0 min-h-0 flex-1 list-none space-y-1.5 overflow-y-auto overscroll-contain p-2 md:p-2.5"
        >
          {vuelos.map((v) => (
            <TarjetaVuelo
              key={v.slug}
              vuelo={v}
              escena={paraEscena.find((e) => e.slug === v.slug).escena}
              elegido={seleccionado === v.slug}
              resaltado={resaltado === v.slug}
              visible={visibles[v.slug] !== false}
              cargando={cargando.includes(v.slug)}
              onElegir={() => (seleccionado === v.slug ? cerrar() : elegir(v.slug))}
              onVolar={() => controlRef.current?.irA(v.slug)}
              onResaltar={setResaltado}
              onVisible={cambiarVisible}
            />
          ))}
        </ul>
      </aside>

      {/* Panel escondido: queda una pestaña para volver a abrirlo. */}
      {!panelAbierto ? (
        <button
          type="button"
          onClick={() => setPanelAbierto(true)}
          className="absolute left-4 top-4 z-20 hidden items-center gap-2 rounded-xl border border-geo-forest/15 bg-geo-paper-pale px-3 py-2 text-[14px] font-semibold text-geo-forest shadow-card-border transition hover:bg-geo-paper-warm md:inline-flex"
        >
          <PanelLeftOpen aria-hidden="true" className="h-4 w-4" />
          Vuelos de dron
          <span className="o2-mono text-[11px] font-normal text-geo-forest/70">{vuelos.length}</span>
        </button>
      ) : null}

      {/* En el teléfono, la vuelta al sitio flota sobre el mapa. */}
      <a
        href={siteConfig.geoai}
        className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-geo-forest/15 bg-geo-paper-pale/95 py-1.5 pl-2.5 pr-3 text-[13px] font-medium text-geo-forest shadow-card-border md:hidden"
      >
        <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
        GeoAI LATAM
      </a>

      <main className="absolute inset-0">
        {inicial !== undefined ? (
          <EscenaVuelos
            vuelos={paraEscena}
            seleccionado={seleccionado}
            resaltado={resaltado}
            visibles={visibles}
            inicial={inicial}
            relleno={relleno}
            onElegir={elegir}
            onResaltar={setResaltado}
            onVisible={cambiarVisible}
            onCargando={setCargando}
            controlRef={controlRef}
            className="h-full w-full"
          />
        ) : (
          <MapaCargando />
        )}
        <noscript>
          <div className="absolute inset-0 z-30 overflow-y-auto bg-geo-paper px-5 py-8 md:pl-[440px] md:pr-10">
            <p className="m-0 max-w-xl text-[15px] leading-[1.55] text-geo-forest/85">
              El mapa 3D necesita JavaScript. Sin él, aquí están los vuelos, cada
              uno con su ficha.
            </p>
            <div className="mt-6 grid max-w-3xl gap-4 sm:grid-cols-2">
              {vuelos.map((v) => (
                <article
                  key={v.slug}
                  className="relative rounded-2xl border border-geo-forest/15 bg-geo-paper-pale p-5"
                >
                  <h2 className="o2-display m-0 text-[19px] text-geo-forest">
                    <a href={`/vuelos/${v.slug}`} className="stretched-link">
                      {v.title}
                    </a>
                  </h2>
                  <p className="m-0 mt-1 text-[13px] text-geo-forest/70">
                    {[v.municipio, formatFechaVuelo(v.fecha)].filter(Boolean).join(', ')}
                  </p>
                  {v.descripcion ? (
                    <p className="m-0 mt-3 text-[14px] leading-[1.5] text-geo-forest/85">{v.descripcion}</p>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </noscript>
      </main>
    </div>
  )
}

const Conteo = ({ valor, texto, acento }) => (
  <div className="flex items-baseline gap-1.5">
    <dt className="sr-only">{texto}</dt>
    <dd className="m-0 flex items-baseline gap-1.5">
      <span className="o2-display text-[22px] leading-none text-geo-forest">{valor}</span>
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-geo-forest/75">
        {acento ? <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${acento}`} /> : null}
        {texto}
      </span>
    </dd>
  </div>
)

// ─── Tarjeta ──────────────────────────────────────────────────────────
// Cerrada: una fila (miniatura, nombre, lugar, estado y fecha). Elegida: se
// abre con la vista previa grande, la descripción, la ficha corta y las
// acciones. La fila entera es un botón (Enter la elige y vuela); el ojo de la
// capa va aparte, al lado, para no meter un botón dentro de otro.
const TarjetaVuelo = ({ vuelo: v, escena, elegido, resaltado, visible, cargando, onElegir, onVolar, onResaltar, onVisible }) => {
  const idDetalle = `detalle-${v.slug}`
  const conModelo = !!escena
  const lugar = v.municipio || v.lugar
  const ficha = fichaDe(v, { conLicencia: false }).filter(([campo]) => campo !== 'Lugar' && campo !== 'Coordenadas')

  return (
    <li
      id={`vuelo-${v.slug}`}
      // Solo con ratón: en una pantalla táctil el "hover" se queda pegado en
      // la tarjeta que quedó bajo el dedo cuando la hoja se recoge.
      onPointerEnter={(e) => e.pointerType === 'mouse' && onResaltar(v.slug)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && onResaltar(null)}
      className={`relative rounded-xl border transition-colors ${
        elegido
          ? 'border-geo-forest/20 bg-geo-paper-warm'
          : resaltado
            ? 'border-geo-forest/15 bg-geo-paper-warm/70'
            : 'border-transparent'
      }`}
    >
      <button
        type="button"
        onClick={onElegir}
        onFocus={(e) => e.target.matches(':focus-visible') && onResaltar(v.slug)}
        onBlur={() => onResaltar(null)}
        aria-expanded={elegido}
        aria-controls={elegido ? idDetalle : undefined}
        className="flex w-full items-center gap-3 rounded-xl p-2 text-left"
      >
        {elegido ? null : (
          <span className="relative block h-[64px] w-[92px] shrink-0 overflow-hidden rounded-lg bg-geo-paper-warm">
            <Miniatura vuelo={v} sizes="92px" pequena />
          </span>
        )}
        <span className={`min-w-0 flex-1 ${conModelo ? 'pr-9' : ''} ${elegido ? 'px-1 pt-1' : ''}`}>
          <span
            role="heading"
            aria-level={2}
            className={`o2-display block leading-[1.15] text-geo-forest ${elegido ? 'text-[21px]' : 'text-[16.5px]'}`}
          >
            {v.title}
          </span>
          <span className="mt-1 block truncate text-[13px] text-geo-forest/75">{lugar}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-geo-forest/80">
            <Estado conModelo={conModelo} estado={v.estado} cargando={cargando} />
            {v.fecha ? <span className="text-geo-forest/65">{formatFechaVuelo(v.fecha)}</span> : null}
          </span>
        </span>
      </button>

      {conModelo ? (
        <button
          type="button"
          onClick={() => onVisible(v.slug, !visible)}
          aria-pressed={visible}
          title={visible ? 'Ocultar el modelo en el mapa' : 'Mostrar el modelo en el mapa'}
          className={`absolute right-2 top-2 z-10 rounded-lg p-1.5 transition ${
            visible
              ? 'text-geo-emerald hover:bg-geo-paper-pale'
              : 'bg-geo-paper-warm text-geo-forest/60 hover:text-geo-forest'
          }`}
        >
          {visible ? <Eye aria-hidden="true" className="h-4 w-4" /> : <EyeOff aria-hidden="true" className="h-4 w-4" />}
          <span className="sr-only">Modelo 3D de {v.title} en el mapa</span>
        </button>
      ) : null}

      {elegido ? (
        <div id={idDetalle} className="px-3 pb-3">
          <figure className="relative m-0 mt-1 aspect-[16/10] overflow-hidden rounded-lg bg-geo-paper">
            <Miniatura vuelo={v} sizes="(min-width: 768px) 376px, 100vw" />
            <figcaption className="absolute bottom-2 left-2 rounded bg-geo-forest/85 px-2 py-1 o2-mono text-[10.5px] text-geo-paper-pale">
              {coordenadas(v.lat, v.lon)}
              {v.coordenadas_aprox ? ' (aprox.)' : ''}
            </figcaption>
          </figure>

          {/* Las acciones justo debajo de la vista previa: en una pantalla de
              900 px de alto, al final de la ficha quedaban fuera de la vista. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onVolar}
              className="inline-flex items-center gap-2 rounded-full bg-geo-forest px-4 py-2 text-[13.5px] font-semibold text-geo-paper-warm transition hover:bg-geo-forest-deep"
            >
              <Navigation aria-hidden="true" className="h-3.5 w-3.5" />
              Ir al vuelo
            </button>
            <Link
              href={`/vuelos/${v.slug}`}
              className="inline-flex items-center gap-2 rounded-full border border-geo-forest/20 px-4 py-2 text-[13.5px] font-medium text-geo-forest transition hover:bg-geo-paper-pale"
            >
              <FileText aria-hidden="true" className="h-3.5 w-3.5" />
              Ficha del vuelo
            </Link>
          </div>

          {v.descripcion ? (
            <p className="m-0 mt-3 text-[14px] leading-[1.55] text-geo-forest/85">{v.descripcion}</p>
          ) : null}

          {ficha.length ? (
            <dl className="m-0 mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-geo-forest/10 pt-3">
              {ficha.map(([campo, valor]) => (
                <div key={campo} className="min-w-0">
                  <dt className="o2-mono text-[10.5px] uppercase tracking-[0.12em] text-geo-forest/70">{campo}</dt>
                  <dd className="m-0 mt-0.5 text-[13.5px] leading-snug text-geo-forest">{valor}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <p className="m-0 mt-3 text-[12.5px] leading-[1.5] text-geo-forest/70">
            {conModelo
              ? `Modelo 3D bajo licencia ${v.licencia || 'CC BY 4.0'}. Se descarga por partes, primero lo grueso.`
              : 'El modelo 3D de este vuelo todavía se está procesando. En el mapa queda su ubicación.'}
          </p>

        </div>
      ) : null}
    </li>
  )
}

// Con el modelo bajando, el punto late y el texto lo dice: es lo que pasa en
// el mapa mientras se llena ese vuelo.
const Estado = ({ conModelo, estado, cargando }) => (
  <span className="inline-flex items-center gap-1.5">
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 rounded-full ${conModelo ? 'bg-geo-emerald' : 'border-[1.5px] border-geo-ochre-deep'} ${
        cargando ? 'motion-safe:animate-pulse' : ''
      }`}
    />
    {conModelo
      ? cargando
        ? 'Cargando el modelo 3D'
        : ETIQUETA_ESTADO.publicado
      : ETIQUETA_ESTADO[estado] || ETIQUETA_ESTADO['en proceso']}
  </span>
)

// La vista previa de un vuelo, o sin ella la retícula con la diana en el
// centro: dice dónde, que es lo único que se sabe sin imagen.
const Miniatura = ({ vuelo: v, sizes, pequena = false }) =>
  v.miniatura ? (
    <Image src={v.miniatura} alt="" fill sizes={sizes} className="object-cover" />
  ) : (
    <>
      <Graticule labels={false} rows={pequena ? 2 : 4} cols={pequena ? 3 : 6} lineOpacity={0.14} />
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
        <svg viewBox="0 0 28 28" className={pequena ? 'h-5 w-5' : 'h-9 w-9'}>
          <circle cx="14" cy="14" r="12.25" fill="#f4f2ea" stroke="#1c3328" strokeWidth="1.5" />
          <path d="M14 14V3.5A10.5 10.5 0 0 1 24.5 14Z" fill="#8f5310" />
          <path d="M14 14v10.5A10.5 10.5 0 0 1 3.5 14Z" fill="#8f5310" />
        </svg>
      </span>
    </>
  )

export default ExploradorVuelos
