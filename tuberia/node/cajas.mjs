// Recalcula boundingVolume.box de cada tile desde la geometría de su glb.
// glTF es Y-up; 3D Tiles es Z-up: el runtime aplica (x, y, z) -> (x, -z, y).
import fs from 'node:fs'; import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const dir=process.argv[2]; const tsPath=path.join(dir,'tileset.json');
const ts=JSON.parse(fs.readFileSync(tsPath,'utf8'));
async function bboxGlb(f){ const doc=await io.read(f); const mn=[1e18,1e18,1e18], mx=[-1e18,-1e18,-1e18], e=[0,0,0];
  for(const n of doc.getRoot().listNodes()){ const m=n.getMesh(); if(!m) continue; const W=n.getWorldMatrix();
    for(const p of m.listPrimitives()){ const a=p.getAttribute('POSITION'); for(let i=0;i<a.getCount();i++){ a.getElement(i,e);
      const x=W[0]*e[0]+W[4]*e[1]+W[8]*e[2]+W[12], y=W[1]*e[0]+W[5]*e[1]+W[9]*e[2]+W[13], z=W[2]*e[0]+W[6]*e[1]+W[10]*e[2]+W[14];
      const v=[x,-z,y]; for(let k=0;k<3;k++){ if(v[k]<mn[k])mn[k]=v[k]; if(v[k]>mx[k])mx[k]=v[k]; } } } }
  return [mn,mx]; }
let n=0;
async function walk(t){ let mn=[1e18,1e18,1e18], mx=[-1e18,-1e18,-1e18];
  if(t.content?.uri){ const [a,b]=await bboxGlb(path.join(dir,t.content.uri)); mn=a; mx=b; n++; }
  for(const c of t.children||[]){ const [a,b]=await walk(c); for(let k=0;k<3;k++){ mn[k]=Math.min(mn[k],a[k]); mx[k]=Math.max(mx[k],b[k]); } }
  const c=[0,1,2].map(k=>(mn[k]+mx[k])/2), h=[0,1,2].map(k=>Math.max((mx[k]-mn[k])/2,0.01));
  t.boundingVolume={box:[c[0],c[1],c[2], h[0],0,0, 0,h[1],0, 0,0,h[2]]}; return [mn,mx]; }
const [mn,mx]=await walk(ts.root);
fs.writeFileSync(tsPath, JSON.stringify(ts));
console.log('tiles', n, 'min', mn.map(v=>v.toFixed(1)), 'max', mx.map(v=>v.toFixed(1)));
