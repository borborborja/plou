import { useState } from 'react';
import { api } from '../api';
import { formatClock, formatDateTime, formatDistance } from '../lib/format';
import { useStore } from '../store';
import type { GeocodeResult, Location } from '../types';
import { AlarmEditor } from './AlarmEditor';

function LocationCard({
  location,
  onEdit,
}: {
  location: Location;
  onEdit: () => void;
}): JSX.Element {
  const { strings, settings, reloadLocations, setPoint } = useStore();
  const [busy, setBusy] = useState(false);
  const state = location.state;
  const snoozed = state?.snoozed_until && state.snoozed_until > Date.now();

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      await reloadLocations();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`loccard ${location.alarm.enabled ? 'is-on' : 'is-off'}`}>
      <button
        type="button"
        className="loccard__main"
        onClick={() =>
          setPoint({ lat: location.lat, lon: location.lon, name: location.name, locationId: location.id })
        }
      >
        <div>
          <h3>
            {location.name}
            {location.followDevice && <span className="tag">{strings.followsDevice}</span>}
          </h3>
          <p className="muted small">
            {location.alarm.enabled ? strings.alarmOn : strings.alarmOff} ·{' '}
            {formatDistance(location.alarm.radiusKm, settings.units)} ·{' '}
            {strings.intensity[location.alarm.intensity]}
          </p>
          <p className="muted small">
            {snoozed
              ? strings.snoozedUntil(formatClock(state!.snoozed_until!, settings.units, settings.language))
              : state?.last_fired_at
                ? `${strings.lastAlert}: ${formatDateTime(state.last_fired_at, settings.units, settings.language)}`
                : strings.neverAlerted}
          </p>
          {state?.last_error && <p className="error small">{state.last_error}</p>}
        </div>
        <span className={`dot ${state?.active ? 'is-active' : ''}`} aria-hidden="true" />
      </button>

      <div className="loccard__actions">
        <button type="button" className="btn btn--small" onClick={onEdit}>
          {strings.edit}
        </button>
        <button
          type="button"
          className="btn btn--small"
          disabled={busy}
          onClick={() => void act(() => api.checkNow(location.id))}
        >
          {strings.checkNow}
        </button>
        <button
          type="button"
          className="btn btn--small"
          disabled={busy}
          onClick={() => void act(() => api.snooze(location.id))}
        >
          {strings.snooze}
        </button>
        <button
          type="button"
          className="btn btn--small btn--danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(strings.deleteLocationConfirm)) {
              void act(() => api.deleteLocation(location.id));
            }
          }}
        >
          {strings.remove}
        </button>
      </div>
    </article>
  );
}

function AddLocation({ onDone }: { onDone: () => void }): JSX.Element {
  const { strings, settings, reloadLocations, locateMe, point } = useStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [busy, setBusy] = useState(false);

  const search = async (): Promise<void> => {
    if (query.trim().length < 2) return;
    setBusy(true);
    try {
      const { results: found } = await api.geocode(query.trim(), settings.language);
      setResults(found);
    } finally {
      setBusy(false);
    }
  };

  const add = async (name: string, lat: number, lon: number, followDevice = false): Promise<void> => {
    setBusy(true);
    try {
      await api.createLocation({ name, lat, lon, followDevice });
      await reloadLocations();
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h3 className="card__title">{strings.addLocation}</h3>

      <div className="row-buttons">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            void (async () => {
              const found = await locateMe();
              if (found) await add(found.name, found.lat, found.lon, true);
            })()
          }
        >
          {strings.currentPosition}
        </button>
        {point && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void add(point.name, point.lat, point.lon)}
          >
            {strings.pickOnMap}
          </button>
        )}
      </div>

      <div className="search">
        <input
          className="input"
          placeholder={strings.searchPlace}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search();
          }}
        />
        <button type="button" className="btn" onClick={() => void search()} disabled={busy}>
          🔍
        </button>
      </div>

      {results.length > 0 && (
        <ul className="results">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button type="button" onClick={() => void add(r.name, r.lat, r.lon)} disabled={busy}>
                <strong>{r.name}</strong>
                <span className="muted small">
                  {[r.admin1, r.country].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AlarmsPanel(): JSX.Element {
  const { locations, events, strings, settings } = useStore();
  const [editing, setEditing] = useState<Location | null>(null);
  const [adding, setAdding] = useState(false);

  if (editing) {
    const fresh = locations.find((l) => l.id === editing.id) ?? editing;
    return <AlarmEditor location={fresh} onClose={() => setEditing(null)} />;
  }

  return (
    <div className="alarms">
      {/* Las ubicaciones son tarjetas de pleno derecho, no una lista dentro de
          otra tarjeta: así pueden repartirse en columnas en pantallas anchas. */}
      <div className="alarms__head">
        <h2 className="section-label">{strings.myLocations}</h2>
        <button
          type="button"
          className={`btn btn--small ${adding ? '' : 'btn--primary'}`}
          onClick={() => setAdding((a) => !a)}
        >
          {adding ? strings.close : `+ ${strings.addLocation}`}
        </button>
      </div>

      {adding && <AddLocation onDone={() => setAdding(false)} />}

      {locations.length === 0 && <p className="muted pad">{strings.noLocations}</p>}
      <div className="loclist">
        {locations.map((location) => (
          <LocationCard key={location.id} location={location} onEdit={() => setEditing(location)} />
        ))}
      </div>

      <section className="card events-card">
        <h3 className="card__title">{strings.history}</h3>
        {events.length === 0 && <p className="muted">{strings.noHistory}</p>}
        <ul className="events">
          {events.map((event) => (
            <li key={event.id}>
              <div>
                <strong>{event.title}</strong>
                <p className="muted small">{event.body}</p>
              </div>
              <time className="muted small">
                {formatDateTime(event.firedAt, settings.units, settings.language)}
              </time>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
