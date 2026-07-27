import { useEffect, useState } from 'react';
import { api } from '../api';
import { playAlarm, stopAlarm, unlockAudio } from '../lib/audio';
import { formatDistance, formatSpeed } from '../lib/format';
import { useStore } from '../store';
import type { AlarmConfig, AlarmMode, AlarmTone, IntensityKey, Location } from '../types';

interface Props {
  location: Location;
  onClose: () => void;
}

function Row({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
        {children}
      </div>
      {help && <p className="field__help">{help}</p>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}): JSX.Element {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__knob" />
      </span>
    </label>
  );
}

function WeekdayPicker({
  days,
  onChange,
}: {
  days: number[];
  onChange: (days: number[]) => void;
}): JSX.Element {
  const { strings } = useStore();
  // Se muestra la semana empezando en lunes, como es habitual en España.
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="weekdays">
      {order.map((d) => {
        const active = days.length === 0 || days.includes(d);
        return (
          <button
            key={d}
            type="button"
            className={`weekdays__day ${active ? 'is-active' : ''}`}
            onClick={() => {
              const base = days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : days;
              const next = base.includes(d) ? base.filter((x) => x !== d) : [...base, d];
              onChange(next.length === 7 ? [] : next.sort());
            }}
          >
            {strings.weekdays[d]}
          </button>
        );
      })}
    </div>
  );
}

