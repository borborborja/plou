import { config } from '../config.js';
import type {
  CurrentConditions,
  DailyPoint,
  ForecastProvider,
  ForecastRequest,
  HourlyPoint,
  MinutelyPoint,
  WeatherForecast,
} from './types.js';

/**
 * Proveedor Foreca.
 *
 * Es un servicio comercial: requiere una suscripción propia, de modo que el
 * módulo queda inactivo mientras no se aporten credenciales. Admite las dos
 * formas de acceso habituales:
 *
 *  - `direct`: usuario y contraseña contra `/authorize/token`, que devuelve un
 *    token Bearer con caducidad.
 *  - `rapidapi`: pasarela de RapidAPI, que autentica por cabecera y expone las
 *    mismas rutas `/api/v1/...`.
 *
 * Los campos de la respuesta se leen de forma defensiva: cualquiera que falte
 * queda a `null` en lugar de romper la petición.
 */

interface TokenState {
  token: string;
  expiresAt: number;
}

let tokenState: TokenState | null = null;
let tokenInFlight: Promise<string> | null = null;

function forecaConfig() {
  return config.forecast.foreca;
}

export function forecaConfigured(): boolean {
  const f = forecaConfig();
  if (f.mode === 'rapidapi') return Boolean(f.rapidApiKey);
  return Boolean(f.user && f.password);
}

