// recorte-obj.mjs: saca de un OBJ grande las caras dentro de un rectangulo XY,
// con sus texturas originales. Sirve para comparar una hoja del tileset contra
// la malla fuente en el mismo sitio (misma vista, misma camara).
// Uso: node recorte-obj.mjs entrada.obj salida.obj xmin xmax ymin ymax
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
const [inp, out, x0, x1, y0, y1] = process.argv.slice(2);
const X0 = +x0, X1 = +x1, Y0 = +y0, Y1 = +y1;
const v = [], vt = [];
const caras = []; // [mtl, [[vi, ti] x3+]]
let mtl = null, mtllib = null;
const rl = readline.createInterface({ input: fs.createReadStream(inp), crlfDelay: Infinity });
for await (const l of rl) {
  if (l.startsWith('v ')) { const s = l.split(/\s+/); v.push([+s[1], +s[2], +s[3]]); }
  else if (l.startsWith('vt ')) { const s = l.split(/\s+/); vt.push([+s[1], +s[2]]); }
  else if (l.startsWith('usemtl ')) mtl = l.slice(7).trim();
  else if (l.startsWith('mtllib ')) mtllib = l.slice(7).trim();
  else if (l.startsWith('f ')) {
    const idx = l.trim().split(/\s+/).slice(1).map(q => q.split('/').map(Number));
    if (idx.every(([a]) => { const p = v[a - 1]; return p[0] >= X0 && p[0] <= X1 && p[1] >= Y0 && p[1] <= Y1; })) caras.push([mtl, idx]);
  }
}
const mv = new Map(), mt = new Map(); const ov = [], ot = [];
let txt = `mtllib ${path.basename(out, '.obj')}.mtl\n`, cur = null;
const cuerpo = [];
for (const [m, idx] of caras) {
  if (m !== cur) { cuerpo.push(`usemtl ${m}`); cur = m; }
  cuerpo.push('f ' + idx.map(([a, b]) => {
    if (!mv.has(a)) { mv.set(a, ov.length + 1); ov.push(v[a - 1]); }
    if (!mt.has(b)) { mt.set(b, ot.length + 1); ot.push(vt[b - 1]); }
    return `${mv.get(a)}/${mt.get(b)}`;
  }).join(' '));
}
txt += ov.map(p => `v ${p.join(' ')}`).join('\n') + '\n' + ot.map(t => `vt ${t.join(' ')}`).join('\n') + '\n' + cuerpo.join('\n') + '\n';
fs.writeFileSync(out, txt);
// mtl con rutas absolutas a las texturas originales
const dir = path.dirname(inp);
const m = fs.readFileSync(path.join(dir, mtllib), 'utf8').replace(/map_Kd (.+)/g, (_, f) => `map_Kd ${path.resolve(dir, f.trim()).replace(/\\/g, '/')}`);
fs.writeFileSync(out.replace(/\.obj$/, '.mtl'), m);
console.log(caras.length, 'caras,', ov.length, 'vertices');
