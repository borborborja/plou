/** Tipos compartidos con la API. */

export type IntensityKey = 'drizzle' | 'light' | 'moderate' | 'heavy' | 'violent';
export type AlarmMode = 'overhead' | 'inRadius' | 'approaching';
export type AlarmTone =
  | 'classic'
  | 'chime'
  | 'siren'
  | 'radar'
  | 'droplet'
  | 'bell'
  | 'pulse'
  | 'silent';
export type Lang = 'es' | 'ca' | 'en';
export type ProviderId = 'openmeteo' | 'foreca';

export interface QuietHours {
  enabled: boolean;
  from: string;
  to: string;
  days: number[];
}

export interface Schedule {
  enabled: boolean;
  from: string;
  to: string;
  days: number[];
}

export interface SoundConfig {
  tone: AlarmTone;
  volume: number;
  vibrate: boolean;
  loop: boolean;
  durationSeconds: number;
  fadeIn: boolean;
}

export interface AlarmConfig {
  enabled: boolean;
  radiusKm: number;
  intensity: IntensityKey;
  detectRain: boolean;
  detectSnow: boolean;
  mode: AlarmMode;
  leadMinutes: number;
  minSpeedKmh: number;
  repeat: boolean;
  repeatMinutes: number;
  minIntervalMinutes: number;
  notifyOnClear: boolean;
  snoozeMinutes: number;
  quietHours: QuietHours;
  schedule: Schedule;
  sound: SoundConfig;
}

export interface AlarmState {
  location_id: number;
  active: number;
  active_kind: string | null;
  last_fired_at: number | null;
  last_cleared_at: number | null;
  snoozed_until: number | null;
  last_checked_at: number | null;
  last_error: string | null;
}

export interface Location {
  id: number;
  deviceId: string;
  name: string;
  lat: number;
  lon: number;
  followDevice: boolean;
  alarm: AlarmConfig;
  createdAt: number;
  updatedAt: number;
  positionUpdatedAt: number | null;
  state?: AlarmState;
}

export interface Units {
  temperature: 'C' | 'F';
  wind: 'kmh' | 'ms' | 'mph' | 'kn' | 'bft';
  precipitation: 'mm' | 'in';
  distance: 'km' | 'mi';
  pressure: 'hPa' | 'inHg' | 'mmHg';
  clock: '24h' | '12h';
}

export interface MapSettings {
  activeLayer: 'radar' | 'satellite' | 'clouds';
  satelliteVariant: 'geocolour' | 'visible' | 'infra';
  showLightning: boolean;
  satelliteOpacity: number;
  cloudOpacity: number;
  lightningOpacity: number;
  colorScheme: number;
  smooth: boolean;
  showSnow: boolean;
  opacity: number;
  blend: 'plain' | 'blend';
  baseLayer: 'auto' | 'clear' | 'streets' | 'dark' | 'terrain';
  historyMinutes: number;
  showNowcast: boolean;
  frameDurationMs: number;
  lastFrameHoldMs: number;
  autoPlay: boolean;
  showCoverage: boolean;
  showRadius: boolean;
  showMotionArrow: boolean;
}

export type MapLayerId = 'satellite' | 'clouds' | 'lightning';
export type MapFrameKind = 'observed' | 'forecast' | 'aggregate';

export interface MapFrame {
  id: string;
  time: number;
  validFrom: number;
  validTo: number;
  kind: MapFrameKind;
  template: string;
  attribution: string;
}

export interface MapLayerCapability {
  id: MapLayerId;
  configured: boolean;
  coverage: 'global' | 'eumet-disc' | 'spain';
  timeDomain: 'past' | 'forecast' | 'aggregate';
  variants: string[];
  attribution: string;
  note?: string;
}

export interface MapFrames {
  layer: MapLayerId;
  variant: string;
  generated: number;
  frames: MapFrame[];
}

