// VisorTiles: carga un modelo 3D en 3D Tiles (tileset.json) por partes.
//
// Usa `3d-tiles-renderer` (NASA-AMMOS) sobre three.js, sin react-three-fiber,
// igual que CommunityGlobe. El renderer pide solo las teselas que la cámara
// necesita al nivel de detalle que la pantalla aguanta: la primera vista baja
// unos pocos MB y el resto llega a medida que uno se acerca.
//
// Este módulo NO se importa directo desde una página: se carga con
// next/dynamic (ssr:false) cuando el visitante pulsa "Cargar modelo 3D". Así
// three.js y el renderer de teselas no viajan en el bundle del explorador.

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { TilesRenderer } from '3d-tiles-renderer/three'
import {
  GLTFExtensionsPlugin,
  ReorientationPlugin,
  TilesFadePlugin,
  UnloadTilesPlugin,
} from '3d-tiles-renderer/three/plugins'
import { PALETTE } from '../sections/o2-palette'
import { ReintentoPlugin, hayWebGL } from './visor-comun'

// `zUp` es el atajo para lo más común (Z hacia arriba = rotar -90° en X).
// `up` acepta cualquier eje ('+y', '+z', '-z', '+x'...) por si un tileset
// viene con el vertical invertido, como los de rovers de Marte (Z hacia abajo).
export default function VisorTiles({ tileset, zUp = false, up, className = '' }) {
  const eje = up || (zUp ? '+z' : '+y')
  const contenedorRef = useRef(null)
  // Este componente solo corre en el cliente (next/dynamic con ssr:false), así
  // que el chequeo de WebGL puede ir en el inicializador y no en el efecto.
  const [estado, setEstado] = useState(() =>
    hayWebGL() ? 'iniciando' : 'sin-webgl'
  ) // iniciando | listo | error | sin-webgl
  const [bajando, setBajando] = useState(true)

  useEffect(() => {
    const contenedor = contenedorRef.current
    if (!contenedor || !tileset) return

    let vivo = true
    const ancho = () => contenedor.clientWidth || 640
    const alto = () => contenedor.clientHeight || 480

    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      // WebGL existe pero no dio contexto (p. ej. el navegador llegó a su tope
      // de contextos). Se avisa fuera del cuerpo síncrono del efecto.
      Promise.resolve().then(() => vivo && setEstado('sin-webgl'))
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(ancho(), alto())
    renderer.setClearColor(PALETTE.paperWarm)
    renderer.domElement.style.touchAction = 'none'
    renderer.domElement.style.display = 'block'
    contenedor.appendChild(renderer.domElement)

    const escena = new THREE.Scene()
    // Luz suave y pareja: una malla de fotogrametría ya trae las sombras
    // horneadas en la textura, así que una luz fuerte las duplicaría.
    escena.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 2.2))
    const sol = new THREE.DirectionalLight(0xffffff, 0.8)
    sol.position.set(1, 2, 1)
    escena.add(sol)

    const camara = new THREE.PerspectiveCamera(45, ancho() / alto(), 0.1, 10000)
    camara.position.set(0, 100, 150)

    const controles = new OrbitControls(camara, renderer.domElement)
    controles.enableDamping = true
    controles.dampingFactor = 0.08
    controles.screenSpacePanning = true
    // Sin pasar por debajo del terreno.
    controles.maxPolarAngle = Math.PI * 0.49

    const tiles = new TilesRenderer(tileset)
    // errorTarget (16 px por defecto) es el error en pantalla que se tolera antes de pedir una
    // tesela más fina. En pantalla chica se sube: la diferencia no se ve y la
    // primera vista baja bastante menos.
    // Los tilesets de armar-tiles.mjs traen geometricError = 16 x tamaño del
    // texel, así que errorTarget 16 refina cuando un texel pasa de 1 px, y 24
    // cuando pasa de 1,5 px. Con 24, acercarse a una manzana del Tintal baja
    // ~40 MB en vez de ~70 (medido el 24-sep-2026) y de cerca se ve igual: las
    // hojas, a resolución nativa, llegan de todos modos.
    tiles.errorTarget = ancho() < 640 ? 32 : 24
    // Tope de memoria de teselas (lo que ocupan en GPU, no lo que bajan). Si se
    // llena, el renderer RECHAZA cargar más (stats.refused) y la vista se queda
    // en el nivel que alcanzó: con REPLACE, un padre no se cambia por sus hijos
    // hasta que todos los hijos visibles cargan. Con los 0,4 GB de antes el
    // Tintal se congelaba en el segundo nivel al acercarse (medido el
    // 23-sep-2026: 490 MB pedidos con seis teselas en pantalla). Una hoja de
    // fotogrametría a resolución nativa pesa 20-120 MB en GPU, así que en
    // pantalla grande se da 1 GB; en teléfono, 0,6 GB (y errorTarget 24 pide
    // menos detalle). minBytesSize es hasta dónde descarga cuando se pasa.
    const chica = ancho() < 640
    tiles.lruCache.maxBytesSize = (chica ? 0.6 : 1) * 2 ** 30
    tiles.lruCache.minBytesSize = (chica ? 0.45 : 0.75) * 2 ** 30
    // Las teselas de los vuelos son glb con geometría EXT_meshopt_compression y
    // texturas JPEG (hojas y raíz) o KTX2 ETC1S (niveles intermedios). El transcoder de Basis se sirve desde /basis/
    // (copiado de three/examples/jsm/libs/basis: si se actualiza three, hay que
    // volver a copiarlo) y solo se descarga cuando aparece la primera textura
    // KTX2, o sea, solo en esta ruta y solo después del clic. Sin Draco.
    const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer)
    tiles.registerPlugin(
      new GLTFExtensionsPlugin({
        rtc: true,
        ktxLoader: ktx2,
        meshoptDecoder: MeshoptDecoder,
        autoDispose: true,
      })
    )
    tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: 250 }))
    // Libera de la GPU las teselas que salen de cuadro; siguen en la caché de
    // CPU, así que volver a mirarlas no las descarga otra vez.
    tiles.registerPlugin(new UnloadTilesPlugin())
    // Una tesela que falla se vuelve a pedir en vez de dejar un hueco fijo.
    tiles.registerPlugin(new ReintentoPlugin())
    // Si el tileset está georreferenciado (ECEF), este plugin lo trae al
    // origen con Y hacia arriba. Si viene en un marco local, que es lo esperado
    // para los vuelos, `up` dice qué eje del tileset es el vertical. Los que
    // arma armar-tiles.mjs (tuberia/node) siguen la norma de 3D
    // Tiles: Z-up, con x = este, y = norte, z = altura, o sea up '+z'. Con '+y'
    // el Tintal se veía desde abajo (espejado y sin techos: por eso hubo un
    // DoubleSide que ya no hace falta; con el eje bien puesto basta FrontSide).
    // En los dos casos lo recentra en el origen.
    tiles.registerPlugin(
      new ReorientationPlugin({ up: eje, recenter: true })
    )
    tiles.setCamera(camara)
    tiles.setResolutionFromRenderer(camara, renderer)
    escena.add(tiles.group)

    // Encuadre: se registra DESPUÉS del ReorientationPlugin, que también
    // escucha este evento, para medir el modelo ya recentrado.
    const esfera = new THREE.Sphere()
    const encuadrar = () => {
      if (!tiles.getBoundingSphere(esfera)) return
      tiles.group.updateMatrixWorld(true)
      esfera.applyMatrix4(tiles.group.matrixWorld)
      const r = Math.max(esfera.radius, 1)
      // En un marco vertical (teléfono) manda el campo horizontal, que es el
      // más estrecho; sin esto el modelo se sale por los lados.
      const mitadV = THREE.MathUtils.degToRad(camara.fov / 2)
      const mitadH = Math.atan(Math.tan(mitadV) * camara.aspect)
      const distancia = (r / Math.sin(Math.min(mitadV, mitadH))) * 1.05
      const direccion = new THREE.Vector3(0.35, 0.75, 0.9).normalize()
      camara.position.copy(esfera.center).addScaledVector(direccion, distancia)
      camara.near = Math.max(0.05, r / 2000)
      camara.far = distancia * 20
      camara.updateProjectionMatrix()
      controles.target.copy(esfera.center)
      controles.minDistance = r * 0.02
      controles.maxDistance = distancia * 4
      controles.update()
      if (vivo) setEstado('listo')
    }
    const alError = (e) => {
      // Una tesela suelta que falla no tumba el modelo: el renderer se queda
      // con su padre. Solo el tileset raíz (tile === null) es un error de verdad.
      if (!e.tile && vivo) setEstado('error')
    }
    const alEmpezar = () => vivo && setBajando(true)
    const alTerminar = () => vivo && setBajando(false)
    tiles.addEventListener('load-root-tileset', encuadrar)
    tiles.addEventListener('load-error', alError)
    tiles.addEventListener('tiles-load-start', alEmpezar)
    tiles.addEventListener('tiles-load-end', alTerminar)

    let raf = 0
    const cuadro = () => {
      raf = requestAnimationFrame(cuadro)
      controles.update()
      camara.updateMatrixWorld()
      tiles.update()
      renderer.render(escena, camara)
    }
    cuadro()

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            renderer.setSize(ancho(), alto())
            camara.aspect = ancho() / alto()
            camara.updateProjectionMatrix()
            tiles.setResolutionFromRenderer(camara, renderer)
          })
        : null
    ro?.observe(contenedor)

    return () => {
      vivo = false
      cancelAnimationFrame(raf)
      ro?.disconnect()
      tiles.removeEventListener('load-root-tileset', encuadrar)
      tiles.removeEventListener('load-error', alError)
      tiles.removeEventListener('tiles-load-start', alEmpezar)
      tiles.removeEventListener('tiles-load-end', alTerminar)
      controles.dispose()
      // tiles.dispose() libera geometrías, materiales y texturas de cada
      // tesela cargada y aborta las descargas en curso.
      tiles.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [tileset, eje])

  if (estado === 'sin-webgl') {
    return (
      <div className={`flex items-center justify-center p-8 text-center ${className}`}>
        <p className="max-w-md text-[15px] leading-[1.55] text-geo-forest/85">
          Tu navegador no tiene WebGL activo, y sin eso el modelo 3D no se puede
          dibujar. Prueba en otro navegador o activa la aceleración por hardware.
        </p>
      </div>
    )
  }

  const textoCarga =
    estado === 'error' ? '' : estado === 'iniciando' ? 'Cargando el modelo' : bajando ? 'Cargando más detalle' : ''

  return (
    <div className={`relative ${className}`}>
      <div
        ref={contenedorRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        role="img"
        aria-label="Modelo 3D del vuelo. Arrastra para girar, rueda o pellizco para acercar."
      />
      {estado === 'error' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-geo-paper-warm p-8 text-center">
          <p className="max-w-md text-[15px] leading-[1.55] text-geo-forest/85">
            No pude cargar el modelo. Puede ser la conexión o que el servidor de
            las teselas no responda. Recarga la página para intentarlo otra vez.
          </p>
        </div>
      ) : null}
      {/* El aviso de carga, sin cifras de descarga: solo mientras llega el
          modelo o más detalle. La región viva queda en el DOM, vacía, para que
          el lector de pantalla anuncie cuando cambia. */}
      <div
        className={`pointer-events-none absolute bottom-3 left-3 items-center gap-2 rounded-full bg-geo-paper-pale/95 px-3 py-1.5 o2-mono text-[11px] text-geo-forest ${
          textoCarga ? 'flex' : 'sr-only'
        }`}
      >
        {textoCarga ? (
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-geo-emerald motion-safe:animate-pulse" />
        ) : null}
        <span role="status" aria-live="polite">
          {textoCarga}
        </span>
      </div>
    </div>
  )
}
