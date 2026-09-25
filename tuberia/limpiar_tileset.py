"""Quita las claves con valor null del tileset.json de Obj2Tiles 1.6.2.

Obj2Tiles escribe "transform": null y "children": null, que el esquema de
3D Tiles no admite y que tumban `3d-tiles-tools upgrade` (TypeError al leer
.length de null). Guarda el original como tileset.orig.json.

Uso: python limpiar_tileset.py CARPETA_TILESET
"""
import json
import os
import shutil
import sys


def limpiar(o):
    if isinstance(o, dict):
        return {k: limpiar(v) for k, v in o.items() if v is not None}
    if isinstance(o, list):
        return [limpiar(v) for v in o]
    return o


d = sys.argv[1]
p = os.path.join(d, "tileset.json")
orig = os.path.join(d, "tileset.orig.json")
if not os.path.exists(orig):
    shutil.copyfile(p, orig)
ts = limpiar(json.load(open(orig, encoding="utf-8")))
json.dump(ts, open(p, "w", encoding="utf-8"), separators=(",", ":"))
print(p, os.path.getsize(orig), "->", os.path.getsize(p))
