import { useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  compassPoint,
  formatDayMonth,
  formatDuration,
  formatLocalTime,
  formatPercent,
  formatPrecip,
  formatPressure,
  formatSpeed,
  formatTemperature,
  formatVisibility,
  formatWeekday,
  parseLocalIso,
  uvLabel,
} from '../lib/format';
import type { DailyPoint, HourlyPoint, WeatherCodeInfo } from '../types';
import { WeatherIcon } from './WeatherIcon';

function useCodeText(): (code: number | null) => string {
  const { meta, settings } = useStore();
  return (code) => {
    if (code === null || !meta) return '';
    const info = meta.weatherCodes[String(code)] as WeatherCodeInfo | undefined;
    if (!info) return '';
    return settings.language === 'ca' ? info.ca : settings.language === 'en' ? info.en : info.es;
  };
}

/** Barras de precipitación prevista para las próximas horas (pasos de 15 min). */
function MinutelyChart(): JSX.Element | null {
  const { forecast, settings, strings } = useStore();
  const points = forecast?.minutely ?? [];
  if (points.length === 0) return null;

  const maxPrecip = Math.max(0.4, ...points.map((p) => p.precipitation));
  const anyPrecip = points.some((p) => p.precipitation > 0);

  return (
    <section className="card">
      <h3 className="card__title">{strings.next6h}</h3>
      <div className="minutely">
        {points.map((p) => {
          const height = Math.min(100, (p.precipitation / maxPrecip) * 100);
          const probability = p.probability ?? 0;
          return (
            <div
              key={p.time}
              className="minutely__col"
              title={`${p.time} · ${p.precipitation} mm · ${probability} %`}
            >
              {/* Columna de fondo: probabilidad. Barra sólida: cantidad prevista. */}
              <div className="minutely__prob" style={{ height: `${probability}%` }} />
              <div
                className={`minutely__bar ${p.snowfall && p.snowfall > 0 ? 'is-snow' : ''}`}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <p className="minutely__legend muted small">
        <span className="swatch swatch--bar" /> {strings.precipitation}
        <span className="swatch swatch--prob" /> {strings.probability}
      </p>
      <div className="minutely__axis">
        {points
          .filter((_, i) => i % 4 === 0)
          .map((p) => (
            <span key={p.time}>{formatLocalTime(p.time, settings.units, settings.language)}</span>
          ))}
      </div>
      {!anyPrecip && <p className="muted">{strings.noPrecipExpected}</p>}
    </section>
  );
}

function HourlyRow({ hour }: { hour: HourlyPoint }): JSX.Element {
  const { settings, strings } = useStore();
  const codeText = useCodeText();
  return (
    <li className="hourly__row">
      <span className="hourly__time">
        {formatLocalTime(hour.time, settings.units, settings.language)}
      </span>
      <WeatherIcon icon={hour.icon} isDay={hour.isDay} size={26} />
      <span className="hourly__temp">{formatTemperature(hour.temperature, settings.units)}</span>
      <span className="hourly__precip">
        {hour.probability !== null && hour.probability > 0 ? formatPercent(hour.probability) : '—'}
        {hour.precipitation && hour.precipitation > 0 ? (
          <em>{formatPrecip(hour.precipitation, settings.units)}</em>
        ) : null}
      </span>
      <span className="hourly__wind">
        {formatSpeed(hour.windSpeed, settings.units)}{' '}
        <em>{compassPoint(hour.windDirection, settings.language)}</em>
      </span>
      <span className="hourly__desc">{codeText(hour.weatherCode) || strings.unknown}</span>
    </li>
  );
}

function DailyRow({ day, expanded, onToggle }: { day: DailyPoint; expanded: boolean; onToggle: () => void }): JSX.Element {
  const { settings, strings } = useStore();
  const codeText = useCodeText();
  const date = parseLocalIso(`${day.date}T00:00`);
  const today = new Date();
  const isToday =
    date !== null &&
    date.getUTCFullYear() === today.getFullYear() &&
    date.getUTCMonth() === today.getMonth() &&
    date.getUTCDate() === today.getDate();

  return (
    <li className={`daily__row ${expanded ? 'is-open' : ''}`}>
      <button type="button" className="daily__head" onClick={onToggle} aria-expanded={expanded}>
        <span className="daily__day">
          {isToday ? strings.today : formatWeekday(day.date, settings.language)}
          <em>{formatDayMonth(day.date, settings.language)}</em>
        </span>
        <WeatherIcon icon={day.icon} size={28} />
        <span className="daily__precip">
          {day.probabilityMax !== null && day.probabilityMax > 0
            ? formatPercent(day.probabilityMax)
            : '—'}
        </span>
        <span className="daily__temps">
          <strong>{formatTemperature(day.temperatureMax, settings.units)}</strong>
          <em>{formatTemperature(day.temperatureMin, settings.units)}</em>
        </span>
      </button>

      {expanded && (
        <dl className="daily__detail">
          <div>
            <dt>{codeText(day.weatherCode) || strings.unknown}</dt>
            <dd />
          </div>
          <div>
            <dt>{strings.precipitation}</dt>
            <dd>{formatPrecip(day.precipitationSum, settings.units)}</dd>
          </div>
          <div>
            <dt>{strings.wind}</dt>
            <dd>
              {formatSpeed(day.windSpeedMax, settings.units)}{' '}
              {compassPoint(day.windDirectionDominant, settings.language)}
            </dd>
          </div>
          <div>
            <dt>{strings.gusts}</dt>
            <dd>{formatSpeed(day.windGustMax, settings.units)}</dd>
          </div>
          <div>
            <dt>{strings.uvIndex}</dt>
            <dd>{uvLabel(day.uvIndexMax, settings.language)}</dd>
          </div>
          <div>
            <dt>{strings.sunrise}</dt>
            <dd>
              {day.sunrise ? formatLocalTime(day.sunrise, settings.units, settings.language) : '–'}
            </dd>
          </div>
          <div>
            <dt>{strings.sunset}</dt>
            <dd>
              {day.sunset ? formatLocalTime(day.sunset, settings.units, settings.language) : '–'}
            </dd>
          </div>
          <div>
            <dt>{strings.daylight}</dt>
            <dd>{formatDuration(day.daylightSeconds, settings.language)}</dd>
          </div>
          <div>
            <dt>{strings.sunshine}</dt>
            <dd>{formatDuration(day.sunshineSeconds, settings.language)}</dd>
          </div>
        </dl>
      )}
    </li>
  );
}

export function ForecastPanel(): JSX.Element {
  const { forecast, forecastLoading, settings, strings, point, meta, updateSettings } = useStore();
  const [openDay, setOpenDay] = useState<string | null>(null);
  const codeText = useCodeText();

  const hourlyByDay = useMemo(() => {
    const groups = new Map<string, HourlyPoint[]>();
    for (const hour of forecast?.hourly ?? []) {
      const day = hour.time.slice(0, 10);
      const list = groups.get(day) ?? [];
      list.push(hour);
      groups.set(day, list);
    }
    return [...groups.entries()];
  }, [forecast?.hourly]);

  if (forecastLoading && !forecast) {
    return <p className="pad muted">{strings.loading}</p>;
  }
  if (!forecast || !point) {
    return <p className="pad muted">{strings.unknown}</p>;
  }

  const current = forecast.current;

  return (
    <div className="forecast">
      {current && (
        <section className="card current">
          <div className="current__main">
            <WeatherIcon icon={current.icon} isDay={current.isDay} size={72} />
            <div>
              <div className="current__temp">{formatTemperature(current.temperature, settings.units)}</div>
              <div className="current__desc">{codeText(current.weatherCode)}</div>
              <div className="current__place">{point.name}</div>
            </div>
          </div>

          <dl className="grid-facts">
            <div>
              <dt>{strings.feelsLike}</dt>
              <dd>{formatTemperature(current.apparentTemperature, settings.units)}</dd>
            </div>
            <div>
              <dt>{strings.humidity}</dt>
              <dd>{formatPercent(current.humidity)}</dd>
            </div>
            <div>
              <dt>{strings.wind}</dt>
              <dd>
                {formatSpeed(current.windSpeed, settings.units)}{' '}
                {compassPoint(current.windDirection, settings.language)}
              </dd>
            </div>
            <div>
              <dt>{strings.gusts}</dt>
              <dd>{formatSpeed(current.windGust, settings.units)}</dd>
            </div>
            <div>
              <dt>{strings.pressure}</dt>
              <dd>{formatPressure(current.pressure, settings.units)}</dd>
            </div>
            <div>
              <dt>{strings.cloudCover}</dt>
              <dd>{formatPercent(current.cloudCover)}</dd>
            </div>
            <div>
              <dt>{strings.visibility}</dt>
              <dd>{formatVisibility(current.visibility, settings.units)}</dd>
            </div>
            <div>
              <dt>{strings.uvIndex}</dt>
              <dd>{uvLabel(current.uvIndex, settings.language)}</dd>
            </div>
            <div>
              <dt>{strings.dewPoint}</dt>
              <dd>{formatTemperature(current.dewPoint, settings.units)}</dd>
            </div>
          </dl>
        </section>
      )}

      <MinutelyChart />

      <section className="card hourly-card">
        <div className="card__header">
          <h3 className="card__title">{strings.hourly}</h3>
        </div>
        {hourlyByDay.map(([day, hours]) => (
          <div key={day} className="hourly__group">
            <h4 className="hourly__daylabel">
              {formatWeekday(day, settings.language, true)} · {formatDayMonth(day, settings.language)}
            </h4>
            <ul className="hourly">
              {hours.map((hour) => (
                <HourlyRow key={hour.time} hour={hour} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="card daily-card">
        <h3 className="card__title">{strings.daily}</h3>
        <ul className="daily">
          {forecast.daily.map((day) => (
            <DailyRow
              key={day.date}
              day={day}
              expanded={openDay === day.date}
              onToggle={() => setOpenDay((d) => (d === day.date ? null : day.date))}
            />
          ))}
        </ul>
      </section>

      <section className="card">
        <h3 className="card__title">{strings.provider}</h3>
        <div className="chips">
          {(meta?.providers ?? []).map((provider) => (
            <button
              key={provider.id}
              type="button"
              className={`chip ${settings.forecastProvider === provider.id ? 'is-active' : ''}`}
              disabled={!provider.available}
              title={provider.reason ?? undefined}
              onClick={() => void updateSettings({ forecastProvider: provider.id })}
            >
              {provider.label}
            </button>
          ))}
        </div>
        {forecast.fallbackReason && (
          <p className="muted small">
            {strings.providerFallback} {forecast.fallbackReason}
          </p>
        )}
        <p className="muted small">{forecast.attribution}</p>
      </section>
    </div>
  );
}
