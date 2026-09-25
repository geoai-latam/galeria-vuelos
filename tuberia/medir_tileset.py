"""Mide un tileset 3D Tiles: tamano total, n de tiles, tileset.json, contenido raiz, tile mayor.

Uso: python medir_tileset.py CARPETA_TILESET
Excluye la carpeta .temp (intermedios de Obj2Tiles).
"""
import json
import os
import sys

root = sys.argv[1]
ts_path = os.path.join(root, "tileset.json")
ts = json.load(open(ts_path, encoding="utf-8"))


def uris(tile, depth=0, out=None):
    out = [] if out is None else out
    for key in ("content",):
        if key in tile:
            out.append((depth, tile[key].get("uri") or tile[key].get("url"), tile.get("geometricError")))
    for c in tile.get("contents") or []:
        out.append((depth, c.get("uri"), tile.get("geometricError")))
    for ch in tile.get("children") or []:
        uris(ch, depth + 1, out)
    return out


contents = uris(ts["root"])
total = 0
files = []
for dp, _, fs in os.walk(root):
    if ".temp" in dp.split(os.sep):
        continue
    for f in fs:
        p = os.path.join(dp, f)
        s = os.path.getsize(p)
        total += s
        files.append((s, os.path.relpath(p, root)))
tiles = [f for f in files if f[1].lower().endswith((".b3dm", ".glb", ".gltf"))]
tiles.sort(reverse=True)
min_depth = min(c[0] for c in contents)
root_uris = [c for c in contents if c[0] == min_depth]
root_bytes = sum(os.path.getsize(os.path.join(root, c[1])) for c in root_uris)
depths = {}
for d, u, ge in contents:
    depths.setdefault(d, [0, 0, ge])
    depths[d][0] += 1
    depths[d][1] += os.path.getsize(os.path.join(root, u))
print(json.dumps({
    "carpeta": root,
    "version": ts.get("asset", {}).get("version"),
    "total_bytes": total,
    "archivos": len(files),
    "tiles": len(tiles),
    "tileset_json_bytes": os.path.getsize(ts_path),
    "contenido_mas_grueso": {"profundidad": min_depth, "uris": [c[1] for c in root_uris], "bytes": root_bytes},
    "por_profundidad": {d: {"tiles": v[0], "bytes": v[1], "geometricError": v[2]} for d, v in sorted(depths.items())},
    "tile_mayor": {"archivo": tiles[0][1], "bytes": tiles[0][0]} if tiles else None,
    "extensiones": sorted({os.path.splitext(f[1])[1] for f in files}),
}, indent=1))
