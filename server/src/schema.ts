import { z } from 'zod';

/** Días de la semana: 0 = domingo … 6 = sábado (igual que `Date#getDay`). */
const weekdays = z.array(z.number().int().min(0).max(6)).max(7);

const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato esperado HH:MM');

export const intensityKeys = ['drizzle', 'light', 'moderate', 'heavy', 'violent'] as const;
export const alarmModes = ['overhead', 'inRadius', 'approaching'] as const;

/** Tonos sintetizados disponibles para la alarma. */
export const alarmTones = [
  'classic',
  'chime',
  'siren',
  'radar',
  'droplet',
  'bell',
  'pulse',
  'silent',
] as const;

export const quietHoursSchema = z.object({
  enabled: z.boolean().default(false),
  from: timeOfDay.default('22:00'),
  to: timeOfDay.default('07:00'),
  /** Días en los que se aplica el silencio. Vacío = todos. */
  days: weekdays.default([]),
});

export const scheduleSchema = z.object({
  /** Vigilar sólo dentro de la franja indicada. */
  enabled: z.boolean().default(false),
  from: timeOfDay.default('07:00'),
  to: timeOfDay.default('22:00'),
  days: weekdays.default([]),
});

export const soundSchema = z.object({
  tone: z.enum(alarmTones).default('classic'),
  volume: z.number().min(0).max(1).default(0.8),
  vibrate: z.boolean().default(true),
  /** Repetir el tono hasta que se descarte la alarma. */
  loop: z.boolean().default(false),
  /** Duración máxima del sonido, en segundos. */
  durationSeconds: z.number().int().min(1).max(120).default(10),
  /** Ir subiendo el volumen progresivamente. */
  fadeIn: z.boolean().default(false),
});

export const alarmConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Radio de vigilancia alrededor de la ubicación, en km. */
  radiusKm: z.number().min(1).max(100).default(20),
  /** Sensibilidad: intensidad mínima que dispara la alarma. */
  intensity: z.enum(intensityKeys).default('light'),
  detectRain: z.boolean().default(true),
  detectSnow: z.boolean().default(false),
  /**
   * `overhead`: sólo cuando ya llueve encima.
   * `inRadius`: cuando hay precipitación dentro del radio.
   * `approaching`: cuando la extrapolación indica que llegará en breve.
   */
  mode: z.enum(alarmModes).default('inRadius'),
  /** Antelación máxima, en minutos, para el modo `approaching`. */
  leadMinutes: z.number().int().min(5).max(120).default(30),
  /** En modo `approaching`, ignora sistemas más lentos que esto. */
  minSpeedKmh: z.number().min(0).max(60).default(3),
  /** Volver a avisar mientras la situación siga activa. */
  repeat: z.boolean().default(false),
  repeatMinutes: z.number().int().min(5).max(240).default(30),
  /** Silencio mínimo entre dos alarmas distintas. */
  minIntervalMinutes: z.number().int().min(0).max(720).default(45),
  /** Avisar también cuando deje de llover. */
  notifyOnClear: z.boolean().default(false),
  /** Duración del aplazamiento al posponer una alarma. */
  snoozeMinutes: z.number().int().min(5).max(240).default(30),
  quietHours: quietHoursSchema.default({}),
  schedule: scheduleSchema.default({}),
  sound: soundSchema.default({}),
});

export type AlarmConfig = z.infer<typeof alarmConfigSchema>;
export type QuietHours = z.infer<typeof quietHoursSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;

export const locationInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /**
   * Si es `true`, las coordenadas se refrescan con la posición que envía el
   * dispositivo (la ubicación "actual"). Sólo puede haber una por dispositivo.
   */
  followDevice: z.boolean().default(false),
  alarm: alarmConfigSchema.default({}),
});

export const locationUpdateSchema = locationInputSchema.partial().extend({
  alarm: alarmConfigSchema.partial().optional(),
});

