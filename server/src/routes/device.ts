import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  deleteSubscription,
  getDb,
  getSettings,
  listSubscriptions,
  saveSettings,
  saveSubscription,
} from '../db.js';
import { publicKey, pushAvailable } from '../push.js';
import { pushSubscriptionSchema, settingsSchema } from '../schema.js';
import { badRequest, deviceIdFrom } from './context.js';

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  /** Alta o latido del dispositivo. Devuelve sus preferencias actuales. */
  app.post('/api/device', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    return { deviceId, settings: getSettings(getDb(), deviceId) };
  });

  app.get('/api/settings', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    return getSettings(getDb(), deviceId);
  });

  app.put('/api/settings', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    const db = getDb();
    // Se fusiona con lo guardado para admitir actualizaciones parciales.
    const merged = { ...getSettings(db, deviceId), ...(request.body as Record<string, unknown>) };
    const parsed = settingsSchema.safeParse(merged);
    if (!parsed.success) return badRequest(reply, parsed.error);
    return saveSettings(db, deviceId, parsed.data);
  });

  app.get('/api/push/key', async () => ({ available: pushAvailable(), publicKey: publicKey() }));

  app.post('/api/push/subscribe', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    const body = pushSubscriptionSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);
    saveSubscription(getDb(), deviceId, body.data);
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    const body = z.object({ endpoint: z.string().url() }).safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);
    deleteSubscription(getDb(), body.data.endpoint);
    return { ok: true };
  });

  app.get('/api/push/subscriptions', async (request, reply) => {
    const deviceId = deviceIdFrom(request, reply);
    if (!deviceId) return;
    return listSubscriptions(getDb(), deviceId).map((s) => ({
      endpoint: s.endpoint,
      createdAt: s.created_at,
      lastOkAt: s.last_ok_at,
      failures: s.failures,
    }));
  });
}
