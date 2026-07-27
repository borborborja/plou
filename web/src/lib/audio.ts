import type { AlarmTone, SoundConfig } from '../types';

/**
 * Tonos de alarma sintetizados con la Web Audio API.
 *
 * Generarlos en el momento evita distribuir ficheros de audio, permite ajustar
 * volumen y duración sin recortes, y funciona sin conexión.
 */

let context: AudioContext | null = null;
let activeStop: (() => void) | null = null;

function ctx(): AudioContext {
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    context = new Ctor();
  }
  return context;
}

/**
 * Los navegadores exigen un gesto del usuario para poder reproducir audio.
 * Conviene llamar a esto en el primer toque para que la alarma pueda sonar
 * después sin interacción.
 */
export async function unlockAudio(): Promise<void> {
  try {
    const c = ctx();
    if (c.state === 'suspended') await c.resume();
  } catch {
    /* sin audio disponible */
  }
}

interface Note {
  /** Retardo desde el inicio del patrón, en segundos. */
  at: number;
  /** Frecuencia en Hz. Un array produce un barrido. */
  freq: number | [number, number];
  duration: number;
  type?: OscillatorType;
  gain?: number;
}

interface ToneSpec {
  /** Duración de un ciclo completo del patrón, en segundos. */
  period: number;
  notes: Note[];
}

const TONES: Record<Exclude<AlarmTone, 'silent'>, ToneSpec> = {
  // Tres pitidos cortos, el aviso más reconocible.
  classic: {
    period: 1.6,
    notes: [
      { at: 0, freq: 880, duration: 0.16, type: 'square', gain: 0.6 },
      { at: 0.24, freq: 880, duration: 0.16, type: 'square', gain: 0.6 },
      { at: 0.48, freq: 880, duration: 0.16, type: 'square', gain: 0.6 },
    ],
  },
  // Arpegio ascendente suave.
  chime: {
    period: 2.4,
    notes: [
      { at: 0, freq: 587.33, duration: 0.5, type: 'sine' },
      { at: 0.18, freq: 783.99, duration: 0.5, type: 'sine' },
      { at: 0.36, freq: 987.77, duration: 0.7, type: 'sine' },
      { at: 0.54, freq: 1174.66, duration: 0.9, type: 'sine' },
    ],
  },
  // Barrido continuo tipo sirena.
  siren: {
    period: 1.4,
    notes: [
      { at: 0, freq: [520, 980], duration: 0.7, type: 'sawtooth', gain: 0.45 },
      { at: 0.7, freq: [980, 520], duration: 0.7, type: 'sawtooth', gain: 0.45 },
    ],
  },
  // Pulso corto y agudo, como el barrido de un radar.
  radar: {
    period: 1.2,
    notes: [
      { at: 0, freq: [1400, 900], duration: 0.09, type: 'sine', gain: 0.7 },
      { at: 0.6, freq: [1400, 900], duration: 0.09, type: 'sine', gain: 0.35 },
    ],
  },
  // Gota cayendo: descenso rápido de frecuencia.
  droplet: {
    period: 1.8,
    notes: [
      { at: 0, freq: [1600, 420], duration: 0.22, type: 'sine', gain: 0.7 },
      { at: 0.55, freq: [1300, 380], duration: 0.22, type: 'sine', gain: 0.5 },
    ],
  },
  // Timbre con dos notas y cola larga.
  bell: {
    period: 3,
    notes: [
      { at: 0, freq: 659.25, duration: 1.4, type: 'triangle' },
      { at: 0.05, freq: 1318.5, duration: 1.2, type: 'sine', gain: 0.35 },
      { at: 0.9, freq: 523.25, duration: 1.6, type: 'triangle' },
    ],
  },
  // Latido grave y persistente.
  pulse: {
    period: 1,
    notes: [
      { at: 0, freq: 220, duration: 0.28, type: 'triangle', gain: 0.8 },
      { at: 0.34, freq: 174.61, duration: 0.22, type: 'triangle', gain: 0.5 },
    ],
  },
};

export const TONE_KEYS = Object.keys(TONES) as Array<Exclude<AlarmTone, 'silent'>>;

function scheduleCycle(
  c: AudioContext,
  master: GainNode,
  spec: ToneSpec,
  startAt: number,
): void {
  for (const note of spec.notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = note.type ?? 'sine';

    const t0 = startAt + note.at;
    const t1 = t0 + note.duration;

    if (Array.isArray(note.freq)) {
      osc.frequency.setValueAtTime(note.freq[0], t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, note.freq[1]), t1);
    } else {
      osc.frequency.setValueAtTime(note.freq, t0);
    }

    // Envolvente con ataque y caída suaves para evitar chasquidos.
    const peak = note.gain ?? 0.5;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, note.duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);

    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t1 + 0.05);
  }
}

/**
 * Reproduce un tono de alarma. Devuelve una función para detenerlo.
 * Sólo suena una alarma a la vez: una nueva sustituye a la anterior.
 */
export function playAlarm(config: SoundConfig): () => void {
  stopAlarm();
  if (config.tone === 'silent' || config.volume <= 0) return () => undefined;

  const spec = TONES[config.tone as Exclude<AlarmTone, 'silent'>];
  if (!spec) return () => undefined;

  const c = ctx();
  void c.resume();

  const master = c.createGain();
  master.connect(c.destination);

  const now = c.currentTime + 0.05;
  const total = Math.max(spec.period, config.durationSeconds);

  if (config.fadeIn) {
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(config.volume, now + Math.min(6, total * 0.6));
  } else {
    master.gain.setValueAtTime(config.volume, now);
  }

  const cycles = Math.max(1, Math.ceil(config.durationSeconds / spec.period));
  for (let i = 0; i < cycles; i++) {
    scheduleCycle(c, master, spec, now + i * spec.period);
  }

  const endsAt = now + cycles * spec.period;
  let loopTimer: number | null = null;
  if (config.loop) {
    loopTimer = window.setTimeout(
      () => {
        activeStop = null;
        playAlarm(config);
      },
      Math.max(500, (endsAt - c.currentTime) * 1000),
    );
  }

  if (config.vibrate && 'vibrate' in navigator) {
    try {
      navigator.vibrate([300, 150, 300, 150, 600]);
    } catch {
      /* la vibración no está disponible en todos los dispositivos */
    }
  }

  const stop = (): void => {
    if (loopTimer !== null) window.clearTimeout(loopTimer);
    try {
      master.gain.cancelScheduledValues(c.currentTime);
      master.gain.setValueAtTime(master.gain.value, c.currentTime);
      master.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.08);
      window.setTimeout(() => master.disconnect(), 200);
    } catch {
      master.disconnect();
    }
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(0);
      } catch {
        /* ignorado */
      }
    }
  };

  activeStop = stop;
  return stop;
}

export function stopAlarm(): void {
  if (activeStop) {
    activeStop();
    activeStop = null;
  }
}

export function alarmIsPlaying(): boolean {
  return activeStop !== null;
}
