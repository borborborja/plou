import {
  COLOR_SCHEMES,
  DBZ_MAX,
  DBZ_MIN,
  RAIN_RAMPS,
  SNOW_RAMPS,
  type ColorSchemeInfo,
  type ColorSchemeKey,
} from './colorTable.generated.js';

export { COLOR_SCHEMES, DBZ_MIN, DBZ_MAX };
export type { ColorSchemeKey, ColorSchemeInfo };

export type PrecipKind = 'rain' | 'snow';

export interface DecodedPixel {
  /** Reflectividad estimada en dBZ. */
  dbz: number;
  kind: PrecipKind;
}

const LEVELS = DBZ_MAX - DBZ_MIN + 1;

function packRgba(r: number, g: number, b: number, a: number): number {
  // >>> 0 para mantenerlo como entero sin signo de 32 bits.
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

interface SchemeDecoder {
  readonly key: ColorSchemeKey;
  /** Mapa exacto color -> nivel. Clave: RGBA empaquetado. */
  readonly exact: Map<number, DecodedPixel>;
  /** ¿Las rampas de lluvia y nieve son distinguibles entre sí? */
  readonly snowDistinguishable: boolean;
  /** Caché de vecinos más próximos para colores que no casan exactamente. */
  readonly nearest: Map<number, DecodedPixel | null>;
  readonly rain: Uint8Array;
  readonly snow: Uint8Array;
}

function buildDecoder(key: ColorSchemeKey): SchemeDecoder {
  const rain = RAIN_RAMPS[key];
  const snow = SNOW_RAMPS[key];
  const exact = new Map<number, DecodedPixel>();
  let collisions = 0;

  // Se recorre de menor a mayor dBZ y se conserva la primera aparición: ante
  // colores repetidos, el valor más bajo (criterio conservador para las alarmas).
  for (const [kind, ramp] of [
    ['rain', rain],
    ['snow', snow],
  ] as const) {
    for (let i = 0; i < LEVELS; i++) {
      const o = i * 4;
      const a = ramp[o + 3] ?? 0;
      if (a === 0) continue; // píxel transparente: ausencia de eco
      const packed = packRgba(ramp[o] ?? 0, ramp[o + 1] ?? 0, ramp[o + 2] ?? 0, a);
      const existing = exact.get(packed);
      if (existing) {
        if (existing.kind !== kind) collisions++;
        continue;
      }
      exact.set(packed, { dbz: DBZ_MIN + i, kind });
    }
  }

  return {
    key,
    exact,
    snowDistinguishable: collisions === 0,
    nearest: new Map(),
    rain,
    snow,
  };
}

const decoders = new Map<ColorSchemeKey, SchemeDecoder>();

function decoderFor(key: ColorSchemeKey): SchemeDecoder {
  let d = decoders.get(key);
  if (!d) {
    d = buildDecoder(key);
    decoders.set(key, d);
  }
  return d;
}

export function schemeById(id: number): ColorSchemeInfo | undefined {
  return COLOR_SCHEMES.find((s) => s.id === id);
}

export function schemeByKey(key: string): ColorSchemeInfo | undefined {
  return COLOR_SCHEMES.find((s) => s.key === key);
}

/** ¿Este esquema permite separar ecos de lluvia y de nieve por color? */
export function isSnowDistinguishable(key: ColorSchemeKey): boolean {
  return decoderFor(key).snowDistinguishable;
}

/**
 * Esquema empleado para el análisis. Es el único garantizado en el acceso
 * gratuito y además sus rampas de lluvia y nieve no se solapan, lo que permite
 * clasificar el tipo de precipitación a partir del color del píxel.
 */
export const ANALYSIS_SCHEME: ColorSchemeKey = 'universalBlue';

const MAX_NEAREST_DISTANCE_SQ = 3 * 40 * 40; // tolerancia por canal ~40/255

/**
 * Traduce un píxel RGBA de una tesela de radar a reflectividad y tipo de
 * precipitación. Devuelve `null` si no hay eco (o si el color queda demasiado
 * lejos de cualquier entrada de la paleta, p. ej. por interpolación agresiva).
 *
 * Las teselas de análisis se piden sin suavizado, de modo que la práctica
 * totalidad de los píxeles casa de forma exacta con la paleta.
 */
export function decodePixel(
  r: number,
  g: number,
  b: number,
  a: number,
  scheme: ColorSchemeKey = ANALYSIS_SCHEME,
): DecodedPixel | null {
  if (a === 0) return null;
  const d = decoderFor(scheme);
  const packed = packRgba(r, g, b, a);
  const hit = d.exact.get(packed);
  if (hit) return hit;

  const cached = d.nearest.get(packed);
  if (cached !== undefined) return cached;

  // Búsqueda del color más próximo ignorando el alfa (que el reescalado altera).
  let best: DecodedPixel | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [kind, ramp] of [
    ['rain', d.rain],
    ['snow', d.snow],
  ] as const) {
    for (let i = 0; i < LEVELS; i++) {
      const o = i * 4;
      if ((ramp[o + 3] ?? 0) === 0) continue;
      const dr = r - (ramp[o] ?? 0);
      const dg = g - (ramp[o + 1] ?? 0);
      const db = b - (ramp[o + 2] ?? 0);
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = { dbz: DBZ_MIN + i, kind };
      }
    }
  }
  const result = bestDist <= MAX_NEAREST_DISTANCE_SQ ? best : null;
  if (d.nearest.size < 8192) d.nearest.set(packed, result);
  return result;
}

