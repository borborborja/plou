import { useEffect, useState } from 'react';
import { api } from './api';
import { AlarmOverlay } from './components/AlarmOverlay';
import { AlarmsPanel } from './components/AlarmsPanel';
import { ForecastPanel } from './components/ForecastPanel';
import { NavIcon, type NavIconName } from './components/NavIcon';
import { NowcastSummary } from './components/NowcastSummary';
import { LocationChips, RadarAside } from './components/RadarAside';
import { RadarMap } from './components/RadarMap';
import { SettingsPanel } from './components/SettingsPanel';
import { unlockAudio } from './lib/audio';
import { useStore } from './store';
import type { Settings } from './types';

type Tab = 'radar' | 'forecast' | 'alarms' | 'settings';

const TABS: Tab[] = ['radar', 'forecast', 'alarms', 'settings'];

/** Cada pestaña con su icono lineal del sistema de diseño. */
const TAB_ICONS: Record<Tab, NavIconName> = {
  radar: 'radar',
  forecast: 'forecast',
  alarms: 'alarms',
  settings: 'settings',
};

function initialTab(): Tab {
  const param = new URLSearchParams(window.location.search).get('tab');
  if (param === 'forecast' || param === 'alarms' || param === 'settings') return param;
  return 'radar';
}

/** `true` mientras la consulta de medios se cumpla. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = (): void => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function App(): JSX.Element {
  const { ready, error, strings, point, setPoint, locateMe, settings, updateSettings } = useStore();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [picking, setPicking] = useState(false);
  // A partir de este ancho caben la barra lateral y el panel principal a la vez.
  const wide = useMediaQuery('(min-width: 1024px)');

  // El audio necesita un gesto del usuario para poder sonar más adelante.
  useEffect(() => {
    const unlock = (): void => void unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // Sin punto elegido ni ubicaciones guardadas, se propone la posición actual.
  useEffect(() => {
    if (ready && !point) void locateMe();
  }, [ready, point, locateMe]);

  const pickPoint = async (lat: number, lon: number): Promise<void> => {
    setPicking(true);
    try {
      const described = await api
        .reverseGeocode(lat, lon, settings.language)
        .catch(() => ({ name: `${lat.toFixed(3)}, ${lon.toFixed(3)}` }));
      setPoint({ lat, lon, name: described.name });
    } finally {
      setPicking(false);
    }
  };

  if (!ready) {
    return (
      <div className="boot">
        <div className="boot__drop" aria-hidden="true" />
        <p>{strings.loading}</p>
      </div>
    );
  }

  const tabLabel = (key: Tab): string =>
    key === 'radar'
      ? strings.tabRadar
      : key === 'forecast'
        ? strings.tabForecast
        : key === 'alarms'
          ? strings.tabAlarms
          : strings.tabSettings;

  const map = (
    <>
      <RadarMap onPick={(lat, lon) => void pickPoint(lat, lon)} />
      {picking && <span className="radar-tab__picking">{strings.loading}</span>}
    </>
  );

  const panel = (
    <>
      {tab === 'forecast' && <ForecastPanel />}
      {tab === 'alarms' && <AlarmsPanel />}
      {tab === 'settings' && <SettingsPanel />}
    </>
  );

  const themeOptions: { value: Settings['theme']; label: string }[] = [
    { value: 'system', label: strings.themeSystem },
    { value: 'light', label: strings.themeLight },
    { value: 'dark', label: strings.themeDark },
  ];

  // --- Escritorio: barra lateral con la navegación y el contexto -----------
  if (wide) {
    return (
      <div className="app app--wide">
        <nav className="sidebar" aria-label={strings.appName}>
          <div className="sidebar__brand">{strings.appName}</div>

          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              className={`navitem ${tab === key ? 'is-active' : ''}`}
              onClick={() => setTab(key)}
              aria-current={tab === key ? 'page' : undefined}
            >
              <NavIcon name={TAB_ICONS[key]} />
              {tabLabel(key)}
            </button>
          ))}

          <div className="sidebar__section">
            <div className="sidebar__label">{strings.theme}</div>
            <div className="seg" role="group" aria-label={strings.theme}>
              {themeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`seg__opt ${settings.theme === option.value ? 'is-active' : ''}`}
                  onClick={() => void updateSettings({ theme: option.value })}
                  aria-pressed={settings.theme === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Contexto de la vista: el estado del radar sólo en Radar, y las
              ubicaciones guardadas también en Previsión para saltar de una a
              otra sin volver al mapa. */}
          {(tab === 'radar' || tab === 'forecast') && (
            <div className="sidebar__context">
              {tab === 'radar' && <NowcastSummary />}
              <LocationChips />
            </div>
          )}
        </nav>

        {/* Sin epígrafe: la sección ya la indica la barra lateral y el nombre
            del punto se ve en el mapa y en las tarjetas. Todo el alto es para
            el contenido. */}
        <main className="main">
          {error && <p className="error pad">{error}</p>}

          {/* El mapa se mantiene montado al cambiar de pestaña: recrearlo
              vaciaría la animación y volvería a pedir todas las teselas. */}
          <div className={`stage ${tab === 'radar' ? '' : 'is-hidden'}`}>{map}</div>
          {tab === 'radar' ? <p className="hint">{strings.clickMapHint}</p> : panel}
        </main>

        <AlarmOverlay />
      </div>
    );
  }

  // --- Móvil ---------------------------------------------------------------
  return (
    <div className="app">
      <header className="appbar">
        <h1 className="appbar__title">
          <span className="appbar__brand">{strings.appName}</span>
          {point && <span className="appbar__place">{point.name}</span>}
        </h1>
        <button
          type="button"
          className="appbar__action"
          onClick={() => void locateMe()}
          aria-label={strings.locateMe}
          title={strings.locateMe}
        >
          ⌖
        </button>
      </header>

      <main className="content">
        {tab === 'radar' ? (
          <div className="radar-tab">
            <div className="radar-tab__map">{map}</div>
            <div className="radar-tab__info">
              {error && <p className="error pad">{error}</p>}
              <NowcastSummary />
              <p className="hint">{strings.tapMapHint}</p>
              <RadarAside />
            </div>
          </div>
        ) : (
          <>
            {error && <p className="error pad">{error}</p>}
            {panel}
          </>
        )}
      </main>

      <nav className="tabbar">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            className={`tabbar__tab ${tab === key ? 'is-active' : ''}`}
            onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
          >
            <NavIcon name={TAB_ICONS[key]} size={20} />
            <em>{tabLabel(key)}</em>
          </button>
        ))}
      </nav>

      <AlarmOverlay />
    </div>
  );
}
