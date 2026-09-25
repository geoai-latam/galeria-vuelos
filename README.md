# Galería de vuelos · GeoAI LATAM

Los vuelos de fotogrametría con dron que he hecho en Bogotá, Cundinamarca,
Boyacá y Tolima, sobre un mapa 3D con el modelo de cada uno. La raíz (`/`) es el
explorador: todos los vuelos en una escena, con una lista al lado. Cada vuelo
tiene además su ficha en `/vuelos/<slug>`, y `/?v=<slug>` abre el explorador
sobre él.

Publicada en **https://galeria-vuelos.vercel.app**. Es un proyecto de
[GeoAI LATAM](https://geoai-latam.inspow.tech): empezó dentro de ese sitio y
desde el 25 de septiembre de 2026 vive aparte.

## Stack

- Next.js 16 (Pages Router), React 19, Tailwind 3 con el tema O2 del sitio.
- [MapLibre GL JS](https://maplibre.org) para el mapa, con el mapa base de
  [OpenFreeMap](https://openfreemap.org) y el terreno de
  [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium).
  El selector ofrece siete mapas base; todos abiertos menos Imágenes (Esri
  World Imagery, bajo los términos de Esri; ver `data/escena.js`).
- [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) sobre
  three.js para los modelos, que son 3D Tiles 1.1 (glb con meshopt y KTX2).
  Se ven todos los que caben en la vista, cada uno en el nivel de detalle que
  pide su distancia, sobre el terreno y un poco por encima para que su borde no
  se hunda (ver [`content/vuelos/README.md`](content/vuelos/README.md), "Cómo
  carga el explorador" y "Alturas").
- Las teselas de los modelos están en un bucket de Cloudflare R2. La base está en
  `data/escena.js` (`TILES_BASE`, apunta al bucket público; se puede cambiar con
  `NEXT_PUBLIC_VUELOS_TILES_BASE` al compilar).

## Correr en local

Node 20.9 o más nuevo.

```bash
npm install
npm run dev          # http://localhost:3000
npm run lint
npm run build && npm start
npm run validar      # después del build: una sola parada de tabulación por tarjeta
```

`predev` y `prebuild` copian el worker de MapLibre a `public/maplibre/` (está en
`.gitignore`).

Para ver los modelos en local, el CORS del bucket tiene que aceptar ese origen
(`http://localhost:3000`). En un puerto que no esté en la regla se ve el mapa y
las marcas, pero no los modelos.

## Agregar un vuelo

Un JSON en `content/vuelos/`, sin tocar código. Los campos, las alturas, la
huella y la miniatura están en [`content/vuelos/README.md`](content/vuelos/README.md).
Los scripts que producen las teselas están en [`tuberia/`](tuberia/README.md);
todavía se corren a mano.

## Desplegar en Vercel

1. Importar el repo en Vercel. Framework: Next.js. No hace falta ninguna
   variable de entorno: la base de las teselas ya apunta a R2, y el canonical y
   el sitemap toman la URL de producción que Vercel expone sola
   (`VERCEL_PROJECT_PRODUCTION_URL`).
2. Agregar la URL de Vercel a la regla CORS del bucket de R2
   (`tuberia/cors-vuelos.json` guarda la regla vigente). Sin eso se ve el mapa
   pero no los modelos. La de producción, `https://galeria-vuelos.vercel.app`,
   ya está.
3. Cuando haya dominio propio, definir `NEXT_PUBLIC_SITE_URL` (por ejemplo
   `https://vuelos.midominio.com`, sin barra final) y agregarlo también al CORS.

La ruta vieja `/vuelos` redirige a `/` y conserva el `?v=<slug>`.

## Pendiente

La lista viva está en [`docs/vuelos-pendientes/`](docs/vuelos-pendientes/README.md).

## Licencias

- Código: [Apache-2.0](LICENSE).
- Modelos 3D e imágenes de los vuelos (`public/images/vuelos/`, las teselas en
  R2): **CC BY 4.0, Sebastián Forero**. La atribución va en el mapa, junto a la
  de OpenFreeMap, OpenStreetMap y el terreno; si reutilizas un modelo, cítala así.
- `tuberia/node/decoder-three-1.1.mjs` es de meshoptimizer (MIT, Arseny
  Kapoulkine).
