/**
 * Comprobación del vector de desplazamiento sobre datos reales.
 *
 * 1. Prueba de signo y magnitud: se toma un fotograma real, se desplaza un
 *    número conocido de celdas y se comprueba que la correlación recupera ese
 *    desplazamiento. Es una verificación exacta sobre textura realista.
 * 2. Contraste con el centroide: sobre el mismo par de fotogramas se compara la
 *    dirección estimada con el movimiento del centroide de los ecos. Es un
 *    método independiente, aunque sensible a los ecos que entran y salen del
 *    dominio, así que sirve como indicio, no como prueba.
 *
 *   npx tsx scripts/verify-motion.mts [lat] [lon]
 */
import { buildField, cellOffsetKm, type PrecipField } from '../src/radar/field.js';
import { getRadarIndex } from '../src/radar/frames.js';
import { estimateMotion } from '../src/radar/motion.js';
import { NO_ECHO } from '../src/radar/tiles.js';
import { compassPoint } from '../src/util/geo.js';

function cloneShifted(field: PrecipField, di: number, dj: number, time: number): PrecipField {
  const dbz = new Int16Array(field.dbz.length).fill(NO_ECHO);
  const kind = new Uint8Array(field.kind.length);
  for (let j = 0; j < field.height; j++) {
    const sj = j - dj;
    if (sj < 0 || sj >= field.height) continue;
    for (let i = 0; i < field.width; i++) {
      const si = i - di;
      if (si < 0 || si >= field.width) continue;
      dbz[j * field.width + i] = field.dbz[sj * field.width + si]!;
      kind[j * field.width + i] = field.kind[sj * field.width + si]!;
    }
  }
  return { ...field, time, dbz, kind };
}

/** Centroide de los ecos, ponderado por reflectividad, en km respecto al centro. */
function centroid(field: PrecipField): { east: number; north: number; weight: number } {
  let sumE = 0;
  let sumN = 0;
  let weight = 0;
  for (let j = 0; j < field.height; j++) {
    for (let i = 0; i < field.width; i++) {
      const v = field.dbz[j * field.width + i] ?? NO_ECHO;
      if (v <= 5) continue;
      const w = v - 5;
      const { east, north } = cellOffsetKm(field, i, j);
      sumE += east * w;
      sumN += north * w;
      weight += w;
    }
  }
  return weight === 0
    ? { east: 0, north: 0, weight: 0 }
    : { east: sumE / weight, north: sumN / weight, weight };
}

const lat = Number(process.argv[2] ?? 52.3676);
const lon = Number(process.argv[3] ?? 4.9041);

const index = await getRadarIndex();
const prev = index.past.at(-2)!;
const last = index.past.at(-1)!;
const opts = { radiusKm: 150, cellKm: 4 };

const [fPrev, fLast] = await Promise.all([
  buildField(index, prev, { lat, lon }, opts),
  buildField(index, last, { lat, lon }, opts),
]);

console.log(`Punto: ${lat}, ${lon}`);
console.log(`Fotogramas: ${new Date(prev.time * 1000).toISOString()} → ${new Date(last.time * 1000).toISOString()}`);
console.log(`Cobertura de eco: ${(fLast.coverage * 100).toFixed(2)} %`);

if (fLast.coverage < 0.02) {
  console.log('\nApenas hay eco en la zona: prueba con otras coordenadas.');
  process.exit(0);
}

// --- 1. Desplazamiento sintético sobre un fotograma real --------------------
console.log('\n1) Desplazamiento conocido aplicado a un fotograma real');
const dt = last.time - prev.time;
let allOk = true;
for (const [di, dj, label] of [
  [4, 0, 'este'],
  [-4, 0, 'oeste'],
  [0, 4, 'norte'],
  [0, -4, 'sur'],
  [3, 3, 'noreste'],
] as Array<[number, number, string]>) {
  const shifted = cloneShifted(fLast, di, dj, fLast.time + dt);
  const motion = estimateMotion(fLast, shifted);
  if (!motion) {
    console.log(`   ${label.padEnd(8)} → no estimable`);
    allOk = false;
    continue;
  }
  const expectedEast = (di * opts.cellKm) / (dt / 3600);
  const expectedNorth = (dj * opts.cellKm) / (dt / 3600);
  const errEast = Math.abs(motion.east - expectedEast);
  const errNorth = Math.abs(motion.north - expectedNorth);
  const ok = errEast < 8 && errNorth < 8;
  if (!ok) allOk = false;
  console.log(
    `   ${label.padEnd(8)} esperado (${expectedEast.toFixed(0)}, ${expectedNorth.toFixed(0)}) km/h · ` +
      `obtenido (${motion.east.toFixed(0)}, ${motion.north.toFixed(0)}) hacia ${compassPoint(motion.bearingDeg)} ` +
      `${ok ? '✓' : '✗'}`,
  );
}
console.log(allOk ? '   → signo y magnitud correctos' : '   → HAY DISCREPANCIAS');

// --- 2. Contraste con el centroide sobre el mismo par ----------------------
const cPrev = centroid(fPrev);
const cLast = centroid(fLast);
const motion = estimateMotion(fPrev, fLast);
console.log('\n2) Contraste con el centroide de los ecos (mismo par de fotogramas)');
if (!motion || cPrev.weight === 0 || cLast.weight === 0) {
  console.log('   No hay datos suficientes para el contraste.');
} else {
  const hours = dt / 3600;
  const cEast = (cLast.east - cPrev.east) / hours;
  const cNorth = (cLast.north - cPrev.north) / hours;
  const cBearing = ((Math.atan2(cEast, cNorth) * 180) / Math.PI + 360) % 360;
  const delta = Math.abs(((motion.bearingDeg - cBearing + 540) % 360) - 180);
  console.log(
    `   centroide: ${Math.hypot(cEast, cNorth).toFixed(0)} km/h hacia ${compassPoint(cBearing)} (${cBearing.toFixed(0)}°)`,
  );
  console.log(
    `   correlación: ${motion.speedKmh.toFixed(0)} km/h hacia ${compassPoint(motion.bearingDeg)} ` +
      `(${motion.bearingDeg.toFixed(0)}°), confianza ${motion.confidence.toFixed(2)}`,
  );
  console.log(`   diferencia: ${delta.toFixed(0)}°`);
}
