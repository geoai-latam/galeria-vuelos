# Vuelos de dron

Cada archivo `*.json` de esta carpeta es un vuelo, y el nombre del archivo es el
slug: `tintal.json` aparece en el explorador (la raíz `/`, y `/?v=tintal`
abre el explorador sobre él) y tiene su ficha en `/vuelos/tintal`. Los que
empiezan por `_` (como `_template.json`) no se publican. Para agregar un vuelo,
copia la plantilla y llénala; no hace falta tocar ningún `.js`.

## Las dos páginas

- **El explorador, `/`** (`components/sections/o2-explorador.js` y
  `components/ui/EscenaVuelos.js`): un mapa 3D a pantalla entera con todos los
  vuelos, y un panel con la lista (a la izquierda en pantallas anchas, una hoja
  que sube desde abajo en el teléfono). Cada vuelo tiene una marca en el mapa,
  una diana de punto de control, verde si tiene modelo y ocre si está en
  proceso, y el contorno de su huella si la tiene. Elegir un vuelo en la lista
  (o su marca) lleva la cámara hasta él y lo pone en la URL: `/?v=<slug>`
  (o `/#<slug>`; la ruta vieja `/vuelos?v=<slug>` redirige acá) abre el explorador ya encuadrado ahí.
- **La ficha, `/vuelos/<slug>`** (`components/sections/o2-vuelos.js`): para
  compartir y para los buscadores. Los datos del vuelo, la vista previa como
  enlace grande al explorador y, si el modelo ya está publicado, el visor del
  modelo solo (sin mapa), que no se carga hasta que se pide. Sale en el
  sitemap.

Regla de la carpeta: lo que no se sabe va en `null` o `""`. La página esconde
los campos vacíos, así que un dato inventado se nota más que uno que falta.

## Campos

