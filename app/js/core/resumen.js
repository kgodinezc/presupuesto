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

  function mesDe(mov) { return String(mov.fecha || '').slice(0, 7); }

  function redondear(n) { return Math.round(n * 100) / 100; }

  function mesesDisponibles(movs) {
    var set = {};
    movs.forEach(function (m) { var k = mesDe(m); if (k) set[k] = true; });
    return Object.keys(set).sort().reverse();
  }

  /**
   * @param {Array} movs
   * @param {string} mes 'YYYY-MM'
   * @param {{tipoCambio:number, presupuestos:Object}} opciones
   */
  function resumenMes(movs, mes, opciones) {
    opciones = opciones || {};
    var tc = opciones.tipoCambio || 1;
    var presupuestos = opciones.presupuestos || {};
    var delMes = movs.filter(function (m) { return mesDe(m) === mes && !m.excluir; });

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
    return mesesDisponibles(movs).reverse().map(function (mes) {
      var r = resumenMes(movs, mes, opciones);
      return { mes: mes, ingresos: r.ingresos, gastos: r.gastos, ahorro: r.ahorro, balance: r.balance };
    });
  }

  var api = {
    aColones: aColones,
    mesesDisponibles: mesesDisponibles,
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
