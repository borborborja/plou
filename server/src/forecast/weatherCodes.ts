/**
 * Códigos meteorológicos WMO 4677 (los que usa Open-Meteo) traducidos a una
 * clave de icono y a texto en los idiomas de la interfaz.
 */

export interface WeatherCodeInfo {
  icon: string;
  es: string;
  ca: string;
  en: string;
}

const TABLE: Record<number, WeatherCodeInfo> = {
  0: { icon: 'clear', es: 'Despejado', ca: 'Serè', en: 'Clear sky' },
  1: { icon: 'mostly-clear', es: 'Poco nuboso', ca: 'Poc ennuvolat', en: 'Mainly clear' },
  2: { icon: 'partly-cloudy', es: 'Parcialmente nuboso', ca: 'Parcialment ennuvolat', en: 'Partly cloudy' },
  3: { icon: 'overcast', es: 'Cubierto', ca: 'Cobert', en: 'Overcast' },
  45: { icon: 'fog', es: 'Niebla', ca: 'Boira', en: 'Fog' },
  48: { icon: 'fog', es: 'Niebla engelante', ca: 'Boira gebradora', en: 'Depositing rime fog' },
  51: { icon: 'drizzle', es: 'Llovizna débil', ca: 'Plugim feble', en: 'Light drizzle' },
  53: { icon: 'drizzle', es: 'Llovizna', ca: 'Plugim', en: 'Moderate drizzle' },
  55: { icon: 'drizzle', es: 'Llovizna intensa', ca: 'Plugim intens', en: 'Dense drizzle' },
  56: { icon: 'freezing-drizzle', es: 'Llovizna helada', ca: 'Plugim gelat', en: 'Light freezing drizzle' },
  57: { icon: 'freezing-drizzle', es: 'Llovizna helada intensa', ca: 'Plugim gelat intens', en: 'Dense freezing drizzle' },
  61: { icon: 'rain', es: 'Lluvia débil', ca: 'Pluja feble', en: 'Slight rain' },
  63: { icon: 'rain', es: 'Lluvia', ca: 'Pluja', en: 'Moderate rain' },
  65: { icon: 'heavy-rain', es: 'Lluvia fuerte', ca: 'Pluja forta', en: 'Heavy rain' },
  66: { icon: 'freezing-rain', es: 'Lluvia helada', ca: 'Pluja gelada', en: 'Light freezing rain' },
  67: { icon: 'freezing-rain', es: 'Lluvia helada fuerte', ca: 'Pluja gelada forta', en: 'Heavy freezing rain' },
  71: { icon: 'snow', es: 'Nevada débil', ca: 'Nevada feble', en: 'Slight snowfall' },
  73: { icon: 'snow', es: 'Nevada', ca: 'Nevada', en: 'Moderate snowfall' },
  75: { icon: 'heavy-snow', es: 'Nevada intensa', ca: 'Nevada intensa', en: 'Heavy snowfall' },
  77: { icon: 'snow', es: 'Cinarra', ca: 'Neu granulada', en: 'Snow grains' },
  80: { icon: 'showers', es: 'Chubascos débiles', ca: 'Ruixats febles', en: 'Slight rain showers' },
  81: { icon: 'showers', es: 'Chubascos', ca: 'Ruixats', en: 'Moderate rain showers' },
  82: { icon: 'heavy-showers', es: 'Chubascos fuertes', ca: 'Ruixats forts', en: 'Violent rain showers' },
  85: { icon: 'snow-showers', es: 'Chubascos de nieve', ca: 'Ruixats de neu', en: 'Slight snow showers' },
  86: { icon: 'snow-showers', es: 'Chubascos de nieve intensos', ca: 'Ruixats de neu intensos', en: 'Heavy snow showers' },
  95: { icon: 'thunderstorm', es: 'Tormenta', ca: 'Tempesta', en: 'Thunderstorm' },
  96: { icon: 'thunderstorm-hail', es: 'Tormenta con granizo', ca: 'Tempesta amb calamarsa', en: 'Thunderstorm with slight hail' },
  99: { icon: 'thunderstorm-hail', es: 'Tormenta con granizo fuerte', ca: 'Tempesta amb calamarsa forta', en: 'Thunderstorm with heavy hail' },
};

const UNKNOWN: WeatherCodeInfo = { icon: 'unknown', es: 'Sin datos', ca: 'Sense dades', en: 'No data' };

export function weatherCodeInfo(code: number | null | undefined): WeatherCodeInfo {
  if (code === null || code === undefined) return UNKNOWN;
  return TABLE[code] ?? UNKNOWN;
}

export function weatherIcon(code: number | null | undefined): string {
  return weatherCodeInfo(code).icon;
}

export function weatherText(code: number | null | undefined, lang: string): string {
  const info = weatherCodeInfo(code);
  if (lang === 'ca') return info.ca;
  if (lang === 'en') return info.en;
  return info.es;
}

/** Tabla completa, para que el cliente pueda traducir sin pedir nada al servidor. */
export function weatherCodeTable(): Record<number, WeatherCodeInfo> {
  return TABLE;
}
