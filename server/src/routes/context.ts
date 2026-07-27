import type { FastifyReply, FastifyRequest } from 'fastify';
import { getDb, upsertDevice } from '../db.js';
import { deviceIdSchema } from '../schema.js';

/**
 * Todas las rutas privadas se identifican con la cabecera `x-device-id`, un
 * identificador opaco que genera el propio cliente. No hay cuentas de usuario:
 * el dispositivo *es* la identidad, y sus datos viven sólo en este servidor.
 */
export const DEVICE_HEADER = 'x-device-id';

export function deviceIdFrom(request: FastifyRequest, reply: FastifyReply): string | null {
  const raw = request.headers[DEVICE_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = deviceIdSchema.safeParse(value);
  if (!parsed.success) {
    reply.code(400).send({ error: 'Falta la cabecera x-device-id o no es válida' });
    return null;
  }
  const db = getDb();
  const userAgent = request.headers['user-agent'];
  upsertDevice(db, parsed.data, Array.isArray(userAgent) ? userAgent[0] : userAgent);
  return parsed.data;
}

/** Convierte errores de validación de zod en respuestas 400 legibles. */
export function badRequest(reply: FastifyReply, error: unknown): void {
  const message =
    typeof error === 'object' && error !== null && 'issues' in error
      ? JSON.stringify((error as { issues: unknown }).issues)
      : (error as Error).message;
  reply.code(400).send({ error: message });
}
