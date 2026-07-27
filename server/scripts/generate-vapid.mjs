#!/usr/bin/env node
/**
 * Genera el par de claves VAPID necesario para los avisos push y lo guarda en
 * `data/vapid.json`. Si el fichero ya existe no se sobrescribe salvo `--force`.
 *
 *   npm run keys
 */
import { mkdirSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import webpush from 'web-push';

const target = resolve(process.env.PLOU_VAPID_FILE ?? `${process.env.PLOU_DATA_DIR ?? './data'}/vapid.json`);
const force = process.argv.includes('--force');

if (existsSync(target) && !force) {
  console.log(`Ya existen claves en ${target}. Usa --force para regenerarlas.`);
  console.log('Aviso: al regenerarlas, todas las suscripciones push actuales dejan de ser válidas.');
  process.exit(0);
}

const keys = webpush.generateVAPIDKeys();
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(keys, null, 2)}\n`);
chmodSync(target, 0o600);

console.log(`Claves VAPID escritas en ${target}`);
console.log(`Clave pública: ${keys.publicKey}`);
console.log('La clave privada queda sólo en ese fichero (permisos 600). No la compartas.');
