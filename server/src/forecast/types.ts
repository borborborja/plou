/** Modelo de previsión común a todos los proveedores. */

export type ProviderId = 'openmeteo' | 'foreca';

export interface ForecastPlace {
  lat: number;
  lon: number;
  timezone: string;
  utcOffsetSeconds: number;
  elevationM: number | null;
  /** Nombre resuelto por el proveedor, si lo aporta. */
  name?: string;
}

export interface CurrentConditions {
  /** Instante en ISO 8601 local del lugar. */
  time: string;
  temperature: number | null;
  apparentTemperature: number | null;
  humidity: number | null;
  precipitation: number | null;
  rain: number | null;
  snowfall: number | null;
  weatherCode: number | null;
  /** Clave de icono normalizada. */
  icon: string;
  cloudCover: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGust: number | null;
  visibility: number | null;
  uvIndex: number | null;
  dewPoint: number | null;
  isDay: boolean;
}

export interface MinutelyPoint {
  time: string;
  /** mm acumulados en el intervalo. */
  precipitation: number;
  probability: number | null;
  snowfall: number | null;
  weatherCode: number | null;
}

export interface HourlyPoint {
  time: string;
  temperature: number | null;
  apparentTemperature: number | null;
  humidity: number | null;
  dewPoint: number | null;
  probability: number | null;
  precipitation: number | null;
  rain: number | null;
  snowfall: number | null;
  weatherCode: number | null;
  icon: string;
  cloudCover: number | null;
  visibility: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGust: number | null;
  uvIndex: number | null;
  pressure: number | null;
  isDay: boolean;
}

export interface DailyPoint {
  date: string;
  weatherCode: number | null;
  icon: string;
  temperatureMax: number | null;
  temperatureMin: number | null;
  apparentMax: number | null;
  apparentMin: number | null;
  sunrise: string | null;
  sunset: string | null;
  daylightSeconds: number | null;
  sunshineSeconds: number | null;
  uvIndexMax: number | null;
  precipitationSum: number | null;
  rainSum: number | null;
  snowfallSum: number | null;
  precipitationHours: number | null;
  probabilityMax: number | null;
  windSpeedMax: number | null;
  windGustMax: number | null;
  windDirectionDominant: number | null;
}

export interface WeatherForecast {
  provider: ProviderId;
  place: ForecastPlace;
  current: CurrentConditions | null;
  /** Intervalos de 15 minutos para las próximas horas, si el proveedor los ofrece. */
  minutely: MinutelyPoint[];
  hourly: HourlyPoint[];
  daily: DailyPoint[];
  /** Texto de atribución exigido por la fuente. */
  attribution: string;
  fetchedAt: number;
}

export interface ForecastRequest {
  lat: number;
  lon: number;
  /** Días de previsión diaria. */
  days?: number;
  /** Horas de previsión horaria. */
  hours?: number;
  language?: string;
}

export interface ForecastProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** ¿Está utilizable con la configuración actual? */
  available(): boolean;
  /** Motivo por el que no está disponible, para mostrarlo en ajustes. */
  unavailableReason(): string | null;
  fetch(request: ForecastRequest): Promise<WeatherForecast>;
}

export interface GeocodeResult {
  name: string;
  lat: number;
  lon: number;
  country: string | null;
  countryCode: string | null;
  admin1: string | null;
  timezone: string | null;
  population: number | null;
}
