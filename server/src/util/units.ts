/** Conversión y formato de unidades, compartido por avisos y API. */

export type DistanceUnit = 'km' | 'mi';
export type SpeedUnit = 'kmh' | 'ms' | 'mph' | 'kn' | 'bft';
export type PrecipUnit = 'mm' | 'in';
export type TemperatureUnit = 'C' | 'F';
export type PressureUnit = 'hPa' | 'inHg' | 'mmHg';

const KM_TO_MI = 0.621371;
const MM_TO_IN = 0.0393701;

export function convertDistance(km: number, unit: DistanceUnit): number {
  return unit === 'mi' ? km * KM_TO_MI : km;
}

export function formatDistance(km: number, unit: DistanceUnit = 'km'): string {
  const value = convertDistance(km, unit);
  const suffix = unit === 'mi' ? 'mi' : 'km';
  if (value < 10) return `${value.toFixed(1)} ${suffix}`;
  return `${Math.round(value)} ${suffix}`;
}

/** Escala Beaufort a partir de la velocidad en km/h. */
export function toBeaufort(kmh: number): number {
  const ms = kmh / 3.6;
  const limits = [0.5, 1.5, 3.3, 5.5, 7.9, 10.7, 13.8, 17.1, 20.7, 24.4, 28.4, 32.6];
  for (let i = 0; i < limits.length; i++) {
    if (ms < limits[i]!) return i;
  }
  return 12;
}

export function convertSpeed(kmh: number, unit: SpeedUnit): number {
  switch (unit) {
    case 'ms':
      return kmh / 3.6;
    case 'mph':
      return kmh * 0.621371;
    case 'kn':
      return kmh * 0.539957;
    case 'bft':
      return toBeaufort(kmh);
    default:
      return kmh;
  }
}

export function formatSpeed(kmh: number, unit: SpeedUnit = 'kmh'): string {
  const value = convertSpeed(kmh, unit);
  switch (unit) {
    case 'ms':
      return `${value.toFixed(1)} m/s`;
    case 'mph':
      return `${Math.round(value)} mph`;
    case 'kn':
      return `${Math.round(value)} kn`;
    case 'bft':
      return `${Math.round(value)} Bft`;
    default:
      return `${Math.round(value)} km/h`;
  }
}

export function convertPrecip(mm: number, unit: PrecipUnit): number {
  return unit === 'in' ? mm * MM_TO_IN : mm;
}

export function formatPrecipRate(mmPerHour: number, unit: PrecipUnit = 'mm'): string {
  const value = convertPrecip(mmPerHour, unit);
  if (unit === 'in') return `${value.toFixed(2)} in/h`;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} mm/h`;
}

export function convertTemperature(celsius: number, unit: TemperatureUnit): number {
  return unit === 'F' ? celsius * 1.8 + 32 : celsius;
}

export function convertPressure(hPa: number, unit: PressureUnit): number {
  switch (unit) {
    case 'inHg':
      return hPa * 0.02953;
    case 'mmHg':
      return hPa * 0.750062;
    default:
      return hPa;
  }
}
