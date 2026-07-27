import { describe, expect, it } from 'vitest';
import { detectTrigger, evaluateAlarm, thresholdFor, type EvaluateInput } from '../src/alarm/engine.js';
import type { AlarmStateRow } from '../src/db.js';
import type { EchoHit, LocationAnalysis } from '../src/radar/analysis.js';
import { alarmConfigSchema, type AlarmConfig } from '../src/schema.js';

const NOW = Date.UTC(2025, 6, 15, 14, 0); // martes, 14:00 UTC

function hit(overrides: Partial<EchoHit> = {}): EchoHit {
  return {
    distanceKm: 12,
    bearingDeg: 270,
    compass: 'O',
    dbz: 30,
    mmPerHour: 2.7,
    intensity: 'Lluvia moderada',
    kind: 'rain',
    position: { lat: 41.4, lon: 2.0 },
    ...overrides,
  };
}

function analysis(overrides: Partial<LocationAnalysis> = {}): LocationAnalysis {
  return {
    center: { lat: 41.39, lon: 2.17 },
    observedAt: NOW - 5 * 60_000,
    ageMinutes: 5,
    radiusKm: 20,
    thresholdDbz: 20,
    radarCoverage: true,
    fieldCoverage: 0.1,
    overhead: null,
    nearest: null,
    strongest: null,
    cellsAboveThreshold: 0,
    areaCoveragePct: 0,
    motion: null,
    etaMinutes: null,
    etaRadiusMinutes: null,
    clearingMinutes: null,
    timeline: [],
    ...overrides,
  };
}

function state(overrides: Partial<AlarmStateRow> = {}): AlarmStateRow {
  return {
    location_id: 1,
    active: 0,
    active_kind: null,
    last_fired_at: null,
    last_cleared_at: null,
    snoozed_until: null,
    last_checked_at: null,
    last_error: null,
    ...overrides,
  };
}

function config(overrides: Partial<AlarmConfig> = {}): AlarmConfig {
  return alarmConfigSchema.parse(overrides);
}

function input(overrides: Partial<EvaluateInput> = {}): EvaluateInput {
  return {
    now: NOW,
    config: config(),
    analysis: analysis(),
    state: state(),
    locationName: 'Casa',
    timezone: 'UTC',
    language: 'es',
    units: { distance: 'km', speed: 'kmh', precipitation: 'mm' },
    ...overrides,
  };
}

describe('thresholdFor', () => {
  it('traduce la sensibilidad a un umbral en dBZ', () => {
    expect(thresholdFor(config({ intensity: 'drizzle' }))).toBe(12);
    expect(thresholdFor(config({ intensity: 'light' }))).toBe(20);
    expect(thresholdFor(config({ intensity: 'violent' }))).toBe(50);
  });
});

describe('detectTrigger', () => {
  it('en modo `overhead` sólo dispara con precipitación encima', () => {
    const cfg = config({ mode: 'overhead' });
    expect(detectTrigger(cfg, analysis({ nearest: hit() }))).toBeNull();
    const trigger = detectTrigger(cfg, analysis({ overhead: hit({ distanceKm: 0 }) }));
    expect(trigger?.kind).toBe('overhead');
  });

  it('en modo `inRadius` basta con un eco dentro del radio', () => {
    const trigger = detectTrigger(config({ mode: 'inRadius' }), analysis({ nearest: hit() }));
    expect(trigger?.kind).toBe('nearby');
  });

  it('la precipitación encima tiene prioridad sobre el modo elegido', () => {
    const trigger = detectTrigger(
      config({ mode: 'approaching' }),
      analysis({ overhead: hit({ distanceKm: 0 }) }),
    );
    expect(trigger?.kind).toBe('overhead');
  });

  it('en modo `approaching` exige movimiento y llegada dentro de la antelación', () => {
    const cfg = config({ mode: 'approaching', leadMinutes: 30, minSpeedKmh: 5 });
    const moving = {
      east: 30,
      north: 0,
      speedKmh: 30,
      bearingDeg: 90,
      confidence: 0.8,
      samples: 500,
    };

    // Sin movimiento estimado no hay aviso.
    expect(detectTrigger(cfg, analysis({ nearest: hit(), etaMinutes: 10 }))).toBeNull();

    // Sistema demasiado lento.
    expect(
      detectTrigger(
        cfg,
        analysis({ nearest: hit(), etaMinutes: 10, motion: { ...moving, speedKmh: 2 } }),
      ),
    ).toBeNull();

    // Llega demasiado tarde.
    expect(
      detectTrigger(cfg, analysis({ nearest: hit(), etaMinutes: 90, motion: moving })),
    ).toBeNull();

    const trigger = detectTrigger(
      cfg,
      analysis({ nearest: hit(), etaMinutes: 15, motion: moving }),
    );
    expect(trigger?.kind).toBe('approaching');
    expect(trigger?.etaMinutes).toBe(15);
  });
});

