import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { analyzeLocation } from '../radar/analysis.js';
import {
  COLOR_SCHEMES,
  INTENSITY_LEVELS,
  isSnowDistinguishable,
  legendFor,
  schemeById,
} from '../radar/colorTable.js';
import {
  coverageTileUrlTemplate,
  getRadarIndex,
  tileUrlTemplate,
  type RadarFrame,
} from '../radar/frames.js';
import { badRequest } from './context.js';

const analysisQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(1).max(100).default(20),
  intensity: z.enum(['drizzle', 'light', 'moderate', 'heavy', 'violent']).default('light'),
  lookaheadMinutes: z.coerce.number().min(15).max(180).default(90),
  rain: z.coerce.boolean().default(true),
  snow: z.coerce.boolean().default(true),
  coverage: z.coerce.boolean().default(true),
});

export async function radarRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Fotogramas disponibles con sus URL de tesela ya construidas, para que el
   * mapa del cliente no tenga que conocer el formato del proveedor.
   */
  app.get('/api/radar/frames', async (request, reply) => {
    const query = z
      .object({
        color: z.coerce.number().int().min(0).max(8).default(2),
        smooth: z.coerce.boolean().default(true),
        snow: z.coerce.boolean().default(true),
        size: z.coerce.number().int().default(config.radar.tileSize),
      })
      .safeParse(request.query);
    if (!query.success) return badRequest(reply, query.error);

    const { color, smooth, snow } = query.data;
    const size = query.data.size === 256 ? 256 : 512;

    try {
      const index = await getRadarIndex();
      const build = (frame: RadarFrame) => ({
        time: frame.time * 1000,
        kind: frame.kind,
        template: tileUrlTemplate(index, frame, { size, color, smooth, snow }),
      });

      return {
        generated: index.generated * 1000,
        host: index.host,
        /** Zoom máximo con datos propios; por encima se reescala la tesela. */
        maxNativeZoom: config.radar.analysisZoom,
        tileSize: size,
        past: index.past.map(build),
        nowcast: index.nowcast.map(build),
        coverageTemplate: coverageTileUrlTemplate(index, size),
        /** La capa de cobertura sólo se publica hasta este zoom. */
        coverageMaxNativeZoom: 5,
      };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  /**
   * Leyenda de la escala de color activa. Los colores salen de la propia rampa
   * de la paleta, así que la leyenda no puede desajustarse de las teselas.
   */
  app.get('/api/radar/legend', async (request, reply) => {
    const query = z
      .object({ color: z.coerce.number().int().min(0).max(8).default(2) })
      .safeParse(request.query);
    if (!query.success) return badRequest(reply, query.error);

    const scheme = schemeById(query.data.color) ?? COLOR_SCHEMES[2];
    if (!scheme) return reply.code(404).send({ error: 'esquema desconocido' });

    return {
      scheme: { id: scheme.id, key: scheme.key, label: scheme.label },
      snowDistinguishable: isSnowDistinguishable(scheme.key),
      stops: legendFor(scheme.key),
    };
  });

  /** Análisis de radar de un punto arbitrario (usado por la pantalla principal). */
  app.get('/api/radar/analysis', async (request, reply) => {
    const query = analysisQuery.safeParse(request.query);
    if (!query.success) return badRequest(reply, query.error);
    const q = query.data;
    const level = INTENSITY_LEVELS.find((l) => l.key === q.intensity);

    try {
      const analysis = await analyzeLocation(
        { lat: q.lat, lon: q.lon },
        {
          radiusKm: q.radiusKm,
          thresholdDbz: level?.dbz ?? 20,
          lookaheadMinutes: q.lookaheadMinutes,
          rain: q.rain,
          snow: q.snow,
          checkCoverage: q.coverage,
        },
      );
      return analysis;
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}
