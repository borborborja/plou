import { config } from '../config.js';
import { latLonToGlobalPixel, metersPerPixel, offsetKm, type LatLon } from '../util/geo.js';
import { ANALYSIS_SCHEME, type ColorSchemeKey } from './colorTable.js';
import { tileUrl, type RadarFrame, type RadarIndex } from './frames.js';
import { NO_ECHO, getTile, type DecodedTile } from './tiles.js';

/**
 * Rejilla local de precipitación centrada en un punto, con celdas de tamaño fijo
 * en kilómetros. Trabajar en km (y no en píxeles Mercator) hace que las
 * velocidades y los tiempos de llegada sean directamente interpretables.
 *
 * El índice de la celda `(i, j)` es `j * width + i`, donde `i` crece hacia el
 * este y `j` hacia el norte. El centro está en `(half, half)`.
 */
export interface PrecipField {
  center: LatLon;
  time: number;
  frameKind: RadarFrame['kind'];
  cellKm: number;
  half: number;
  width: number;
  height: number;
  /** dBZ por celda; `NO_ECHO` si no hay eco. */
  dbz: Int16Array;
  /** 0 = sin eco, 1 = lluvia, 2 = nieve. */
  kind: Uint8Array;
  /** Fracción de celdas con eco, útil para descartar rejillas vacías. */
  coverage: number;
  /**
   * Fracción de las teselas necesarias que llegaron a descargarse. Una tesela
   * que falla no se distingue de una sin lluvia, así que sin este dato una
   * caída de red parece buen tiempo.
   */
  dataCoverage: number;
}

export interface BuildFieldOptions {
  /** Radio cubierto por la rejilla, en km. */
  radiusKm: number;
  /** Tamaño de celda en km. */
  cellKm?: number;
  scheme?: ColorSchemeKey;
  zoom?: number;
  tileSize?: number;
}

export const DEFAULT_CELL_KM = 1.5;

function idx(field: { width: number }, i: number, j: number): number {
  return j * field.width + i;
}

/**
 * Descarga las teselas necesarias y construye la rejilla local del fotograma.
 *
 * Cada celda toma el máximo de los píxeles de radar que cubre, de modo que
 * núcleos pequeños de precipitación no se pierden al submuestrear.
 */
export async function buildField(
  index: RadarIndex,
  frame: RadarFrame,
  center: LatLon,
  options: BuildFieldOptions,
): Promise<PrecipField> {
  const cellKm = options.cellKm ?? DEFAULT_CELL_KM;
  const zoom = options.zoom ?? config.radar.analysisZoom;
  const tileSize = options.tileSize ?? config.radar.tileSize;
  const scheme = options.scheme ?? ANALYSIS_SCHEME;

  const half = Math.max(1, Math.ceil(options.radiusKm / cellKm));
  const width = half * 2 + 1;
  const height = width;

  const field: PrecipField = {
    center,
    time: frame.time,
    frameKind: frame.kind,
    cellKm,
    half,
    width,
    height,
    dbz: new Int16Array(width * height).fill(NO_ECHO),
    kind: new Uint8Array(width * height),
    coverage: 0,
    dataCoverage: 1,
  };

  // Huella en píxeles de una celda: se muestrea un bloque para tomar el máximo.
  const mpp = metersPerPixel(center.lat, zoom, tileSize);
  const footprint = Math.max(1, Math.min(8, Math.round((cellKm * 1000) / mpp)));
  const fpOffset = (footprint - 1) / 2;

  // Precalcula las coordenadas de píxel global de cada celda.
  const scale = tileSize * 2 ** zoom;
  const px = new Float64Array(width * height);
  const py = new Float64Array(width * height);
  const tilesNeeded = new Map<string, { tx: number; ty: number }>();

  for (let j = 0; j < height; j++) {
    const northKm = (j - half) * cellKm;
    for (let i = 0; i < width; i++) {
      const eastKm = (i - half) * cellKm;
      const p = latLonToGlobalPixel(offsetKm(center, eastKm, northKm), zoom, tileSize);
      const k = idx(field, i, j);
      px[k] = p.x;
      py[k] = p.y;
      // Todas las teselas tocadas por la huella de la celda.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const gx = p.x + dx * fpOffset;
          const gy = p.y + dy * fpOffset;
          if (gy < 0 || gy >= scale) continue;
          const tx = ((Math.floor(gx / tileSize) % 2 ** zoom) + 2 ** zoom) % 2 ** zoom;
          const ty = Math.floor(gy / tileSize);
          tilesNeeded.set(`${tx}/${ty}`, { tx, ty });
        }
      }
    }
  }

  const tiles = new Map<string, DecodedTile | null>();
  await Promise.all(
    [...tilesNeeded].map(async ([key, { tx, ty }]) => {
      const url = tileUrl(index, frame, {
        z: zoom,
        x: tx,
        y: ty,
        size: tileSize,
        color: 2,
        // Sin suavizado: los colores deben coincidir exactamente con la paleta.
        smooth: false,
        // Con nieve visible para poder clasificar el tipo de precipitación.
        snow: true,
      });
      try {
        tiles.set(key, await getTile(url, { scheme, size: tileSize }));
      } catch {
        tiles.set(key, null); // tesela no disponible: se trata como sin datos
      }
    }),
  );

  const nTiles = 2 ** zoom;
  let echoes = 0;

  for (let k = 0; k < px.length; k++) {
    let bestDbz = NO_ECHO;
    let bestKind = 0;
    for (let dy = 0; dy < footprint; dy++) {
      const gy = py[k]! - fpOffset + dy;
      if (gy < 0 || gy >= scale) continue;
      const ty = Math.floor(gy / tileSize);
      const iy = Math.floor(gy) - ty * tileSize;
      for (let dx = 0; dx < footprint; dx++) {
        const gxRaw = px[k]! - fpOffset + dx;
        const gx = ((gxRaw % scale) + scale) % scale;
        const tx = ((Math.floor(gx / tileSize) % nTiles) + nTiles) % nTiles;
        const tile = tiles.get(`${tx}/${ty}`);
        if (!tile) continue;
        const ix = Math.floor(gx) - Math.floor(gx / tileSize) * tileSize;
        const v = tile.dbz[iy * tile.size + ix];
        if (v !== undefined && v > bestDbz) {
          bestDbz = v;
          bestKind = tile.kind[iy * tile.size + ix] ?? 0;
        }
      }
    }
    field.dbz[k] = bestDbz;
    field.kind[k] = bestKind;
    if (bestDbz > NO_ECHO) echoes++;
  }

  field.coverage = echoes / field.dbz.length;
  const llegadas = [...tiles.values()].filter((t) => t !== null).length;
  field.dataCoverage = tiles.size === 0 ? 1 : llegadas / tiles.size;
  return field;
}

