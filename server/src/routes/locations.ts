import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { checkLocation } from '../alarm/watcher.js';
import { thresholdFor } from '../alarm/engine.js';
import {
  createLocation,
  deleteLocation,
  getAlarmState,
  getDb,
  getLocation,
  getSettings,
  listEvents,
  listLocations,
  saveAlarmState,
  snoozeLocation,
  updateLocation,
} from '../db.js';
import { strings } from '../i18n.js';
import { analyzeLocation } from '../radar/analysis.js';
import { sendToDevice } from '../push.js';
import { locationInputSchema, locationUpdateSchema, positionSchema } from '../schema.js';
import { badRequest, deviceIdFrom } from './context.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

export async function locationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/locations', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    const db = getDb();
    return listLocations(db, deviceId).map((location) => ({
      ...location,
      state: getAlarmState(db, location.id),
    }));
  });

  app.post('/api/locations', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    const body = locationInputSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);
    const db = getDb();
    const location = createLocation(db, deviceId, body.data);
    return reply.code(201).send({ ...location, state: getAlarmState(db, location.id) });
  });

  app.patch('/api/locations/:id', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    const params = idParam.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const body = locationUpdateSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);

    const db = getDb();
    const updated = updateLocation(db, params.data.id, deviceId, body.data as never);
    if (!updated) return reply.code(404).send({ error: 'Ubicación no encontrada' });
    return { ...updated, state: getAlarmState(db, updated.id) };
  });

  app.delete('/api/locations/:id', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    const params = idParam.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const removed = deleteLocation(getDb(), params.data.id, deviceId);
    if (!removed) return reply.code(404).send({ error: 'Ubicación no encontrada' });
    return reply.code(204).send();
  });

  /** Refresca las coordenadas de la ubicación que sigue al dispositivo. */
  app.post('/api/locations/:id/position', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    const params = idParam.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const body = positionSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);

    const db = getDb();
    const updated = updateLocation(db, params.data.id, deviceId, {
      lat: body.data.lat,
      lon: body.data.lon,
    });
    if (!updated) return reply.code(404).send({ error: 'Ubicación no encontrada' });
    return updated;
  });

  /** Pospone los avisos de una ubicación. */
  app.post('/api/locations/:id/snooze', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    const params = idParam.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const body = z
      .object({ minutes: z.coerce.number().int().min(0).max(720).optional() })
      .safeParse(request.body ?? {});
    if (!body.success) return badRequest(reply, body.error);

    const db = getDb();
    const location = getLocation(db, params.data.id, deviceId);
    if (!location) return reply.code(404).send({ error: 'Ubicación no encontrada' });

    const minutes = body.data.minutes ?? location.alarm.snoozeMinutes;
    const until = minutes === 0 ? 0 : Date.now() + minutes * 60_000;
    snoozeLocation(db, location.id, until);
    return { locationId: location.id, snoozedUntil: until, minutes };
  });

  /** Cancela el estado de alarma en curso para que pueda volver a avisar. */
  app.post('/api/locations/:id/dismiss', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    const params = idParam.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const db = getDb();
    const location = getLocation(db, params.data.id, deviceId);
    if (!location) return reply.code(404).send({ error: 'Ubicación no encontrada' });
    const state = getAlarmState(db, location.id);
    saveAlarmState(db, { ...state, active: 0, active_kind: null, last_cleared_at: Date.now() });
    return { ok: true };
  });

  /** Fuerza una comprobación inmediata de la ubicación. */
  app.post('/api/locations/:id/check', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    const params = idParam.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const db = getDb();
    const location = getLocation(db, params.data.id, deviceId);
    if (!location) return reply.code(404).send({ error: 'Ubicación no encontrada' });
    const result = await checkLocation(db, location);
    return { result, state: getAlarmState(db, location.id) };
  });

  /** Envía una notificación de prueba a este dispositivo. */
  app.post('/api/locations/:id/test', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    const params = idParam.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const db = getDb();
    const location = getLocation(db, params.data.id, deviceId);
    if (!location) return reply.code(404).send({ error: 'Ubicación no encontrada' });

    const settings = getSettings(db, deviceId);
    const t = strings(settings.language);
    const result = await sendToDevice(db, deviceId, {
      title: t.test(location.name),
      body: t.testBody,
      tag: `plou-test-${location.id}`,
      vibrate: location.alarm.sound.vibrate ? [200, 100, 200] : undefined,
      data: {
        kind: 'test',
        deviceId,
        locationId: location.id,
        locationName: location.name,
        lat: location.lat,
        lon: location.lon,
        sound: location.alarm.sound,
      },
    });
    return result;
  });

  /** Análisis de radar con los parámetros configurados en la ubicación. */
  app.get('/api/locations/:id/analysis', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    const params = idParam.safeParse(request.params);
    if (!params.success) return badRequest(reply, params.error);
    const db = getDb();
    const location = getLocation(db, params.data.id, deviceId);
    if (!location) return reply.code(404).send({ error: 'Ubicación no encontrada' });

    try {
      const analysis = await analyzeLocation(
        { lat: location.lat, lon: location.lon },
        {
          radiusKm: location.alarm.radiusKm,
          thresholdDbz: thresholdFor(location.alarm),
          lookaheadMinutes: Math.max(60, location.alarm.leadMinutes + 30),
          rain: location.alarm.detectRain,
          snow: location.alarm.detectSnow,
        },
      );
      return { location, analysis, state: getAlarmState(db, location.id) };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.get('/api/events', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
      .safeParse(request.query);
    if (!query.success) return badRequest(reply, query.error);
    return listEvents(getDb(), deviceId, query.data.limit).map((e) => ({
      id: e.id,
      locationId: e.location_id,
      firedAt: e.fired_at,
      kind: e.kind,
      title: e.title,
      body: e.body,
      payload: JSON.parse(e.payload_json) as unknown,
    }));
  });
}
