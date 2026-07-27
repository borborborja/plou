import { describe, expect, it } from 'vitest';
import { isWithinWindow, localTime } from '../src/alarm/window.js';

/** Instante UTC concreto: martes 15 de julio de 2025, 21:30 UTC. */
const TUESDAY_2130_UTC = Date.UTC(2025, 6, 15, 21, 30);

describe('localTime', () => {
  it('convierte a la zona horaria pedida', () => {
    // Madrid está en UTC+2 en julio: 23:30 del martes.
    const madrid = localTime(TUESDAY_2130_UTC, 'Europe/Madrid');
    expect(madrid.minutes).toBe(23 * 60 + 30);
    expect(madrid.weekday).toBe(2);

    // Nueva York está en UTC-4: 17:30 del mismo martes.
    const ny = localTime(TUESDAY_2130_UTC, 'America/New_York');
    expect(ny.minutes).toBe(17 * 60 + 30);
    expect(ny.weekday).toBe(2);
  });

  it('cae a UTC ante una zona horaria desconocida', () => {
    const value = localTime(TUESDAY_2130_UTC, 'Marte/Olympus_Mons');
    expect(value.minutes).toBe(21 * 60 + 30);
  });
});

describe('isWithinWindow', () => {
  it('acepta franjas normales dentro del mismo día', () => {
    expect(isWithinWindow(TUESDAY_2130_UTC, 'UTC', '21:00', '22:00')).toBe(true);
    expect(isWithinWindow(TUESDAY_2130_UTC, 'UTC', '08:00', '17:00')).toBe(false);
  });

  it('trata el final de la franja como exclusivo', () => {
    const at0900 = Date.UTC(2025, 6, 15, 9, 0);
    expect(isWithinWindow(at0900, 'UTC', '07:00', '09:00')).toBe(false);
    expect(isWithinWindow(at0900, 'UTC', '09:00', '17:00')).toBe(true);
  });

  it('gestiona franjas que cruzan la medianoche', () => {
    // 22:00–07:00 con la hora local a las 23:30 en Madrid.
    expect(isWithinWindow(TUESDAY_2130_UTC, 'Europe/Madrid', '22:00', '07:00')).toBe(true);
    // A las 03:00 UTC del miércoles sigue dentro.
    const wednesday0300 = Date.UTC(2025, 6, 16, 3, 0);
    expect(isWithinWindow(wednesday0300, 'UTC', '22:00', '07:00')).toBe(true);
    // A las 12:00 está fuera.
    const noon = Date.UTC(2025, 6, 16, 12, 0);
    expect(isWithinWindow(noon, 'UTC', '22:00', '07:00')).toBe(false);
  });

  it('respeta la lista de días en franjas normales', () => {
    // Martes = 2.
    expect(isWithinWindow(TUESDAY_2130_UTC, 'UTC', '21:00', '22:00', [2])).toBe(true);
    expect(isWithinWindow(TUESDAY_2130_UTC, 'UTC', '21:00', '22:00', [3])).toBe(false);
  });

  it('asocia la madrugada al día en que empezó la franja', () => {
    // Miércoles 03:00 pertenece a la noche del martes (día 2).
    const wednesday0300 = Date.UTC(2025, 6, 16, 3, 0);
    expect(isWithinWindow(wednesday0300, 'UTC', '22:00', '07:00', [2])).toBe(true);
    expect(isWithinWindow(wednesday0300, 'UTC', '22:00', '07:00', [3])).toBe(false);
  });

  it('una lista con los siete días equivale a no restringir', () => {
    expect(isWithinWindow(TUESDAY_2130_UTC, 'UTC', '21:00', '22:00', [0, 1, 2, 3, 4, 5, 6])).toBe(true);
  });

  it('una franja vacía no se aplica nunca', () => {
    expect(isWithinWindow(TUESDAY_2130_UTC, 'UTC', '10:00', '10:00')).toBe(false);
  });
});
