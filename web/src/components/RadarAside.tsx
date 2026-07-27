import { useStore } from '../store';
import { formatLocalTime, formatPrecip, formatTemperature } from '../lib/format';
import { WeatherIcon } from './WeatherIcon';

/** Ubicaciones guardadas, para saltar de una a otra sin cambiar de vista. */
export function LocationChips(): JSX.Element | null {
  const { locations, point, setPoint, strings } = useStore();
  if (locations.length === 0) return null;

  return (
    <section className="card">
      <h3 className="card__title">{strings.myLocations}</h3>
      <div className="chips">
        {locations.map((location) => (
          <button
            key={location.id}
            type="button"
            className={`chip ${location.id === point?.locationId ? 'is-active' : ''}`}
            onClick={() =>
              setPoint({
                lat: location.lat,
                lon: location.lon,
                name: location.name,
                locationId: location.id,
              })
            }
          >
            {location.alarm.enabled ? '🔔 ' : ''}
            {location.name}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Tira compacta con las próximas horas, junto al radar. */
export function NextHours(): JSX.Element | null {
  const { forecast, settings, strings } = useStore();
  const hours = forecast?.hourly?.slice(0, 12) ?? [];
  if (hours.length === 0) return null;

  return (
    <section className="card">
      <h3 className="card__title">{strings.hourly}</h3>
      <ul className="nexthours">
        {hours.map((hour) => (
          <li key={hour.time}>
            <span className="nexthours__time">
              {formatLocalTime(hour.time, settings.units, settings.language)}
            </span>
            <WeatherIcon icon={hour.icon} isDay={hour.isDay} size={22} />
            <strong>{formatTemperature(hour.temperature, settings.units)}</strong>
            <em className={(hour.precipitation ?? 0) > 0 ? 'is-wet' : ''}>
              {(hour.precipitation ?? 0) > 0
                ? formatPrecip(hour.precipitation, settings.units)
                : `${Math.round(hour.probability ?? 0)} %`}
            </em>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Contenido que acompaña al mapa: ubicaciones guardadas y previsión inmediata.
 * En pantallas anchas rellena el lateral; en móvil va bajo el resumen.
 */
export function RadarAside(): JSX.Element {
  return (
    <>
      <LocationChips />
      <NextHours />
    </>
  );
}
