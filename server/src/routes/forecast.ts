import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getForecast } from '../forecast/index.js';
import { describePoint, searchPlaces } from '../forecast/geocoding.js';
import { badRequest } from './context.js';

const forecastQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  provider: z.enum(['openmeteo', 'foreca']).default('openmeteo'),
  days: z.coerce.number().int().min(1).max(16).default(7),
  hours: z.coerce.number().int().min(6).max(168).default(48),
  language: z.enum(['es', 'ca', 'en']).default('es'),
});

export async function forecastRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/forecast', async (request, reply) => {
    const query = forecastQuery.safeParse(request.query);
    if (!query.success) return badRequest(reply, query.error);
    const q = query.data;
    try {
      return await getForecast(q.provider, {
        lat: q.lat,
        lon: q.lon,
        days: q.days,
        hours: q.hours,
        language: q.language,
      });
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.get('/api/geocode', async (request, reply) => {
    const query = z
      .object({
        q: z.string().trim().min(2).max(80),
        language: z.enum(['es', 'ca', 'en']).default('es'),
      })
      .safeParse(request.query);
    if (!query.success) return badRequest(reply, query.error);
    try {
      return { results: await searchPlaces(query.data.q, query.data.language) };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.get('/api/geocode/reverse', async (request, reply) => {
    const query = z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lon: z.coerce.number().min(-180).max(180),
        language: z.enum(['es', 'ca', 'en']).default('es'),
      })
      .safeParse(request.query);
    if (!query.success) return badRequest(reply, query.error);
    const q = query.data;
    return await describePoint(q.lat, q.lon, q.language);
  });
}
