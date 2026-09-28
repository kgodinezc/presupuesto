const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parsearCorreo, parsearMonto, parsearFechaDMY } = require('../app/js/core/parser.js');
const { categorizar, claveComercio } = require('../app/js/core/categorias.js');
const { resumenMes, posiblesDuplicados } = require('../app/js/core/resumen.js');

const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

test('parsearMonto maneja formatos comunes', () => {
  assert.equal(parsearMonto('2,350.00'), 2350);
  assert.equal(parsearMonto('1,000,000.00'), 1000000);
  assert.equal(parsearMonto('.00'), 0);
  assert.equal(parsearMonto('1.234,56'), 1234.56);
});

test('parsearFechaDMY convierte a 24 horas', () => {
  assert.equal(parsearFechaDMY('25/09/2026', '07:48:59 p.m.'), '2026-09-25T19:48');
  assert.equal(parsearFechaDMY('7/8/2026', '3:49 PM'), '2026-08-07T15:49');
  assert.equal(parsearFechaDMY('11/09/2026', '12:02:25 p.m.'), '2026-09-11T12:02');
  assert.equal(parsearFechaDMY('10-08-2026', '17:42:58'), '2026-08-10T17:42');
});

test('compra con tarjeta (formato tabla)', () => {
  const m = parsearCorreo({ id: 'a1', cuerpo: fixture('compra_tarjeta_tabla.txt') });
  assert.equal(m.tipo, 'gasto');
  assert.equal(m.comercio, 'AUTO MERCADO SUCURSAL');
  assert.equal(m.monto, 4125.5);
  assert.equal(m.moneda, 'CRC');
  assert.equal(m.fecha, '2026-09-28T08:15');
  assert.equal(m.tarjeta, 'MASTER 0000');
  assert.equal(m.autorizacion, '111111');
  assert.equal(m.ciudad, 'SAN JOSE, Costa Rica');
});

test('compra con tarjeta (formato de líneas de Apps Script, USD)', () => {
  const m = parsearCorreo({ id: 'a2', cuerpo: fixture('compra_tarjeta_lineas.txt') });
  assert.equal(m.comercio, 'AMAZON MARKETPLACE');
  assert.equal(m.monto, 42.1);
  assert.equal(m.moneda, 'USD');
  assert.equal(m.fecha, '2026-09-20T21:05');
  assert.equal(m.tarjeta, 'VISA 1234');
});

test('autorizaciones en 0.00 se ignoran', () => {
  assert.equal(parsearCorreo({ cuerpo: fixture('compra_cero.txt') }), null);
});

test('SINPE recibido es ingreso', () => {
  const m = parsearCorreo({ id: 's1', cuerpo: fixture('sinpe_recibido.txt') });
  assert.equal(m.tipo, 'ingreso');
  assert.equal(m.monto, 500000);
  assert.equal(m.moneda, 'CRC');
  assert.equal(m.fecha, '2026-09-25T19:30');
  assert.equal(m.comercio, 'PLANILLA EMPRESA EJEMPLO');
  assert.equal(categorizar(m), 'Salario');
});

test('SINPE recibido en dólares', () => {
  const m = parsearCorreo({ cuerpo: fixture('sinpe_recibido_dolares.txt') });
  assert.equal(m.tipo, 'ingreso');
  assert.equal(m.monto, 75);
  assert.equal(m.moneda, 'USD');
  assert.equal(m.comercio, 'PAGO DE PRUEBA');
  assert.equal(m.fecha, '2026-08-07T15:49');
});

test('SINPE enviado es transferencia (no gasto)', () => {
  const m = parsearCorreo({ cuerpo: fixture('sinpe_enviado.txt') });
  assert.equal(m.tipo, 'transferencia');
  assert.equal(m.monto, 250000);
  assert.equal(m.fecha, '2026-09-11T12:02');
  assert.equal(categorizar(m), 'Transferencias');
});

test('transferencia local recibida', () => {
  const m = parsearCorreo({ cuerpo: fixture('transferencia_local.txt') });
  assert.equal(m.tipo, 'ingreso');
  assert.equal(m.monto, 120);
  assert.equal(m.moneda, 'USD');
  assert.equal(m.comercio, 'EMPRESA EJEMPLO S.A.');
  assert.match(m.descripcion, /Premio de ejemplo/);
});

