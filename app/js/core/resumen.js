/**
 * Cálculos del presupuesto: totales mensuales, gasto por categoría contra
 * presupuesto, serie histórica y alertas (posibles cobros duplicados, categorías
 * excedidas).
 *
 * Convenciones:
 *  - Todos los totales se expresan en colones (CRC); los montos en USD se
 *    convierten con el tipo de cambio configurado.
 *  - "transferencia" (p. ej. SINPE enviado) NO se suma como gasto: con
 *    frecuencia es el pago de la tarjeta o un traslado entre cuentas propias y
 *    contarlo duplicaría las compras. Se reporta aparte para revisarlo.
 *  - La categoría "Ahorro e inversión" se reporta aparte del gasto de consumo.
 */
(function (root) {
  'use strict';

  var Cat = (typeof module !== 'undefined' && module.exports)
    ? require('./categorias.js')
    : root.Presupuesto;

  function aColones(mov, tipoCambio) {
    if (mov.moneda === 'USD') return mov.monto * (tipoCambio || 1);
    return mov.monto;
  }

  function redondear(n) { return Math.round(n * 100) / 100; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function diasDelMes(anio, mes) { return new Date(anio, mes, 0).getDate(); } // mes 1-12

  // ------------------------------------------------------------ Periodos de corte
  //
  // Con diaCorte = 0 los periodos son meses calendario. Con diaCorte = 6 (como en
  // BAC), el periodo "2026-09" va del 7 de agosto al 6 de setiembre: se nombra por
  // el mes en que cierra, igual que el estado de cuenta ("SET-2026"). Si el día de
  // corte no existe en un mes (p. ej. 31 en febrero), se usa el último día.

  function corteDe(anio, mes, diaCorte) { return Math.min(diaCorte, diasDelMes(anio, mes)); }

  /** 'YYYY-MM-DD…' -> clave del periodo 'YYYY-MM' */
  function periodoDe(fecha, diaCorte) {
    var f = String(fecha || '');
    if (f.length < 10) return f.slice(0, 7);
    var anio = +f.slice(0, 4), mes = +f.slice(5, 7), dia = +f.slice(8, 10);
    if (!diaCorte) return f.slice(0, 7);
    if (dia > corteDe(anio, mes, diaCorte)) {
      mes += 1;
      if (mes > 12) { mes = 1; anio += 1; }
    }
    return anio + '-' + pad(mes);
  }

  /** 'YYYY-MM' -> { inicio: 'YYYY-MM-DD', fin: 'YYYY-MM-DD' } (inclusive) */
  function rangoPeriodo(clave, diaCorte) {
    var anio = +clave.slice(0, 4), mes = +clave.slice(5, 7);
    if (!diaCorte) {
      return { inicio: clave + '-01', fin: clave + '-' + pad(diasDelMes(anio, mes)) };
    }
    var aAnt = mes === 1 ? anio - 1 : anio, mAnt = mes === 1 ? 12 : mes - 1;
    var corteAnt = corteDe(aAnt, mAnt, diaCorte);
    var inicio = corteAnt === diasDelMes(aAnt, mAnt)
      ? anio + '-' + pad(mes) + '-01'
      : aAnt + '-' + pad(mAnt) + '-' + pad(corteAnt + 1);
    return { inicio: inicio, fin: clave + '-' + pad(corteDe(anio, mes, diaCorte)) };
  }

  var MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
  var MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
    'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  /** Etiqueta legible: "7 ago – 6 set 2026" o "Setiembre 2026" */
  function etiquetaPeriodo(clave, diaCorte) {
    if (!diaCorte) return MESES_LARGOS[+clave.slice(5, 7) - 1] + ' ' + clave.slice(0, 4);
    var r = rangoPeriodo(clave, diaCorte);
    var f = function (d) { return (+d.slice(8, 10)) + ' ' + MESES_CORTOS[+d.slice(5, 7) - 1]; };
    return f(r.inicio) + ' – ' + f(r.fin) + ' ' + r.fin.slice(0, 4);
  }

  /**
   * Periodo de un movimiento. Si se concilió con un estado de cuenta, manda el
   * periodo del estado (el banco agrupa por fecha de registro, que puede ser
   * posterior a la compra); si no, se calcula por fecha y día de corte.
   */
  function periodoMovimiento(mov, diaCorte) {
    return (diaCorte && mov.periodo) || periodoDe(mov.fecha, diaCorte);
  }

  function mesesDisponibles(movs, diaCorte) {
    var set = {};
    movs.forEach(function (m) { var k = periodoMovimiento(m, diaCorte); if (k) set[k] = true; });
    return Object.keys(set).sort().reverse();
  }

  /**
   * @param {Array} movs
   * @param {string} mes clave del periodo 'YYYY-MM'
   * @param {{tipoCambio:number, presupuestos:Object, diaCorte:number}} opciones
   */
  function resumenMes(movs, mes, opciones) {
    opciones = opciones || {};
    var tc = opciones.tipoCambio || 1;
    var presupuestos = opciones.presupuestos || {};
    var diaCorte = opciones.diaCorte || 0;
    var delMes = movs.filter(function (m) { return periodoMovimiento(m, diaCorte) === mes && !m.excluir; });

    var ingresos = 0, gastos = 0, ahorro = 0, transferencias = 0;
    var porCat = {}, porIngreso = {};

    delMes.forEach(function (m) {
      var crc = aColones(m, tc);
      var cat = m.categoria || 'Otros';
      if (m.tipo === 'ingreso') {
        ingresos += crc;
        porIngreso[cat] = (porIngreso[cat] || 0) + crc;
      } else if (m.tipo === 'transferencia') {
        transferencias += crc;
      } else {
        var signo = m.tipo === 'reembolso' ? -1 : 1;
        if (Cat.esCategoriaAhorro(cat)) {
          ahorro += signo * crc;
        } else {
          gastos += signo * crc;
        }
        porCat[cat] = porCat[cat] || { categoria: cat, total: 0, cantidad: 0 };
        porCat[cat].total += signo * crc;
        porCat[cat].cantidad += 1;
      }
    });

    // Incluye categorías con presupuesto aunque no tengan gasto
    Object.keys(presupuestos).forEach(function (cat) {
      if (presupuestos[cat] > 0 && !porCat[cat]) porCat[cat] = { categoria: cat, total: 0, cantidad: 0 };
    });

    var porCategoria = Object.keys(porCat).map(function (k) {
      var c = porCat[k];
      var pres = presupuestos[k] || 0;
      return {
        categoria: k,
        icono: Cat.iconoDe(k),
        total: redondear(c.total),
        cantidad: c.cantidad,
        presupuesto: pres,
        usoPresupuesto: pres > 0 ? c.total / pres : null,
        participacion: gastos > 0 && !Cat.esCategoriaAhorro(k) ? c.total / gastos : 0
      };
    }).sort(function (a, b) { return b.total - a.total; });

    var balance = ingresos - gastos - ahorro;

    return {
      mes: mes,
      ingresos: redondear(ingresos),
      gastos: redondear(gastos),
      ahorro: redondear(ahorro),
      transferencias: redondear(transferencias),
      balance: redondear(balance),
      tasaAhorro: ingresos > 0 ? (ingresos - gastos) / ingresos : null,
      presupuestoTotal: Object.keys(presupuestos).reduce(function (s, k) {
        return s + (Cat.esCategoriaAhorro(k) ? 0 : (presupuestos[k] || 0));
      }, 0),
      porCategoria: porCategoria,
      porIngreso: Object.keys(porIngreso).map(function (k) {
        return { categoria: k, total: redondear(porIngreso[k]) };
      }),
      cantidadMovimientos: delMes.length,
      alertas: alertas(delMes, porCategoria)
    };
  }

  /** Posibles cargos duplicados: mismo comercio y monto en menos de 10 minutos. */
  function posiblesDuplicados(movs) {
    var res = [];
    var gastos = movs.filter(function (m) { return m.tipo === 'gasto'; })
      .slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
    for (var i = 1; i < gastos.length; i++) {
      var a = gastos[i - 1], b = gastos[i];
      if (a.comercio === b.comercio && a.monto === b.monto && a.moneda === b.moneda) {
        var dt = Math.abs(new Date(b.fecha) - new Date(a.fecha)) / 60000;
        if (dt <= 10) res.push([a, b]);
      }
    }
    return res;
  }

  function alertas(movsMes, porCategoria) {
    var out = [];
    posiblesDuplicados(movsMes).forEach(function (par) {
      out.push({
        tipo: 'duplicado',
        mensaje: 'Posible cobro duplicado en ' + par[0].comercio + ' (' + par[0].moneda + ' ' +
          par[0].monto.toLocaleString('es-CR') + ') el ' + par[0].fecha.slice(0, 10) +
          '. Revise con el banco si solo hizo una compra.',
        ids: [par[0].id, par[1].id]
      });
    });
    porCategoria.forEach(function (c) {
      if (c.presupuesto > 0 && c.total > c.presupuesto) {
        out.push({
          tipo: 'excedido',
          mensaje: c.icono + ' ' + c.categoria + ' superó el presupuesto en ' +
            Math.round((c.total / c.presupuesto - 1) * 100) + '%.',
          categoria: c.categoria
        });
      }
    });
    return out;
  }

  /** Serie mensual para gráficos: [{mes, ingresos, gastos, balance}] (ascendente) */
  function serieMensual(movs, opciones) {
    return mesesDisponibles(movs, (opciones || {}).diaCorte).reverse().map(function (mes) {
      var r = resumenMes(movs, mes, opciones);
      return { mes: mes, ingresos: r.ingresos, gastos: r.gastos, ahorro: r.ahorro, balance: r.balance };
    });
  }

  var api = {
    aColones: aColones,
    mesesDisponibles: mesesDisponibles,
    periodoDe: periodoDe,
    periodoMovimiento: periodoMovimiento,
    rangoPeriodo: rangoPeriodo,
    etiquetaPeriodo: etiquetaPeriodo,
    resumenMes: resumenMes,
    posiblesDuplicados: posiblesDuplicados,
    serieMensual: serieMensual
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Presupuesto = root.Presupuesto || {};
    for (var k in api) root.Presupuesto[k] = api[k];
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
