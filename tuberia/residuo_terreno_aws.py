"""residuo_terreno_aws.py: mide cuanto flota o se hunde una malla georreferenciada
sobre el terreno que usa la escena 3D del sitio (Terrain Tiles de AWS Open Data,
Terrarium), en el BORDE de la malla, que es donde se ve.

Contexto: la escena del sitio (components/ui/VisorEscena.js) no pre-genera
terreno: usa las teselas globales
  https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
Esas alturas son ORTOMETRICAS (en Colombia salen de SRTM, sobre EGM96), pero
TerrariumMeshPlugin las pone directo sobre el elipsoide WGS84. Para que la malla
(ECEF, h = H + N) quede sobre ese terreno, el visor la BAJA N metros
(escena.geoide_m del JSON del vuelo). La correccion vertical de la malla se
ajusto contra Copernicus GLO-30, no contra SRTM, asi que queda un residuo: este
script lo mide.

Metodo:
  1. Vertices del OBJ recentrado -> transform.json del tileset georreferenciado
     (la misma M que usa el visor) -> lon, lat, h elipsoidal.
  2. Celdas de --celda m (10). Suelo de la celda = percentil 5 de h. Solo
     celdas de suelo abierto (p95 - p5 < --dispersion m) y del BORDE de la
     huella (celdas ocupadas con algun vecino vacio): ahi es donde se veria que
     el modelo flota o se entierra.
  3. Terreno: la tesela Terrarium z--zoom (15, la mas fina de AWS) que cubre
     cada celda, bilineal. altura = (R*256 + G + B/256) - 32768.
  4. Residuo = terreno - (suelo - N). Positivo: el terreno queda por encima del
     suelo de la malla (el borde se entierra). Negativo: la malla flota.
     La mediana del suelo abierto es la sugerencia para
     escena.ajuste_altura_m (el visor SUMA ese valor a la altura del modelo).

OJO con N: las teselas de AWS en Colombia son SRTM, referidas a EGM96, asi que
el N que hay que restar es el de EGM96 (Tintal: 21,02 m), no el de EGM2008
(22,18 m, el que uso georref-tileset.mjs). La diferencia es 1,17 m.

Uso:
  python residuo_terreno_aws.py --vuelo D:/geoai-vuelos/tintal --geoide 22.18
      [--geo tintal-geo] [--obj local/Mesh.obj] [--zoom 15] [--celda 10]
Las teselas bajadas quedan en <vuelo>/aws-terrarium/ (unas pocas, KB).
"""
import argparse, json, math, os, urllib.request
os.environ.pop('PROJ_LIB', None)
import numpy as np
import rasterio
from pyproj import Transformer

p = argparse.ArgumentParser()
p.add_argument('--vuelo', required=True)
p.add_argument('--geoide', type=float, required=True, help='N (m) que el visor le resta a la malla')
p.add_argument('--geo', default='tintal-geo')
p.add_argument('--obj', default='local/Mesh.obj')
p.add_argument('--zoom', type=int, default=15)
p.add_argument('--celda', type=float, default=10.0)
p.add_argument('--dispersion', type=float, default=1.0)
p.add_argument('--min-vertices', type=int, default=20)
a = p.parse_args()

URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
tr = json.load(open(os.path.join(a.vuelo, a.geo, 'transform.json'), encoding='utf-8'))

# 1. vertices -> geodesicas (misma cadena que el visor)
lineas = []
with open(os.path.join(a.vuelo, a.obj), 'r', encoding='utf-8', errors='replace') as f:
    for linea in f:
        if linea.startswith('v '):
            lineas.append(linea[2:])
V = np.loadtxt(lineas, dtype=np.float64, usecols=(0, 1, 2)); del lineas
M = np.array(tr['M']).reshape(4, 4).T
P = np.c_[V[:, 0], -V[:, 2], V[:, 1], np.ones(len(V))] @ M.T
lon, lat, h = (np.asarray(v) for v in Transformer.from_crs('EPSG:4978', 'EPSG:4979', always_xy=True)
               .transform(P[:, 0], P[:, 1], P[:, 2]))

# 2. celdas en metros locales (este/norte desde el centro)
lat0, lon0 = tr['lat0'], tr['lon0']
x = np.radians(lon - lon0) * 6378137 * math.cos(math.radians(lat0))
y = np.radians(lat - lat0) * 6378137
ix = np.floor(x / a.celda).astype(int); iy = np.floor(y / a.celda).astype(int)
ix -= ix.min(); iy -= iy.min()
nx, ny = ix.max() + 1, iy.max() + 1
clave = iy * nx + ix
orden = np.argsort(clave, kind='stable')
cortes = np.flatnonzero(np.diff(clave[orden])) + 1
grupos_h = np.split(h[orden], cortes)
grupos_lon = np.split(lon[orden], cortes)
grupos_lat = np.split(lat[orden], cortes)
claves = clave[orden][np.r_[0, cortes]]
ocupada = np.zeros((ny, nx), bool); ocupada.flat[claves] = True
vecino_vacio = np.zeros_like(ocupada)
pad = np.pad(ocupada, 1, constant_values=False)
for df, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
    vecino_vacio |= ~pad[1 + df:1 + df + ny, 1 + dc:1 + dc + nx]

