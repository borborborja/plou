import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { closeDb, openDb, setDb, type Db } from '../src/db.js';
import { locationRoutes } from '../src/routes/locations.js';
import { validRegistrationToken } from '../src/routes/context.js';

const DEVICE = 'dispositivo-rutas-1234';

describe('rutas de ubicaciones', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDb(':memory:');
    setDb(db);
    app = Fastify();
    await app.register(locationRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  async function create(name: string, followDevice = false) {
    return app.inject({
      method: 'POST',
      url: '/api/locations',
      headers: { 'x-device-id': DEVICE },
      payload: { name, lat: 41.39, lon: 2.17, followDevice },
    });
  }

  it('sólo acepta actualizaciones de posición para la ubicación que sigue al dispositivo', async () => {
    const fixed = await create('Casa');
    const fixedId = fixed.json<{ id: number }>().id;
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/locations/${fixedId}/position`,
      headers: { 'x-device-id': DEVICE },
      payload: { lat: 40, lon: -3 },
    });
    expect(rejected.statusCode).toBe(409);

    const following = await create('Mi posición', true);
    const followingId = following.json<{ id: number }>().id;
    const updated = await app.inject({
      method: 'POST',
      url: `/api/locations/${followingId}/position`,
      headers: { 'x-device-id': DEVICE },
      payload: { lat: 40.42, lon: -3.7, accuracyM: 25 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: followingId, lat: 40.42, lon: -3.7 });
    expect(updated.json<{ positionUpdatedAt: number | null }>().positionUpdatedAt).not.toBeNull();

    db.prepare('UPDATE locations SET position_updated_at = ? WHERE id = ?').run(1, followingId);
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/locations/${followingId}`,
      headers: { 'x-device-id': DEVICE },
      payload: { name: 'Mi posición editada' },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json<{ positionUpdatedAt: number | null }>().positionUpdatedAt).toBe(1);
  });

  it('aplica el límite de ubicaciones por dispositivo', async () => {
    for (let i = 0; i < config.security.maxLocationsPerDevice; i++) {
      expect((await create(`Punto ${i}`)).statusCode).toBe(201);
    }
    const extra = await create('Una de más');
    expect(extra.statusCode).toBe(429);
  });
});

describe('invitación de registro', () => {
  it('compara el secreto sin aceptar ausencias ni prefijos', () => {
    expect(validRegistrationToken('', undefined)).toBe(true);
    expect(validRegistrationToken('secreto-largo', undefined)).toBe(false);
    expect(validRegistrationToken('secreto-largo', 'secreto')).toBe(false);
    expect(validRegistrationToken('secreto-largo', 'secreto-largo')).toBe(true);
  });
});
