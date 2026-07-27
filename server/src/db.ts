import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import {
  alarmConfigSchema,
  settingsSchema,
  type AlarmConfig,
  type Settings,
} from './schema.js';

export interface DeviceRow {
  id: string;
  created_at: number;
  last_seen_at: number;
  user_agent: string | null;
  settings_json: string;
}

export interface LocationRow {
  id: number;
  device_id: string;
  name: string;
  lat: number;
  lon: number;
  follow_device: number;
  alarm_json: string;
  created_at: number;
  updated_at: number;
}

export interface AlarmStateRow {
  location_id: number;
  /** Situación de alarma actualmente activa (para no repetir el aviso). */
  active: number;
  active_kind: string | null;
  last_fired_at: number | null;
  last_cleared_at: number | null;
  snoozed_until: number | null;
  last_checked_at: number | null;
  last_error: string | null;
}

export interface AlarmEventRow {
  id: number;
  location_id: number;
  device_id: string;
  fired_at: number;
  kind: string;
  title: string;
  body: string;
  payload_json: string;
}

export interface Location {
  id: number;
  deviceId: string;
  name: string;
  lat: number;
  lon: number;
  followDevice: boolean;
  alarm: AlarmConfig;
  createdAt: number;
  updatedAt: number;
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    user_agent TEXT,
    settings_json TEXT NOT NULL
  );

  CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_ok_at INTEGER,
    failures INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_push_device ON push_subscriptions(device_id);

  CREATE TABLE locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    follow_device INTEGER NOT NULL DEFAULT 0,
    alarm_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_locations_device ON locations(device_id);

  CREATE TABLE alarm_state (
    location_id INTEGER PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
    active INTEGER NOT NULL DEFAULT 0,
    active_kind TEXT,
    last_fired_at INTEGER,
    last_cleared_at INTEGER,
    snoozed_until INTEGER,
    last_checked_at INTEGER,
    last_error TEXT
  );

  CREATE TABLE alarm_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    fired_at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );
  CREATE INDEX idx_events_device ON alarm_events(device_id, fired_at DESC);
  CREATE INDEX idx_events_location ON alarm_events(location_id, fired_at DESC);
  `,
];

export type Db = Database.Database;

let instance: Db | null = null;

function migrate(db: Db): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec(`BEGIN; ${MIGRATIONS[v]!} COMMIT;`);
    db.pragma(`user_version = ${v + 1}`);
  }
}

export function openDb(path: string = config.dbPath): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  migrate(db);
  return db;
}

export function getDb(): Db {
  if (!instance) instance = openDb();
  return instance;
}

/** Sustituye la instancia global (usado en pruebas). */
export function setDb(db: Db): void {
  instance = db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

// ---------------------------------------------------------------------------
// Dispositivos

export function upsertDevice(db: Db, id: string, userAgent?: string): DeviceRow {
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
  if (existing) {
    db.prepare('UPDATE devices SET last_seen_at = ?, user_agent = COALESCE(?, user_agent) WHERE id = ?').run(
      now,
      userAgent ?? null,
      id,
    );
    return { ...existing, last_seen_at: now };
  }
  const settings = JSON.stringify(settingsSchema.parse({}));
  db.prepare(
    'INSERT INTO devices (id, created_at, last_seen_at, user_agent, settings_json) VALUES (?, ?, ?, ?, ?)',
  ).run(id, now, now, userAgent ?? null, settings);
  return { id, created_at: now, last_seen_at: now, user_agent: userAgent ?? null, settings_json: settings };
}

export function getSettings(db: Db, deviceId: string): Settings {
  const row = db.prepare('SELECT settings_json FROM devices WHERE id = ?').get(deviceId) as
    | { settings_json: string }
    | undefined;
  if (!row) return settingsSchema.parse({});
  try {
    return settingsSchema.parse(JSON.parse(row.settings_json));
  } catch {
    // Configuración corrupta o de una versión anterior: se vuelve a los valores por defecto.
    return settingsSchema.parse({});
  }
}

export function saveSettings(db: Db, deviceId: string, settings: Settings): Settings {
  const parsed = settingsSchema.parse(settings);
  db.prepare('UPDATE devices SET settings_json = ?, last_seen_at = ? WHERE id = ?').run(
    JSON.stringify(parsed),
    Date.now(),
    deviceId,
  );
  return parsed;
}

// ---------------------------------------------------------------------------
// Ubicaciones

function toLocation(row: LocationRow): Location {
  let alarm: AlarmConfig;
  try {
    alarm = alarmConfigSchema.parse(JSON.parse(row.alarm_json));
  } catch {
    alarm = alarmConfigSchema.parse({});
  }
  return {
    id: row.id,
    deviceId: row.device_id,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    followDevice: row.follow_device === 1,
    alarm,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listLocations(db: Db, deviceId: string): Location[] {
  const rows = db
    .prepare('SELECT * FROM locations WHERE device_id = ? ORDER BY follow_device DESC, id ASC')
    .all(deviceId) as LocationRow[];
  return rows.map(toLocation);
}

export function getLocation(db: Db, id: number, deviceId?: string): Location | null {
  const row = deviceId
    ? (db.prepare('SELECT * FROM locations WHERE id = ? AND device_id = ?').get(id, deviceId) as
        | LocationRow
        | undefined)
    : (db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as LocationRow | undefined);
  return row ? toLocation(row) : null;
}

export function createLocation(
  db: Db,
  deviceId: string,
  input: { name: string; lat: number; lon: number; followDevice: boolean; alarm: AlarmConfig },
): Location {
  const now = Date.now();
  // Sólo puede haber una ubicación que siga al dispositivo.
  if (input.followDevice) {
    db.prepare('UPDATE locations SET follow_device = 0 WHERE device_id = ?').run(deviceId);
  }
  const info = db
    .prepare(
      `INSERT INTO locations (device_id, name, lat, lon, follow_device, alarm_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      deviceId,
      input.name,
      input.lat,
      input.lon,
      input.followDevice ? 1 : 0,
      JSON.stringify(alarmConfigSchema.parse(input.alarm)),
      now,
      now,
    );
  const id = Number(info.lastInsertRowid);
  db.prepare('INSERT OR IGNORE INTO alarm_state (location_id) VALUES (?)').run(id);
  return getLocation(db, id)!;
}

