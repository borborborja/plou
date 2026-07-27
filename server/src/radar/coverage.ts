import { config } from '../config.js';
import { latLonToGlobalPixel, type LatLon } from '../util/geo.js';
import { coverageTileUrl, type RadarIndex } from './frames.js';
import { getAlphaTile } from './tiles.js';

/**
 * La capa de cobertura es una *máscara de zonas sin radar*: los píxeles opacos
 * marcan el área que ningún radar alcanza. Por eso "hay cobertura" equivale a
 * alfa cero. Sólo se publica hasta el zoom 5; por encima la tesela llega vacía,
 * lo que se interpretaría erróneamente como cobertura total.
 */
const MAX_COVERAGE_ZOOM = 5;

/**
 * Comprueba si un punto queda dentro del área con cobertura de radar. Sirve para
 * avisar de que una ubicación no puede vigilarse por radar, en cuyo caso la app
 * se apoya en la previsión por modelo numérico.
 *
 * Devuelve `null` si la capa no ha podido consultarse.
 */
export async function hasRadarCoverage(index: RadarIndex, point: LatLon): Promise<boolean | null> {
  const zoom = Math.min(config.radar.analysisZoom, MAX_COVERAGE_ZOOM);
  const tileSize = config.radar.tileSize;
  const p = latLonToGlobalPixel(point, zoom, tileSize);
  const tx = Math.floor(p.x / tileSize);
  const ty = Math.floor(p.y / tileSize);
  const url = coverageTileUrl(index, { z: zoom, x: tx, y: ty, size: tileSize });
  try {
    const tile = await getAlphaTile(url, tileSize);
    const ix = Math.floor(p.x) - tx * tileSize;
    const iy = Math.floor(p.y) - ty * tileSize;
    // Se mira un pequeño entorno porque el borde de cobertura es irregular:
    // basta con que algún píxel próximo esté sin enmascarar.
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = ix + dx;
        const y = iy + dy;
        if (x < 0 || y < 0 || x >= tile.size || y >= tile.size) continue;
        if ((tile.alpha[y * tile.size + x] ?? 255) === 0) return true;
      }
    }
    return false;
  } catch {
    return null; // desconocido: no se penaliza al usuario
  }
}
