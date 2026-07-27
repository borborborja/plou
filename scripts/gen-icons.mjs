#!/usr/bin/env node
/**
 * Genera los iconos de la aplicación (SVG + PNG en varios tamaños) a partir de
 * una descripción vectorial simple: una gota sobre un fondo degradado.
 *
 * Uso: node scripts/gen-icons.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'web/public');
mkdirSync(outDir, { recursive: true });

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Plou">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1e3a5f"/>
      <stop offset="1" stop-color="#0b1220"/>
    </linearGradient>
    <linearGradient id="drop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7dd3fc"/>
      <stop offset="1" stop-color="#0284c7"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <g fill="none" stroke="#38bdf8" stroke-opacity="0.35" stroke-width="10" stroke-linecap="round">
    <path d="M126 300a130 130 0 0 1 0-184"/>
    <path d="M386 300a130 130 0 0 0 0-184"/>
    <path d="M170 268a72 72 0 0 1 0-120"/>
    <path d="M342 268a72 72 0 0 0 0-120"/>
  </g>
  <path d="M256 96c0 0 104 122 104 190a104 104 0 0 1-208 0c0-68 104-190 104-190z" fill="url(#drop)"/>
  <path d="M212 300a44 44 0 0 0 26 40" fill="none" stroke="#e0f2fe" stroke-opacity="0.75" stroke-width="16" stroke-linecap="round"/>
</svg>
`;

writeFileSync(join(outDir, 'icon.svg'), SVG);

// ---------------------------------------------------------------------------
// Rasterizado propio: basta con reproducir las mismas formas con funciones
// implícitas, evitando así depender de una librería de conversión SVG->PNG.

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Distancia con signo a la silueta de la gota, definida como la unión de un
 * círculo inferior y un triángulo superior que se estrecha hacia la punta.
 */
function dropDistance(x, y) {
  const cx = 0.5;
  const cy = 0.635;
  const r = 0.205;
  const tipY = 0.185;

  const dCircle = Math.hypot(x - cx, y - cy) - r;
  if (y >= cy) return dCircle;

  // Ancho lineal desde la punta hasta la altura del centro del círculo.
  const t = (y - tipY) / (cy - tipY);
  if (t < 0) return Math.hypot(x - cx, y - tipY);
  const halfWidth = r * Math.pow(Math.max(0, t), 0.72);
  return Math.abs(x - cx) - halfWidth;
}

function roundedSquareDistance(x, y, radius) {
  const dx = Math.abs(x - 0.5) - (0.5 - radius);
  const dy = Math.abs(y - 0.5) - (0.5 - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

function renderIcon(size, { maskable = false } = {}) {
  const png = new PNG({ width: size, height: size });
  const ss = 3; // submuestreo para suavizar bordes
  const cornerRadius = maskable ? 0.5 : 0.22;
  const scale = maskable ? 0.78 : 1; // margen seguro para iconos recortables

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;

          const inBackground = roundedSquareDistance(x, y, cornerRadius) < 0;
          if (!inBackground) continue;

          const bg = mix([30, 58, 95], [11, 18, 32], y);
          let color = bg;

          // Coordenadas de la gota, encogidas si el icono es recortable.
          const gx = 0.5 + (x - 0.5) / scale;
          const gy = 0.5 + (y - 0.5) / scale;

          // Arcos decorativos de radar detrás de la gota.
          const ringR = Math.hypot(gx - 0.5, gy - 0.42);
          for (const [radius, width] of [
            [0.36, 0.012],
            [0.235, 0.01],
          ]) {
            if (Math.abs(ringR - radius) < width && Math.abs(gx - 0.5) > 0.06) {
              color = mix(color, [56, 189, 248], 0.35);
            }
          }

          const d = dropDistance(gx, gy);
          if (d < 0) {
            const shade = Math.min(1, Math.max(0, (gy - 0.2) / 0.62));
            color = mix([125, 211, 252], [2, 132, 199], shade);
            // Reflejo interior.
            const hl = Math.hypot(gx - 0.44, gy - 0.63) - 0.075;
            if (hl < 0 && hl > -0.03) color = mix(color, [224, 242, 254], 0.6);
          }

          r += color[0];
          g += color[1];
          b += color[2];
          a += 255;
        }
      }
      const n = ss * ss;
      const idx = (py * size + px) * 4;
      const alpha = a / n;
      png.data[idx] = alpha === 0 ? 0 : Math.round(r / n);
      png.data[idx + 1] = alpha === 0 ? 0 : Math.round(g / n);
      png.data[idx + 2] = alpha === 0 ? 0 : Math.round(b / n);
      png.data[idx + 3] = Math.round(alpha);
    }
  }
  return PNG.sync.write(png);
}

for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), renderIcon(size));
  console.log(`icon-${size}.png`);
}
writeFileSync(join(outDir, 'icon-maskable-512.png'), renderIcon(512, { maskable: true }));
console.log('icon-maskable-512.png');
console.log('icon.svg');
