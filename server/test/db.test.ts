import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLocation,
  deleteLocation,
  getAlarmState,
  getSettings,
  listEvents,
  listLocations,
  listMonitoredLocations,
  listSubscriptions,
  markSubscriptionResult,
  openDb,
  pruneEvents,
  recordEvent,
  saveAlarmState,
  saveSettings,
  saveSubscription,
  snoozeLocation,
  updateLocation,
  upsertDevice,
  type Db,
} from '../src/db.js';
import { alarmConfigSchema, settingsSchema } from '../src/schema.js';

let db: Db;
const DEVICE = 'dispositivo-de-prueba';

beforeEach(() => {
  db = openDb(':memory:');
  upsertDevice(db, DEVICE, 'vitest');
});

describe('dispositivos y preferencias', () => {
  it('crea el dispositivo con las preferencias por defecto', () => {
    const settings = getSettings(db, DEVICE);
    expect(settings.language).toBe('es');
    expect(settings.units.temperature).toBe('C');
  });

  it('guarda y recupera preferencias', () => {
    const next = settingsSchema.parse({ language: 'en', timezone: 'Europe/Madrid' });
    saveSettings(db, DEVICE, next);
    const loaded = getSettings(db, DEVICE);
    expect(loaded.language).toBe('en');
    expect(loaded.timezone).toBe('Europe/Madrid');
  });

  it('vuelve a los valores por defecto si el JSON guardado está corrupto', () => {
    db.prepare('UPDATE devices SET settings_json = ? WHERE id = ?').run('{no es json', DEVICE);
    expect(getSettings(db, DEVICE).language).toBe('es');
  });

  it('el segundo alta actualiza la última visita en lugar de duplicar', () => {
    upsertDevice(db, DEVICE);
    const count = db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe('ubicaciones', () => {
  const base = {
    name: 'Casa',
    lat: 41.39,
    lon: 2.17,
    followDevice: false,
    alarm: alarmConfigSchema.parse({}),
  };

  it('crea y lista ubicaciones', () => {
    const created = createLocation(db, DEVICE, base);
    expect(created.id).toBeGreaterThan(0);
    expect(listLocations(db, DEVICE)).toHaveLength(1);
    // El estado de alarma se crea junto con la ubicación.
    expect(getAlarmState(db, created.id).active).toBe(0);
  });

  it('sólo permite una ubicación que siga al dispositivo', () => {
    createLocation(db, DEVICE, { ...base, name: 'Primera', followDevice: true });
    createLocation(db, DEVICE, { ...base, name: 'Segunda', followDevice: true });
    const following = listLocations(db, DEVICE).filter((l) => l.followDevice);
    expect(following).toHaveLength(1);
    expect(following[0]!.name).toBe('Segunda');
  });

  it('fusiona los cambios parciales de la alarma', () => {
    const created = createLocation(db, DEVICE, base);
    const updated = updateLocation(db, created.id, DEVICE, {
      alarm: { radiusKm: 55 } as never,
    });
    expect(updated!.alarm.radiusKm).toBe(55);
    // El resto de la configuración se conserva.
    expect(updated!.alarm.intensity).toBe(base.alarm.intensity);
  });

  it('no deja modificar ubicaciones de otro dispositivo', () => {
    const created = createLocation(db, DEVICE, base);
    upsertDevice(db, 'otro-dispositivo');
    expect(updateLocation(db, created.id, 'otro-dispositivo', { name: 'Robada' })).toBeNull();
    expect(deleteLocation(db, created.id, 'otro-dispositivo')).toBe(false);
  });

  it('elimina la ubicación y su estado asociado', () => {
    const created = createLocation(db, DEVICE, base);
    expect(deleteLocation(db, created.id, DEVICE)).toBe(true);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM alarm_state').get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it('la lista de vigilancia excluye las alarmas desactivadas', () => {
    createLocation(db, DEVICE, { ...base, name: 'Activa' });
    createLocation(db, DEVICE, {
      ...base,
      name: 'Inactiva',
      alarm: alarmConfigSchema.parse({ enabled: false }),
    });
    const monitored = listMonitoredLocations(db);
    expect(monitored).toHaveLength(1);
    expect(monitored[0]!.name).toBe('Activa');
  });

  it('guarda el aplazamiento', () => {
    const created = createLocation(db, DEVICE, base);
    const until = Date.now() + 60_000;
    snoozeLocation(db, created.id, until);
    expect(getAlarmState(db, created.id).snoozed_until).toBe(until);
  });

  it('persiste el estado de alarma', () => {
    const created = createLocation(db, DEVICE, base);
    const state = getAlarmState(db, created.id);
    saveAlarmState(db, { ...state, active: 1, active_kind: 'nearby', last_fired_at: 1234 });
    const reloaded = getAlarmState(db, created.id);
    expect(reloaded.active).toBe(1);
    expect(reloaded.active_kind).toBe('nearby');
    expect(reloaded.last_fired_at).toBe(1234);
  });
});

describe('historial', () => {
  it('registra y lista eventos en orden descendente', () => {
    const location = createLocation(db, DEVICE, {
      name: 'Casa',
      lat: 41,
      lon: 2,
      followDevice: false,
      alarm: alarmConfigSchema.parse({}),
    });
    for (const fired of [1000, 3000, 2000]) {
      recordEvent(db, {
        location_id: location.id,
        device_id: DEVICE,
        fired_at: fired,
        kind: 'nearby',
        title: `Aviso ${fired}`,
        body: 'cuerpo',
        payload_json: '{}',
      });
    }
    const events = listEvents(db, DEVICE);
    expect(events.map((e) => e.fired_at)).toEqual([3000, 2000, 1000]);
  });

  it('purga los eventos antiguos', () => {
    const location = createLocation(db, DEVICE, {
      name: 'Casa',
      lat: 41,
      lon: 2,
      followDevice: false,
      alarm: alarmConfigSchema.parse({}),
    });
    recordEvent(db, {
      location_id: location.id,
      device_id: DEVICE,
      fired_at: 100,
      kind: 'nearby',
      title: 'viejo',
      body: '',
      payload_json: '{}',
    });
    expect(pruneEvents(db, 500)).toBe(1);
    expect(listEvents(db, DEVICE)).toHaveLength(0);
  });
});

describe('suscripciones push', () => {
  const subscription = {
    endpoint: 'https://push.example/abc',
    keys: { p256dh: 'clave-publica', auth: 'secreto' },
  };

  it('guarda y actualiza sin duplicar el endpoint', () => {
    saveSubscription(db, DEVICE, subscription);
    saveSubscription(db, DEVICE, { ...subscription, keys: { p256dh: 'nueva', auth: 'otro' } });
    const list = listSubscriptions(db, DEVICE);
    expect(list).toHaveLength(1);
    expect(list[0]!.p256dh).toBe('nueva');
  });

  it('cuenta los fallos y los reinicia al acertar', () => {
    saveSubscription(db, DEVICE, subscription);
    markSubscriptionResult(db, subscription.endpoint, false);
    markSubscriptionResult(db, subscription.endpoint, false);
    expect(listSubscriptions(db, DEVICE)[0]!.failures).toBe(2);
    markSubscriptionResult(db, subscription.endpoint, true);
    expect(listSubscriptions(db, DEVICE)[0]!.failures).toBe(0);
  });
});
