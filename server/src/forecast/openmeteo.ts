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
import { weatherIcon } from './weatherCodes.js';

const CURRENT_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'is_day',
  'precipitation',
  'rain',
  'showers',
  'snowfall',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
];

const MINUTELY_FIELDS = ['precipitation', 'rain', 'snowfall', 'weather_code', 'precipitation_probability'];

const HOURLY_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'dew_point_2m',
  'precipitation_probability',
  'precipitation',
  'rain',
  'showers',
  'snowfall',
  'weather_code',
  'cloud_cover',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'uv_index',
  'pressure_msl',
  'is_day',
];

const DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'apparent_temperature_min',
  'sunrise',
  'sunset',
  'daylight_duration',
  'sunshine_duration',
  'uv_index_max',
  'precipitation_sum',
  'rain_sum',
  'showers_sum',
  'snowfall_sum',
  'precipitation_hours',
  'precipitation_probability_max',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
];

type Series = Record<string, unknown[] | undefined>;

interface RawResponse {
  error?: boolean;
  reason?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  utc_offset_seconds?: number;
  elevation?: number;
  current?: Record<string, unknown>;
  minutely_15?: Series;
  hourly?: Series;
  daily?: Series;
}

/**
 * Petición con un reintento. El servicio devuelve algún 5xx suelto cuando llegan
 * varias consultas a la vez; un único reintento evita que el panel se quede sin
 * previsión por un tropiezo momentáneo.
 */
async function fetchWithRetry(url: URL): Promise<Response> {
  let last: Response | Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': config.userAgent, accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      // Los errores del propio servicio (4xx) no se reintentan: no cambiarían.
      if (res.ok || res.status < 500) return res;
      last = res;
    } catch (err) {
      last = err as Error;
    }
  }
  if (last instanceof Error) throw last;
  return last as Response;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function at(series: Series, key: string, i: number): unknown {
  return series[key]?.[i];
}

/**
 * Índice del primer instante de la serie que aún es relevante.
 *
 * Open-Meteo devuelve las marcas de tiempo en hora local del lugar y sin
 * indicador de zona, así que se reconstruye el instante UTC restando el desfase.
 * `toleranceMs` permite conservar el intervalo en curso.
 */
function firstFutureIndex(times: unknown[], utcOffsetSeconds: number, toleranceMs: number): number {
  const cutoff = Date.now() - toleranceMs;
  for (let i = 0; i < times.length; i++) {
    const t = str(times[i]);
    if (!t) continue;
    const ms = Date.parse(`${t}Z`) - utcOffsetSeconds * 1000;
    if (Number.isFinite(ms) && ms >= cutoff) return i;
  }
  return Math.max(0, times.length - 1);
}

function buildCurrent(raw: Record<string, unknown> | undefined): CurrentConditions | null {
  if (!raw) return null;
  const code = num(raw['weather_code']);
  return {
    time: str(raw['time']) ?? '',
    temperature: num(raw['temperature_2m']),
    apparentTemperature: num(raw['apparent_temperature']),
    humidity: num(raw['relative_humidity_2m']),
    precipitation: num(raw['precipitation']),
    rain: num(raw['rain']),
    snowfall: num(raw['snowfall']),
    weatherCode: code,
    icon: weatherIcon(code),
    cloudCover: num(raw['cloud_cover']),
    pressure: num(raw['pressure_msl']),
    windSpeed: num(raw['wind_speed_10m']),
    windDirection: num(raw['wind_direction_10m']),
    windGust: num(raw['wind_gusts_10m']),
    visibility: null,
    uvIndex: null,
    dewPoint: null,
    isDay: num(raw['is_day']) !== 0,
  };
}

/**
 * Previsión de Open-Meteo: gratuita y sin clave para uso no comercial, con
 * datos de 15 minutos donde los modelos de alta resolución lo permiten.
 */
