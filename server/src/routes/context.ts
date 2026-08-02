import type { FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { countDevices, deviceExists, getDb, upsertDevice } from '../db.js';
import { deviceIdSchema } from '../schema.js';

/**
 * Todas las rutas privadas se identifican con la cabecera `x-device-id`, un
 * identificador opaco que genera el propio cliente. No hay cuentas de usuario:
 * el dispositivo *es* la identidad, y sus datos viven sólo en este servidor.
 */
export const DEVICE_HEADER = 'x-device-id';
export const REGISTRATION_HEADER = 'x-plou-registration-token';

export function validRegistrationToken(expected: string, provided: unknown): boolean {
  if (!expected) return true;
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function deviceIdFrom(request: FastifyRequest, reply: FastifyReply): string | null {
  const raw = request.headers[DEVICE_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = deviceIdSchema.safeParse(value);
  if (!parsed.success) {
    reply.code(400).send({ error: 'Falta la cabecera x-device-id o no es válida' });
    return null;
  }
  const db = getDb();
  if (!deviceExists(db, parsed.data)) {
    const registration = request.headers[REGISTRATION_HEADER];
    const token = Array.isArray(registration) ? registration[0] : registration;
    if (!validRegistrationToken(config.security.registrationToken, token)) {
      reply.code(403).send({ error: 'Se necesita una invitación válida para registrar el dispositivo' });
      return null;
    }
    if (countDevices(db) >= config.security.maxDevices) {
      reply.code(503).send({ error: 'La instancia ha alcanzado el límite de dispositivos' });
      return null;
    }
  }
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
