// EscenaVuelos: todos los vuelos de dron en un solo mapa 3D, el de la raíz (/).
// La idea es la de una escena web de ArcGIS, con piezas abiertas:
//
//   - MapLibre GL (BSD-3) dibuja el mapa de fondo (el catálogo MAPAS_BASE de
//     data/escena.js) sobre el terreno Terrarium de AWS.
//   - Cada vuelo con tileset georreferenciado es una capa `custom` de MapLibre:
//     three.js y 3d-tiles-renderer dibujan en el mismo contexto WebGL, con la
//     misma cámara, y el terreno los tapa bien.
//   - Cada vuelo tiene una marca en el mapa (una diana de punto de control) y,
//     si tiene huella (content/vuelos/<slug>.huella.geojson), su contorno.
//
// CARGA. El modelo de un vuelo no existe hasta que hace falta: su
// TilesRenderer se crea cuando la capa está prendida Y el vuelo está elegido o
// su huella está en la vista (con MARGEN_VISTA alrededor) y mide al menos
// MODELO_PX de radio en pantalla. Todos los que cumplen cargan a la vez (hasta
// MODELOS_MAX): el LOD de 3d-tiles-renderer baja solo lo grueso de los
// lejanos, y la caché de teselas, una para todos, pone el techo de memoria. Se
// destruye (teselas, texturas, memoria de la GPU) al salir de la vista,
// achicarse o al apagar la capa (ver data/escena.js). Al abrir, con todos los
// vuelos en el cuadro, la escena baja el mapa, el terreno, las marcas y las
// huellas, y ni una tesela de modelo.
//
// HUELLAS. Mientras la capa del modelo de un vuelo está prendida, su huella
// hunde el terreno debajo de la malla y quita del mapa los edificios 3D y los
// nombres que chocan con ella; al apagarla el mapa vuelve a quedar intacto. Va
// con la capa y no con la carga del modelo a propósito: cambiar el terreno a
// mitad de un vuelo de cámara dejaba teselas sin hundir (medido el
// 24-sep-2026), y lejos del vuelo el hueco no se ve.
//
// Navegación como la de ArcGIS: arrastrar con el botón izquierdo mueve el mapa;
// el derecho gira e inclina alrededor del punto que está bajo el cursor; la
// rueda acerca hacia el cursor. Con los dedos: uno mueve, dos pellizcan, giran
// e inclinan (lo de MapLibre).
//
// ALTURAS: MapLibre pone el terreno a su altura ortométrica (SRTM, EGM96). Cada
// modelo viene en altura elipsoidal, así que se baja su `geoide` y se le suma su
// `ajuste`, el residuo medido contra este terreno. El control "Altura" cambia el
// ajuste del vuelo elegido en vivo, sin volver a pedir teselas.
//
// El componente es controlado: la página (components/sections/o2-explorador.js)
// guarda qué vuelo está elegido, cuál resaltado y qué capas de modelo están
// prendidas; la escena avisa por onElegir / onResaltar / onVisible, y expone
// irA(slug) y verTodos() en `controlRef`.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Layers, Map as IconoMapa, MoveVertical, Scan } from 'lucide-react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as THREE from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { TilesRenderer } from '3d-tiles-renderer/three'
import {
  GLTFExtensionsPlugin,
  TilesFadePlugin,
  UnloadTilesPlugin,
} from '3d-tiles-renderer/three/plugins'
import { PALETTE } from '../sections/o2-palette'
import {
  AJUSTE_ALTURA_M,
  AJUSTE_PASO_M,
  AJUSTE_RANGO_M,
  HUNDIR_M,
  MAPAS_BASE,
  MARGEN_SUELO_M,
  MARGEN_VISTA,
  MODELO_PX,
  MODELO_PX_SALE,
  MODELOS_MAX,
  MODELOS_MAX_TELEFONO,
  RADIO_SIN_HUELLA_M,
  RAMPA_M,
  TERRENO,
  VISTA_VUELO,
} from '../../data/escena'
import { ContadorBytesPlugin, ReintentoPlugin, hayWebGL } from './visor-comun'
import { anilloHuella, crearPesoHuellas, filtroFueraDeHuellas } from './escena-huella'
import { alturaTerrarium, escribirAltura, escribirPng, leerPng } from './terrarium-png'

const RAD = Math.PI / 180
const R_TIERRA = 6378137
const ID_TERRENO = 'terreno'
const ID_EDIFICIOS = 'edificios-3d'
const ID_RASTER = 'mapa-base'
const ID_HUELLAS = 'huellas-vuelos'
const PROTO_DEM = 'vuelo-dem'
const PROTO_CONTADO = 'vuelo-contado'
// Distancia de la cámara al centro de la vista: ni tan cerca que se meta en
// una malla, ni tan lejos que los vuelos se junten en un punto. El tope lejano
// tiene que dejar ver todos a la vez: con Ibagué y Cerinza hay unos 300 km de
// punta a punta, y con 250 km la vista inicial dejaba los dos fuera del cuadro.
const DISTANCIA_MIN_M = 20
const DISTANCIA_MAX_M = 600000
// Grados por píxel del giro con el botón derecho.
const GIRO_GRADOS_PX = 0.35
const INCLINACION_GRADOS_PX = 0.25
const INCLINACION_MAX = 85
// Metros alrededor de la huella en los que tampoco se dejan edificios 3D ni
// nombres: un nombre ocupa espacio y MapLibre lo dibuja encima de todo.
const MARGEN_EDIFICIOS_M = 1
const MARGEN_NOMBRES_M = 15
// Con el modelo a la vista y su huella midiendo en pantalla más de este radio
// en píxeles, la marca del vuelo se esconde: taparía justo lo que se vino a
// ver. En píxeles y no en metros: así vale igual en un teléfono que en un
// monitor, y para un vuelo chico que para uno grande.
const MARCA_OCULTA_PX = 70
// Dos marcas a menos de esto en pantalla se juntan en una (ver acomodarEtiquetas).
const AGRUPAR_PX = 30
// Cuánto tiene que durar la carga de un modelo para avisarla abajo.
const AVISO_CARGA_MS = 1200

// El worker de MapLibre se copia a public/maplibre/ en cada build
// (scripts/copiar-maplibre.js).
let workerListo = false
function prepararWorker() {
  if (workerListo) return
  maplibregl.setWorkerUrl(new URL('/maplibre/maplibre-gl-worker.mjs', window.location.href).href)
  workerListo = true
}

const CIELO = {
  'sky-color': PALETTE.paperPale,
  'horizon-color': PALETTE.paperWarm,
  'fog-color': PALETTE.paperWarm,
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.6,
  'fog-ground-blend': 0.85,
}

// El cielo y la niebla de un mapa base: los de papel del visor, o los suyos.
const cieloDe = (base) =>
  base.cielo
    ? {
        ...CIELO,
        'sky-color': base.cielo.cielo,
        'horizon-color': base.cielo.horizonte,
        'fog-color': base.cielo.niebla,
      }
    : CIELO

// Dónde van las mallas y lo que se añade: antes del bloque final de capas de
// nombres. No sirve el primer `symbol` a secas: en algunos estilos (dark) el
// nombre del agua va antes de los edificios y de las vías.
function antesDeLosNombres(capas) {
  let ultima = -1
  capas.forEach((l, i) => {
    if (l.type !== 'symbol' && l.type !== 'custom') ultima = i
  })
  return capas.findIndex((l, i) => i > ultima && l.type === 'symbol')
}

const CAPAS_INICIALES = { huellas: true, edificios: true, nombres: true, terreno: true, hundir: true }

// Los tres botones con ventanita. En el teléfono la columna queda en los
// íconos; el nombre sigue en el `title` y en el texto para el lector.
const PANELES = [
  { id: 'base', Icono: IconoMapa, nombre: 'Mapa base' },
  { id: 'capas', Icono: Layers, nombre: 'Capas' },
  { id: 'altura', Icono: MoveVertical, nombre: 'Altura' },
]

// El estilo de MapLibre de un mapa base del catálogo: la URL si es vectorial, y
// si es raster, un estilo mínimo con una sola capa. Una "imagen" pide el estilo
// de sus etiquetas; prepararEstilo le pone la imagen debajo y le deja solo los
// nombres.
function estiloDe(base) {
  if (base.tipo === 'vector') return base.url
  if (base.tipo === 'imagen') return base.etiquetas
  return {
    version: 8,
    sources: {
      [ID_RASTER]: { type: 'raster', tiles: [base.url], tileSize: 256, maxzoom: base.maxzoom ?? 18 },
    },
    layers: [{ id: ID_RASTER, type: 'raster', source: ID_RASTER }],
  }
}

const baseDe = (id) => MAPAS_BASE.find((b) => b.id === id) ?? MAPAS_BASE[0]

// Un decimal, sin el -0 que deja Math.round.
const redondear = (v) => Math.round(v / AJUSTE_PASO_M) / (1 / AJUSTE_PASO_M) + 0 || 0
const conComa = (v) => redondear(v).toFixed(1).replace('.', ',')

// Zoom de MapLibre al que la cámara queda a `d` metros del centro de la vista.
function zoomParaDistancia(d, lat, altoPx, fovGrados) {
  const aCentroPx = (0.5 * altoPx) / Math.tan((fovGrados / 2) * RAD)
  return Math.log2((40075016.686 * Math.cos(lat * RAD) * aCentroPx) / (512 * d))
}

const sinMovimiento = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Dónde está un vuelo y cuánto mide: el centro y el radio de su huella, o sus
// coordenadas y RADIO_SIN_HUELLA_M.
function encuadreDe(v, anillo) {
  if (!anillo) return { lon: v.lon, lat: v.lat, radio: RADIO_SIN_HUELLA_M }
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [lon, lat] of anillo) {
    x0 = Math.min(x0, lon); y0 = Math.min(y0, lat); x1 = Math.max(x1, lon); y1 = Math.max(y1, lat)
  }
  const lon = (x0 + x1) / 2, lat = (y0 + y1) / 2
  const kx = R_TIERRA * Math.cos(lat * RAD) * RAD, ky = R_TIERRA * RAD
  const radio = Math.max(...anillo.map(([a, b]) => Math.hypot((a - lon) * kx, (b - lat) * ky)), 60)
  return { lon, lat, radio }
}

// La marca de un vuelo: una diana de punto de control (el blanco de cuadrantes
// que se pinta en el piso para amarrar la fotogrametría) y el nombre al lado.
// Verde bosque si el vuelo tiene modelo, ocre si está en proceso. El estilo
// está en styles/globals.css (.marca-vuelo); aquí solo el marcado.
function crearMarca(v) {
  const el = document.createElement('div')
  el.className = 'marca-vuelo'
  el.dataset.modelo = v.escena ? 'si' : 'no'
  const boton = document.createElement('button')
  boton.type = 'button'
  // Fuera del orden de tabulación: con teclado, el camino es la lista del
  // panel, que tiene lo mismo y más. El clic con el ratón sí funciona.
  boton.tabIndex = -1
  boton.setAttribute('aria-label', `Ir al vuelo ${v.title}`)
  boton.className = 'marca-diana'
  boton.innerHTML =
    '<svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">' +
    '<circle cx="14" cy="14" r="12.25" class="marca-aro" />' +
    '<path d="M14 14V3.5A10.5 10.5 0 0 1 24.5 14Z" class="marca-cuadrante" />' +
    '<path d="M14 14v10.5A10.5 10.5 0 0 1 3.5 14Z" class="marca-cuadrante" />' +
    '</svg>'
  const etiqueta = document.createElement('span')
  etiqueta.className = 'marca-etiqueta'
  etiqueta.setAttribute('aria-hidden', 'true')
  etiqueta.textContent = v.title
  // Cuántos vuelos hay en la marca cuando agrupa varios (vacío si es uno).
  const cuenta = document.createElement('span')
  cuenta.className = 'marca-cuenta'
  cuenta.setAttribute('aria-hidden', 'true')
  el.append(boton, etiqueta, cuenta)
  return { el, boton, etiqueta, cuenta }
}

