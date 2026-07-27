import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearForecastCache, listProviders } from '../src/forecast/index.js';
import { openMeteoProvider } from '../src/forecast/openmeteo.js';
import { symbolToIcon } from '../src/forecast/foreca.js';
import { weatherCodeInfo, weatherIcon, weatherText } from '../src/forecast/weatherCodes.js';

/** Marca de tiempo local (sin zona) tal y como la devuelve Open-Meteo. */
function localStamp(offsetMinutes: number, utcOffsetSeconds: number): string {
  const ms = Date.now() + offsetMinutes * 60_000 + utcOffsetSeconds * 1000;
  return new Date(ms).toISOString().slice(0, 16);
}

const UTC_OFFSET = 7200;

function fakeResponse(): unknown {
  return {
    latitude: 41.375,
    longitude: 2.125,
    timezone: 'Europe/Madrid',
    utc_offset_seconds: UTC_OFFSET,
    elevation: 25,
    current: {
      time: localStamp(0, UTC_OFFSET),
      temperature_2m: 21.5,
      relative_humidity_2m: 60,
      apparent_temperature: 21,
      is_day: 1,
      precipitation: 0.2,
      rain: 0.2,
      snowfall: 0,
      weather_code: 61,
      cloud_cover: 80,
      pressure_msl: 1012,
      wind_speed_10m: 14,
      wind_direction_10m: 200,
      wind_gusts_10m: 30,
    },
    minutely_15: {
      // Dos intervalos ya pasados y tres futuros: sólo deben quedar los vigentes.
      time: [-60, -30, 0, 15, 30].map((m) => localStamp(m, UTC_OFFSET)),
      precipitation: [1, 2, 0.4, 0.8, 0],
      rain: [1, 2, 0.4, 0.8, 0],
      snowfall: [0, 0, 0, 0, 0],
      weather_code: [61, 61, 61, 61, 3],
      precipitation_probability: [90, 80, 70, 60, 20],
    },
    hourly: {
      // Dos horas pasadas (fuera de la tolerancia de 60 min) y tres vigentes.
      time: [-180, -120, -30, 30, 90].map((m) => localStamp(m, UTC_OFFSET)),
      temperature_2m: [18, 19, 20, 21, 22],
      apparent_temperature: [18, 19, 20, 21, 22],
      relative_humidity_2m: [70, 68, 65, 60, 58],
      dew_point_2m: [12, 12, 13, 13, 14],
      precipitation_probability: [10, 20, 30, 40, 50],
      precipitation: [0, 0, 0.1, 0.4, 0.2],
      rain: [0, 0, 0.1, 0.4, 0.2],
      showers: [0, 0, 0, 0, 0],
      snowfall: [0, 0, 0, 0, 0],
      weather_code: [3, 3, 61, 61, 80],
      cloud_cover: [50, 60, 80, 85, 70],
      visibility: [24000, 22000, 18000, 15000, 20000],
      wind_speed_10m: [10, 11, 12, 14, 15],
      wind_direction_10m: [180, 190, 200, 205, 210],
      wind_gusts_10m: [20, 22, 25, 30, 32],
      uv_index: [1, 2, 3, 4, 3],
      pressure_msl: [1014, 1013, 1013, 1012, 1011],
      is_day: [1, 1, 1, 1, 1],
    },
    daily: {
      time: ['2025-07-15', '2025-07-16'],
      weather_code: [61, 3],
      temperature_2m_max: [24, 27],
      temperature_2m_min: [17, 18],
      apparent_temperature_max: [25, 28],
      apparent_temperature_min: [17, 18],
      sunrise: ['2025-07-15T06:35', '2025-07-16T06:36'],
      sunset: ['2025-07-15T21:25', '2025-07-16T21:24'],
      daylight_duration: [53400, 53300],
      sunshine_duration: [40000, 48000],
      uv_index_max: [7, 8],
      precipitation_sum: [3.2, 0],
      rain_sum: [1.2, 0],
      showers_sum: [2, 0],
      snowfall_sum: [0, 0],
      precipitation_hours: [4, 0],
      precipitation_probability_max: [70, 10],
      wind_speed_10m_max: [20, 18],
      wind_gusts_10m_max: [40, 35],
      wind_direction_10m_dominant: [200, 190],
    },
  };
}

