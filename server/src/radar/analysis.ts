import { bearingDeg, compassPoint, offsetKm, type LatLon } from '../util/geo.js';
import { INTENSITY_LEVELS, dbzToMmPerHour, intensityLabel } from './colorTable.js';
import { hasRadarCoverage } from './coverage.js';
import { buildField, cellOffsetKm, maxInDisc, type PrecipField } from './field.js';
import { getRadarIndex, latestPast, type RadarIndex } from './frames.js';
import { estimateMotionSeries, type MotionVector } from './motion.js';
import { NO_ECHO } from './tiles.js';

export interface EchoHit {
  /** Distancia al punto vigilado, en km. */
  distanceKm: number;
  /** Rumbo desde el punto vigilado hacia el eco, en grados. */
  bearingDeg: number;
  /** Punto cardinal equivalente. */
  compass: string;
  dbz: number;
  mmPerHour: number;
  intensity: string;
  kind: 'rain' | 'snow';
  position: LatLon;
}

export interface TimelinePoint {
  minutes: number;
  dbz: number;
  mmPerHour: number;
  kind: 'rain' | 'snow' | 'none';
}

export interface LocationAnalysis {
  center: LatLon;
  /** Instante del último fotograma observado (epoch ms). */
  observedAt: number;
  /** Antigüedad del dato de radar en minutos. */
  ageMinutes: number;
  radiusKm: number;
  thresholdDbz: number;
  /** ¿El punto queda dentro del área con cobertura de radar? `null` = desconocido. */
  radarCoverage: boolean | null;
  /** Fracción de la rejilla analizada con eco, útil para diagnóstico. */
  fieldCoverage: number;

  /** Precipitación justo sobre el punto (o muy cerca). */
  overhead: EchoHit | null;
  /** Eco más próximo dentro del radio vigilado que supera el umbral. */
  nearest: EchoHit | null;
  /** Eco más intenso dentro del radio vigilado. */
  strongest: EchoHit | null;
  /** Nº de celdas del radio con precipitación por encima del umbral. */
  cellsAboveThreshold: number;
  /** Porcentaje del área vigilada cubierta por precipitación. */
  areaCoveragePct: number;

  motion: MotionVector | null;
  /** Minutos hasta que la precipitación alcance el punto (extrapolación). */
  etaMinutes: number | null;
  /** Minutos hasta que la precipitación entre en el radio vigilado. */
  etaRadiusMinutes: number | null;
  /** Si ya está lloviendo, minutos estimados hasta que escampe. */
  clearingMinutes: number | null;
  /** Evolución esperada sobre el punto durante la ventana de previsión. */
  timeline: TimelinePoint[];
}

export interface AnalyzeOptions {
  radiusKm: number;
  thresholdDbz: number;
  /** Ventana de extrapolación en minutos. */
  lookaheadMinutes?: number;
  /** Considerar ecos de lluvia. */
  rain?: boolean;
  /** Considerar ecos de nieve. */
  snow?: boolean;
  /** Nº de fotogramas usados para estimar el movimiento. */
  motionFrames?: number;
  /** Consultar la capa de cobertura de radar (una tesela extra). */
  checkCoverage?: boolean;
  index?: RadarIndex;
}

const MOTION_CELL_KM = 4;
const DETAIL_CELL_KM = 1.5;
const MAX_FIELD_RADIUS_KM = 260;

function kindName(kind: number): 'rain' | 'snow' {
  return kind === 2 ? 'snow' : 'rain';
}

function hitFrom(
  center: LatLon,
  eastKm: number,
  northKm: number,
  dbz: number,
  kind: number,
): EchoHit {
  const position = offsetKm(center, eastKm, northKm);
  const distanceKm = Math.hypot(eastKm, northKm);
  const bearing = distanceKm < 1e-6 ? 0 : bearingDeg(center, position);
  return {
    distanceKm,
    bearingDeg: bearing,
    compass: compassPoint(bearing),
    dbz,
    mmPerHour: dbzToMmPerHour(dbz),
    intensity: intensityLabel(dbz),
    kind: kindName(kind),
    position,
  };
}

function kindAllowed(kind: number, rain: boolean, snow: boolean): boolean {
  if (kind === 2) return snow;
  if (kind === 1) return rain;
  return false;
}

/**
 * Analiza la situación de precipitación alrededor de un punto: qué hay ahora
 * dentro del radio vigilado, hacia dónde se mueve y cuándo llegará o escampará.
 */