| Campo | Tipo | Qué va |
| --- | --- | --- |
| `title` | texto | Nombre corto. Es el título de la tarjeta y de la página. |
| `lugar` | texto | Qué se voló: un parque, un barrio, un edificio. |
| `municipio` | texto | Municipio, y la localidad entre paréntesis si es Bogotá. |
| `fecha` | texto ISO | `"2026-01-31"`. Si solo sabes el mes, `"2026-02"`: la página muestra el mes sin día. |
| `lat`, `lon` | número | Grados decimales, WGS84. |
| `coordenadas_aprox` | booleano | `true` si las coordenadas son de referencia y no del vuelo. La página lo avisa. |
| `dron` | texto o `null` | Por ejemplo `"DJI Mini 5 Pro"`. |
| `camara` | texto o `null` | El modelo que trae el EXIF, por ejemplo `"DJI FC9313 (50 MP)"`. |
| `fotos` | entero o `null` | Cuántas fotos entraron al procesamiento. |
| `altura_m` | número o `null` | Altura de vuelo sobre el despegue, en metros. |
| `captura` | `"nadir"`, `"nadir y oblicuas"` o `null` | |
| `gsd_cm` | número o `null` | Solo si lo mediste o lo reporta el software. En cm por píxel. |
| `descripcion` | texto | Una o dos frases, sin adjetivos de venta. |
| `estado` | `"publicado"` o `"en proceso"` | |
| `modelo.tipo` | `"3dtiles"` | Por ahora es el único formato que carga el visor. |
| `modelo.tileset` | texto | Ruta del `tileset.json` en marco local, el del visor del modelo solo en la ficha (ver "La URL del tileset"). Vacío: no hay visor en la ficha. |
| `modelo.peso_inicial_mb` | número o `null` | Lo que baja la primera vista, medido. Sale en el botón de carga. |
| `modelo.zUp` | booleano, opcional | `true` si el tileset viene con Z hacia arriba y no está georreferenciado. |
| `modelo.up` | texto, opcional | El eje vertical cuando no es ni Y ni +Z, por ejemplo `"-z"`. Gana sobre `zUp`. |
| `modelo.tileset_geo` | texto, opcional | Ruta del `tileset.json` GEORREFERENCIADO (con `root.transform` a ECEF, el que arma `georref-tileset.mjs`). Con este campo y `escena.geoide_m` el vuelo cuenta como "con modelo 3D" y su malla aparece en el explorador. Mismas reglas de URL que `tileset`. |
| `<slug>.huella.geojson` | archivo aparte, opcional | La huella real de la malla (un polígono lon/lat de pocas decenas de vértices). La escena hunde el terreno dentro de ella y quita los edificios 3D y los nombres del mapa que la tocan. Se genera, no se dibuja a mano (ver abajo). |
| `escena.geoide_m` | número | Ondulación del geoide **EGM96** en el sitio, en metros. El visor baja el modelo esa cantidad (ver abajo). Tintal: `21.02`. |
| `escena.ajuste_altura_m` | número, opcional | Residuo vertical medido contra el terreno de la escena **en el borde de la malla**; el visor lo **suma** a la altura del modelo (positivo lo sube). Sin el campo vale `AJUSTE_ALTURA_M` de `data/escena.js` (hoy `0`). Aparte, la escena sube todos los modelos `MARGEN_SUELO_M` (ver "Alturas"); ese margen no va en el JSON. Tintal: `-67.79`. Se puede afinar a ojo con el control "Altura" de la escena (ver abajo). |
| `escena.suelo_borde_m` | número, opcional | Mediana del terreno de la escena en los vértices de la huella, en metros. Con el terreno apagado el suelo queda a 0 m: el visor baja el modelo esa altura para que su borde se apoye en el plano. Sin el campo, sale del punto más bajo de la malla ya cargada. Se mide con el terreno prendido (`map.queryTerrainElevation` en el anillo de la huella). |
| `escena.inclinacion` | objeto, opcional | `{ "este": 0.009, "norte": 0.032, "z_pivote": -9.5 }`: cuánto sube la malla respecto del terreno por cada metro hacia el este y hacia el norte, y la altura de su suelo en el marco local. La escena la gira para quitarlo (ver "Inclinación"). Sin el campo, va como viene. |
| `escena.camara` | objeto u `null`, opcional | Encuadre de "Ir al vuelo" en el explorador: `azimut_grados` (desde dónde mira la cámara, 0 = norte, 90 = este), `elevacion_grados` y `distancia_m`, cada uno opcional. Sin él vale `VISTA_VUELO` de `data/escena.js` (desde el sur-suroeste, 205°, a 30° sobre el horizonte) y la distancia en que cabe la huella al lado del panel. |
| `escena.peso_inicial_mb` | número o `null` | Lo que baja la primera vista de la escena (modelo, terreno y mapa), medido. |
| `miniatura` | ruta o `""` | Vista previa del vuelo, en `public/images/vuelos/<slug>.jpg`: 800×500, JPEG de calidad 80 (unos 60 KB). Sale en la tarjeta del explorador, en la ficha y como imagen al compartir. Para los vuelos con modelo se saca de la escena misma, a una distancia en la que no se reconoce a nadie (ver abajo). Vacío: sale la retícula con la diana. |
| `licencia` | texto | Licencia del modelo 3D. |

## La URL del tileset

Las teselas viven en un bucket público de Cloudflare R2, cuya dirección está
una sola vez en `TILES_BASE` de `data/escena.js`. Cada vuelo va en
`<slug>/v<N>/geo/` (el georreferenciado) y `<slug>/v<N>/local/` (el del visor
del modelo solo); una versión nueva del modelo se sube a `v<N+1>` y se cambia la
ruta en el JSON, así la caché de nadie mezcla dos versiones.

`modelo.tileset` y `modelo.tileset_geo` aceptan tres formas:

- Una ruta relativa (`tintal/v2/geo/tileset.json`): se une a `TILES_BASE`. Es
  la forma normal. La variable `NEXT_PUBLIC_VUELOS_TILES_BASE`, si está
  definida al compilar, reemplaza a `TILES_BASE` (por ejemplo, para probar con
  un servidor local de teselas) sin tocar ningún JSON.
