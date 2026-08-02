import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import { t, type Strings } from './i18n';
import { systemTimezone } from './lib/device';
import { hasActiveSubscription, pushStatus, registerServiceWorker, type PushStatus } from './lib/push';
import { shouldRefresh } from './lib/runtime';
import type {
  AlarmEvent,
  Location,
  LocationAnalysis,
  Meta,
  Settings,
  WeatherForecast,
} from './types';

export interface ActivePoint {
  lat: number;
  lon: number;
  name: string;
  /** Ubicación guardada correspondiente, si la hay. */
  locationId?: number;
}

export interface RingingAlarm {
  title: string;
  body: string;
  payload: Record<string, unknown>;
}

interface Store {
  ready: boolean;
  error: string | null;
  meta: Meta | null;
  settings: Settings;
  strings: Strings;
  locations: Location[];
  events: AlarmEvent[];
  point: ActivePoint | null;
  analysis: LocationAnalysis | null;
  analysisLoading: boolean;
  forecast: WeatherForecast | null;
  forecastLoading: boolean;
  push: PushStatus;
  subscribed: boolean;
  ringing: RingingAlarm | null;

  setPoint: (point: ActivePoint) => void;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  reloadLocations: () => Promise<void>;
  reloadEvents: () => Promise<void>;
  refreshAnalysis: () => Promise<void>;
  refreshForecast: () => Promise<void>;
  setPush: (status: PushStatus) => void;
  setSubscribed: (value: boolean) => void;
  setRinging: (alarm: RingingAlarm | null) => void;
  locateMe: () => Promise<ActivePoint | null>;
}

const StoreContext = createContext<Store | null>(null);

const FALLBACK_SETTINGS: Settings = {
  language: 'es',
  theme: 'system',
  timezone: 'UTC',
  units: {
    temperature: 'C',
    wind: 'kmh',
    precipitation: 'mm',
    distance: 'km',
    pressure: 'hPa',
    clock: '24h',
  },
  map: {
    activeLayer: 'radar',
    satelliteVariant: 'geocolour',
    showLightning: false,
    satelliteOpacity: 0.9,
    cloudOpacity: 0.72,
    lightningOpacity: 0.9,
    colorScheme: 2,
    smooth: true,
    showSnow: true,
    opacity: 0.85,
    blend: 'plain',
    baseLayer: 'auto',
    historyMinutes: 120,
    showNowcast: true,
    frameDurationMs: 420,
    lastFrameHoldMs: 1200,
    autoPlay: true,
    showCoverage: false,
    showRadius: true,
    showMotionArrow: true,
  },
  forecastProvider: 'openmeteo',
  refreshSeconds: 300,
  keepScreenOn: false,
  showMmPerHour: true,
  batterySaver: false,
};

const LAST_POINT_KEY = 'plou.lastPoint';

