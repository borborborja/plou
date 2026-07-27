import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { lastTickReport } from '../alarm/watcher.js';
import { listProviders } from '../forecast/index.js';
import { weatherCodeTable } from '../forecast/weatherCodes.js';
import { COLOR_SCHEMES, INTENSITY_LEVELS } from '../radar/colorTable.js';
import { getRadarIndex } from '../radar/frames.js';
import { tileCacheStats } from '../radar/tiles.js';
import { publicKey, pushAvailable } from '../push.js';
import { alarmModes, alarmTones, defaultAlarmConfig, defaultSettings } from '../schema.js';

export async function metaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({ ok: true, time: Date.now() }));

  /**
   * Todo lo que el cliente necesita para pintar los ajustes sin llevar sus
   * propias copias de las tablas: esquemas de color, niveles de intensidad,
   * proveedores disponibles y valores por defecto.
   */
  app.get('/api/meta', async () => {
    const providers = listProviders();
    let radar: { frames: number; nowcastFrames: number; latest: number | null } = {
      frames: 0,
      nowcastFrames: 0,
      latest: null,
    };
    try {
      const index = await getRadarIndex();
      radar = {
        frames: index.past.length,
        nowcastFrames: index.nowcast.length,
        latest: (index.past.at(-1)?.time ?? 0) * 1000 || null,
      };
    } catch {
      /* el radar puede estar temporalmente inaccesible */
    }

    return {
      colorSchemes: COLOR_SCHEMES,
      intensityLevels: INTENSITY_LEVELS,
      alarmModes,
      alarmTones,
      providers,
      weatherCodes: weatherCodeTable(),
      push: { available: pushAvailable(), publicKey: publicKey() },
      defaults: { alarm: defaultAlarmConfig(), settings: defaultSettings() },
      radar,
      watcher: {
        enabled: config.alarm.enabled,
        tickSeconds: config.alarm.tickSeconds,
        lastTick: lastTickReport(),
      },
      attribution: {
        radar: 'Datos de radar: RainViewer',
        forecast: 'Previsión: Open-Meteo',
        basemap: '© Colaboradores de OpenStreetMap',
      },
    };
  });

  app.get('/api/status', async () => ({
    watcher: lastTickReport(),
    tiles: tileCacheStats(),
    push: pushAvailable(),
    uptimeSeconds: Math.round(process.uptime()),
  }));
}