/** dBZ de la celda que contiene el desplazamiento indicado (km este/norte). */
export function valueAt(field: PrecipField, eastKm: number, northKm: number): number {
  const i = Math.round(eastKm / field.cellKm) + field.half;
  const j = Math.round(northKm / field.cellKm) + field.half;
  if (i < 0 || i >= field.width || j < 0 || j >= field.height) return NO_ECHO;
  return field.dbz[j * field.width + i] ?? NO_ECHO;
}

export function kindAt(field: PrecipField, eastKm: number, northKm: number): number {
  const i = Math.round(eastKm / field.cellKm) + field.half;
  const j = Math.round(northKm / field.cellKm) + field.half;
  if (i < 0 || i >= field.width || j < 0 || j >= field.height) return 0;
  return field.kind[j * field.width + i] ?? 0;
}

/**
 * Máximo de reflectividad en un disco de radio `radiusKm` alrededor de un
 * desplazamiento dado. Se usa para tolerar pequeños errores de posición.
 */
export function maxInDisc(
  field: PrecipField,
  eastKm: number,
  northKm: number,
  radiusKm: number,
): { dbz: number; kind: number } {
  const r = Math.max(0, Math.ceil(radiusKm / field.cellKm));
  const ci = Math.round(eastKm / field.cellKm) + field.half;
  const cj = Math.round(northKm / field.cellKm) + field.half;
  let bestDbz = NO_ECHO;
  let bestKind = 0;
  for (let j = cj - r; j <= cj + r; j++) {
    if (j < 0 || j >= field.height) continue;
    for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || i >= field.width) continue;
      const di = i - ci;
      const dj = j - cj;
      if (di * di + dj * dj > r * r) continue;
      const k = j * field.width + i;
      const v = field.dbz[k] ?? NO_ECHO;
      if (v > bestDbz) {
        bestDbz = v;
        bestKind = field.kind[k] ?? 0;
      }
    }
  }
  return { dbz: bestDbz, kind: bestKind };
}

/** Desplazamiento en km (este, norte) del centro de la celda `(i, j)`. */
export function cellOffsetKm(field: PrecipField, i: number, j: number): { east: number; north: number } {
  return { east: (i - field.half) * field.cellKm, north: (j - field.half) * field.cellKm };
}
