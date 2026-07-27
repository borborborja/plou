#!/usr/bin/env node
/**
 * Genera server/src/radar/colorTable.generated.ts a partir de la tabla de colores
 * publicada por RainViewer (scripts/rainviewer_colors.csv).
 *
 * El CSV tiene 256 filas de datos: las 128 primeras son los colores de lluvia
 * (dBZ -32..95) y las 128 siguientes los de nieve, para cada esquema de color.
 *
 * Uso: node scripts/gen-color-table.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const csv = readFileSync(join(root, 'scripts/rainviewer_colors.csv'), 'utf8').trim();

const rows = csv.split(/\r?\n/).map((line) => line.split(','));
const header = rows[0];
const data = rows.slice(1);

if (data.length !== 256) throw new Error(`Se esperaban 256 filas de datos, hay ${data.length}`);

const rain = data.slice(0, 128);
const snow = data.slice(128);

// Identificadores de esquema tal y como los acepta el parámetro `color` de la API de teselas.
const SCHEMES = [
  { id: 0, column: 'Black and White', key: 'blackAndWhite', label: 'Blanco y negro' },
  { id: 1, column: 'Original', key: 'original', label: 'Original' },
  { id: 2, column: 'Universal Blue', key: 'universalBlue', label: 'Azul universal' },
  { id: 3, column: 'Titan', key: 'titan', label: 'Titan' },
  { id: 4, column: 'The Weather Channel (TWC)', key: 'twc', label: 'The Weather Channel' },
  { id: 5, column: 'Meteored', key: 'meteored', label: 'Meteored' },
  { id: 6, column: 'NEXRAD Level III', key: 'nexrad', label: 'NEXRAD nivel III' },
  { id: 7, column: 'Rainbow @ Selex SI', key: 'rainbow', label: 'Arcoíris (Selex SI)' },
  { id: 8, column: 'Dark Sky', key: 'darkSky', label: 'Dark Sky' },
];

function hexToRgba(hex) {
  const h = hex.trim().replace('#', '');
  if (h.length !== 8) throw new Error(`Color inesperado: ${hex}`);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    parseInt(h.slice(6, 8), 16),
  ];
}

const dbzValues = rain.map((r) => Number(r[0]));
if (dbzValues[0] !== -32 || dbzValues[127] !== 95) throw new Error('Rango dBZ inesperado');

const out = [];
out.push('// GENERADO AUTOMÁTICAMENTE por scripts/gen-color-table.mjs — no editar a mano.');
out.push('// Fuente: tabla de colores pública de RainViewer (rainviewer_api_colors_table.csv).');
out.push('');
out.push('/** Valor dBZ correspondiente al índice 0 de cada rampa. */');
out.push('export const DBZ_MIN = -32;');
out.push('/** Valor dBZ correspondiente al último índice de cada rampa. */');
out.push('export const DBZ_MAX = 95;');
out.push('');
out.push('export type ColorSchemeKey =');
out.push(SCHEMES.map((s) => `  | '${s.key}'`).join('\n') + ';');
out.push('');
out.push('export interface ColorSchemeInfo {');
out.push('  readonly id: number;');
out.push('  readonly key: ColorSchemeKey;');
out.push('  readonly label: string;');
out.push('}');
out.push('');
out.push('export const COLOR_SCHEMES: readonly ColorSchemeInfo[] = [');
for (const s of SCHEMES) {
  out.push(`  { id: ${s.id}, key: '${s.key}', label: ${JSON.stringify(s.label)} },`);
}
out.push('];');
out.push('');
out.push('/**');
out.push(' * Rampas de color por esquema. Cada rampa es un Uint8Array de 128*4 bytes');
out.push(' * (RGBA por cada dBZ de -32 a 95).');
out.push(' */');
out.push('function ramp(base64: string): Uint8Array {');
out.push("  return new Uint8Array(Buffer.from(base64, 'base64'));");
out.push('}');
out.push('');

function rampBase64(rowsSet, columnIndex) {
  const buf = Buffer.alloc(128 * 4);
  rowsSet.forEach((row, i) => {
    const [r, g, b, a] = hexToRgba(row[columnIndex]);
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = a;
  });
  return buf.toString('base64');
}

out.push('export const RAIN_RAMPS: Record<ColorSchemeKey, Uint8Array> = {');
for (const s of SCHEMES) {
  const idx = header.indexOf(s.column);
  if (idx < 0) throw new Error(`Columna no encontrada: ${s.column}`);
  out.push(`  ${s.key}: ramp('${rampBase64(rain, idx)}'),`);
}
out.push('};');
out.push('');
out.push('export const SNOW_RAMPS: Record<ColorSchemeKey, Uint8Array> = {');
for (const s of SCHEMES) {
  const idx = header.indexOf(s.column);
  out.push(`  ${s.key}: ramp('${rampBase64(snow, idx)}'),`);
}
out.push('};');
out.push('');

const target = join(root, 'server/src/radar/colorTable.generated.ts');
writeFileSync(target, out.join('\n'));
console.log(`Escrito ${target} (${SCHEMES.length} esquemas × 128 niveles dBZ)`);
