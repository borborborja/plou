/** El ahorro sólo bloquea refrescos cuando la página está oculta. */
export function shouldRefresh(hidden: boolean, batterySaver: boolean): boolean {
  return !hidden || !batterySaver;
}

/** Identificador de ubicación incluido en un enlace de notificación. */
export function linkedLocationId(search: string): number | null {
  const id = Number(new URLSearchParams(search).get('location'));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
