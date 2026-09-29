const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const E = require('../app/js/core/estadoCuenta.js');
const R = require('../app/js/core/resumen.js');

const filas = fs.readFileSync(path.join(__dirname, 'fixtures/estado_cuenta_filas.txt'), 'utf8').split('\n');
const ec = E.parsearEstadoCuenta(filas);
const [visa, master] = ec.tarjetas;

test('agruparFilas ordena por página, altura y posición', () => {
  const filasPdf = E.agruparFilas([
    { pagina: 1, y: 700, x: 200, str: 'CRC' }, { pagina: 1, y: 701, x: 10, str: 'Monto:' },
    { pagina: 1, y: 650, x: 10, str: 'Otra fila' }, { pagina: 2, y: 900, x: 10, str: 'Página 2' }, { pagina: 1, y: 500, x: 0, str: '  ' }
  ]);
  assert.deepEqual(filasPdf, ['Monto: | CRC', 'Otra fila', 'Página 2']);
});

test('datos generales del estado de cuenta', () => {
  assert.equal(ec.clave, '2026-09');
  assert.equal(ec.fechaCorte, '2026-09-06');
  assert.equal(ec.mesEstado, 'SET-2026');
  assert.deepEqual(ec.periodo, { inicio: '2026-08-07', fin: '2026-09-06' });
  assert.equal(ec.tarjetas.length, 2);
  assert.equal(visa.tarjeta, '1111');
  assert.equal(master.tarjeta, '2222');
  assert.deepEqual(master.pagoContado, { CRC: 60995, USD: 25.2 });
  assert.equal(master.fechaLimitePago, '');
  assert.equal(visa.fechaLimitePago, '2026-09-21');
});

test('compras y otros cargos suman los totales del banco', () => {
  for (const t of ec.tarjetas) {
    const suma = { CRC: 0, USD: 0 }, otros = { CRC: 0, USD: 0 };
    t.cargos.forEach((c) => {
      const d = c.seccion === 'otros cargos' ? otros : suma;
      d[c.moneda] += (c.esCredito ? -1 : 1) * c.monto;
    });
    assert.equal(Math.round(suma.CRC * 100) / 100, t.totales.compras.CRC);
    assert.equal(Math.round(suma.USD * 100) / 100, t.totales.compras.USD);
    assert.equal(Math.round(otros.USD * 100) / 100, t.totales.otrosCargos.USD);
  }
  assert.equal(master.totales.intereses.CRC, 200);
});

test('descripciones partidas y nombre del comercio', () => {
  assert.equal(visa.cargos[1].comercio, 'PARQUEO CENTRO COMERC COMPAS');
  assert.equal(master.cargos[0].comercio, 'SUPERMERCADO EJEMPLO C');
  assert.equal(master.cargos[1].comercio, 'RESTAURANTE DE PRUEBA');
  assert.equal(master.cargos.find((c) => c.moneda === 'USD' && c.esCredito).comercio, 'SERVICIO DIGITAL*X');
  const ids = ec.tarjetas.flatMap((t) => t.cargos.map((c) => c.id));
  assert.equal(new Set(ids).size, ids.length, 'ids únicos aunque la referencia se repita');
});

test('el pago en dólares se identifica por el total en USD', () => {
  assert.deepEqual(master.pagos.map((p) => [p.monto, p.moneda]), [[450000, 'CRC'], [50, 'USD'], [50000, 'CRC']]);
});