export const openMeteoProvider: ForecastProvider = {
  id: 'openmeteo',
  label: 'Open-Meteo',

  available: () => true,
  unavailableReason: () => null,

  async fetch(request: ForecastRequest): Promise<WeatherForecast> {
    const days = Math.max(1, Math.min(16, request.days ?? 7));
    const url = new URL(config.forecast.openMeteoUrl);
    url.searchParams.set('latitude', request.lat.toFixed(4));
    url.searchParams.set('longitude', request.lon.toFixed(4));
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', String(days));
    url.searchParams.set('current', CURRENT_FIELDS.join(','));
    url.searchParams.set('minutely_15', MINUTELY_FIELDS.join(','));
    url.searchParams.set('hourly', HOURLY_FIELDS.join(','));
    url.searchParams.set('daily', DAILY_FIELDS.join(','));
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('precipitation_unit', 'mm');
    url.searchParams.set('temperature_unit', 'celsius');
    // Las conversiones de unidades se hacen en el cliente a partir del sistema métrico.

    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
    const raw = (await res.json()) as RawResponse;
    if (raw.error) throw new Error(`Open-Meteo: ${raw.reason ?? 'error desconocido'}`);

    const utcOffsetSeconds = raw.utc_offset_seconds ?? 0;

    const minutely: MinutelyPoint[] = [];
    const m15 = raw.minutely_15;
    if (m15?.time) {
      const start = firstFutureIndex(m15.time, utcOffsetSeconds, 15 * 60 * 1000);
      const limit = Math.min(m15.time.length, start + 24); // 6 horas
      for (let i = start; i < limit; i++) {
        minutely.push({
          time: str(at(m15, 'time', i)) ?? '',
          precipitation: num(at(m15, 'precipitation', i)) ?? 0,
          probability: num(at(m15, 'precipitation_probability', i)),
          snowfall: num(at(m15, 'snowfall', i)),
          weatherCode: num(at(m15, 'weather_code', i)),
        });
      }
    }

    const hourly: HourlyPoint[] = [];
    const h = raw.hourly;
    if (h?.time) {
      const start = firstFutureIndex(h.time, utcOffsetSeconds, 60 * 60 * 1000);
      const limit = Math.min(h.time.length, start + (request.hours ?? 48));
      for (let i = start; i < limit; i++) {
        const code = num(at(h, 'weather_code', i));
        hourly.push({
          time: str(at(h, 'time', i)) ?? '',
          temperature: num(at(h, 'temperature_2m', i)),
          apparentTemperature: num(at(h, 'apparent_temperature', i)),
          humidity: num(at(h, 'relative_humidity_2m', i)),
          dewPoint: num(at(h, 'dew_point_2m', i)),
          probability: num(at(h, 'precipitation_probability', i)),
          precipitation: num(at(h, 'precipitation', i)),
          rain: num(at(h, 'rain', i)),
          snowfall: num(at(h, 'snowfall', i)),
          weatherCode: code,
          icon: weatherIcon(code),
          cloudCover: num(at(h, 'cloud_cover', i)),
          visibility: num(at(h, 'visibility', i)),
          windSpeed: num(at(h, 'wind_speed_10m', i)),
          windDirection: num(at(h, 'wind_direction_10m', i)),
          windGust: num(at(h, 'wind_gusts_10m', i)),
          uvIndex: num(at(h, 'uv_index', i)),
          pressure: num(at(h, 'pressure_msl', i)),
          isDay: num(at(h, 'is_day', i)) !== 0,
        });
      }
    }

    const daily: DailyPoint[] = [];
    const d = raw.daily;
    if (d?.time) {
      for (let i = 0; i < d.time.length; i++) {
        const code = num(at(d, 'weather_code', i));
        const rain = num(at(d, 'rain_sum', i));
        const showers = num(at(d, 'showers_sum', i));
        daily.push({
          date: str(at(d, 'time', i)) ?? '',
          weatherCode: code,
          icon: weatherIcon(code),
          temperatureMax: num(at(d, 'temperature_2m_max', i)),
          temperatureMin: num(at(d, 'temperature_2m_min', i)),
          apparentMax: num(at(d, 'apparent_temperature_max', i)),
          apparentMin: num(at(d, 'apparent_temperature_min', i)),
          sunrise: str(at(d, 'sunrise', i)),
          sunset: str(at(d, 'sunset', i)),
          daylightSeconds: num(at(d, 'daylight_duration', i)),
          sunshineSeconds: num(at(d, 'sunshine_duration', i)),
          uvIndexMax: num(at(d, 'uv_index_max', i)),
          precipitationSum: num(at(d, 'precipitation_sum', i)),
          rainSum: rain === null && showers === null ? null : (rain ?? 0) + (showers ?? 0),
          snowfallSum: num(at(d, 'snowfall_sum', i)),
          precipitationHours: num(at(d, 'precipitation_hours', i)),
          probabilityMax: num(at(d, 'precipitation_probability_max', i)),
          windSpeedMax: num(at(d, 'wind_speed_10m_max', i)),
          windGustMax: num(at(d, 'wind_gusts_10m_max', i)),
          windDirectionDominant: num(at(d, 'wind_direction_10m_dominant', i)),
        });
      }
    }

    // El horario aporta visibilidad, UV y punto de rocío que el bloque `current` no trae.
    const current = buildCurrent(raw.current);
    const firstHour = hourly[0];
    if (current && firstHour) {
      current.visibility = firstHour.visibility;
      current.uvIndex = firstHour.uvIndex;
      current.dewPoint = firstHour.dewPoint;
    }

    return {
      provider: 'openmeteo',
      place: {
        lat: raw.latitude ?? request.lat,
        lon: raw.longitude ?? request.lon,
        timezone: raw.timezone ?? 'UTC',
        utcOffsetSeconds,
        elevationM: raw.elevation ?? null,
      },
      current,
      minutely,
      hourly,
      daily,
      attribution: 'Datos de previsión: Open-Meteo (CC BY 4.0)',
      fetchedAt: Date.now(),
    };
  },
};
