const test = require('node:test');
const assert = require('node:assert/strict');

const B = require('../app/js/core/estadoBancario.js');
const R = require('../app/js/core/resumen.js');
const items = require('./fixtures/estado_bancario.js');

const eb = B.parsearEstadoBancario(items);
const linea = (ref) => eb.lineas.find((l) => l.referencia === ref);

test('datos generales del estado bancario', () => {
  assert.equal(eb.clave, '2026-10');
  assert.equal(eb.fechaCorte, '2026-10-31');
  assert.equal(eb.cuenta, '1234');
  assert.equal(eb.moneda, 'CRC');
  assert.equal(eb.nombre, 'Cuenta en colones ···1234 · Octubre 2026');
  assert.equal(eb.saldoAnterior, 1000000);
  assert.equal(eb.saldoFinal, 484750.5);
  assert.equal(eb.totalDebitos, 1525500);   // "1525,500.00": BAC omite una coma
  assert.equal(eb.totalCreditos, 1010250.5);
  assert.equal(eb.cantidadDebitos, 7);
  assert.equal(eb.cantidadCreditos, 3);
});

test('lee las líneas de ambas páginas y distingue débitos de créditos por la columna', () => {
  assert.equal(eb.lineas.length, 10);
  assert.equal(eb.lineas.filter((l) => l.esCredito).length, 3);
  assert.deepEqual(
    { ...linea('960000003') },
    { referencia: '960000003', concepto: 'CD SINPE EMPRESA PATRONAL S', monto: 900000, esCredito: true,
      fecha: '2026-10-10', moneda: 'CRC', id: 'eb-1234-960000003-2026-10-10-900000.00c' });
  assert.equal(linea('406000001').esCredito, false);
  assert.equal(linea('093000010').monto, 250.5);
  assert.equal(linea('093000010').esCredito, true);
});

test('el mes posterior al corte es del año anterior', () => {
  const dic = B.parsearEstadoBancario(items.map((it) => ({ ...it,
    str: it.str.replace('31/OCT/26', '31/ENE/27').replace(/^OCT\/02$/, 'DIC/30') })));
  assert.equal(dic.fechaCorte, '2027-01-31');
  assert.equal(dic.lineas[0].fecha, '2026-12-30');
});

test('cuenta en dólares', () => {
  const usd = B.parsearEstadoBancario(items.map((it) => ({ ...it, str: it.str === 'COLONES' ? 'DOLARES' : it.str })));
  assert.equal(usd.moneda, 'USD');
  assert.ok(usd.lineas.every((l) => l.moneda === 'USD'));
  assert.match(usd.nombre, /^Cuenta en dólares/);
});

test('clasifica cada línea', () => {
  const c = (ref, reglas) => B.clasificarLinea(linea(ref), reglas);
  assert.deepEqual(c('000000004'), { tipo: 'transferencia', categoria: 'Pago de tarjeta', descripcion: 'Pago tarjeta ****1111', comercio: 'Pago tarjeta ****1111' });
  assert.deepEqual([c('666000005').tipo, c('666000005').categoria], ['gasto', 'Ahorro e inversión']);
  assert.deepEqual([c('951000006').tipo, c('951000006').categoria], ['gasto', 'Servicios del hogar']);
  // SINPE y transferencias enviadas son gasto
  assert.deepEqual([c('406000001').tipo, c('406000001').categoria, c('406000001').descripcion],
    ['gasto', 'SINPE y transferencias', 'Transferencia enviada a la cuenta 900000001']);
  assert.deepEqual([c('966000002').tipo, c('966000002').categoria, c('966000002').descripcion],
    ['gasto', 'SINPE y transferencias', 'SINPE Móvil enviado: Huevos Ana']);
  assert.deepEqual([c('960000003').tipo, c('960000003').categoria], ['ingreso', 'Transferencias recibidas']);
  assert.deepEqual([c('406000008').categoria, c('406000008').descripcion], ['Transferencias recibidas', 'Transferencia recibida: FAMILIAR DE PRUEBA']);
  assert.deepEqual([c('093000010').categoria, c('093000010').descripcion], ['Otros ingresos', 'Intereses de la cuenta']);
  // Reglas del usuario: salario por remitente y un SINPE Móvil frecuente que en realidad es gasto
  const reglas = { 'EMPRESA PATRONAL S': 'Salario', 'HUEVOS ANA': 'Supermercado', 'SIN DESCRIPCION': 'Entre cuentas propias' };
  assert.equal(c('960000003', reglas).categoria, 'Salario');
  assert.deepEqual([c('966000002', reglas).tipo, c('966000002', reglas).categoria], ['gasto', 'Supermercado']);
  // Excepción: una regla hacia "no es gasto" deja el SINPE fuera del gasto
  assert.deepEqual([c('966000009', reglas).tipo, c('966000009', reglas).categoria], ['transferencia', 'Entre cuentas propias']);
});