- Una URL completa (`https://...`): se usa tal cual.
- Una ruta que empieza por `/`: se sirve desde `public/`. Solo para pruebas; las
  teselas de un vuelo pesan demasiado para el repo.

El bucket tiene que responder con CORS para el dominio de la app (y para
`http://localhost:3000` si se prueba en local; la regla está en
`tuberia/cors-vuelos.json`). Un dominio que no esté en su
lista ve el mapa y las marcas, pero no el modelo.

## Cómo carga el explorador

Con todos los vuelos a la vista (la vista inicial y "Ver todos"), el explorador
baja el mapa base, el terreno, las marcas y las huellas, y ni una tesela de
modelo: 2,7 MB en escritorio y 1,6 MB en el teléfono. A esa escala cada huella
es un punto.

De ahí en adelante se ven **todos** los modelos que caben en la vista, no solo
el del vuelo elegido. Un modelo se carga cuando su capa está prendida (el ojo de
su tarjeta, o "Capas") y su vuelo está elegido, o su huella está en la vista (o
a un cuarto de pantalla de ella, `MARGEN_VISTA`) y mide al menos 12 px de radio
(`MODELO_PX`, en `data/escena.js`). Se suelta al salir de la vista, al bajar de
8 px (`MODELO_PX_SALE`) o al apagar la capa, y suelta la memoria de la GPU. Lo
que controla el costo es el LOD de 3d-tiles-renderer: de un modelo lejano baja
solo su nivel grueso, y el detalle llega al acercarse. La caché de teselas es
una sola para todos (1,5 GB en escritorio, 0,6 GB en el teléfono), así que la
memoria no crece con el número de modelos. El tope (`MODELOS_MAX`) es 8 en los
dos, el número de vuelos: no corta nada.

Medido el 25-sep-2026 con el build local, Chromium, 1440×900 y 390×844:

| Vista | Escritorio | Teléfono |
| --- | --- | --- |
| Al abrir, y "Ver todos" | 0 modelos, 2,7 MB | 0 modelos, 1,6 MB |
| Bogotá, los cinco vuelos en el cuadro | 5 modelos, +6 MB, caché 50 MB | 3 modelos (los otros dos miden menos de 12 px), +4 MB, caché 42 MB |
| Biblioteca El Tintal elegido | 3 modelos (Tintal, Humedal, Rotonda), caché 112 MB, montón JS 143 MB | 3 modelos, caché 46 MB, montón JS 56 MB |
| Rasantes en Kennedy, a 75-80° | | hasta 5 modelos, caché 115 MB de 600, montón JS 188 MB |

En ninguna hubo teselas rechazadas por caché llena, teselas fallidas ni contexto
WebGL perdido, así que el teléfono no tiene un tope menor. Hasta ese día un
modelo solo cargaba elegido o llenando una décima de la vista, con tres vivos
como mucho (dos en el teléfono), y se veía un modelo en un mapa lleno de
huellas vacías.

La escena no muestra cuánto lleva bajado. El aviso de abajo a la izquierda (en el
teléfono, arriba) sale solo cuando hay algo que decir: "Cargando el mapa", un
modelo que tarda más de 1,2 s en dar su primera vista ("Cargando el modelo 3D")
o una falla. La cuenta de bytes sigue en `window.__escenaVuelos.bytes()`
para las pruebas, y el recuadro de `/?debug=1` da el resto.

Una tesela que falla al bajar (un corte de red, un límite de r2.dev) se vuelve
a pedir sola, con espera creciente de 1 a 30 s (`ReintentoPlugin` en
`components/ui/visor-comun.js`). Sin eso quedaba un hueco fijo en el modelo
hasta recargar la página.

