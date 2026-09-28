const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Carga el bundle de Apps Script en un contexto aislado (sin `module`), como en Google.
test('dist/Codigo.gs expone Presupuesto y las funciones de Apps Script', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '../apps-script/dist/Codigo.gs'), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(codigo, ctx);
  const P = ctx.Presupuesto;
  assert.equal(typeof ctx.importarCorreos, 'function');
  assert.equal(typeof ctx.doGet, 'function');
  const mov = P.parsearCorreo({
    id: 'x',
    cuerpo: fs.readFileSync(path.join(__dirname, 'fixtures/compra_tarjeta_tabla.txt'), 'utf8')
  });
  assert.equal(P.categorizar(mov), 'Supermercado');
  mov.categoria = 'Supermercado';
  const r = P.resumenMes([mov], '2026-09', { tipoCambio: 500, presupuestos: {} });
  assert.equal(r.gastos, 4125.5);
});

test('doGet responde JSONP solo con token válido y callback seguro', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '../apps-script/dist/Codigo.gs'), 'utf8');
  const salida = (texto) => ({ texto, setMimeType() { return this; } });
  const ctx = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'tok' }) },
    ContentService: { createTextOutput: salida, MimeType: { JSON: 'json', JAVASCRIPT: 'js' } },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) }
  });
  vm.runInContext(codigo, ctx);
  assert.match(ctx.doGet({ parameter: { token: 'tok', callback: 'cb1' } }).texto, /^cb1\(\{"generado"/);
  assert.match(ctx.doGet({ parameter: { token: 'mal', callback: 'cb1' } }).texto, /^cb1\(\{"error"/);
  assert.match(ctx.doGet({ parameter: { token: 'tok', callback: 'alert(1)//' } }).texto, /^\{"generado"/);
});