export interface LightningActivity {
  active: boolean;
  approximate: true;
  periodHours: 12;
  updatedAt: number;
}

export interface Settings {
  language: Lang;
  theme: 'system' | 'light' | 'dark';
  timezone: string;
  units: Units;
  map: MapSettings;
  forecastProvider: ProviderId;
  refreshSeconds: number;
  keepScreenOn: boolean;
  showMmPerHour: boolean;
  batterySaver: boolean;
}

export interface EchoHit {
  distanceKm: number;
  bearingDeg: number;
  compass: string;
  dbz: number;
  mmPerHour: number;
  intensity: string;
  kind: 'rain' | 'snow';
  position: { lat: number; lon: number };
}

export interface MotionVector {
  east: number;
  north: number;
  speedKmh: number;
  bearingDeg: number;
  confidence: number;
  samples: number;
}

export interface TimelinePoint {
  minutes: number;
  dbz: number;
  mmPerHour: number;
  kind: 'rain' | 'snow' | 'none';
}

export interface LocationAnalysis {
  center: { lat: number; lon: number };
  observedAt: number;
  ageMinutes: number;
  radiusKm: number;
  thresholdDbz: number;
  radarCoverage: boolean | null;
  fieldCoverage: number;
  dataCoverage: number;
  overhead: EchoHit | null;
  nearest: EchoHit | null;
  strongest: EchoHit | null;
  arrival: EchoHit | null;
  cellsAboveThreshold: number;
  areaCoveragePct: number;
  motion: MotionVector | null;
  etaMinutes: number | null;
  etaRadiusMinutes: number | null;
  clearingMinutes: number | null;
  timeline: TimelinePoint[];
}

export interface RadarFrameInfo {
  time: number;
  kind: 'past' | 'nowcast';
  template: string;
}

export interface RadarFrames {
  generated: number;
  host: string;
  maxNativeZoom: number;
  tileSize: number;
  past: RadarFrameInfo[];
  nowcast: RadarFrameInfo[];
  coverageTemplate: string;
  coverageMaxNativeZoom: number;
}

export interface LegendStop {
  dbz: number;
  mmPerHour: number;
  rain: string;
  snow?: string;
  label?: string;
}

export interface RadarLegend {
  scheme: { id: number; key: string; label: string };
  snowDistinguishable: boolean;
  stops: LegendStop[];
}

export interface CurrentConditions {
  time: string;
  temperature: number | null;
  apparentTemperature: number | null;
  humidity: number | null;
  precipitation: number | null;
  rain: number | null;
  snowfall: number | null;
  weatherCode: number | null;
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
  requestedProvider: ProviderId;
  fallbackReason: string | null;
  place: {
    lat: number;
    lon: number;
    timezone: string;
    utcOffsetSeconds: number;
    elevationM: number | null;
  };
  current: CurrentConditions | null;
  minutely: MinutelyPoint[];
  hourly: HourlyPoint[];
  daily: DailyPoint[];
  attribution: string;
  fetchedAt: number;
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

export interface AlarmEvent {
  id: number;
  locationId: number;
  firedAt: number;
  kind: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
}

export interface WeatherCodeInfo {
  icon: string;
  es: string;
  ca: string;
  en: string;
}

export interface Meta {
  colorSchemes: Array<{ id: number; key: string; label: string }>;
  intensityLevels: Array<{ key: IntensityKey; label: string; dbz: number }>;
  alarmModes: AlarmMode[];
  alarmTones: AlarmTone[];
  providers: Array<{ id: ProviderId; label: string; available: boolean; reason: string | null }>;
  weatherCodes: Record<string, WeatherCodeInfo>;
  push: { available: boolean; publicKey: string };
  defaults: { alarm: AlarmConfig; settings: Settings };
  radar: { frames: number; nowcastFrames: number; latest: number | null };
  watcher: { enabled: boolean; tickSeconds: number; lastTick: unknown };
  attribution: { radar: string; forecast: string; basemap: string };
}