Para medir, `/?debug=1` pone un recuadro con el estado de las teselas de
cada vuelo vivo: a la vista, en cola, bajando, fallidas, cuánto ocupa la caché
y cuántas rechazó por llena, y el tiempo de los últimos pedidos. Con `debug=1`
también se prueban los topes sin recompilar (`&et=`, `&jobs=`, `&lru=`...; la
lista está en `EscenaVuelos.js`), y `window.__escenaVuelos.estadoTeselas()` y
`.pedidos()` dan lo mismo a Playwright.

## La escena: los modelos dentro de un mapa 3D

Si el vuelo tiene `modelo.tileset_geo` y `escena.geoide_m`, su malla entra en
el mapa del explorador (`components/ui/EscenaVuelos.js`). Es un mapa de
MapLibre GL con terreno, y cada malla entra como una capa más, con la misma
cámara. El terreno y el mapa no son del vuelo: salen de
servicios públicos que cubren el mundo entero, configurados una sola vez en
`data/escena.js` (mapas base: el catálogo `MAPAS_BASE`, que abre con el
positron de OpenFreeMap; terreno: Terrain Tiles de AWS). Un vuelo nuevo aporta
su tileset georreferenciado, dos números y su huella.

Se navega como en ArcGIS: arrastrar mueve, el clic derecho gira e inclina
alrededor del punto que está bajo el cursor, la rueda acerca hacia el cursor, y
en el teléfono un dedo mueve y dos pellizcan, giran e inclinan.

### Los controles del mapa

Una columna de botones a la derecha, debajo de la brújula. **Ver todos**
encuadra todos los vuelos; los otros tres abren cada uno su ventanita (Escape
la cierra):

- **Mapa base**: los mapas de `MAPAS_BASE` en `data/escena.js`. Hoy son siete:
  cuatro estilos vectoriales de OpenFreeMap (Claro, Calles, Colores, Oscuro),
  Imágenes (Esri World Imagery, con los nombres de OpenFreeMap encima en blanco
  con halo oscuro), la imagen Sentinel-2 cloudless 2016 de EOX y OpenTopoMap.
  Todos son abiertos menos Imágenes: Esri se ve sin clave y con atribución, pero
  bajo sus términos, y para producción pide una cuenta de ArcGIS Location
  Platform (pendiente de decidir, ver `docs/vuelos-pendientes/`). La licencia de
  cada uno, y los que se descartaron, están comentados ahí mismo; el pie de la
  escena cambia la atribución con el mapa. Cambiar de mapa no vuelve a bajar el modelo: se
  conservan las teselas y solo se vuelve a añadir la capa.
- **Capas**: prende y apaga el modelo de cada vuelo (lo mismo que el ojo de su
  tarjeta), el contorno de los vuelos, los edificios 3D del mapa, los nombres y
  lugares, el terreno y el hundimiento bajo los modelos. Los edificios y los
  nombres se reconocen por tipo de capa (`fill-extrusion` y `symbol`), así que
  funcionan con cualquier estilo; si el mapa base no los trae, el interruptor
  sale desactivado. Sin terreno, MapLibre pone el suelo a 0 m, y el modelo baja
  la altura que tenía el terreno en el borde de la huella (la mediana en sus
  vértices), para seguir apoyado en el plano en vez de flotar a 2.500 m.
- **Altura**: el ajuste de altura del vuelo elegido en la lista, abajo.

Lo que se elige dura mientras el explorador esté abierto; al recargar vuelve a lo
de `data/escena.js` y al JSON del vuelo.

### Alturas

Las alturas del terreno de AWS son ortométricas (en Colombia vienen de SRTM,
referidas al geoide EGM96) y MapLibre las usa tal cual. El modelo
georreferenciado está en altura elipsoidal (h = H + N), así que el visor lo baja
N metros: `geoide_m` tiene que ser el N de **EGM96**, no el de EGM2008 (en el
Tintal son 21,02 m contra 22,18). N en otro sitio sale de PROJ con la grilla
`us_nga_egm96_15.tif`.

