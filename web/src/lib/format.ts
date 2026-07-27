import type { Lang, Units } from '../types';

const LOCALES: Record<Lang, string> = { es: 'es-ES', ca: 'ca-ES', en: 'en-GB' };

export function locale(lang: Lang): string {
  return LOCALES[lang] ?? 'es-ES';
}

export function convertTemperature(celsius: number, unit: Units['temperature']): number {
  return unit === 'F' ? celsius * 1.8 + 32 : celsius;
}

export function formatTemperature(
  celsius: number | null | undefined,
  units: Units,
  withUnit = true,
): string {
  if (celsius === null || celsius === undefined) return '–';
  const value = Math.round(convertTemperature(celsius, units.temperature));
  return withUnit ? `${value}°` : String(value);
}

function beaufort(kmh: number): number {
  const ms = kmh / 3.6;
  const limits = [0.5, 1.5, 3.3, 5.5, 7.9, 10.7, 13.8, 17.1, 20.7, 24.4, 28.4, 32.6];
  for (let i = 0; i < limits.length; i++) if (ms < limits[i]!) return i;
  return 12;
}

export function formatSpeed(kmh: number | null | undefined, units: Units): string {
  if (kmh === null || kmh === undefined) return '–';
  switch (units.wind) {
    case 'ms':
      return `${(kmh / 3.6).toFixed(1)} m/s`;
    case 'mph':
      return `${Math.round(kmh * 0.621371)} mph`;
    case 'kn':
      return `${Math.round(kmh * 0.539957)} kn`;
    case 'bft':
      return `${beaufort(kmh)} Bft`;
    default:
      return `${Math.round(kmh)} km/h`;
  }
}

export function formatDistance(km: number | null | undefined, units: Units): string {
  if (km === null || km === undefined) return '–';
  const value = units.distance === 'mi' ? km * 0.621371 : km;
  const suffix = units.distance === 'mi' ? 'mi' : 'km';
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${suffix}`;
}

export function formatPrecip(mm: number | null | undefined, units: Units): string {
  if (mm === null || mm === undefined) return '–';
  if (units.precipitation === 'in') return `${(mm * 0.0393701).toFixed(2)} in`;
  return `${mm < 10 ? mm.toFixed(1) : Math.round(mm)} mm`;
}

export function formatPrecipRate(mmh: number | null | undefined, units: Units): string {
  if (mmh === null || mmh === undefined) return '–';
  if (units.precipitation === 'in') return `${(mmh * 0.0393701).toFixed(2)} in/h`;
  return `${mmh < 10 ? mmh.toFixed(1) : Math.round(mmh)} mm/h`;
}

export function formatPressure(hPa: number | null | undefined, units: Units): string {
  if (hPa === null || hPa === undefined) return '–';
  switch (units.pressure) {
    case 'inHg':
      return `${(hPa * 0.02953).toFixed(2)} inHg`;
    case 'mmHg':
      return `${Math.round(hPa * 0.750062)} mmHg`;
    default:
      return `${Math.round(hPa)} hPa`;
  }
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '–';
  return `${Math.round(value)} %`;
}

export function formatVisibility(metres: number | null | undefined, units: Units): string {
  if (metres === null || metres === undefined) return '–';
  return formatDistance(metres / 1000, units);
}

/**
 * Las marcas de tiempo de la previsión llegan en hora local del lugar y sin
 * indicador de zona; se formatean tal cual para no desplazarlas.
 */
export function parseLocalIso(value: string): Date | null {
  if (!value) return null;
  const ms = Date.parse(`${value}${value.length <= 16 ? ':00' : ''}Z`);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

export function formatLocalTime(value: string, units: Units, lang: Lang): string {
  const date = parseLocalIso(value);
  if (!date) return '–';
  return new Intl.DateTimeFormat(locale(lang), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: units.clock === '12h',
    timeZone: 'UTC',
  }).format(date);
}

export function formatClock(ms: number, units: Units, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: units.clock === '12h',
  }).format(new Date(ms));
}

export function formatDateTime(ms: number, units: Units, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: units.clock === '12h',
  }).format(new Date(ms));
}

export function formatWeekday(value: string, lang: Lang, long = false): string {
  const date = parseLocalIso(`${value}T00:00`);
  if (!date) return value;
  return new Intl.DateTimeFormat(locale(lang), {
    weekday: long ? 'long' : 'short',
    timeZone: 'UTC',
  }).format(date);
}

export function formatDayMonth(value: string, lang: Lang): string {
  const date = parseLocalIso(`${value}T00:00`);
  if (!date) return value;
  return new Intl.DateTimeFormat(locale(lang), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

export function formatDuration(seconds: number | null | undefined, lang: Lang): string {
  if (seconds === null || seconds === undefined) return '–';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return lang === 'en' ? `${h} h ${m} min` : `${h} h ${m} min`;
}

const COMPASS: Record<Lang, string[]> = {
  es: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'],
  ca: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'],
  en: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
};

export function compassPoint(deg: number | null | undefined, lang: Lang): string {
  if (deg === null || deg === undefined) return '–';
  const list = COMPASS[lang] ?? COMPASS.es;
  return list[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] ?? 'N';
}

/** Traduce el punto cardinal que devuelve el servidor (nomenclatura castellana). */
export function translateCompass(value: string, lang: Lang): string {
  const from = COMPASS.es.indexOf(value);
  if (from < 0) return value;
  return (COMPASS[lang] ?? COMPASS.es)[from] ?? value;
}

export function uvLabel(uv: number | null | undefined, lang: Lang): string {
  if (uv === null || uv === undefined) return '–';
  const scale =
    lang === 'en'
      ? ['Low', 'Moderate', 'High', 'Very high', 'Extreme']
      : lang === 'ca'
        ? ['Baix', 'Moderat', 'Alt', 'Molt alt', 'Extrem']
        : ['Bajo', 'Moderado', 'Alto', 'Muy alto', 'Extremo'];
  const idx = uv < 3 ? 0 : uv < 6 ? 1 : uv < 8 ? 2 : uv < 11 ? 3 : 4;
  return `${uv.toFixed(1)} · ${scale[idx]}`;
}
