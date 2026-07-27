import webpush, { WebPushError } from 'web-push';
import { config } from './config.js';
import { deleteSubscription, listSubscriptions, markSubscriptionResult, type Db } from './db.js';

let configured = false;

export function pushAvailable(): boolean {
  return Boolean(config.push.publicKey && config.push.privateKey);
}

function ensureConfigured(): boolean {
  if (!pushAvailable()) return false;
  if (!configured) {
    webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
    configured = true;
  }
  return true;
}

export function publicKey(): string {
  return config.push.publicKey;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Agrupa notificaciones: una nueva del mismo tag reemplaza a la anterior. */
  tag?: string;
  /** Requiere interacción del usuario para descartarse. */
  requireInteraction?: boolean;
  /** Patrón de vibración en milisegundos. */
  vibrate?: number[];
  data?: Record<string, unknown>;
}

export interface PushResult {
  sent: number;
  failed: number;
  removed: number;
}

/**
 * Envía una notificación a todas las suscripciones de un dispositivo.
 * Las suscripciones caducadas (404/410) se eliminan automáticamente.
 */
export async function sendToDevice(db: Db, deviceId: string, message: PushMessage): Promise<PushResult> {
  if (!ensureConfigured()) return { sent: 0, failed: 0, removed: 0 };
  const subs = listSubscriptions(db, deviceId);
  const payload = JSON.stringify(message);
  let sent = 0;
  let failed = 0;
  let removed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 900, urgency: 'high' },
        );
        markSubscriptionResult(db, sub.endpoint, true);
        sent++;
      } catch (err) {
        const status = err instanceof WebPushError ? err.statusCode : 0;
        if (status === 404 || status === 410) {
          deleteSubscription(db, sub.endpoint);
          removed++;
        } else {
          markSubscriptionResult(db, sub.endpoint, false);
          failed++;
        }
      }
    }),
  );

  return { sent, failed, removed };
}
