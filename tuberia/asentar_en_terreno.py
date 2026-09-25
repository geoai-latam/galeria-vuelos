"""asentar_en_terreno.py: corrige la altura de una malla sin puntos de control
ajustando su suelo a un modelo digital de elevacion (DEM).

Por que: un vuelo sin GCP deja la malla con la altura que dio el GPS del dron,
que puede errar decenas de metros. En el Tintal la Z minima de la malla es
2612 m y el terreno en SRTM/GLO-30 ronda 2547 m. Para poner el modelo sobre un
terreno real hace falta esa diferencia.

Metodo (reusable para los demas vuelos):
  1. Lee los vertices del OBJ recentrado y su offset.json (EPSG:32618 u otro
     UTM: el EPSG sale de offset.json["crs"]).
  2. Los agrupa en celdas de --celda m (10 por defecto). En cada celda, el suelo
     de la malla es el percentil --percentil (5) de las alturas: lo mas bajo,
     pero sin el ruido de los vertices sueltos.
  3. GLO-30 es un DSM (edificios y copas de arbol lo levantan), asi que solo se
     usan celdas de "suelo abierto": donde la malla es casi plana (percentil 95
     menos percentil 5 por debajo de --dispersion m). En una celda con edificio
     el DSM mide el techo y la malla el piso, y esa celda sesgaria el ajuste.
  4. Muestrea el DEM (interpolacion bilineal) en el centro de cada celda,
     pasando de UTM a WGS84 con pyproj.
  5. Correccion = mediana de (DEM - suelo de la malla). Se reporta el rango
     intercuartil (IQR) y cuantas celdas entraron.
  6. Ademas ajusta un PLANO a esas diferencias: DEM - suelo = a*x + b*y + c,
     con x, y en metros locales (los del OBJ recentrado). En el Tintal el IQR de
     la correccion unica era de 15 m y con el plano el residuo baja a ~1 m: la
     malla sin GCP esta inclinada ~2 grados (unos 35 m por km). Una sola
     constante deja un extremo del modelo 15 m enterrado y el otro flotando.
     La inclinacion se corrige con una rotacion (no con un corte), que es lo
     que hace georref-tileset.mjs con ajuste_plano.

Alturas: GLO-30 viene en alturas ortometricas EGM2008. La correccion deja la
malla en ortometrica EGM2008. Para ECEF (3D Tiles georreferenciado) hay que
sumar la ondulacion del geoide N en el sitio (h = H + N).

El desplazamiento horizontal NO se resuelve aqui: sin GCP ni ortofoto de
referencia sigue pendiente.

Uso:
  python asentar_en_terreno.py --vuelo D:/geoai-vuelos/tintal [--dem archivo.tif]
      [--celda 10] [--percentil 5] [--dispersion 1.0] [--escribir]
  --vuelo espera local/Mesh.obj y offset.json dentro.
  Con --escribir guarda ajuste_vertical_m y el metodo en offset.json.
"""
import argparse, json, math, os, sys, datetime
# rasterio trae su PROJ; si PROJ_LIB apunta a otra instalacion (PostGIS en
# este equipo) PROJ se queja. pyproj usa la suya.
os.environ.pop('PROJ_LIB', None)
import numpy as np
import rasterio
from pyproj import Transformer

p = argparse.ArgumentParser()
p.add_argument('--vuelo', required=True)
p.add_argument('--obj', default=None)
p.add_argument('--dem', default=os.path.join(os.environ.get('VUELOS_RAIZ', 'D:/geoai-vuelos'), 'dem', 'glo30_N04_W075.tif'))
p.add_argument('--dem-nombre', default='Copernicus GLO-30 (DSM, EGM2008), tesela N04 W075, AWS copernicus-dem-30m')
p.add_argument('--celda', type=float, default=10.0)
p.add_argument('--percentil', type=float, default=5.0)
p.add_argument('--dispersion', type=float, default=1.0)
p.add_argument('--min-vertices', type=int, default=20)
p.add_argument('--escribir', action='store_true')
a = p.parse_args()

ruta_off = os.path.join(a.vuelo, 'offset.json')
off = json.load(open(ruta_off, encoding='utf-8'))
ox, oy, oz = off['offset']['x'], off['offset']['y'], off['offset']['z']
epsg = off.get('crs', 'EPSG:32618')
obj = a.obj or os.path.join(a.vuelo, 'local', 'Mesh.obj')

# 1. vertices
xs, ys, zs = [], [], []
with open(obj, 'r', encoding='utf-8', errors='replace') as f:
    for linea in f:
        if linea.startswith('v '):
            _, x, y, z = linea.split()[:4]
            xs.append(float(x)); ys.append(float(y)); zs.append(float(z))
x = np.array(xs); y = np.array(ys); z = np.array(zs)
print(f'{len(x)} vertices')

# 2. celdas
ix = np.floor(x / a.celda).astype(np.int64); iy = np.floor(y / a.celda).astype(np.int64)
clave = ix * 1_000_003 + iy
orden = np.argsort(clave, kind='stable')
clave_o, z_o = clave[orden], z[orden]
cortes = np.flatnonzero(np.diff(clave_o)) + 1
grupos = np.split(z_o, cortes)
claves = clave_o[np.r_[0, cortes]]
celdas = []
for k, zz in zip(claves, grupos):
    if len(zz) < a.min_vertices:
        continue
    cx, cy = divmod(int(k), 1_000_003)
    if cy > 500_000:  # divmod con negativos
        cx += 1; cy -= 1_000_003
    p5, p95 = np.percentile(zz, [a.percentil, 95])
    celdas.append((cx, cy, p5, p95 - p5, len(zz)))