describe('proveedor Open-Meteo', () => {
  beforeEach(() => {
    clearForecastCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(fakeResponse()), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normaliza la respuesta al modelo común', async () => {
    const forecast = await openMeteoProvider.fetch({ lat: 41.39, lon: 2.17, days: 2, hours: 5 });

    expect(forecast.provider).toBe('openmeteo');
    expect(forecast.place.timezone).toBe('Europe/Madrid');
    expect(forecast.place.utcOffsetSeconds).toBe(UTC_OFFSET);

    expect(forecast.current?.temperature).toBe(21.5);
    expect(forecast.current?.icon).toBe('rain');
    expect(forecast.current?.isDay).toBe(true);
    // Visibilidad, UV y punto de rocío se completan con la primera hora.
    expect(forecast.current?.visibility).not.toBeNull();
    expect(forecast.current?.uvIndex).not.toBeNull();
  });

  it('descarta los intervalos de 15 minutos que ya han pasado', async () => {
    const forecast = await openMeteoProvider.fetch({ lat: 41.39, lon: 2.17 });
    // El intervalo en curso se conserva; los dos anteriores no.
    expect(forecast.minutely.length).toBeLessThanOrEqual(3);
    expect(forecast.minutely[0]?.precipitation).toBe(0.4);
    expect(forecast.minutely[0]?.probability).toBe(70);
  });

  it('empieza la serie horaria en la hora en curso', async () => {
    const forecast = await openMeteoProvider.fetch({ lat: 41.39, lon: 2.17, hours: 5 });
    expect(forecast.hourly.length).toBeLessThanOrEqual(3);
    expect(forecast.hourly[0]?.temperature).toBe(20);
    expect(forecast.hourly[0]?.icon).toBe('rain');
  });

  it('suma chubascos y lluvia en el acumulado diario', async () => {
    const forecast = await openMeteoProvider.fetch({ lat: 41.39, lon: 2.17, days: 2 });
    expect(forecast.daily).toHaveLength(2);
    expect(forecast.daily[0]?.rainSum).toBe(3.2);
    expect(forecast.daily[0]?.icon).toBe('rain');
    expect(forecast.daily[1]?.icon).toBe('overcast');
  });

  it('propaga los errores del servicio', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: true, reason: 'fuera de rango' }), { status: 200 })),
    );
    await expect(openMeteoProvider.fetch({ lat: 0, lon: 0 })).rejects.toThrow('fuera de rango');
  });
});

describe('registro de proveedores', () => {
  it('Open-Meteo está siempre disponible y Foreca sólo con credenciales', () => {
    const providers = listProviders();
    const openmeteo = providers.find((p) => p.id === 'openmeteo');
    const foreca = providers.find((p) => p.id === 'foreca');
    expect(openmeteo?.available).toBe(true);
    expect(foreca?.available).toBe(false);
    expect(foreca?.reason).toContain('licencia');
  });
});

describe('símbolos de Foreca', () => {
  it('traduce los símbolos a claves de icono', () => {
    expect(symbolToIcon('d000')).toBe('clear');
    expect(symbolToIcon('n000')).toBe('clear');
    expect(symbolToIcon('d400')).toBe('overcast');
    expect(symbolToIcon('d410')).toBe('showers');
    expect(symbolToIcon('d210')).toBe('rain');
    expect(symbolToIcon('d430')).toBe('snow-showers');
    expect(symbolToIcon('d411')).toBe('thunderstorm');
    expect(symbolToIcon(null)).toBe('unknown');
    expect(symbolToIcon('xx')).toBe('unknown');
  });
});

describe('códigos meteorológicos', () => {
  it('traduce a los tres idiomas', () => {
    expect(weatherText(0, 'es')).toBe('Despejado');
    expect(weatherText(0, 'ca')).toBe('Serè');
    expect(weatherText(0, 'en')).toBe('Clear sky');
  });

  it('devuelve un icono conocido para cada código de la tabla', () => {
    for (const code of [0, 3, 45, 51, 61, 71, 80, 95, 99]) {
      expect(weatherIcon(code)).not.toBe('unknown');
    }
  });

  it('gestiona los códigos desconocidos sin fallar', () => {
    expect(weatherCodeInfo(1234).icon).toBe('unknown');
    expect(weatherCodeInfo(null).icon).toBe('unknown');
  });
});