Lo que queda después de eso se corrige con `ajuste_altura_m`, y se mide en el
**borde** de la malla, que es donde se ve si flota o se entierra (adentro el
terreno está hundido y no se ve). Dos formas de medirlo:

- `tuberia/residuo_terreno_aws.py --vuelo <carpeta> --geoide <N>`:
  la línea "suelo abierto del BORDE" es la que cuenta. Ojo con su "sugerencia",
  que sale del suelo abierto de adentro: ahí SRTM mide techos y árboles y queda
  alto, así que la sugerencia sube de más el modelo.
- En el explorador, con el modelo cargado:
  `window.__escenaVuelos.residuoBorde('<slug>')` da la diferencia malla menos
  terreno (sin hundir) a 3 m del borde. Positivo: flota. Se resta la mediana al
  `ajuste_altura_m` que había. Así quedaron los ocho vuelos el 25-sep-2026: los
  siete que salieron de un SLPK traían el ajuste del suelo abierto de adentro, y
  flotaban entre 0,5 y 4,7 m.

La tercera forma es a ojo, con el botón **Altura** del explorador, sobre el
vuelo elegido: un deslizador
y una casilla que mueven el modelo entre -30 y +30 m (`AJUSTE_RANGO_M`), en
pasos de 0,1 m (`AJUSTE_PASO_M`), a partir del valor del JSON. Solo mueve el
ancla del modelo: no vuelve a pedir teselas. **Restablecer** vuelve al valor del
JSON y **Copiar valor** copia el número con punto decimal, listo para pegarlo en
`escena.ajuste_altura_m`. Nada de eso se guarda: el valor que se publica es el
del JSON.

### Inclinación

Una malla sin puntos de control puede quedar ladeada contra el terreno: la
Biblioteca Virgilio Barco subía 33 m por km hacia el norte-noreste y Cerinza 68
hacia el oeste, así que con una sola altura un lado flotaba y el otro se
enterraba. `escena.inclinacion` lo corrige en la escena, sin tocar las
teselas: gira el modelo alrededor de la altura de su suelo (`z_pivote`) hasta
que ese plano quede horizontal. Es una rotación y no un corte, así que las
paredes siguen verticales; es la misma cuenta que `georref-tileset.mjs` le
aplicó al primer Tintal, el que salió de un OBJ, al georreferenciarlo.

Se mide con `window.__escenaVuelos.residuoBorde('<slug>', 6, 4, true)`: con el
cuarto argumento devuelve cada punto del borde (`[este, norte, residuo, z]`), y
un plano ajustado por mínimos cuadrados a (este, norte, residuo) da `este` y
`norte`; la mediana de `z` es `z_pivote`. `__escenaVuelos.inclinar(slug, {...})`
prueba un valor sin recompilar. Después de enderezar, se vuelve a medir el
residuo y se corrige `ajuste_altura_m` con su mediana.

Medido el 25-sep-2026, contra el residuo de `slpk_a_tiles.mjs` (su `plano`, que
apunta hacia el mismo lado en todos): Virgilio Barco 33 m/km, Cerinza 68,
Ibagué 26, Castilla 24, Zipaquirá 14, Humedal El Burro 10. La Rotonda (3) queda
como viene. El Tintal rehecho desde su SLPK (26-sep-2026) subía 32 m/km hacia el
noroeste. Enderezados, el residuo del borde queda por debajo de 5 m/km en todos
(el Tintal, 2).

El hundimiento del terreno no depende del ajuste: baja `HUNDIR_M` (12 m) desde
el terreno, no desde la malla. Mientras el ajuste deje el piso de la malla a
menos de esos 12 m por debajo del terreno, el terreno hundido no la tapa; un
ajuste que la baje más ya está mal por sí solo, porque el borde queda enterrado.

