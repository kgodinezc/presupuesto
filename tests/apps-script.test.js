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
