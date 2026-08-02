import { PNG } from 'pngjs';
import { config } from '../config.js';

export type MapLayerId = 'satellite' | 'clouds' | 'lightning';
export type SatelliteVariant = 'geocolour' | 'visible' | 'infra';
export type MapFrameKind = 'observed' | 'forecast' | 'aggregate';

export interface MapFrame {
  id: string;
  time: number;
  validFrom: number;
  validTo: number;
  kind: MapFrameKind;
  template: string;
  attribution: string;
}

export interface LayerCapability {
  id: MapLayerId;
  configured: boolean;
  coverage: 'global' | 'eumet-disc' | 'spain';
  timeDomain: 'past' | 'forecast' | 'aggregate';
  variants: string[];
  attribution: string;
  note?: string;
}

const SATELLITE_LAYERS: Record<SatelliteVariant, string> = {
  geocolour: 'mtg_fd:rgb_geocolour',
  visible: 'mtg_fd:vis06_hrfi',
  infra: 'mtg_fd:ir105_hrfi',
};

const tileCache = new Map<string, { body: Buffer; contentType: string }>();

function putTile(key: string, value: { body: Buffer; contentType: string }): void {
  tileCache.delete(key);
  tileCache.set(key, value);
  while (tileCache.size > config.mapLayers.tileCacheSize) {
    const oldest = tileCache.keys().next().value as string | undefined;
    if (!oldest) break;
    tileCache.delete(oldest);
  }
}

async function fetchBytes(url: URL): Promise<{ body: Buffer; contentType: string }> {
  const response = await fetch(url, {
    headers: { accept: 'image/png,image/jpeg', 'user-agent': config.userAgent },
    signal: AbortSignal.timeout(config.mapLayers.tileTimeoutMs),
  });
  if (!response.ok) throw new Error(`Capa meteorológica: HTTP ${response.status}`);
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type')?.split(';')[0] ?? 'image/png',
  };
}

export function layerCapabilities(): LayerCapability[] {
  return [
    {
      id: 'satellite',
      configured: true,
      coverage: 'eumet-disc',
      timeDomain: 'past',
      variants: Object.keys(SATELLITE_LAYERS),
      attribution: '© EUMETSAT',
    },
    {
      id: 'clouds',
      configured: Boolean(config.mapLayers.openWeatherKey),
      coverage: 'global',
      timeDomain: 'forecast',
      variants: ['total'],
      attribution: '© OpenWeather',
      note: config.mapLayers.openWeatherKey ? undefined : 'Falta PLOU_OPENWEATHER_API_KEY',
    },
    {
      id: 'lightning',
      configured: Boolean(config.mapLayers.aemetKey),
      coverage: 'spain',
      timeDomain: 'aggregate',
      variants: ['aemet-12h'],
      attribution: 'Fuente: AEMET',
      note: config.mapLayers.aemetKey ? undefined : 'Falta PLOU_AEMET_API_KEY',
    },
  ];
}

function frameTemplate(layer: MapLayerId, variant: string, id: string): string {
  return `/api/map/tiles/${layer}/${variant}/${id}/{z}/{x}/{y}.png`;
}

export function satelliteFrames(variant: SatelliteVariant): MapFrame[] {
  const step = 10 * 60_000;
  // El producto necesita unos minutos para publicarse: no anunciamos el slot
  // que acaba de empezar porque produciría un fotograma vacío/404.
  const current = Math.floor(Date.now() / step) * step - step;
  const first = current - config.mapLayers.satelliteHistoryMinutes * 60_000;
  const frames: MapFrame[] = [];
  for (let time = first; time <= current; time += step) {
    const id = String(time);
    frames.push({
      id,
      time,
      validFrom: time,
      validTo: time + step,
      kind: 'observed',
      template: frameTemplate('satellite', variant, id),
      attribution: '© EUMETSAT',
    });
  }
  return frames;
}

export function cloudFrames(): MapFrame[] {
  if (!config.mapLayers.openWeatherKey) return [];
  const step = 3 * 60 * 60_000;
  const current = Math.floor(Date.now() / step) * step;
  return Array.from({ length: 81 }, (_, index) => {
    const time = current + index * step;
    const id = String(time);
    return {
      id,
      time,
      validFrom: time,
      validTo: time + step,
      kind: 'forecast' as const,
      template: frameTemplate('clouds', 'total', id),
      attribution: '© OpenWeather',
    };
  });
}

function xyzBounds(z: number, x: number, y: number): [number, number, number, number] {
  const world = 20_037_508.342789244;
  const size = (world * 2) / 2 ** z;
  const minX = -world + x * size;
  const maxX = minX + size;
  const maxY = world - y * size;
  const minY = maxY - size;
  return [minX, minY, maxX, maxY];
}