function readLastPoint(): ActivePoint | null {
  try {
    const raw = localStorage.getItem(LAST_POINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActivePoint;
    if (typeof parsed.lat === 'number' && typeof parsed.lon === 'number') return parsed;
  } catch {
    /* preferencia corrupta: se ignora */
  }
  return null;
}

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [settings, setSettings] = useState<Settings>(FALLBACK_SETTINGS);
  const [locations, setLocations] = useState<Location[]>([]);
  const [events, setEvents] = useState<AlarmEvent[]>([]);
  const [point, setPointState] = useState<ActivePoint | null>(() => readLastPoint());
  const [analysis, setAnalysis] = useState<LocationAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [forecast, setForecast] = useState<WeatherForecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [push, setPush] = useState<PushStatus>(() => pushStatus());
  const [subscribed, setSubscribed] = useState(false);
  const [ringing, setRinging] = useState<RingingAlarm | null>(null);

  const pointRef = useRef(point);
  pointRef.current = point;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const setPoint = useCallback((next: ActivePoint) => {
    setPointState(next);
    try {
      localStorage.setItem(LAST_POINT_KEY, JSON.stringify(next));
    } catch {
      /* almacenamiento lleno o bloqueado */
    }
  }, []);

  const reloadLocations = useCallback(async () => {
    setLocations(await api.listLocations());
  }, []);

  const reloadEvents = useCallback(async () => {
    setEvents(await api.events(60));
  }, []);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    // Optimista: la interfaz responde al instante y el servidor confirma después.
    setSettings((prev) => ({ ...prev, ...patch }));
    const saved = await api.saveSettings(patch);
    setSettings(saved);
  }, []);

  const refreshAnalysis = useCallback(async () => {
    const current = pointRef.current;
    if (!current) return;
    setAnalysisLoading(true);
    try {
      const result = await api.radarAnalysis({
        lat: current.lat,
        lon: current.lon,
        radiusKm: 30,
        intensity: 'drizzle',
      });
      setAnalysis(result);
    } catch {
      setAnalysis(null);
    } finally {
      setAnalysisLoading(false);
    }
  }, []);

  const refreshForecast = useCallback(async () => {
    const current = pointRef.current;
    if (!current) return;
    setForecastLoading(true);
    try {
      const result = await api.forecast({
        lat: current.lat,
        lon: current.lon,
        provider: settingsRef.current.forecastProvider,
        days: 10,
        hours: 48,
        language: settingsRef.current.language,
      });
      setForecast(result);
    } catch {
      setForecast(null);
    } finally {
      setForecastLoading(false);
    }
  }, []);

  const locateMe = useCallback(async (): Promise<ActivePoint | null> => {
    if (!('geolocation' in navigator)) return null;
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          let name = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
          try {
            const described = await api.reverseGeocode(latitude, longitude, settingsRef.current.language);
            name = described.name;
          } catch {
            /* se conserva el nombre por coordenadas */
          }
          const next: ActivePoint = { lat: latitude, lon: longitude, name };
          setPoint(next);
          resolve(next);
        },
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 12_000, maximumAge: 120_000 },
      );
    });
  }, [setPoint]);

  // --- Arranque -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [metaData, device] = await Promise.all([api.meta(), api.registerDevice()]);
        if (cancelled) return;
        setMeta(metaData);

        // La zona horaria del dispositivo se sincroniza sola: de ella dependen
        // las horas de silencio configuradas por el usuario.
        const tz = systemTimezone();
        let effective = device.settings;
        if (device.settings.timezone !== tz) {
          effective = await api.saveSettings({ timezone: tz });
        }
        setSettings(effective);

        await reloadLocations();
        await reloadEvents();
        void registerServiceWorker().then(() => hasActiveSubscription().then(setSubscribed));
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadLocations, reloadEvents]);

  // Si no hay punto elegido, se usa la primera ubicación guardada.
  useEffect(() => {
    if (point || locations.length === 0) return;
    const first = locations[0]!;
    setPoint({ lat: first.lat, lon: first.lon, name: first.name, locationId: first.id });
  }, [locations, point, setPoint]);

  // Mantiene actualizada la única ubicación marcada como "seguir al
  // dispositivo" mientras la PWA está abierta. Los navegadores no permiten
  // geolocalización arbitraria desde un service worker cerrado, por lo que se
  // sincroniza al abrir y cada vez que llega una lectura nueva.
  const followingId = locations.find((location) => location.followDevice)?.id ?? null;
  useEffect(() => {
    if (followingId === null || !('geolocation' in navigator)) return;
    let cancelled = false;
    let sending = false;
    let lastSent: { lat: number; lon: number; at: number } | null = null;

    const syncPosition = (position: GeolocationPosition): void => {
      if (cancelled || sending) return;
      const { latitude, longitude, accuracy } = position.coords;
      const now = Date.now();
      const movedEnough =
        !lastSent || Math.hypot(latitude - lastSent.lat, longitude - lastSent.lon) * 111 >= 0.1;
      if (!movedEnough && lastSent && now - lastSent.at < 5 * 60_000) return;

      sending = true;
      void api
        .updatePosition(followingId, latitude, longitude, accuracy)
        .then((updated) => {
          if (cancelled) return;
          lastSent = { lat: latitude, lon: longitude, at: now };
          setLocations((previous) =>
            previous.map((location) =>
              location.id === updated.id ? { ...location, ...updated } : location,
            ),
          );
          if (pointRef.current?.locationId === followingId) {
            setPoint({
              lat: latitude,
              lon: longitude,
              name: updated.name,
              locationId: followingId,
            });
          }
        })
        .catch(() => undefined)
        .finally(() => {
          sending = false;
        });
    };

    const watchId = navigator.geolocation.watchPosition(
      syncPosition,
      () => undefined,
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 120_000 },
    );
    // Incluso sin movimiento hay que renovar la vigencia de la posición: el
    // servidor rechaza coordenadas antiguas para no avisar en un lugar previo.
    const heartbeat = window.setInterval(() => {
      navigator.geolocation.getCurrentPosition(syncPosition, () => undefined, {
        enableHighAccuracy: false,
        timeout: 15_000,
        maximumAge: 120_000,
      });
    }, 5 * 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      navigator.geolocation.clearWatch(watchId);
    };
  }, [followingId, setPoint]);

  // Datos del punto activo.
  useEffect(() => {
    if (!point) return;
    void refreshAnalysis();
    void refreshForecast();
  }, [point, refreshAnalysis, refreshForecast]);

  // En modo normal se intenta refrescar también en segundo plano (el navegador
  // puede espaciar los temporizadores). El ahorro de energía lo evita.
  useEffect(() => {
    if (!point) return;
    const interval = window.setInterval(() => {
      if (!shouldRefresh(document.hidden, settingsRef.current.batterySaver)) return;
      void refreshAnalysis();
      void refreshForecast();
    }, settings.refreshSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [point, settings.refreshSeconds, refreshAnalysis, refreshForecast]);

  // Mensajes del service worker: alarma recibida con la app abierta.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent): void => {
      const data = event.data as { type?: string; title?: string; body?: string; payload?: Record<string, unknown> };
      if (data?.type === 'plou-alarm') {
        setRinging({ title: data.title ?? '', body: data.body ?? '', payload: data.payload ?? {} });
        void reloadEvents();
        void reloadLocations();
      }
      if (data?.type === 'plou-open' && data.payload) {
        const lat = data.payload['lat'];
        const lon = data.payload['lon'];
        if (typeof lat === 'number' && typeof lon === 'number') {
          setPoint({
            lat,
            lon,
            name: String(data.payload['locationName'] ?? ''),
            locationId: Number(data.payload['locationId']) || undefined,
          });
        }
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [reloadEvents, reloadLocations, setPoint]);

  // Tema de la interfaz.
  useEffect(() => {
    const root = document.documentElement;
    const apply = (): void => {
      const dark =
        settings.theme === 'dark' ||
        (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.dataset['theme'] = dark ? 'dark' : 'light';
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.lang = settings.language;
  }, [settings.language]);

  // Mantener la pantalla encendida, si el usuario lo ha pedido.
  useEffect(() => {
    if (!settings.keepScreenOn || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let released = false;
    const request = async (): Promise<void> => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        /* denegado o no disponible */
      }
    };
    void request();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && !released) void request();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [settings.keepScreenOn]);

  const value = useMemo<Store>(
    () => ({
      ready,
      error,
      meta,
      settings,
      strings: t(settings.language),
      locations,
      events,
      point,
      analysis,
      analysisLoading,
      forecast,
      forecastLoading,
      push,
      subscribed,
      ringing,
      setPoint,
      updateSettings,
      reloadLocations,
      reloadEvents,
      refreshAnalysis,
      refreshForecast,
      setPush,
      setSubscribed,
      setRinging,
      locateMe,
    }),
    [
      ready,
      error,
      meta,
      settings,
      locations,
      events,
      point,
      analysis,
      analysisLoading,
      forecast,
      forecastLoading,
      push,
      subscribed,
      ringing,
      setPoint,
      updateSettings,
      reloadLocations,
      reloadEvents,
      refreshAnalysis,
      refreshForecast,
      locateMe,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore debe usarse dentro de StoreProvider');
  return store;
}
