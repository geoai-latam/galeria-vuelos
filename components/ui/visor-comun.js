// Piezas que comparten los dos visores 3D de los vuelos (VisorTiles, el modelo
// solo, y EscenaVuelos, los modelos sobre terreno y mapa en el explorador). No importa three.js:
// así este archivo no arrastra nada pesado a quien lo use. De 3d-tiles-renderer
// solo toma dos constantes de su núcleo, que no depende de three.

import { FAILED, UNLOADED } from '3d-tiles-renderer/core'

// Suma los bytes que baja un TilesRenderer. `fetchData` es el gancho que el
// renderer consulta antes de su propio `fetch`, así que por aquí pasan el
// tileset.json raíz, los tilesets hijos y el contenido de cada tesela. Lo que
// no pasa: recursos externos de un .gltf (texturas sueltas), que carga el
// LoadingManager de three. Las teselas de Obj2Tiles traen la textura dentro
// del .b3dm, así que para esos modelos la cuenta es completa.
export class ContadorBytesPlugin {
  // `alMedir`, opcional, recibe el tiempo de cada pedido ({ url, estado, t0,
  // tCabecera, tFin, bytes }, en ms de performance.now()): lo usa el modo de
  // depuración del explorador (/?debug=1).
  constructor(alSumar, alMedir = null) {
    this.name = 'CONTADOR_BYTES'
    this.total = 0
    this.alSumar = alSumar
    this.alMedir = alMedir
  }

  fetchData(url, options) {
    const t0 = performance.now()
    const medir = (estado, tCabecera, bytes) =>
      this.alMedir?.({ url: String(url), estado, t0, tCabecera, tFin: performance.now(), bytes })
    return fetch(url, options).then(
      async (res) => {
        const tCabecera = performance.now()
        if (!res.ok) {
          medir(res.status, tCabecera, 0)
          return res
        }
        const buf = await res.arrayBuffer()
        this.total += buf.byteLength
        this.alSumar(this.total)
        medir(res.status, tCabecera, buf.byteLength)
        return new Response(buf, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        })
      },
      (err) => {
        // 0: el pedido no llegó a tener respuesta (red caída o abortado).
        if (err?.name !== 'AbortError') medir(0, performance.now(), 0)
        throw err
      }
    )
  }
}

// Reintenta las teselas que fallan. En 3d-tiles-renderer una tesela que falla
// queda FAILED para siempre y cuenta como terminada: el padre se cambia por sus
// hijas y donde iba la que falló queda un HUECO que no se llena hasta recargar
// la página. Bastaba un pedido cortado (r2.dev, la URL de desarrollo de R2,
// tiene límite de pedidos) para que un pedazo del modelo no apareciera nunca:
// medido el 25-sep-2026 cortando el primer pedido de 1 de cada 12 teselas, la
// plaza de Zipaquirá quedó con 11 huecos fijos. Aquí, cada falla programa una
// vuelta que las devuelve a UNLOADED (el próximo update() las vuelve a pedir)
// con espera creciente: 1, 2, 4... hasta 30 s. Un 404 de verdad deja de
// insistir tras `maximo` vueltas seguidas; la cuenta vuelve a cero cuando todo
// lo pedido llega. También reintenta el tileset raíz. `alReintentar` avisa al
// dueño del bucle de dibujo (el explorador solo pinta cuando se le pide).
export class ReintentoPlugin {
  constructor({ maximo = 8, alReintentar = null } = {}) {
    this.name = 'REINTENTO'
    this.maximo = maximo
    this.alReintentar = alReintentar
    this.vueltas = 0
    this.reloj = 0
    this.tiles = null
  }

  init(tiles) {
    this.tiles = tiles
    this._alFallar = () => {
      if (this.reloj || this.vueltas >= this.maximo) return
      const espera = Math.min(30000, 1000 * 2 ** this.vueltas)
      this.vueltas++
      this.reloj = setTimeout(() => {
        this.reloj = 0
        // No se usa tiles.resetFailedTiles(): en la 0.5.3 deja la tesela en
        // la caché LRU (lruCache.add() la rechaza por repetida y no se vuelve
        // a pedir nunca) y además revienta al recorrer hijas que aún no se
        // procesaron (no tienen `internal`). Se hace a mano: sacar cada
        // fallida de la caché (su callback la deja en UNLOADED) y poner la
        // cuenta en cero.
        const fallidas = []
        tiles.traverse(
          (t) => {
            if (t.internal?.loadingState === FAILED) fallidas.push(t)
            return false
          },
          null,
          false
        )
        for (const t of fallidas) {
          tiles.lruCache.remove(t)
          t.internal.loadingState = UNLOADED
        }
        tiles.stats.failed = 0
        if (tiles.rootLoadingState === FAILED) tiles.rootLoadingState = UNLOADED
        this.alReintentar?.()
      }, espera)
    }
    this._alTerminar = () => {
      if (!tiles.stats.failed) this.vueltas = 0
    }
    tiles.addEventListener('load-error', this._alFallar)
    tiles.addEventListener('tiles-load-end', this._alTerminar)
  }

  dispose() {
    clearTimeout(this.reloj)
    this.tiles.removeEventListener('load-error', this._alFallar)
    this.tiles.removeEventListener('tiles-load-end', this._alTerminar)
  }
}

export function hayWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}
