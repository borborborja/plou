import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) return '';
    return fallback;
  }
  return v;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

/**
 * Las claves VAPID se pueden pasar por entorno o dejarse en un fichero local
 * generado con `npm run keys`. Nunca se registran en el log.
 */
function readVapidFile(path: string): { publicKey: string; privateKey: string } | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      publicKey?: string;
      privateKey?: string;
    };
    if (parsed.publicKey && parsed.privateKey) {
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
    }
  } catch {
    /* fichero ausente o ilegible: se ignora */
  }
  return null;
}

const dataDir = resolve(env('PLOU_DATA_DIR', './data'));
const vapidFile = resolve(env('PLOU_VAPID_FILE', `${dataDir}/vapid.json`));
const fileKeys = readVapidFile(vapidFile);

export const config = {
  port: envInt('PORT', 8787),
  host: env('HOST', '0.0.0.0'),
  dataDir,
  dbPath: resolve(env('PLOU_DB', `${dataDir}/plou.db`)),
  /** Servir el build estático de la PWA desde el propio servidor. */
  serveWeb: envBool('PLOU_SERVE_WEB', true),
  webDist: resolve(env('PLOU_WEB_DIST', '../web/dist')),

  radar: {
    /** Índice de fotogramas de radar (pasado + nowcast si la licencia lo incluye). */
    indexUrl: env('PLOU_RADAR_INDEX', 'https://api.rainviewer.com/public/weather-maps.json'),
    /** Segundos que se cachea el índice de fotogramas. Se refresca cada 10 min. */
    indexTtlSeconds: envInt('PLOU_RADAR_INDEX_TTL', 120),
    /** Zoom de las teselas usadas para el análisis (nivel máximo del acceso gratuito). */
    analysisZoom: envInt('PLOU_RADAR_ZOOM', 7),
    /** Tamaño de tesela en píxeles. */
    tileSize: envInt('PLOU_RADAR_TILE_SIZE', 512) === 256 ? 256 : 512,
    /** Nº máximo de teselas decodificadas en memoria. */
    tileCacheSize: envInt('PLOU_RADAR_TILE_CACHE', 400),
    /** Timeout de descarga de tesela (ms). */
    tileTimeoutMs: envInt('PLOU_RADAR_TILE_TIMEOUT', 12_000),
  },

  forecast: {
    openMeteoUrl: env('PLOU_OPENMETEO_URL', 'https://api.open-meteo.com/v1/forecast'),
    geocodingUrl: env('PLOU_GEOCODING_URL', 'https://geocoding-api.open-meteo.com/v1/search'),
    airQualityUrl: env(
      'PLOU_AIRQUALITY_URL',
      'https://air-quality-api.open-meteo.com/v1/air-quality',
    ),
    /**
     * Foreca es un servicio comercial: sólo se activa si se aportan credenciales.
     * Modo `direct` usa developer.foreca.com (usuario/contraseña -> token);
     * modo `rapidapi` usa una clave de RapidAPI.
     */
    foreca: {
      mode: env('PLOU_FORECA_MODE', 'direct') === 'rapidapi' ? 'rapidapi' : 'direct',
      user: env('PLOU_FORECA_USER'),
      password: env('PLOU_FORECA_PASSWORD'),
      rapidApiKey: env('PLOU_FORECA_RAPIDAPI_KEY'),
      rapidApiHost: env('PLOU_FORECA_RAPIDAPI_HOST', 'foreca-weather.p.rapidapi.com'),
      baseUrl: env('PLOU_FORECA_BASE_URL', 'https://pfa.foreca.com'),
      authUrl: env('PLOU_FORECA_AUTH_URL', 'https://pfa.foreca.com/authorize/token'),
    },
    /** Segundos de caché de las respuestas de previsión. */
    cacheTtlSeconds: envInt('PLOU_FORECAST_TTL', 600),
  },

  alarm: {
    /** Periodo del bucle de vigilancia en segundos. */
    tickSeconds: envInt('PLOU_ALARM_TICK', 120),
    /** Se ignoran fotogramas de radar más antiguos que esto (minutos). */
    maxFrameAgeMinutes: envInt('PLOU_ALARM_MAX_FRAME_AGE', 30),
    /** Activar el bucle de vigilancia en segundo plano. */
    enabled: envBool('PLOU_ALARM_ENABLED', true),
  },

  push: {
    subject: env('PLOU_VAPID_SUBJECT', 'mailto:admin@localhost'),
    publicKey: env('PLOU_VAPID_PUBLIC_KEY', fileKeys?.publicKey ?? ''),
    privateKey: env('PLOU_VAPID_PRIVATE_KEY', fileKeys?.privateKey ?? ''),
    vapidFile,
  },

  userAgent: env('PLOU_USER_AGENT', 'Plou/1.0 (rain alarm; +https://localhost)'),
} as const;

export type Config = typeof config;
