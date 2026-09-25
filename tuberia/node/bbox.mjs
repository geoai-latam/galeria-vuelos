import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
for (const f of process.argv.slice(2)) {
  const doc=await io.read(f); const r=doc.getRoot();
  console.log('==', f.split('/').slice(-3).join('/'), 'nodes', r.listNodes().length, 'meshes', r.listMeshes().length, 'scenes', r.listScenes().length);
  for (const n of r.listNodes()) { const m=n.getMesh(); console.log(' node', n.getName(), 'T', n.getTranslation().map(v=>+v.toFixed(3)), 'S', n.getScale().map(v=>+v.toFixed(5)), 'R', n.getRotation().map(v=>+v.toFixed(3)), 'mesh', m?.getName(), 'prims', m?.listPrimitives().length, 'parent', n.getParentNode()?.getName()??'-');
    if (m) for (const p of m.listPrimitives()) { const a=p.getAttribute('POSITION'); console.log('   pos', a.getComponentType(), a.getNormalized(), 'min', a.getMin([]).map(v=>+v.toFixed(3)), 'max', a.getMax([]).map(v=>+v.toFixed(3)), 'n', a.getCount(), 'idx', p.getIndices()?.getCount()); } }
}
