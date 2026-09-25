import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder as D12 } from 'meshoptimizer';
import { MeshoptDecoder as D11 } from './decoder-three-1.1.mjs';
const f = process.argv[2];
async function leer(D){ await D.ready; const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':D}); const doc=await io.read(f); const out=[]; for(const m of doc.getRoot().listMeshes()) for(const p of m.listPrimitives()){ out.push([p.getAttribute('POSITION').getArray(), p.getIndices()?.getArray(), p.getAttribute('TEXCOORD_0').getArray()]); } return out; }
const a=await leer(D12), b=await leer(D11);
let dif=0,tot=0; for(let i=0;i<a.length;i++) for(let k=0;k<3;k++){ const x=a[i][k], y=b[i][k]; if(!x) continue; tot+=x.length; for(let j=0;j<x.length;j++) if(x[j]!==y[j]) dif++; }
console.log('valores distintos', dif, 'de', tot);
