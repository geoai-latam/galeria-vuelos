"""validar_georref.py: comprueba el root.transform de un tileset georreferenciado
con vertices reales del OBJ recentrado.

Para cada vertice (x, y, z locales): lo pasa por el mismo camino que el runtime
de 3D Tiles (glTF (x, y, z) -> tileset (x, -z, y) -> root.transform -> ECEF),
lo convierte a lat/lon/h con pyproj y lo compara con lo esperado:
  horizontal: UTM (offset.x + x, offset.y + y) de la fuente
  vertical:   offset.z + z + a*x + b*y + c (ajuste_plano) + N (geoide)
La rotacion que endereza la inclinacion mueve en horizontal los puntos altos
(~0,035 m por metro de altura en el Tintal): por eso se reporta aparte el error
de los vertices de suelo.

Uso: python validar_georref.py --vuelo D:/geoai-vuelos/tintal --tileset D:/geoai-vuelos/tintal/tintal-geo --geoide 22.18
"""
import argparse, json, os
os.environ.pop('PROJ_LIB', None)
import numpy as np
from pyproj import Transformer

p = argparse.ArgumentParser()
p.add_argument('--vuelo', required=True); p.add_argument('--tileset', required=True)
p.add_argument('--geoide', type=float, required=True); p.add_argument('--n', type=int, default=5000)
a = p.parse_args()
off = json.load(open(os.path.join(a.vuelo, 'offset.json'), encoding='utf-8'))
M = np.array(json.load(open(os.path.join(a.tileset, 'tileset.json')))['root']['transform']).reshape(4, 4).T
ox, oy, oz = off['offset']['x'], off['offset']['y'], off['offset']['z']
pl = off['ajuste_plano']

v = []
with open(os.path.join(a.vuelo, 'local', 'Mesh.obj'), encoding='utf-8', errors='replace') as f:
    for l in f:
        if l.startswith('v '):
            v.append([float(t) for t in l.split()[1:4]])
v = np.array(v)
rng = np.random.default_rng(1)
s = v[rng.choice(len(v), a.n, replace=False)]
# esquinas y centro del modelo, para ver los extremos
extra = v[[np.argmin(v[:, 0]), np.argmax(v[:, 0]), np.argmin(v[:, 1]), np.argmax(v[:, 1]), np.argmin(np.abs(v[:, 0]) + np.abs(v[:, 1]))]]
s = np.vstack([extra, s])

tile = np.c_[s[:, 0], -s[:, 2], s[:, 1], np.ones(len(s))]  # glTF (x,y,z)=(E,N,U) -> tileset (x,-z,y)
ecef = (M @ tile.T).T[:, :3]
lon, lat, h = Transformer.from_crs('EPSG:4978', 'EPSG:4979', always_xy=True).transform(ecef[:, 0], ecef[:, 1], ecef[:, 2])
e_calc, n_calc = Transformer.from_crs('EPSG:4326', off.get('crs', 'EPSG:32618'), always_xy=True).transform(lon, lat)
dh = np.hypot(e_calc - (ox + s[:, 0]), n_calc - (oy + s[:, 1]))
H_esp = oz + s[:, 2] + pl['a'] * s[:, 0] + pl['b'] * s[:, 1] + pl['c']
dv = (np.asarray(h) - a.geoide) - H_esp
suelo = s[:, 2] < np.percentile(v[:, 2], 20)
print(f'{len(s)} vertices')
print(f'horizontal, todos: mediana {np.median(dh):.3f} m, p95 {np.percentile(dh, 95):.3f} m, max {dh.max():.3f} m')
print(f'horizontal, suelo (z local < p20): mediana {np.median(dh[suelo]):.3f} m, max {dh[suelo].max():.3f} m')
print(f'vertical (H calculada - esperada): mediana {np.median(dv):+.3f} m, max |.| {np.abs(dv).max():.3f} m')
nombres = ['oeste', 'este', 'sur', 'norte', 'centro']
for i, nm in enumerate(nombres):
    print(f'  {nm:6s} local ({s[i,0]:7.1f}, {s[i,1]:7.1f}, {s[i,2]:5.1f}) -> lat {lat[i]:.7f} lon {lon[i]:.7f} h {h[i]:.2f} (H {h[i]-a.geoide:.2f}) | dH {dh[i]:.3f} m dV {dv[i]:+.3f} m')