const movimientos = [
  { id: 'correo-salario', fecha: '2026-10-10T08:00', tipo: 'ingreso', descripcion: 'SINPE recibido: EMPRESA', comercio: 'EMPRESA', monto: 900000, moneda: 'CRC', categoria: 'Salario' },
  { id: 'correo-ahorro', fecha: '2026-10-11T12:02', tipo: 'gasto', descripcion: 'SINPE enviado', comercio: 'SINPE enviado', monto: 1000000, moneda: 'CRC', categoria: 'SINPE y transferencias', fuente: 'BAC SINPE' },
  // Compra con tarjeta de crédito por el mismo monto que un SINPE: no sale de la cuenta, no debe emparejarse
  { id: 'tarjeta-1', fecha: '2026-10-03T10:00', tipo: 'gasto', descripcion: 'Compra', comercio: 'FERIA', monto: 3500, moneda: 'CRC', tarjeta: 'VISA ****1111', categoria: 'Supermercado' },
  // SINPE recibido por correo en otra cuenta
  { id: 'correo-otra', fecha: '2026-10-05T10:00', tipo: 'ingreso', descripcion: 'SINPE recibido: X', comercio: 'X', monto: 5000, moneda: 'CRC', categoria: 'Otros ingresos' }
];

test('concilia con los movimientos de la app y cuadra con el resumen del banco', () => {
  const c = B.conciliarBanco(eb, movimientos, { tarjetasCredito: ['1111'] });
  assert.equal(c.resumen.cuadra, true);
  assert.equal(c.resumen.debitos, 1525500);
  assert.equal(c.resumen.creditos, 1010250.5);
  assert.deepEqual(c.coinciden.map((x) => [x.linea.referencia, x.movimiento.id]),
    [['960000003', 'correo-salario'], ['666000005', 'correo-ahorro']]);
  assert.equal(c.soloBanco.length, 8);
  assert.ok(!c.soloBanco.some((x) => x.linea.referencia === '960000003'));
  assert.deepEqual(c.soloApp.map((m) => m.id), ['correo-otra']);
  assert.equal(c.resumen.soloBancoDebitos, 525500);
  assert.equal(c.duplicados.length, 1);
  assert.equal(c.duplicados[0][0].concepto, 'Pago Liberty Móvil (Movistar 8');
  const pago = c.porCategoria.find((x) => x.categoria === 'Pago de tarjeta');
  assert.deepEqual({ ...pago }, { categoria: 'Pago de tarjeta', tipo: 'transferencia', entrada: false, total: 250000, cantidad: 1 });

  // Un saldo que no calza se detecta
  assert.equal(B.conciliarBanco({ ...eb, saldoFinal: 1 }, movimientos).resumen.cuadra, false);
});

test('aplicar la conciliación agrega, vincula y reclasifica; reaplicar no duplica', () => {
  const c = B.conciliarBanco(eb, movimientos, { tarjetasCredito: ['1111'] });
  const ids = c.soloBanco.map((x) => x.linea.id);
  const r = B.aplicarConciliacionBanco(eb, c, movimientos, ids);
  assert.equal(r.agregados, 8);
  assert.equal(r.vinculados, 2);
  assert.equal(r.reclasificados, 1);
  assert.equal(movimientos[1].categoria, 'SINPE y transferencias', 'no modifica el original');

  const ahorro = r.movimientos.find((m) => m.id === 'correo-ahorro');
  assert.deepEqual([ahorro.tipo, ahorro.categoria, ahorro.refBanco], ['gasto', 'Ahorro e inversión', 'eb-1234-666000005-2026-10-11-1000000.00d']);
  const pago = r.movimientos.find((m) => m.referencia === '000000004');
  assert.deepEqual([pago.tipo, pago.categoria, pago.fecha, pago.fuente, pago.cuenta], ['transferencia', 'Pago de tarjeta', '2026-10-11T12:00', 'Estado bancario', '1234']);

  const c2 = B.conciliarBanco(eb, r.movimientos, { tarjetasCredito: ['1111'] });
  assert.equal(c2.soloBanco.length, 0);
  assert.equal(c2.coinciden.length, 10);
  const r2 = B.aplicarConciliacionBanco(eb, c2, r.movimientos, []);
  assert.equal(r2.agregados, 0);
  assert.equal(r2.vinculados, 0);
  assert.equal(r2.movimientos.length, r.movimientos.length);

  // Resumen del mes calendario: SINPE y transferencias enviadas en el gasto; el pago de tarjeta, aparte
  const res = R.resumenMes(r.movimientos, '2026-10', { tipoCambio: 500 });
  assert.equal(res.ingresos, 900000 + 110000 + 250.5 + 5000);
  assert.equal(res.gastos, 3500 + 24000 + 150000 + 3500 + 98000);
  assert.equal(res.enviadosGasto, 150000 + 3500 + 98000);
  assert.equal(res.ahorro, 1000000);
  assert.equal(res.transferencias, 250000);
  assert.deepEqual(res.porTransferencia.map((t) => [t.categoria, t.total]), [['Pago de tarjeta', 250000]]);
  assert.ok(res.porIngreso.some((i) => i.categoria === 'Transferencias recibidas' && i.total === 110000));
});
