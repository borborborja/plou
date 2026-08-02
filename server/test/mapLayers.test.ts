import Fastify, { type FastifyInstance } from 'fastify';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import {
  layerCapabilities,
  lightningActivity,
  mapTile,
  resetMapLayerCaches,
  satelliteFrames,
} from '../src/map/layers.js';
import { mapRoutes } from '../src/routes/map.js';

describe('capas meteorológicas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetMapLayerCaches();
  });

  it('publica una historia satelital ordenada y tres variantes', () => {
    const frames = satelliteFrames('infra');
    expect(frames).toHaveLength(13);
    expect(frames.every((frame) => frame.kind === 'observed')).toBe(true);
    expect(frames.at(-1)!.time - frames[0]!.time).toBe(120 * 60_000);
    expect(frames.at(-1)!.template).toContain('/satellite/infra/');
    expect(layerCapabilities().find((layer) => layer.id === 'satellite')?.variants).toEqual([
      'geocolour',
      'visible',
      'infra',
    ]);
  });

  it('construye el WMS sin convertir la ruta en un proxy arbitrario', async () => {
    let requested: URL | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        requested = new URL(input.toString());
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }),
    );
    const frame = satelliteFrames('visible').at(-1)!;
    const tile = await mapTile('satellite', 'visible', frame.id, 3, 4, 2);
    expect(tile.contentType).toBe('image/png');
    expect(requested?.origin + requested?.pathname).toBe(
      new URL(config.mapLayers.eumetWmsUrl).origin + new URL(config.mapLayers.eumetWmsUrl).pathname,
    );
    expect(requested?.searchParams.get('layers')).toBe('mtg_fd:vis06_hrfi');
    expect(requested?.searchParams.get('srs')).toBe('EPSG:3857');
    expect(requested?.searchParams.get('bbox')?.split(',')).toHaveLength(4);
  });

  it('rechaza una URL de datos AEMET que no pertenezca a AEMET', async () => {
    const oldKey = config.mapLayers.aemetKey;
    config.mapLayers.aemetKey = 'test';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ datos: 'https://evil.example/rayos.png' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(lightningActivity(40, -3, 20)).rejects.toThrow('no autorizada');
    config.mapLayers.aemetKey = oldKey;
  });

  it('detecta actividad aproximada en un PNG agregado', async () => {
    const oldKey = config.mapLayers.aemetKey;
    config.mapLayers.aemetKey = 'test';
    const image = new PNG({ width: 200, height: 200 });
    // Centro aproximado del dominio, rojo saturado; el resto queda transparente.
    const offset = (100 * image.width + 100) * 4;
    image.data[offset] = 255;
    image.data[offset + 3] = 255;
    const png = PNG.sync.write(image);
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call++;
        return call === 1
          ? new Response(JSON.stringify({ datos: 'https://opendata.aemet.es/rayos.png' }), { status: 200 })
          : new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
      }),
    );
    const result = await lightningActivity(36, -7, 100);
    expect(result).toMatchObject({ active: true, approximate: true, periodHours: 12 });
    config.mapLayers.aemetKey = oldKey;
  });
});

describe('rutas de capas', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(mapRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('expone capacidades y frames normalizados', async () => {
    const layers = await app.inject({ method: 'GET', url: '/api/map/layers' });
    expect(layers.statusCode).toBe(200);
    expect(layers.json().layers.map((layer: { id: string }) => layer.id)).toEqual([
      'satellite',
      'clouds',
      'lightning',
    ]);
    const frames = await app.inject({
      method: 'GET',
      url: '/api/map/frames?layer=satellite&variant=geocolour',
    });
    expect(frames.statusCode).toBe(200);
    expect(frames.json().frames).toHaveLength(13);
  });

  it('valida variante y coordenadas antes de consultar al proveedor', async () => {
    const variant = await app.inject({
      method: 'GET',
      url: '/api/map/frames?layer=satellite&variant=desconocida',
    });
    expect(variant.statusCode).toBe(400);
    const outside = await app.inject({
      method: 'GET',
      url: `/api/map/tiles/satellite/geocolour/${Date.now()}/2/9/0.png`,
    });
    expect(outside.statusCode).toBe(404);
  });
});
