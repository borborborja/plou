import { config } from '../config.js';
import type { GeocodeResult } from './types.js';

interface RawSearch {
  results?: Array<{
    name?: string;
    latitude?: number;
    longitude?: number;
    country?: string;
    country_code?: string;
    admin1?: string;
    timezone?: string;
    population?: number;
  }>;
}

/** Búsqueda de localidades por nombre (servicio gratuito de Open-Meteo). */
export async function searchPlaces(
  query: string,
  language = 'es',
  count = 8,
): Promise<GeocodeResult[]> {
  const url = new URL(config.forecast.geocodingUrl);
  url.searchParams.set('name', query);
  url.searchParams.set('count', String(Math.min(20, Math.max(1, count))));
  url.searchParams.set('language', language);
  url.searchParams.set('format', 'json');

  const res = await fetch(url, {
    headers: { 'user-agent': config.userAgent, accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Geocodificación: HTTP ${res.status}`);
  const raw = (await res.json()) as RawSearch;

  return (raw.results ?? [])
    .filter((r) => typeof r.latitude === 'number' && typeof r.longitude === 'number')
    .map((r) => ({
      name: r.name ?? query,
      lat: r.latitude!,
      lon: r.longitude!,
      country: r.country ?? null,
      countryCode: r.country_code ?? null,
      admin1: r.admin1 ?? null,
      timezone: r.timezone ?? null,
      population: r.population ?? null,
    }));
}

interface RawReverse {
  city?: string;
  locality?: string;
  principalSubdivision?: string;
  countryName?: string;
  countryCode?: string;
}

/**
 * Geocodificación inversa para dar nombre a la ubicación actual.
 * Si el servicio falla se devuelven las coordenadas formateadas, de modo que la
 * app nunca se queda sin etiqueta que mostrar.
 */
export async function describePoint(
  lat: number,
  lon: number,
  language = 'es',
): Promise<{ name: string; region: string | null; country: string | null }> {
  const fallback = {
    name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
    region: null,
    country: null,
  };
  try {
    const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('localityLanguage', language);
    const res = await fetch(url, {
      headers: { 'user-agent': config.userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return fallback;
    const raw = (await res.json()) as RawReverse;
    const name = raw.city || raw.locality || raw.principalSubdivision;
    if (!name) return fallback;
    return {
      name,
      region: raw.principalSubdivision ?? null,
      country: raw.countryName ?? null,
    };
  } catch {
    return fallback;
  }
}
