/** Iconos meteorológicos vectoriales, dibujados a partir de la clave del código WMO. */

interface Props {
  icon: string;
  isDay?: boolean;
  size?: number;
  className?: string;
}

const SUN = (
  <g key="sun">
    <circle cx="9" cy="9" r="4" fill="var(--icon-sun)" />
    <g stroke="var(--icon-sun)" strokeWidth="1.6" strokeLinecap="round">
      <line x1="9" y1="1.5" x2="9" y2="3" />
      <line x1="9" y1="15" x2="9" y2="16.5" />
      <line x1="1.5" y1="9" x2="3" y2="9" />
      <line x1="15" y1="9" x2="16.5" y2="9" />
      <line x1="3.7" y1="3.7" x2="4.8" y2="4.8" />
      <line x1="13.2" y1="13.2" x2="14.3" y2="14.3" />
      <line x1="3.7" y1="14.3" x2="4.8" y2="13.2" />
      <line x1="13.2" y1="4.8" x2="14.3" y2="3.7" />
    </g>
  </g>
);

const MOON = (
  <g key="moon">
    <path
      d="M12.4 9.6A5.4 5.4 0 0 1 6 3.2a5.6 5.6 0 1 0 6.4 6.4z"
      fill="var(--icon-moon)"
    />
  </g>
);

function cloud(x = 0, y = 0, scale = 1, fill = 'var(--icon-cloud)'): JSX.Element {
  return (
    <g key={`cloud-${x}-${y}`} transform={`translate(${x} ${y}) scale(${scale})`}>
      <path
        d="M7.5 20a4.5 4.5 0 0 1-.4-8.98 6.2 6.2 0 0 1 11.9-1.6A4.3 4.3 0 0 1 18.3 20z"
        fill={fill}
      />
    </g>
  );
}

function drops(count: number, y = 21, colour = 'var(--icon-rain)'): JSX.Element {
  const xs = count === 1 ? [12] : count === 2 ? [9.5, 14.5] : [7.5, 12, 16.5];
  return (
    <g key="drops" stroke={colour} strokeWidth="1.8" strokeLinecap="round">
      {xs.map((x, i) => (
        <line key={x} x1={x} y1={y + (i % 2) * 0.8} x2={x - 1.4} y2={y + 3.4 + (i % 2) * 0.8} />
      ))}
    </g>
  );
}

function flakes(colour = 'var(--icon-snow)'): JSX.Element {
  return (
    <g key="flakes" stroke={colour} strokeWidth="1.5" strokeLinecap="round">
      {[8, 12, 16].map((x, i) => (
        <g key={x} transform={`translate(${x} ${22 + (i % 2) * 1.2})`}>
          <line x1="-1.6" y1="0" x2="1.6" y2="0" />
          <line x1="-0.8" y1="-1.4" x2="0.8" y2="1.4" />
          <line x1="-0.8" y1="1.4" x2="0.8" y2="-1.4" />
        </g>
      ))}
    </g>
  );
}

const BOLT = (
  <path key="bolt" d="M12.6 19.5h3.2l-4.6 6.5 1-4.6h-3l4.2-6z" fill="var(--icon-bolt)" />
);

function content(icon: string, isDay: boolean): JSX.Element[] {
  const luminary = isDay ? SUN : MOON;
  switch (icon) {
    case 'clear':
      return [luminary];
    case 'mostly-clear':
      return [luminary, cloud(3, 4, 0.78)];
    case 'partly-cloudy':
      return [luminary, cloud(2, 3, 0.92)];
    case 'overcast':
      return [cloud(0, 2, 0.95, 'var(--icon-cloud-dark)'), cloud(3, 4, 0.85)];
    case 'fog':
      return [
        cloud(1, 1, 0.9),
        <g key="fog" stroke="var(--icon-cloud-dark)" strokeWidth="1.8" strokeLinecap="round">
          <line x1="5" y1="22" x2="19" y2="22" />
          <line x1="7" y1="25.5" x2="17" y2="25.5" />
        </g>,
      ];
    case 'drizzle':
      return [cloud(1, 1, 0.95), drops(2, 21, 'var(--icon-rain-soft)')];
    case 'rain':
      return [cloud(1, 1, 0.95), drops(2)];
    case 'heavy-rain':
      return [cloud(1, 0, 1, 'var(--icon-cloud-dark)'), drops(3)];
    case 'showers':
      return [SUN, cloud(3, 4, 0.85), drops(2, 24)];
    case 'heavy-showers':
      return [cloud(1, 0, 1, 'var(--icon-cloud-dark)'), drops(3, 22)];
    case 'freezing-rain':
    case 'freezing-drizzle':
    case 'sleet':
      return [cloud(1, 1, 0.95), drops(1, 21), flakes()];
    case 'snow':
      return [cloud(1, 1, 0.95), flakes()];
    case 'heavy-snow':
      return [cloud(1, 0, 1, 'var(--icon-cloud-dark)'), flakes()];
    case 'snow-showers':
      return [SUN, cloud(3, 4, 0.85), flakes()];
    case 'thunderstorm':
      return [cloud(1, 0, 1, 'var(--icon-cloud-dark)'), BOLT];
    case 'thunderstorm-hail':
      return [cloud(1, 0, 1, 'var(--icon-cloud-dark)'), BOLT, flakes('var(--icon-hail)')];
    default:
      return [cloud(1, 1, 0.9)];
  }
}

export function WeatherIcon({ icon, isDay = true, size = 32, className }: Props): JSX.Element {
  return (
    <svg
      viewBox="0 0 28 30"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      {content(icon, isDay)}
    </svg>
  );
}
