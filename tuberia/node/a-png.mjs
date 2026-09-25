// a-png.mjs: pasa las texturas de un OBJ a PNG (sin perdida) antes de Obj2Tiles.
// Por que: Obj2Tiles 1.6.2 reempaca las texturas de LOD-0 ("Repack") y las
// escribe en el formato de entrada; si la entrada es JPEG las recodifica a
// calidad 75 fija (no respeta --texture-quality). Con PNG la hoja sale sin
// perdida y la unica recodificacion con perdida la hace armar-tiles.mjs, una sola
// vez y a la calidad que uno elija.
// Uso: node a-png.mjs <dir-origen-jpg> <dir-destino>
import fs from 'node:fs'; import path from 'node:path'; import sharp from 'sharp';
sharp.cache(false); sharp.concurrency(4);
const [src, dst] = process.argv.slice(2);
const jpgs = fs.readdirSync(src).filter(f => /\.jpe?g$/i.test(f));
for (const f of jpgs) {
  const out = path.join(dst, f.replace(/\.jpe?g$/i, '.png'));
  await sharp(path.join(src, f), { limitInputPixels: false }).png({ compressionLevel: 1 }).toFile(out);
  console.log(f, '->', path.basename(out));
}