export async function analyzeLocation(
  center: LatLon,
  options: AnalyzeOptions,
): Promise<LocationAnalysis> {
  const radiusKm = Math.max(1, Math.min(200, options.radiusKm));
  const thresholdDbz = options.thresholdDbz;
  const lookaheadMinutes = Math.max(5, Math.min(180, options.lookaheadMinutes ?? 90));
  const rain = options.rain ?? true;
  const snow = options.snow ?? true;
  const motionFrames = Math.max(2, Math.min(8, options.motionFrames ?? 4));

  const index = options.index ?? (await getRadarIndex());
  const frames = index.past.slice(-motionFrames);
  const current = latestPast(index);
  if (!current || frames.length === 0) {
    throw new Error('No hay fotogramas de radar disponibles');
  }

  // Rejilla gruesa multi-fotograma para estimar el desplazamiento del sistema.
  const motionRadius = Math.min(MAX_FIELD_RADIUS_KM, Math.max(60, radiusKm * 1.5));
  const motionFields: PrecipField[] = await Promise.all(
    frames.map((f) => buildField(index, f, center, { radiusKm: motionRadius, cellKm: MOTION_CELL_KM })),
  );
  const motion = estimateMotionSeries(motionFields);

  // Rejilla fina del fotograma actual, ampliada para cubrir la extrapolación.
  const advectionKm = motion ? (motion.speedKmh * lookaheadMinutes) / 60 : 0;
  const detailRadius = Math.min(MAX_FIELD_RADIUS_KM, radiusKm + Math.min(advectionKm, 180) + 5);
  const cellKm = Math.max(DETAIL_CELL_KM, detailRadius / 140);
  const field = await buildField(index, current, center, { radiusKm: detailRadius, cellKm });

  // Barrido del radio vigilado.
  let nearest: EchoHit | null = null;
  let strongest: EchoHit | null = null;
  let cellsAbove = 0;
  let cellsInRadius = 0;

  const rCells = Math.ceil(radiusKm / field.cellKm);
  for (let j = field.half - rCells; j <= field.half + rCells; j++) {
    if (j < 0 || j >= field.height) continue;
    for (let i = field.half - rCells; i <= field.half + rCells; i++) {
      if (i < 0 || i >= field.width) continue;
      const { east, north } = cellOffsetKm(field, i, j);
      const distance = Math.hypot(east, north);
      if (distance > radiusKm) continue;
      cellsInRadius++;
      const k = j * field.width + i;
      const dbz = field.dbz[k] ?? NO_ECHO;
      const kind = field.kind[k] ?? 0;
      if (dbz < thresholdDbz || !kindAllowed(kind, rain, snow)) continue;
      cellsAbove++;
      if (!nearest || distance < nearest.distanceKm) {
        nearest = hitFrom(center, east, north, dbz, kind);
      }
      if (!strongest || dbz > strongest.dbz) {
        strongest = hitFrom(center, east, north, dbz, kind);
      }
    }
  }

  // Precipitación sobre el punto: se admite una tolerancia de una celda.
  const overheadTolerance = Math.max(field.cellKm, 1.5);
  const overheadProbe = maxInDisc(field, 0, 0, overheadTolerance);
  const overhead =
    overheadProbe.dbz >= thresholdDbz && kindAllowed(overheadProbe.kind, rain, snow)
      ? hitFrom(center, 0, 0, overheadProbe.dbz, overheadProbe.kind)
      : null;

  // Extrapolación lagrangiana: el valor futuro en P es el valor actual en P - v·t.
  const timeline: TimelinePoint[] = [];
  let etaMinutes: number | null = null;
  let etaRadiusMinutes: number | null = null;
  let clearingMinutes: number | null = null;

  const stepMinutes = 5;
  if (motion && motion.speedKmh > 0.5) {
    for (let t = 0; t <= lookaheadMinutes; t += stepMinutes) {
      const hours = t / 60;
      const backEast = -motion.east * hours;
      const backNorth = -motion.north * hours;

      const atPoint = maxInDisc(field, backEast, backNorth, overheadTolerance);
      const allowedAtPoint = kindAllowed(atPoint.kind, rain, snow) ? atPoint.dbz : NO_ECHO;
      timeline.push({
        minutes: t,
        dbz: allowedAtPoint > NO_ECHO ? allowedAtPoint : 0,
        mmPerHour: allowedAtPoint > NO_ECHO ? dbzToMmPerHour(allowedAtPoint) : 0,
        kind: allowedAtPoint >= thresholdDbz ? kindName(atPoint.kind) : 'none',
      });

      if (etaMinutes === null && allowedAtPoint >= thresholdDbz) etaMinutes = t;
      if (etaRadiusMinutes === null) {
        const inRadius = maxInDisc(field, backEast, backNorth, radiusKm);
        if (inRadius.dbz >= thresholdDbz && kindAllowed(inRadius.kind, rain, snow)) {
          etaRadiusMinutes = t;
        }
      }
      if (overhead && clearingMinutes === null && t > 0 && allowedAtPoint < thresholdDbz) {
        clearingMinutes = t;
      }
    }
  } else {
    // Sin movimiento fiable se asume persistencia del campo actual.
    const probe = maxInDisc(field, 0, 0, overheadTolerance);
    const allowed = kindAllowed(probe.kind, rain, snow) ? probe.dbz : NO_ECHO;
    for (let t = 0; t <= lookaheadMinutes; t += stepMinutes) {
      timeline.push({
        minutes: t,
        dbz: allowed > NO_ECHO ? allowed : 0,
        mmPerHour: allowed > NO_ECHO ? dbzToMmPerHour(allowed) : 0,
        kind: allowed >= thresholdDbz ? kindName(probe.kind) : 'none',
      });
    }
    if (allowed >= thresholdDbz) etaMinutes = 0;
    if (nearest) etaRadiusMinutes = 0;
  }

  const observedAt = current.time * 1000;
  const radarCoverage = options.checkCoverage === false ? null : await hasRadarCoverage(index, center);

  return {
    center,
    observedAt,
    ageMinutes: (Date.now() - observedAt) / 60000,
    radiusKm,
    thresholdDbz,
    radarCoverage,
    fieldCoverage: field.coverage,
    overhead,
    nearest,
    strongest,
    cellsAboveThreshold: cellsAbove,
    areaCoveragePct: cellsInRadius > 0 ? (cellsAbove / cellsInRadius) * 100 : 0,
    motion,
    etaMinutes,
    etaRadiusMinutes,
    clearingMinutes,
    timeline,
  };
}

/** Nivel de intensidad configurable más cercano a un umbral en dBZ. */
export function levelForDbz(dbz: number): string {
  let key = INTENSITY_LEVELS[0]!.key as string;
  for (const level of INTENSITY_LEVELS) {
    if (dbz >= level.dbz) key = level.key;
  }
  return key;
}
