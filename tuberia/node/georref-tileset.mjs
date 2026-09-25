// georref-tileset.mjs: copia un tileset LOCAL de armar-tiles.mjs y le pone un
// root.transform que lo lleva a ECEF (WGS84), para verlo sobre un globo
// (Cesium, 3d-tiles-renderer con GlobeControls, ArcGIS...).
//
// Marco local de armar-tiles (despues de su rotacion de ejes, sin espejo):
//   x = este de cuadricula UTM, y = norte de cuadricula UTM, z = altura,
//   origen = offset.json.offset (x, y en UTM; z ortometrica sin corregir).
//
// Cadena (de derecha a izquierda, como se aplica a un punto del tileset):
//   EJES         (este, -altura, norte) del runtime -> (este, norte, altura)
//   R_incl       rotacion que endereza la inclinacion medida contra el DEM
//                (offset.json.ajuste_plano a, b): la normal del suelo de la
//                malla (a, b, 1) pasa a (0, 0, 1). Rotacion, no corte, para
//                que las paredes queden verticales.
//                (alrededor de z = ajuste_plano.z_pivote, la altura del suelo)
//   T(0,0,c)     correccion vertical del plano en el origen (ajuste_plano.c)
//   escala 1/k   metros de cuadricula UTM -> metros reales (solo horizontal)
//   Rz(-gamma)   norte de cuadricula -> norte geografico (convergencia)
//   ENU->ECEF    en (lat0, lon0) del origen, altura elipsoidal h0 = z0 + N
//                (N = ondulacion del geoide EGM2008; las alturas del DEM son
//                EGM2008 ortometricas)
//
// Uso: node georref-tileset.mjs <tileset-local> <salida> <offset.json> --geoide 22.18
//      [--zona-mc -75]  meridiano central de la zona UTM (18N = -75)
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [ENTRADA, SALIDA, OFFSET] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const N_GEOIDE = +opt('geoide', NaN);
if (!Number.isFinite(N_GEOIDE)) throw new Error('falta --geoide (ondulacion EGM2008 en el sitio, m)');
const MC = +opt('zona-mc', -75);

const off = JSON.parse(fs.readFileSync(OFFSET, 'utf8'));
const { lat: lat0, lon: lon0 } = off.centro_wgs84;
const z0 = off.offset.z;
const plano = off.ajuste_plano || { a: 0, b: 0, c: off.ajuste_vertical_m || 0 };

// columna mayor
const mul = (A, B) => { const r = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let f = 0; f < 4; f++) for (let k = 0; k < 4; k++) r[c * 4 + f] += A[k * 4 + f] * B[c * 4 + k]; return r; };
const EJES = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];

// Rodrigues: rota n = (a, b, 1)/|.| hasta (0, 0, 1). Eje = n x z.
function rotIncl(a, b) {
  const L = Math.hypot(a, b, 1), n = [a / L, b / L, 1 / L];
  const ax = [n[1], -n[0], 0], s = Math.hypot(ax[0], ax[1]), c = n[2];
  if (s < 1e-12) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const [x, y, z] = ax.map(v => v / s), t = 1 - c;
  const R = [ // filas
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
  return [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, 0, 0, 0, 1];
}

// Convergencia y factor de escala de Transversa de Mercator (series, WGS84).
const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
const phi = lat0 * rad, dl = (lon0 - MC) * rad, cphi = Math.cos(phi), eta2 = ep2 * cphi * cphi;
const gamma = Math.atan(Math.tan(dl) * Math.sin(phi)) * (1 + (dl * dl * cphi * cphi / 3) * (1 + 3 * eta2));
const k = 0.9996 * (1 + (dl * dl * cphi * cphi / 2) * (1 + eta2));

function enuAEcef(latDeg, lonDeg, h) {
  const a = 6378137;
  const la = latDeg * rad, lo = lonDeg * rad, sl = Math.sin(la), cl = Math.cos(la), so = Math.sin(lo), co = Math.cos(lo);
  const N = a / Math.sqrt(1 - e2 * sl * sl);
  return [-so, co, 0, 0, -sl * co, -sl * so, cl, 0, cl * co, cl * so, sl, 0, (N + h) * cl * co, (N + h) * cl * so, (N * (1 - e2) + h) * sl, 1];
}
const cg = Math.cos(-gamma), sg = Math.sin(-gamma);
const RZ = [cg, sg, 0, 0, -sg, cg, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const ESC = [1 / k, 0, 0, 0, 0, 1 / k, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, plano.c, 1];
// La rotacion gira alrededor de la altura del suelo (z_pivote), no de z = 0:
// asi el suelo casi no se desplaza en horizontal y solo se enderezan las paredes.
const zp = plano.z_pivote || 0;
const subir = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, zp, 1], bajar = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -zp, 1];
const M = [enuAEcef(lat0, lon0, z0 + N_GEOIDE), RZ, ESC, T, subir, rotIncl(plano.a, plano.b), bajar, EJES].reduce(mul);

const ts = JSON.parse(fs.readFileSync(path.join(ENTRADA, 'tileset.json'), 'utf8'));
ts.root.transform = M;
ts.asset.extras = {
  georreferencia: {
    origen_wgs84: { lat: lat0, lon: lon0, h_elipsoidal: z0 + N_GEOIDE },
    geoide_egm2008_m: N_GEOIDE, convergencia_grados: gamma / rad, escala_utm: k,
    ajuste_plano: plano, fuente: path.basename(OFFSET),
  },
};
fs.mkdirSync(SALIDA, { recursive: true });
fs.cpSync(ENTRADA, SALIDA, { recursive: true, filter: (s) => !s.endsWith('tileset.json') });
fs.writeFileSync(path.join(SALIDA, 'tileset.json'), JSON.stringify(ts));
fs.writeFileSync(path.join(SALIDA, 'transform.json'), JSON.stringify({ M, gamma_grados: gamma / rad, k, lat0, lon0, h0: z0 + N_GEOIDE, plano }, null, 2));
console.log(`convergencia ${(gamma / rad).toFixed(5)} grados, escala ${k.toFixed(7)}, h0 ${(z0 + N_GEOIDE).toFixed(2)} m elipsoidal, inclinacion corregida ${(Math.atan(Math.hypot(plano.a, plano.b)) / rad).toFixed(2)} grados`);