describe('evaluateAlarm', () => {
  it('no hace nada con la alarma desactivada', () => {
    const outcome = evaluateAlarm(
      input({ config: config({ enabled: false }), analysis: analysis({ overhead: hit() }) }),
    );
    expect(outcome.action).toBe('none');
  });

  it('avisa la primera vez que se cumple la condición', () => {
    const outcome = evaluateAlarm(input({ analysis: analysis({ nearest: hit() }) }));
    expect(outcome.action).toBe('fire');
    if (outcome.action !== 'fire') throw new Error('esperaba un aviso');
    expect(outcome.notification.title).toContain('Casa');
    expect(outcome.notification.body).toContain('12 km');
    expect(outcome.state.active).toBe(1);
    expect(outcome.state.last_fired_at).toBe(NOW);
  });

  it('no repite el aviso mientras dura la misma situación', () => {
    const outcome = evaluateAlarm(
      input({
        analysis: analysis({ nearest: hit() }),
        state: state({ active: 1, active_kind: 'nearby', last_fired_at: NOW - 5 * 60_000 }),
      }),
    );
    expect(outcome.action).toBe('none');
  });

  it('repite si se ha configurado y ha pasado el intervalo', () => {
    const cfg = config({ repeat: true, repeatMinutes: 20 });
    const early = evaluateAlarm(
      input({
        config: cfg,
        analysis: analysis({ nearest: hit() }),
        state: state({ active: 1, last_fired_at: NOW - 10 * 60_000 }),
      }),
    );
    expect(early.action).toBe('none');

    const late = evaluateAlarm(
      input({
        config: cfg,
        analysis: analysis({ nearest: hit() }),
        state: state({ active: 1, last_fired_at: NOW - 25 * 60_000 }),
      }),
    );
    expect(late.action).toBe('fire');
  });

  it('respeta el intervalo mínimo entre situaciones distintas', () => {
    const outcome = evaluateAlarm(
      input({
        config: config({ minIntervalMinutes: 60 }),
        analysis: analysis({ nearest: hit() }),
        state: state({ active: 0, last_fired_at: NOW - 20 * 60_000 }),
      }),
    );
    expect(outcome.action).toBe('suppress');
    expect(outcome.reason).toContain('intervalo');
    // La situación queda registrada como activa para no avisar en cadena.
    expect(outcome.state.active).toBe(1);
  });

  it('silencia durante las horas de silencio y absorbe el episodio', () => {
    const cfg = config({ quietHours: { enabled: true, from: '13:00', to: '15:00', days: [] } });
    const outcome = evaluateAlarm(input({ config: cfg, analysis: analysis({ nearest: hit() }) }));
    expect(outcome.action).toBe('suppress');
    expect(outcome.state.active).toBe(1);
  });

  it('no evalúa fuera de la franja de vigilancia', () => {
    const cfg = config({ schedule: { enabled: true, from: '07:00', to: '09:00', days: [] } });
    const outcome = evaluateAlarm(input({ config: cfg, analysis: analysis({ overhead: hit() }) }));
    expect(outcome.action).toBe('none');
    expect(outcome.state.active).toBe(0);
  });

  it('mantiene la situación viva pero callada mientras está pospuesta', () => {
    const outcome = evaluateAlarm(
      input({
        analysis: analysis({ nearest: hit() }),
        state: state({ snoozed_until: NOW + 10 * 60_000 }),
      }),
    );
    expect(outcome.action).toBe('suppress');
    expect(outcome.reason).toContain('pospuesta');
    expect(outcome.state.active).toBe(1);
  });

  it('vuelve a avisar cuando el aplazamiento ha vencido', () => {
    const outcome = evaluateAlarm(
      input({
        analysis: analysis({ nearest: hit() }),
        state: state({ snoozed_until: NOW - 60_000 }),
      }),
    );
    expect(outcome.action).toBe('fire');
  });

  it('cierra la situación al desaparecer la precipitación', () => {
    const outcome = evaluateAlarm(
      input({ state: state({ active: 1, active_kind: 'nearby', last_fired_at: NOW - 60_000 }) }),
    );
    expect(outcome.action).toBe('none');
    expect(outcome.state.active).toBe(0);
    expect(outcome.state.last_cleared_at).toBe(NOW);
  });

  it('avisa de que ha escampado si está configurado', () => {
    const outcome = evaluateAlarm(
      input({
        config: config({ notifyOnClear: true }),
        state: state({ active: 1, active_kind: 'overhead', last_fired_at: NOW - 60_000 }),
      }),
    );
    expect(outcome.action).toBe('fire');
    if (outcome.action !== 'fire') throw new Error('esperaba un aviso');
    expect(outcome.notification.kind).toBe('clear');
    expect(outcome.state.active).toBe(0);
  });

  it('no avisa de que ha escampado durante las horas de silencio', () => {
    const outcome = evaluateAlarm(
      input({
        config: config({
          notifyOnClear: true,
          quietHours: { enabled: true, from: '13:00', to: '15:00', days: [] },
        }),
        state: state({ active: 1, last_fired_at: NOW - 60_000 }),
      }),
    );
    expect(outcome.action).toBe('none');
    expect(outcome.state.active).toBe(0);
  });

  it('distingue la nieve en el texto del aviso', () => {
    const outcome = evaluateAlarm(
      input({
        config: config({ detectSnow: true }),
        analysis: analysis({ overhead: hit({ kind: 'snow', distanceKm: 0 }) }),
      }),
    );
    if (outcome.action !== 'fire') throw new Error('esperaba un aviso');
    expect(outcome.notification.title).toContain('nevando');
  });

  it('genera el aviso en el idioma configurado', () => {
    const outcome = evaluateAlarm(
      input({ language: 'en', analysis: analysis({ nearest: hit() }) }),
    );
    if (outcome.action !== 'fire') throw new Error('esperaba un aviso');
    expect(outcome.notification.title).toBe('Rain near Casa');
  });

  it('aplica las unidades del usuario al cuerpo del aviso', () => {
    const outcome = evaluateAlarm(
      input({
        analysis: analysis({ nearest: hit({ distanceKm: 16.09 }) }),
        units: { distance: 'mi', speed: 'mph', precipitation: 'in' },
      }),
    );
    if (outcome.action !== 'fire') throw new Error('esperaba un aviso');
    expect(outcome.notification.body).toContain('mi');
  });

  it('incluye el tiempo de llegada en los avisos por acercamiento', () => {
    const outcome = evaluateAlarm(
      input({
        config: config({ mode: 'approaching', leadMinutes: 45 }),
        analysis: analysis({
          nearest: hit({ distanceKm: 25 }),
          etaMinutes: 20,
          motion: { east: 40, north: 0, speedKmh: 40, bearingDeg: 90, confidence: 0.7, samples: 800 },
        }),
      }),
    );
    if (outcome.action !== 'fire') throw new Error('esperaba un aviso');
    expect(outcome.notification.kind).toBe('approaching');
    expect(outcome.notification.body).toContain('20 min');
    expect(outcome.notification.payload['etaMinutes']).toBe(20);
  });
});
