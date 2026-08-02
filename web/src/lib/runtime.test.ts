import { describe, expect, it } from 'vitest';
import { linkedLocationId, shouldRefresh } from './runtime';

describe('refresco periódico', () => {
  it('sólo frena el segundo plano cuando está activo el ahorro', () => {
    expect(shouldRefresh(false, false)).toBe(true);
    expect(shouldRefresh(false, true)).toBe(true);
    expect(shouldRefresh(true, false)).toBe(true);
    expect(shouldRefresh(true, true)).toBe(false);
  });
});

describe('enlaces de notificaciones', () => {
  it('acepta únicamente identificadores enteros positivos', () => {
    expect(linkedLocationId('?tab=radar&location=42')).toBe(42);
    expect(linkedLocationId('?location=-1')).toBeNull();
    expect(linkedLocationId('?location=3.5')).toBeNull();
    expect(linkedLocationId('?tab=radar')).toBeNull();
  });
});
