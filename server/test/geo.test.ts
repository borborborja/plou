import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  bearingDeg,
  compassPoint,
  haversineKm,
  latLonToGlobalPixel,
  metersPerPixel,
  normalizeLon,
  offsetKm,
} from '../src/util/geo.js';

describe('haversineKm', () => {
  it('mide distancias conocidas con menos de un 0,5 % de error', () => {
    // Barcelona – Madrid: unos 505 km.
    const d = haversineKm({ lat: 41.3874, lon: 2.1686 }, { lat: 40.4168, lon: -3.7038 });
    expect(d).toBeGreaterThan(500);
    expect(d).toBeLessThan(510);
  });

  it('devuelve cero para el mismo punto', () => {
    expect(haversineKm({ lat: 10, lon: 20 }, { lat: 10, lon: 20 })).toBe(0);
  });

  it('es simétrica', () => {
    const a = { lat: 52.37, lon: 4.9 };
    const b = { lat: 47.6, lon: -122.33 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });
});

describe('bearingDeg', () => {
  it('apunta al norte cuando el destino está más al norte', () => {
    expect(bearingDeg({ lat: 40, lon: 0 }, { lat: 41, lon: 0 })).toBeCloseTo(0, 4);
  });

  it('apunta al este cuando el destino está más al este', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 4);
  });
});

describe('offsetKm', () => {
  it('produce un punto a la distancia pedida', () => {
    const origin = { lat: 41.39, lon: 2.17 };
    const moved = offsetKm(origin, 30, 40); // 50 km en diagonal
    expect(haversineKm(origin, moved)).toBeCloseTo(50, 0);
  });

  it('desplaza hacia el norte al pedir un avance positivo en `north`', () => {
    const moved = offsetKm({ lat: 0, lon: 0 }, 0, 110.574);
    expect(moved.lat).toBeCloseTo(1, 5);
    expect(moved.lon).toBeCloseTo(0, 9);
  });
});

describe('latLonToGlobalPixel', () => {
  it('sitúa el meridiano y el ecuador en el centro del mundo', () => {
    const p = latLonToGlobalPixel({ lat: 0, lon: 0 }, 1, 512);
    expect(p.x).toBeCloseTo(512, 6);
    expect(p.y).toBeCloseTo(512, 6);
  });

  it('coloca la antemeridiana en los extremos', () => {
    const west = latLonToGlobalPixel({ lat: 0, lon: -180 }, 0, 256);
    expect(west.x).toBeCloseTo(0, 6);
  });
});

describe('metersPerPixel', () => {
  it('disminuye al alejarse del ecuador', () => {
    const equator = metersPerPixel(0, 7, 512);
    const north = metersPerPixel(60, 7, 512);
    expect(north).toBeLessThan(equator);
    expect(north / equator).toBeCloseTo(0.5, 2);
  });
});

describe('compassPoint', () => {
  it.each([
    [0, 'N'],
    [90, 'E'],
    [180, 'S'],
    [270, 'O'],
    [45, 'NE'],
    [225, 'SO'],
    [359, 'N'],
  ])('traduce %i grados a %s', (deg, expected) => {
    expect(compassPoint(deg)).toBe(expected);
  });
});

describe('normalizeLon y angleDelta', () => {
  it('normaliza longitudes fuera de rango', () => {
    expect(normalizeLon(190)).toBeCloseTo(-170, 9);
    expect(normalizeLon(-190)).toBeCloseTo(170, 9);
  });

  it('calcula la diferencia angular más corta', () => {
    expect(angleDelta(350, 10)).toBeCloseTo(20, 9);
    expect(angleDelta(10, 350)).toBeCloseTo(-20, 9);
  });
});