async function requestToken(): Promise<string> {
  const f = forecaConfig();
  const res = await fetch(f.authUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': config.userAgent,
    },
    body: JSON.stringify({ user: f.user, password: f.password }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Foreca: no se pudo obtener el token (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Foreca: la respuesta del token no incluye `access_token`');
  const ttl = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  // Se renueva un minuto antes de caducar para no encadenar un 401.
  tokenState = { token: body.access_token, expiresAt: Date.now() + Math.max(60, ttl - 60) * 1000 };
  return body.access_token;
}

async function accessToken(): Promise<string> {
  if (tokenState && tokenState.expiresAt > Date.now()) return tokenState.token;
  if (tokenInFlight) return tokenInFlight;
  tokenInFlight = requestToken().finally(() => {
    tokenInFlight = null;
  });
  return tokenInFlight;
}

async function call<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const f = forecaConfig();
  const base = f.mode === 'rapidapi' ? `https://${f.rapidApiHost}` : f.baseUrl;
  const url = new URL(`${base.replace(/\/$/, '')}/api/v1/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': config.userAgent,
  };
  if (f.mode === 'rapidapi') {
    headers['x-rapidapi-key'] = f.rapidApiKey;
    headers['x-rapidapi-host'] = f.rapidApiHost;
  } else {
    headers.authorization = `Bearer ${await accessToken()}`;
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 && f.mode === 'direct') {
    // Token caducado antes de tiempo: se fuerza una renovación y se reintenta.
    tokenState = null;
    const retry = await fetch(url, {
      headers: { ...headers, authorization: `Bearer ${await accessToken()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!retry.ok) throw new Error(`Foreca ${path}: HTTP ${retry.status}`);
    return (await retry.json()) as T;
  }
  if (!res.ok) throw new Error(`Foreca ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Los símbolos de Foreca tienen la forma `d000`/`n400`: la primera letra indica
 * día o noche y los dígitos la nubosidad, la precipitación y la tormenta.
 * Se traducen a las mismas claves de icono que usa el resto de la aplicación.
 */
export function symbolToIcon(symbol: string | null): string {
  if (!symbol || symbol.length < 4) return 'unknown';
  const cloud = symbol[1] ?? '0';
  const precip = symbol[2] ?? '0';
  const thunder = symbol[3] ?? '0';

  if (thunder !== '0') return 'thunderstorm';
  if (precip === '1') return cloud >= '3' ? 'showers' : 'rain';
  if (precip === '2') return 'sleet';
  if (precip === '3') return cloud >= '3' ? 'snow-showers' : 'snow';
  if (precip === '4') return 'heavy-rain';
  if (precip === '5') return 'heavy-snow';
  if (precip === '6') return 'freezing-rain';

  switch (cloud) {
    case '0':
      return 'clear';
    case '1':
      return 'mostly-clear';
    case '2':
      return 'partly-cloudy';
    case '3':
      return 'partly-cloudy';
    case '4':
      return 'overcast';
    default:
      return 'unknown';
  }
}

function isDaySymbol(symbol: string | null): boolean {
  return symbol?.[0] !== 'n';
}

interface ForecaCurrent {
  current?: Record<string, unknown>;
}

interface ForecaSeries {
  forecast?: Array<Record<string, unknown>>;
}

export const forecaProvider: ForecastProvider = {
  id: 'foreca',
  label: 'Foreca',

  available: () => forecaConfigured(),

  unavailableReason: () =>
    forecaConfigured()
      ? null
      : 'Foreca es un servicio bajo licencia: hay que configurar credenciales propias para activarlo.',

  async fetch(request: ForecastRequest): Promise<WeatherForecast> {
    if (!forecaConfigured()) {
      throw new Error('Foreca no está configurado');
    }
    const point = `${request.lon.toFixed(4)},${request.lat.toFixed(4)}`;
    const days = Math.max(1, Math.min(14, request.days ?? 7));
    const hours = Math.max(1, Math.min(168, request.hours ?? 48));

    const [currentRes, minutelyRes, hourlyRes, dailyRes] = await Promise.all([
      call<ForecaCurrent>(`current/${point}`, { tempunit: 'C', windunit: 'KMH' }).catch(() => null),
      call<ForecaSeries>(`forecast/15minutely/${point}`, { periods: '8' }).catch(() => null),
      call<ForecaSeries>(`forecast/hourly/${point}`, {
        periods: String(hours),
        tempunit: 'C',
        windunit: 'KMH',
      }).catch(() => null),
      call<ForecaSeries>(`forecast/daily/${point}`, {
        periods: String(days),
        tempunit: 'C',
        windunit: 'KMH',
      }).catch(() => null),
    ]);

    if (!currentRes && !hourlyRes && !dailyRes) {
      throw new Error('Foreca no ha devuelto ningún dato');
    }

    const c = currentRes?.current;
    const current: CurrentConditions | null = c
      ? {
          time: str(c['time']) ?? '',
          temperature: num(c['temperature']),
          apparentTemperature: num(c['feelsLikeTemp']),
          humidity: num(c['relHumidity']),
          precipitation: num(c['precipRate']),
          rain: null,
          snowfall: null,
          weatherCode: null,
          icon: symbolToIcon(str(c['symbol'])),
          cloudCover: num(c['cloudiness']),
          pressure: num(c['pressure']),
          windSpeed: num(c['windSpeed']),
          windDirection: num(c['windDir']),
          windGust: num(c['windGust']),
          visibility: num(c['visibility']),
          uvIndex: num(c['uvIndex']),
          dewPoint: num(c['dewPoint']),
          isDay: isDaySymbol(str(c['symbol'])),
        }
      : null;

    const minutely: MinutelyPoint[] = (minutelyRes?.forecast ?? []).map((p) => ({
      time: str(p['time']) ?? '',
      precipitation: num(p['precipAccum']) ?? num(p['precipRate']) ?? 0,
      probability: num(p['precipProb']),
      snowfall: null,
      weatherCode: null,
    }));

    const hourly: HourlyPoint[] = (hourlyRes?.forecast ?? []).map((p) => {
      const symbol = str(p['symbol']);
      return {
        time: str(p['time']) ?? '',
        temperature: num(p['temperature']),
        apparentTemperature: num(p['feelsLikeTemp']),
        humidity: num(p['relHumidity']),
        dewPoint: num(p['dewPoint']),
        probability: num(p['precipProb']),
        precipitation: num(p['precipAccum']),
        rain: null,
        snowfall: num(p['snowAccum']),
        weatherCode: null,
        icon: symbolToIcon(symbol),
        cloudCover: num(p['cloudiness']),
        visibility: num(p['visibility']),
        windSpeed: num(p['windSpeed']),
        windDirection: num(p['windDir']),
        windGust: num(p['windGust']),
        uvIndex: num(p['uvIndex']),
        pressure: num(p['pressure']),
        isDay: isDaySymbol(symbol),
      };
    });

    const daily: DailyPoint[] = (dailyRes?.forecast ?? []).map((p) => ({
      date: str(p['date']) ?? '',
      weatherCode: null,
      icon: symbolToIcon(str(p['symbol'])),
      temperatureMax: num(p['maxTemp']),
      temperatureMin: num(p['minTemp']),
      apparentMax: num(p['maxFeelsLikeTemp']),
      apparentMin: num(p['minFeelsLikeTemp']),
      sunrise: str(p['sunrise']),
      sunset: str(p['sunset']),
      daylightSeconds: null,
      sunshineSeconds: null,
      uvIndexMax: num(p['uvIndex']),
      precipitationSum: num(p['precipAccum']),
      rainSum: null,
      snowfallSum: num(p['snowAccum']),
      precipitationHours: null,
      probabilityMax: num(p['precipProb']),
      windSpeedMax: num(p['maxWindSpeed']) ?? num(p['windSpeed']),
      windGustMax: num(p['maxWindGust']) ?? num(p['windGust']),
      windDirectionDominant: num(p['windDir']),
    }));

    return {
      provider: 'foreca',
      place: {
        lat: request.lat,
        lon: request.lon,
        timezone: 'UTC',
        utcOffsetSeconds: 0,
        elevationM: null,
      },
      current,
      minutely,
      hourly,
      daily,
      attribution: 'Datos de previsión: Foreca',
      fetchedAt: Date.now(),
    };
  },
};

/** Utilidad de test: olvida el token en memoria. */
export function resetForecaToken(): void {
  tokenState = null;
  tokenInFlight = null;
}
