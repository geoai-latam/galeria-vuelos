// lado.mjs: pega recortes iguales de varias imagenes lado a lado (x2) para comparar calidad.
// Uso: node lado.mjs salida.png x y lado a.png b.jpg ...
import sharp from 'sharp';
const [out, x, y, s, ...fs] = process.argv.slice(2);
const L = +s, parts = [];
for (const [i, f] of fs.entries()) parts.push({ input: await sharp(f, { limitInputPixels: false }).extract({ left: +x, top: +y, width: L, height: L }).resize(L * 2, L * 2, { kernel: 'nearest' }).png().toBuffer(), left: i * (L * 2 + 8), top: 0 });
await sharp({ create: { width: fs.length * (L * 2 + 8), height: L * 2, channels: 3, background: '#fff' } }).composite(parts).png().toFile(out);
