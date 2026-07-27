import { NO_ECHO } from './tiles.js';
import type { PrecipField } from './field.js';

/**
 * Vector de desplazamiento del campo de precipitación, en km/h.
 * `east`/`north` son las componentes; `speedKmh` y `bearingDeg` la forma polar
 * (rumbo *hacia el que* se mueve la precipitación).
 */
export interface MotionVector {
  east: number;
  north: number;
  speedKmh: number;
  bearingDeg: number;
  /** Confianza en [0, 1] derivada de la mejora relativa del ajuste. */
  confidence: number;
  /** Nº de celdas con eco empleadas en la correlación. */
  samples: number;
}

/** Velocidad máxima plausible de un sistema precipitante, en km/h. */
const MAX_SPEED_KMH = 160;
/** Reflectividad mínima que se considera señal (evita perseguir ruido). */
const SIGNAL_FLOOR_DBZ = 5;
/** Fracción mínima de celdas con eco para intentar la correlación. */
const MIN_COVERAGE = 0.004;

function toIntensity(field: PrecipField): Float32Array {
  const out = new Float32Array(field.dbz.length);
  for (let k = 0; k < out.length; k++) {
    const v = field.dbz[k] ?? NO_ECHO;
    out[k] = v > SIGNAL_FLOOR_DBZ ? v - SIGNAL_FLOOR_DBZ : 0;
  }
  return out;
}

function countEchoes(field: PrecipField): number {
  let n = 0;
  for (let k = 0; k < field.dbz.length; k++) if ((field.dbz[k] ?? NO_ECHO) > SIGNAL_FLOOR_DBZ) n++;
  return n;
}

/**
 * Error cuadrático medio entre `a` y `b` cuando `b` se desplaza `(di, dj)`
 * celdas. Devuelve `null` si el solape es demasiado pequeño.
 */
function shiftedMse(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  di: number,
  dj: number,
  minOverlap: number,
): number | null {
  let sum = 0;
  let n = 0;
  const j0 = Math.max(0, -dj);
  const j1 = Math.min(height, height - dj);
  const i0 = Math.max(0, -di);
  const i1 = Math.min(width, width - di);
  for (let j = j0; j < j1; j++) {
    const rowA = j * width;
    const rowB = (j + dj) * width + di;
    for (let i = i0; i < i1; i++) {
      const d = (a[rowA + i] ?? 0) - (b[rowB + i] ?? 0);
      sum += d * d;
      n++;
    }
  }
  if (n < minOverlap) return null;
  return sum / n;
}

/** Ajuste parabólico en 1D sobre tres puntos para afinar el mínimo. */
function parabolicOffset(left: number, center: number, right: number): number {
  const denom = left - 2 * center + right;
  if (Math.abs(denom) < 1e-9) return 0;
  const off = (0.5 * (left - right)) / denom;
  return Math.max(-1, Math.min(1, off));
}

/**
 * Estima el desplazamiento entre dos rejillas consecutivas por correlación
 * cruzada (mínimo error cuadrático) con refinado subcelda.
 *
 * `previous` y `current` deben compartir geometría (mismo centro y celda).
 */
export function estimateMotion(previous: PrecipField, current: PrecipField): MotionVector | null {
  if (
    previous.width !== current.width ||
    previous.height !== current.height ||
    previous.cellKm !== current.cellKm
  ) {
    return null;
  }
  const dtHours = (current.time - previous.time) / 3600;
  if (dtHours <= 0) return null;

  const echoesPrev = countEchoes(previous);
  const echoesCur = countEchoes(current);
  const total = current.dbz.length;
  if (echoesPrev / total < MIN_COVERAGE || echoesCur / total < MIN_COVERAGE) return null;

  const a = toIntensity(previous);
  const b = toIntensity(current);
  const { width, height, cellKm } = current;

  const maxShift = Math.min(
    Math.floor(Math.min(width, height) / 3),
    Math.max(1, Math.ceil((MAX_SPEED_KMH * dtHours) / cellKm)),
  );
  const minOverlap = Math.max(64, Math.floor(width * height * 0.25));

  let best = { di: 0, dj: 0, mse: Number.POSITIVE_INFINITY };
  const scores = new Map<string, number>();

  for (let dj = -maxShift; dj <= maxShift; dj++) {
    for (let di = -maxShift; di <= maxShift; di++) {
      const mse = shiftedMse(a, b, width, height, di, dj, minOverlap);
      if (mse === null) continue;
      scores.set(`${di},${dj}`, mse);
      if (mse < best.mse) best = { di, dj, mse };
    }
  }
  if (!Number.isFinite(best.mse)) return null;

  const zero = scores.get('0,0');
  // Confianza: cuánto mejora el mejor desplazamiento frente a "sin movimiento".
  let confidence = 0;
  if (zero !== undefined && zero > 0) {
    confidence = Math.max(0, Math.min(1, 1 - best.mse / zero));
    if (best.di === 0 && best.dj === 0) confidence = 0.35; // campo estacionario
  }

  const around = (di: number, dj: number) => scores.get(`${di},${dj}`) ?? best.mse * 1.05;
  const subI = parabolicOffset(around(best.di - 1, best.dj), best.mse, around(best.di + 1, best.dj));
  const subJ = parabolicOffset(around(best.di, best.dj - 1), best.mse, around(best.di, best.dj + 1));

  // `shiftedMse` compara a(i, j) con b(i + di, j + dj): el mínimo indica dónde
  // ha reaparecido en `b` el eco que en `a` estaba en (i, j). El campo se ha
  // desplazado, por tanto, `+di` celdas al este y `+dj` celdas al norte
  // (en esta rejilla `j` crece hacia el norte).
  const cellsEast = best.di + subI;
  const cellsNorth = best.dj + subJ;
  const east = (cellsEast * cellKm) / dtHours;
  const north = (cellsNorth * cellKm) / dtHours;
  const speedKmh = Math.hypot(east, north);
  const bearing = (((Math.atan2(east, north) * 180) / Math.PI) + 360) % 360;

  return {
    east,
    north,
    speedKmh,
    bearingDeg: bearing,
    confidence,
    samples: Math.min(echoesPrev, echoesCur),
  };
}

/**
 * Combina las estimaciones de varios pares de fotogramas consecutivos usando la
 * mediana ponderada por confianza, lo que amortigua estimaciones erráticas.
 */
export function estimateMotionSeries(fields: readonly PrecipField[]): MotionVector | null {
  if (fields.length < 2) return null;
  const vectors: MotionVector[] = [];
  for (let i = 1; i < fields.length; i++) {
    const v = estimateMotion(fields[i - 1]!, fields[i]!);
    if (v && v.confidence > 0.05) vectors.push(v);
  }
  if (vectors.length === 0) return null;
  if (vectors.length === 1) return vectors[0]!;

  const median = (values: number[]): number => {
    const s = [...values].sort((x, y) => x - y);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid]! : ((s[mid - 1]! + s[mid]!) / 2);
  };

  const east = median(vectors.map((v) => v.east));
  const north = median(vectors.map((v) => v.north));
  const speedKmh = Math.hypot(east, north);
  const bearing = (((Math.atan2(east, north) * 180) / Math.PI) + 360) % 360;
  return {
    east,
    north,
    speedKmh,
    bearingDeg: bearing,
    confidence: median(vectors.map((v) => v.confidence)),
    samples: Math.max(...vectors.map((v) => v.samples)),
  };
}