export function updateLocation(
  db: Db,
  id: number,
  deviceId: string,
  patch: Partial<{ name: string; lat: number; lon: number; followDevice: boolean; alarm: AlarmConfig }>,
): Location | null {
  const current = getLocation(db, id, deviceId);
  if (!current) return null;
  if (patch.followDevice) {
    db.prepare('UPDATE locations SET follow_device = 0 WHERE device_id = ? AND id != ?').run(deviceId, id);
  }
  const merged = {
    name: patch.name ?? current.name,
    lat: patch.lat ?? current.lat,
    lon: patch.lon ?? current.lon,
    followDevice: patch.followDevice ?? current.followDevice,
    alarm: patch.alarm ? alarmConfigSchema.parse({ ...current.alarm, ...patch.alarm }) : current.alarm,
  };
  db.prepare(
    `UPDATE locations SET name = ?, lat = ?, lon = ?, follow_device = ?, alarm_json = ?, updated_at = ?
     WHERE id = ? AND device_id = ?`,
  ).run(
    merged.name,
    merged.lat,
    merged.lon,
    merged.followDevice ? 1 : 0,
    JSON.stringify(merged.alarm),
    Date.now(),
    id,
    deviceId,
  );
  return getLocation(db, id, deviceId);
}

export function deleteLocation(db: Db, id: number, deviceId: string): boolean {
  const info = db.prepare('DELETE FROM locations WHERE id = ? AND device_id = ?').run(id, deviceId);
  return info.changes > 0;
}

/** Ubicaciones con alarma activada de todos los dispositivos (para el vigilante). */
export function listMonitoredLocations(db: Db): Location[] {
  const rows = db.prepare('SELECT * FROM locations').all() as LocationRow[];
  return rows.map(toLocation).filter((l) => l.alarm.enabled);
}