/** Formulario completo de configuración de una alarma. */
export function AlarmEditor({ location, onClose }: Props): JSX.Element {
  const { strings, settings, meta, reloadLocations } = useStore();
  const [alarm, setAlarm] = useState<AlarmConfig>(location.alarm);
  const [name, setName] = useState(location.name);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => () => stopAlarm(), []);

  const patch = (part: Partial<AlarmConfig>): void => setAlarm((prev) => ({ ...prev, ...part }));

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await api.updateLocation(location.id, { name: name.trim() || location.name, alarm });
      await reloadLocations();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const preview = async (): Promise<void> => {
    await unlockAudio();
    if (previewing) {
      stopAlarm();
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    playAlarm({ ...alarm.sound, loop: false });
    window.setTimeout(() => setPreviewing(false), alarm.sound.durationSeconds * 1000);
  };

  const modeHelp: Record<AlarmMode, string> = {
    overhead: strings.modeOverheadHelp,
    inRadius: strings.modeInRadiusHelp,
    approaching: strings.modeApproachingHelp,
  };
  const modeLabel: Record<AlarmMode, string> = {
    overhead: strings.modeOverhead,
    inRadius: strings.modeInRadius,
    approaching: strings.modeApproaching,
  };

  return (
    <div className="sheet" role="dialog" aria-label={strings.alarmSettings}>
      <header className="sheet__header">
        <button type="button" className="link" onClick={onClose}>
          {strings.cancel}
        </button>
        <h2>{strings.alarmSettings}</h2>
        <button type="button" className="link is-primary" onClick={() => void save()} disabled={saving}>
          {strings.save}
        </button>
      </header>

      <div className="sheet__body">
        <section className="card">
          <Row label={strings.name}>
            <input
              className="input"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </Row>
          {location.followDevice && <p className="field__help">{strings.followsDevice}</p>}
        </section>

        <section className="card">
          <Row label={strings.enableAlarm}>
            <Toggle
              checked={alarm.enabled}
              onChange={(v) => patch({ enabled: v })}
              label={strings.enableAlarm}
            />
          </Row>

          <Row label={`${strings.radius}: ${formatDistance(alarm.radiusKm, settings.units)}`}>
            <span />
          </Row>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={alarm.radiusKm}
            onChange={(e) => patch({ radiusKm: Number(e.target.value) })}
            className="slider"
            aria-label={strings.radius}
          />

          <Row label={strings.sensitivity}>
            <span />
          </Row>
          <div className="chips">
            {(meta?.intensityLevels ?? []).map((level) => (
              <button
                key={level.key}
                type="button"
                className={`chip ${alarm.intensity === level.key ? 'is-active' : ''}`}
                onClick={() => patch({ intensity: level.key as IntensityKey })}
              >
                {strings.intensity[level.key] ?? level.label}
              </button>
            ))}
          </div>

          <Row label={strings.detectRain}>
            <Toggle
              checked={alarm.detectRain}
              onChange={(v) => patch({ detectRain: v })}
              label={strings.detectRain}
            />
          </Row>
          <Row label={strings.detectSnow}>
            <Toggle
              checked={alarm.detectSnow}
              onChange={(v) => patch({ detectSnow: v })}
              label={strings.detectSnow}
            />
          </Row>
        </section>

        <section className="card">
          <h3 className="card__title">{strings.mode}</h3>
          <div className="options">
            {(['overhead', 'inRadius', 'approaching'] as AlarmMode[]).map((mode) => (
              <label key={mode} className={`option ${alarm.mode === mode ? 'is-active' : ''}`}>
                <input
                  type="radio"
                  name="alarm-mode"
                  checked={alarm.mode === mode}
                  onChange={() => patch({ mode })}
                />
                <span>
                  <strong>{modeLabel[mode]}</strong>
                  <em>{modeHelp[mode]}</em>
                </span>
              </label>
            ))}
          </div>

          {alarm.mode === 'approaching' && (
            <>
              <Row label={`${strings.leadTime}: ${alarm.leadMinutes} ${strings.minutes}`}>
                <span />
              </Row>
              <input
                type="range"
                min={5}
                max={120}
                step={5}
                value={alarm.leadMinutes}
                onChange={(e) => patch({ leadMinutes: Number(e.target.value) })}
                className="slider"
                aria-label={strings.leadTime}
              />
              <Row
                label={`${strings.minSpeed}: ${formatSpeed(alarm.minSpeedKmh, settings.units)}`}
                help={strings.minSpeedHelp}
              >
                <span />
              </Row>
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={alarm.minSpeedKmh}
                onChange={(e) => patch({ minSpeedKmh: Number(e.target.value) })}
                className="slider"
                aria-label={strings.minSpeed}
              />
            </>
          )}
        </section>

        <section className="card">
          <h3 className="card__title">{strings.notifications}</h3>
          <Row label={strings.repeat}>
            <Toggle checked={alarm.repeat} onChange={(v) => patch({ repeat: v })} label={strings.repeat} />
          </Row>
          {alarm.repeat && (
            <Row label={`${strings.repeatEvery} ${alarm.repeatMinutes} ${strings.minutes}`}>
              <input
                type="range"
                min={5}
                max={180}
                step={5}
                value={alarm.repeatMinutes}
                onChange={(e) => patch({ repeatMinutes: Number(e.target.value) })}
                className="slider slider--inline"
                aria-label={strings.repeatEvery}
              />
            </Row>
          )}
          <Row label={`${strings.minInterval}: ${alarm.minIntervalMinutes} ${strings.minutes}`}>
            <span />
          </Row>
          <input
            type="range"
            min={0}
            max={240}
            step={5}
            value={alarm.minIntervalMinutes}
            onChange={(e) => patch({ minIntervalMinutes: Number(e.target.value) })}
            className="slider"
            aria-label={strings.minInterval}
          />
          <Row label={strings.notifyOnClear}>
            <Toggle
              checked={alarm.notifyOnClear}
              onChange={(v) => patch({ notifyOnClear: v })}
              label={strings.notifyOnClear}
            />
          </Row>
          <Row label={`${strings.snoozeDuration}: ${alarm.snoozeMinutes} ${strings.minutes}`}>
            <span />
          </Row>
          <input
            type="range"
            min={5}
            max={180}
            step={5}
            value={alarm.snoozeMinutes}
            onChange={(e) => patch({ snoozeMinutes: Number(e.target.value) })}
            className="slider"
            aria-label={strings.snoozeDuration}
          />
        </section>

        <section className="card">
          <Row label={strings.quietHours}>
            <Toggle
              checked={alarm.quietHours.enabled}
              onChange={(v) => patch({ quietHours: { ...alarm.quietHours, enabled: v } })}
              label={strings.quietHours}
            />
          </Row>
          {alarm.quietHours.enabled && (
            <>
              <div className="times">
                <label>
                  {strings.from}
                  <input
                    type="time"
                    value={alarm.quietHours.from}
                    onChange={(e) => patch({ quietHours: { ...alarm.quietHours, from: e.target.value } })}
                  />
                </label>
                <label>
                  {strings.to}
                  <input
                    type="time"
                    value={alarm.quietHours.to}
                    onChange={(e) => patch({ quietHours: { ...alarm.quietHours, to: e.target.value } })}
                  />
                </label>
              </div>
              <WeekdayPicker
                days={alarm.quietHours.days}
                onChange={(days) => patch({ quietHours: { ...alarm.quietHours, days } })}
              />
            </>
          )}

          <Row label={strings.watchWindow}>
            <Toggle
              checked={alarm.schedule.enabled}
              onChange={(v) => patch({ schedule: { ...alarm.schedule, enabled: v } })}
              label={strings.watchWindow}
            />
          </Row>
          {alarm.schedule.enabled && (
            <>
              <div className="times">
                <label>
                  {strings.from}
                  <input
                    type="time"
                    value={alarm.schedule.from}
                    onChange={(e) => patch({ schedule: { ...alarm.schedule, from: e.target.value } })}
                  />
                </label>
                <label>
                  {strings.to}
                  <input
                    type="time"
                    value={alarm.schedule.to}
                    onChange={(e) => patch({ schedule: { ...alarm.schedule, to: e.target.value } })}
                  />
                </label>
              </div>
              <WeekdayPicker
                days={alarm.schedule.days}
                onChange={(days) => patch({ schedule: { ...alarm.schedule, days } })}
              />
            </>
          )}
        </section>

        <section className="card">
          <h3 className="card__title">{strings.sound}</h3>
          <div className="chips">
            {(meta?.alarmTones ?? []).map((tone) => (
              <button
                key={tone}
                type="button"
                className={`chip ${alarm.sound.tone === tone ? 'is-active' : ''}`}
                onClick={() => patch({ sound: { ...alarm.sound, tone: tone as AlarmTone } })}
              >
                {strings.tones[tone] ?? tone}
              </button>
            ))}
          </div>

          <Row label={`${strings.volume}: ${Math.round(alarm.sound.volume * 100)} %`}>
            <span />
          </Row>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(alarm.sound.volume * 100)}
            onChange={(e) => patch({ sound: { ...alarm.sound, volume: Number(e.target.value) / 100 } })}
            className="slider"
            aria-label={strings.volume}
          />

          <Row label={`${strings.soundDuration}: ${alarm.sound.durationSeconds} s`}>
            <span />
          </Row>
          <input
            type="range"
            min={2}
            max={60}
            value={alarm.sound.durationSeconds}
            onChange={(e) =>
              patch({ sound: { ...alarm.sound, durationSeconds: Number(e.target.value) } })
            }
            className="slider"
            aria-label={strings.soundDuration}
          />

          <Row label={strings.vibrate}>
            <Toggle
              checked={alarm.sound.vibrate}
              onChange={(v) => patch({ sound: { ...alarm.sound, vibrate: v } })}
              label={strings.vibrate}
            />
          </Row>
          <Row label={strings.loopSound}>
            <Toggle
              checked={alarm.sound.loop}
              onChange={(v) => patch({ sound: { ...alarm.sound, loop: v } })}
              label={strings.loopSound}
            />
          </Row>
          <Row label={strings.fadeIn}>
            <Toggle
              checked={alarm.sound.fadeIn}
              onChange={(v) => patch({ sound: { ...alarm.sound, fadeIn: v } })}
              label={strings.fadeIn}
            />
          </Row>

          <div className="row-buttons">
            <button type="button" className="btn" onClick={() => void preview()}>
              {previewing ? strings.stop : strings.preview}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void api
                  .testNotification(location.id)
                  .then((r) =>
                    setTestResult(r.sent > 0 ? strings.notificationsOn : strings.notificationsUnsupported),
                  )
                  .catch(() => setTestResult(strings.notificationsUnsupported))
              }
            >
              {strings.testNotification}
            </button>
          </div>
          {testResult && <p className="muted small">{testResult}</p>}
        </section>
      </div>
    </div>
  );
}
