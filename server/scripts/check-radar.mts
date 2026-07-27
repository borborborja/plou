/**
 * Diagnóstico del canal de radar: descarga teselas reales, comprueba que los
 * colores casan con la paleta y analiza una o varias ubicaciones.
 *
 *   npx tsx scripts/check-radar.mts                # decodificación + ejemplos
 *   npx tsx scripts/check-radar.mts 41.39 2.16     # una ubicación concreta
 */
import { PNG } from 'pngjs';
import { RAIN_RAMPS, SNOW_RAMPS } from '../src/radar/colorTable.generated.js';
import { analyzeLocation } from '../src/radar/analysis.js';
import { getRadarIndex, latestPast, tileUrl } from '../src/radar/frames.js';

const SCHEME = 'universalBlue' as const;

function paletteSet(): Set<string> {
  const set = new Set<string>();
  for (const ramp of [RAIN_RAMPS[SCHEME], SNOW_RAMPS[SCHEME]]) {
    for (let i = 0; i < 128; i++) {
      const o = i * 4;
      if (ramp[o + 3] === 0) continue;
      set.add(`${ramp[o]},${ramp[o + 1]},${ramp[o + 2]},${ramp[o + 3]}`);
    }
  }
  return set;
}

const index = await getRadarIndex();
const frame = latestPast(index)!;
console.log(
  `Índice: ${index.past.length} fotogramas observados, ${index.nowcast.length} de extrapolación del proveedor`,
);
console.log(`Último fotograma: ${new Date(frame.time * 1000).toISOString()}`);

const palette = paletteSet();
let opaque = 0;
let inPalette = 0;
const seen = new Set<string>();
const strays = new Map<string, number>();

const TILES: Array<[number, number, number]> = [
  [3, 4, 2],
  [3, 3, 2],
  [3, 4, 3],
  [3, 2, 3],
  [3, 1, 2],
  [3, 6, 3],
];

for (const [z, x, y] of TILES) {
  const url = tileUrl(index, frame, { z, x, y, size: 512, color: 2, smooth: false, snow: true });
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`  tesela ${z}/${x}/${y}: HTTP ${res.status}`);
    continue;
  }
  const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  for (let i = 0; i < png.width * png.height; i++) {
    const o = i * 4;
    const a = png.data[o + 3]!;
    if (a === 0) continue;
    opaque++;
    const key = `${png.data[o]},${png.data[o + 1]},${png.data[o + 2]},${a}`;
    seen.add(key);
    if (palette.has(key)) inPalette++;
    else strays.set(key, (strays.get(key) ?? 0) + 1);
  }
}

const pct = opaque ? ((inPalette / opaque) * 100).toFixed(2) : 'n/a';
console.log(`\nPíxeles con eco: ${opaque}; coinciden exactamente con la paleta: ${pct}%`);
console.log(`Colores distintos observados: ${seen.size} (paleta: ${palette.size})`);
if (strays.size) {
  console.log(
    'Colores fuera de paleta (top 5):',
    [...strays.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
  );
}

const args = process.argv.slice(2);
const places: Array<{ name: string; lat: number; lon: number }> =
  args.length >= 2
    ? [{ name: 'CLI', lat: Number(args[0]), lon: Number(args[1]) }]
    : [
        { name: 'Barcelona', lat: 41.3874, lon: 2.1686 },
        { name: 'Ámsterdam', lat: 52.3676, lon: 4.9041 },
        { name: 'Seattle', lat: 47.6062, lon: -122.3321 },
        { name: 'Singapur', lat: 1.3521, lon: 103.8198 },
      ];

for (const place of places) {
  const started = Date.now();
  const a = await analyzeLocation(
    { lat: place.lat, lon: place.lon },
    { radiusKm: 30, thresholdDbz: 20, lookaheadMinutes: 90 },
  );
  console.log(
    `\n${place.name} (${place.lat}, ${place.lon})  [${Date.now() - started} ms]\n` +
      `  cobertura radar: ${a.radarCoverage}  eco en rejilla: ${(a.fieldCoverage * 100).toFixed(2)}%\n` +
      `  sobre el punto: ${a.overhead ? `${a.overhead.dbz} dBZ (${a.overhead.intensity})` : 'no'}\n` +
      `  más cercano: ${a.nearest ? `${a.nearest.distanceKm.toFixed(1)} km al ${a.nearest.compass}, ${a.nearest.dbz} dBZ` : 'ninguno'}\n` +
      `  cobertura del radio: ${a.areaCoveragePct.toFixed(1)}%\n` +
      `  movimiento: ${a.motion ? `${a.motion.speedKmh.toFixed(0)} km/h hacia ${a.motion.bearingDeg.toFixed(0)}° (conf. ${a.motion.confidence.toFixed(2)})` : 'no estimable'}\n` +
      `  llegada al punto: ${a.etaMinutes ?? '—'} min · al radio: ${a.etaRadiusMinutes ?? '—'} min · escampa en: ${a.clearingMinutes ?? '—'} min`,
  );
}
