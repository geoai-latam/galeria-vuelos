"""Recentra un OBJ con coordenadas absolutas (UTM) a un marco local.

Dos pasadas en streaming: la primera calcula el bbox de los `v`, la segunda
resta el desplazamiento (centro X, centro Y, Z minima) y escribe el OBJ nuevo.
Las demas lineas (vt, f, usemtl, mtllib) pasan tal cual.

Uso: python recentrar_obj.py ENTRADA.obj SALIDA.obj OFFSET.json [--epsg 32618]
"""
import json
import sys
from decimal import Decimal


def bbox(path):
    mn = [float("inf")] * 3
    mx = [float("-inf")] * 3
    nv = nf = nvt = 0
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if line.startswith("v "):
                p = line.split()
                for i in range(3):
                    c = float(p[i + 1])
                    if c < mn[i]:
                        mn[i] = c
                    if c > mx[i]:
                        mx[i] = c
                nv += 1
            elif line.startswith("f "):
                nf += 1
            elif line.startswith("vt "):
                nvt += 1
    return mn, mx, nv, nf, nvt


def main():
    src, dst, off_path = sys.argv[1:4]
    epsg = int(sys.argv[sys.argv.index("--epsg") + 1]) if "--epsg" in sys.argv else 32618
    mn, mx, nv, nf, nvt = bbox(src)
    # Offset redondeado al metro: el marco local queda con numeros legibles y
    # la resta en Decimal no pierde precision de la fuente.
    off = [round((mn[0] + mx[0]) / 2), round((mn[1] + mx[1]) / 2), round(mn[2])]
    doff = [Decimal(o) for o in off]
    with open(src, "r", encoding="utf-8", errors="replace") as fi, \
            open(dst, "w", encoding="utf-8", newline="\n") as fo:
        for line in fi:
            if line.startswith("v "):
                p = line.split()
                xyz = [Decimal(p[i + 1]) - doff[i] for i in range(3)]
                rest = " ".join(p[4:])
                fo.write("v %.4f %.4f %.4f%s\n" % (xyz[0], xyz[1], xyz[2], (" " + rest) if rest else ""))
            else:
                fo.write(line)

    info = {
        "fuente": src,
        "crs": "EPSG:%d" % epsg,
        "crs_nota": "Sin .prj ni metadatos en el bucket: EPSG:32618 (WGS84 / UTM 18N) asumido segun la auditoria; "
                    "las coordenadas son coherentes con Bogota en esa zona.",
        "offset": {"x": off[0], "y": off[1], "z": off[2]},
        "offset_regla": "x,y = centro del bbox redondeado al metro; z = Z minima redondeada al metro",
        "bbox_original": {"min": mn, "max": mx},
        "bbox_local": {"min": [mn[i] - off[i] for i in range(3)], "max": [mx[i] - off[i] for i in range(3)]},
        "vertices": nv, "caras": nf, "coords_textura": nvt,
        "precision_salida": "4 decimales (0.1 mm)",
    }
    try:
        from pyproj import Transformer
        t = Transformer.from_crs(epsg, 4326, always_xy=True)
        lon, lat = t.transform(off[0], off[1])
        info["centro_wgs84"] = {"lat": lat, "lon": lon, "alt": off[2],
                                "alt_nota": "Z de la malla tal cual (sin verificar si es elipsoidal u ortometrica)"}
    except ImportError:
        info["centro_wgs84"] = None
    with open(off_path, "w", encoding="utf-8") as fh:
        json.dump(info, fh, indent=2, ensure_ascii=False)
    print(json.dumps(info, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