En el Tintal quedó `-67.79`, con la inclinación de arriba: la mediana del
borde en 0 m (1,5 con el margen) y un rango intercuartil de unos 12 m a 3 m del
borde, que es SRTM de 30 m contra andenes y zanjas, no un plano torcido (el
plano que queda es de 2 m/km). Si hay que elegir, más vale enterrada un par de metros que
flotando: el terreno tapa un borde de la malla, pero una malla que flota deja
ver el hueco por debajo.

#### El margen sobre el terreno

El ajuste deja la **mediana** del borde en 0 m, así que medio borde queda por
debajo del terreno: SRTM de 30 m no sigue cada andén ni cada zanja. Por eso la
escena sube todos los modelos `MARGEN_SUELO_M` (1,5 m, en `data/escena.js`)
encima de su ajuste. Va aparte del JSON: el control "Altura" y
`ajuste_altura_m` siguen hablando del residuo medido, sin el margen.

Se eligió con `residuoBorde(slug, 6, 2)` (a 2 m del borde) y vistas rasantes a
80° desde los cuatro lados, el 25-sep-2026. El cuartil bajo del borde (p25) pasó
de negativo a cerca de cero en la Rotonda (-0,9 → 0,7 m), la Virgilio Barco
(-0,7 → 0,8), Cerinza (-1,2 → 0,3) y Castilla (-1,7 → -0,2), y Zipaquirá quedó
en -1,0 (antes -2,5): sus calles del borde ya no se hunden. La mediana queda
entre 1,6 y 3,1 m, y a esa altura no se ve flotar. Más margen empezaba a
despegar la Virgilio Barco. El Humedal (-2,6) no se arregla subiendo: su borde
se reparte en unos 10 m contra SRTM, y lo que ganara un lado lo haría flotar del
otro. El Tintal tenía el mismo problema (p25 -5,5) mientras salió del OBJ;
rehecho desde su SLPK y enderezado, queda con p25 0,6 m y mediana 3,9 m a 2 m
del borde (26-sep-2026).

### La huella

La huella es el contorno real de la malla, no su rectángulo. Se genera desde las
teselas más finas del tileset georreferenciado:

```bash
node tuberia/huella_tileset.mjs \
  --tileset <carpeta-del-vuelo>/<vuelo>-geo/tileset.json \
  --salida content/vuelos/<slug>.huella.geojson \
  --three <repo>/node_modules/three
```

Lee solo las posiciones de las hojas, las marca en una grilla de 2 m, cierra los
huecos, sigue el borde y lo simplifica con Douglas-Peucker hasta que queden 48
vértices o menos. El archivo pesa un par de KB y se versiona; el explorador lo
lee en el build. Con ella dibuja el contorno del vuelo y lo encuadra, y
mientras la capa del modelo está prendida:

- hunde el terreno 12 m debajo de la malla, con una rampa de 40 m hacia adentro
  desde el borde (en el borde mismo el terreno queda intacto);
- quita los edificios 3D del mapa que tocan la huella o quedan a menos de 1 m, y
  los nombres a menos de 15 m.

Sin huella la escena funciona, pero el terreno tapa el piso de la malla a parches
y los edificios del mapa la atraviesan. Varias huellas a la vez funcionan igual:
cada una hunde y limpia solo lo suyo (`crearPesoHuellas` y
`filtroFueraDeHuellas` en `components/ui/escena-huella.js`).

## La miniatura de un vuelo con modelo

Se saca de la escena misma, sin el panel ni las marcas: el explorador con
`?v=<slug>` a 800×500 y densidad 2, el contorno apagado, una vista a unos 58°
de inclinación que deje ver la malla entera, y la captura reducida a 800×500
con calidad 80. A esa distancia no se reconoce a nadie, que es la regla de
abajo.

## Qué se publica y qué no

Solo el modelo 3D. No se publican fotos sueltas ni el ortomosaico a resolución
completa: en un barrio salen caras, placas y patios, y la malla texturizada ya
cuenta el lugar sin eso.

## Pendiente

La `licencia` de todos los vuelos está en `"CC BY 4.0"` como valor provisional.
Falta que Sebastián la confirme.