celdas = np.array(celdas)
print(f'{len(celdas)} celdas con >= {a.min_vertices} vertices')

# 3. suelo abierto
abiertas = celdas[celdas[:, 3] < a.dispersion]
print(f'{len(abiertas)} celdas de suelo abierto (dispersion < {a.dispersion} m)')

# 4. DEM en el centro de cada celda
t = Transformer.from_crs(epsg, 'EPSG:4326', always_xy=True)
def muestrear(dem, lon, lat):
    # coordenadas de pixel (centro de pixel en +0.5)
    col, fila = ~dem.transform * (lon, lat)
    col -= 0.5; fila -= 0.5
    c0, f0 = np.floor(col).astype(int), np.floor(fila).astype(int)
    dc, df = col - c0, fila - f0
    banda = dem.read(1)
    v = lambda ff, cc: banda[ff, cc].astype(np.float64)
    return (v(f0, c0) * (1 - dc) * (1 - df) + v(f0, c0 + 1) * dc * (1 - df)
            + v(f0 + 1, c0) * (1 - dc) * df + v(f0 + 1, c0 + 1) * dc * df)

def diferencias(cs):
    ex = ox + (cs[:, 0] + 0.5) * a.celda; ny = oy + (cs[:, 1] + 0.5) * a.celda
    lon, lat = t.transform(ex, ny)
    with rasterio.open(a.dem) as dem:
        h = muestrear(dem, np.asarray(lon), np.asarray(lat))
    return h - (oz + cs[:, 2])

d_todas = diferencias(celdas)
d = diferencias(abiertas)
q1, med, q3 = np.percentile(d, [25, 50, 75])
q1t, medt, q3t = np.percentile(d_todas, [25, 50, 75])
print(f'suelo abierto: correccion mediana {med:+.2f} m, IQR {q3 - q1:.2f} m ({q1:+.2f} a {q3:+.2f}), {len(d)} celdas')
print(f'todas las celdas (referencia, sesgada por el DSM): mediana {medt:+.2f} m, IQR {q3t - q1t:.2f} m, {len(d_todas)} celdas')
print(f'Z minima de la malla corregida: {oz + z.min() + med:.2f} m (EGM2008)')
cx_m = (abiertas[:, 0] + 0.5) * a.celda; cy_m = (abiertas[:, 1] + 0.5) * a.celda
A = np.c_[cx_m, cy_m, np.ones(len(cx_m))]
(pa, pb, pc), *_ = np.linalg.lstsq(A, d, rcond=None)
res = d - A @ np.array([pa, pb, pc])
r1, r3 = np.percentile(res, [25, 75])
inclin = math.degrees(math.atan(math.hypot(pa, pb)))
print(f'plano: DEM - suelo = {pa:+.5f}*x {pb:+.5f}*y {pc:+.2f}  (inclinacion {inclin:.2f} grados, residuo IQR {r3 - r1:.2f} m), suelo local mediano z = {np.median(abiertas[:, 2]):.2f} m')

if a.escribir:
    off['ajuste_vertical_m'] = round(float(med), 2)
    off['ajuste_vertical'] = {
        'metodo': (f'mediana de (DEM - suelo de la malla) en celdas de {a.celda:g} m; suelo = percentil '
                   f'{a.percentil:g} de las alturas de los vertices de la celda; solo celdas de suelo abierto '
                   f'(percentil 95 - percentil {a.percentil:g} < {a.dispersion:g} m) porque el DEM es un DSM'),
        'dem': a.dem_nombre,
        'alturas': 'ortometricas EGM2008 (las de GLO-30). Para ECEF: h = H + N, N = ondulacion EGM2008 en el sitio',
        'celdas_usadas': int(len(d)),
        'celdas_totales': int(len(d_todas)),
        'iqr_m': round(float(q3 - q1), 2),
        'q1_q3_m': [round(float(q1), 2), round(float(q3), 2)],
        'mediana_todas_las_celdas_m': round(float(medt), 2),
        'script': 'D:/geoai-vuelos/tools/asentar_en_terreno.py',
        'fecha': datetime.date.today().isoformat(),
        'horizontal': 'pendiente: sin GCP no se corrige el desplazamiento horizontal',
    }
    off['ajuste_plano'] = {
        'formula': 'H_corregida = offset.z + z + (a*x + b*y + c), x/y/z locales del OBJ recentrado',
        'a': round(float(pa), 6), 'b': round(float(pb), 6), 'c': round(float(pc), 3),
        'inclinacion_grados': round(inclin, 3),
        # pivote de la rotacion: la altura local tipica del suelo. Girando ahi
        # el suelo casi no se mueve en horizontal; girando en z = 0 (la Z minima)
        # el suelo del Tintal se corria ~0,5 m.
        'z_pivote': round(float(np.median(abiertas[:, 2])), 2),
        'residuo_iqr_m': round(float(r3 - r1), 2),
        'nota': 'la malla sin GCP esta inclinada; georref-tileset.mjs aplica esto como rotacion + traslacion vertical',
    }
    json.dump(off, open(ruta_off, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('offset.json actualizado')