test('correos que no son transacciones devuelven null', () => {
  assert.equal(parsearCorreo({ asunto: 'Activar GOOGLE PAY', cuerpo: 'Usa este código: 000000' }), null);
});

test('categorización automática de comercios típicos', () => {
  const c = (comercio) => categorizar({ tipo: 'gasto', comercio });
  assert.equal(c('AUTO MERCADO CENTRO'), 'Supermercado');
  assert.equal(c('MXM SUCURSAL 01'), 'Supermercado');
  assert.equal(c('PRICESMART COSTA RICA'), 'Supermercado');
  assert.equal(c('DLC*UBER EATS'), 'Restaurantes y comidas');
  assert.equal(c('DLC*UBER RIDES'), 'Transporte y vehículo');
  assert.equal(c('BOTICA CENTRAL'), 'Salud');
  assert.equal(c('Spotify P000000000'), 'Suscripciones digitales');
  assert.equal(c('AMAZON MARKETPLACE'), 'Compras en línea');
  assert.equal(c('H&M'), 'Ropa y cuidado personal');
  assert.equal(c('CROSSFIT CENTRO'), 'Deporte');
  assert.equal(c('LIBRERIA INTERNACIONAL'), 'Educación y libros');
  assert.equal(c('EXN*CLIENTE*PRUEBA'), 'Ahorro e inversión');
  assert.equal(c('COMERCIO DESCONOCIDO'), 'Otros');
});

test('las reglas del usuario tienen prioridad', () => {
  const reglas = { [claveComercio('COMERCIO NUEVO')]: 'Restaurantes y comidas' };
  assert.equal(categorizar({ tipo: 'gasto', comercio: 'COMERCIO NUEVO' }, reglas), 'Restaurantes y comidas');
});

test('resumen mensual: ingresos, gastos, ahorro, transferencias y USD', () => {
  const movs = [
    { id: '1', fecha: '2026-09-11T18:48', tipo: 'ingreso', monto: 1000000, moneda: 'CRC', categoria: 'Salario' },
    { id: '2', fecha: '2026-09-12T10:00', tipo: 'gasto', monto: 100000, moneda: 'CRC', categoria: 'Supermercado', comercio: 'A' },
    { id: '3', fecha: '2026-09-13T10:00', tipo: 'gasto', monto: 100, moneda: 'USD', categoria: 'Compras en línea', comercio: 'B' },
    { id: '4', fecha: '2026-09-14T10:00', tipo: 'gasto', monto: 50000, moneda: 'CRC', categoria: 'Ahorro e inversión', comercio: 'C' },
    { id: '5', fecha: '2026-09-15T10:00', tipo: 'transferencia', monto: 300000, moneda: 'CRC', categoria: 'Transferencias' },
    { id: '6', fecha: '2026-09-16T10:00', tipo: 'reembolso', monto: 10000, moneda: 'CRC', categoria: 'Supermercado', comercio: 'A' },
    { id: '7', fecha: '2026-08-30T10:00', tipo: 'gasto', monto: 999, moneda: 'CRC', categoria: 'Otros' }
  ];
  const r = resumenMes(movs, '2026-09', { tipoCambio: 500, presupuestos: { Supermercado: 80000 } });
  assert.equal(r.ingresos, 1000000);
  assert.equal(r.gastos, 100000 - 10000 + 50000);
  assert.equal(r.ahorro, 50000);
  assert.equal(r.transferencias, 300000);
  assert.equal(r.balance, 1000000 - 140000 - 50000);
  const sup = r.porCategoria.find((c) => c.categoria === 'Supermercado');
  assert.equal(sup.total, 90000);
  assert.ok(r.alertas.some((a) => a.tipo === 'excedido' && a.categoria === 'Supermercado'));
});

test('detecta posibles cobros duplicados', () => {
  const base = { tipo: 'gasto', comercio: 'HOTEL X', monto: 10000, moneda: 'CRC' };
  const dups = posiblesDuplicados([
    { ...base, id: 'x', fecha: '2026-09-18T14:52' },
    { ...base, id: 'y', fecha: '2026-09-18T14:52' },
    { ...base, id: 'z', fecha: '2026-09-19T14:52' }
  ]);
  assert.equal(dups.length, 1);
});
