import { PNG } from 'pngjs';
import { config } from '../config.js';
import { ANALYSIS_SCHEME, DBZ_MIN, decodePixel, type ColorSchemeKey } from './colorTable.js';

/**
 * Tesela de radar ya decodificada: para cada píxel, la reflectividad y el tipo
 * de precipitación. Es la representación con la que trabaja todo el análisis.
 */
export interface DecodedTile {
  size: number;
  /** dBZ por píxel; `DBZ_MIN - 1` significa "sin eco". */
  dbz: Int16Array;
  /** 0 = sin eco, 1 = lluvia, 2 = nieve. */
  kind: Uint8Array;
  /** `true` si la tesela no existe o está totalmente vacía. */
  empty: boolean;
}

export const NO_ECHO = DBZ_MIN - 1;

function emptyTile(size: number): DecodedTile {
  const dbz = new Int16Array(size * size).fill(NO_ECHO);
  return { size, dbz, kind: new Uint8Array(size * size), empty: true };
}

function decodePng(buf: Buffer, scheme: ColorSchemeKey): DecodedTile {
  const png = PNG.sync.read(buf);
  const size = png.width;
  if (png.width !== png.height) {
    throw new Error(`Tesela no cuadrada: ${png.width}x${png.height}`);
  }
  const n = size * size;
  const dbz = new Int16Array(n).fill(NO_ECHO);
  const kind = new Uint8Array(n);
  let empty = true;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = png.data[o + 3] ?? 0;
    if (a === 0) continue;
    const px = decodePixel(
      png.data[o] ?? 0,
      png.data[o + 1] ?? 0,
      png.data[o + 2] ?? 0,
      a,
      scheme,
    );
    if (!px) continue;
    dbz[i] = px.dbz;
    kind[i] = px.kind === 'snow' ? 2 : 1;
    empty = false;
  }
  return { size, dbz, kind, empty };
}

interface CacheEntry {
  promise: Promise<DecodedTile>;
  /** Momento en que se resolvió, para poder purgar por antigüedad. */
  at: number;
}

const cache = new Map<string, CacheEntry>();

function touch(key: string, entry: CacheEntry): void {
  cache.delete(key);
  cache.set(key, entry);
}

function evict(): void {
  while (cache.size > config.radar.tileCacheSize) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

async function fetchAndDecode(url: string, scheme: ColorSchemeKey, size: number): Promise<DecodedTile> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': config.userAgent, accept: 'image/png' },
      signal: AbortSignal.timeout(config.radar.tileTimeoutMs),
    });
  } catch (err) {
    throw new Error(`Descarga de tesela fallida (${url}): ${(err as Error).message}`);
  }
  if (res.status === 404 || res.status === 204) return emptyTile(size);
  if (!res.ok) throw new Error(`Tesela ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return emptyTile(size);
  return decodePng(buf, scheme);
}

/**
 * Descarga y decodifica una tesela, con caché en memoria. Las peticiones
 * concurrentes de la misma tesela comparten una única descarga.
 */
export function getTile(
  url: string,
  opts: { scheme?: ColorSchemeKey; size?: number } = {},
): Promise<DecodedTile> {
  const scheme = opts.scheme ?? ANALYSIS_SCHEME;
  const size = opts.size ?? config.radar.tileSize;
  const key = `${scheme}|${url}`;
  const hit = cache.get(key);
  if (hit) {
    touch(key, hit);
    return hit.promise;
  }
  const entry: CacheEntry = {
    at: Date.now(),
    promise: fetchAndDecode(url, scheme, size).catch((err) => {
      cache.delete(key); // los errores no se cachean
      throw err;
    }),
  };
  cache.set(key, entry);
  evict();
  return entry.promise;
}

/**
 * Máscara de opacidad de una tesela, usada para capas que no siguen la paleta
 * de reflectividad (p. ej. la de cobertura de radar).
 */
export interface AlphaTile {
  size: number;
  alpha: Uint8Array;
}

const alphaCache = new Map<string, Promise<AlphaTile>>();

export function getAlphaTile(url: string, size = config.radar.tileSize): Promise<AlphaTile> {
  const hit = alphaCache.get(url);
  if (hit) return hit;
  const promise = (async (): Promise<AlphaTile> => {
    const res = await fetch(url, {
      headers: { 'user-agent': config.userAgent, accept: 'image/png' },
      signal: AbortSignal.timeout(config.radar.tileTimeoutMs),
    });
    if (res.status === 404 || res.status === 204) {
      return { size, alpha: new Uint8Array(size * size) };
    }
    if (!res.ok) throw new Error(`Tesela ${url}: HTTP ${res.status}`);
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    const alpha = new Uint8Array(png.width * png.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = png.data[i * 4 + 3] ?? 0;
    return { size: png.width, alpha };
  })().catch((err) => {
    alphaCache.delete(url);
    throw err;
  });
  alphaCache.set(url, promise);
  while (alphaCache.size > 64) {
    const oldest = alphaCache.keys().next();
    if (oldest.done) break;
    alphaCache.delete(oldest.value);
  }
  return promise;
}

export function tileCacheStats(): { size: number; limit: number } {
  return { size: cache.size, limit: config.radar.tileCacheSize };
}

/** Elimina de la caché las teselas anteriores a `maxAgeMs`. */
export function pruneTileCache(maxAgeMs: number): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [key, entry] of cache) {
    if (entry.at < cutoff) {
      cache.delete(key);
      removed++;
    }
  }
  return removed;
}

export function clearTileCache(): void {
  cache.clear();
}

/** Expuesto para pruebas: decodifica un PNG en memoria sin pasar por la red. */
export const __testing = { decodePng, emptyTile };
