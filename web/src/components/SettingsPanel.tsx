import { useEffect, useState } from 'react';
import { unlockAudio } from '../lib/audio';
import { disablePush, enablePush, hasActiveSubscription, pushStatus } from '../lib/push';
import { useStore } from '../store';
import type { Lang, MapSettings, Settings, Units } from '../types';

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="card">
      <h3 className="card__title">{title}</h3>
      {children}
    </section>
  );
}

function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean; title?: string }>;
  onChange: (value: T) => void;
}): JSX.Element {
  return (
    <div className="field field--stack">
      <span className="field__label">{label}</span>
      <div className="chips">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className={`chip ${value === option.value ? 'is-active' : ''}`}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Switch({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
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
      </div>
      {help && <p className="field__help">{help}</p>}
    </div>
  );
}

export function SettingsPanel(): JSX.Element {
  const { settings, strings, meta, updateSettings, push, setPush, subscribed, setSubscribed } =
    useStore();
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void hasActiveSubscription().then(setSubscribed);
  }, [setSubscribed]);

  const setUnits = (patch: Partial<Units>): void => {
    void updateSettings({ units: { ...settings.units, ...patch } });
  };
  const setMap = (patch: Partial<MapSettings>): void => {
    void updateSettings({ map: { ...settings.map, ...patch } });
  };

  const togglePush = async (): Promise<void> => {
    setWorking(true);
    try {
      await unlockAudio();
      if (subscribed) {
        await disablePush();
        setSubscribed(false);
      } else {
        const status = await enablePush(meta?.push.publicKey ?? '');
        setPush(status);
        setSubscribed(status === 'granted');
      }
    } finally {
      setWorking(false);
      setPush(pushStatus());
    }
  };

  return (
    <div className="settings">
      <Section title={strings.notifications}>
        {push === 'unsupported' && <p className="muted">{strings.notificationsUnsupported}</p>}
        {push === 'denied' && <p className="error">{strings.notificationsBlocked}</p>}
        {push !== 'unsupported' && push !== 'denied' && (
          <>
            <button type="button" className="btn btn--wide" onClick={() => void togglePush()} disabled={working}>
              {subscribed ? `${strings.notifications}: ${strings.on}` : strings.enableNotifications}
            </button>
            {subscribed && <p className="muted small">{strings.notificationsOn}</p>}
          </>
        )}
        <p className="muted small">
          {strings.timezone}: {settings.timezone}
        </p>
      </Section>

      <Section title={strings.language}>
        <Choice<Lang>
          label={strings.language}
          value={settings.language}
          options={[
            { value: 'es', label: 'Castellano' },
            { value: 'ca', label: 'Català' },
            { value: 'en', label: 'English' },
          ]}
          onChange={(language) => void updateSettings({ language })}
        />
        <Choice<Settings['theme']>
          label={strings.theme}
          value={settings.theme}
          options={[
            { value: 'system', label: strings.themeSystem },
            { value: 'light', label: strings.themeLight },
            { value: 'dark', label: strings.themeDark },
          ]}
          onChange={(theme) => void updateSettings({ theme })}
        />
      </Section>

      <Section title={strings.mapDefaults}>
        <Choice<number>
          label={strings.colorScheme}
          value={settings.map.colorScheme}
          options={(meta?.colorSchemes ?? []).map((scheme) => ({
            value: scheme.id,
            label: scheme.label,
          }))}
          onChange={(colorScheme) => setMap({ colorScheme })}
        />
        <Choice<MapSettings['baseLayer']>
          label={strings.baseMap}
          value={settings.map.baseLayer}
          options={[
            { value: 'auto', label: strings.themeSystem },
            { value: 'clear', label: strings.themeLight },
            { value: 'dark', label: strings.themeDark },
            { value: 'streets', label: 'OpenStreetMap' },
            { value: 'terrain', label: 'OpenTopoMap' },
          ]}
          onChange={(baseLayer) => setMap({ baseLayer })}
        />
        <div className="field field--stack">
          <span className="field__label">
            {strings.opacity}: {Math.round(settings.map.opacity * 100)} %
          </span>
          <input
            type="range"
            min={10}
            max={100}
            value={Math.round(settings.map.opacity * 100)}
            onChange={(e) => setMap({ opacity: Number(e.target.value) / 100 })}
            className="slider"
            aria-label={strings.opacity}
          />
        </div>
        <Choice<MapSettings['blend']>
          label={strings.blendMode}
          value={settings.map.blend}
          options={[
            { value: 'plain', label: strings.blendPlain },
            { value: 'blend', label: strings.blendSoft },
          ]}
          onChange={(blend) => setMap({ blend })}
        />
        <Choice<number>
          label={strings.historySpan}
          value={settings.map.historyMinutes}
          options={[
            { value: 30, label: `30 ${strings.minutes}` },
            { value: 60, label: `1 ${strings.hours}` },
            { value: 120, label: `2 ${strings.hours}` },
          ]}
          onChange={(historyMinutes) => setMap({ historyMinutes })}
        />
        <Switch
          label={strings.includeNowcast}
          checked={settings.map.showNowcast}
          onChange={(showNowcast) => setMap({ showNowcast })}
        />
        <div className="field field--stack">
          <span className="field__label">
            {strings.animationSpeed}: {settings.map.frameDurationMs} ms
          </span>
          <input
            type="range"
            min={120}
            max={1200}
            step={20}
            value={settings.map.frameDurationMs}
            onChange={(e) => setMap({ frameDurationMs: Number(e.target.value) })}
            className="slider"
            aria-label={strings.animationSpeed}
          />
        </div>
        <Switch
          label={strings.smoothing}
          checked={settings.map.smooth}
          onChange={(smooth) => setMap({ smooth })}
        />
        <Switch
          label={strings.showSnow}
          checked={settings.map.showSnow}
          onChange={(showSnow) => setMap({ showSnow })}
        />
        <Switch
          label={strings.showCoverage}
          checked={settings.map.showCoverage}
          onChange={(showCoverage) => setMap({ showCoverage })}
        />
        <Switch
          label={strings.showRadiusCircle}
          checked={settings.map.showRadius}
          onChange={(showRadius) => setMap({ showRadius })}
        />
        <Switch
          label={strings.showMotionArrow}
          checked={settings.map.showMotionArrow}
          onChange={(showMotionArrow) => setMap({ showMotionArrow })}
        />
        <Switch
          label={strings.play}
          checked={settings.map.autoPlay}
          onChange={(autoPlay) => setMap({ autoPlay })}
        />
      </Section>

      <Section title={strings.units}>
        <Choice<Units['temperature']>
          label={strings.temperature}
          value={settings.units.temperature}
          options={[
            { value: 'C', label: '°C' },
            { value: 'F', label: '°F' },
          ]}
          onChange={(temperature) => setUnits({ temperature })}
        />
        <Choice<Units['wind']>
          label={strings.wind}
          value={settings.units.wind}
          options={[
            { value: 'kmh', label: 'km/h' },
            { value: 'ms', label: 'm/s' },
            { value: 'mph', label: 'mph' },
            { value: 'kn', label: 'kn' },
            { value: 'bft', label: 'Bft' },
          ]}
          onChange={(wind) => setUnits({ wind })}
        />
        <Choice<Units['precipitation']>
          label={strings.precipitation}
          value={settings.units.precipitation}
          options={[
            { value: 'mm', label: 'mm' },
            { value: 'in', label: 'in' },
          ]}
          onChange={(precipitation) => setUnits({ precipitation })}
        />
        <Choice<Units['distance']>
          label={strings.distance}
          value={settings.units.distance}
          options={[
            { value: 'km', label: 'km' },
            { value: 'mi', label: 'mi' },
          ]}
          onChange={(distance) => setUnits({ distance })}
        />
        <Choice<Units['pressure']>
          label={strings.pressure}
          value={settings.units.pressure}
          options={[
            { value: 'hPa', label: 'hPa' },
            { value: 'inHg', label: 'inHg' },
            { value: 'mmHg', label: 'mmHg' },
          ]}
          onChange={(pressure) => setUnits({ pressure })}
        />
        <Choice<Units['clock']>
          label={strings.clock}
          value={settings.units.clock}
          options={[
            { value: '24h', label: '24 h' },
            { value: '12h', label: '12 h' },
          ]}
          onChange={(clock) => setUnits({ clock })}
        />
        <Switch
          label={strings.showMmPerHour}
          checked={settings.showMmPerHour}
          onChange={(showMmPerHour) => void updateSettings({ showMmPerHour })}
        />
      </Section>

      <Section title={strings.tabForecast}>
        <Choice
          label={strings.provider}
          value={settings.forecastProvider}
          options={(meta?.providers ?? []).map((provider) => ({
            value: provider.id,
            label: provider.label,
            disabled: !provider.available,
            title: provider.reason ?? undefined,
          }))}
          onChange={(forecastProvider) => void updateSettings({ forecastProvider })}
        />
        {(meta?.providers ?? [])
          .filter((p) => !p.available && p.reason)
          .map((p) => (
            <p key={p.id} className="muted small">
              {p.label}: {p.reason}
            </p>
          ))}
        <div className="field field--stack">
          <span className="field__label">
            {strings.refreshInterval}: {Math.round(settings.refreshSeconds / 60)} {strings.minutes}
          </span>
          <input
            type="range"
            min={60}
            max={1800}
            step={60}
            value={settings.refreshSeconds}
            onChange={(e) => void updateSettings({ refreshSeconds: Number(e.target.value) })}
            className="slider"
            aria-label={strings.refreshInterval}
          />
        </div>
        <Switch
          label={strings.keepScreenOn}
          checked={settings.keepScreenOn}
          onChange={(keepScreenOn) => void updateSettings({ keepScreenOn })}
        />
        <Switch
          label={strings.batterySaver}
          help={strings.batterySaverHelp}
          checked={settings.batterySaver}
          onChange={(batterySaver) => void updateSettings({ batterySaver })}
        />
      </Section>

      <Section title={strings.dataSources}>
        <ul className="sources">
          <li>{meta?.attribution.radar}</li>
          <li>{meta?.attribution.forecast}</li>
          <li>{meta?.attribution.basemap}</li>
        </ul>
      </Section>
    </div>
  );
}
