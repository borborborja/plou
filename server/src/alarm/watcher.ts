import { config } from '../config.js';
import {
  getAlarmState,
  getSettings,
  listMonitoredLocations,
  recordEvent,
  saveAlarmState,
  type Db,
  type Location,
} from '../db.js';
import { analyzeLocation } from '../radar/analysis.js';
import { getRadarIndex, latestPast } from '../radar/frames.js';
import { pruneTileCache } from '../radar/tiles.js';
import { sendToDevice } from '../push.js';
import { evaluateAlarm, thresholdFor } from './engine.js';

export interface WatchTickReport {
  startedAt: number;
  durationMs: number;
  checked: number;
  fired: number;
  suppressed: number;
  errors: number;
  skipped: number;
  frameTime: number | null;
}

let lastReport: WatchTickReport | null = null;
let running = false;
let timer: NodeJS.Timeout | null = null;

export function lastTickReport(): WatchTickReport | null {
  return lastReport;
}

/** Evalúa una única ubicación y envía el aviso si procede. */
/**
 * Cobertura mínima de teselas para fiarse de un «no pasa nada». No se exige el
 * 100 %: el borde de la rejilla queda lejos del punto vigilado y un fallo suelto
 * ahí no cambia la conclusión.
 */
const MIN_DATA_COVERAGE = 0.95;

export async function checkLocation(db: Db, location: Location): Promise<'fired' | 'suppressed' | 'none' | 'error'> {
  const settings = getSettings(db, location.deviceId);
  const state = getAlarmState(db, location.id);
  const now = Date.now();

  if (
    location.followDevice &&
    (location.positionUpdatedAt === null ||
      now - location.positionUpdatedAt > config.alarm.maxDevicePositionAgeMinutes * 60_000)
  ) {
    saveAlarmState(db, {
      ...state,
      last_checked_at: now,
      last_error: 'la posición del dispositivo es demasiado antigua; abre Plou para actualizarla',
    });
    return 'error';
  }

  try {
    const analysis = await analyzeLocation(
      { lat: location.lat, lon: location.lon },
      {
        radiusKm: location.alarm.radiusKm,
        thresholdDbz: thresholdFor(location.alarm),
        lookaheadMinutes: Math.max(30, location.alarm.leadMinutes + 15),
        rain: location.alarm.detectRain,
        snow: location.alarm.detectSnow,
        // La cobertura no cambia entre ciclos; se omite para ahorrar peticiones.
        checkCoverage: false,
      },
    );

    const outcome = evaluateAlarm({
      now,
      config: location.alarm,
      analysis,
      state,
      locationName: location.name,
      timezone: settings.timezone,
      language: settings.language,
      units: {
        distance: settings.units.distance,
        speed: settings.units.wind,
        precipitation: settings.units.precipitation,
      },
    });

    if (outcome.action !== 'fire') {
      // Una tesela que no llega es indistinguible de una sin lluvia, así que un
      // «no pasa nada» con datos incompletos no es una comprobación buena: puede
      // ser una caída de red disfrazada de buen tiempo. Al revés no aplica —
      // los datos que faltan pueden esconder lluvia, nunca inventarla—, por eso
      // un aviso sí se emite aunque la cobertura sea parcial.
      if (analysis.dataCoverage < MIN_DATA_COVERAGE) {
        saveAlarmState(db, {
          ...outcome.state,
          last_error: `datos de radar incompletos (${Math.round(analysis.dataCoverage * 100)}%)`,
        });
        return 'error';
      }
      saveAlarmState(db, outcome.state);
      return outcome.action === 'suppress' ? 'suppressed' : 'none';
    }

    const { notification } = outcome;
    const payload = {
      ...notification.payload,
      locationId: location.id,
      locationName: location.name,
      lat: location.lat,
      lon: location.lon,
    };

    const delivery = await sendToDevice(db, location.deviceId, {
      title: notification.title,
      body: notification.body,
      // Un tag por ubicación: los avisos sucesivos se reemplazan en la bandeja.
      tag: `plou-location-${location.id}`,
      requireInteraction: location.alarm.sound.loop,
      vibrate: location.alarm.sound.vibrate ? [300, 150, 300, 150, 600] : undefined,
      data: {
        ...payload,
        deviceId: location.deviceId,
        sound: location.alarm.sound,
        snoozeMinutes: location.alarm.snoozeMinutes,
      },
    });

    // Si había suscripciones y ninguna aceptó el aviso, no se da por emitido.
    // Marcarlo bloquearía el reintento por el intervalo mínimo y el episodio
    // entero se quedaría sin avisar por un fallo puntual de la red.
    if (delivery.sent === 0 && delivery.failed > 0) {
      saveAlarmState(db, {
        ...state,
        last_checked_at: now,
        last_error: `no se pudo entregar el aviso (${delivery.failed} fallidos)`,
      });
      return 'error';
    }

    saveAlarmState(db, outcome.state);
    recordEvent(db, {
      location_id: location.id,
      device_id: location.deviceId,
      fired_at: now,
      kind: notification.kind,
      title: notification.title,
      body: notification.body,
      payload_json: JSON.stringify(payload),
    });

    return 'fired';
  } catch (err) {
    saveAlarmState(db, {
      ...state,
      last_checked_at: now,
      last_error: (err as Error).message.slice(0, 300),
    });
    return 'error';
  }
}