test('conciliación: coinciden, faltan en la app, faltan en el estado y próximo estado', () => {
  const movs = [
    { id: 'a', fecha: '2026-08-05T10:00', tipo: 'gasto', comercio: 'SUPERMERCADO EJEMPLO CENTRO', monto: 10000, moneda: 'CRC', tarjeta: 'MASTER 2222' },
    { id: 'b', fecha: '2026-08-10T12:00', tipo: 'gasto', comercio: 'RESTAURANTE DE PRUEBA NORTE', monto: 8500, moneda: 'CRC', tarjeta: 'MASTER 2222' },
    { id: 'c', fecha: '2026-09-03T14:07', tipo: 'gasto', comercio: 'Spotify P000000000', monto: 11.99, moneda: 'USD', tarjeta: 'MASTER 2222' },
    { id: 'd', fecha: '2026-08-20T10:00', tipo: 'gasto', comercio: 'COBRO NO RECONOCIDO', monto: 5000, moneda: 'CRC', tarjeta: 'MASTER 2222' },
    { id: 'e', fecha: '2026-09-05T18:00', tipo: 'gasto', comercio: 'SUPER CERCA DEL CORTE', monto: 7000, moneda: 'CRC', tarjeta: 'MASTER 2222' },
    { id: 'f', fecha: '2026-08-15T10:00', tipo: 'gasto', comercio: 'OTRA TARJETA', monto: 1234, moneda: 'CRC', tarjeta: 'VISA 9999' },
    { id: 't', fecha: '2026-08-29T09:00', tipo: 'transferencia', comercio: 'SINPE enviado', monto: 50000, moneda: 'CRC' }
  ];
  const c = E.conciliar(ec, movs);
  assert.deepEqual(c.coinciden.map((x) => x.movimiento.id).sort(), ['a', 'b', 'c']);
  // una de las dos compras idénticas del restaurante no está en la app
  assert.equal(c.soloEstado.filter((x) => /RESTAURANTE/.test(x.cargo.comercio)).length, 1);
  assert.ok(c.soloEstado.some((x) => /IVA/.test(x.cargo.descripcion)));
  assert.ok(c.soloEstado.some((x) => /COMPASS/.test(x.cargo.descripcion)));
  assert.deepEqual(c.soloApp.map((x) => [x.movimiento.id, x.proximoEstado]), [['d', false], ['e', true]]);
  assert.equal(c.pagos.find((p) => p.pago.monto === 50000).transferencia.id, 't');

  const ap = E.aplicarConciliacion(ec, c, movs, c.soloEstado.filter((x) => /IVA/.test(x.cargo.descripcion)).map((x) => x.cargo.id), {});
  assert.equal(ap.agregados, 1);
  assert.equal(ap.asignados, 3);
  assert.equal(ap.movidos, 1);
  const porId = Object.fromEntries(ap.movimientos.map((m) => [m.id, m]));
  assert.equal(porId.a.periodo, '2026-09');
  assert.equal(porId.e.periodo, '2026-10');
  assert.equal(movs[0].periodo, undefined, 'no modifica el arreglo original');
  const iva = ap.movimientos.find((m) => m.fuente === 'Estado de cuenta');
  assert.equal(iva.categoria, 'Suscripciones digitales');

  // Una segunda conciliación reconoce lo ya agregado y no repite lo que pasó al periodo siguiente
  const c2 = E.conciliar(ec, ap.movimientos);
  assert.ok(c2.coinciden.some((x) => x.agregadoDelEstado));
  assert.deepEqual(c2.soloApp.map((x) => x.movimiento.id), ['d']);
  assert.ok(!c2.soloEstado.some((x) => /IVA/.test(x.cargo.descripcion)));

  // El resumen respeta el periodo asignado por el estado (compra del 5-AGO cuenta en SET)
  const r = R.resumenMes(ap.movimientos, '2026-09', { diaCorte: 6, tipoCambio: 500, presupuestos: {} });
  assert.ok(r.cantidadMovimientos >= 4);
  assert.equal(R.resumenMes(ap.movimientos, '2026-10', { diaCorte: 6 }).gastos, 7000);
});

test('periodos por día de corte', () => {
  assert.equal(R.periodoDe('2026-09-06T23:59', 6), '2026-09');
  assert.equal(R.periodoDe('2026-09-07T00:00', 6), '2026-10');
  assert.equal(R.periodoDe('2026-12-15', 6), '2027-01');
  assert.equal(R.periodoDe('2026-09-15', 0), '2026-09');
  assert.deepEqual(R.rangoPeriodo('2026-09', 6), { inicio: '2026-08-07', fin: '2026-09-06' });
  assert.deepEqual(R.rangoPeriodo('2026-03', 31), { inicio: '2026-03-01', fin: '2026-03-31' });
  assert.deepEqual(R.rangoPeriodo('2026-02', 30), { inicio: '2026-01-31', fin: '2026-02-28' });
  assert.equal(R.etiquetaPeriodo('2026-10', 6), '7 set – 6 oct 2026');
  assert.equal(R.etiquetaPeriodo('2026-09', 0), 'Setiembre 2026');
});
