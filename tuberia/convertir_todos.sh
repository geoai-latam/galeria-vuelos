#!/bin/bash
# Corre slpk_a_tiles.mjs sobre los SLPK que faltan, uno a la vez, de menor a mayor.
# Si uno falla (memoria), queda en el log y sigue con el siguiente.
RAIZ=${VUELOS_RAIZ:-/d/geoai-vuelos}
AQUI=$(cd "$(dirname "$0")" && pwd)
export TMP=$RAIZ/tmp TEMP=$RAIZ/tmp npm_config_cache=$RAIZ/tools/npm-cache
cd "$RAIZ"
while read -r slug archivo; do
  mkdir -p "$slug"
  echo "=== $slug ($archivo) $(date +%T)" >> tmp/lote.log
  node --max-old-space-size=3072 "$AQUI/slpk_a_tiles.mjs" "slpks/$archivo" "$slug" > "$slug/conversion.log" 2>&1
  echo "=== $slug salida $? $(date +%T)" >> tmp/lote.log
  tail -3 "$slug/conversion.log" >> tmp/lote.log
done <<LISTA
ibague-arboleda Oblicua_Parque-3D_Mesh_SLPK.slpk
parque CapturaParque-3D_Mesh_SLPK (1).slpk
zipaquira CatedralParque-3D_Mesh_SLPK.slpk
castilla Castilla_Nadir-3D_Mesh_SLPK.slpk
cerinza FusionNadirOblicua-3D_Mesh_SLPK.slpk
kennedy-81b Fusion_Oblic-Nadir-3D_Mesh_SLPK.slpk
LISTA
echo "=== fin $(date +%T)" >> tmp/lote.log
