import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, listSubscriptions, openDb, setDb, type Db } from '../src/db.js';
import { deviceRoutes } from '../src/routes/device.js';

const DEVICE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTRO = 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function suscripcion(endpoint: string) {
  return { endpoint, keys: { p256dh: 'clave-publica', auth: 'secreto' } };
}

describe('rutas de push', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDb(':memory:');
    setDb(db);
    app = Fastify();
    await app.register(deviceRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  async function suscribir(deviceId: string, endpoint: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: { 'x-device-id': deviceId },
      payload: suscripcion(endpoint),
    });
    expect(res.statusCode).toBe(200);
  }

  it('mueve la suscripción al rotarla el navegador, sin perder el dispositivo', async () => {
    await suscribir(DEVICE, 'https://push.example/vieja');

    const res = await app.inject({
      method: 'POST',
      url: '/api/push/resubscribe',
      payload: {
        oldEndpoint: 'https://push.example/vieja',
        subscription: suscripcion('https://push.example/nueva'),
      },
    });

    expect(res.statusCode).toBe(200);
    // El aviso debe seguir llegando al mismo dispositivo, por el nuevo canal.
    const subs = listSubscriptions(db, DEVICE);
    expect(subs.map((s) => s.endpoint)).toEqual(['https://push.example/nueva']);
  });

  it('no atiende una suscripción anterior que el servidor no conoce', async () => {
    // Sin esto, cualquiera podría colar una suscripción a ciegas.
    const res = await app.inject({
      method: 'POST',
      url: '/api/push/resubscribe',
      payload: {
        oldEndpoint: 'https://push.example/inventada',
        subscription: suscripcion('https://push.example/nueva'),
      },
    });

    expect(res.statusCode).toBe(404);
    expect(listSubscriptions(db, DEVICE)).toHaveLength(0);
  });

  it('no toca las suscripciones de otros dispositivos', async () => {
    await suscribir(DEVICE, 'https://push.example/uno');
    await suscribir(OTRO, 'https://push.example/dos');

    await app.inject({
      method: 'POST',
      url: '/api/push/resubscribe',
      payload: {
        oldEndpoint: 'https://push.example/uno',
        subscription: suscripcion('https://push.example/uno-bis'),
      },
    });

    expect(listSubscriptions(db, DEVICE).map((s) => s.endpoint)).toEqual([
      'https://push.example/uno-bis',
    ]);
    expect(listSubscriptions(db, OTRO).map((s) => s.endpoint)).toEqual(['https://push.example/dos']);
  });

  it('rechaza una petición mal formada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/push/resubscribe',
      payload: { oldEndpoint: 'no-es-una-url', subscription: suscripcion('https://push.example/x') },
    });
    expect(res.statusCode).toBe(400);
  });

  it('el listado deja ver al cliente si el servidor sigue conociendo su canal', async () => {
    // Es lo que usa la PWA para detectar que los avisos se han apagado solos.
    await suscribir(DEVICE, 'https://push.example/uno');
    const res = await app.inject({
      method: 'GET',
      url: '/api/push/subscriptions',
      headers: { 'x-device-id': DEVICE },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((s: { endpoint: string }) => s.endpoint)).toEqual([
      'https://push.example/uno',
    ]);
  });
});