export const unitsSchema = z.object({
  temperature: z.enum(['C', 'F']).default('C'),
  wind: z.enum(['kmh', 'ms', 'mph', 'kn', 'bft']).default('kmh'),
  precipitation: z.enum(['mm', 'in']).default('mm'),
  distance: z.enum(['km', 'mi']).default('km'),
  pressure: z.enum(['hPa', 'inHg', 'mmHg']).default('hPa'),
  clock: z.enum(['24h', '12h']).default('24h'),
});

export const mapSettingsSchema = z.object({
  /** Capa meteorológica principal del mapa; los rayos son una superposición independiente. */
  activeLayer: z.enum(['radar', 'satellite', 'clouds']).default('radar'),
  satelliteVariant: z.enum(['geocolour', 'visible', 'infra']).default('geocolour'),
  showLightning: z.boolean().default(false),
  satelliteOpacity: z.number().min(0.1).max(1).default(0.9),
  cloudOpacity: z.number().min(0.1).max(1).default(0.72),
  lightningOpacity: z.number().min(0.1).max(1).default(0.9),
  /** Identificador del esquema de color del radar. */
  colorScheme: z.number().int().min(0).max(8).default(2),
  smooth: z.boolean().default(true),
  showSnow: z.boolean().default(true),
  /** Opacidad de la capa de radar. */
  opacity: z.number().min(0.1).max(1).default(0.85),
  /**
   * Cómo se combina la capa de radar con el mapa base. `plain` la dibuja con los
   * colores exactos de la paleta; `blend` la integra en el mapa (multiplicando
   * sobre fondos claros y aclarando sobre los oscuros), más bonito pero menos
   * visible sobre mapas con mucho detalle.
   */
  blend: z.enum(['plain', 'blend']).default('plain'),
  // `auto` sigue al tema de la interfaz: mapa claro de día, oscuro de noche.
  baseLayer: z.enum(['auto', 'clear', 'streets', 'dark', 'terrain']).default('auto'),
  /** Minutos de historia de radar que se animan. */
  historyMinutes: z.number().int().min(20).max(120).default(120),
  /** Incluir los fotogramas extrapolados al futuro en la animación. */
  showNowcast: z.boolean().default(true),
  /** Milisegundos por fotograma en la animación. */
  frameDurationMs: z.number().int().min(100).max(2000).default(420),
  /** Pausa al llegar al último fotograma, en milisegundos. */
  lastFrameHoldMs: z.number().int().min(0).max(5000).default(1200),
  autoPlay: z.boolean().default(true),
  showCoverage: z.boolean().default(false),
  showRadius: z.boolean().default(true),
  showMotionArrow: z.boolean().default(true),
});

export const settingsSchema = z.object({
  language: z.enum(['es', 'ca', 'en']).default('es'),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  /**
   * Zona horaria IANA del dispositivo. Determina cuándo se aplican las franjas
   * de silencio y de vigilancia.
   */
  timezone: z.string().min(1).max(64).default('UTC'),
  units: unitsSchema.default({}),
  map: mapSettingsSchema.default({}),
  /** Proveedor de previsión por modelo numérico. */
  forecastProvider: z.enum(['openmeteo', 'foreca']).default('openmeteo'),
  /** Segundos entre refrescos automáticos en primer plano. */
  refreshSeconds: z.number().int().min(60).max(1800).default(300),
  /** Mantener la pantalla encendida mientras la app está abierta. */
  keepScreenOn: z.boolean().default(false),
  /** Mostrar la intensidad en mm/h además de en la escala cualitativa. */
  showMmPerHour: z.boolean().default(true),
  /** Reducir peticiones cuando el dispositivo está en ahorro de energía. */
  batterySaver: z.boolean().default(false),
});

export type Settings = z.infer<typeof settingsSchema>;

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  expirationTime: z.number().nullable().optional(),
});

export const deviceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, 'Identificador de dispositivo no válido');

export const positionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).optional(),
});

/** Valores por defecto listos para usar en el cliente. */
export const defaultAlarmConfig = (): AlarmConfig => alarmConfigSchema.parse({});
export const defaultSettings = (): Settings => settingsSchema.parse({});