export default function EscenaVuelos({
  vuelos,
  seleccionado = null,
  resaltado = null,
  visibles = {},
  inicial = null,
  relleno = { left: 0, bottom: 0 },
  onElegir,
  onResaltar,
  onVisible,
  onCargando,
  controlRef,
  className = '',
}) {
  const contenedorRef = useRef(null)
  const [estado, setEstado] = useState(() => (hayWebGL() ? 'iniciando' : 'sin-webgl'))
  const [bajando, setBajando] = useState([])
  // El aviso "Cargando el modelo 3D" sale solo si la carga dura más de
  // AVISO_CARGA_MS: con todos los modelos a la vista, cada paso de la cámara
  // pide unas teselas más, y un aviso que parpadea con cada una no dice nada.
  const [cargaLenta, setCargaLenta] = useState(false)
  const hayCarga = bajando.length > 0
  useEffect(() => {
    const reloj = setTimeout(() => setCargaLenta(hayCarga), hayCarga ? AVISO_CARGA_MS : 0)
    return () => clearTimeout(reloj)
  }, [hayCarga])
  const [falla, setFalla] = useState('')
  const [tactil] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
  )
  const vuelosTxt = JSON.stringify(vuelos)

  // Lo que el mapa lee en cada cuadro sale de `prefsRef` (así un cambio no
  // vuelve a montar la escena); React lo pinta desde el estado y las props.
  const apiRef = useRef(null)
  const avisosRef = useRef({ onElegir, onResaltar, onCargando })
  const prefsRef = useRef({
    capas: CAPAS_INICIALES,
    base: MAPAS_BASE[0].id,
    ajustes: {},
    visibles,
    seleccionado,
    resaltado,
    relleno,
    inicial,
  })
  // Antes de los efectos que avisan a la escena: así, cuando corren, la escena
  // ya lee lo nuevo.
  useLayoutEffect(() => {
    avisosRef.current = { onElegir, onResaltar, onCargando }
    prefsRef.current = { ...prefsRef.current, visibles, seleccionado, resaltado, relleno }
  })
  const [ajustes, setAjustes] = useState({})
  // Lo escrito en la casilla del ajuste y el aviso de "copiado" valen para el
  // vuelo en que se escribieron; al cambiar de vuelo se muestran los suyos.
  const [escrito, setEscrito] = useState({ slug: null, txt: '' })
  const [capas, setCapas] = useState(CAPAS_INICIALES)
  const [base, setBase] = useState(MAPAS_BASE[0].id)
  const [disponibles, setDisponibles] = useState({ edificios: true, nombres: true })
  // Qué ventanita está abierta: null, 'base', 'capas' o 'altura'.
  const [panel, setPanel] = useState(null)
  const [posPanel, setPosPanel] = useState({ right: 56, top: 12, width: 288, maxHeight: 320 })
  const [colTop, setColTop] = useState(12)
  const [avisoDe, setAvisoDe] = useState({ slug: null, txt: '' })
  // En el teléfono, el pie de créditos abierto entero o en un renglón.
  const [creditos, setCreditos] = useState(false)
  const encuadreRef = useRef(null)
  const barraRef = useRef(null)
  const botonesRef = useRef({})
  const contenidoRef = useRef(null)
  const pieRef = useRef(null)
  const idPanel = useId()

  // La ventanita va a la izquierda de la columna, con su borde de arriba a la
  // altura del botón. Si no cabe hacia abajo sube lo que haga falta, y nunca
  // baja del pie de atribución: si ni así cabe, hace scroll por dentro.
  useLayoutEffect(() => {
    if (!panel) return
    const ubicar = () => {
      const raiz = encuadreRef.current
      const boton = botonesRef.current[panel]
      const barra = barraRef.current
      const contenido = contenidoRef.current
      if (!raiz || !boton || !barra || !contenido) return
      const r = raiz.getBoundingClientRect()
      const b = boton.getBoundingClientRect()
      const right = r.right - barra.getBoundingClientRect().left + 8
      const width = Math.max(0, Math.min(288, r.width - right - 12))
      const piso = pieRef.current ? pieRef.current.getBoundingClientRect().top : r.bottom
      const maxHeight = Math.max(80, piso - r.top - 8 - 12)
      const alto = Math.min(contenido.scrollHeight + 2, maxHeight) // +2: el borde
      const top = Math.max(12, Math.min(b.top - r.top, piso - r.top - 8 - alto))
      setPosPanel({ right, top, width, maxHeight: piso - r.top - 8 - top })
    }
    ubicar()
    window.addEventListener('resize', ubicar)
    const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(ubicar) : null
    if (contenidoRef.current) obs?.observe(contenidoRef.current.firstElementChild ?? contenidoRef.current)
    return () => {
      window.removeEventListener('resize', ubicar)
      obs?.disconnect()
    }
  }, [panel, relleno.bottom, relleno.left])

  useEffect(() => {
    const contenedor = contenedorRef.current
    if (!contenedor) return
    const lista = JSON.parse(vuelosTxt)
    let vivo = true
    const chica = Math.min(window.innerWidth, window.innerHeight) < 640
    // Tope de la caché de teselas (lo que ocupan en GPU según 3d-tiles-renderer).
    // Si se llena, el renderer RECHAZA teselas (stats.refused) y la vista se
    // queda en el nivel que alcanzó. El Tintal del OBJ (tintal/v1, hasta el
    // 26-sep-2026) era el que más pedía: sus hojas traían texturas de hasta
    // 1276x4096 y pesaban 30-45 MB cada una en GPU. Rehecho desde su SLPK, a
    // zoom 20 sobre sus bloques usa 210 MB. Los topes se midieron con el viejo,
    // el 25-sep-2026 con /?debug=1, a 250, 100 y 40 m en cinco puntos:
    // en escritorio (1440x900) usaba hasta 1,2 GB, y con 1 GB rechazó 26 teselas;
    // con 1,5 GB, ninguna. En teléfono (390x844) usa 0,7-0,9 GB y con 0,6 GB
    // rechazó 117, pero ahí se deja en 0,6: un rechazo deja la tesela padre a la
    // vista (se ve más gruesa, no hay hueco) y una pestaña de teléfono que se
    // pasa de memoria se cierra entera. navigator.deviceMemory (solo Chromium;
    // da 8 como máximo) baja el tope en equipos de 4 GB o menos.
    const memoria = navigator.deviceMemory ?? 8
    const cacheMb = chica ? 600 : memoria <= 4 ? 1024 : 1536
    const pref = () => prefsRef.current
    const visible = (slug) => pref().visibles[slug] !== false
    prepararWorker()

    // DEPURACIÓN (/?debug=1): un recuadro con el estado de las teselas de
    // cada vuelo activo y el tiempo de cada pedido. Con debug=1 también se
    // pueden probar los topes sin recompilar: &et= (errorTarget), &jobs=
    // (descargas simultáneas), &parse= (teselas decodificándose a la vez),
    // &lru= (MB de la caché de teselas), &unload= (ms que espera
    // UnloadTilesPlugin; -1 lo quita) y &reintento=0 (sin reintentos). Lo mismo
    // expone window.__escenaVuelos.estadoTeselas() y .pedidos() para Playwright.
    const qs = new URLSearchParams(window.location.search)
    const depuracion = qs.get('debug') === '1'
    const perilla = (k) => (depuracion && qs.has(k) && Number.isFinite(+qs.get(k)) ? +qs.get(k) : null)
    const pedidos = [] // los últimos 400 pedidos de teselas, con sus tiempos
    // Con debug=1, las últimas teselas de terreno hundidas (la original y la
    // recodificada), para comparar alturas: window.__escenaVuelos.teselasDem().
    const teselasDem = new Map()

    // Lo que lleva bajado la escena. No se muestra: lo leen las pruebas en
    // window.__escenaVuelos.bytes().
    let bytesTotal = 0
    const sumar = (n) => {
      bytesTotal += n
    }
    const traerContado = async (url, signal) => {
      const r = await fetch(url, { signal })
      if (!r.ok) throw new Error(`${r.status} ${url}`)
      const buf = await r.arrayBuffer()
      sumar(buf.byteLength)
      return buf
    }

    // ------------------------------------------------------- vuelos
    // Una entrada por vuelo. `tiles` es null mientras el modelo no hace falta.
    const vuelosEsc = lista.map((v) => {
      const anillo = anilloHuella(v.huella)
      const enc = encuadreDe(v, anillo)
      return {
        v,
        anillo,
        enc,
        centro: [enc.lon, enc.lat],
        tiles: null,
        quitar: null,
        origen: null,
        sueloBorde: v.escena?.sueloBorde ?? null,
        cargando: 0,
        previo: 0,
        creado: 0, // cuándo se creó su TilesRenderer (performance.now)
        primeraVisible: 0, // cuándo se vio la primera tesela
        rechazadas: 0, // suma de stats.refused: teselas que no cupieron en la caché
        fallas: [],
        scene: new THREE.Scene(),
        camara: new THREE.Camera(), // proyección = la de MapLibre por el marco local
        camaraTiles: new THREE.PerspectiveCamera(), // la de verdad, para el LOD
        marca: null,
        pantalla: null, // su centro en pantalla, de la última pasada de acomodarEtiquetas
        grupo: null, // los vuelos que agrupa su marca, si agrupa más de uno
      }
    })
    const porSlug = new Map(vuelosEsc.map((c) => [c.v.slug, c]))
    const conModelo = vuelosEsc.filter((c) => c.v.escena)
    const conHuella = vuelosEsc.filter((c) => c.anillo)
    const ajusteDe = (c) => pref().ajustes[c.v.slug] ?? c.v.escena?.ajuste ?? AJUSTE_ALTURA_M
    // Los vuelos cuya huella hunde el terreno y limpia el mapa: los que tienen
    // modelo y huella, con la capa prendida.
    const presentes = () => conModelo.filter((c) => c.anillo && visible(c.v.slug))

    // ------------------------------------------------------- protocolos
    // Todo lo que baja el mapa pasa por aquí para poder contarlo: los pedidos
    // del worker no se ven desde la página de otra forma.
    maplibregl.addProtocol(PROTO_CONTADO, async (params, abort) => {
      const url = params.url.slice(PROTO_CONTADO.length + 3)
      const buf = await traerContado(url, abort.signal)
      if (params.type === 'json') return { data: JSON.parse(new TextDecoder().decode(buf)) }
      return { data: buf }
    })

    // Terreno "modificado" bajo las mallas, como el de las mallas integradas
    // de ArcGIS: dentro de cada huella presente baja HUNDIR_M metros, con una
    // rampa de RAMPA_M hacia adentro; en el borde queda intacto. El primer
    // segmento de la URL dice qué huellas se hunden ("-" ninguna, o los slugs
    // unidos por "+"): así las versiones no se cruzan en la caché.
    const pesos = new Map()
    const pesoDeClave = (clave) => {
      if (clave === '-') return null
      if (!pesos.has(clave)) {
        const anillos = clave.split('+').map((s) => porSlug.get(s)?.anillo).filter(Boolean)
        pesos.set(clave, anillos.length ? crearPesoHuellas(anillos, RAMPA_M) : null)
      }
      return pesos.get(clave)
    }
    maplibregl.addProtocol(PROTO_DEM, async (params, abort) => {
      const [clave, zs, xs, ys] = params.url.slice(PROTO_DEM.length + 3).split('/')
      const [z, x, y] = [zs, xs, ys].map(Number)
      const url = TERRENO.url.replace('{z}', z).replace('{x}', x).replace('{y}', y)
      const buf = await traerContado(url, abort.signal)
      const peso = pesoDeClave(clave)
      // Por debajo de z12 un píxel mide más que una malla entera: no vale la pena.
      if (!peso || z < 12) return { data: buf }
      const n2 = 2 ** z
      const lonDe = (xx) => (xx / n2) * 360 - 180
      const latDe = (yy) => Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n2))) / RAD
      const toca = peso.cajas.some(
        ([a, b, c, d]) => !(lonDe(x + 1) < a || lonDe(x) > c || latDe(y) < b || latDe(y + 1) > d)
      )
      if (!toca) return { data: buf }
      // Los bytes del PNG se leen y se escriben en JS, sin lienzo: Brave
      // cambia píxeles al leer un canvas y cada uno salía como una columna de
      // 256 m (ver terrarium-png.js). Si el PNG no es de la clase que se sabe
      // leer, la tesela va sin hundir antes que con alturas dudosas.
      const png = leerPng(buf)
      if (!png) return { data: buf }
      const { W, H, rgb } = png
      // El peso sale de la longitud y la latitud del centro de cada píxel, no
      // de su posición en la tesela: dos teselas vecinas dan la misma rampa en
      // el borde común y no queda escalón.
      const lonA = lonDe(x), lonB = lonDe(x + 1)
      let cambios = 0
      for (let j = 0; j < H; j++) {
        const lat = latDe(y + (j + 0.5) / H)
        for (let i = 0; i < W; i++) {
          const w = peso.peso(lonA + ((i + 0.5) / W) * (lonB - lonA), lat)
          if (!w) continue
          const k = (j * W + i) * 3
          escribirAltura(rgb, k, alturaTerrarium(rgb, k) - HUNDIR_M * w)
          cambios++
        }
      }
      if (!cambios) return { data: buf }
      const data = escribirPng(png)
      if (depuracion) {
        teselasDem.set(`${clave}/${z}/${x}/${y}`, { original: buf, hundida: data })
        if (teselasDem.size > 40) teselasDem.delete(teselasDem.keys().next().value)
      }
      return { data }
    })

    // ------------------------------------------------------- estilo
    const claveHundir = () =>
      pref().capas.hundir
        ? presentes().map((c) => c.v.slug).sort().join('+') || '-'
        : '-'
    const claveFiltro = () => presentes().map((c) => c.v.slug).sort().join('+')
    const urlDem = () => `${PROTO_DEM}://${claveHundir()}/{z}/{x}/{y}`
    // La fuente del terreno cambia de id cada vez que cambia qué huellas se
    // hunden (ver refrescarHuellas): idTerreno es la que usa el terreno ahora.
    let idTerreno = ID_TERRENO
    let nTerreno = 0
    const terrenoActivo = () => ({ source: idTerreno, exaggeration: 1 })
    // El cambio de fuente en curso: { id, alListo, reloj }.
    let cambioTerreno = null
    const cancelarCambioTerreno = () => {
      if (!cambioTerreno) return
      const { id, alListo, reloj } = cambioTerreno
      cambioTerreno = null
      clearTimeout(reloj)
      map?.off('sourcedata', alListo)
      if (id !== idTerreno && map?.getSource(id)) {
        try {
          map.removeSource(id)
        } catch {
          // el estilo ya no la tiene
        }
      }
    }
    const fuenteDem = () => ({
      type: 'raster-dem',
      tiles: [urlDem()],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: TERRENO.maxZoom,
    })
    // Las capas que el estilo ya traía apagadas no se prenden con los botones,
    // y el filtro que traía cada capa se conserva debajo del de las huellas.
    let ocultasDelEstilo = new Set()
    const filtrosDelEstilo = new Map()
    const grupoDe = (l) =>
      l.type === 'fill-extrusion' ? 'edificios' : l.type === 'symbol' ? 'nombres' : null
    const filtroDe = (id, grupo) => {
      const orig = filtrosDelEstilo.get(id)
      const anillos = presentes().map((c) => c.anillo)
      if (!anillos.length) return orig ?? null
      const f = filtroFueraDeHuellas(anillos, grupo === 'nombres' ? MARGEN_NOMBRES_M : MARGEN_EDIFICIOS_M)
      return orig ? ['all', orig, f] : f
    }

    const colorHuella = (b) => ({
      tinta: b.oscuro ? PALETTE.paperPale : PALETTE.forest,
      acento: b.oscuro ? PALETTE.emeraldLight : '#0f5636',
    })
    const marcado = ['any', ['boolean', ['feature-state', 'sel'], false], ['boolean', ['feature-state', 'res'], false]]
    const datosHuellas = {
      type: 'FeatureCollection',
      features: conHuella.map((c) => ({
        type: 'Feature',
        properties: { slug: c.v.slug },
        geometry: { type: 'Polygon', coordinates: [c.anillo] },
      })),
    }

    // Todo lo que la escena le añade a un mapa base, aplicado sobre su estilo
    // antes de cargarlo: así cambiar de mapa no pierde el terreno, las huellas,
    // los filtros ni lo que se apagó.
    const prepararEstilo = (_previo, siguiente) => {
      const base = baseDe(pref().base)
      const capas = pref().capas
      const est = {
        ...siguiente,
        sources: { ...siguiente.sources },
        layers: siguiente.layers.map((l) => ({ ...l })),
        sky: cieloDe(base),
      }
      if (base.tipo === 'imagen') {
        // La imagen abajo y, encima, solo los nombres del estilo vectorial, en
        // blanco con halo oscuro para que se lean sobre la foto. Sin los puntos
        // de interés (sus íconos llenaban la foto de paraderos), sin las
        // flechas de sentido vial y sin los escudos de las vías, cuyo número
        // en blanco quedaba ilegible sobre el escudo blanco.
        est.sources[ID_RASTER] = { type: 'raster', tiles: [base.url], tileSize: 256, maxzoom: base.maxzoom ?? 18 }
        est.layers = [
          { id: ID_RASTER, type: 'raster', source: ID_RASTER },
          ...est.layers
            .filter((l) => l.type === 'symbol' && l['source-layer'] !== 'poi' && !/shield|one_way/.test(l.id))
            .map((l) => ({
              ...l,
              paint: { ...l.paint, 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 1.4 },
            })),
        ]
      }
      cancelarCambioTerreno()
      est.sources[idTerreno] = fuenteDem()
      if (capas.terreno) est.terrain = terrenoActivo()
      else delete est.terrain
      ocultasDelEstilo = new Set(
        est.layers.filter((l) => l.layout?.visibility === 'none').map((l) => l.id)
      )
      const fuenteVectorial = Object.entries(est.sources).find(([, s]) => s.type === 'vector')?.[0]
      if (base.edificios3d && fuenteVectorial && !est.layers.some((l) => l.type === 'fill-extrusion')) {
        const i = antesDeLosNombres(est.layers)
        est.layers.splice(i < 0 ? est.layers.length : i, 0, {
          id: ID_EDIFICIOS,
          type: 'fill-extrusion',
          source: fuenteVectorial,
          'source-layer': 'building',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': base.colorEdificios ?? PALETTE.paper,
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.9,
          },
        })
      }
      filtrosDelEstilo.clear()
      for (const l of est.layers) {
        const grupo = grupoDe(l)
        if (!grupo) continue
        // Los edificios 3D del mapa que tocan una malla la atraviesan, y los
        // nombres de adentro quedan flotando encima de las fotos.
        if (l.filter) filtrosDelEstilo.set(l.id, l.filter)
        const f = filtroDe(l.id, grupo)
        if (f) l.filter = f
        else delete l.filter
        if (!capas[grupo]) l.layout = { ...l.layout, visibility: 'none' }
      }
      // Las huellas, sobre el terreno y debajo de los nombres.
      if (conHuella.length) {
        const { tinta, acento } = colorHuella(base)
        est.sources[ID_HUELLAS] = { type: 'geojson', data: datosHuellas, promoteId: 'slug' }
        const vis = capas.huellas ? 'visible' : 'none'
        const i = antesDeLosNombres(est.layers)
        // Solo el contorno, sin relleno: con terreno, MapLibre pinta las capas
        // planas sobre el terreno después de las mallas, y un relleno, por
        // transparente que sea, lavaba los colores del modelo (medido el
        // 24-sep-2026).
        est.layers.splice(i < 0 ? est.layers.length : i, 0, {
          id: `${ID_HUELLAS}-linea`,
          type: 'line',
          source: ID_HUELLAS,
          layout: { visibility: vis, 'line-join': 'round' },
          paint: {
            'line-color': ['case', marcado, acento, tinta],
            'line-width': ['case', marcado, 3, 1.5],
            'line-opacity': 0.9,
          },
        })
      }
      return est
    }

    // ------------------------------------------------------- mapa
    let map
    try {
      map = new maplibregl.Map({
        container: contenedor,
        center: [-74.1, 4.65],
        zoom: 9,
        maxPitch: INCLINACION_MAX,
        // 1,5 y no más: el mapa, el terreno y las mallas llenan la pantalla de
        // fragmentos, y en un teléfono de densidad 3 el costo se nota más que
        // la nitidez.
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
        canvasContextAttributes: { antialias: true },
        attributionControl: false, // la atribución va en el pie, siempre visible
        renderWorldCopies: false,
        dragRotate: false, // el giro con el botón derecho es el de abajo
        transformRequest: (url) =>
          /^https?:\/\//.test(url) ? { url: `${PROTO_CONTADO}://${url}` } : { url },
        locale: {
          'Map.Title': 'Mapa 3D de los vuelos',
          'NavigationControl.ResetBearing': 'Mirar al norte',
          'NavigationControl.ZoomIn': 'Acercar',
          'NavigationControl.ZoomOut': 'Alejar',
        },
      })
    } catch {
      maplibregl.removeProtocol(PROTO_CONTADO)
      maplibregl.removeProtocol(PROTO_DEM)
      Promise.resolve().then(() => vivo && setEstado('sin-webgl'))
      return
    }
    map.setPadding({ top: 0, right: 0, left: pref().relleno.left, bottom: pref().relleno.bottom })
    map.setStyle(estiloDe(baseDe(pref().base)), { transformStyle: prepararEstilo, diff: false })
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true, showZoom: !tactil }),
      'top-right'
    )
    map.dragPan.enable({ linearity: 0.3, deceleration: 2500, maxSpeed: 1400 })
    map.touchZoomRotate.enable()
    map.touchPitch.enable()
    map.keyboard.enable()

    // La columna de botones va debajo de la navegación de MapLibre.
    const ctrl = contenedor.querySelector('.maplibregl-ctrl-top-right')
    if (ctrl) setColTop(ctrl.getBoundingClientRect().bottom - contenedor.getBoundingClientRect().top + 8)

    // MapLibre 6 ya no expone `map.transform`: la posición de la cámara sale
    // del transform interno de su Camera (solo lectura).
    const transform = () => map._camera?.transform ?? map.transform
    const fovV = () => map.getVerticalFieldOfView?.() ?? 36.87

    const limitarZoom = () => {
      const lat = map.getCenter().lat
      const alto = contenedor.clientHeight || 480
      map.setMinZoom(Math.max(0, zoomParaDistancia(DISTANCIA_MAX_M, lat, alto, fovV())))
      map.setMaxZoom(Math.min(24, zoomParaDistancia(DISTANCIA_MIN_M, lat, alto, fovV())))
    }

    // Distancia en metros de la cámara al centro de un vuelo.
    const distanciaA = (c) => {
      const t = transform()
      const cam = t.getCameraLngLat()
      const [lon, lat] = c.centro
      const kx = R_TIERRA * Math.cos(lat * RAD) * RAD
      const suelo = c.origen?.alt ?? map.queryTerrainElevation([lon, lat]) ?? 0
      return Math.hypot((cam.lng - lon) * kx, (cam.lat - lat) * R_TIERRA * RAD, t.getCameraAltitude() - suelo)
    }

    // El centro de un vuelo en pantalla y el radio de su huella en píxeles.
    const enPantalla = (c) => {
      const p = map.project(c.centro)
      const kx = R_TIERRA * Math.cos(c.enc.lat * RAD) * RAD
      const borde = map.project([c.enc.lon + c.enc.radio / kx, c.enc.lat])
      return { p, r: Math.hypot(borde.x - p.x, borde.y - p.y) }
    }
    // Cuánto de la vista llena la huella de un vuelo: el área de su polígono
    // en pantalla, recortado a la parte del mapa que el panel no tapa, sobre el
    // área de esa parte. Sin huella, el círculo de encuadreDe como un polígono
    // de 16 lados. Con el círculo circunscrito en vez del área, el Humedal El
    // Burro contaba como 40 % de la vista del Tintal con apenas su borde
    // asomado (medido el 25-sep-2026). Con `margen`, el rectángulo crece esa
    // fracción de su ancho y de su alto hacia cada lado: más de 0 quiere decir
    // "en la vista o cerca".
    const fraccionEnVista = (c, margen = 0) => {
      const { left, bottom } = pref().relleno
      let x0 = left, x1 = contenedor.clientWidth, y0 = 0, y1 = contenedor.clientHeight - bottom
      if (x1 <= x0 || y1 <= y0) return 0
      const mx = (x1 - x0) * margen, my = (y1 - y0) * margen
      x0 -= mx
      x1 += mx
      y0 -= my
      y1 += my
      let anillo = c.anillo
      if (!anillo) {
        const kx = R_TIERRA * Math.cos(c.enc.lat * RAD) * RAD, ky = R_TIERRA * RAD
        anillo = Array.from({ length: 16 }, (_, i) => [
          c.enc.lon + (c.enc.radio * Math.cos((i * Math.PI) / 8)) / kx,
          c.enc.lat + (c.enc.radio * Math.sin((i * Math.PI) / 8)) / ky,
        ])
      }
      let poli = anillo.map((pt) => {
        const q = map.project(pt)
        return [q.x, q.y]
      })
      if (poli.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return 0
      // Sutherland-Hodgman contra los cuatro lados del rectángulo.
      const recortar = (dentro, corte) => {
        const out = []
        for (let i = 0; i < poli.length; i++) {
          const a = poli[i], b = poli[(i + 1) % poli.length]
          const ia = dentro(a), ib = dentro(b)
          if (ia) out.push(a)
          if (ia !== ib) out.push(corte(a, b))
        }
        poli = out
      }
      const enX = (x) => (a, b) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])]
      const enY = (y) => (a, b) => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y]
      recortar((p) => p[0] >= x0, enX(x0))
      if (poli.length) recortar((p) => p[0] <= x1, enX(x1))
      if (poli.length) recortar((p) => p[1] >= y0, enY(y0))
      if (poli.length) recortar((p) => p[1] <= y1, enY(y1))
      if (poli.length < 3) return 0
      let area = 0
      for (let i = 0; i < poli.length; i++) {
        const a = poli[i], b = poli[(i + 1) % poli.length]
        area += a[0] * b[1] - b[0] * a[1]
      }
      return Math.abs(area) / 2 / ((x1 - x0) * (y1 - y0))
    }

    // ------------------------------------------------------- modelos
    let renderer = null
    let ktx2 = null
    const L = new THREE.Matrix4()
    const P = new THREE.Matrix4(), Pinv = new THREE.Matrix4(), V = new THREE.Matrix4()
    const S = new THREE.Matrix4(), tmp = new THREE.Vector3()

    // Qué vuelos están bajando su modelo: la marca de cada uno lo muestra con
    // un aro que gira, y la página, en su tarjeta. Solo hasta que se ve la
    // primera tesela: después, el detalle que llega al mover la cámara no se
    // avisa. Con todos los modelos a la vista, avisarlo hacía parpadear las
    // tarjetas con cada paso.
    let ultimosBajando = ''
    const actualizarBajando = () => {
      const slugs = conModelo
        .filter((c) => c.tiles && (!c.origen || (c.cargando > 0 && !c.primeraVisible)))
        .map((c) => c.v.slug)
      for (const c of conModelo) if (c.marca) c.marca.el.dataset.cargando = slugs.includes(c.v.slug) ? 'si' : 'no'
      const clave = slugs.join('+')
      if (clave === ultimosBajando || !vivo) return
      ultimosBajando = clave
      setBajando(slugs)
      avisosRef.current.onCargando?.(slugs)
    }

    // La inclinación de un modelo (escena.inclinacion del JSON; ver
    // content/vuelos/README.md, "Inclinación"): una malla sin puntos de
    // control puede quedar ladeada contra el terreno, y una sola altura no la
    // asienta en los dos extremos. `este` y `norte` dicen cuánto sube la
    // malla respecto del terreno por cada metro hacia allá; se gira alrededor
    // de la altura de su suelo (z_pivote, en el marco local) hasta que ese
    // plano quede horizontal: una rotación y no un corte, para que las paredes
    // sigan verticales. Es la misma cuenta que georref-tileset.mjs le aplicó al
    // Tintal al georreferenciarlo, pero aquí va sin tocar las teselas.
    const RI = new THREE.Matrix4(), TI = new THREE.Matrix4()
    const inclinar = (c) => {
      if (!c.tiles || !c.enuInv) return
      const inc = c.inclinacionPrueba ?? c.v.escena?.inclinacion
      c.tiles.group.matrix.copy(c.enuInv)
      if (inc && (inc.este || inc.norte)) {
        const n = new THREE.Vector3(-inc.este, -inc.norte, 1).normalize()
        RI.makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 0, 1)))
        const zp = inc.z_pivote ?? 0
        c.tiles.group.matrix.premultiply(TI.makeTranslation(0, 0, -zp)).premultiply(RI).premultiply(TI.makeTranslation(0, 0, zp))
      }
      c.tiles.group.updateMatrixWorld(true)
      map.triggerRepaint()
    }

    // La altura del ancla de un modelo: lo único que mueven el ajuste y el
    // interruptor del terreno. render() la lee en cada cuadro.
    const recolocar = (c) => {
      if (!c.origen) return
      // Con el terreno apagado desde el inicio, sin suelo_borde_m en el JSON no hay cuándo
      // medirlo, y sin esto el modelo quedaba flotando a su altura real.
      if (!pref().capas.terreno) c.sueloBorde = c.sueloBorde ?? medirSuelo(c)
      // MARGEN_SUELO_M: todos un poco arriba, para que el borde no se entierre
      // donde el DEM de 30 m queda más alto que la calle (ver data/escena.js).
      c.origen.alt = c.origen.altBase + ajusteDe(c) + MARGEN_SUELO_M - (pref().capas.terreno ? 0 : c.sueloBorde ?? 0)
      map.triggerRepaint()
    }

    // Mediana del terreno en los vértices de la huella (ahí el hundimiento
    // vale 0) o, sin huella, en el centro. Si el terreno todavía no bajó,
    // queda el punto más bajo de la malla.
    const medirSuelo = (c) => {
      const puntos = c.anillo ? c.anillo.slice(0, -1) : [c.centro]
      const zs = puntos
        .map((pt) => map.queryTerrainElevation(pt))
        .filter((z) => Number.isFinite(z))
        .sort((a, b) => a - b)
      if (zs.length) return zs[Math.floor(zs.length / 2)]
      if (!c.origen || !c.tiles) return null
      const caja = new THREE.Box3().setFromObject(c.tiles.group)
      return caja.isEmpty() ? null : c.origen.altBase + ajusteDe(c) + caja.min.z
    }

    // Crea el renderer de teselas de un vuelo. Mismos topes que VisorTiles.
    const activar = (c) => {
      if (c.tiles || !renderer) return
      const tiles = new TilesRenderer(c.v.escena.tileset)
      tiles.errorTarget = perilla('et') ?? (chica ? 32 : 24)
      // La caché es una sola para todos los vuelos (la de 3d-tiles-renderer por
      // defecto): sobre Bogotá están vivos los cinco modelos de la ciudad y
      // reparten el mismo tope, así que la memoria no crece con el número de
      // modelos. Lo lejano pide poco: el LOD se queda en sus teselas gruesas.
      tiles.lruCache.maxBytesSize = (perilla('lru') ?? cacheMb) * 2 ** 20
      tiles.lruCache.minBytesSize = tiles.lruCache.maxBytesSize * 0.75
      if (perilla('jobs')) tiles.downloadQueue.maxJobsPerOrigin = perilla('jobs')
      if (perilla('parse')) tiles.parseQueue.maxJobs = perilla('parse')
      c.creado = performance.now()
      c.primeraVisible = 0
      c.rechazadas = 0
      c.fallas = []
      tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: 250 }))
      if (perilla('reintento') !== 0) tiles.registerPlugin(new ReintentoPlugin({ alReintentar: () => map.triggerRepaint() }))
      if (perilla('unload') !== -1) tiles.registerPlugin(new UnloadTilesPlugin({ delay: perilla('unload') ?? 0 }))
      c.previo = 0
      tiles.registerPlugin(
        new ContadorBytesPlugin(
          (total) => {
            sumar(total - c.previo)
            c.previo = total
          },
          depuracion
            ? (p) => {
                pedidos.push({ slug: c.v.slug, ...p })
                if (pedidos.length > 3000) pedidos.shift()
              }
            : null
        )
      )
      tiles.registerPlugin(
        new GLTFExtensionsPlugin({ rtc: true, ktxLoader: ktx2, meshoptDecoder: MeshoptDecoder, autoDispose: true })
      )
      tiles.group.matrixAutoUpdate = false
      tiles.setCamera(c.camaraTiles)
      c.scene.add(tiles.group)

      // Fotogrametría: el color de la textura tal cual, sin luces (las sombras
      // ya vienen horneadas).
      const alCargarModelo = ({ scene: s }) => {
        s.traverse((o) => {
          if (o.isMesh) {
            const m = o.material
            o.material = new THREE.MeshBasicMaterial({ map: m.map, side: THREE.FrontSide })
            m.dispose()
          }
        })
        map.triggerRepaint()
      }
      const alEmpezar = () => {
        c.cargando++
        actualizarBajando()
      }
      const alTerminar = () => {
        c.cargando = Math.max(0, c.cargando - 1)
        actualizarBajando()
        map.triggerRepaint()
      }
      // Las que fallan se reintentan solas (ReintentoPlugin, más arriba).
      const alError = (e) => {
        if (c.fallas.length < 50) c.fallas.push({ url: String(e.url ?? ''), error: String(e.error?.message ?? e.error) })
        if (!e.tile && vivo) setFalla(`No pude cargar el modelo de ${c.v.title}.`)
      }
      // Cuando llega el tileset raíz se sabe dónde queda el modelo: se arma el
      // marco local (metros este, norte, arriba) en su centro.
      const alCargarRaiz = () => {
        // Las teselas vacías de arriba (sin contenido, solo cajas) se abren
        // siempre. Los tilesets de slpk_a_tiles.mjs traen una raíz vacía con
        // geometricError propio, y en una vista chica (800x500, o un teléfono)
        // a 1,5 km el error en pantalla quedaba bajo el tope: el renderer se
        // quedaba en la raíz y no dibujaba nada, con el terreno ya hundido.
        for (let t = tiles.root; t && !t.content?.uri && t.children?.length; t = t.children.length === 1 ? t.children[0] : null) {
          t.geometricError = 1e6
        }
        const esfera = new THREE.Sphere()
        if (!tiles.getBoundingSphere(esfera)) return
        const cart = {}
        tiles.ellipsoid.getPositionToCartographic(esfera.center, cart)
        const enu = new THREE.Matrix4()
        tiles.ellipsoid.getEastNorthUpFrame(cart.lat, cart.lon, cart.height, enu)
        c.enuInv = enu.clone().invert()
        inclinar(c)
        const aviso = `No pude cargar el modelo de ${c.v.title}.`
        if (vivo) setFalla((f) => (f === aviso ? '' : f))
        c.origen = {
          lon: cart.lon / RAD,
          lat: cart.lat / RAD,
          altBase: cart.height - c.v.escena.geoide,
          alt: 0,
        }
        recolocar(c)
        actualizarBajando()
      }
      tiles.addEventListener('load-model', alCargarModelo)
      tiles.addEventListener('tiles-load-start', alEmpezar)
      tiles.addEventListener('tiles-load-end', alTerminar)
      tiles.addEventListener('load-error', alError)
      tiles.addEventListener('load-root-tileset', alCargarRaiz)
      c.quitar = () => {
        tiles.removeEventListener('load-model', alCargarModelo)
        tiles.removeEventListener('tiles-load-start', alEmpezar)
        tiles.removeEventListener('tiles-load-end', alTerminar)
        tiles.removeEventListener('load-error', alError)
        tiles.removeEventListener('load-root-tileset', alCargarRaiz)
      }
      c.tiles = tiles
      actualizarBajando()
      map.triggerRepaint()
    }

    // tiles.dispose() libera geometrías, materiales y texturas de cada tesela
    // y aborta las descargas en curso.
    const desactivar = (c) => {
      if (!c.tiles) return
      c.quitar?.()
      c.scene.remove(c.tiles.group)
      c.tiles.dispose()
      c.tiles = null
      c.cargando = 0
      actualizarBajando()
    }

    // Lo que depende de qué capas de modelo están prendidas: el hundimiento
    // del terreno y los filtros del mapa. Se recalcula solo si cambió.
    let ultimaDem = claveHundir()
    let ultimoFiltro = claveFiltro()
    const intentar = (f) => {
      try {
        f()
      } catch {
        // estilo a medio cargar: lo recoge prepararEstilo
      }
    }
    const aplicarFiltros = () => {
      for (const l of map.getStyle()?.layers ?? []) {
        const grupo = grupoDe(l)
        if (grupo) intentar(() => map.setFilter(l.id, filtroDe(l.id, grupo)))
      }
    }
    // El terreno con otras huellas hundidas. Con el terreno puesto, setTiles
    // solo no basta: el terreno guarda sus propias texturas del DEM y algunas
    // quedaban con el relieve viejo. Quitarlo y volver a ponerlo sí sirve, pero
    // setTerrain recarga la fuente desde cero y el relieve se aplana un momento:
    // el parpadeo al prender o apagar un modelo. Así que se arma una fuente
    // nueva al lado, se deja bajar sus teselas marcándola como del terreno (lo
    // mismo que hace MapLibre al ponerla; es interno de su TileManager) y solo
    // cuando tiene todo se cambia el terreno a ella, sin pasar por null, y se
    // quita la vieja. Si esa parte interna no está, queda lo de antes.
    const cambiarTerreno = () => {
      cancelarCambioTerreno()
      if (!map.getTerrain()) {
        intentar(() => map.getSource(idTerreno)?.setTiles([urlDem()]))
        return
      }
      const id = `${ID_TERRENO}-${++nTerreno}`
      const cambiar = () => {
        if (cambioTerreno?.id !== id) return
        const viejo = idTerreno
        idTerreno = id
        cancelarCambioTerreno()
        intentar(() => {
          map.setTerrain(terrenoActivo())
          map.removeSource(viejo)
        })
      }
      intentar(() => map.addSource(id, fuenteDem()))
      const tm = map.style?.tileManagers?.[id]
      if (typeof tm?.update !== 'function') {
        intentar(() => {
          map.setTerrain(null)
          if (map.getSource(id)) map.removeSource(id)
          map.getSource(idTerreno)?.setTiles([urlDem()])
          map.setTerrain(terrenoActivo())
        })
        return
      }
      tm.usedForTerrain = true
      tm.tileSize = 256 * 2 // el de TerrainTileManager: tileSize * 2^deltaZoom
      const alListo = (e) => {
        if (e.sourceId === id && map.isSourceLoaded(id)) cambiar()
      }
      // Si en 5 s no terminó (sin red, una tesela que no llega), se cambia igual.
      cambioTerreno = { id, alListo, reloj: setTimeout(cambiar, 5000) }
      map.on('sourcedata', alListo)
      map.triggerRepaint()
    }

    const refrescarHuellas = () => {
      const dem = claveHundir()
      if (dem !== ultimaDem) {
        ultimaDem = dem
        cambiarTerreno()
      }
      const fil = claveFiltro()
      if (fil !== ultimoFiltro) {
        ultimoFiltro = fil
        aplicarFiltros()
      }
    }

    // Qué modelos tienen que existir: el elegido y todos los que están en la
    // vista (o cerca) sin ser un punto, MODELOS_MAX como mucho (ver
    // data/escena.js). Si sobran, quedan los más grandes en pantalla; los que
    // ya están vivos cuentan un poco más al ordenar, para que dos vuelos de
    // tamaño parecido no se turnen el último cupo.
    const maxModelos = chica ? MODELOS_MAX_TELEFONO : MODELOS_MAX
    let picoModelos = 0 // para las pruebas: el mayor número de modelos vivos a la vez
    const revisarCercania = () => {
      if (!renderer) return
      const sel = pref().seleccionado
      const quieren = []
      for (const c of conModelo) {
        if (!visible(c.v.slug)) {
          desactivar(c)
          continue
        }
        if (c.v.slug === sel) {
          quieren.push([c, Infinity])
          continue
        }
        const { r } = enPantalla(c)
        const grande = Number.isFinite(r) && r >= (c.tiles ? MODELO_PX_SALE : MODELO_PX)
        if (grande && fraccionEnVista(c, MARGEN_VISTA) > 0) quieren.push([c, c.tiles ? r * 1.25 : r])
        else desactivar(c)
      }
      quieren.sort((a, b) => b[1] - a[1])
      quieren.forEach(([c], i) => (i < maxModelos ? activar(c) : desactivar(c)))
      picoModelos = Math.max(picoModelos, conModelo.filter((c) => c.tiles).length)
    }

    // Una capa `custom` por vuelo con modelo. Vuelve a entrar cada vez que un
    // cambio de mapa base reconstruye el estilo: el renderer se crea una sola
    // vez, sobre el mismo contexto WebGL, y las teselas ya cargadas siguen ahí.
    const capaDe = (c) => ({
      id: `vuelo-3dtiles-${c.v.slug}`,
      type: 'custom',
      renderingMode: '3d',
      onAdd(m, gl) {
        if (renderer) return
        renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true })
        renderer.autoClear = false
        ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer)
        Promise.resolve().then(() => vivo && revisarCercania())
      },
      render(gl, args) {
        const tiles = c.tiles
        if (!tiles || !visible(c.v.slug)) return
        if (!c.origen) {
          tiles.update() // para que llegue el tileset raíz
          return
        }
        // Marco local: metros ENU con origen en el centro del modelo, a su
        // altura ortométrica. Mercator tiene Y hacia el sur: de ahí el -s.
        const mc = maplibregl.MercatorCoordinate.fromLngLat([c.origen.lon, c.origen.lat], c.origen.alt)
        const s = mc.meterInMercatorCoordinateUnits()
        L.makeTranslation(mc.x, mc.y, mc.z).scale(tmp.set(s, -s, s))
        c.camara.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(L)
        c.camara.projectionMatrixInverse.copy(c.camara.projectionMatrix).invert()

        // Cámara para 3d-tiles-renderer: separar proyección y vista, y quitar
        // de la vista la escala píxeles/metro para que el LOD cuente en metros.
        const ct = c.camaraTiles
        P.fromArray(args.projectionMatrix)
        Pinv.copy(P).invert()
        V.multiplyMatrices(Pinv, c.camara.projectionMatrix)
        const k = tmp.setFromMatrixColumn(V, 0).length()
        S.makeScale(1 / k, 1 / k, 1 / k)
        V.premultiply(S)
        S.makeScale(k, k, k)
        ct.projectionMatrix.multiplyMatrices(P, S)
        for (let i = 0; i < 16; i++) ct.projectionMatrix.elements[i] /= k
        ct.projectionMatrixInverse.copy(ct.projectionMatrix).invert()
        ct.matrixWorldInverse.copy(V)
        ct.matrixWorld.copy(V).invert()
        ct.matrixWorld.decompose(ct.position, ct.quaternion, ct.scale)

        // Resolución en píxeles CSS: en una pantalla retina, contar píxeles
        // físicos pediría más del doble de teselas sin que se note.
        const pr = map.getPixelRatio()
        tiles.setResolution(ct, gl.drawingBufferWidth / pr, gl.drawingBufferHeight / pr)
        tiles.update()
        c.rechazadas += tiles.stats.refused || 0
        if (!c.primeraVisible && tiles.visibleTiles.size) {
          c.primeraVisible = performance.now()
          actualizarBajando()
        }
        renderer.resetState()
        renderer.render(c.scene, c.camara)
        const st = tiles.stats
        if (st && (st.downloading || st.parsing || tiles.loadProgress < 1)) map.triggerRepaint()
      },
      // Nada que soltar aquí: la capa sale del estilo en cada cambio de mapa
      // base y vuelve a entrar. Las teselas se liberan en desactivar().
      onRemove() {},
    })
    const capasCustom = conModelo.map((c) => [c, capaDe(c)])

    // Las teselas que terminan de bajar con el mapa quieto necesitan un cuadro.
    const repintar = setInterval(() => {
      if (conModelo.some((c) => c.tiles?.stats && (c.tiles.stats.downloading || c.tiles.stats.parsing))) {
        map.triggerRepaint()
      }
    }, 250)

    // ------------------------------------------------------- marcas
    for (const c of vuelosEsc) {
      const m = crearMarca(c.v)
      m.boton.addEventListener('click', (ev) => {
        ev.stopPropagation()
        if (c.grupo) acercarA(c.grupo)
        else avisosRef.current.onElegir?.(c.v.slug)
      })
      // Solo con ratón: un toque también dispara `mouseenter`, y el resaltado
      // se quedaba pegado en la marca que había quedado bajo el dedo.
      m.el.addEventListener('pointerenter', (ev) => {
        if (ev.pointerType === 'mouse') avisosRef.current.onResaltar?.(c.v.slug)
      })
      m.el.addEventListener('pointerleave', (ev) => {
        if (ev.pointerType === 'mouse') avisosRef.current.onResaltar?.(null)
      })
      c.marca = { ...m, marker: new maplibregl.Marker({ element: m.el, anchor: 'center' }).setLngLat(c.centro).addTo(map) }
    }

    // Las marcas no se pisan. Primero se agrupan: las que caen a menos de
    // AGRUPAR_PX en pantalla (en la vista inicial, los cuatro vuelos de
    // Kennedy, a menos de 3 km entre sí) quedan en una sola, la del primero en
    // orden, con el número de vuelos; un clic en ella acerca hasta que se
    // separan. Después los nombres, en orden (el elegido, el resaltado, los que
    // tienen modelo, el resto): a la derecha de la diana y si no cabe a la
    // izquierda; si tampoco, el nombre se esconde y queda la diana. Una marca
    // fuera de la vista no pone nombre: se asomaba recortado en el borde. Una
    // pasada por cuadro como mucho.
    let pendienteEtiquetas = 0
    const anchos = new Map() // ancho del nombre en píxeles, por texto
    const acomodarEtiquetas = () => {
      pendienteEtiquetas = 0
      const { seleccionado: sel, resaltado: res } = pref()
      const rango = (c) => (c.v.slug === sel ? 0 : c.v.slug === res ? 1 : c.v.escena ? 2 : 3)
      const orden = [...vuelosEsc].sort((a, b) => rango(a) - rango(b))
      const w = contenedor.clientWidth, h = contenedor.clientHeight
      const grupos = []
      for (const c of orden) {
        const { p, r } = enPantalla(c)
        c.pantalla = p
        c.grupo = null
        const oculta = !!(c.tiles && visible(c.v.slug)) && r > MARCA_OCULTA_PX
        c.marca.el.dataset.oculta = oculta ? 'si' : 'no'
        if (oculta) {
          c.marca.el.dataset.grupo = 'no'
          c.marca.el.dataset.agrupada = 'no'
          continue
        }
        const g = grupos.find((q) => Math.hypot(q.p.x - p.x, q.p.y - p.y) < AGRUPAR_PX)
        if (g) g.miembros.push(c)
        else grupos.push({ p, miembros: [c] })
      }
      const puestas = []
      const choca = (q) => puestas.some((o) => q.x0 < o.x1 && q.x1 > o.x0 && q.y0 < o.y1 && q.y1 > o.y0)
      for (const { p, miembros } of grupos) {
        const [lider, ...resto] = miembros
        for (const c of resto) c.marca.el.dataset.agrupada = 'si'
        const { el, etiqueta, boton, cuenta } = lider.marca
        el.dataset.agrupada = 'no'
        const n = miembros.length
        lider.grupo = n > 1 ? miembros : null
        const texto = n > 1 ? `${n} vuelos` : lider.v.title
        if (etiqueta.textContent !== texto) etiqueta.textContent = texto
        cuenta.textContent = n > 1 ? String(n) : ''
        el.dataset.grupo = n > 1 ? 'si' : 'no'
        boton.setAttribute(
          'aria-label',
          n > 1 ? `Acercar a ${n} vuelos: ${miembros.map((c) => c.v.title).join(', ')}` : `Ir al vuelo ${lider.v.title}`
        )
        if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) {
          el.dataset.etiqueta = 'fuera'
          continue
        }
        if (!anchos.has(texto)) anchos.set(texto, etiqueta.offsetWidth || 120)
        const ancho = anchos.get(texto)
        const diana = { x0: p.x - 13, x1: p.x + 13, y0: p.y - 13, y1: p.y + 13 }
        const der = { x0: p.x + 15, x1: p.x + 21 + ancho, y0: p.y - 13, y1: p.y + 13 }
        const izq = { x0: p.x - 21 - ancho, x1: p.x - 15, y0: p.y - 13, y1: p.y + 13 }
        let lado = 'oculta'
        if (!choca(der) && der.x1 < w) lado = 'der'
        else if (!choca(izq) && izq.x0 > 0) lado = 'izq'
        el.dataset.etiqueta = lado
        puestas.push(diana)
        if (lado === 'der') puestas.push(der)
        if (lado === 'izq') puestas.push(izq)
      }
    }
    const pedirEtiquetas = () => {
      if (!pendienteEtiquetas) pendienteEtiquetas = requestAnimationFrame(acomodarEtiquetas)
    }

    const marcar = () => {
      const { seleccionado: sel, resaltado: res } = pref()
      for (const c of vuelosEsc) {
        c.marca.el.dataset.sel = c.v.slug === sel ? 'si' : 'no'
        c.marca.el.dataset.res = c.v.slug === res ? 'si' : 'no'
        // El elegido, encima de los demás.
        c.marca.el.style.zIndex = c.v.slug === sel ? '3' : c.v.slug === res ? '2' : ''
        if (c.anillo && map.getSource(ID_HUELLAS)) {
          intentar(() =>
            map.setFeatureState({ source: ID_HUELLAS, id: c.v.slug }, { sel: c.v.slug === sel, res: c.v.slug === res })
          )
        }
      }
      pedirEtiquetas()
    }

    // ------------------------------------------------------- cámara
    // Encuadre de un vuelo: el círculo de su huella entra en la parte del mapa
    // que no tapa el panel, visto desde `escena.camara` o desde VISTA_VUELO.
    const irA = (slug, { animar = true } = {}) => {
      const c = porSlug.get(slug)
      if (!c) return
      limitarZoom()
      const vista = { ...VISTA_VUELO, ...(c.v.escena?.camara || {}) }
      const { left, bottom } = pref().relleno
      const W = contenedor.clientWidth || 640
      const H = contenedor.clientHeight || 480
      const t = Math.tan((fovV() / 2) * RAD)
      const mitadV = Math.atan((t * Math.max(H - bottom, 120)) / H)
      const mitadH = Math.atan((t * Math.max(W - left, 160)) / H)
      // 0,95: el círculo de la huella sobra en las esquinas; así la malla llena
      // la vista sin salirse.
      const distancia = vista.distancia_m ?? (c.enc.radio / Math.sin(Math.min(mitadV, mitadH))) * 0.95
      const opciones = {
        center: [c.enc.lon, c.enc.lat],
        zoom: zoomParaDistancia(distancia, c.enc.lat, H, fovV()),
        bearing: (vista.azimut_grados + 180) % 360,
        pitch: 90 - vista.elevacion_grados,
      }
      if (animar && !sinMovimiento()) {
        map.flyTo({ ...opciones, speed: 0.9, curve: 1.5, maxDuration: 6000 })
      } else map.jumpTo(opciones)
    }

    // Todos los vuelos a la vista, un poco inclinados para que se lea el
    // relieve de la sabana y los cerros.
    const verTodos = ({ animar = true } = {}) => {
      const cajas = new maplibregl.LngLatBounds()
      for (const c of vuelosEsc) {
        cajas.extend(c.centro)
        for (const pt of c.anillo ?? []) cajas.extend(pt)
      }
      if (cajas.isEmpty()) return
      const cam = map.cameraForBounds(cajas, { padding: { top: 90, bottom: 70, left: 90, right: 150 }, bearing: 0 })
      if (!cam) return
      const opciones = { center: cam.center, zoom: Math.min(cam.zoom - 0.25, 13), bearing: 0, pitch: 35 }
      if (animar && !sinMovimiento()) map.flyTo({ ...opciones, speed: 1.1, curve: 1.4, maxDuration: 4000 })
      else map.jumpTo(opciones)
    }

    // Clic en una marca que agrupa varios vuelos: acercar hasta que quepan
    // todas sus huellas, con el rumbo y la inclinación de ahora.
    const acercarA = (grupo) => {
      const cajas = new maplibregl.LngLatBounds()
      for (const c of grupo) {
        cajas.extend(c.centro)
        for (const pt of c.anillo ?? []) cajas.extend(pt)
      }
      const { left, bottom } = pref().relleno
      map.fitBounds(cajas, {
        padding: { top: 70, right: 110, bottom: bottom + 60, left: left + 60 },
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        maxZoom: 16,
        animate: !sinMovimiento(),
        duration: 1500,
      })
    }

    const alMover = () => {
      pedirEtiquetas()
    }
    let ultimaRevision = 0
    const alMoverCercania = () => {
      const ahora = performance.now()
      if (ahora - ultimaRevision < 400) return
      ultimaRevision = ahora
      revisarCercania()
    }
    const alTerminarMovimiento = () => {
      limitarZoom()
      revisarCercania()
      pedirEtiquetas()
    }
    map.on('move', alMover)
    map.on('move', alMoverCercania)
    map.on('moveend', alTerminarMovimiento)

    // Cada vez que entra un estilo (el primero, o uno nuevo del selector de
    // mapa base): el terreno, las huellas y los filtros ya vienen de
    // prepararEstilo; aquí faltan las mallas y el estado de las huellas.
    let primera = true
    const montar = () => {
      const capas = map.getStyle().layers
      const primerSimbolo = capas[antesDeLosNombres(capas)]?.id
      for (const [, capa] of capasCustom) {
        if (!map.getLayer(capa.id)) map.addLayer(capa, primerSimbolo)
        else map.moveLayer(capa.id, primerSimbolo)
      }
      ultimaDem = claveHundir()
      ultimoFiltro = claveFiltro()
      marcar()
      if (vivo) {
        setDisponibles({
          edificios: capas.some((l) => l.type === 'fill-extrusion'),
          nombres: capas.some((l) => l.type === 'symbol'),
        })
        setEstado((e) => (e === 'error' ? e : 'listo'))
      }
      if (primera) {
        primera = false
        revisarCercania()
      }
      map.triggerRepaint()
    }
    map.on('style.load', montar)
    const alErrorMapa = (e) => {
      // Una tesela que falla no tumba la escena; el estilo sí.
      if (!map.isStyleLoaded() && !e.sourceId && vivo) setEstado('error')
    }
    map.on('error', alErrorMapa)

    // Primera vista: el vuelo del enlace (/?v=slug) o todos.
    limitarZoom()
    if (pref().inicial && porSlug.has(pref().inicial)) irA(pref().inicial, { animar: false })
    else verTodos({ animar: false })

    // ------------------------------------------------------- giro con el botón derecho
    // Se gira la cámara como un sólido alrededor del punto elegido: la
    // posición y la orientación giran juntas, así que el punto se queda en el
    // mismo píxel.
    const lienzo = map.getCanvasContainer()
    const raycaster = new THREE.Raycaster()

    // El punto 3D bajo el cursor: primero una malla, luego el terreno.
    const elegirPunto = (px, py) => {
      const w = map.getCanvas().clientWidth, h = map.getCanvas().clientHeight
      const x = (px / w) * 2 - 1, y = 1 - (py / h) * 2
      for (const c of conModelo) {
        if (!c.tiles || !c.origen || !visible(c.v.slug)) continue
        const a = new THREE.Vector3(x, y, -1).applyMatrix4(c.camara.projectionMatrixInverse)
        const b = new THREE.Vector3(x, y, 1).applyMatrix4(c.camara.projectionMatrixInverse)
        raycaster.set(a, b.sub(a).normalize())
        const hit = raycaster.intersectObject(c.tiles.group, true)[0]
        if (hit) {
          const pv = hit.point
          return {
            lon: c.origen.lon + pv.x / (R_TIERRA * Math.cos(c.origen.lat * RAD) * RAD),
            lat: c.origen.lat + pv.y / (R_TIERRA * RAD),
            alt: c.origen.alt + pv.z,
          }
        }
      }
      const punto = new maplibregl.Point(px, py)
      if (transform()?.isPointOnMapSurface?.(punto, map.terrain) === false) {
        const cc = map.getCenter()
        return { lon: cc.lng, lat: cc.lat, alt: map.getCameraTargetElevation?.() || 0 }
      }
      const ll = map.unproject(punto)
      return { lon: ll.lng, lat: ll.lat, alt: map.queryTerrainElevation(ll) ?? 0 }
    }

    const orbitar = (pivote, dRumbo, dInclinacion) => {
      const t = transform()
      const cam = t.getCameraLngLat()
      const camAlt = t.getCameraAltitude()
      const kx = R_TIERRA * Math.cos(pivote.lat * RAD) * RAD
      const ky = R_TIERRA * RAD
      let e = (cam.lng - pivote.lon) * kx
      let n = (cam.lat - pivote.lat) * ky
      const u = camAlt - pivote.alt
      const rumbo = map.getBearing()
      const incl = map.getPitch()
      // rumbo: giro horario alrededor de la vertical
      const g = dRumbo * RAD
      ;[e, n] = [e * Math.cos(g) + n * Math.sin(g), -e * Math.sin(g) + n * Math.cos(g)]
      const rumboNuevo = rumbo + dRumbo
      // inclinación: giro en el plano (adelante, arriba) de la cámara
      const nuevaIncl = Math.max(0, Math.min(INCLINACION_MAX, incl + dInclinacion))
      const a = (nuevaIncl - incl) * RAD
      const fe = Math.sin(rumboNuevo * RAD), fn = Math.cos(rumboNuevo * RAD)
      const vf = e * fe + n * fn
      const vr = e * fn - n * fe
      const vf2 = vf * Math.cos(a) - u * Math.sin(a)
      const u2 = vf * Math.sin(a) + u * Math.cos(a)
      let inclFinal = nuevaIncl
      let eF = e, nF = n, uF = u
      // Sin meter la cámara debajo del punto: si la inclinación la bajaría
      // demasiado, solo se aplica el rumbo.
      if (u2 >= 3) {
        eF = vr * fn + vf2 * fe
        nF = -vr * fe + vf2 * fn
        uF = u2
      } else {
        inclFinal = incl
      }
      const opciones = map.calculateCameraOptionsFromCameraLngLatAltRotation(
        [pivote.lon + eF / kx, pivote.lat + nF / ky],
        pivote.alt + uF,
        rumboNuevo,
        inclFinal
      )
      map.jumpTo(opciones)
    }

    let giro = null // { pivote, x, y, vx, vy, t }
    let inercia = 0
    const alBajarRaton = (ev) => {
      if (ev.button !== 2) return
      ev.preventDefault()
      map.stop()
      cancelAnimationFrame(inercia)
      const r = lienzo.getBoundingClientRect()
      giro = {
        pivote: elegirPunto(ev.clientX - r.left, ev.clientY - r.top),
        x: ev.clientX,
        y: ev.clientY,
        vx: 0,
        vy: 0,
        t: performance.now(),
      }
      window.addEventListener('mousemove', alMoverRaton)
      window.addEventListener('mouseup', alSoltarRaton)
    }
    const alMoverRaton = (ev) => {
      if (!giro) return
      const dx = ev.clientX - giro.x, dy = ev.clientY - giro.y
      const ahora = performance.now()
      const dt = Math.max(ahora - giro.t, 1)
      giro.vx = 0.6 * giro.vx + 0.4 * (dx / dt)
      giro.vy = 0.6 * giro.vy + 0.4 * (dy / dt)
      giro.x = ev.clientX
      giro.y = ev.clientY
      giro.t = ahora
      orbitar(giro.pivote, dx * GIRO_GRADOS_PX, -dy * INCLINACION_GRADOS_PX)
    }
    const alSoltarRaton = () => {
      window.removeEventListener('mousemove', alMoverRaton)
      window.removeEventListener('mouseup', alSoltarRaton)
      if (!giro) return
      const { pivote } = giro
      let { vx, vy } = giro
      const quieto = performance.now() - giro.t > 80
      giro = null
      if (quieto || sinMovimiento()) return
      // Inercia: el giro sigue un momento y se frena solo.
      let antes = performance.now()
      const paso = (ahora) => {
        const dt = ahora - antes
        antes = ahora
        const f = Math.exp(-dt / 180)
        vx *= f
        vy *= f
        if (Math.hypot(vx, vy) < 0.02) return
        orbitar(pivote, vx * dt * GIRO_GRADOS_PX, -vy * dt * INCLINACION_GRADOS_PX)
        inercia = requestAnimationFrame(paso)
      }
      inercia = requestAnimationFrame(paso)
    }
    const sinMenu = (ev) => ev.preventDefault()
    lienzo.addEventListener('mousedown', alBajarRaton)
    lienzo.addEventListener('contextmenu', sinMenu)
    // cualquier otro gesto corta la inercia del giro
    const cortarInercia = () => cancelAnimationFrame(inercia)
    lienzo.addEventListener('wheel', cortarInercia, { passive: true })
    lienzo.addEventListener('touchstart', cortarInercia, { passive: true })

    const alRedimensionar = () => {
      limitarZoom()
      pedirEtiquetas()
    }
    map.on('resize', alRedimensionar)

    // Para las pruebas con Playwright: diferencia malla - terreno en el borde
    // de la huella de un vuelo, `adentro` metros hacia el interior. Toma el
    // impacto más bajo (el suelo, bajo árboles y aleros) y el terreno sin
    // hundir. Positivo: la malla flota.
    // Con `muestras`, además cada punto: [este, norte, residuo, z de la malla
    // en el marco local], para ajustar un plano (la inclinación).
    const residuoBorde = (slug, paso = 8, adentro = 3, muestras = false) => {
      const c = porSlug.get(slug)
      if (!c?.anillo || !c.origen || !c.tiles) return null
      const peso = crearPesoHuellas([c.anillo], RAMPA_M)
      const kx = R_TIERRA * Math.cos(c.origen.lat * RAD) * RAD, ky = R_TIERRA * RAD
      const ray = new THREE.Raycaster()
      const out = []
      const puntos = []
      const n = c.anillo.length - 1
      for (let i = 0; i < n; i++) {
        const [a, b] = [c.anillo[i], c.anillo[i + 1]]
        const ax = (a[0] - c.origen.lon) * kx, ay = (a[1] - c.origen.lat) * ky
        const bx = (b[0] - c.origen.lon) * kx, by = (b[1] - c.origen.lat) * ky
        const largo = Math.hypot(bx - ax, by - ay)
        // normal hacia adentro: el anillo va en sentido antihorario (RFC 7946)
        const nx = -(by - ay) / largo, ny = (bx - ax) / largo
        for (let s = paso / 2; s < largo; s += paso) {
          const e = ax + ((bx - ax) * s) / largo + nx * adentro
          const nn = ay + ((by - ay) * s) / largo + ny * adentro
          const lon = c.origen.lon + e / kx, lat = c.origen.lat + nn / ky
          if (peso.peso(lon, lat) === 0) continue // esquina cóncava
          ray.set(new THREE.Vector3(e, nn, 2000), new THREE.Vector3(0, 0, -1))
          const hits = ray.intersectObject(c.tiles.group, true)
          if (!hits.length) continue
          const terreno = map.queryTerrainElevation([lon, lat])
          if (terreno == null) continue
          const malla = c.origen.alt + hits[hits.length - 1].point.z
          const hundido = claveHundir().split('+').includes(slug) ? HUNDIR_M * peso.peso(lon, lat) : 0
          out.push(malla - (terreno + hundido))
          puntos.push([+e.toFixed(1), +nn.toFixed(1), +(malla - (terreno + hundido)).toFixed(2), +hits[hits.length - 1].point.z.toFixed(2)])
        }
      }
      out.sort((x, y) => x - y)
      const q = (p) => +out[Math.floor(p * (out.length - 1))]?.toFixed(2)
      const res = { n: out.length, p10: q(0.1), p25: q(0.25), mediana: q(0.5), p75: q(0.75), p90: q(0.9) }
      return muestras ? { ...res, puntos } : res
    }

    // ------------------------------------------------------- lo que llaman los controles
    const aplicarVisibilidad = () => {
      const capas = pref().capas
      for (const l of map.getStyle()?.layers ?? []) {
        const grupo = grupoDe(l)
        if (!grupo) continue
        const ver = capas[grupo] && !ocultasDelEstilo.has(l.id)
        intentar(() => map.setLayoutProperty(l.id, 'visibility', ver ? 'visible' : 'none'))
      }
    }
    const api = {
      ajustar(slug) {
        const c = porSlug.get(slug)
        if (c) recolocar(c)
      },
      capa(nombre) {
        const capas = pref().capas
        if (nombre === 'edificios' || nombre === 'nombres') aplicarVisibilidad()
        else if (nombre === 'huellas') {
          intentar(() =>
            map.setLayoutProperty(`${ID_HUELLAS}-linea`, 'visibility', capas.huellas ? 'visible' : 'none')
          )
        } else if (nombre === 'terreno') {
          if (capas.terreno) intentar(() => map.setTerrain(terrenoActivo()))
          else {
            // Se mide antes de apagarlo: sin terreno no hay a quién preguntar.
            for (const c of conModelo) c.sueloBorde = c.sueloBorde ?? medirSuelo(c)
            intentar(() => map.setTerrain(null))
          }
          for (const c of conModelo) recolocar(c)
        } else if (nombre === 'hundir') {
          refrescarHuellas()
        }
      },
      // Estilo reconstruido y no por diferencias: con terreno, MapLibre pinta
      // las capas planas en texturas por tesela, y el cambio por diferencias
      // no las invalida (de Colores a Oscuro quedaban las vías del mapa
      // anterior; medido el 24-sep-2026). Las teselas de los modelos no se tocan.
      base() {
        map.setStyle(estiloDe(baseDe(pref().base)), { transformStyle: prepararEstilo, diff: false })
      },
      visibles() {
        revisarCercania()
        refrescarHuellas()
        pedirEtiquetas()
        map.triggerRepaint()
      },
      marcar() {
        marcar()
        revisarCercania()
      },
      relleno(r) {
        const padding = { top: 0, right: 0, left: r.left, bottom: r.bottom }
        if (sinMovimiento()) map.setPadding(padding)
        else map.easeTo({ padding, duration: 300 })
      },
    }
    apiRef.current = api
    if (controlRef) controlRef.current = { irA, verTodos }

    // El estado de las teselas de cada vuelo con modelo vivo. "gruesas" son
    // las teselas a la vista que ya deberían haberse cambiado por sus hijas
    // (error en pantalla > errorTarget) y siguen ahí: la vista está en un
    // nivel más burdo del que pide.
    const estadoTeselas = () =>
      conModelo
        .filter((c) => c.tiles)
        .map((c) => {
          const t = c.tiles
          const st = t.stats
          const lru = t.lruCache
          let gruesas = 0
          t.visibleTiles.forEach((tile) => {
            if (tile.children?.length && tile.traversal?.error > t.errorTarget) gruesas++
          })
          return {
            slug: c.v.slug,
            distancia: Math.round(distanciaA(c)),
            listo: !!c.origen,
            msPrimeraVisible: c.primeraVisible ? Math.round(c.primeraVisible - c.creado) : null,
            stats: {
              encola: st.queued,
              bajando: st.downloading,
              decodificando: st.parsing,
              cargadas: st.loaded,
              fallidas: st.failed,
              enCuadro: st.inFrustum,
              usadas: st.used,
              activas: st.active,
              visibles: t.visibleTiles.size,
            },
            gruesas,
            rechazadas: c.rechazadas,
            rechazadasAhora: st.refused,
            progreso: +t.loadProgress.toFixed(3),
            cache: {
              items: lru.itemSet.size,
              maxItems: lru.maxSize,
              mb: Math.round(lru.cachedBytes / 2 ** 20),
              maxMb: Math.round(lru.maxBytesSize / 2 ** 20),
              llena: lru.isFull(),
            },
            colas: { descargas: t.downloadQueue.maxJobsPerOrigin, decodificacion: t.parseQueue.maxJobs },
            errorTarget: t.errorTarget,
            fallas: c.fallas.slice(-5),
          }
        })

    let recuadro = null
    let relojRecuadro = 0
    if (depuracion) {
      recuadro = document.createElement('pre')
      recuadro.className =
        'pointer-events-none absolute right-14 top-3 z-20 max-w-xs overflow-hidden whitespace-pre rounded bg-geo-forest/85 p-2 font-mono text-2xs leading-tight text-geo-paper'
      contenedor.appendChild(recuadro)
      const pintarRecuadro = () => {
        const lineas = estadoTeselas().map((e) => {
          const s = e.stats
          return [
            `${e.slug}  ${e.distancia} m  et ${e.errorTarget}`,
            ` vis ${s.visibles}  gruesas ${e.gruesas}  prog ${e.progreso}`,
            ` cola ${s.encola}  baj ${s.bajando}  dec ${s.decodificando}  fall ${s.fallidas}`,
            ` caché ${e.cache.items}/${e.cache.maxItems}  ${e.cache.mb}/${e.cache.maxMb} MB${e.cache.llena ? ' LLENA' : ''}`,
            ` rechazadas ${e.rechazadas}  1a vista ${e.msPrimeraVisible ?? '-'} ms`,
          ].join('\n')
        })
        const ult = pedidos.slice(-30)
        const ms = ult.map((p) => p.tFin - p.t0).sort((a, b) => a - b)
        const ttfb = ult.map((p) => p.tCabecera - p.t0).sort((a, b) => a - b)
        const q = (arr, f) => (arr.length ? Math.round(arr[Math.floor(f * (arr.length - 1))]) : '-')
        lineas.push(
          `pedidos ${pedidos.length}  últimos 30: ttfb p50 ${q(ttfb, 0.5)} ms, total p50 ${q(ms, 0.5)} / p90 ${q(ms, 0.9)} ms`
        )
        recuadro.textContent = lineas.join('\n')
      }
      relojRecuadro = setInterval(pintarRecuadro, 500)
    }

    window.__escenaVuelos = {
      map,
      estadoTeselas,
      pedidos: () => pedidos.slice(),
      teselasDem: () => new Map(teselasDem),
      vuelos: porSlug,
      bytes: () => bytesTotal,
      // Los modelos vivos ahora, y el pico desde la última lectura.
      modelos: () => conModelo.filter((c) => c.tiles).map((c) => c.v.slug),
      fracciones: () => Object.fromEntries(conModelo.map((c) => [c.v.slug, +fraccionEnVista(c).toFixed(3)])),
      picoModelos: () => {
        const p = picoModelos
        picoModelos = conModelo.filter((c) => c.tiles).length
        return p
      },
      residuoBorde,
      // Para probar una inclinación sin recompilar: { este, norte, z_pivote }, o null
      // para volver a la del JSON.
      inclinar: (slug, inc) => {
        const c = porSlug.get(slug)
        if (!c) return
        c.inclinacionPrueba = inc ?? undefined
        inclinar(c)
      },
      ajustarPrueba: (slug, m) => {
        prefsRef.current = { ...prefsRef.current, ajustes: { ...prefsRef.current.ajustes, [slug]: m } }
        const c = porSlug.get(slug)
        if (c) recolocar(c)
      },
      irA,
      verTodos,
      elegirPunto,
      orbitar,
    }

    return () => {
      vivo = false
      clearInterval(repintar)
      clearInterval(relojRecuadro)
      recuadro?.remove()
      cancelAnimationFrame(inercia)
      cancelAnimationFrame(pendienteEtiquetas)
      cancelarCambioTerreno()
      window.removeEventListener('mousemove', alMoverRaton)
      window.removeEventListener('mouseup', alSoltarRaton)
      lienzo.removeEventListener('mousedown', alBajarRaton)
      lienzo.removeEventListener('contextmenu', sinMenu)
      lienzo.removeEventListener('wheel', cortarInercia)
      lienzo.removeEventListener('touchstart', cortarInercia)
      map.off('style.load', montar)
      map.off('error', alErrorMapa)
      map.off('resize', alRedimensionar)
      map.off('move', alMover)
      map.off('move', alMoverCercania)
      map.off('moveend', alTerminarMovimiento)
      if (apiRef.current === api) apiRef.current = null
      if (controlRef?.current?.irA === irA) controlRef.current = null
      for (const c of vuelosEsc) {
        desactivar(c)
        c.marca?.marker.remove()
      }
      // Las teselas van antes de remove(), que suelta el contexto WebGL.
      ktx2?.dispose()
      renderer?.dispose()
      map.remove()
      maplibregl.removeProtocol(PROTO_CONTADO)
      maplibregl.removeProtocol(PROTO_DEM)
      if (window.__escenaVuelos?.map === map) delete window.__escenaVuelos
    }
    // controlRef es un ref estable de la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vuelosTxt, tactil])

  // Las props que cambian sin rehacer la escena.
  useEffect(() => {
    apiRef.current?.visibles()
  }, [visibles])
  useEffect(() => {
    apiRef.current?.marcar()
  }, [seleccionado, resaltado])
  useEffect(() => {
    apiRef.current?.relleno({ left: relleno.left, bottom: relleno.bottom })
  }, [relleno.left, relleno.bottom])

  // ------------------------------------------------------- controles
  const elegido = vuelos.find((v) => v.slug === seleccionado) || null
  const ajusteJson = elegido?.escena ? elegido.escena.ajuste ?? AJUSTE_ALTURA_M : AJUSTE_ALTURA_M
  const ajuste = elegido ? ajustes[elegido.slug] ?? ajusteJson : 0
  const ajusteTxt = escrito.slug === seleccionado ? escrito.txt : conComa(ajuste)
  const setAjusteTxt = (txt) => setEscrito({ slug: seleccionado, txt })
  const aviso = avisoDe.slug === seleccionado ? avisoDe.txt : ''
  const setAviso = (txt) => setAvisoDe({ slug: seleccionado, txt })
  const minAjuste = Math.min(-AJUSTE_RANGO_M, ajusteJson)
  const maxAjuste = Math.max(AJUSTE_RANGO_M, ajusteJson)
  const aplicarAjuste = (v, { texto = true } = {}) => {
    if (!elegido?.escena) return
    const r = redondear(Math.min(maxAjuste, Math.max(minAjuste, v)))
    const nuevos = { ...prefsRef.current.ajustes, [elegido.slug]: r }
    setAjustes(nuevos)
    if (texto) setAjusteTxt(conComa(r))
    prefsRef.current = { ...prefsRef.current, ajustes: nuevos }
    apiRef.current?.ajustar(elegido.slug)
  }
  const alEscribirAjuste = (e) => {
    const txt = e.target.value
    setAjusteTxt(txt)
    const n = Number(txt.trim().replace(',', '.'))
    if (txt.trim() !== '' && Number.isFinite(n)) aplicarAjuste(n, { texto: false })
  }
  const cambiarCapa = (nombre, valor) => {
    const nuevas = { ...prefsRef.current.capas, [nombre]: valor }
    setCapas(nuevas)
    prefsRef.current = { ...prefsRef.current, capas: nuevas }
    apiRef.current?.capa(nombre)
  }
  const cambiarBase = (id) => {
    if (id === prefsRef.current.base) return
    setBase(id)
    prefsRef.current = { ...prefsRef.current, base: id }
    apiRef.current?.base()
  }
  // El número tal como va en el JSON del vuelo: con punto.
  const copiarAjuste = async () => {
    const valor = String(redondear(ajuste))
    try {
      await navigator.clipboard.writeText(valor)
      setAviso(`Copiado: ${valor}`)
    } catch {
      setAviso(`No pude copiar. El valor es ${valor}`)
    }
  }
  const alternarPanel = (id) => setPanel((v) => (v === id ? null : id))
  const cerrarConEscape = (e) => {
    if (e.key !== 'Escape' || !panel) return
    e.stopPropagation()
    botonesRef.current[panel]?.focus()
    setPanel(null)
  }

  if (estado === 'sin-webgl') {
    return (
      <div className={`flex items-center justify-center bg-geo-paper-warm p-8 text-center ${className}`}>
        <p className="max-w-md text-[15px] leading-[1.55] text-geo-forest/85">
          Tu navegador no tiene WebGL activo, y sin eso el mapa 3D no se puede
          dibujar. Prueba en otro navegador o activa la aceleración por hardware.
          La lista de vuelos sigue funcionando, y cada uno tiene su ficha.
        </p>
      </div>
    )
  }

  const ayuda = tactil
    ? 'Un dedo: mover · Dos dedos: girar, inclinar y acercar'
    : 'Arrastrar: mover · Clic derecho: girar e inclinar · Rueda: acercar'
  const enlace = 'underline decoration-geo-forest/30 underline-offset-2 hover:text-geo-forest'
  // Botones de la columna: cuadrados con el ícono en el teléfono, con el
  // nombre al lado desde sm, todos del ancho del más largo.
  const pildoraForma =
    'pointer-events-auto inline-flex items-center justify-center gap-2 rounded-lg border border-geo-forest/15 p-2 sm:justify-start sm:px-3 sm:py-1.5 o2-mono text-[11px] shadow-card-border transition'
  const pildora = `${pildoraForma} bg-geo-paper-pale/95 text-geo-forest hover:bg-geo-paper-warm`
  const botonChico =
    'rounded-full border border-geo-forest/20 px-3 py-1 o2-mono text-[11px] text-geo-forest hover:bg-geo-paper-warm transition'
  const mapaBase = baseDe(base)
  // Los créditos del pie, con los nombres completos o los cortos.
  const creditosDe = (corto) => {
    const txt = (a) => (corto && a.corto) || a.texto
    return (
      <>
        Mapa:{' '}
        {mapaBase.atribucion.map((a, i, todas) => (
          <span key={a.href + a.texto}>
            {i > 0 ? (todas[i - 1].aparte ? ' · ' : ' ') : ''}
            <a href={a.href} target="_blank" rel="noopener noreferrer" className={enlace}>
              {txt(a)}
            </a>
          </span>
        ))}
        {capas.terreno ? (
          <>
            {' · '}
            <a href={TERRENO.atribucion.href} target="_blank" rel="noopener noreferrer" className={enlace}>
              {txt(TERRENO.atribucion)}
            </a>
          </>
        ) : null}
        {modelos.length
          ? ` · Modelos: ${modelos[0].licencia || 'CC BY 4.0'}${corto ? '' : ', Sebastián Forero'}`
          : ''}
      </>
    )
  }
  // Sin el nombre del vuelo: en el teléfono, "Ibagué, Arboleda del
  // Campestre" hacía que el aviso tapara el ancho del mapa. La tarjeta y el
  // aro de la marca ya dicen cuál.
  const textoBajando = bajando.length === 1 ? 'Cargando el modelo 3D' : `Cargando ${bajando.length} modelos 3D`
  const textoCarga =
    estado === 'error'
      ? ''
      : falla || (estado === 'iniciando' ? 'Cargando el mapa' : cargaLenta && bajando.length ? textoBajando : '')
  const hayHuellas = vuelos.some((v) => v.huella)
  const modelos = vuelos.filter((v) => v.escena)
  const listaCapas = [
    hayHuellas ? { k: 'huellas', texto: 'Contorno de cada vuelo', ok: true } : null,
    {
      k: 'edificios',
      texto: 'Edificios 3D del mapa',
      ok: disponibles.edificios,
      nota: 'este mapa base no trae edificios',
    },
    {
      k: 'nombres',
      texto: 'Nombres y lugares',
      ok: disponibles.nombres,
      nota: 'este mapa base no trae nombres aparte',
    },
    { k: 'terreno', texto: 'Terreno en relieve', ok: true },
    hayHuellas
      ? {
          k: 'hundir',
          texto: 'Terreno hundido bajo los modelos',
          ok: capas.terreno,
          nota: 'solo con el terreno prendido',
        }
      : null,
  ].filter(Boolean)
  const legendaClase = 'mb-2 o2-mono text-[11px] uppercase tracking-wider text-geo-forest/70'
  const casilla = (ok) =>
    `flex items-start gap-2 rounded-lg px-1 py-1 text-[13px] leading-snug ${
      ok ? 'cursor-pointer hover:bg-geo-paper-warm' : 'text-geo-forest/55'
    }`

  return (
    <div className={`relative ${className}`}>
      {/* El mapa va en un hijo: la hoja de MapLibre le pone position:relative
          a su contenedor, y eso anularía el absolute inset-0. El fondo es el
          del mapa base: con terreno, MapLibre no pinta la capa background
          sobre él. */}
      <div className="absolute inset-0" style={{ backgroundColor: mapaBase.muestra[0] }}>
        <div ref={contenedorRef} className="h-full w-full" />
      </div>

      {/* Lo que va encima del mapa vive en la parte que el panel no tapa. */}
      <div
        ref={encuadreRef}
        className="pointer-events-none absolute right-0 top-0"
        style={{ left: relleno.left, bottom: relleno.bottom }}
      >
        {estado === 'error' ? (
          <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-geo-paper-warm p-8 text-center">
            <p className="max-w-md text-[15px] leading-[1.55] text-geo-forest/85">
              No pude cargar el mapa. Puede ser la conexión o que el servidor
              del mapa base no responda. Recarga la página para intentarlo otra vez.
            </p>
          </div>
        ) : null}

        {estado === 'listo' ? (
          <div
            ref={barraRef}
            onKeyDown={cerrarConEscape}
            className="absolute right-2.5 flex flex-col items-stretch gap-1.5"
            style={{ top: colTop }}
          >
            <button
              type="button"
              title="Ver todos los vuelos"
              onClick={() => controlRef?.current?.verTodos()}
              className={pildora}
            >
              <Scan aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span className="sr-only sm:not-sr-only">Ver todos</span>
            </button>
            {PANELES.map(({ id, Icono, nombre }) => (
              <button
                key={id}
                ref={(el) => {
                  botonesRef.current[id] = el
                }}
                type="button"
                title={nombre}
                aria-expanded={panel === id}
                aria-controls={panel === id ? `${idPanel}-${id}` : undefined}
                onClick={() => alternarPanel(id)}
                className={panel === id ? `${pildoraForma} bg-geo-forest text-geo-paper-warm` : pildora}
              >
                <Icono aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                <span className="sr-only sm:not-sr-only">{nombre}</span>
              </button>
            ))}
          </div>
        ) : null}

        {estado === 'listo' ? (
          <p className="absolute bottom-10 right-3 m-0 hidden rounded-full bg-geo-paper-pale/95 px-3 py-1.5 o2-mono text-[11px] text-geo-forest xl:block">
            {ayuda}
          </p>
        ) : null}

        {/* La ventanita del botón abierto, a la izquierda de la columna y a la
            altura del botón. Escape la cierra y devuelve el foco a su botón. */}
        {estado === 'listo' && panel ? (
          <div
            className="absolute z-10 flex flex-col"
            style={{ right: posPanel.right, top: posPanel.top, width: posPanel.width }}
          >
            <section
              id={`${idPanel}-${panel}`}
              aria-label={PANELES.find((p) => p.id === panel).nombre}
              onKeyDown={cerrarConEscape}
              style={{ maxHeight: posPanel.maxHeight }}
              className="pointer-events-auto flex flex-col overflow-hidden rounded-2xl border border-geo-forest/15 bg-geo-paper-pale text-geo-forest shadow-card-border"
            >
              <div ref={contenidoRef} className="min-h-0 overflow-y-auto p-3">
                {panel === 'base' ? (
                  <fieldset className="m-0 border-0 p-0">
                    <legend className={legendaClase}>Mapa base</legend>
                    <div className="grid grid-cols-3 gap-2">
                      {MAPAS_BASE.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          aria-pressed={base === b.id}
                          title={b.detalle}
                          onClick={() => cambiarBase(b.id)}
                          className={`flex flex-col items-stretch gap-1 rounded-lg border-2 p-1 text-left transition ${
                            base === b.id
                              ? 'border-geo-emerald bg-geo-paper-warm'
                              : 'border-transparent hover:border-geo-forest/20'
                          }`}
                        >
                          {/* Tres colores del estilo en vez de una miniatura:
                              no pide ninguna tesela. */}
                          <span
                            aria-hidden="true"
                            className="block h-8 rounded border border-geo-forest/15"
                            style={{
                              background: `linear-gradient(135deg, ${b.muestra[0]} 0 45%, ${b.muestra[2]} 45% 55%, ${b.muestra[1]} 55% 100%)`,
                            }}
                          />
                          <span className="o2-mono text-[10.5px] leading-tight text-geo-forest">{b.nombre}</span>
                        </button>
                      ))}
                    </div>
                    <p className="m-0 mt-2 text-[11.5px] leading-[1.4] text-geo-forest/75">{mapaBase.detalle}.</p>
                  </fieldset>
                ) : null}

                {panel === 'capas' ? (
                  <>
                    {modelos.length ? (
                      <fieldset className="m-0 mb-3 border-0 p-0">
                        <legend className={legendaClase}>Modelos 3D</legend>
                        <ul className="m-0 flex list-none flex-col gap-1 p-0">
                          {modelos.map((v) => (
                            <li key={v.slug}>
                              <label className={casilla(true)}>
                                <input
                                  type="checkbox"
                                  checked={visibles[v.slug] !== false}
                                  onChange={(e) => onVisible?.(v.slug, e.target.checked)}
                                  className="mt-0.5 h-4 w-4 shrink-0 accent-geo-emerald"
                                />
                                <span>{v.title}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                        <p className="m-0 mt-1 text-[11.5px] leading-[1.4] text-geo-forest/75">
                          Cada modelo se descarga cuando su vuelo entra en el mapa:
                          primero una versión gruesa, y el detalle al acercarte.
                        </p>
                      </fieldset>
                    ) : null}
                    <fieldset className="m-0 border-0 p-0">
                      <legend className={legendaClase}>Mapa</legend>
                      <ul className="m-0 flex list-none flex-col gap-1 p-0">
                        {listaCapas.map(({ k, texto, ok, nota }) => (
                          <li key={k}>
                            <label className={casilla(ok)}>
                              <input
                                type="checkbox"
                                checked={capas[k] && ok}
                                disabled={!ok}
                                onChange={(e) => cambiarCapa(k, e.target.checked)}
                                className="mt-0.5 h-4 w-4 shrink-0 accent-geo-emerald"
                              />
                              <span>
                                {texto}
                                {!ok && nota ? (
                                  <span className="block text-[11px] text-geo-forest/70">({nota})</span>
                                ) : null}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      {!capas.terreno ? (
                        <p className="m-0 mt-2 text-[11.5px] leading-[1.4] text-geo-forest/75">
                          Sin terreno el suelo queda a 0 m, y los modelos bajan con él:
                          su borde se apoya en ese plano.
                        </p>
                      ) : null}
                    </fieldset>
                  </>
                ) : null}

                {panel === 'altura' ? (
                  elegido?.escena ? (
                    <div>
                      <label
                        htmlFor={`${idPanel}-ajuste`}
                        className="flex items-baseline justify-between gap-2 o2-mono text-[11px] uppercase tracking-wider text-geo-forest/70"
                      >
                        Ajuste de altura
                        <span className="normal-case tracking-normal text-geo-forest">{conComa(ajuste)} m</span>
                      </label>
                      <p className="m-0 mt-1 text-[12.5px] font-semibold leading-snug text-geo-forest">
                        {elegido.title}
                      </p>
                      <input
                        id={`${idPanel}-ajuste`}
                        type="range"
                        min={minAjuste}
                        max={maxAjuste}
                        step={AJUSTE_PASO_M}
                        value={ajuste}
                        onChange={(e) => aplicarAjuste(Number(e.target.value))}
                        aria-valuetext={`${conComa(ajuste)} metros`}
                        className="mt-2 w-full accent-geo-emerald"
                      />
                      <div className="mt-1 flex justify-between o2-mono text-[10.5px] text-geo-forest/70" aria-hidden="true">
                        <span>{minAjuste} m</span>
                        <span>0</span>
                        <span>+{maxAjuste} m</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label="Ajuste de altura en metros"
                          value={ajusteTxt}
                          onChange={alEscribirAjuste}
                          onBlur={() => setAjusteTxt(conComa(ajuste))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setAjusteTxt(conComa(ajuste))
                          }}
                          className="w-20 rounded-lg border border-geo-forest/25 bg-geo-paper-pale px-2 py-1 o2-mono text-[13px] text-geo-forest"
                        />
                        <span className="o2-mono text-[11px] text-geo-forest/75">m</span>
                        <button
                          type="button"
                          onClick={() => aplicarAjuste(ajusteJson)}
                          disabled={redondear(ajuste) === redondear(ajusteJson)}
                          className={`${botonChico} disabled:opacity-50`}
                        >
                          Restablecer
                        </button>
                        <button type="button" onClick={copiarAjuste} className={botonChico}>
                          Copiar valor
                        </button>
                      </div>
                      <p className="m-0 mt-2 text-[11.5px] leading-[1.4] text-geo-forest/75">
                        Positivo sube el modelo. El vuelo trae {conComa(ajusteJson)} m en{' '}
                        <code className="o2-mono text-[11px]">escena.ajuste_altura_m</code>; para dejar
                        otro valor, cópialo y pégalo ahí.
                      </p>
                      <p role="status" aria-live="polite" className="m-0 mt-1 min-h-4 o2-mono text-[11px] text-geo-emerald">
                        {aviso}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className={legendaClase}>Ajuste de altura</p>
                      <p className="m-0 text-[13px] leading-snug text-geo-forest/85">
                        {elegido
                          ? `${elegido.title} todavía no tiene modelo en la escena. Elige un vuelo con modelo 3D para subirlo o bajarlo.`
                          : 'Elige en la lista un vuelo con modelo 3D para subirlo o bajarlo sobre el terreno.'}
                      </p>
                    </div>
                  )
                ) : null}
              </div>
            </section>
          </div>
        ) : null}

        {/* El aviso de carga: en el teléfono arriba, debajo del enlace de
            vuelta; en pantallas anchas abajo, sobre el pie. Solo aparece
            cuando hay algo que decir (el mapa arrancando, un modelo que tarda,
            una falla) y sin cifras de descarga, que solo le sirven a quien
            depura (?debug=1). La región viva se queda en el DOM, vacía, para
            que el lector de pantalla anuncie cuando cambia. */}
        <div
          className={`absolute left-3 top-16 items-center gap-2 rounded-full bg-geo-paper-pale/95 px-3 py-1.5 o2-mono text-[11px] text-geo-forest shadow-card-border sm:bottom-10 sm:top-auto ${
            textoCarga ? 'flex' : 'sr-only'
          }`}
        >
          {textoCarga && !falla ? (
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-geo-emerald motion-safe:animate-pulse" />
          ) : null}
          <span role="status" aria-live="polite">
            {textoCarga}
          </span>
        </div>

        {/* Atribución visible, sin esconderla tras un botón, y la del mapa base
            que esté puesto (cada una está en data/escena.js): la piden
            OpenFreeMap, OpenMapTiles, OpenStreetMap (ODbL), EOX, OpenTopoMap,
            las fuentes del terreno y la licencia de los modelos. En el
            teléfono ocupaba tres renglones encima de la hoja: ahí va en uno,
            con los nombres cortos, y "Créditos" abre el texto completo. */}
        <div
          ref={pieRef}
          className="pointer-events-auto absolute bottom-0 left-0 right-0 bg-geo-paper-pale/90 px-3 py-1.5 text-[10.5px] leading-[1.4] text-geo-forest/80"
        >
          <p className={`m-0 ${creditos ? '' : 'hidden sm:block'}`}>
            {creditosDe(false)}
            <button
              type="button"
              onClick={() => setCreditos(false)}
              className={`ml-2 ${enlace} sm:hidden`}
            >
              Menos
            </button>
          </p>
          <p className={`m-0 items-center gap-2 ${creditos ? 'hidden' : 'flex sm:hidden'}`}>
            <span className="min-w-0 flex-1 truncate">{creditosDe(true)}</span>
            <button type="button" onClick={() => setCreditos(true)} aria-expanded={false} className={`shrink-0 ${enlace}`}>
              Créditos
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