/** Un ciclo completo de vigilancia sobre todas las ubicaciones con alarma. */
export async function runTick(db: Db): Promise<WatchTickReport> {
  const startedAt = Date.now();
  const report: WatchTickReport = {
    startedAt,
    durationMs: 0,
    checked: 0,
    fired: 0,
    suppressed: 0,
    errors: 0,
    skipped: 0,
    frameTime: null,
  };

  const locations = listMonitoredLocations(db);
  if (locations.length === 0) {
    report.durationMs = Date.now() - startedAt;
    lastReport = report;
    return report;
  }

  // Si el radar va muy retrasado no tiene sentido evaluar: se evita disparar
  // (o silenciar) alarmas con datos viejos.
  let frameTime: number | null = null;
  try {
    const index = await getRadarIndex();
    const frame = latestPast(index);
    frameTime = frame ? frame.time * 1000 : null;
    if (frameTime !== null) {
      const ageMinutes = (Date.now() - frameTime) / 60000;
      if (ageMinutes > config.alarm.maxFrameAgeMinutes) {
        report.skipped = locations.length;
        report.frameTime = frameTime;
        report.durationMs = Date.now() - startedAt;
        lastReport = report;
        return report;
      }
    }
  } catch {
    report.errors++;
    report.durationMs = Date.now() - startedAt;
    lastReport = report;
    return report;
  }
  report.frameTime = frameTime;

  // Se procesan en tandas para no saturar el proveedor de teselas.
  const BATCH = 4;
  for (let i = 0; i < locations.length; i += BATCH) {
    const batch = locations.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((l) => checkLocation(db, l)));
    for (const r of results) {
      report.checked++;
      if (r === 'fired') report.fired++;
      else if (r === 'suppressed') report.suppressed++;
      else if (r === 'error') report.errors++;
    }
  }

  pruneTileCache(45 * 60 * 1000);
  report.durationMs = Date.now() - startedAt;
  lastReport = report;
  return report;
}

/** Arranca el bucle de vigilancia en segundo plano. */
export function startWatcher(db: Db, log: (msg: string) => void): () => void {
  if (timer) return () => stopWatcher();

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const report = await runTick(db);
      if (report.checked > 0 || report.errors > 0) {
        log(
          `vigilancia: ${report.checked} ubicaciones, ${report.fired} avisos, ` +
            `${report.suppressed} silenciados, ${report.errors} errores (${report.durationMs} ms)`,
        );
      }
    } catch (err) {
      log(`vigilancia: fallo inesperado: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };

  timer = setInterval(tick, config.alarm.tickSeconds * 1000);
  // Primer ciclo con un pequeño retardo para no competir con el arranque.
  setTimeout(tick, 5_000).unref();
  return () => stopWatcher();
}

export function stopWatcher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
