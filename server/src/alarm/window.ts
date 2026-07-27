/** Franjas horarias locales (silencio y vigilancia) con soporte de zona horaria. */

export interface LocalTime {
  /** Minutos transcurridos desde medianoche. */
  minutes: number;
  /** Día de la semana, 0 = domingo. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timezone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
      });
    } catch {
      // Zona horaria desconocida: se cae a UTC en lugar de fallar.
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
      });
    }
    formatterCache.set(timezone, f);
  }
  return f;
}

/** Hora local y día de la semana en la zona horaria indicada. */
export function localTime(at: number, timezone: string): LocalTime {
  const parts = formatterFor(timezone).formatToParts(new Date(at));
  let hour = 0;
  let minute = 0;
  let weekday = 0;
  for (const p of parts) {
    if (p.type === 'hour') hour = Number.parseInt(p.value, 10) % 24;
    else if (p.type === 'minute') minute = Number.parseInt(p.value, 10);
    else if (p.type === 'weekday') weekday = WEEKDAY_INDEX[p.value] ?? 0;
  }
  return { minutes: hour * 60 + minute, weekday };
}

function parseHhMm(value: string): number {
  const [h = '0', m = '0'] = value.split(':');
  return (Number.parseInt(h, 10) % 24) * 60 + (Number.parseInt(m, 10) % 60);
}

/**
 * ¿El instante `at` cae dentro de la franja `from`–`to`?
 *
 * Las franjas que cruzan la medianoche (p. ej. 22:00–07:00) se tratan
 * correctamente: en ese caso el día que se comprueba es el de *inicio* de la
 * franja, de modo que "noches del viernes" incluye la madrugada del sábado.
 */
export function isWithinWindow(
  at: number,
  timezone: string,
  from: string,
  to: string,
  days: readonly number[] = [],
): boolean {
  const { minutes, weekday } = localTime(at, timezone);
  const start = parseHhMm(from);
  const end = parseHhMm(to);
  const restricted = days.length > 0 && days.length < 7;

  if (start === end) {
    // Franja vacía: no se aplica nunca.
    return false;
  }

  if (start < end) {
    const inRange = minutes >= start && minutes < end;
    if (!inRange) return false;
    return restricted ? days.includes(weekday) : true;
  }

  // Cruza medianoche.
  if (minutes >= start) {
    return restricted ? days.includes(weekday) : true;
  }
  if (minutes < end) {
    const startDay = (weekday + 6) % 7;
    return restricted ? days.includes(startDay) : true;
  }
  return false;
}
