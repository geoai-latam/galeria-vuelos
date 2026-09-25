import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  let mn=[1e9,1e9], mx=[-1e9,-1e9], tris=0, idx=0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const uv=p.getAttribute('TEXCOORD_0'); const pos=p.getAttribute('POSITION');
    const i=p.getIndices(); tris += (i? i.getCount(): pos.getCount())/3;
    if (uv){ const e=[0,0]; for(let k=0;k<uv.getCount();k++){uv.getElement(k,e); for(const j of [0,1]){mn[j]=Math.min(mn[j],e[j]); mx[j]=Math.max(mx[j],e[j]);}} console.log('  uv type', uv.getComponentType(), 'normalized', uv.getNormalized()); }
  }
  console.log(f.split('/').slice(-2).join('/'), 'tris', tris, 'uvmin', mn.map(v=>v.toFixed(3)), 'uvmax', mx.map(v=>v.toFixed(3)));
}
