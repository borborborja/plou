import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  cloudFrames,
  layerCapabilities,
  lightningActivity,
  lightningFrame,
  mapTile,
  satelliteFrames,
  type MapLayerId,
  type SatelliteVariant,
} from '../map/layers.js';
import { badRequest } from './context.js';

const frameQuery = z.discriminatedUnion('layer', [
  z.object({
    layer: z.literal('satellite'),
    variant: z.enum(['geocolour', 'visible', 'infra']).default('geocolour'),
  }),
  z.object({ layer: z.literal('clouds'), variant: z.literal('total').default('total') }),
  z.object({ layer: z.literal('lightning'), variant: z.literal('aemet-12h').default('aemet-12h') }),
]);

const tileParams = z.object({
  layer: z.enum(['satellite', 'clouds', 'lightning']),
  variant: z.string().min(1).max(32),
  frame: z.string().regex(/^\d{10,16}$/),
  z: z.coerce.number().int().min(0).max(12),
  x: z.coerce.number().int().min(0),
  y: z.coerce.number().int().min(0),
});

export async function mapRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/map/layers', async () => ({ layers: layerCapabilities() }));

  app.get('/api/map/frames', async (request, reply) => {
    const parsed = frameQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const query = parsed.data;
    try {
      const frames =
        query.layer === 'satellite'
          ? satelliteFrames(query.variant as SatelliteVariant)
          : query.layer === 'clouds'
            ? cloudFrames()
            : [await lightningFrame()];
      return { layer: query.layer, variant: query.variant, generated: Date.now(), frames };
    } catch (error) {
      return reply.code(502).send({ error: (error as Error).message });
    }
  });

  app.get('/api/map/lightning/activity', async (request, reply) => {
    const parsed = z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lon: z.coerce.number().min(-180).max(180),
        radiusKm: z.coerce.number().min(1).max(100).default(20),
      })
      .safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    try {
      return await lightningActivity(parsed.data.lat, parsed.data.lon, parsed.data.radiusKm);
    } catch (error) {
      return reply.code(502).send({ error: (error as Error).message });
    }
  });

  app.get('/api/map/tiles/:layer/:variant/:frame/:z/:x/:y.png', async (request, reply) => {
    const parsed = tileParams.safeParse(request.params);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { layer, variant, frame, z, x, y } = parsed.data;
    const limit = 2 ** z;
    if (x >= limit || y >= limit) return reply.code(404).send({ error: 'Tesela fuera del mapa' });
    try {
      const tile = await mapTile(layer as MapLayerId, variant, frame, z, x, y);
      return reply
        .header('content-type', tile.contentType)
        .header('cache-control', layer === 'lightning' ? 'public, max-age=300' : 'public, max-age=3600')
        .send(tile.body);
    } catch (error) {
      return reply.code(502).send({ error: (error as Error).message });
    }
  });
}
