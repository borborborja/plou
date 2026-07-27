import { useEffect, useRef } from 'react';
import { api } from '../api';
import { playAlarm, stopAlarm } from '../lib/audio';
import { useStore } from '../store';
import type { SoundConfig } from '../types';

const DEFAULT_SOUND: SoundConfig = {
  tone: 'classic',
  volume: 0.8,
  vibrate: true,
  loop: false,
  durationSeconds: 10,
  fadeIn: false,
};

/**
 * Pantalla de alarma que aparece cuando llega un aviso con la app abierta.
 * Reproduce el tono configurado para esa ubicación y ofrece posponer o descartar.
 */
export function AlarmOverlay(): JSX.Element | null {
  const { ringing, setRinging, strings, settings, setPoint, reloadLocations } = useStore();
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!ringing) return;
    const sound = (ringing.payload['sound'] as SoundConfig | undefined) ?? DEFAULT_SOUND;
    stopRef.current = playAlarm(sound);
    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [ringing]);

  if (!ringing) return null;

  const locationId = Number(ringing.payload['locationId']) || null;
  const lat = ringing.payload['lat'];
  const lon = ringing.payload['lon'];

  const close = (): void => {
    stopAlarm();
    setRinging(null);
  };

  const locationName = String(ringing.payload['locationName'] ?? '');
  const clock = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: settings.units.clock === '12h',
  }).format(new Date());

  return (
    <div className="overlay" role="alertdialog" aria-label={strings.alarmRinging}>
      <div className="overlay__card">
        {locationName && <span className="overlay__place">{locationName}</span>}
        <div className="overlay__pulse" aria-hidden="true">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 01-3.4 0" />
          </svg>
        </div>
        <h2>{ringing.title}</h2>
        <p>{ringing.body}</p>
        <div className="overlay__clock">{clock}</div>

        <div className="overlay__actions">
          <button
            type="button"
            className="btn btn--wide"
            onClick={() => {
              if (typeof lat === 'number' && typeof lon === 'number') {
                setPoint({
                  lat,
                  lon,
                  name: String(ringing.payload['locationName'] ?? ''),
                  locationId: locationId ?? undefined,
                });
              }
              close();
            }}
          >
            {strings.openRadar}
          </button>
          {locationId !== null && (
            <button
              type="button"
              className="btn btn--wide"
              onClick={() => {
                void api
                  .snooze(locationId)
                  .then(() => reloadLocations())
                  .catch(() => undefined);
                close();
              }}
            >
              {strings.snooze}
            </button>
          )}
          <button type="button" className="btn btn--wide btn--primary" onClick={close}>
            {strings.dismiss}
          </button>
        </div>
      </div>
    </div>
  );
}
