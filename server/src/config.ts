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

function envList(name: string): string[] {
  return env(name)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function envNumbers(name: string, fallback: number[]): number[] {
  const parsed = env(name)
    .split(',')
    .map((value) => Number(value.trim()))
    .filter(Number.isFinite);
  return parsed.length === fallback.length ? parsed : fallback;
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

  security: {
    /** Orígenes externos autorizados. Vacío mantiene la API en mismo origen. */
    corsOrigins: envList('PLOU_CORS_ORIGINS'),
    /** Sólo activar tras un proxy propio que sanee X-Forwarded-For. */
    trustProxy: envBool('PLOU_TRUST_PROXY', false),
    /** Peticiones máximas por IP y minuto. */
    rateLimitPerMinute: Math.max(30, envInt('PLOU_RATE_LIMIT_PER_MINUTE', 300)),
    /** Límites defensivos para una instalación personal expuesta. */
    maxDevices: Math.max(1, envInt('PLOU_MAX_DEVICES', 100)),
    maxLocationsPerDevice: Math.max(1, envInt('PLOU_MAX_LOCATIONS_PER_DEVICE', 20)),
    /** Secreto opcional exigido sólo al registrar un navegador nuevo. */
    registrationToken: env('PLOU_REGISTRATION_TOKEN'),
  },

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
    /** Tope aproximado de memoria para teselas decodificadas. */
    tileCacheMaxBytes: Math.max(16, envInt('PLOU_RADAR_TILE_CACHE_MB', 128)) * 1024 * 1024,
    /** Timeout de descarga de tesela (ms). */
    tileTimeoutMs: envInt('PLOU_RADAR_TILE_TIMEOUT', 12_000),
  },

  mapLayers: {
    /** EUMETView es público; el servidor lo normaliza a teselas XYZ y lo cachea. */
    eumetWmsUrl: env('PLOU_EUMET_WMS_URL', 'https://view.eumetsat.int/geoserver/wms'),
    satelliteHistoryMinutes: Math.max(30, envInt('PLOU_SATELLITE_HISTORY_MINUTES', 120)),
    /** Weather Maps 2.0: la clave nunca se entrega al navegador. */
    openWeatherKey: env('PLOU_OPENWEATHER_API_KEY'),
    openWeatherTilesUrl: env(
      'PLOU_OPENWEATHER_TILES_URL',
      'https://maps.openweathermap.org/maps/2.0/weather',
    ),
    /** AEMET OpenData devuelve un gráfico de rayos acumulados durante 12 h. */
    aemetKey: env('PLOU_AEMET_API_KEY'),
    aemetUrl: env(
      'PLOU_AEMET_LIGHTNING_URL',
      'https://opendata.aemet.es/opendata/api/red/rayos/mapa',
    ),
    /** Extensión geográfica e interior útil del gráfico, ajustables si AEMET cambia el producto. */
    aemetBounds: envNumbers('PLOU_AEMET_LIGHTNING_BOUNDS', [-19, 27, 5, 45]),
    aemetCrop: envNumbers('PLOU_AEMET_LIGHTNING_CROP', [0, 0, 1, 1]),
    tileCacheSize: Math.max(32, envInt('PLOU_MAP_TILE_CACHE', 512)),
    tileTimeoutMs: Math.max(2_000, envInt('PLOU_MAP_TILE_TIMEOUT', 15_000)),
  },

  forecast: {
    openMeteoUrl: env('PLOU_OPENMETEO_URL', 'https://api.open-meteo.com/v1/forecast'),
    geocodingUrl: env('PLOU_GEOCODING_URL', 'https://geocoding-api.open-meteo.com/v1/search'),
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
    /** Antigüedad máxima de la posición que sigue a una PWA cerrada. */
    maxDevicePositionAgeMinutes: Math.max(5, envInt('PLOU_DEVICE_POSITION_MAX_AGE', 30)),
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
