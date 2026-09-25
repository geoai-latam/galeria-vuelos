# vuelos-teselas: el Worker de las teselas

Sirve el bucket R2 `vuelos` para el explorador de GeoAI LATAM (/vuelos) en lugar
de la URL de desarrollo `pub-01086e2be5924d3f99feeea2dac34123.r2.dev`.

**No está desplegado.** Desplegarlo crea un Worker en la cuenta de Cloudflare y
eso lo aprueba Sebastián.

## Por qué

Medido el 25-sep-2026 con Chromium, desde Bogotá, contra r2.dev:

- r2.dev responde en **HTTP/1.1**. El navegador abre como mucho 6 conexiones
  al mismo servidor y el renderer pide 25 teselas a la vez: el resto hace fila
  dentro del navegador. Acercarse de 250 a 40 m en el Humedal El Burro pidió 92
  teselas; la primera tanda salió a los 33 ms y la última cabecera llegó a los
  900 ms, a razón de 6 cada ~150 ms.
- Sin caché en el borde: cada pedido va hasta R2 (ENAM). TTFB de 280-340 ms
  con la conexión ya abierta (el TCP al POP de Miami tarda 74 ms), 2,8 s el
  primero.
- `Cache-Control: max-age=300`: a los 5 minutos el navegador vuelve a
  preguntar por cada tesela aunque la ruta sea versionada (`v1`).
- r2.dev tiene límite de pedidos y Cloudflare lo da solo para desarrollo. En
  ráfagas de 32 pedidos desde Node hubo cortes de conexión (`ConnectTimeout`).

Lo que hace este Worker: HTTP/2 y HTTP/3, `Cache-Control: public,
max-age=31536000, immutable` en `/<slug>/v<N>/...`, caché en el borde de esas
rutas (Cache API), CORS para `https://galeria-vuelos.vercel.app`,
`https://geoai-latam.inspow.tech`, `http://localhost:3000`,
`http://localhost:3111` y las vistas previas de la galería en Vercel
(`galeria-vuelos-*.vercel.app`), `Range`, `Content-Type` por extensión
(`.glb` = `model/gltf-binary`, `.json`, `.ktx2`...), 304 con `If-None-Match`,
404 y 405.

## Probarlo sin Cloudflare

```bash
cd tuberia/worker-vuelos
node prueba/prueba.mjs      # R2 y Cache API de mentira; 8 grupos de pruebas
```

## Desplegar (cuando se apruebe)

```bash
cd tuberia/worker-vuelos
npx wrangler@4 login        # una vez: abre el navegador
npx wrangler@4 deploy
```

Queda en `https://vuelos-teselas.<subdominio-de-la-cuenta>.workers.dev`
(wrangler lo imprime al final). Comprobar antes de cambiar el sitio:

```bash
curl -sI -H "Origin: https://geoai-latam.inspow.tech" \
  https://vuelos-teselas.<subdominio>.workers.dev/tintal/v1/geo/tileset.json
# 200, content-type: application/json, cache-control: ...immutable,
# access-control-allow-origin: https://geoai-latam.inspow.tech
```

### El cambio en el sitio: una línea

En `data/escena.js`, la base de las teselas:

```js
export const TILES_BASE =
  process.env.NEXT_PUBLIC_VUELOS_TILES_BASE || 'https://vuelos-teselas.<subdominio>.workers.dev'
```

Los JSON de `content/vuelos/` guardan rutas relativas, así que no se toca
ninguno. Para probar antes sin tocar el archivo:
`NEXT_PUBLIC_VUELOS_TILES_BASE=https://vuelos-teselas.<subdominio>.workers.dev npm run build`.

### workers.dev o dominio propio

- **En `*.workers.dev`** ya hay HTTP/2/3 y la caché larga del navegador, pero
  según la documentación de Cloudflare la **Cache API no guarda nada** en
  workers.dev: cada pedido sigue yendo a R2.
- **Para la caché en el borde** hace falta un dominio propio en una zona de
  Cloudflare. `inspow.tech` tiene hoy el DNS en Route 53 de AWS, así que no
  sirve tal cual: o se usa otro dominio que esté en Cloudflare, o se mueve el
  DNS. Con el dominio, descomentar `routes` en `wrangler.toml` y volver a
  desplegar.
- Alternativa sin Worker: conectar un dominio propio directamente al bucket
  (R2 > Settings > Custom Domains) y una regla de caché. También necesita la
  zona en Cloudflare, y no controla los CORS por origen tan fino como este
  Worker.

## Cuánto se espera ganar

Estimado sin desplegar, el 25-sep-2026: la misma sesión de Playwright (ir al
vuelo y acercarse a 250, 100 y 40 m en cinco puntos) con las teselas servidas
por un servidor local que imita el origen. Calibrado en HTTP/1.1 con TTFB de
150 ms y 6 MB/s por pedido, da los tiempos de r2.dev con un 10 % de error.
Suma de los 15 pasos (hasta que no queda nada por bajar):

| Vuelo | como r2.dev (HTTP/1.1) | HTTP/2, mismo TTFB | HTTP/2 + borde (75 ms) |
|---|---|---|---|
| Humedal El Burro | 47 s | 34 s (-28 %) | 33 s |
| Zipaquirá | 35 s | 25 s (-29 %) | 25 s sin el paso atípico |
| Tintal | 28 s | 29 s (igual) | 28 s |

Casi toda la ganancia es HTTP/2, que ya da workers.dev. La caché del borde
suma poco en la primera visita; lo que sí da el Worker es no volver a pedir
nada al regresar (inmutable). El Tintal no mejora porque su cuello no es la
latencia sino el peso: 341 teselas con texturas JPEG de hasta 1276x4096 (480
MB bajados en la sesión). Eso se arregla en el tileset (texturas KTX2 o
teselas más chicas), no en el servidor.
