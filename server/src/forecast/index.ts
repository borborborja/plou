import { config } from '../config.js';
import { forecaProvider } from './foreca.js';
import { openMeteoProvider } from './openmeteo.js';
import type { ForecastProvider, ForecastRequest, ProviderId, WeatherForecast } from './types.js';

const PROVIDERS: Record<ProviderId, ForecastProvider> = {
  openmeteo: openMeteoProvider,
  foreca: forecaProvider,
};

export function listProviders(): Array<{
  id: ProviderId;
  label: string;
  available: boolean;
  reason: string | null;
}> {
  return (Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
    const p = PROVIDERS[id];
    return { id, label: p.label, available: p.available(), reason: p.unavailableReason() };
  });
}

interface CacheEntry {
  at: number;
  value: Promise<WeatherForecast>;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(id: ProviderId, req: ForecastRequest): string {
  return `${id}|${req.lat.toFixed(3)}|${req.lon.toFixed(3)}|${req.days ?? 7}|${req.hours ?? 48}`;
}

/**
 * Obtiene la previsión del proveedor pedido. Si no está disponible (por ejemplo
 * Foreca sin credenciales) se recurre a Open-Meteo, informando del cambio.
 */
export async function getForecast(
  providerId: ProviderId,
  request: ForecastRequest,
): Promise<WeatherForecast & { requestedProvider: ProviderId; fallbackReason: string | null }> {
  let provider = PROVIDERS[providerId] ?? openMeteoProvider;
  let fallbackReason: string | null = null;

  if (!provider.available()) {
    fallbackReason = provider.unavailableReason();
    provider = openMeteoProvider;
  }

  const key = cacheKey(provider.id, request);
  const ttl = config.forecast.cacheTtlSeconds * 1000;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) {
    return { ...(await hit.value), requestedProvider: providerId, fallbackReason };
  }

  const entry: CacheEntry = {
    at: Date.now(),
    value: provider.fetch(request).catch((err) => {
      cache.delete(key);
      throw err;
    }),
  };
  cache.set(key, entry);
  while (cache.size > 200) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }

  try {
    return { ...(await entry.value), requestedProvider: providerId, fallbackReason };
  } catch (err) {
    // Si falla un proveedor secundario, se intenta el gratuito antes de rendirse.
    if (provider.id !== 'openmeteo') {
      const forecast = await openMeteoProvider.fetch(request);
      return {
        ...forecast,
        requestedProvider: providerId,
        fallbackReason: `${provider.label} no ha respondido: ${(err as Error).message}`,
      };
    }
    throw err;
  }
}

export function clearForecastCache(): void {
  cache.clear();
}

export * from './types.js';
