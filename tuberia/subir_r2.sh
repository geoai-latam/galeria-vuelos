#!/usr/bin/env bash
# Sube una carpeta de 3D Tiles al bucket R2 con wrangler (sesión OAuth de `wrangler login`).
# Uso: subir_r2.sh CARPETA_LOCAL BUCKET PREFIJO [PARALELOS]
# .glb: model/gltf-binary + caché inmutable (la ruta lleva versión: v1, v2...)
# .json: application/json + caché de 5 min (el índice puede cambiar)
set -uo pipefail
SRC=$(realpath "$1"); BUCKET=$2; PREFIJO=$3; P=${4:-4}
# wrangler se corre con npx desde la raíz del repo.
cd "$(dirname "$0")/.."
export BUCKET PREFIJO SRC
find "$SRC" -type f \( -name '*.glb' -o -name '*.json' \) -not -path '*/.temp/*' -printf '%P\n' |
  xargs -P "$P" -I{} bash -c '
    f="{}"; case "$f" in
      *.glb)  ct="model/gltf-binary"; cc="public, max-age=31536000, immutable";;
      *.json) ct="application/json";  cc="public, max-age=300";;
    esac
    for i in 1 2 3; do
      npx wrangler r2 object put "$BUCKET/$PREFIJO/$f" --file "$SRC/$f" --content-type "$ct" --cache-control "$cc" --remote >/dev/null 2>&1 && { echo "OK $f"; exit 0; }
      sleep 2
    done
    echo "FALLA $f"'
