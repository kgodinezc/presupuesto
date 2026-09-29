/**
 * Estado de cuenta de tarjeta de crédito (PDF de BAC Credomatic) y conciliación.
 *
 * 1. agruparFilas(items): convierte los fragmentos de texto de pdf.js
 *    ({str, x, y}) en filas "celda | celda | …", en orden de lectura.
 * 2. parsearEstadoCuenta(filas): extrae por tarjeta el periodo, pagos, compras,
 *    otros cargos (p. ej. IVA de servicios digitales), notas de crédito,
 *    intereses y totales.
 * 3. conciliar(estado, movimientos): compara cada cargo del estado con los
 *    movimientos registrados (monto, moneda, fecha ±3 días y tarjeta).
 */
(function (root) {
  'use strict';

  var enNode = typeof module !== 'undefined' && module.exports;
  var Parser = enNode ? require('./parser.js') : root.Presupuesto;
  var Cat = enNode ? require('./categorias.js') : root.Presupuesto;

  var MESES = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8,
    SET: 9, SEP: 9, OCT: 10, NOV: 11, DIC: 12 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function redondear(n) { return Math.round(n * 100) / 100; }

  /** "6-SET-26" -> "2026-09-06" */
  function fechaEC(txt) {
    var m = String(txt).match(/(\d{1,2})-([A-Z]{3})-(\d{2,4})/i);
    if (!m || !MESES[m[2].toUpperCase()]) return '';
    var anio = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return anio + '-' + pad(MESES[m[2].toUpperCase()]) + '-' + pad(+m[1]);
  }

  /** "1,125,758.43-" -> -1125758.43 */
  function montoEC(txt) {
    var s = String(txt).trim();
    var neg = /-$/.test(s) || /^\(.*\)$/.test(s);
    var n = Parser.parsearMonto(s.replace(/[()-]/g, ''));
    return neg ? -n : n;
  }

  /** Agrupa fragmentos de pdf.js en filas (misma línea si |Δy| ≤ 2). */
  function agruparFilas(items) {
    var filas = [];
    items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var fila = null;
      for (var i = 0; i < filas.length; i++) {
        if (filas[i].pagina === it.pagina && Math.abs(filas[i].y - it.y) <= 2) { fila = filas[i]; break; }
      }
      if (!fila) { fila = { pagina: it.pagina || 1, y: it.y, celdas: [] }; filas.push(fila); }
      fila.celdas.push(it);
    });
    filas.sort(function (a, b) { return a.pagina - b.pagina || b.y - a.y; });
    return filas.map(function (f) {
      return f.celdas.sort(function (a, b) { return a.x - b.x; })
        .map(function (c) { return c.str.trim(); }).join(' | ');
    });
  }

  /**
   * Nombre del comercio a partir de la descripción del estado:
   * "AUTO MERCADO CENTRO_ SAN | JOSE_ CRI" -> "AUTO MERCADO CENTRO"
   * "LA ARTESANIA DEL QUESOSAN | JOSE_ CRI" -> "LA ARTESANIA DEL QUESO" (campo de 22 caracteres)
   */
  function comercioEC(desc) {
    var unido = desc.replace(/\s*\|\s*/g, '');
    var guion = unido.indexOf('_');
    var base = guion >= 0 ? unido.slice(0, guion) : unido;
    if (guion >= 0 && base.length > 22) base = base.slice(0, 22);
    return base.trim();
  }

  // ref | fecha | descripción… | CRC/USD | monto[-]
  var RE_TX = /^(\d{8,})\s*\|\s*(\d{1,2}-[A-Z]{3}-\d{2})\s*\|\s*(.+?)\s*\|\s*(CRC|USD)\s*\|\s*([\d,]*\.\d{2})(-?)\s*$/i;
  // ref | fecha | PAGO … | monto- [| interés-]
  var RE_PAGO = /^(\d{8,})\s*\|\s*(\d{1,2}-[A-Z]{3}-\d{2})\s*\|\s*([^|]*PAGO[^|]*)\|\s*([\d,]*\.\d{2})-/i;
  var RE_CUATRO = /\|\s*([\d,]*\.\d{2}-?)\s*\|\s*([\d,]*\.\d{2}-?)\s*\|\s*([\d,]*\.\d{2}-?)\s*\|\s*([\d,]*\.\d{2}-?)\s*$/;
  var RE_DOS = /\|\s*([\d,]*\.\d{2}-?)\s*\|\s*([\d,]*\.\d{2}-?)\s*$/;

  function nuevaTarjeta(ultimos4) {
    return {
      tarjeta: ultimos4, marca: '', fechaCorte: '', mesEstado: '', periodo: { inicio: '', fin: '' },
      pagoContado: { CRC: 0, USD: 0 }, pagoMinimo: { CRC: 0, USD: 0 }, fechaLimitePago: '',
      saldoAnterior: { CRC: 0, USD: 0 },
      pagos: [], cargos: [],
      totales: { compras: { CRC: 0, USD: 0 }, otrosCargos: { CRC: 0, USD: 0 },
        pagos: { CRC: 0, USD: 0 }, intereses: { CRC: 0, USD: 0 }, interesesPeriodo: { CRC: 0, USD: 0 } }
    };
  }

  /** Asigna moneda a los pagos: el subconjunto que suma el total en USD son dólares. */
  function asignarMonedaPagos(t, montosPagos) {
    var objetivo = t.totales.pagos.USD;
    var n = montosPagos.length;
    var usd = {};
    if (objetivo > 0 && n <= 16) {
      for (var mask = 1; mask < (1 << n); mask++) {
        var suma = 0;
        for (var i = 0; i < n; i++) if (mask & (1 << i)) suma += montosPagos[i].monto;
        if (Math.abs(suma - objetivo) < 0.01) {
          for (var j = 0; j < n; j++) if (mask & (1 << j)) usd[j] = true;
          break;
        }
      }
    }
    t.pagos = montosPagos.map(function (p, i) {
      return { referencia: p.referencia, fecha: p.fecha, descripcion: p.descripcion,
        monto: p.monto, moneda: usd[i] ? 'USD' : 'CRC' };
    });
  }

  /**
   * @param {string[]} filas filas de texto ("celda | celda")
   * @return {{tarjetas: Array, fechaCorte: string, mesEstado: string}}
   */
  function parsearEstadoCuenta(filas) {
    var tarjetas = [];
    var t = null, seccion = null, pagosTmp = [], ocurrencias = {};

    function cerrar() { if (t) { asignarMonedaPagos(t, pagosTmp); tarjetas.push(t); } pagosTmp = []; }

    filas.forEach(function (fila) {
      var l = String(fila).trim();
      var m;

      if ((m = l.match(/^Marca de tarjeta:\s*\|\s*([^|]+)/i))) {
        cerrar();
        t = nuevaTarjeta('');
        t.marca = m[1].trim();
        seccion = null;
        return;
      }
      if (!t) return;

      if ((m = l.match(/^N[uú]mero de cuenta:\s*\|\s*\**(\d{4})/i))) { t.tarjeta = m[1]; return; }
      if ((m = l.match(/^Fecha de corte:\s*\|\s*(\d{1,2}-[A-Z]{3}-\d{2})/i))) { t.fechaCorte = fechaEC(m[1]); return; }
      if ((m = l.match(/^Fecha l[ií]mite pago de contado:\s*\|\s*(\d{1,2}-[A-Z]{3}-\d{2})/i))) { t.fechaLimitePago = fechaEC(m[1]); return; }
      if ((m = l.match(/^Mes y a[nñ]o del estado de cuenta:\s*\|\s*([A-Z]{3}-\d{4})/i))) { t.mesEstado = m[1].toUpperCase(); return; }
      if ((m = l.match(/PAGO DE CONTADO\s*\|\s*En Colones\s*\|\s*([\d,.]+)\s*\|\s*En D[oó]lares\s*\|\s*([\d,.]+)/i))) {
        t.pagoContado = { CRC: montoEC(m[1]), USD: montoEC(m[2]) }; return;
      }
      if ((m = l.match(/^Total pago m[ií]nimo\s*\|\s*([\d,.]+)\s*\|\s*([\d,.]+)/i))) {
        t.pagoMinimo = { CRC: montoEC(m[1]), USD: montoEC(m[2]) }; return;
      }
      if (/^Saldo Anterior \d/i.test(l) && (m = l.match(RE_CUATRO))) {
        t.saldoAnterior = { CRC: montoEC(m[1]), USD: montoEC(m[3]) }; return;
      }

      if (/^A\) Detalle de pago/i.test(l)) { seccion = 'pagos'; return; }
      if (/^B\) Detalle de compras/i.test(l)) { seccion = 'compras'; return; }
      if (/^C\) Detalle de intereses/i.test(l)) { seccion = 'intereses'; return; }
      if (/^D\) Detalle de otros cargos/i.test(l)) { seccion = 'otros'; return; }
      if (/^E\) Detalle de productos/i.test(l)) { seccion = 'otros'; return; }
      if (/^F\) Cargos por gesti/i.test(l)) { seccion = 'otros'; return; }
      if (/^G\) Otras notas de cr/i.test(l)) { seccion = 'creditos'; return; }
      if (/^Saldos al corte/i.test(l)) { seccion = null; return; }

      if (seccion === 'pagos') {
        if ((m = l.match(RE_PAGO))) {
          pagosTmp.push({ referencia: m[1], fecha: fechaEC(m[2]), descripcion: m[3].trim(), monto: montoEC(m[4] + '-') * -1 });
        } else if (/^Total de pagos recibidos/i.test(l) && (m = l.match(RE_CUATRO))) {
          t.totales.pagos = { CRC: -montoEC(m[1]) || 0, USD: -montoEC(m[3]) || 0 };
        }
        return;
      }

      if (seccion === 'compras' || seccion === 'otros' || seccion === 'creditos') {
        if ((m = l.match(RE_TX))) {
          var monto = montoEC(m[5] + m[6]);
          var clave = [t.tarjeta, m[1], m[2], m[5], m[6]].join('|');
          ocurrencias[clave] = (ocurrencias[clave] || 0) + 1;
          t.cargos.push({
            id: 'ec-' + t.tarjeta + '-' + m[1] + '-' + fechaEC(m[2]) + '-' + m[5].replace(/,/g, '') + (m[6] ? 'n' : '') +
              (ocurrencias[clave] > 1 ? '-' + ocurrencias[clave] : ''),
            referencia: m[1],
            fecha: fechaEC(m[2]),
            descripcion: m[3].replace(/\s*\|\s*/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim(),
            comercio: comercioEC(m[3]),
            moneda: m[4].toUpperCase(),
            monto: Math.abs(monto),
            esCredito: monto < 0 || seccion === 'creditos',
            seccion: seccion === 'otros' ? 'otros cargos' : (seccion === 'creditos' ? 'notas de crédito' : 'compras'),
            tarjeta: t.tarjeta
          });
        } else if ((m = l.match(/^Total de compras del periodo \(del (\S+) al (\S+)\)/i))) {
          t.periodo = { inicio: fechaEC(m[1]), fin: fechaEC(m[2]) };
          var d = l.match(RE_DOS);
          if (d) t.totales.compras = { CRC: montoEC(d[1]), USD: montoEC(d[2]) };
        } else if (/^Total por concepto otros cargos/i.test(l) && (m = l.match(RE_DOS))) {
          t.totales.otrosCargos = { CRC: montoEC(m[1]), USD: montoEC(m[2]) };
        }
        return;
      }

      if (seccion === 'intereses') {
        if (/^Monto por intereses corrientes del periodo actual/i.test(l) && (m = l.match(RE_DOS))) {
          t.totales.interesesPeriodo = { CRC: montoEC(m[1]), USD: montoEC(m[2]) };
        } else if (/^Total por concepto de intereses/i.test(l) && (m = l.match(RE_DOS))) {
          t.totales.intereses = { CRC: montoEC(m[1]), USD: montoEC(m[2]) };
        }
      }
    });
    cerrar();

    tarjetas = tarjetas.filter(function (x) { return x.tarjeta; });
    var principal = tarjetas[0] || {};
    return {
      clave: String(principal.fechaCorte || '').slice(0, 7),
      fechaCorte: principal.fechaCorte || '',
      mesEstado: principal.mesEstado || '',
      periodo: principal.periodo || { inicio: '', fin: '' },
      tarjetas: tarjetas
    };
  }

  // ------------------------------------------------------------ Conciliación

  function diasEntre(a, b) {
    return Math.abs(Date.parse(String(a).slice(0, 10)) - Date.parse(String(b).slice(0, 10))) / 86400000;
  }

  function ultimos4(tarjeta) {
    var m = String(tarjeta || '').match(/(\d{4})\s*$/);
    return m ? m[1] : '';
  }

  function parecido(a, b) {
    var x = Cat.claveComercio(a), y = Cat.claveComercio(b);
    if (!x || !y) return 0;
    if (x.indexOf(y) === 0 || y.indexOf(x) === 0) return 1;
    var px = x.split(' '), py = y.split(' ');
    var comunes = px.filter(function (p) { return p.length > 2 && py.indexOf(p) >= 0; }).length;
    return comunes / Math.max(px.length, py.length);
  }

  /**
   * @param {Object} estado resultado de parsearEstadoCuenta
   * @param {Array} movimientos movimientos de la app
   * @param {{toleranciaDias?:number}} opciones
   * @return {{coinciden:Array, soloEstado:Array, soloApp:Array, pagos:Array, resumen:Object}}
   */
  function conciliar(estado, movimientos, opciones) {
    var tol = (opciones && opciones.toleranciaDias) || 3;
    var tarjetas = estado.tarjetas.map(function (t) { return t.tarjeta; });
    var periodo = estado.periodo;
    var usados = {};

    // Movimientos de tarjeta en el periodo (con holgura para la fecha de registro)
    var candidatos = movimientos.filter(function (m) {
      if (m.tipo !== 'gasto' && m.tipo !== 'reembolso') return false;
      if (m.fuente === 'Estado de cuenta') return false;
      // Ya asignado a otro estado de cuenta (p. ej. pasó al periodo siguiente)
      if (m.periodo && m.periodo !== estado.clave) return false;
      var f = String(m.fecha).slice(0, 10);
      return f >= periodo.inicio && f <= periodo.fin || (diasEntre(f, periodo.inicio) <= tol && f < periodo.inicio);
    });

    var coinciden = [], soloEstado = [];
    estado.tarjetas.forEach(function (t) {
      t.cargos.forEach(function (c) {
        // Ya se agregó desde este estado de cuenta en una conciliación anterior
        var previo = movimientos.filter(function (m) { return m.id === c.id; })[0];
        if (previo) { coinciden.push({ cargo: c, movimiento: previo, agregadoDelEstado: true }); return; }
        var mejor = null, mejorPuntaje = -1;
        candidatos.forEach(function (m) {
          if (usados[m.id]) return;
          if (m.moneda !== c.moneda || Math.abs(m.monto - c.monto) > 0.01) return;
          if ((m.tipo === 'reembolso') !== c.esCredito) return;
          var t4 = ultimos4(m.tarjeta);
          if (t4 && t4 !== c.tarjeta) return;
          var dd = diasEntre(m.fecha, c.fecha);
          if (dd > tol) return;
          var puntaje = (3 - dd) + parecido(m.comercio || m.descripcion, c.comercio) * 2;
          if (puntaje > mejorPuntaje) { mejor = m; mejorPuntaje = puntaje; }
        });
        if (mejor) {
          usados[mejor.id] = true;
          coinciden.push({ cargo: c, movimiento: mejor });
        } else {
          soloEstado.push({ cargo: c });
        }
      });
    });

    // En la app pero no en el estado. Si la compra fue en los últimos días antes
    // del corte, lo normal es que el banco la registre en el próximo estado.
    var soloApp = candidatos.filter(function (m) {
      if (usados[m.id]) return false;
      var f = String(m.fecha).slice(0, 10);
      if (f < periodo.inicio || f > periodo.fin) return false;
      var t4 = ultimos4(m.tarjeta);
      return !t4 || tarjetas.indexOf(t4) >= 0;
    }).map(function (m) {
      return { movimiento: m, proximoEstado: diasEntre(m.fecha, periodo.fin) < tol };
    });

    // Pagos a la tarjeta vs. transferencias registradas (p. ej. SINPE enviado)
    var pagos = [];
    estado.tarjetas.forEach(function (t) {
      t.pagos.forEach(function (p) {
        var tr = movimientos.filter(function (m) {
          return m.tipo === 'transferencia' && m.moneda === p.moneda &&
            Math.abs(m.monto - p.monto) < 0.01 && diasEntre(m.fecha, p.fecha) <= tol;
        })[0];
        pagos.push({ pago: p, tarjeta: t.tarjeta, transferencia: tr || null });
      });
    });

    function sumar(lista, fn) {
      var s = { CRC: 0, USD: 0 };
      lista.forEach(function (x) { var c = fn(x); s[c.moneda] += (c.esCredito || c.tipo === 'reembolso' ? -1 : 1) * c.monto; });
      s.CRC = redondear(s.CRC); s.USD = redondear(s.USD);
      return s;
    }

    return {
      coinciden: coinciden,
      soloEstado: soloEstado,
      soloApp: soloApp,
      pagos: pagos,
      resumen: {
        cargosEstado: sumar([].concat.apply([], estado.tarjetas.map(function (t) { return t.cargos; })), function (c) { return c; }),
        coinciden: sumar(coinciden, function (x) { return x.cargo; }),
        soloEstado: sumar(soloEstado, function (x) { return x.cargo; }),
        soloApp: sumar(soloApp, function (x) { return x.movimiento; })
      }
    };
  }

  /** Convierte cargos del estado en movimientos para el presupuesto. */
  function movimientosDesdeCargos(cargos, reglasUsuario) {
    return cargos.map(function (c) {
      var mov = {
        id: c.id,
        fecha: c.fecha + 'T12:00',
        tipo: c.esCredito ? 'reembolso' : 'gasto',
        descripcion: c.descripcion,
        comercio: c.comercio,
        monto: c.monto,
        moneda: c.moneda,
        tarjeta: 'Tarjeta ' + c.tarjeta,
        referencia: c.referencia,
        fuente: 'Estado de cuenta',
        nota: 'Agregado desde el estado de cuenta (' + c.seccion + ')'
      };
      mov.categoria = Cat.categorizar(mov, reglasUsuario);
      return mov;
    });
  }

  function siguientePeriodo(clave) {
    var anio = +clave.slice(0, 4), mes = +clave.slice(5, 7) + 1;
    if (mes > 12) { mes = 1; anio += 1; }
    return anio + '-' + pad(mes);
  }

  /**
   * Aplica la conciliación sobre una copia de los movimientos:
   *  - los que coinciden quedan asignados al periodo del estado;
   *  - los que el banco registrará en el próximo estado pasan al periodo siguiente;
   *  - se agregan los cargos del estado elegidos (idsAgregar) que faltaban.
   * @return {{movimientos:Array, agregados:number, asignados:number, movidos:number}}
   */
  function aplicarConciliacion(estado, conciliacion, movimientos, idsAgregar, reglasUsuario) {
    var clave = estado.clave;
    var porId = {};
    var copia = movimientos.map(function (m) { var c = {}; for (var k in m) c[k] = m[k]; porId[c.id] = c; return c; });
    var asignados = 0, movidos = 0;
    conciliacion.coinciden.forEach(function (x) {
      var m = porId[x.movimiento.id];
      if (m && m.periodo !== clave) { m.periodo = clave; asignados++; }
    });
    conciliacion.soloApp.forEach(function (x) {
      var m = porId[x.movimiento.id];
      if (m && x.proximoEstado && m.periodo !== siguientePeriodo(clave)) { m.periodo = siguientePeriodo(clave); movidos++; }
    });
    var elegir = {};
    (idsAgregar || []).forEach(function (id) { elegir[id] = true; });
    var nuevos = movimientosDesdeCargos(conciliacion.soloEstado
      .filter(function (x) { return elegir[x.cargo.id] && !porId[x.cargo.id]; })
      .map(function (x) { return x.cargo; }), reglasUsuario);
    nuevos.forEach(function (m) { m.periodo = clave; copia.push(m); });
    return { movimientos: copia, agregados: nuevos.length, asignados: asignados, movidos: movidos };
  }

  var api = {
    aplicarConciliacion: aplicarConciliacion,
    agruparFilas: agruparFilas,
    parsearEstadoCuenta: parsearEstadoCuenta,
    conciliar: conciliar,
    movimientosDesdeCargos: movimientosDesdeCargos,
    fechaEC: fechaEC,
    comercioEC: comercioEC
  };

  if (enNode) {
    module.exports = api;
  } else {
    root.Presupuesto = root.Presupuesto || {};
    for (var k in api) root.Presupuesto[k] = api[k];
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
