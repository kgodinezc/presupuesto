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

// Hoja de cálculo simulada (lo mínimo que usa Main.js)
function hojaFalsa(filas) {
  const datos = filas.map((f) => f.slice());
  const celda = (r, c) => ((datos[r - 1] || [])[c - 1] ?? '');
  const poner = (r, c, v) => { while (datos.length < r) datos.push([]); datos[r - 1][c - 1] = v; };
  const rango = (r, c, nr = 1, nc = 1) => ({
    getValue: () => celda(r, c),
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => celda(r + i, c + j))),
    setValue(v) { poner(r, c, v); return this; },
    setValues(vs) { vs.forEach((f, i) => f.forEach((v, j) => poner(r + i, c + j, v))); return this; },
    setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; }
  });
  return {
    datos,
    getLastRow: () => datos.length,
    getRange: rango,
    appendRow: (f) => datos.push(f.slice()),
    clear: () => { datos.length = 0; }
  };
}

test('las columnas mesCorte y mesCalendario se agregan a hojas existentes', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '../apps-script/dist/Codigo.gs'), 'utf8');
  const COLS_VIEJAS = ['id', 'fecha', 'tipo', 'categoria', 'descripcion', 'comercio', 'monto', 'moneda',
    'montoCRC', 'tarjeta', 'ciudad', 'referencia', 'autorizacion', 'fuente', 'nota', 'excluir'];
  const fila = (id, fecha) => COLS_VIEJAS.map((c) => ({ id, fecha, tipo: 'gasto', monto: 1000, moneda: 'CRC' }[c] ?? ''));
  const movs = hojaFalsa([COLS_VIEJAS, fila('a', '2026-09-06T20:00'), fila('b', '2026-09-07T08:00'), fila('c', '2026-12-20T10:00')]);
  const pres = hojaFalsa([['categoria', 'presupuestoMensualCRC'], ['Supermercado', 300000], ['_tipoCambioUSD', 460]]);
  const hojas = { Movimientos: movs, Presupuesto: pres };
  const ss = { getSheetByName: (n) => hojas[n] || null };
  const ctx = vm.createContext({ SpreadsheetApp: { getActiveSpreadsheet: () => ss } });
  vm.runInContext(codigo, ctx);

  // Hoja vieja sin _diaCorte: se agrega la fila (0 = mes calendario) y se llena por mes calendario
  ctx.asegurarAjuste_(ss, '_diaCorte', 0);
  ctx.actualizarColumnasMes_(ss);
  assert.deepEqual([...pres.datos.at(-1)], ['_diaCorte', 0]);
  assert.equal(movs.datos[0][16], 'mesCorte');
  assert.equal(movs.datos[0][17], 'mesCalendario');
  assert.equal(movs.datos[1][16], 'Setiembre 2026');

  // Con _diaCorte = 6, el 6 de set es "Setiembre" y el 7 ya es "Octubre"
  pres.datos.at(-1)[1] = 6;
  ctx.actualizarColumnasMes_(ss);
  assert.deepEqual(movs.datos.slice(1).map((f) => f[16]),
    ['Setiembre 2026 (7 ago – 6 set)', 'Octubre 2026 (7 set – 6 oct)', 'Enero 2027 (7 dic – 6 ene)']);
  // El mes calendario no depende del corte: el 7 de set es Setiembre aunque su corte sea Octubre
  assert.deepEqual(movs.datos.slice(1).map((f) => f[17]), ['Setiembre 2026', 'Setiembre 2026', 'Diciembre 2026']);
  ctx.asegurarAjuste_(ss, '_diaCorte', 0);
  assert.equal(pres.datos.filter((f) => f[0] === '_diaCorte').length, 1, 'no duplica la fila');

  // Movimientos nuevos traen la columna calculada
  const nueva = ctx.filaDe_({ id: 'd', fecha: '2026-10-05T12:00', tipo: 'gasto', monto: 10, moneda: 'USD' }, 460, 6);
  assert.equal(nueva.length, 18);
  assert.equal(nueva[16], 'Octubre 2026 (7 set – 6 oct)');
  assert.equal(nueva[17], 'Octubre 2026');
  const otra = ctx.filaDe_({ id: 'e', fecha: '2026-10-07T09:00', tipo: 'gasto', monto: 1, moneda: 'CRC' }, 460, 6);
  assert.deepEqual([otra[16], otra[17]], ['Noviembre 2026 (7 oct – 6 nov)', 'Octubre 2026']);
  assert.equal(nueva[8], 4600);
});

test('la pestaña Resumen de la hoja agrupa por mes calendario aunque haya día de corte', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '../apps-script/dist/Codigo.gs'), 'utf8');
  const ctx0 = vm.createContext({});
  vm.runInContext(codigo, ctx0);
  const cols = [...ctx0.COLUMNAS];
  const fila = (id, fecha, tipo, monto) => cols.map((c) => ({ id, fecha, tipo, monto, moneda: 'CRC', categoria: tipo === 'ingreso' ? 'Salario' : 'Supermercado' }[c] ?? ''));
  const movs = hojaFalsa([cols,
    fila('a', '2026-09-30T10:00', 'gasto', 1000),   // corte Octubre, calendario Setiembre
    fila('b', '2026-10-02T10:00', 'gasto', 2000),   // corte Octubre, calendario Octubre
    fila('c', '2026-10-07T10:00', 'gasto', 4000),   // corte Noviembre, calendario Octubre
    fila('d', '2026-09-25T19:00', 'ingreso', 9000)]);
  const pres = hojaFalsa([['categoria', 'presupuestoMensualCRC'], ['Supermercado', 300000], ['_diaCorte', 6]]);
  const resumen = hojaFalsa([]);
  const hojas = { Movimientos: movs, Presupuesto: pres, Resumen: resumen };
  const ss = { getSheetByName: (n) => hojas[n] || null, insertSheet: (n) => (hojas[n] = hojaFalsa([])) };
  const ctx = vm.createContext({ SpreadsheetApp: { getActiveSpreadsheet: () => ss } });
  vm.runInContext(codigo, ctx);
  ctx.actualizarResumen();
  const tabla = resumen.datos.map((f) => [...f]);
  assert.equal(tabla[0][0], 'Mes calendario');
  assert.deepEqual(tabla.slice(1, 3).map((f) => [f[0], f[1], f[2]]), [['Octubre 2026', 0, 6000], ['Setiembre 2026', 9000, 1000]]);
  // y las columnas de mes quedan llenas en Movimientos
  assert.deepEqual(movs.datos.slice(1).map((f) => [f[16], f[17]]), [
    ['Octubre 2026 (7 set – 6 oct)', 'Setiembre 2026'],
    ['Octubre 2026 (7 set – 6 oct)', 'Octubre 2026'],
    ['Noviembre 2026 (7 oct – 6 nov)', 'Octubre 2026'],
    ['Octubre 2026 (7 set – 6 oct)', 'Setiembre 2026']]);
});
