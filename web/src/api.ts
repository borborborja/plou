import { deviceId } from './lib/device';
import type {
  AlarmConfig,
  AlarmEvent,
  GeocodeResult,
  Location,
  LocationAnalysis,
  Meta,
  ProviderId,
  RadarFrames,
  RadarLegend,
  Settings,
  WeatherForecast,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'x-device-id': deviceId(),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export const api = {
  meta: () => request<Meta>('/api/meta'),

  registerDevice: () =>
    request<{ deviceId: string; settings: Settings }>('/api/device', { method: 'POST' }),

  getSettings: () => request<Settings>('/api/settings'),
  saveSettings: (patch: Partial<Settings>) =>
    request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  listLocations: () => request<Location[]>('/api/locations'),
  createLocation: (input: {
    name: string;
    lat: number;
    lon: number;
    followDevice?: boolean;
    alarm?: Partial<AlarmConfig>;
  }) => request<Location>('/api/locations', { method: 'POST', body: JSON.stringify(input) }),
  updateLocation: (
    id: number,
    patch: Partial<{
      name: string;
      lat: number;
      lon: number;
      followDevice: boolean;
      alarm: Partial<AlarmConfig>;
    }>,
  ) => request<Location>(`/api/locations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteLocation: (id: number) => request<void>(`/api/locations/${id}`, { method: 'DELETE' }),
  updatePosition: (id: number, lat: number, lon: number, accuracyM?: number) =>
    request<Location>(`/api/locations/${id}/position`, {
      method: 'POST',
      body: JSON.stringify({ lat, lon, accuracyM }),
    }),
  snooze: (id: number, minutes?: number) =>
    request<{ snoozedUntil: number; minutes: number }>(`/api/locations/${id}/snooze`, {
      method: 'POST',
      body: JSON.stringify({ minutes }),
    }),
  dismiss: (id: number) => request<{ ok: boolean }>(`/api/locations/${id}/dismiss`, { method: 'POST' }),
  checkNow: (id: number) =>
    request<{ result: string }>(`/api/locations/${id}/check`, { method: 'POST' }),
  testNotification: (id: number) =>
    request<{ sent: number; failed: number; removed: number }>(`/api/locations/${id}/test`, {
      method: 'POST',
    }),
  locationAnalysis: (id: number) =>
    request<{ location: Location; analysis: LocationAnalysis }>(`/api/locations/${id}/analysis`),

  radarFrames: (params: { color: number; smooth: boolean; snow: boolean }) =>
    request<RadarFrames>(
      `/api/radar/frames?color=${params.color}&smooth=${params.smooth}&snow=${params.snow}`,
    ),

  radarLegend: (color: number) => request<RadarLegend>(`/api/radar/legend?color=${color}`),

  radarAnalysis: (params: {
    lat: number;
    lon: number;
    radiusKm: number;
    intensity: string;
    rain?: boolean;
    snow?: boolean;
  }) => {
    const q = new URLSearchParams({
      lat: String(params.lat),
      lon: String(params.lon),
      radiusKm: String(params.radiusKm),
      intensity: params.intensity,
      rain: String(params.rain ?? true),
      snow: String(params.snow ?? true),
    });
    return request<LocationAnalysis>(`/api/radar/analysis?${q}`);
  },

  forecast: (params: {
    lat: number;
    lon: number;
    provider: ProviderId;
    days?: number;
    hours?: number;
    language?: string;
  }) => {
    const q = new URLSearchParams({
      lat: String(params.lat),
      lon: String(params.lon),
      provider: params.provider,
      days: String(params.days ?? 10),
      hours: String(params.hours ?? 48),
      language: params.language ?? 'es',
    });
    return request<WeatherForecast>(`/api/forecast?${q}`);
  },

  geocode: (q: string, language = 'es') =>
    request<{ results: GeocodeResult[] }>(
      `/api/geocode?q=${encodeURIComponent(q)}&language=${language}`,
    ),
  reverseGeocode: (lat: number, lon: number, language = 'es') =>
    request<{ name: string; region: string | null; country: string | null }>(
      `/api/geocode/reverse?lat=${lat}&lon=${lon}&language=${language}`,
    ),

  events: (limit = 50) => request<AlarmEvent[]>(`/api/events?limit=${limit}`),

  pushSubscriptions: () =>
    request<{ endpoint: string; createdAt: number; lastOkAt: number | null; failures: number }[]>(
      '/api/push/subscriptions',
    ),
  subscribePush: (subscription: PushSubscriptionJSON) =>
    request<{ ok: boolean }>('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),
  unsubscribePush: (endpoint: string) =>
    request<{ ok: boolean }>('/api/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    }),
};
