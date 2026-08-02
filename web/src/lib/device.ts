const STORAGE_KEY = 'plou.deviceId';
const REGISTRATION_KEY = 'plou.registrationToken';

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

/**
 * Secreto opcional de alta para instancias privadas. El administrador comparte
 * una URL `?invite=...`; se guarda localmente y se retira enseguida de la barra
 * de direcciones para que no viaje en enlaces posteriores.
 */
export function registrationToken(): string {
  const url = new URL(window.location.href);
  const invite = url.searchParams.get('invite')?.trim();
  if (invite) {
    localStorage.setItem(REGISTRATION_KEY, invite);
    url.searchParams.delete('invite');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    return invite;
  }
  return localStorage.getItem(REGISTRATION_KEY) ?? '';
}

/** El secreto deja de ser necesario en cuanto el servidor reconoce el dispositivo. */
export function clearRegistrationToken(): void {
  localStorage.removeItem(REGISTRATION_KEY);
}

/** Zona horaria del sistema, usada para las franjas de silencio. */
export function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
