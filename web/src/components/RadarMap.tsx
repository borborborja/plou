import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { GeocodeResult, RadarFrames, RadarLegend } from '../types';

interface BaseSpec {
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains?: string;
  /** Capa de topónimos, que se dibuja *por encima* del radar. */
  labels?: string;
}

const BASE_LAYERS: Record<string, BaseSpec> = {
  clear: {
    url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
    labels: 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap, &copy; CARTO',
    maxZoom: 19,
    subdomains: 'abcd',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
    labels: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap, &copy; CARTO',
    maxZoom: 19,
    subdomains: 'abcd',
  },
  streets: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; Colaboradores de OpenStreetMap',
    maxZoom: 19,
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
    subdomains: 'abc',
  },
};

interface Props {
  /** Se invoca al tocar el mapa para analizar otro punto. */
  onPick?: (lat: number, lon: number) => void;
  height?: string;
}

/** ¿Está la interfaz en modo oscuro, según la preferencia y el sistema? */
function useDarkTheme(preference: string): boolean {
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (): void => setSystemDark(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return preference === 'dark' || (preference === 'system' && systemDark);
}

/**
 * Opciones de zoom de una capa de teselas del proveedor.
 *
 * Con teselas de 512 px hay que desplazar el zoom en −1, y Leaflet aplica ese
 * desplazamiento *después* de recortar con `min/maxNativeZoom`: los límites
 * nativos han de expresarse, por tanto, en la escala del mapa y no en la de la
 * URL. Sin el mínimo, al alejar del todo se pedía el zoom −1 (que no existe) y
 * la capa desaparecía; sin el máximo corregido se pedía siempre un nivel menos
 * de detalle del que publica el proveedor.
 */
function zoomOptions(tileSize: number, apiMaxNativeZoom: number): {
  tileSize: number;
  zoomOffset: number;
  minNativeZoom: number;
  maxNativeZoom: number;
  minZoom: number;
  maxZoom: number;
} {
  const zoomOffset = tileSize === 512 ? -1 : 0;
  return {
    tileSize,
    zoomOffset,
    minNativeZoom: -zoomOffset,
    maxNativeZoom: apiMaxNativeZoom - zoomOffset,
    minZoom: 0,
    maxZoom: 19,
  };
}

/** Intervalos de historia ofrecidos en el panel de capas, en minutos. */
const HISTORY_CHOICES = [30, 60, 120];

/** Velocidades de animación: milisegundos por fotograma. */
const SPEED_CHOICES = [
  { key: 'slow', ms: 800 },
  { key: 'normal', ms: 420 },
  { key: 'fast', ms: 200 },
] as const;

/**
 * Mapa con la animación del radar. Las teselas de todos los fotogramas se
 * mantienen cargadas y se muestran cambiando la opacidad, de modo que la
 * animación no parpadea al avanzar.
 */
export function RadarMap({ onPick, height = '100%' }: Props): JSX.Element {
  const {
    settings,
    point,
    analysis,
    strings,
    locations,
    meta,
    setPoint,
    locateMe,
    reloadLocations,
    updateSettings,
  } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseRef = useRef<L.TileLayer | null>(null);
  const labelsRef = useRef<L.TileLayer | null>(null);
  const coverageRef = useRef<L.TileLayer | null>(null);
  const layersRef = useRef<(L.TileLayer | undefined)[]>([]);
  const overlaysRef = useRef<L.LayerGroup | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // El índice visible, accesible desde los manejadores del mapa.
  const indexRef = useRef(0);

  const [legend, setLegend] = useState<RadarLegend | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [frames, setFrames] = useState<RadarFrames | null>(null);
  const [framesError, setFramesError] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(settings.map.autoPlay);
  const [loadedCount, setLoadedCount] = useState(0);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fotogramas que se animan: la historia elegida y, si se quiere, la
  // extrapolación al futuro. El último fotograma pasado es siempre el «ahora».
  const allFrames = useMemo(() => {
    if (!frames) return [];
    const newest = frames.past[frames.past.length - 1]?.time ?? Date.now();
    const from = newest - settings.map.historyMinutes * 60_000;
    const past = frames.past.filter((frame) => frame.time >= from);
    // Siempre debe quedar al menos el fotograma más reciente.
    const history = past.length > 0 ? past : frames.past.slice(-1);
    return settings.map.showNowcast ? [...history, ...frames.nowcast] : history;
  }, [frames, settings.map.historyMinutes, settings.map.showNowcast]);

  const pastCount = useMemo(
    () => allFrames.filter((frame) => frame.kind === 'past').length,
    [allFrames],
  );

  // Al cambiar el conjunto de fotogramas (refresco o nuevo intervalo elegido)
  // la animación se coloca sobre el último observado.
  useEffect(() => {
    setIndex(Math.max(0, pastCount - 1));
  }, [pastCount, allFrames.length]);

  // El mapa base `auto` acompaña al tema de la interfaz. De la claridad del
  // mapa base depende además cómo se mezclan las teselas del radar: sobre un
  // fondo oscuro, `multiply` dejaría los ecos casi negros.
  const dark = useDarkTheme(settings.theme);
  const baseLayer =
    settings.map.baseLayer === 'auto' ? (dark ? 'dark' : 'clear') : settings.map.baseLayer;
  const darkBase = baseLayer === 'dark';

  // --- Creación del mapa --------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [point?.lat ?? 41.39, point?.lon ?? 2.17],
      zoom: 8,
      zoomControl: false,
      attributionControl: true,
      touchZoom: true,
    });
    L.control.zoom({ position: 'topleft' }).addTo(map);
    map.attributionControl.setPrefix('');
    overlaysRef.current = L.layerGroup().addTo(map);
    map.on('click', (event: L.LeafletMouseEvent) => {
      onPickRef.current?.(event.latlng.lat, event.latlng.lng);
    });
    mapRef.current = map;

    // El contenedor cambia de tamaño con el diseño (panel lateral, giro de
    // pantalla…): Leaflet necesita que se le avise para recolocar las teselas.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);
    window.setTimeout(() => map.invalidateSize(), 60);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Sólo debe ejecutarse una vez: el centro inicial se ajusta en otro efecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Mapa base ----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const spec = BASE_LAYERS[baseLayer] ?? BASE_LAYERS.clear!;

    baseRef.current?.remove();
    baseRef.current = L.tileLayer(spec.url, {
      attribution: spec.attribution,
      maxZoom: spec.maxZoom,
      subdomains: spec.subdomains ?? 'abc',
      detectRetina: true,
    }).addTo(map);
    baseRef.current.setZIndex(100);

    // Los topónimos van por encima del radar: sin ellos, en cuanto la lluvia
    // cubre la zona el mapa se queda sin referencias para situarse.
    labelsRef.current?.remove();
    labelsRef.current = null;
    if (spec.labels) {
      labelsRef.current = L.tileLayer(spec.labels, {
        maxZoom: spec.maxZoom,
        subdomains: spec.subdomains ?? 'abc',
        detectRetina: true,
        className: 'label-tiles',
      }).addTo(map);
      labelsRef.current.setZIndex(400);
    }
  }, [baseLayer]);

  // --- Descarga del índice de fotogramas ----------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.radarFrames({
          color: settings.map.colorScheme,
          smooth: settings.map.smooth,
          snow: settings.map.showSnow,
        });
        if (!cancelled) {
          setFrames(data);
          setFramesError(false);
          // El índice se recoloca sobre el fotograma actual en otro efecto.
          setIndex(0);
        }
      } catch {
        if (!cancelled) {
          setFrames(null);
          setFramesError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.map.colorScheme, settings.map.smooth, settings.map.showSnow]);

  // La leyenda se lee de la misma paleta que las teselas, así que se recarga
  // cuando cambia la escala de color elegida.
  useEffect(() => {
    let cancelled = false;
    void api
      .radarLegend(settings.map.colorScheme)
      .then((data) => {
        if (!cancelled) setLegend(data);
      })
      .catch(() => {
        if (!cancelled) setLegend(null);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.map.colorScheme]);

  // Refresco del índice cada 5 minutos: el radar publica un fotograma nuevo.
  useEffect(() => {
    const timer = window.setInterval(
      () => {
        if (document.visibilityState !== 'visible') return;
        void api
          .radarFrames({
            color: settings.map.colorScheme,
            smooth: settings.map.smooth,
            snow: settings.map.showSnow,
          })
          .then(setFrames)
          .catch(() => undefined);
      },
      5 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, [settings.map.colorScheme, settings.map.smooth, settings.map.showSnow]);

  // --- Capas de radar -----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || allFrames.length === 0) return;

    for (const layer of layersRef.current) layer?.remove();
    const layers: (L.TileLayer | undefined)[] = new Array(allFrames.length);
    layersRef.current = layers;
    setLoadedCount(0);

    // El fotograma que se está mirando se carga solo, antes que los demás: el
    // navegador abre unas seis conexiones por servidor, y si las trece capas
    // compiten desde el principio, la imagen que interesa es la última en
    // aparecer y el mapa se ve vacío durante segundos.
    const currentIndex = Math.min(Math.max(0, pastCount - 1), allFrames.length - 1);
    // El efecto de opacidad sincroniza esta referencia, pero aquí todavía no ha
    // corrido: sin esto, el primer movimiento del mapa quitaría la capa visible.
    indexRef.current = currentIndex;

    let loaded = 0;
    const create = (i: number): L.TileLayer => {
      const layer = L.tileLayer(allFrames[i]!.template, {
        opacity: i === indexRef.current ? settings.map.opacity : 0,
        ...zoomOptions(frames?.tileSize ?? 512, frames?.maxNativeZoom ?? 7),
        // Sin CORS: los píxeles se decodifican en el servidor, aquí sólo se
        // dibujan. Pedirlas en modo CORS las hacía fallar de forma intermitente
        // («No 'Access-Control-Allow-Origin' header is present») y el radar
        // desaparecía sin motivo aparente.
        className: 'radar-tiles',
      });
      layer.once('load', () => {
        loaded++;
        setLoadedCount(loaded);
      });
      layer.addTo(map);
      layer.setZIndex(200 + i);
      layers[i] = layer;
      return layer;
    };

    const first = create(currentIndex);

    // El resto se trae de uno en uno, cada cual cuando el anterior ha terminado:
    // el navegador sólo mantiene unas seis conexiones por servidor, así que
    // pedirlo todo a la vez no acelera nada y sí retrasa lo que se está viendo.
    let cancelled = false;
    let timer: number | undefined;
    let queue: number[] = [];

    const next = (): void => {
      if (cancelled) return;
      const i = queue.shift();
      if (i === undefined) return;
      const layer = layers[i] ?? create(i);
      if (!map.hasLayer(layer)) layer.addTo(map);
      // Se continúa al cargar, y también si tarda demasiado, para no encallarse.
      layer.once('load', () => {
        window.clearTimeout(timer);
        next();
      });
      timer = window.setTimeout(next, 4000);
    };

    const loadRest = (): void => {
      window.clearTimeout(timer);
      // Se recorre `allFrames`, no `layers`: este último es disperso mientras
      // faltan capas por crear, y `map`/`filter` se saltan los huecos.
      queue = allFrames.map((_, i) => i).filter((i) => i !== indexRef.current);
      next();
    };

    /**
     * Al mover o ampliar el mapa hacen falta teselas nuevas de *cada* capa. Si
     * las trece las piden a la vez, el fotograma que se está viendo llega el
     * último y el mapa parece vaciarse. Durante el gesto sólo queda ese
     * fotograma; los demás se rehacen al terminar.
     */
    const onMoveStart = (): void => {
      window.clearTimeout(timer);
      queue = [];
      for (let i = 0; i < layers.length; i++) {
        if (i !== indexRef.current) layers[i]?.remove();
      }
    };
    const onMoveEnd = (): void => {
      const current = layers[indexRef.current];
      if (current && !map.hasLayer(current)) current.addTo(map);
      loadRest();
    };

    map.on('movestart zoomstart', onMoveStart);
    map.on('moveend zoomend', onMoveEnd);

    first.once('load', loadRest);
    const startFallback = window.setTimeout(loadRest, 4000);

    return () => {
      cancelled = true;
      window.clearTimeout(startFallback);
      window.clearTimeout(timer);
      map.off('movestart zoomstart', onMoveStart);
      map.off('moveend zoomend', onMoveEnd);
      for (const layer of layersRef.current) layer?.remove();
      layersRef.current = [];
    };
    // `settings.map.opacity` sólo fija el valor inicial: los cambios los aplica
    // el efecto siguiente, sin rehacer las capas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFrames, pastCount, frames?.maxNativeZoom, frames?.tileSize]);

  // Sólo el fotograma actual es visible.
  useEffect(() => {
    indexRef.current = index;
    layersRef.current.forEach((layer, i) => {
      layer?.setOpacity(i === index ? settings.map.opacity : 0);
    });
  }, [index, settings.map.opacity, loadedCount]);

  // --- Capa de cobertura --------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    coverageRef.current?.remove();
    coverageRef.current = null;
    if (!settings.map.showCoverage || !frames) return;
    coverageRef.current = L.tileLayer(frames.coverageTemplate, {
      opacity: 0.4,
      ...zoomOptions(frames.tileSize, frames.coverageMaxNativeZoom),
      className: 'coverage-tiles',
    }).addTo(map);
    coverageRef.current.setZIndex(150);
  }, [settings.map.showCoverage, frames]);

  // --- Animación ----------------------------------------------------------
  useEffect(() => {
    if (!playing || allFrames.length < 2) return;
    const isLast = index === allFrames.length - 1;
    const delay = isLast
      ? settings.map.frameDurationMs + settings.map.lastFrameHoldMs
      : settings.map.frameDurationMs;
    const timer = window.setTimeout(() => {
      setIndex((i) => (i + 1) % allFrames.length);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [playing, index, allFrames.length, settings.map.frameDurationMs, settings.map.lastFrameHoldMs]);

  // --- Marcadores y círculos ---------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const group = overlaysRef.current;
    if (!map || !group) return;
    group.clearLayers();

    for (const location of locations) {
      const active = location.id === point?.locationId;
      L.circleMarker([location.lat, location.lon], {
        radius: active ? 7 : 5,
        color: 'var(--marker-stroke)',
        weight: 2,
        fillColor: location.alarm.enabled ? 'var(--marker-on)' : 'var(--marker-off)',
        fillOpacity: 1,
      })
        .bindTooltip(location.name, { direction: 'top' })
        .on('click', () =>
          setPoint({ lat: location.lat, lon: location.lon, name: location.name, locationId: location.id }),
        )
        .addTo(group);

      if (settings.map.showRadius && active) {
        L.circle([location.lat, location.lon], {
          radius: location.alarm.radiusKm * 1000,
          color: 'var(--marker-on)',
          weight: 1.5,
          fill: false,
          dashArray: '6 6',
        }).addTo(group);
      }
    }

    if (point) {
      L.marker([point.lat, point.lon], {
        icon: L.divIcon({
          className: 'point-marker',
          html: '<span></span>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
        interactive: false,
      }).addTo(group);

      if (settings.map.showRadius && !point.locationId && analysis) {
        L.circle([point.lat, point.lon], {
          radius: analysis.radiusKm * 1000,
          color: 'var(--marker-point)',
          weight: 1.2,
          fill: false,
          dashArray: '4 8',
        }).addTo(group);
      }
    }

    // Flecha de desplazamiento del sistema precipitante.
    if (settings.map.showMotionArrow && point && analysis?.motion && analysis.motion.speedKmh > 2) {
      const { motion } = analysis;
      const hours = 1;
      const dLat = (motion.north * hours) / 110.574;
      const dLon = (motion.east * hours) / (111.32 * Math.cos((point.lat * Math.PI) / 180));
      L.polyline(
        [
          [point.lat, point.lon],
          [point.lat + dLat, point.lon + dLon],
        ],
        { color: 'var(--marker-point)', weight: 3, opacity: 0.85 },
      )
        .bindTooltip(`${Math.round(motion.speedKmh)} km/h`, { direction: 'center' })
        .addTo(group);
    }
  }, [locations, point, analysis, settings.map.showRadius, settings.map.showMotionArrow, setPoint]);

  // Centrar al cambiar de punto.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !point) return;
    map.setView([point.lat, point.lon], Math.max(map.getZoom(), 8), { animate: true });
  }, [point?.lat, point?.lon]);

  // --- Acciones sobre el mapa ---------------------------------------------
  const search = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const term = query.trim();
    if (term.length < 2) return;
    setSearching(true);
    try {
      const found = await api.geocode(term, settings.language);
      setResults(found.results);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const choose = (result: GeocodeResult): void => {
    setPoint({ lat: result.lat, lon: result.lon, name: result.name });
    setResults([]);
    setQuery('');
  };

  const locate = async (): Promise<void> => {
    setLocating(true);
    setLocateFailed(false);
    try {
      if (!(await locateMe())) setLocateFailed(true);
    } finally {
      setLocating(false);
    }
  };

  const watchPoint = async (): Promise<void> => {
    if (!point || point.locationId) return;
    setSaving(true);
    try {
      const created = await api.createLocation({ name: point.name, lat: point.lat, lon: point.lon });
      await reloadLocations();
      setPoint({ ...point, locationId: created.id });
    } catch {
      /* si falla, la ubicación puede añadirse desde el panel de alarmas */
    } finally {
      setSaving(false);
    }
  };

  // --- Datos derivados de la barra de tiempo -------------------------------
  const currentFrame = allFrames[index];
  const isNowcast = currentFrame?.kind === 'nowcast';
  const nowIndex = Math.max(0, pastCount - 1);
  const nowTime = allFrames[nowIndex]?.time;

  const timeLabel = currentFrame
    ? new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: settings.units.clock === '12h',
      }).format(new Date(currentFrame.time))
    : '--:--';

  const offsetMinutes =
    currentFrame && nowTime ? Math.round((currentFrame.time - nowTime) / 60_000) : 0;
  const offsetLabel =
    offsetMinutes === 0
      ? strings.now
      : `${offsetMinutes < 0 ? '−' : '+'}${Math.abs(offsetMinutes)} ${strings.minutes}`;

  // Que no haya ecos se dice de forma explícita: un radar en calma y una capa
  // que no ha cargado se ven igual, y eso desconcierta.
  const noEchoes = Boolean(analysis && !analysis.overhead && !analysis.nearest);

  const setMap = (patch: Partial<typeof settings.map>): void => {
    void updateSettings({ map: { ...settings.map, ...patch } });
  };

  return (
    <div
      className={`radar-map ${darkBase ? 'is-darkbase' : ''} ${
        settings.map.blend === 'blend' ? 'is-blend' : ''
      }`}
      style={{ height }}
    >
      <div ref={containerRef} className="radar-map__canvas" />

      <div className="radar-map__top">
        <form className="mapsearch" onSubmit={(e) => void search(e)} role="search">
          <input
            type="search"
            className="mapsearch__input"
            placeholder={strings.searchPlaceShort}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={strings.searchPlaceShort}
          />
          <button
            type="submit"
            className="mapsearch__btn"
            disabled={searching}
            aria-label={strings.searchPlaceShort}
          >
            {searching ? '…' : '⌕'}
          </button>
          <button
            type="button"
            className="mapsearch__btn"
            onClick={() => void locate()}
            disabled={locating}
            title={strings.locateMe}
            aria-label={strings.locateMe}
          >
            {locating ? '…' : '⌖'}
          </button>
        </form>

        {results.length > 0 && (
          <ul className="mapsearch__results">
            {results.map((result) => (
              <li key={`${result.lat},${result.lon}`}>
                <button type="button" onClick={() => choose(result)}>
                  <strong>{result.name}</strong>
                  <em>{[result.admin1, result.country].filter(Boolean).join(' · ')}</em>
                </button>
              </li>
            ))}
          </ul>
        )}

        {locateFailed && <p className="radar-map__notice">{strings.locationUnavailable}</p>}
      </div>

      <div className="radar-map__badges">
        {isNowcast && <span className="badge badge--accent">{strings.extrapolated}</span>}
        {framesError && <span className="badge badge--error">{strings.unknown}</span>}
        {noEchoes && !isNowcast && !framesError && (
          <span className="badge">{strings.noEchoesInView}</span>
        )}
        {point && !point.locationId && (
          <button
            type="button"
            className="badge badge--action"
            onClick={() => void watchPoint()}
            disabled={saving}
          >
            {saving ? '…' : `＋ ${strings.watchThisPoint}`}
          </button>
        )}
      </div>

      <div className={`maptools ${layersOpen ? 'is-open' : ''}`}>
        <button
          type="button"
          className="maptools__toggle"
          onClick={() => setLayersOpen((open) => !open)}
          aria-expanded={layersOpen}
        >
          ☰ {strings.layers}
        </button>

        {layersOpen && (
          <div className="maptools__panel glass">
            {/* --- Capa de precipitación --- */}
            <p className="maptools__group">{strings.precipLayer}</p>

            <label className="maptools__row">
              <span>
                {strings.opacity} <em>{Math.round(settings.map.opacity * 100)} %</em>
              </span>
              <input
                type="range"
                min={20}
                max={100}
                step={5}
                value={Math.round(settings.map.opacity * 100)}
                onChange={(e) => setMap({ opacity: Number(e.target.value) / 100 })}
                className="slider"
              />
            </label>

            <div className="maptools__row">
              <span>{strings.blendMode}</span>
              <div className="chips">
                <button
                  type="button"
                  className={`chip ${settings.map.blend === 'plain' ? 'is-active' : ''}`}
                  onClick={() => setMap({ blend: 'plain' })}
                  title={strings.blendPlainHelp}
                >
                  {strings.blendPlain}
                </button>
                <button
                  type="button"
                  className={`chip ${settings.map.blend === 'blend' ? 'is-active' : ''}`}
                  onClick={() => setMap({ blend: 'blend' })}
                  title={strings.blendSoftHelp}
                >
                  {strings.blendSoft}
                </button>
              </div>
            </div>

            <label className="maptools__row">
              <span>{strings.colorScheme}</span>
              <select
                className="input"
                value={settings.map.colorScheme}
                onChange={(e) => setMap({ colorScheme: Number(e.target.value) })}
              >
                {(meta?.colorSchemes ?? []).map((scheme) => (
                  <option key={scheme.id} value={scheme.id}>
                    {scheme.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="maptools__toggles">
              <label className="maptools__check">
                <input
                  type="checkbox"
                  checked={settings.map.smooth}
                  onChange={(e) => setMap({ smooth: e.target.checked })}
                />
                {strings.smoothing}
              </label>
              <label className="maptools__check">
                <input
                  type="checkbox"
                  checked={settings.map.showSnow}
                  onChange={(e) => setMap({ showSnow: e.target.checked })}
                />
                {strings.showSnow}
              </label>
              <label className="maptools__check">
                <input
                  type="checkbox"
                  checked={settings.map.showCoverage}
                  onChange={(e) => setMap({ showCoverage: e.target.checked })}
                />
                {strings.showCoverage}
              </label>
            </div>

            {/* --- Tiempo animado --- */}
            <p className="maptools__group">{strings.timeSpan}</p>

            <div className="maptools__row">
              <span>{strings.historySpan}</span>
              <div className="chips">
                {HISTORY_CHOICES.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    className={`chip ${settings.map.historyMinutes === minutes ? 'is-active' : ''}`}
                    onClick={() => setMap({ historyMinutes: minutes })}
                  >
                    {minutes < 60 ? `${minutes} ${strings.minutes}` : `${minutes / 60} ${strings.hours}`}
                  </button>
                ))}
              </div>
            </div>

            {/* El proveedor no siempre publica extrapolación: cuando no la hay,
                se dice, en vez de ofrecer un interruptor que no hace nada. */}
            {frames && frames.nowcast.length > 0 ? (
              <label className="maptools__check">
                <input
                  type="checkbox"
                  checked={settings.map.showNowcast}
                  onChange={(e) => setMap({ showNowcast: e.target.checked })}
                />
                {strings.includeNowcast}
              </label>
            ) : (
              <p className="maptools__note">{strings.noNowcastAvailable}</p>
            )}

            <div className="maptools__row">
              <span>{strings.animationSpeed}</span>
              <div className="chips">
                {SPEED_CHOICES.map((choice) => (
                  <button
                    key={choice.key}
                    type="button"
                    className={`chip ${
                      settings.map.frameDurationMs === choice.ms ? 'is-active' : ''
                    }`}
                    onClick={() => setMap({ frameDurationMs: choice.ms })}
                  >
                    {strings.speeds[choice.key]}
                  </button>
                ))}
              </div>
            </div>

            <p className="maptools__note">
              {strings.framesShown(allFrames.length, Math.round(settings.map.historyMinutes))}
            </p>
          </div>
        )}
      </div>

      <div className="radar-map__controls">
        <button
          type="button"
          className="radar-map__play"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? strings.pause : strings.play}
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <div className="radar-map__track">
          <input
            type="range"
            min={0}
            max={Math.max(0, allFrames.length - 1)}
            value={index}
            onChange={(e) => {
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
            className="radar-map__scrub"
            aria-label={strings.radarTitle}
            aria-valuetext={`${timeLabel} · ${offsetLabel}`}
          />
          {allFrames.length > 1 && (
            <span
              className="radar-map__nowmark"
              style={{ left: `${(nowIndex / (allFrames.length - 1)) * 100}%` }}
              title={strings.now}
              aria-hidden="true"
            />
          )}
        </div>

        <span
          className={`radar-map__time ${isNowcast ? 'is-nowcast' : ''}`}
          title={isNowcast ? strings.frameForecast : strings.frameObserved}
        >
          <strong>{timeLabel}</strong>
          <em>{offsetLabel}</em>
        </span>
      </div>

      {legend && (
        <div className={`legend ${legendOpen ? 'is-open' : ''}`}>
          <button
            type="button"
            className="legend__toggle"
            onClick={() => setLegendOpen((open) => !open)}
            aria-expanded={legendOpen}
          >
            {strings.legend}
          </button>

          {legendOpen && (
            <div className="legend__panel glass">
              <h4>{strings.legendTitle} · mm/h</h4>

              <div className="legend__row">
                <span className="legend__kind">{strings.rain}</span>
                <div className="legend__scale">
                  {legend.stops.map((stop) => (
                    <span
                      key={stop.dbz}
                      className="legend__swatch"
                      style={{ background: stop.rain }}
                      title={`${stop.dbz} dBZ · ${stop.mmPerHour} mm/h${stop.label ? ` · ${stop.label}` : ''}`}
                    />
                  ))}
                </div>
              </div>

              {legend.snowDistinguishable && settings.map.showSnow && (
                <div className="legend__row">
                  <span className="legend__kind">{strings.snow}</span>
                  <div className="legend__scale">
                    {legend.stops.map((stop) => (
                      <span
                        key={stop.dbz}
                        className="legend__swatch"
                        style={{ background: stop.snow ?? 'transparent' }}
                        title={`${stop.dbz} dBZ`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/*
                Sólo se rotulan los escalones que coinciden con un umbral de
                alarma. Van posicionados en términos absolutos y centrados sobre
                su muestra, para que las etiquetas puedan solaparse visualmente
                sin comprimir la escala.
              */}
              <div className="legend__ticks">
                {legend.stops.map((stop, i) =>
                  stop.label ? (
                    <span
                      key={stop.dbz}
                      style={{ left: `${((i + 0.5) / legend.stops.length) * 100}%` }}
                      title={`${stop.label} · ${stop.dbz} dBZ`}
                    >
                      {stop.mmPerHour}
                    </span>
                  ) : null,
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
