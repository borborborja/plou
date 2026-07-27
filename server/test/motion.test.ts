import { describe, expect, it } from 'vitest';
import { cellOffsetKm, maxInDisc, valueAt, type PrecipField } from '../src/radar/field.js';
import { estimateMotion, estimateMotionSeries } from '../src/radar/motion.js';
import { NO_ECHO } from '../src/radar/tiles.js';

/** Construye una rejilla vacía con la geometría indicada. */
function emptyField(half: number, cellKm: number, time: number): PrecipField {
  const width = half * 2 + 1;
  return {
    center: { lat: 41, lon: 2 },
    time,
    frameKind: 'past',
    cellKm,
    half,
    width,
    height: width,
    dbz: new Int16Array(width * width).fill(NO_ECHO),
    kind: new Uint8Array(width * width),
    coverage: 0,
  };
}

/**
 * Dibuja una banda de precipitación gaussiana centrada en `(ci, cj)`.
 * Un blob suave permite comprobar también el refinado subcelda.
 */
function paintBlob(field: PrecipField, ci: number, cj: number, radius: number, peak = 45): void {
  let echoes = 0;
  for (let j = 0; j < field.height; j++) {
    for (let i = 0; i < field.width; i++) {
      const d = Math.hypot(i - ci, j - cj);
      if (d > radius) continue;
      const value = Math.round(peak * Math.exp(-(d * d) / (2 * (radius / 2) ** 2)));
      if (value <= 5) continue;
      const k = j * field.width + i;
      field.dbz[k] = value;
      field.kind[k] = 1;
      echoes++;
    }
  }
  field.coverage = echoes / field.dbz.length;
}

describe('estimateMotion', () => {
  it('recupera un desplazamiento conocido hacia el este', () => {
    const half = 40;
    const cellKm = 2;
    const a = emptyField(half, cellKm, 1000);
    const b = emptyField(half, cellKm, 1000 + 600); // 10 minutos después
    paintBlob(a, 30, 40, 12);
    paintBlob(b, 35, 40, 12); // 5 celdas = 10 km al este

    const motion = estimateMotion(a, b);
    expect(motion).not.toBeNull();
    // 10 km en 10 min = 60 km/h.
    expect(motion!.east).toBeCloseTo(60, 0);
    expect(Math.abs(motion!.north)).toBeLessThan(6);
    expect(motion!.speedKmh).toBeCloseTo(60, 0);
    expect(motion!.bearingDeg).toBeCloseTo(90, 0);
    expect(motion!.confidence).toBeGreaterThan(0.5);
  });

  it('recupera un desplazamiento hacia el norte', () => {
    const a = emptyField(40, 2, 0);
    const b = emptyField(40, 2, 600);
    paintBlob(a, 40, 38, 12);
    paintBlob(b, 40, 41, 12); // en esta rejilla `j` crece hacia el norte

    const motion = estimateMotion(a, b);
    expect(motion).not.toBeNull();
    expect(motion!.north).toBeCloseTo(36, 0); // 6 km en 10 min
    expect(Math.abs(motion!.east)).toBeLessThan(6);
    expect(motion!.bearingDeg).toBeCloseTo(0, 0);
  });

  it('recupera un desplazamiento hacia el suroeste', () => {
    const a = emptyField(40, 2, 0);
    const b = emptyField(40, 2, 600);
    paintBlob(a, 44, 44, 12);
    paintBlob(b, 40, 40, 12);

    const motion = estimateMotion(a, b);
    expect(motion).not.toBeNull();
    expect(motion!.east).toBeLessThan(-40);
    expect(motion!.north).toBeLessThan(-40);
    expect(motion!.bearingDeg).toBeCloseTo(225, -1);
  });

  it('detecta un campo estacionario', () => {
    const a = emptyField(40, 2, 0);
    const b = emptyField(40, 2, 600);
    paintBlob(a, 40, 40, 12);
    paintBlob(b, 40, 40, 12);

    const motion = estimateMotion(a, b);
    expect(motion).not.toBeNull();
    expect(motion!.speedKmh).toBeLessThan(6);
  });

  it('devuelve null si no hay eco suficiente', () => {
    const a = emptyField(20, 2, 0);
    const b = emptyField(20, 2, 600);
    expect(estimateMotion(a, b)).toBeNull();
  });

  it('devuelve null si las geometrías no coinciden', () => {
    const a = emptyField(20, 2, 0);
    const b = emptyField(30, 2, 600);
    paintBlob(a, 20, 20, 8);
    paintBlob(b, 30, 30, 8);
    expect(estimateMotion(a, b)).toBeNull();
  });

  it('devuelve null si los fotogramas no avanzan en el tiempo', () => {
    const a = emptyField(40, 2, 600);
    const b = emptyField(40, 2, 600);
    paintBlob(a, 30, 40, 12);
    paintBlob(b, 35, 40, 12);
    expect(estimateMotion(a, b)).toBeNull();
  });
});

describe('estimateMotionSeries', () => {
  it('combina varios pares y mantiene el resultado', () => {
    const fields = [0, 1, 2, 3].map((n) => {
      const f = emptyField(40, 2, n * 600);
      paintBlob(f, 25 + n * 5, 40, 12);
      return f;
    });
    const motion = estimateMotionSeries(fields);
    expect(motion).not.toBeNull();
    expect(motion!.east).toBeCloseTo(60, 0);
  });

  it('necesita al menos dos fotogramas', () => {
    expect(estimateMotionSeries([emptyField(10, 2, 0)])).toBeNull();
  });
});

describe('consulta de la rejilla', () => {
  it('valueAt localiza la celda correcta', () => {
    const field = emptyField(10, 2, 0);
    const k = 12 * field.width + 14; // i=14, j=12
    field.dbz[k] = 42;
    field.kind[k] = 1;
    const { east, north } = cellOffsetKm(field, 14, 12);
    expect(valueAt(field, east, north)).toBe(42);
  });

  it('valueAt devuelve "sin eco" fuera de la rejilla', () => {
    const field = emptyField(10, 2, 0);
    expect(valueAt(field, 500, 0)).toBe(NO_ECHO);
  });

  it('maxInDisc toma el máximo del entorno', () => {
    const field = emptyField(10, 2, 0);
    field.dbz[10 * field.width + 12] = 30;
    field.kind[10 * field.width + 12] = 1;
    field.dbz[10 * field.width + 13] = 48;
    field.kind[10 * field.width + 13] = 2;

    const probe = maxInDisc(field, 0, 0, 8);
    expect(probe.dbz).toBe(48);
    expect(probe.kind).toBe(2);
  });

  it('maxInDisc no encuentra nada si el disco es demasiado pequeño', () => {
    const field = emptyField(10, 2, 0);
    field.dbz[10 * field.width + 16] = 50;
    field.kind[10 * field.width + 16] = 1;
    expect(maxInDisc(field, 0, 0, 2).dbz).toBe(NO_ECHO);
  });
});