function satelliteUrl(variant: SatelliteVariant, time: number, z: number, x: number, y: number): URL {
  const url = new URL(config.mapLayers.eumetWmsUrl);
  url.search = new URLSearchParams({
    service: 'WMS',
    request: 'GetMap',
    version: '1.1.1',
    layers: SATELLITE_LAYERS[variant],
    styles: '',
    format: 'image/png',
    transparent: 'true',
    srs: 'EPSG:3857',
    bbox: xyzBounds(z, x, y).join(','),
    width: '256',
    height: '256',
    time: new Date(time).toISOString(),
  }).toString();
  return url;
}

function cloudUrl(time: number, z: number, x: number, y: number): URL {
  const base = config.mapLayers.openWeatherTilesUrl.replace(/\/$/, '');
  const url = new URL(`${base}/CL/${z}/${x}/${y}`);
  url.search = new URLSearchParams({
    date: String(Math.floor(time / 1000)),
    opacity: '1',
    fill_bound: 'true',
    appid: config.mapLayers.openWeatherKey,
  }).toString();
  return url;
}

interface AemetEnvelope {
  datos?: string;
  descripcion?: string;
  estado?: number;
}

interface LightningSnapshot {
  fetchedAt: number;
  updatedAt: number;
  image: PNG;
  sourceUrl: string;
}

let lightningCache: LightningSnapshot | null = null;
let lightningInFlight: Promise<LightningSnapshot> | null = null;

async function loadLightning(): Promise<LightningSnapshot> {
  if (!config.mapLayers.aemetKey) throw new Error('Capa de rayos no configurada');
  if (lightningCache && Date.now() - lightningCache.fetchedAt < 10 * 60_000) return lightningCache;
  if (lightningInFlight) return lightningInFlight;

  lightningInFlight = (async () => {
    const endpoint = new URL(config.mapLayers.aemetUrl);
    endpoint.searchParams.set('api_key', config.mapLayers.aemetKey);
    const envelopeResponse = await fetch(endpoint, {
      headers: { accept: 'application/json', 'user-agent': config.userAgent },
      signal: AbortSignal.timeout(config.mapLayers.tileTimeoutMs),
    });
    if (!envelopeResponse.ok) throw new Error(`AEMET: HTTP ${envelopeResponse.status}`);
    const envelope = (await envelopeResponse.json()) as AemetEnvelope;
    if (!envelope.datos) throw new Error(envelope.descripcion ?? 'AEMET no devolvió el mapa de rayos');
    const dataUrl = new URL(envelope.datos);
    if (dataUrl.protocol !== 'https:' || dataUrl.hostname !== 'opendata.aemet.es') {
      throw new Error('AEMET devolvió una URL de datos no autorizada');
    }
    const imageResponse = await fetch(dataUrl, {
      headers: { accept: 'image/png', 'user-agent': config.userAgent },
      signal: AbortSignal.timeout(config.mapLayers.tileTimeoutMs),
    });
    if (!imageResponse.ok) throw new Error(`Mapa AEMET: HTTP ${imageResponse.status}`);
    const body = Buffer.from(await imageResponse.arrayBuffer());
    let image: PNG;
    try {
      image = PNG.sync.read(body);
    } catch {
      throw new Error('El mapa de rayos AEMET ya no tiene el formato PNG esperado');
    }
    if (image.width < 200 || image.height < 200) throw new Error('Mapa AEMET con dimensiones inesperadas');
    const updatedAt = Date.parse(imageResponse.headers.get('last-modified') ?? '') || Date.now();
    const snapshot = { fetchedAt: Date.now(), updatedAt, image, sourceUrl: dataUrl.toString() };
    lightningCache = snapshot;
    return snapshot;
  })().finally(() => {
    lightningInFlight = null;
  });
  return lightningInFlight;
}

function lonLatForTilePixel(z: number, x: number, y: number, px: number, py: number): [number, number] {
  const scale = 2 ** z * 256;
  const worldX = (x * 256 + px) / scale;
  const worldY = (y * 256 + py) / scale;
  const lon = worldX * 360 - 180;
  const n = Math.PI - 2 * Math.PI * worldY;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return [lon, lat];
}

function lightningPixel(image: PNG, sx: number, sy: number): [number, number, number, number] {
  const offset = (sy * image.width + sx) * 4;
  const r = image.data[offset] ?? 0;
  const g = image.data[offset + 1] ?? 0;
  const b = image.data[offset + 2] ?? 0;
  const a = image.data[offset + 3] ?? 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  // El producto AEMET dibuja los impactos por antigüedad con colores vivos.
  // Fondo, costas, texto y retícula son grises o poco saturados y se eliminan.
  return a > 0 && max > 70 && saturation > 0.32 ? [r, g, b, 235] : [0, 0, 0, 0];
}

