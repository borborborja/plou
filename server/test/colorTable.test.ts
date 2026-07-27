import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_SCHEME,
  COLOR_SCHEMES,
  DBZ_MIN,
  dbzToMmPerHour,
  decodePixel,
  intensityLabel,
  isSnowDistinguishable,
  legendFor,
  mmPerHourToDbz,
} from '../src/radar/colorTable.js';
import { RAIN_RAMPS, SNOW_RAMPS } from '../src/radar/colorTable.generated.js';

describe('tabla de colores', () => {
  it('publica los nueve esquemas del proveedor', () => {
    expect(COLOR_SCHEMES).toHaveLength(9);
    expect(COLOR_SCHEMES.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('el esquema de análisis separa lluvia y nieve sin ambigüedad', () => {
    expect(isSnowDistinguishable(ANALYSIS_SCHEME)).toBe(true);
  });
});

describe('leyenda', () => {
  it('cada color proviene de la rampa real del esquema', () => {
    for (const scheme of COLOR_SCHEMES) {
      const ramp = RAIN_RAMPS[scheme.key];
      for (const stop of legendFor(scheme.key)) {
        const o = (stop.dbz - DBZ_MIN) * 4;
        const hex = (v: number): string => v.toString(16).padStart(2, '0');
        expect(stop.rain).toBe(`#${hex(ramp[o]!)}${hex(ramp[o + 1]!)}${hex(ramp[o + 2]!)}`);
      }
    }
  });

  it('los escalones suben en reflectividad e intensidad', () => {
    const stops = legendFor(ANALYSIS_SCHEME);
    expect(stops.length).toBeGreaterThan(5);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]!.dbz).toBeGreaterThan(stops[i - 1]!.dbz);
      expect(stops[i]!.mmPerHour).toBeGreaterThan(stops[i - 1]!.mmPerHour);
    }
  });

  it('rotula los umbrales que ofrecen las alarmas', () => {
    const labelled = legendFor(ANALYSIS_SCHEME).filter((s) => s.label);
    expect(labelled.map((s) => s.dbz)).toEqual([20, 30, 40, 50]);
  });

  it('sólo incluye color de nieve si el esquema la distingue', () => {
    for (const scheme of COLOR_SCHEMES) {
      const distinguishable = isSnowDistinguishable(scheme.key);
      for (const stop of legendFor(scheme.key)) {
        expect(Boolean(stop.snow)).toBe(distinguishable);
      }
    }
  });
});

describe('decodePixel', () => {
  it('devuelve null para píxeles transparentes', () => {
    expect(decodePixel(0, 0, 0, 0)).toBeNull();
  });

  it('cada color de la rampa de lluvia vuelve a su propio color', () => {
    const ramp = RAIN_RAMPS[ANALYSIS_SCHEME];
    let checked = 0;
    for (let i = 0; i < 128; i++) {
      const o = i * 4;
      const a = ramp[o + 3]!;
      if (a === 0) continue;

      const decoded = decodePixel(ramp[o]!, ramp[o + 1]!, ramp[o + 2]!, a);
      expect(decoded).not.toBeNull();
      expect(decoded!.kind).toBe('rain');

      // La rampa repite color en algunos tramos altos; ante un empate se
      // devuelve el dBZ más bajo, que es el criterio conservador para alarmas.
      expect(decoded!.dbz).toBeLessThanOrEqual(DBZ_MIN + i);

      // Invariante fuerte: el nivel devuelto tiene exactamente ese color.
      const back = (decoded!.dbz - DBZ_MIN) * 4;
      expect([ramp[back], ramp[back + 1], ramp[back + 2], ramp[back + 3]]).toEqual([
        ramp[o],
        ramp[o + 1],
        ramp[o + 2],
        ramp[o + 3],
      ]);
      checked++;
    }
    expect(checked).toBeGreaterThan(90);
  });

  it('los niveles con color propio se recuperan de forma exacta', () => {
    const ramp = RAIN_RAMPS[ANALYSIS_SCHEME];
    // Umbrales que usa la configuración de sensibilidad.
    for (const dbz of [12, 20, 30, 40, 50]) {
      const o = (dbz - DBZ_MIN) * 4;
      const decoded = decodePixel(ramp[o]!, ramp[o + 1]!, ramp[o + 2]!, ramp[o + 3]!);
      expect(decoded!.dbz).toBe(dbz);
    }
  });

  it('clasifica como nieve los colores de la rampa de nieve', () => {
    const ramp = SNOW_RAMPS[ANALYSIS_SCHEME];
    for (let i = 40; i < 90; i++) {
      const o = i * 4;
      if ((ramp[o + 3] ?? 0) === 0) continue;
      const decoded = decodePixel(ramp[o]!, ramp[o + 1]!, ramp[o + 2]!, ramp[o + 3]!);
      expect(decoded?.kind).toBe('snow');
    }
  });

  it('tolera pequeñas desviaciones de color y descarta las grandes', () => {
    const ramp = RAIN_RAMPS[ANALYSIS_SCHEME];
    const o = 60 * 4; // dBZ 28
    const near = decodePixel(
      (ramp[o]! + 3) % 256,
      ramp[o + 1]!,
      ramp[o + 2]!,
      ramp[o + 3]!,
    );
    expect(near).not.toBeNull();

    // Un color que no se parece a nada de la paleta (magenta puro con alfa alto).
    expect(decodePixel(255, 0, 255, 255)).toBeNull();
  });

  it('cachea las búsquedas aproximadas devolviendo el mismo resultado', () => {
    const first = decodePixel(1, 165, 225, 255);
    const second = decodePixel(1, 165, 225, 255);
    expect(second).toEqual(first);
  });
});

describe('conversión de reflectividad', () => {
  it('la relación Marshall-Palmer es invertible', () => {
    for (const dbz of [10, 20, 30, 40, 50]) {
      expect(mmPerHourToDbz(dbzToMmPerHour(dbz))).toBeCloseTo(dbz, 6);
    }
  });

  it('crece con la reflectividad', () => {
    expect(dbzToMmPerHour(20)).toBeLessThan(dbzToMmPerHour(35));
    expect(dbzToMmPerHour(35)).toBeLessThan(dbzToMmPerHour(50));
  });

  it('sitúa 20 dBZ en torno a la lluvia débil', () => {
    const mmh = dbzToMmPerHour(20);
    expect(mmh).toBeGreaterThan(0.5);
    expect(mmh).toBeLessThan(1.5);
  });

  it('devuelve cero por debajo del mínimo de la escala', () => {
    expect(dbzToMmPerHour(DBZ_MIN)).toBe(0);
  });
});

describe('intensityLabel', () => {
  it('escala la etiqueta con la reflectividad', () => {
    expect(intensityLabel(5)).toBe('Sin precipitación');
    expect(intensityLabel(15)).toBe('Llovizna');
    expect(intensityLabel(25)).toBe('Lluvia débil');
    expect(intensityLabel(35)).toBe('Lluvia moderada');
    expect(intensityLabel(45)).toBe('Lluvia fuerte');
    expect(intensityLabel(55)).toBe('Tormenta');
  });
});
