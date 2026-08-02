import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { startWatcher, stopWatcher } from './alarm/watcher.js';
import { config } from './config.js';
import { closeDb, getDb, pruneEvents } from './db.js';
import { pushAvailable } from './push.js';
import { deviceRoutes } from './routes/device.js';
import { forecastRoutes } from './routes/forecast.js';
import { locationRoutes } from './routes/locations.js';
import { mapRoutes } from './routes/map.js';
import { metaRoutes } from './routes/meta.js';
import { radarRoutes } from './routes/radar.js';

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV === 'production'
          ? undefined
          : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    },
    trustProxy: config.security.trustProxy,
  });

  await app.register(cors, {
    // La PWA usa el mismo origen. Las integraciones externas deben declararse
    // expresamente, en vez de habilitar cualquier web de Internet.
    origin: config.security.corsOrigins.length > 0 ? config.security.corsOrigins : false,
    exposedHeaders: ['x-device-id'],
  });
  await app.register(rateLimit, {
    global: true,
    max: config.security.rateLimitPerMinute,
    timeWindow: '1 minute',
  });

  const db = getDb();

  await app.register(metaRoutes);
  await app.register(deviceRoutes);
  await app.register(radarRoutes);
  await app.register(mapRoutes);
  await app.register(forecastRoutes);
  await app.register(locationRoutes);

  // La PWA compilada se sirve desde el mismo origen: así el service worker
  // controla toda la aplicación y las notificaciones funcionan sin CORS.
  if (config.serveWeb && existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Ruta no encontrada' });
      }
      return reply.sendFile('index.html');
    });
  }

  if (!pushAvailable()) {
    app.log.warn(
      'Sin claves VAPID: los avisos push están desactivados. Genera unas con `npm run keys`.',
    );
  }

  const stopWatch = config.alarm.enabled
    ? startWatcher(db, (msg) => app.log.info(msg))
    : () => undefined;
  if (!config.alarm.enabled) app.log.warn('Vigilancia en segundo plano desactivada por configuración.');

  // Limpieza diaria del historial de avisos (se conservan 30 días).
  const cleanup = setInterval(
    () => {
      const removed = pruneEvents(db, Date.now() - 30 * 24 * 3600 * 1000);
      if (removed > 0) app.log.info(`historial: ${removed} avisos antiguos eliminados`);
    },
    24 * 3600 * 1000,
  );
  cleanup.unref();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} recibido, cerrando…`);
    stopWatch();
    stopWatcher();
    clearInterval(cleanup);
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error('Fallo al arrancar:', err);
  process.exit(1);
});