/**
 * Intensidad de precipitación en mm/h a partir de la reflectividad, usando la
 * relación Marshall-Palmer Z = 200 R^1.6.
 */
export function dbzToMmPerHour(dbz: number): number {
  if (dbz <= DBZ_MIN) return 0;
  const z = 10 ** (dbz / 10);
  return (z / 200) ** (1 / 1.6);
}

/** Inversa de {@link dbzToMmPerHour}. */
export function mmPerHourToDbz(mmh: number): number {
  if (mmh <= 0) return DBZ_MIN;
  return 10 * Math.log10(200 * mmh ** 1.6);
}

export interface IntensityLevel {
  key: 'drizzle' | 'light' | 'moderate' | 'heavy' | 'violent';
  label: string;
  dbz: number;
}

/**
 * Umbrales de sensibilidad ofrecidos en la configuración de alarmas.
 * `dbz` es el mínimo de reflectividad que dispara ese nivel.
 */
export const INTENSITY_LEVELS: readonly IntensityLevel[] = [
  { key: 'drizzle', label: 'Llovizna', dbz: 12 },
  { key: 'light', label: 'Lluvia débil', dbz: 20 },
  { key: 'moderate', label: 'Lluvia moderada', dbz: 30 },
  { key: 'heavy', label: 'Lluvia fuerte', dbz: 40 },
  { key: 'violent', label: 'Tormenta', dbz: 50 },
];

export function intensityLabel(dbz: number): string {
  let label = 'Sin precipitación';
  for (const level of INTENSITY_LEVELS) {
    if (dbz >= level.dbz) label = level.label;
  }
  return label;
}

/** Color de la rampa para una reflectividad dada, en `#rrggbb`. */
function rampHex(ramp: Uint8Array, dbz: number): string | null {
  const i = Math.round(dbz) - DBZ_MIN;
  if (i < 0 || i >= LEVELS) return null;
  const o = i * 4;
  if ((ramp[o + 3] ?? 0) === 0) return null; // transparente: sin eco
  const hex = (v: number): string => v.toString(16).padStart(2, '0');
  return `#${hex(ramp[o] ?? 0)}${hex(ramp[o + 1] ?? 0)}${hex(ramp[o + 2] ?? 0)}`;
}

export interface LegendStop {
  dbz: number;
  mmPerHour: number;
  /** Color de lluvia de la paleta. */
  rain: string;
  /** Color de nieve, sólo si el esquema los distingue. */
  snow?: string;
  /** Etiqueta de intensidad, únicamente en los umbrales de las alarmas. */
  label?: string;
}

/** Reflectividades representadas en la leyenda del mapa. */
const LEGEND_DBZ = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65];

/**
 * Escalones de la leyenda para un esquema de color. Los colores se leen de la
 * misma rampa que usan las teselas, de modo que la leyenda siempre coincide con
 * lo que se ve en el mapa.
 */
export function legendFor(key: ColorSchemeKey): LegendStop[] {
  const decoder = decoderFor(key);
  const stops: LegendStop[] = [];
  for (const dbz of LEGEND_DBZ) {
    const rain = rampHex(decoder.rain, dbz);
    if (!rain) continue;
    const level = INTENSITY_LEVELS.find((l) => l.dbz === dbz);
    const snow = decoder.snowDistinguishable ? rampHex(decoder.snow, dbz) : null;
    stops.push({
      dbz,
      mmPerHour: Number(dbzToMmPerHour(dbz).toFixed(dbz < 30 ? 2 : 1)),
      rain,
      ...(snow ? { snow } : {}),
      ...(level ? { label: level.label } : {}),
    });
  }
  return stops;
}
