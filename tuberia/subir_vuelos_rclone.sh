#!/usr/bin/env bash
# Sube carpetas <slug>-geo al bucket R2 "vuelos" con rclone (remoto "r2", clave en rclone.conf).
# Uso: [VERSION=v2] subir_vuelos_rclone.sh "carpeta_local:slug_en_r2" ...
# VERSION es la carpeta de versión en R2 (por defecto v1). Una versión nueva de un
# modelo va a otra carpeta, sin pisar la que sirve producción (el Tintal está en v2).
# .glb con caché inmutable (ruta versionada); .json (índices) con caché de 5 min.
# RCLONE, o el rclone del PATH, o el que instala winget.
RC=${RCLONE:-$(command -v rclone || ls "$(cygpath "$LOCALAPPDATA")"/Microsoft/WinGet/Packages/Rclone.Rclone_*/rclone-*/rclone.exe 2>/dev/null | head -1)}
VER=${VERSION:-v1}
OPT="--transfers 16 --checkers 16 --s3-no-check-bucket --stats 60s --stats-one-line"
for par in "$@"; do
  src=${par%%:*}; slug=${par##*:}
  echo "== $slug ($src) $(date +%H:%M)"
  "$RC" copy "$src" "r2:vuelos/$slug/$VER/geo" --include "*.glb" $OPT \
    --header-upload "Content-Type: model/gltf-binary" --header-upload "Cache-Control: public, max-age=31536000, immutable" || echo "FALLA glb $slug"
  "$RC" copy "$src" "r2:vuelos/$slug/$VER/geo" --include "*.json" $OPT \
    --header-upload "Content-Type: application/json" --header-upload "Cache-Control: public, max-age=300" || echo "FALLA json $slug"
  echo "   listo $slug $(date +%H:%M)"
done