celdas = []
for k, hh, lo, la in zip(claves, grupos_h, grupos_lon, grupos_lat):
    if len(hh) < a.min_vertices:
        continue
    p5, p95 = np.percentile(hh, [5, 95])
    celdas.append((lo.mean(), la.mean(), p5, p95 - p5, bool(vecino_vacio.flat[k])))
C = np.array(celdas)

# 3. terreno AWS Terrarium
cache = os.path.join(a.vuelo, 'aws-terrarium'); os.makedirs(cache, exist_ok=True)
teselas = {}
def tesela(z, tx, ty):
    if (tx, ty) not in teselas:
        ruta = os.path.join(cache, f'{z}_{tx}_{ty}.png')
        if not os.path.exists(ruta):
            req = urllib.request.Request(URL.format(z=z, x=tx, y=ty),
                                         headers={'User-Agent': 'GeoAI-LATAM residuo_terreno_aws.py'})
            open(ruta, 'wb').write(urllib.request.urlopen(req, timeout=30).read())
        with rasterio.open(ruta) as ds:
            r, g, b = (ds.read(i).astype(np.float64) for i in (1, 2, 3))
        teselas[(tx, ty)] = r * 256 + g + b / 256 - 32768
    return teselas[(tx, ty)]

def terreno(lo, la, z=a.zoom):
    n = 2 ** z
    fx = (lo + 180) / 360 * n
    fy = (1 - math.asinh(math.tan(math.radians(la))) / math.pi) / 2 * n
    tx, ty = int(fx), int(fy)
    px = (fx - tx) * 256 - 0.5; py = (fy - ty) * 256 - 0.5
    # bilineal (en el borde de la tesela se recorta: error de centimetros en llano)
    px = min(max(px, 0), 254.999); py = min(max(py, 0), 254.999)
    c0, f0 = int(px), int(py); dc, df = px - c0, py - f0
    T = tesela(z, tx, ty)
    return (T[f0, c0] * (1 - dc) * (1 - df) + T[f0, c0 + 1] * dc * (1 - df)
            + T[f0 + 1, c0] * (1 - dc) * df + T[f0 + 1, c0 + 1] * dc * df)

H = np.array([terreno(lo, la) for lo, la in C[:, :2]])
res = H - (C[:, 2] - a.geoide)

def resumen(nombre, m):
    r = res[m]
    q1, med, q3 = np.percentile(r, [25, 50, 75])
    print(f'{nombre}: {m.sum()} celdas, mediana {med:+.2f} m, IQR {q3 - q1:.2f} m ({q1:+.2f} a {q3:+.2f})')
    return med

abiertas = C[:, 3] < a.dispersion
borde = C[:, 4] == 1
print(f'terreno AWS Terrarium z{a.zoom}, {len(teselas)} teselas; N restado a la malla = {a.geoide} m')
resumen('todas las celdas (sesgado: el DEM es DSM)', np.ones(len(C), bool))
med = resumen('suelo abierto', abiertas)
resumen('suelo abierto del BORDE (diagnostico: pocas celdas y ahi entran techos planos)', abiertas & borde)
# La sugerencia sale de todo el suelo abierto y no del borde: en el Tintal las
# celdas "planas" del borde son en buena parte techos de bodegas, que el filtro
# de dispersion no distingue del piso y que dan residuos de -5 a -13 m.
print(f'sugerencia: escena.ajuste_altura_m = {round(float(med), 2)} (el visor suma este valor a la malla; '
      f'positivo sube el modelo)')

# 5. plano de residuos (x este, y norte, m desde el centro): si el terreno de
# AWS esta inclinado respecto a GLO-30, una constante no arregla los dos lados
xm = np.radians(C[:, 0] - lon0) * 6378137 * math.cos(math.radians(lat0))
ym = np.radians(C[:, 1] - lat0) * 6378137
m = abiertas
A = np.c_[xm[m], ym[m], np.ones(m.sum())]
(pa, pb, pc), *_ = np.linalg.lstsq(A, res[m], rcond=None)
print(f'plano de residuos (suelo abierto): {pa * 1000:+.2f} m/km este, {pb * 1000:+.2f} m/km norte, {pc:+.2f} m en el centro')
for nombre, sel in (('borde', abiertas & borde),):
    for q, (sx, sy) in {'NE': (1, 1), 'NO': (-1, 1), 'SE': (1, -1), 'SO': (-1, -1)}.items():
        s = sel & (np.sign(xm) == sx) & (np.sign(ym) == sy)
        if s.any():
            print(f'  {nombre} {q}: {s.sum()} celdas, mediana {np.median(res[s]):+.2f} m')
