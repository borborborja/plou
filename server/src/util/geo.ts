/** Utilidades geográficas: distancias, rumbos y proyección Web Mercator. */

export const EARTH_RADIUS_KM = 6371.0088;

export interface LatLon {
  lat: number;
  lon: number;
}

const DEG = Math.PI / 180;

/** Distancia ortodrómica en kilómetros. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rumbo inicial de `a` a `b` en grados (0 = norte, 90 = este). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Kilómetros por grado de longitud a una latitud dada. */
export function kmPerLonDegree(lat: number): number {
  return 111.32 * Math.cos(lat * DEG);
}

/** Kilómetros por grado de latitud (constante a efectos prácticos). */
export const KM_PER_LAT_DEGREE = 110.574;

/**
 * Desplazamiento plano desde un punto: `east`/`north` en km.
 * Aproximación válida para radios de unos cientos de km.
 */
export function offsetKm(origin: LatLon, eastKm: number, northKm: number): LatLon {
  const lat = origin.lat + northKm / KM_PER_LAT_DEGREE;
  const kmLon = kmPerLonDegree(origin.lat);
  const lon = kmLon < 1e-6 ? origin.lon : origin.lon + eastKm / kmLon;
  return { lat, lon: normalizeLon(lon) };
}

export function normalizeLon(lon: number): number {
  let l = lon;
  while (l > 180) l -= 360;
  while (l < -180) l += 360;
  return l;
}

export function clampLat(lat: number): number {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

/** Coordenadas de píxel global en Web Mercator para un zoom y tamaño de tesela. */
export function latLonToGlobalPixel(
  point: LatLon,
  zoom: number,
  tileSize: number,
): { x: number; y: number } {
  const scale = tileSize * 2 ** zoom;
  const lat = clampLat(point.lat);
  const x = ((normalizeLon(point.lon) + 180) / 360) * scale;
  const sinLat = Math.sin(lat * DEG);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/** Metros por píxel en Web Mercator a una latitud y zoom dados. */
export function metersPerPixel(lat: number, zoom: number, tileSize: number): number {
  return (40075016.686 * Math.cos(clampLat(lat) * DEG)) / (tileSize * 2 ** zoom);
}

const COMPASS_ES = [
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

/** Punto cardinal (16 rumbos, nomenclatura castellana) para un ángulo en grados. */
export function compassPoint(deg: number): string {
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS_ES[idx] ?? 'N';
}

/** Diferencia angular con signo entre dos rumbos, en el rango [-180, 180). */
export function angleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}
