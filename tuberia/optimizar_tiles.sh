#!/usr/bin/env bash
# Optimiza un tileset 3D Tiles 1.1 (glb) de Obj2Tiles para la web.
#   - cada tile: KTX2 ETC1S (quality 192) y luego meshopt (level medium).
#     El orden importa: si meshopt va primero, etc1s lo decodifica y lo pierde.
#   - root.glb: Obj2Tiles 1.6.2 lo genera con la malla COMPLETA (1,74 M caras,
#     39 MB). Se simplifica con gltfpack -si RATIO -sa (agresivo: gltf-transform
#     simplify se frena en ~50 % por las costuras de UV del atlas).
# Uso: optimizar_tiles.sh ENTRADA_1.1 SALIDA [RATIO_ROOT=0.1] [JOBS=8]
set -euo pipefail
IN=$(realpath "$1"); OUT=$2; RATIO=${3:-0.1}; JOBS=${4:-8}
# Donde están KTX-Software (KTX/bin) y node/node_modules con gltf-transform y gltfpack.
TOOLS=${VUELOS_TOOLS:-/d/geoai-vuelos/tools}
export PATH="$TOOLS/KTX/bin:$PATH"
export G=$TOOLS/node/node_modules/.bin/gltf-transform
P=$TOOLS/node/node_modules/.bin/gltfpack
mkdir -p "$OUT"; OUT=$(realpath "$OUT")
cd "$IN"
find . -type d -not -name .temp | while read -r d; do mkdir -p "$OUT/$d"; done
cp tileset.json "$OUT/tileset.json"

# root: simplificar, luego etc1s + meshopt
"$P" -i root.glb -o "$OUT/root.s.glb" -si "$RATIO" -sa -km -noq
"$G" etc1s "$OUT/root.s.glb" "$OUT/root.k.glb" --quality 192 >/dev/null 2>&1
"$G" meshopt "$OUT/root.k.glb" "$OUT/root.glb" --level medium >/dev/null 2>&1
rm "$OUT/root.s.glb" "$OUT/root.k.glb"

export OUT
find . -name '*.glb' -not -path './root.glb' -not -path './.temp/*' -print0 |
  xargs -0 -P "$JOBS" -I{} bash -c '
    f="{}"; tmp="$OUT/${f%.glb}.k.glb"
    "$G" etc1s "$f" "$tmp" --quality 192 >/dev/null 2>&1 &&
    "$G" meshopt "$tmp" "$OUT/$f" --level medium >/dev/null 2>&1 &&
    rm "$tmp" || echo "FALLO $f"'
echo "listo: $OUT"