// ---------------------------------------------------------------------------
// Estado de alarma

export function getAlarmState(db: Db, locationId: number): AlarmStateRow {
  const row = db.prepare('SELECT * FROM alarm_state WHERE location_id = ?').get(locationId) as
    | AlarmStateRow
    | undefined;
  if (row) return row;
  db.prepare('INSERT OR IGNORE INTO alarm_state (location_id) VALUES (?)').run(locationId);
  return {
    location_id: locationId,
    active: 0,
    active_kind: null,
    last_fired_at: null,
    last_cleared_at: null,
    snoozed_until: null,
    last_checked_at: null,
    last_error: null,
  };
}

export function saveAlarmState(db: Db, state: AlarmStateRow): void {
  db.prepare(
    `INSERT INTO alarm_state (location_id, active, active_kind, last_fired_at, last_cleared_at,
                              snoozed_until, last_checked_at, last_error)
     VALUES (@location_id, @active, @active_kind, @last_fired_at, @last_cleared_at,
             @snoozed_until, @last_checked_at, @last_error)
     ON CONFLICT(location_id) DO UPDATE SET
       active = excluded.active,
       active_kind = excluded.active_kind,
       last_fired_at = excluded.last_fired_at,
       last_cleared_at = excluded.last_cleared_at,
       snoozed_until = excluded.snoozed_until,
       last_checked_at = excluded.last_checked_at,
       last_error = excluded.last_error`,
  ).run(state);
}

export function snoozeLocation(db: Db, locationId: number, until: number): void {
  const state = getAlarmState(db, locationId);
  saveAlarmState(db, { ...state, snoozed_until: until });
}

// ---------------------------------------------------------------------------
// Historial

export function recordEvent(
  db: Db,
  event: Omit<AlarmEventRow, 'id'>,
): number {
  const info = db
    .prepare(
      `INSERT INTO alarm_events (location_id, device_id, fired_at, kind, title, body, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.location_id,
      event.device_id,
      event.fired_at,
      event.kind,
      event.title,
      event.body,
      event.payload_json,
    );
  return Number(info.lastInsertRowid);
}

export function listEvents(db: Db, deviceId: string, limit = 50): AlarmEventRow[] {
  return db
    .prepare('SELECT * FROM alarm_events WHERE device_id = ? ORDER BY fired_at DESC LIMIT ?')
    .all(deviceId, Math.min(limit, 200)) as AlarmEventRow[];
}

/** Borra eventos anteriores a la fecha indicada. Devuelve cuántos se eliminaron. */
export function pruneEvents(db: Db, olderThan: number): number {
  return db.prepare('DELETE FROM alarm_events WHERE fired_at < ?').run(olderThan).changes;
}

// ---------------------------------------------------------------------------
// Suscripciones push

export interface SubscriptionRow {
  id: number;
  device_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: number;
  last_ok_at: number | null;
  failures: number;
}

export function saveSubscription(
  db: Db,
  deviceId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
): void {
  db.prepare(
    `INSERT INTO push_subscriptions (device_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       device_id = excluded.device_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       failures = 0`,
  ).run(deviceId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());
}

export function listSubscriptions(db: Db, deviceId: string): SubscriptionRow[] {
  return db
    .prepare('SELECT * FROM push_subscriptions WHERE device_id = ?')
    .all(deviceId) as SubscriptionRow[];
}

/** Dispositivo al que pertenece una suscripción, o `null` si no se conoce. */
export function deviceForSubscription(db: Db, endpoint: string): string | null {
  const row = db
    .prepare('SELECT device_id FROM push_subscriptions WHERE endpoint = ?')
    .get(endpoint) as { device_id: string } | undefined;
  return row?.device_id ?? null;
}

export function deleteSubscription(db: Db, endpoint: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function markSubscriptionResult(db: Db, endpoint: string, ok: boolean): void {
  if (ok) {
    db.prepare('UPDATE push_subscriptions SET last_ok_at = ?, failures = 0 WHERE endpoint = ?').run(
      Date.now(),
      endpoint,
    );
  } else {
    db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?').run(endpoint);
  }
}
