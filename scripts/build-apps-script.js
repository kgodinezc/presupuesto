#!/usr/bin/env node
/**
 * Genera apps-script/dist/Codigo.gs: un único archivo para pegar en el editor
 * de Google Apps Script (Extensiones > Apps Script), con la lógica compartida
 * de la app web (parser, categorías, resumen) + el código de Gmail/Sheets.
 */
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const partes = [
  'app/js/core/parser.js',
  'app/js/core/categorias.js',
  'app/js/core/resumen.js',
  'app/js/core/estadoCuenta.js',
  'apps-script/Main.js'
];

const encabezado = '// ARCHIVO GENERADO con `npm run build:gas`. No editar a mano;\n' +
  '// modifique app/js/core/*.js o apps-script/Main.js y vuelva a generarlo.\n\n';

const cuerpo = partes
  .map((p) => '// ===== ' + p + ' =====\n' + fs.readFileSync(path.join(raiz, p), 'utf8'))
  .join('\n');

const destino = path.join(raiz, 'apps-script/dist/Codigo.gs');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, encabezado + cuerpo);
console.log('Generado ' + path.relative(raiz, destino));
