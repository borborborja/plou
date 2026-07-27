#!/usr/bin/env node
/**
 * Genera android/app/src/main/java/cat/plou/radar/ColorTableData.kt a partir de
 * la misma tabla de colores que usa el servidor (scripts/rainviewer_colors.csv),
 * de modo que la app Android decodifica las teselas exactamente igual y sin
 * depender de ningún servidor.
 *
 * Uso: node scripts/gen-color-table-kotlin.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

const SCHEMES = [
  { id: 0, column: 'Black and White', key: 'BLACK_AND_WHITE', label: 'Blanco y negro' },
  { id: 1, column: 'Original', key: 'ORIGINAL', label: 'Original' },
  { id: 2, column: 'Universal Blue', key: 'UNIVERSAL_BLUE', label: 'Azul universal' },
  { id: 3, column: 'Titan', key: 'TITAN', label: 'Titan' },
  { id: 4, column: 'The Weather Channel (TWC)', key: 'TWC', label: 'The Weather Channel' },
  { id: 5, column: 'Meteored', key: 'METEORED', label: 'Meteored' },
  { id: 6, column: 'NEXRAD Level III', key: 'NEXRAD', label: 'NEXRAD nivel III' },
  { id: 7, column: 'Rainbow @ Selex SI', key: 'RAINBOW', label: 'Arcoíris (Selex SI)' },
  { id: 8, column: 'Dark Sky', key: 'DARK_SKY', label: 'Dark Sky' },
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

const dbz = rain.map((r) => Number(r[0]));
if (dbz[0] !== -32 || dbz[127] !== 95) throw new Error('Rango dBZ inesperado');

/** Empaqueta una rampa (128 colores RGBA) en base64. */
function rampBase64(filas, columna) {
  const col = header.indexOf(columna);
  if (col < 0) throw new Error(`Falta la columna ${columna}`);
  const bytes = Buffer.alloc(128 * 4);
  filas.forEach((fila, i) => {
    const [r, g, b, a] = hexToRgba(fila[col]);
    bytes[i * 4] = r;
    bytes[i * 4 + 1] = g;
    bytes[i * 4 + 2] = b;
    bytes[i * 4 + 3] = a;
  });
  return bytes.toString('base64');
}

const out = [];
out.push('// GENERADO AUTOMÁTICAMENTE por scripts/gen-color-table-kotlin.mjs — no editar a mano.');
out.push('// Fuente: tabla de colores pública de RainViewer (scripts/rainviewer_colors.csv).');
out.push('package cat.plou.radar');
out.push('');
out.push('import java.util.Base64');
out.push('');
out.push('/** Valor dBZ correspondiente al índice 0 de cada rampa. */');
out.push('const val DBZ_MIN = -32');
out.push('');
out.push('/** Valor dBZ correspondiente al último índice de cada rampa. */');
out.push('const val DBZ_MAX = 95');
out.push('');
out.push('/**');
out.push(' * Esquemas de color que acepta el parámetro `color` de la API de teselas.');
out.push(' * `rain` y `snow` son 128 colores RGBA (un byte por canal) por cada dBZ.');
out.push(' */');
out.push('enum class ColorScheme(val id: Int, val label: String, rainB64: String, snowB64: String) {');
for (const s of SCHEMES) {
  const r = rampBase64(rain, s.column);
  const w = rampBase64(snow, s.column);
  out.push(`    ${s.key}(${s.id}, ${JSON.stringify(s.label)},`);
  out.push(`        "${r}",`);
  out.push(`        "${w}"),`);
}
out.push('    ;');
out.push('');
out.push('    val rain: ByteArray = Base64.getDecoder().decode(rainB64)');
out.push('    val snow: ByteArray = Base64.getDecoder().decode(snowB64)');
out.push('');
out.push('    companion object {');
out.push('        fun byId(id: Int): ColorScheme = entries.firstOrNull { it.id == id } ?: UNIVERSAL_BLUE');
out.push('    }');
out.push('}');
out.push('');

const target = join(root, 'android/app/src/main/java/cat/plou/radar/ColorTableData.kt');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out.join('\n'));
console.log(`Escrito ${target} (${SCHEMES.length} esquemas)`);
