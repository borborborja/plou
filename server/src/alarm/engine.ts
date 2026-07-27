import type { AlarmStateRow } from '../db.js';
import { strings, type Lang } from '../i18n.js';
import type { EchoHit, LocationAnalysis } from '../radar/analysis.js';
import { INTENSITY_LEVELS } from '../radar/colorTable.js';
import type { AlarmConfig } from '../schema.js';
import { formatDistance, formatPrecipRate, formatSpeed, type DistanceUnit, type PrecipUnit, type SpeedUnit } from '../util/units.js';
import { isWithinWindow } from './window.js';

export type AlarmKind = 'overhead' | 'nearby' | 'approaching' | 'clear';

export interface AlarmNotification {
  kind: AlarmKind;
  title: string;
  body: string;
  /** Datos que acompañan a la notificación para que el cliente los muestre. */
  payload: Record<string, unknown>;
}

export type AlarmOutcome =
  | { action: 'none'; reason: string; state: AlarmStateRow }
  | { action: 'fire'; reason: string; state: AlarmStateRow; notification: AlarmNotification }
  | { action: 'suppress'; reason: string; state: AlarmStateRow };

export interface EvaluateInput {
  now: number;
  config: AlarmConfig;
  analysis: LocationAnalysis;
  state: AlarmStateRow;
  locationName: string;
  timezone: string;
  language: Lang;
  units: { distance: DistanceUnit; speed: SpeedUnit; precipitation: PrecipUnit };
}

export function thresholdFor(config: AlarmConfig): number {
  const level = INTENSITY_LEVELS.find((l) => l.key === config.intensity);
  return level?.dbz ?? 20;
}

/** Detección que ha satisfecho la condición de alarma. */
interface Trigger {
  kind: Exclude<AlarmKind, 'clear'>;
  hit: EchoHit;
  etaMinutes: number | null;
}

/**
 * ¿La situación observada cumple la condición configurada?
 *
 * `overhead` gana siempre: si ya está precipitando encima, ese es el aviso
 * relevante sea cual sea el modo elegido.
 */
export function detectTrigger(config: AlarmConfig, analysis: LocationAnalysis): Trigger | null {
  if (analysis.overhead) {
    return { kind: 'overhead', hit: analysis.overhead, etaMinutes: 0 };
  }

  if (config.mode === 'overhead') return null;

  if (config.mode === 'inRadius') {
    if (analysis.nearest) return { kind: 'nearby', hit: analysis.nearest, etaMinutes: analysis.etaMinutes };
    return null;
  }

  // Modo `approaching`: hace falta un desplazamiento fiable y un tiempo de
  // llegada dentro de la antelación configurada.
  const motion = analysis.motion;
  if (!motion || motion.speedKmh < config.minSpeedKmh) return null;
  if (analysis.etaMinutes === null || analysis.etaMinutes > config.leadMinutes) return null;
  const hit = analysis.nearest ?? analysis.strongest;
  if (!hit) return null;
  return { kind: 'approaching', hit, etaMinutes: analysis.etaMinutes };
}

function buildNotification(
  trigger: Trigger,
  input: EvaluateInput,
): AlarmNotification {
  const t = strings(input.language);
  const place = input.locationName;
  const isSnow = trigger.hit.kind === 'snow';
  const compass = t.compass[trigger.hit.compass] ?? trigger.hit.compass;
  const intensity = t.intensity[intensityKeyFor(trigger.hit.dbz)] ?? trigger.hit.intensity;

  let title: string;
  let body: string;

  if (trigger.kind === 'overhead') {
    title = isSnow ? t.snowOverhead(place) : t.rainOverhead(place);
    body = t.bodyOverhead(intensity, formatPrecipRate(trigger.hit.mmPerHour, input.units.precipitation));
  } else if (trigger.kind === 'approaching') {
    title = isSnow ? t.snowApproaching(place) : t.rainApproaching(place);
    body = t.bodyEta(Math.round(trigger.etaMinutes ?? 0), compass, intensity);
  } else {
    title = isSnow ? t.snowNear(place) : t.rainNear(place);
    body = t.bodyDistance(
      formatDistance(trigger.hit.distanceKm, input.units.distance),
      compass,
      intensity,
    );
  }

  const motion = input.analysis.motion;
  if (motion && motion.speedKmh >= 3 && trigger.kind !== 'overhead') {
    const motionCompass = compassKeyFor(motion.bearingDeg);
    body += ` · ${t.bodyMotion(formatSpeed(motion.speedKmh, input.units.speed), t.compass[motionCompass] ?? motionCompass)}`;
  }

  return {
    kind: trigger.kind,
    title,
    body,
    payload: {
      kind: trigger.kind,
      precipitation: trigger.hit.kind,
      dbz: trigger.hit.dbz,
      mmPerHour: Number(trigger.hit.mmPerHour.toFixed(2)),
      distanceKm: Number(trigger.hit.distanceKm.toFixed(1)),
      bearingDeg: Math.round(trigger.hit.bearingDeg),
      compass: trigger.hit.compass,
      etaMinutes: trigger.etaMinutes === null ? null : Math.round(trigger.etaMinutes),
      observedAt: input.analysis.observedAt,
      motion: motion
        ? {
            speedKmh: Number(motion.speedKmh.toFixed(1)),
            bearingDeg: Math.round(motion.bearingDeg),
            confidence: Number(motion.confidence.toFixed(2)),
          }
        : null,
    },
  };
}

