# Tubería de los vuelos

Los scripts que llevan un vuelo de dron desde la malla de fotogrametría hasta
las teselas que carga el explorador. Son el código tal como corrió en la máquina
de Sebastián (`D:\geoai-vuelos\tools`), copiado acá para que no viva solo en un
disco.

**Todavía no está empaquetada** (pendiente 15 en
[`docs/vuelos-pendientes/`](../docs/vuelos-pendientes/README.md)): no hay un
comando `procesar_vuelo`, cada paso se corre a mano y varios suponen Windows con
Git Bash. Los datos (OBJ, SLPK, teselas, DEM, geoide) no están en el repo.

## Rutas

Los scripts leen la carpeta de trabajo de variables de entorno, con la de la
máquina original como valor por defecto:

| Variable | Qué es | Por defecto |
| --- | --- | --- |
| `VUELOS_RAIZ` | Carpeta con los vuelos, el DEM y el venv | `D:/geoai-vuelos` |
| `VUELOS_TOOLS` | KTX-Software y `node_modules` de gltf-transform (solo `optimizar_tiles.sh`) | `D:/geoai-vuelos/tools` |
| `VUELOS_GEOIDE` | Grilla EGM96 (`us_nga_egm96_15.tif`) | `$VUELOS_RAIZ/tools/geoide/...` |
| `PYTHON` | Python con numpy, rasterio y pyproj | `$VUELOS_RAIZ/venv/Scripts/python.exe` |
| `KTX` | `ktx.exe` de KTX-Software | `D:/geoai-vuelos/tools/KTX/bin/ktx.exe` |
| `THREE_DIR` | three.js para el decodificador meshopt | `node_modules/three` de la app |
| `RCLONE` | rclone | el del PATH, o el de winget |

Dependencias de Node: `cd tuberia/node && npm install` (gltf-transform,
meshoptimizer, 3d-tiles-tools, obj2gltf). `slpk_a_tiles.mjs` además usa `sharp`
y `@gltf-transform/functions` desde ahí. `tc/` es un intento con
`@loaders.gl/tile-converter` que se descartó (ver la cabecera de
`slpk_a_tiles.mjs`); queda solo su `package.json`.

## Orden

### Vuelo con OBJ

El camino por el que salió el primer Tintal (`tintal/v1` en R2). Desde el
26-sep-2026 ningún vuelo publicado sale de acá: el Tintal se rehízo desde su
SLPK (`tintal/v2`). Queda para un vuelo que solo tenga OBJ.


1. `recentrar_obj.py`: pasa el OBJ de coordenadas UTM a un marco local.
2. `node/a-png.mjs`: texturas a PNG antes de Obj2Tiles, para que no las
   recomprima a JPEG 75.
3. **Obj2Tiles** (externo): corta la malla. De su salida solo se usan las hojas.
   `limpiar_tileset.py` quita los `null` que deja en el `tileset.json`.
4. `node/armar-tiles.mjs`: de las hojas de Obj2Tiles a 3D Tiles 1.1 (glb,
   meshopt, JPEG/KTX2), con ejes y `geometricError` rehechos.
5. `node/georref-tileset.mjs`: le pone el `root.transform` a ECEF (y la
   inclinación, si hace falta). `validar_georref.py` lo comprueba con vértices
   reales.
6. `asentar_en_terreno.py`: si el vuelo no tiene puntos de control, ajusta la
   altura del suelo de la malla a un DEM.
7. `huella_tileset.mjs`: el contorno real de la malla, como GeoJSON, a
   `content/vuelos/<slug>.huella.geojson`.
8. `residuo_terreno_aws.py`: cuánto flota o se hunde el borde de la malla
   contra el terreno de la escena; de ahí sale `escena.ajuste_altura_m`.
9. Subir a R2: `subir_r2.sh` (wrangler) o `subir_vuelos_rclone.sh` (rclone,
   con la clave en `rclone.conf`, que no está acá).

### Vuelo con SLPK (los ocho)

1. `slpk_a_tiles.mjs <archivo.slpk> <slug>`: de un SLPK de malla integrada a
   3D Tiles 1.1 en ECEF, con la huella y un informe de alturas. Hace los pasos
   4 a 8 de arriba en uno. Ojo con la sugerencia de ajuste de altura que
   imprime (pendiente 20).
   El Tintal se corrió solo, con `--salida D:/geoai-vuelos/tintal-slpk` (la
   carpeta `tintal/` es la del OBJ) y `--max-old-space-size=3072`: 10,5 GB de
   SLPK en unos 5 minutos, con menos de 400 MB de memoria.
2. `convertir_todos.sh`: corre el paso anterior sobre una lista de SLPK.
3. `armar_vuelos_slpk.mjs`: junta los `informe.json` en `vuelos-slpk.json`.
4. Subir a R2 con `subir_vuelos_rclone.sh`; `VERSION=v2` sube a otra carpeta de
   versión sin pisar la que está en producción.
5. La altura y la inclinación se calibran en el explorador contra el borde
   (`content/vuelos/README.md`, "Alturas" e "Inclinación"), no con la
   sugerencia del informe.

### Herramientas de medición

`optimizar_tiles.sh` (la versión anterior con gltfpack y KTX2 ETC1S),
`medir_tileset.py`, y en `node/`: `pesos.mjs`, `desglose.mjs`, `texdens.mjs`,
`jpegq.mjs`, `cajas.mjs`, `bbox.mjs`, `uvrango.mjs`, `comparar.mjs`, `lado.mjs`,
`recorte-obj.mjs`, `simplificar.mjs`. `node/decoder-three-1.1.mjs` es el
decodificador de meshoptimizer 1.1 (MIT, Arseny Kapoulkine), para comparar.

## R2

- `cors-vuelos.json`: la regla CORS del bucket. Acepta la galería
  (`galeria-vuelos.vercel.app`), `geoai-latam.inspow.tech` y localhost. La regla
  que manda es la del panel de Cloudflare: si se cambia allá, se actualiza acá.
- `worker-vuelos/`: un Worker de Cloudflare para servir el bucket con HTTP/2 y
  caché larga. **No está desplegado** (pendiente 4). Su lista de orígenes
  (`src/index.js`) ya incluye la galería y sus vistas previas.
