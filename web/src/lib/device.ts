const STORAGE_KEY = 'plou.deviceId';

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Identificador local del dispositivo. No hay cuentas de usuario: este valor es
 * la única credencial y vive sólo en este navegador.
 */
export function deviceId(): string {
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = randomId();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

/** Zona horaria del sistema, usada para las franjas de silencio. */
export function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