const COMPASS_KEYS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSO',
  'SO',
  'OSO',
  'O',
  'ONO',
  'NO',
  'NNO',
] as const;

function compassKeyFor(deg: number): string {
  return COMPASS_KEYS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] ?? 'N';
}

function intensityKeyFor(dbz: number): string {
  let key = 'drizzle';
  for (const level of INTENSITY_LEVELS) {
    if (dbz >= level.dbz) key = level.key;
  }
  return key;
}

/**
 * Decide qué hacer con una ubicación a partir del análisis de radar y del
 * estado previo de su alarma. La función es pura: devuelve el nuevo estado y,
 * si procede, la notificación a enviar.
 */
export function evaluateAlarm(input: EvaluateInput): AlarmOutcome {
  const { now, config, analysis, locationName, timezone, language } = input;
  const state: AlarmStateRow = { ...input.state, last_checked_at: now, last_error: null };

  if (!config.enabled) {
    return { action: 'none', reason: 'alarma desactivada', state: { ...state, active: 0, active_kind: null } };
  }

  // Fuera de la franja de vigilancia no se evalúa nada.
  if (
    config.schedule.enabled &&
    !isWithinWindow(now, timezone, config.schedule.from, config.schedule.to, config.schedule.days)
  ) {
    return { action: 'none', reason: 'fuera de la franja de vigilancia', state: { ...state, active: 0, active_kind: null } };
  }

  const trigger = detectTrigger(config, analysis);

  // --- Sin condición: cerrar la situación activa, si la había ------------
  if (!trigger) {
    if (state.active === 1) {
      const cleared: AlarmStateRow = {
        ...state,
        active: 0,
        active_kind: null,
        last_cleared_at: now,
      };
      const quiet =
        config.quietHours.enabled &&
        isWithinWindow(now, timezone, config.quietHours.from, config.quietHours.to, config.quietHours.days);
      if (config.notifyOnClear && !quiet) {
        const t = strings(language);
        return {
          action: 'fire',
          reason: 'ha dejado de detectarse precipitación',
          state: { ...cleared, last_fired_at: now },
          notification: {
            kind: 'clear',
            title: t.cleared(locationName),
            body: t.clearedBody(locationName),
            payload: { kind: 'clear', observedAt: analysis.observedAt },
          },
        };
      }
      return { action: 'none', reason: 'situación cerrada', state: cleared };
    }
    return { action: 'none', reason: 'sin precipitación relevante', state };
  }

  // --- Hay condición ------------------------------------------------------
  const quiet =
    config.quietHours.enabled &&
    isWithinWindow(now, timezone, config.quietHours.from, config.quietHours.to, config.quietHours.days);

  if (state.snoozed_until !== null && state.snoozed_until > now) {
    // El aplazamiento silencia el aviso pero mantiene viva la situación.
    return {
      action: 'suppress',
      reason: 'alarma pospuesta',
      state: { ...state, active: 1, active_kind: trigger.kind },
    };
  }

  const alreadyActive = state.active === 1;

  /**
   * ¿Se ha llegado a avisar de *esta* situación?
   *
   * Un episodio que empieza dentro de las horas de silencio queda marcado como
   * activo sin que nadie haya sido avisado. Si eso contara como avisado, al
   * terminar la franja no se diría nunca —por mucho que siguiera lloviendo
   * encima—, porque el episodio ya no sería nuevo. Un aviso pertenece a la
   * situación en curso sólo si es posterior al último cierre.
   */
  const announced =
    state.last_fired_at !== null &&
    (state.last_cleared_at === null || state.last_fired_at > state.last_cleared_at);

  if (alreadyActive && announced) {
    if (!config.repeat) {
      return { action: 'none', reason: 'aviso ya emitido para esta situación', state: { ...state, active_kind: trigger.kind } };
    }
    const since = state.last_fired_at === null ? Number.POSITIVE_INFINITY : (now - state.last_fired_at) / 60000;
    if (since < config.repeatMinutes) {
      return { action: 'none', reason: 'esperando al siguiente recordatorio', state: { ...state, active_kind: trigger.kind } };
    }
    if (quiet) {
      return { action: 'suppress', reason: 'horas de silencio', state: { ...state, active_kind: trigger.kind } };
    }
    return {
      action: 'fire',
      reason: 'recordatorio de situación en curso',
      state: { ...state, active: 1, active_kind: trigger.kind, last_fired_at: now },
      notification: buildNotification(trigger, input),
    };
  }

  // Situación nueva.
  if (quiet) {
    // Se absorbe en silencio: al terminar la franja no salta un aviso tardío
    // por un episodio que empezó de madrugada.
    return {
      action: 'suppress',
      reason: 'horas de silencio',
      state: { ...state, active: 1, active_kind: trigger.kind },
    };
  }

  if (state.last_fired_at !== null) {
    const since = (now - state.last_fired_at) / 60000;
    if (since < config.minIntervalMinutes) {
      return {
        action: 'suppress',
        reason: 'intervalo mínimo entre avisos',
        state: { ...state, active: 1, active_kind: trigger.kind },
      };
    }
  }

  return {
    action: 'fire',
    reason: `condición cumplida (${trigger.kind})`,
    state: { ...state, active: 1, active_kind: trigger.kind, last_fired_at: now },
    notification: buildNotification(trigger, input),
  };
}
