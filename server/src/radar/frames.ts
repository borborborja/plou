import { config } from '../config.js';

export interface RadarFrame {
  /** Instante del fotograma (epoch en segundos). */
  time: number;
  /** Ruta base de las teselas de ese fotograma. */
  path: string;
  /** `past` = observación; `nowcast` = extrapolación del proveedor. */
  kind: 'past' | 'nowcast';
}

export interface RadarIndex {
  /** Base de URL de las teselas. */
  host: string;
  generated: number;
  past: RadarFrame[];
  nowcast: RadarFrame[];
  infrared: RadarFrame[];
}

interface RawFrame {
  time?: number;
  path?: string;
}

interface RawIndex {
  host?: string;
  generated?: number;
  radar?: { past?: RawFrame[]; nowcast?: RawFrame[] };
  satellite?: { infrared?: RawFrame[] };
}

function mapFrames(raw: RawFrame[] | undefined, kind: RadarFrame['kind']): RadarFrame[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Required<RawFrame> => typeof f.time === 'number' && typeof f.path === 'string')
    .map((f) => ({ time: f.time, path: f.path, kind }))
    .sort((a, b) => a.time - b.time);
}

let cached: { index: RadarIndex; fetchedAt: number } | null = null;
let inFlight: Promise<RadarIndex> | null = null;

async function load(): Promise<RadarIndex> {
  const res = await fetch(config.radar.indexUrl, {
    headers: { 'user-agent': config.userAgent, accept: 'application/json' },
    signal: AbortSignal.timeout(config.radar.tileTimeoutMs),
  });
  if (!res.ok) throw new Error(`Índice de radar: HTTP ${res.status}`);
  const raw = (await res.json()) as RawIndex;
  if (!raw.host) throw new Error('Índice de radar sin campo `host`');

  const index: RadarIndex = {
    host: raw.host.replace(/\/$/, ''),
    generated: raw.generated ?? Math.floor(Date.now() / 1000),
    past: mapFrames(raw.radar?.past, 'past'),
    nowcast: mapFrames(raw.radar?.nowcast, 'nowcast'),
    infrared: mapFrames(raw.satellite?.infrared, 'past'),
  };
  if (index.past.length === 0) throw new Error('Índice de radar sin fotogramas');
  cached = { index, fetchedAt: Date.now() };
  return index;
}

/** Índice de fotogramas, cacheado durante `radar.indexTtlSeconds`. */
export async function getRadarIndex(force = false): Promise<RadarIndex> {
  const ttl = config.radar.indexTtlSeconds * 1000;
  if (!force && cached && Date.now() - cached.fetchedAt < ttl) return cached.index;
  if (inFlight) return inFlight;
  inFlight = load().finally(() => {
    inFlight = null;
  });
  try {
    return await inFlight;
  } catch (err) {
    // Ante un fallo puntual se sirve el último índice conocido si aún es usable.
    if (cached) return cached.index;
    throw err;
  }
}

/** Todos los fotogramas en orden cronológico (observación + extrapolación). */
export function allFrames(index: RadarIndex): RadarFrame[] {
  return [...index.past, ...index.nowcast];
}

/** Fotograma observado más reciente. */
export function latestPast(index: RadarIndex): RadarFrame | undefined {
  return index.past.at(-1);
}

/**
 * Construye la URL de una tesela.
 *
 * Formato: `{host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png`
 */
export function tileUrl(
  index: RadarIndex,
  frame: RadarFrame,
  opts: { z: number; x: number; y: number; size?: number; color?: number; smooth?: boolean; snow?: boolean },
): string {
  const size = opts.size ?? config.radar.tileSize;
  const color = opts.color ?? 2;
  const smooth = opts.smooth ? 1 : 0;
  const snow = opts.snow ? 1 : 0;
  return `${index.host}${frame.path}/${size}/${opts.z}/${opts.x}/${opts.y}/${color}/${smooth}_${snow}.png`;
}

/**
 * Plantilla de URL con los marcadores `{z}/{x}/{y}` que espera un mapa de
 * teselas, para que el cliente no tenga que conocer el formato del proveedor.
 */
export function tileUrlTemplate(
  index: RadarIndex,
  frame: RadarFrame,
  opts: { size?: number; color?: number; smooth?: boolean; snow?: boolean } = {},
): string {
  const size = opts.size ?? config.radar.tileSize;
  const color = opts.color ?? 2;
  const smooth = opts.smooth ? 1 : 0;
  const snow = opts.snow ? 1 : 0;
  return `${index.host}${frame.path}/${size}/{z}/{x}/{y}/${color}/${smooth}_${snow}.png`;
}

/** Plantilla equivalente para la capa de cobertura. */
export function coverageTileUrlTemplate(index: RadarIndex, size?: number): string {
  const s = size ?? config.radar.tileSize;
  return `${index.host}/v2/coverage/0/${s}/{z}/{x}/{y}/0/0_0.png`;
}

/** URL de la capa de cobertura de radar (dónde hay datos disponibles). */
export function coverageTileUrl(
  index: RadarIndex,
  opts: { z: number; x: number; y: number; size?: number },
): string {
  const size = opts.size ?? config.radar.tileSize;
  return `${index.host}/v2/coverage/0/${size}/${opts.z}/${opts.x}/${opts.y}/0/0_0.png`;
}

/** Utilidad de test: vacía la caché del índice. */
export function resetRadarIndexCache(): void {
  cached = null;
  inFlight = null;
}
