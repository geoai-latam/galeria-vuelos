// Mapa base y terreno de la escena 3D de los vuelos (components/ui/VisorEscena.js).
//
// Los dos salen de servicios públicos que ya cubren el mundo entero, así que un
// vuelo nuevo no necesita teselas propias de terreno ni de mapa: basta con su
// tileset georreferenciado y su huella. Cambiar de proveedor es cambiar este
// archivo, y cambia para todos los vuelos a la vez.

// ─── Mapas base ───────────────────────────────────────────────────────
// El selector "Mapa base" del visor ofrece estos, en este orden; el primero es
// el que abre. Todos son gratuitos, sin clave y con CORS abierto; todos son
// abiertos menos Esri World Imagery (ver abajo). Cada uno trae la atribución
// que pide su licencia: el visor la pone en su pie, siempre visible, y la
// cambia con el mapa. Revisado el 25-sep-2026.
//
// Campos: `id`; `nombre` (lo que dice la tarjeta); `detalle` (el título largo);
// `tipo` "vector" (`url` es un estilo de MapLibre), "raster" (`url` es una
// plantilla {z}/{x}/{y}) o "imagen" (`url` es una plantilla raster y
// `etiquetas` un estilo de MapLibre del que solo se toman los nombres, que van
// encima de la imagen); `maxzoom` (solo raster: por encima MapLibre amplía la
// última tesela); `edificios3d` (solo vector: añade extrusiones del esquema de
// OpenMapTiles cuando el estilo no las trae; las que tocan la huella se
// quitan); `muestra`, tres colores del estilo (fondo, agua, vías) para la
// miniatura de la tarjeta, que así no pide ninguna tesela; `atribucion`, cada
// una con su `texto` y, si es largo, un `corto` para el renglón del teléfono
// (el texto completo queda a un toque, en "Créditos"), y `aparte: true` si la
// que sigue es de otro proveedor (el pie las separa con un punto medio).
// Opcionales: `cielo` ({ cielo, horizonte, niebla }) cuando el cielo y la
// niebla de papel del visor no le van al mapa (en uno oscuro lo lavan todo de
// gris), `colorEdificios` para las extrusiones que añade `edificios3d`, y
// `oscuro: true` cuando el mapa es oscuro o es una imagen: el contorno de las
// huellas de los vuelos se dibuja entonces en papel y no en verde bosque.
//
// OpenFreeMap (openfreemap.org, FAQ): instancia pública sin clave, sin
// registro, sin cookies y sin límite de vistas; el uso comercial está
// permitido. Atribución obligatoria: "OpenFreeMap © OpenMapTiles Data from
// OpenStreetMap". Los estilos son de OpenFreeMap (MIT) sobre el esquema de
// OpenMapTiles; los datos, de OpenStreetMap (ODbL). Hoy publica positron,
// bright, liberty, dark y fiord (tiles.openfreemap.org/styles/<nombre>, los
// cinco con CORS "*"); fiord se deja fuera por parecido a dark. Sus términos
// piden no bajar datos de forma automatizada sin permiso: las pruebas con
// Playwright miran pocas vistas y no barren el mapa.
//
// Sentinel-2 cloudless 2016 de EOX: la capa `s2cloudless_3857` del WMTS de
// tiles.maps.eox.at. Su GetCapabilities la publica bajo CC BY 4.0, con el
// texto de atribución que va abajo, y el servicio pide atribución en todo uso.
// OJO: solo 2016 y 2017 son CC BY. De 2018 en adelante (s2cloudless-2018_3857,
// ...-2025) son CC BY-NC-SA 4.0, no comerciales: no sirven aquí. Resolución de
// 10 m, así que de z15 para arriba se ve ampliada: da contexto, no detalle.
//
// Esri World Imagery (services.arcgisonline.com): imagen de menos de 1 m en
// Bogotá y en los cascos urbanos, a la escala de los vuelos. Es la ÚNICA del
// catálogo que NO es abierta: es de Esri y sus proveedores (Maxar, Earthstar),
// se ve sin clave y con atribución, pero bajo los términos de Esri
// (esri.com/en-us/legal/terms/full-master-agreement) y no bajo una licencia
// abierta: no se puede descargar, guardar ni redistribuir. Para uso en
// producción Esri pide una cuenta de ArcGIS Location Platform (tiene nivel
// gratuito) y su clave, que iría como `?token=` en `url`; está pendiente de
// decidir (docs/vuelos-pendientes/README.md). Atribución que pide la capa:
// "Esri, Maxar, Earthstar Geographics, and the GIS User Community". Los
// nombres de encima son de OpenFreeMap (abiertos, con su atribución).
//
// OpenTopoMap (opentopomap.org/about): CC-BY-SA; se puede usar en sitios y
// aplicaciones siempre que no se cargue el servidor con descargas masivas, y
// sin garantía de disponibilidad. Piden avisarles del uso. Atribución:
// "Kartendaten: © OpenStreetMap-Mitwirkende, SRTM | Kartendarstellung:
// © OpenTopoMap (CC-BY-SA)". Llega hasta z17.
const OSM = [
  { texto: 'OpenFreeMap', href: 'https://openfreemap.org' },
  { texto: '© OpenMapTiles', href: 'https://www.openmaptiles.org/' },
  { texto: '© colaboradores de OpenStreetMap', corto: '© OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
]
const OFM = 'https://tiles.openfreemap.org/styles/'

export const MAPAS_BASE = [
  {
    id: 'positron',
    nombre: 'Claro',
    detalle: 'OpenFreeMap Positron: claro, deja que la malla sea lo que se ve',
    tipo: 'vector',
    url: `${OFM}positron`,
    edificios3d: true,
    muestra: ['#f2f3f0', '#c2c8ca', '#ffffff'],
    atribucion: OSM,
  },
  {
    id: 'bright',
    nombre: 'Calles',
    detalle: 'OpenFreeMap Bright: calles, parques y agua en color',
    tipo: 'vector',
    url: `${OFM}bright`,
    edificios3d: true,
    muestra: ['#f8f4f0', '#aecfe2', '#fc8a3c'],
    atribucion: OSM,
  },
  {
    id: 'liberty',
    nombre: 'Colores',
    detalle: 'OpenFreeMap Liberty: en color y con sus propios edificios 3D',
    tipo: 'vector',
    url: `${OFM}liberty`,
    edificios3d: true,
    muestra: ['#f8f4f0', '#9ebdff', '#e9ac77'],
    atribucion: OSM,
  },
  {
    id: 'dark',
    nombre: 'Oscuro',
    detalle: 'OpenFreeMap Dark',
    tipo: 'vector',
    url: `${OFM}dark`,
    edificios3d: true,
    muestra: ['#0c0c0c', '#1b1b1d', '#4a4a4a'],
    cielo: { cielo: '#0d1f15', horizonte: '#1b1b1d', niebla: '#141414' },
    colorEdificios: '#2a2a2a',
    oscuro: true,
    atribucion: OSM,
  },
  {
    id: 'imagenes',
    nombre: 'Imágenes',
    detalle: 'Esri World Imagery con los nombres de OpenFreeMap encima',
    tipo: 'imagen',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    etiquetas: `${OFM}liberty`,
    maxzoom: 19,
    muestra: ['#4d5b3c', '#7c7563', '#2f4150'],
    cielo: { cielo: '#dfe6e8', horizonte: '#b9bcae', niebla: '#8e9180' },
    oscuro: true,
    atribucion: [
      {
        texto: 'Imágenes: Esri, Maxar, Earthstar Geographics y la comunidad de usuarios de SIG',
        corto: 'Imágenes © Esri, Maxar',
        aparte: true,
        href: 'https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9',
      },
      ...OSM,
    ],
  },
  {
    id: 'sentinel2-2016',
    nombre: 'Satélite 2016',
    detalle: 'Sentinel-2 cloudless 2016 de EOX: imagen de 10 m sin nubes',
    tipo: 'raster',
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
    maxzoom: 15,
    muestra: ['#5e6b45', '#8b7d5c', '#3c4f5a'],
    cielo: { cielo: '#dfe6e8', horizonte: '#b9bcae', niebla: '#8e9180' },
    oscuro: true,
    atribucion: [
      {
        texto:
          'Sentinel-2 cloudless 2016, EOxCloudless de EOX IT Services GmbH (contiene datos modificados de Copernicus Sentinel 2016), CC BY 4.0',
        corto: 'Sentinel-2 cloudless 2016 © EOX, CC BY 4.0',
        href: 'https://cloudless.eox.at',
      },
    ],
  },
  {
    id: 'opentopomap',
    nombre: 'Topográfico',
    detalle: 'OpenTopoMap: curvas de nivel y sombreado',
    tipo: 'raster',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    maxzoom: 17,
    muestra: ['#f3efdc', '#9fc8e8', '#c9dca3'],
    atribucion: [
      { texto: 'Datos: © colaboradores de OpenStreetMap, SRTM', corto: '© OpenStreetMap, SRTM', href: 'https://www.openstreetmap.org/copyright' },
      { texto: 'Estilo: © OpenTopoMap (CC-BY-SA)', href: 'https://opentopomap.org/about' },
    ],
  },
]

// ─── Dónde viven las teselas de los vuelos ────────────────────────────
// Las rutas relativas de `modelo.tileset` y `modelo.tileset_geo` en
// content/vuelos/*.json se unen a esta base (ver `urlVuelo` en lib/vuelos.js).
// Es el bucket público de Cloudflare R2 donde se suben los modelos; cada vuelo
// va en <slug>/v<N>/geo (el georreferenciado, para la escena) y <slug>/v<N>/local
// (el del visor del modelo solo). Subir una versión nueva es subir a v<N+1> y
// cambiar la ruta en el JSON: la caché de un visitante nunca mezcla dos.
// NEXT_PUBLIC_VUELOS_TILES_BASE la reemplaza al compilar (por ejemplo, un
// servidor local de teselas para probar), sin tocar ningún JSON.
export const TILES_BASE =
  process.env.NEXT_PUBLIC_VUELOS_TILES_BASE || 'https://pub-01086e2be5924d3f99feeea2dac34123.r2.dev'

// ─── Explorador: cuándo se cargan los modelos ─────────────────────────
// El explorador (/) tiene todos los vuelos en una escena. Al abrir, con los
// ocho vuelos en unos 300 km, solo baja las marcas y las huellas: a esa
// distancia cada huella es un punto. De ahí en adelante, todo vuelo con su
// capa prendida cuya huella esté en la vista (o a MARGEN_VISTA de ella) y mida
// en pantalla al menos MODELO_PX de radio carga su modelo; el elegido, siempre.
// No hace falta más criterio: 3d-tiles-renderer baja solo el nivel grueso de
// lo que queda lejos (el LOD, con errorTarget), y el detalle llega al
// acercarse. Se suelta al salir de la vista, al quedar por debajo de
// MODELO_PX_SALE (la diferencia evita que cargue y descargue sin parar cuando
// la vista ronda el límite) o al apagar la capa, y suelta teselas, texturas y
// memoria de la GPU.
//
// Como mucho hay MODELOS_MAX vivos (MODELOS_MAX_TELEFONO en una pantalla
// chica), el elegido primero y después los más grandes en pantalla. En
// escritorio el tope es el número de vuelos: no corta nada. La memoria la
// limita la caché de teselas, que es una sola para todos los modelos (ver
// cacheMb en components/ui/EscenaVuelos.js). Medido el 25-sep-2026 (ver
// content/vuelos/README.md, "Cómo carga el explorador"). Hasta ese día un
// modelo solo cargaba elegido o llenando una décima de la vista, con tres vivos
// como mucho, y se veía un solo modelo en un mapa lleno de huellas vacías.
export const MODELO_PX = 12
export const MODELO_PX_SALE = 8
export const MARGEN_VISTA = 0.25
export const MODELOS_MAX = 8
export const MODELOS_MAX_TELEFONO = 8

// Encuadre de "Ir al vuelo" cuando el JSON no trae `escena.camara`: la cámara
// sale del sur-suroeste, a 30° sobre el horizonte (inclinación 60°). Sin
// huella, el vuelo se encuadra como un círculo de RADIO_SIN_HUELLA_M.
export const VISTA_VUELO = { azimut_grados: 205, elevacion_grados: 30 }
export const RADIO_SIN_HUELLA_M = 500

// ─── Ajuste de altura por defecto ─────────────────────────────────────
// Lo que el visor suma a la altura del modelo cuando el vuelo no trae
// `escena.ajuste_altura_m` (ver content/vuelos/README.md, "Alturas"). El
// control "Ajuste de altura" del visor se mueve AJUSTE_RANGO_M metros a cada
// lado de cero, en pasos de AJUSTE_PASO_M.
export const AJUSTE_ALTURA_M = 0
export const AJUSTE_RANGO_M = 30
export const AJUSTE_PASO_M = 0.1

// ─── Margen sobre el terreno ──────────────────────────────────────────
// Lo que la escena sube TODOS los modelos por encima de su ajuste. El ajuste
// de cada JSON deja la MEDIANA del borde de la malla sobre el terreno (0 m),
// así que media malla queda por debajo: el DEM de 30 m no sigue cada andén ni
// cada zanja, y en Castilla y Zipaquirá había calles del borde 2-3 m bajo el
// terreno. Este margen es uniforme y va aparte del ajuste: el control "Altura"
// y `escena.ajuste_altura_m` siguen hablando del residuo medido, sin él. Un
// vuelo que necesite más lo pide en su propio ajuste. Medido el 25-sep-2026
// con vistas rasantes (ver content/vuelos/README.md, "Alturas").
export const MARGEN_SUELO_M = 1.5

// ─── Terreno ──────────────────────────────────────────────────────────
// Terrain Tiles de AWS Open Data (Tilezen, antes Mapzen): Terrarium PNG,
// global, sin clave y con CORS abierto. En Colombia el dato de fondo es SRTM
// de 30 m; hasta z15 AWS solo lo interpola, pero z15 (4,8 m por píxel) hace
// falta para que el borde donde se hunde el terreno bajo la malla (ver
// `HUNDIR_M`) caiga donde está el borde de verdad y no 20 m al lado.
//
// Las alturas son ORTOMÉTRICAS (SRTM, geoide EGM96), y MapLibre las usa como
// altura sobre el nivel del mar. El modelo del vuelo está en altura
// elipsoidal: el visor lo baja `escena.geoide_m` (N de EGM96 en el sitio; en el
// Tintal 21,02 m, no los 22,18 de EGM2008) y le suma `escena.ajuste_altura_m`,
// el residuo medido contra este terreno (tuberia/residuo_terreno_aws.py).
export const TERRENO = {
  url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  maxZoom: 15,
  // Atribución que pide Tilezen para las fuentes que cubren Colombia (SRTM y
  // GMTED2010 del USGS, ETOPO1 de NOAA); la lista por región está en el enlace.
  atribucion: {
    texto: 'Terreno: Terrain Tiles de AWS; SRTM y GMTED2010 cortesía del USGS, ETOPO1 de NOAA',
    corto: 'Terreno: AWS, USGS, NOAA',
    href: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  },
}

// Cuánto se hunde el terreno debajo de la malla, y en cuántos metros hacia
// adentro del borde llega a esa profundidad. El DEM de 30 m sobresale entre 1 y
// 5 m del piso fotografiado y lo taparía a parches; ArcGIS hace lo mismo con
// sus mallas integradas. En el borde mismo el terreno queda intacto, así que la
// malla empalma con el mapa de alrededor.
export const HUNDIR_M = 12
export const RAMPA_M = 40