function sourcePixel(image: PNG, lon: number, lat: number): [number, number] | null {
  const [west, south, east, north] = config.mapLayers.aemetBounds;
  if (west === undefined || south === undefined || east === undefined || north === undefined) return null;
  if (lon < west || lon > east || lat < south || lat > north) return null;
  const [cropX, cropY, cropW, cropH] = config.mapLayers.aemetCrop;
  if (cropX === undefined || cropY === undefined || cropW === undefined || cropH === undefined) return null;
  const u = cropX + ((lon - west) / (east - west)) * cropW;
  const v = cropY + ((north - lat) / (north - south)) * cropH;
  return [
    Math.max(0, Math.min(image.width - 1, Math.round(u * (image.width - 1)))),
    Math.max(0, Math.min(image.height - 1, Math.round(v * (image.height - 1)))),
  ];
}

async function lightningTile(z: number, x: number, y: number): Promise<{ body: Buffer; contentType: string }> {
  const { image } = await loadLightning();
  const out = new PNG({ width: 256, height: 256 });
  for (let py = 0; py < 256; py++) {
    for (let px = 0; px < 256; px++) {
      const [lon, lat] = lonLatForTilePixel(z, x, y, px + 0.5, py + 0.5);
      const source = sourcePixel(image, lon, lat);
      if (!source) continue;
      const [r, g, b, a] = lightningPixel(image, source[0], source[1]);
      const offset = (py * 256 + px) * 4;
      out.data[offset] = r;
      out.data[offset + 1] = g;
      out.data[offset + 2] = b;
      out.data[offset + 3] = a;
    }
  }
  return { body: PNG.sync.write(out), contentType: 'image/png' };
}

export async function lightningFrame(): Promise<MapFrame> {
  const snapshot = await loadLightning();
  const id = String(snapshot.updatedAt);
  return {
    id,
    time: snapshot.updatedAt,
    validFrom: snapshot.updatedAt - 12 * 60 * 60_000,
    validTo: snapshot.updatedAt,
    kind: 'aggregate',
    template: frameTemplate('lightning', 'aemet-12h', id),
    attribution: 'Fuente: AEMET',
  };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function lightningActivity(lat: number, lon: number, radiusKm: number): Promise<{
  active: boolean;
  approximate: true;
  periodHours: 12;
  updatedAt: number;
}> {
  const snapshot = await loadLightning();
  let active = false;
  for (let sy = 0; sy < snapshot.image.height && !active; sy += 2) {
    for (let sx = 0; sx < snapshot.image.width; sx += 2) {
      if (lightningPixel(snapshot.image, sx, sy)[3] === 0) continue;
      const [west, south, east, north] = config.mapLayers.aemetBounds;
      const [cropX, cropY, cropW, cropH] = config.mapLayers.aemetCrop;
      if ([west, south, east, north, cropX, cropY, cropW, cropH].some((v) => v === undefined)) break;
      const u = sx / Math.max(1, snapshot.image.width - 1);
      const v = sy / Math.max(1, snapshot.image.height - 1);
      if (u < cropX! || u > cropX! + cropW! || v < cropY! || v > cropY! + cropH!) continue;
      const pixelLon = west! + ((u - cropX!) / cropW!) * (east! - west!);
      const pixelLat = north! - ((v - cropY!) / cropH!) * (north! - south!);
      if (haversineKm(lat, lon, pixelLat, pixelLon) <= radiusKm) {
        active = true;
        break;
      }
    }
  }
  return { active, approximate: true, periodHours: 12, updatedAt: snapshot.updatedAt };
}

export async function mapTile(
  layer: MapLayerId,
  variant: string,
  frameId: string,
  z: number,
  x: number,
  y: number,
): Promise<{ body: Buffer; contentType: string }> {
  const cacheKey = `${layer}/${variant}/${frameId}/${z}/${x}/${y}`;
  const cached = tileCache.get(cacheKey);
  if (cached) return cached;

  let result: { body: Buffer; contentType: string };
  const time = Number(frameId);
  if (!Number.isFinite(time)) throw new Error('Fotograma desconocido');
  if (layer === 'satellite') {
    if (!(variant in SATELLITE_LAYERS)) throw new Error('Variante satelital desconocida');
    result = await fetchBytes(satelliteUrl(variant as SatelliteVariant, time, z, x, y));
  } else if (layer === 'clouds') {
    if (variant !== 'total') throw new Error('Variante de nubes desconocida');
    if (!config.mapLayers.openWeatherKey) throw new Error('Capa de nubes no configurada');
    result = await fetchBytes(cloudUrl(time, z, x, y));
  } else {
    if (variant !== 'aemet-12h') throw new Error('Variante de rayos desconocida');
    result = await lightningTile(z, x, y);
  }
  putTile(cacheKey, result);
  return result;
}

export function resetMapLayerCaches(): void {
  tileCache.clear();
  lightningCache = null;
  lightningInFlight = null;
}
