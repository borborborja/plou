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
    dataCoverage: 1,
    overhead: hit,
    nearest: hit,
    strongest: hit,
    arrival: hit,
    cellsAboveThreshold: 10,
    areaCoveragePct: 8,
    motion: null,
    etaMinutes: 0,
    etaRadiusMinutes: 0,
    clearingMinutes: null,
    timeline: [],
  };
}

/** El mismo análisis pero sin nada que avise: cielo despejado. */
function despejado() {
  return {
    ...lloviendo(),
    overhead: null,
    nearest: null,
    strongest: null,
    arrival: null,
    cellsAboveThreshold: 0,
    areaCoveragePct: 0,
    etaMinutes: null,
    etaRadiusMinutes: null,
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

  it('no evalúa una ubicación seguida cuya posición ya ha caducado', async () => {
    const followed = createLocation(db, 'disp', {
      name: 'Mi posición',
      lat: center.lat,
      lon: center.lon,
      followDevice: true,
      alarm: defaultAlarmConfig(),
    });
    db.prepare('UPDATE locations SET position_updated_at = ? WHERE id = ?').run(0, followed.id);

    expect(await checkLocation(db, { ...followed, positionUpdatedAt: 0 })).toBe('error');
    expect(getAlarmState(db, followed.id).last_error).toContain('posición');
    expect(analyzeLocation).not.toHaveBeenCalled();
  });
});

/**
 * Una tesela que no llega es indistinguible de una sin lluvia. Sin vigilar eso,
 * una caída de red se lee como buen tiempo y la comprobación queda registrada
 * como correcta.
 */
describe('checkLocation: datos de radar incompletos', () => {
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
    sendToDevice.mockResolvedValue({ sent: 1, failed: 0, removed: 0 });
  });

  afterEach(() => {
    vi.clearAllMocks();
    db.close();
  });

  it('un «no pasa nada» con teselas que faltan no cuenta como comprobación buena', async () => {
    analyzeLocation.mockResolvedValue({ ...despejado(), dataCoverage: 0.7 });

    expect(await checkLocation(db, location)).toBe('error');
    expect(getAlarmState(db, location.id)?.last_error).toContain('incompletos');
  });

  it('con los datos completos, un «no pasa nada» es una comprobación buena', async () => {
    analyzeLocation.mockResolvedValue({ ...despejado(), dataCoverage: 1 });

    expect(await checkLocation(db, location)).toBe('none');
    expect(getAlarmState(db, location.id)?.last_error).toBeFalsy();
  });

  it('un fallo suelto en el borde de la rejilla no invalida la comprobación', async () => {
    analyzeLocation.mockResolvedValue({ ...despejado(), dataCoverage: 0.98 });

    expect(await checkLocation(db, location)).toBe('none');
  });

  it('si hay lluvia, el aviso sale aunque falten teselas', async () => {
    // Lo que falta puede esconder lluvia, nunca inventarla: callar un aviso
    // porque el dato esté incompleto sería peor que emitirlo.
    analyzeLocation.mockResolvedValue({ ...lloviendo(), dataCoverage: 0.4 });

    expect(await checkLocation(db, location)).toBe('fired');
    expect(listEvents(db, 'disp', 10)).toHaveLength(1);
  });
});
