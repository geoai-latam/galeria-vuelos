// jpegq.mjs: estima la calidad JPEG (escala IJG) desde la tabla de cuantizacion de luminancia.
// Uso: node jpegq.mjs a.jpg b.glb ...  (en un glb revisa cada imagen JPEG embebida)
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const T=[16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];
export function calidad(b){ for(let i=2;i<b.length-4;){ if(b[i]!==0xFF){i++;continue;} const m=b[i+1], L=(b[i+2]<<8)|b[i+3];
  if(m===0xDB){ let j=i+4; const pq=b[j]>>4; const q=[]; j++; for(let k=0;k<64;k++){ q.push(pq?(b[j]<<8|b[j+1]):b[j]); j+=pq?2:1; }
    const s=q.reduce((a,v)=>a+v,0)/T.reduce((a,v)=>a+v,0)*100; return s<=100? Math.round((200-s)/2) : Math.round(5000/s); }
  i+=2+L; } return null; }
for (const f of process.argv.slice(2)) {
  if (f.endsWith('.glb')) { await MeshoptDecoder.ready; const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
    const d=await io.read(f); console.log(f.split('/').pop(), d.getRoot().listTextures().map(t=>t.getMimeType()+':q'+calidad(t.getImage())+':'+t.getSize()?.join('x')).join(' ')); }
  else console.log(f.split('/').pop(), 'q'+calidad(fs.readFileSync(f)));
}
