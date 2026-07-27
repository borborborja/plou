import { useStore } from '../store';
import { formatDistance, formatPrecipRate, formatSpeed, translateCompass } from '../lib/format';
import type { LocationAnalysis } from '../types';

function Sparkline({ analysis }: { analysis: LocationAnalysis }): JSX.Element | null {
  const { strings, settings } = useStore();
  const points = analysis.timeline;
  if (points.length === 0) return null;

  const max = Math.max(analysis.thresholdDbz + 10, ...points.map((p) => p.dbz));
  const width = 100;
  const height = 34;

  const bars = points.map((p, i) => {
    const h = max > 0 ? Math.max(0, (p.dbz / max) * height) : 0;
    const w = width / points.length;
    return (
      <rect
        key={p.minutes}
        x={i * w + 0.4}
        y={height - h}
        width={Math.max(0.8, w - 0.8)}
        height={h}
        rx={0.8}
        className={p.kind === 'none' ? 'spark__bar' : `spark__bar is-${p.kind}`}
      />
    );
  });

  const anyPrecip = points.some((p) => p.kind !== 'none');

  return (
    <div className="spark">
      <div className="spark__head">
        <span>{strings.nextHours}</span>
        <span className="spark__range">
          0–{points[points.length - 1]?.minutes ?? 0} {strings.minutes}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="spark__chart">
        {bars}
      </svg>
      {!anyPrecip && <p className="spark__empty">{strings.noPrecipExpected}</p>}
      {anyPrecip && settings.showMmPerHour && (
        <p className="spark__peak">
          {strings.peak} {formatPrecipRate(Math.max(...points.map((p) => p.mmPerHour)), settings.units)}
        </p>
      )}
    </div>
  );
}

/** Resumen textual del estado del radar alrededor del punto activo. */
export function NowcastSummary(): JSX.Element {
  const { analysis, analysisLoading, strings, settings, point } = useStore();

  // Sin punto no hay nada que analizar: se explica qué hacer en vez de dejar
  // un «sin datos» que parece una avería.
  if (!point) {
    return (
      <div className="summary summary--loading">
        <p className="summary__empty">{strings.locationUnavailable}</p>
      </div>
    );
  }
  if (analysisLoading && !analysis) {
    return <div className="summary summary--loading">{strings.loading}</div>;
  }
  if (!analysis) {
    return <div className="summary summary--loading">{strings.unknown}</div>;
  }

  const { overhead, nearest, motion } = analysis;
  const state = overhead
    ? overhead.kind === 'snow'
      ? strings.snowingNow
      : strings.rainingNow
    : nearest
      ? strings.rainNearby
      : strings.noRainNearby;

  const tone = overhead ? 'is-raining' : nearest ? 'is-near' : 'is-dry';

  return (
    <div className={`summary ${tone}`}>
      <div className="summary__head">
        <div>
          <h2 className="summary__state">{state}</h2>
          <p className="summary__place">{point.name}</p>
        </div>
        <span className="summary__age">
          {strings.radarAge(Math.max(0, Math.round(analysis.ageMinutes)))}
        </span>
      </div>

      {analysis.radarCoverage === false && (
        <p className="summary__warning">{strings.noRadarCoverage}</p>
      )}

      <ul className="summary__facts">
        {overhead && (
          <li>
            <span>{overhead.intensity}</span>
            <strong>{formatPrecipRate(overhead.mmPerHour, settings.units)}</strong>
          </li>
        )}
        {!overhead && nearest && (
          <li>
            <span>{strings.nearestEcho}</span>
            <strong>
              {formatDistance(nearest.distanceKm, settings.units)}{' '}
              {translateCompass(nearest.compass, settings.language)}
            </strong>
          </li>
        )}
        {analysis.etaMinutes !== null && !overhead && (
          <li className="is-highlight">
            <span>{strings.arrivesIn(Math.round(analysis.etaMinutes))}</span>
          </li>
        )}
        {overhead && analysis.clearingMinutes !== null && (
          <li className="is-highlight">
            <span>{strings.clearsIn(Math.round(analysis.clearingMinutes))}</span>
          </li>
        )}
        {motion && motion.speedKmh > 2 && (
          <li>
            <span>{strings.movingAt}</span>
            <strong>
              {formatSpeed(motion.speedKmh, settings.units)} {strings.towards}{' '}
              {translateCompass(
                ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'][
                  Math.round((((motion.bearingDeg % 360) + 360) % 360) / 22.5) % 16
                ] ?? 'N',
                settings.language,
              )}
            </strong>
          </li>
        )}
        {motion && motion.speedKmh <= 2 && (
          <li>
            <span>{strings.stationary}</span>
          </li>
        )}
        {analysis.areaCoveragePct > 0 && (
          <li>
            <span>{Math.round(analysis.areaCoveragePct)} %</span>
            <strong>{strings.coverageOfArea}</strong>
          </li>
        )}
      </ul>

      <Sparkline analysis={analysis} />
    </div>
  );
}
