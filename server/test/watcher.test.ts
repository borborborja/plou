import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Un aviso sólo cuenta como emitido si alguien lo ha recibido.
 *
 * `sendToDevice` no lanza excepción: cuenta entregas y fallos. Si se daba por
 * emitido sin mirar ese recuento, un fallo puntual de la red dejaba el episodio
 * entero sin aviso, porque el intervalo mínimo bloqueaba el reintento.
 */

const analyzeLocation = vi.fn();
const sendToDevice = vi.fn();

vi.mock('../src/radar/analysis.js', () => ({ analyzeLocation }));
vi.mock('../src/push.js', () => ({ sendToDevice, pushAvailable: () => true }));

const { checkLocation } = await import('../src/alarm/watcher.js');
const { openDb, upsertDevice, createLocation, getAlarmState, listEvents } = await import('../src/db.js');
const { defaultAlarmConfig } = await import('../src/schema.js');

type Db = ReturnType<typeof openDb>;

const center = { lat: 41.39, lon: 2.17 };

/** Análisis con lluvia justo encima, que dispara la alarma en cualquier modo. */
function lloviendo() {
  const hit = {
    distanceKm: 0,
    bearingDeg: 0,
    compass: 'N',
    dbz: 35,
    mmPerHour: 5.6,
    intensity: 'Lluvia moderada',
    kind: 'rain' as const,
    position: center,
  };
  return {
    center,
    observedAt: Date.now(),
    ageMinutes: 2,
    radiusKm: 20,
    thresholdDbz: 20,
    radarCoverage: true,
    fieldCoverage: 0.2,
    overhead: hit,
    nearest: hit,
    strongest: hit,
    cellsAboveThreshold: 10,
    areaCoveragePct: 8,
    motion: null,
    etaMinutes: 0,
    etaRadiusMinutes: 0,
    clearingMinutes: null,
    timeline: [],
  };
}

describe('checkLocation: entrega del aviso', () => {
  let db: Db;
  let location: ReturnType<typeof createLocation>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertDevice(db, 'disp');
    location = createLocation(db, 'disp', {
      name: 'Casa',
      lat: center.lat,
      lon: center.lon,
      followDevice: false,
      alarm: defaultAlarmConfig(),
    });

    analyzeLocation.mockResolvedValue(lloviendo());
  });

  afterEach(() => {
    vi.clearAllMocks();
    db.close();
  });

  it('marca el aviso como emitido cuando se entrega', async () => {
    sendToDevice.mockResolvedValue({ sent: 1, failed: 0, removed: 0 });

    expect(await checkLocation(db, location)).toBe('fired');

    const state = getAlarmState(db, location.id);
    expect(state.active).toBe(1);
    expect(state.last_fired_at).not.toBeNull();
    expect(listEvents(db, 'disp', 10)).toHaveLength(1);
  });

  it('no lo da por emitido si ninguna entrega ha salido', async () => {
    sendToDevice.mockResolvedValue({ sent: 0, failed: 2, removed: 0 });

    expect(await checkLocation(db, location)).toBe('error');

    const state = getAlarmState(db, location.id);
    // Sin `last_fired_at`, el siguiente ciclo vuelve a intentarlo en lugar de
    // quedarse callado por el intervalo mínimo.
    expect(state.last_fired_at).toBeNull();
    expect(state.active).toBe(0);
    expect(state.last_error).toContain('no se pudo entregar');
    expect(listEvents(db, 'disp', 10)).toHaveLength(0);
  });

  it('reintenta en el ciclo siguiente y entonces sí lo registra', async () => {
    sendToDevice.mockResolvedValueOnce({ sent: 0, failed: 1, removed: 0 });
    expect(await checkLocation(db, location)).toBe('error');

    sendToDevice.mockResolvedValueOnce({ sent: 1, failed: 0, removed: 0 });
    expect(await checkLocation(db, location)).toBe('fired');

    expect(getAlarmState(db, location.id).last_fired_at).not.toBeNull();
    expect(listEvents(db, 'disp', 10)).toHaveLength(1);
  });

  it('sin suscripciones no se considera un fallo de entrega', async () => {
    // No hay a quién avisar: no tiene sentido reintentar en bucle.
    sendToDevice.mockResolvedValue({ sent: 0, failed: 0, removed: 0 });

    expect(await checkLocation(db, location)).toBe('fired');
    expect(getAlarmState(db, location.id).last_fired_at).not.toBeNull();
  });

  it('un error del análisis no marca la alarma como emitida', async () => {
    analyzeLocation.mockRejectedValue(new Error('radar caído'));

    expect(await checkLocation(db, location)).toBe('error');

    const state = getAlarmState(db, location.id);
    expect(state.last_fired_at).toBeNull();
    expect(state.last_error).toContain('radar caído');
  });
});
