/**
 * Estado de cuenta bancario (cuenta de ahorros/corriente en colones o dólares, PDF de BAC) y conciliación.
 *
 * 1. parsearEstadoBancario(items): lee los fragmentos de texto de pdf.js ({pagina, str, x, y, ancho}).
 *    Cada línea es "referencia | MMM/DD | concepto | monto"; el monto es débito o crédito según la
 *    columna en la que está (se compara su centro con los encabezados DÉBITOS / CRÉDITOS).
 * 2. clasificarLinea(linea, reglas): propone tipo y categoría (pago de tarjeta, traslado a ahorros,
 *    transferencia, SINPE Móvil, pago de servicios, salario, intereses…).
 * 3. conciliarBanco(estado, movimientos): compara cada línea con los movimientos registrados
 *    (monto, moneda, sentido y fecha ±3 días).
 * 4. aplicarConciliacionBanco(...): vincula los que coinciden y agrega las líneas elegidas.
 */
(function (root) {
  'use strict';

  var enNode = typeof module !== 'undefined' && module.exports;
  var Cat = enNode ? require('./categorias.js') : root.Presupuesto;

  var MESES = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8,
    SET: 9, SEP: 9, OCT: 10, NOV: 11, DIC: 12 };
  var NOMBRES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
    'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  var CAT_PAGO_TARJETA = 'Pago de tarjeta';
  var CAT_CUENTAS_PROPIAS = 'Entre cuentas propias';
  var CAT_RECIBIDAS = 'Transferencias recibidas';
  var CAT_SINPE = 'SINPE y transferencias';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function redondear(n) { return Math.round(n * 100) / 100; }
  /** "4440,285.77" o "1,923,800.02" -> número (BAC a veces omite la primera coma). */
  function monto(txt) { return parseFloat(String(txt).replace(/,/g, '')); }
  var RE_MONTO = /^-?[\d,]+\.\d{2}$/;

  /** Agrupa los fragmentos en filas de celdas (misma línea si |Δy| ≤ 2), en orden de lectura. */
  function filasDeCeldas(items) {
    var filas = [];
    items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var fila = null;
      for (var i = 0; i < filas.length; i++) {
        if (filas[i].pagina === (it.pagina || 1) && Math.abs(filas[i].y - it.y) <= 2) { fila = filas[i]; break; }
      }
      if (!fila) { fila = { pagina: it.pagina || 1, y: it.y, celdas: [] }; filas.push(fila); }
      fila.celdas.push({ str: it.str.trim(), x: it.x, centro: it.x + (it.ancho || 0) / 2 });
    });
    filas.sort(function (a, b) { return a.pagina - b.pagina || b.y - a.y; });
    filas.forEach(function (f) {
      f.celdas.sort(function (a, b) { return a.x - b.x; });
      f.texto = f.celdas.map(function (c) { return c.str; }).join(' | ');
    });
    return filas;
  }

  /** "30/SEP/26" -> "2026-09-30" */
  function fechaCorte(txt) {
    var m = String(txt).match(/^(\d{1,2})\/([A-Z]{3})\/(\d{2,4})$/i);
    if (!m || !MESES[m[2].toUpperCase()]) return '';
    var anio = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return anio + '-' + pad(MESES[m[2].toUpperCase()]) + '-' + pad(+m[1]);
  }

  /** "SEP/03" con corte 2026-09-30 -> "2026-09-03" (si el mes es posterior al corte, es del año anterior). */
  function fechaLinea(txt, corte) {
    var m = String(txt).match(/^([A-Z]{3})\/(\d{1,2})$/i);
    if (!m || !MESES[m[1].toUpperCase()] || !corte) return '';
    var mes = MESES[m[1].toUpperCase()];
    var anio = +corte.slice(0, 4);
    if (mes > +corte.slice(5, 7)) anio -= 1;
    return anio + '-' + pad(mes) + '-' + pad(+m[2]);
  }

  /**
   * @param {Array<{pagina:number,str:string,x:number,y:number,ancho:number}>} items
   * @return {{clave, fechaCorte, cuenta, moneda, nombre, saldoAnterior, saldoFinal, totalDebitos,
   *           totalCreditos, cantidadDebitos, cantidadCreditos, lineas: Array}}
   */
  function parsearEstadoBancario(items) {
    var filas = filasDeCeldas(items);
    var eb = {
      tipo: 'banco', clave: '', fechaCorte: '', cuenta: '', moneda: '', nombre: '',
      saldoAnterior: null, saldoFinal: null, totalDebitos: null, totalCreditos: null,
      cantidadDebitos: null, cantidadCreditos: null, lineas: []
    };
    var columnas = {};        // por página: { debito: x, credito: x }
    var esperarResumen = false;

    filas.forEach(function (f) {
      var t = f.texto;
      var m;
      if (!eb.fechaCorte) {
        f.celdas.forEach(function (c) { if (!eb.fechaCorte) eb.fechaCorte = fechaCorte(c.str); });
      }
      if ((m = t.match(/Cuenta IBAN:\s*\|\s*([A-Z]{2}[\d ]+)/i))) {
        var digitos = m[1].replace(/\D/g, '');
        eb.cuenta = digitos.slice(-4);
      }
      if ((m = t.match(/Moneda:\s*\|\s*([A-ZÁÉÍÓÚ]+)/i))) {
        eb.moneda = /DOL|USD/i.test(m[1]) ? 'USD' : 'CRC';
      }
      if (esperarResumen) {
        var nums = f.celdas.filter(function (c) { return RE_MONTO.test(c.str) || /^\d+$/.test(c.str); });
        if (nums.length >= 7) {
          eb.cantidadDebitos = +nums[0].str;
          eb.totalDebitos = monto(nums[1].str);
          eb.cantidadCreditos = +nums[2].str;
          eb.totalCreditos = monto(nums[3].str);
          eb.saldoAnterior = monto(nums[5].str);
          eb.saldoFinal = monto(nums[6].str);
          esperarResumen = false;
        }
        return;
      }
      if (/SALDO ANTERIOR/i.test(t) && /SALDO A LA FECHA/i.test(t)) { esperarResumen = true; return; }
      if (/REFERENCIA/i.test(t) && /D[ÉE]BITOS/i.test(t) && /CR[ÉE]DITOS/i.test(t)) {
        var col = {};
        f.celdas.forEach(function (c) {
          if (/^D[ÉE]BITOS$/i.test(c.str)) col.debito = c.centro;
          if (/^CR[ÉE]DITOS$/i.test(c.str)) col.credito = c.centro;
        });
        columnas[f.pagina] = col;
        return;
      }
      if ((m = t.match(/SALDO AL CORTE\s*\|\s*(-?[\d,]+\.\d{2})/i))) {
        eb.saldoFinal = monto(m[1]);
        return;
      }

      // Línea de movimiento: referencia | MMM/DD | concepto… | monto
      var cs = f.celdas;
      if (cs.length < 4 || !/^\d{5,}$/.test(cs[0].str) || !/^[A-Z]{3}\/\d{1,2}$/i.test(cs[1].str)) return;
      var ultima = cs[cs.length - 1];
      if (!RE_MONTO.test(ultima.str)) return;
      var colPag = columnas[f.pagina] || columnas[1] || {};
      var esCredito = colPag.debito != null && colPag.credito != null
        ? Math.abs(ultima.centro - colPag.credito) < Math.abs(ultima.centro - colPag.debito)
        : false;
      eb.lineas.push({
        referencia: cs[0].str,
        fechaTexto: cs[1].str,
        concepto: cs.slice(2, -1).map(function (c) { return c.str; }).join(' ').replace(/\s+/g, ' ').trim(),
        monto: monto(ultima.str),
        esCredito: esCredito
      });
    });

    eb.lineas.forEach(function (l) {
      l.fecha = fechaLinea(l.fechaTexto, eb.fechaCorte);
      l.moneda = eb.moneda || 'CRC';
      l.id = 'eb-' + (eb.cuenta || 'cta') + '-' + l.referencia + '-' + l.fecha + '-' + l.monto.toFixed(2) + (l.esCredito ? 'c' : 'd');
      delete l.fechaTexto;
    });
    if (!eb.moneda) eb.moneda = 'CRC';
    if (eb.fechaCorte) {
      eb.clave = eb.fechaCorte.slice(0, 7);
      eb.nombre = (eb.moneda === 'USD' ? 'Cuenta en dólares' : 'Cuenta en colones') +
        (eb.cuenta ? ' ···' + eb.cuenta : '') + ' · ' + NOMBRES[+eb.fechaCorte.slice(5, 7)] + ' ' + eb.fechaCorte.slice(0, 4);
    }
    return eb;
  }

  function limpiar(txt) {
    return String(txt || '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Propone cómo registrar una línea del estado bancario.
   * Las reglas del usuario (por comercio) tienen prioridad, salvo en los pagos de tarjeta.
   * @return {{tipo, categoria, descripcion, comercio}}
   */
  function clasificarLinea(l, reglasUsuario) {
    var c = limpiar(l.concepto);
    var m;
    var r = { tipo: '', categoria: '', descripcion: c, comercio: c };

    if (l.esCredito) {
      r.tipo = 'ingreso';
      r.categoria = CAT_RECIBIDAS;
      if (/^INTERES/i.test(c)) {
        r.categoria = 'Otros ingresos'; r.descripcion = 'Intereses de la cuenta'; r.comercio = 'Intereses';
      } else if ((m = c.match(/^CD SINPE\s+(.*)$/i))) {
        r.comercio = m[1]; r.descripcion = 'SINPE recibido: ' + m[1];
      } else if ((m = c.match(/^TEF DE\s*:\s*(.*)$/i))) {
        r.comercio = m[1]; r.descripcion = 'Transferencia recibida: ' + m[1];
      } else if ((m = c.match(/^SINPE MOVIL\s+(.*)$/i))) {
        r.comercio = m[1]; r.descripcion = 'SINPE Móvil recibido: ' + m[1];
      } else if ((m = c.match(/^DTR\s*:\s*(.*)$/i))) {
        r.comercio = m[1]; r.descripcion = 'Traslado recibido: ' + m[1];
      }
      // Reglas del usuario o de salario; si no hay, se queda la categoría propuesta
      var catIngreso = Cat.categorizar({ tipo: 'ingreso', comercio: r.comercio, descripcion: r.descripcion }, reglasUsuario);
      if (catIngreso !== 'Otros ingresos') r.categoria = catIngreso;
      return r;
    }

    if ((m = c.match(/^PAGO\s+\d{4,6}\*+(\d{4})/i))) {
      return { tipo: 'transferencia', categoria: CAT_PAGO_TARJETA, descripcion: 'Pago tarjeta ****' + m[1], comercio: 'Pago tarjeta ****' + m[1] };
    }
    if ((m = c.match(/^DTR\s*:\s*(.*)$/i))) {
      r.comercio = m[1];
      if (/AHORR/i.test(m[1])) {
        r.tipo = 'gasto'; r.categoria = 'Ahorro e inversión'; r.descripcion = 'Traslado a ahorros: ' + m[1];
      } else {
        r.tipo = 'transferencia'; r.categoria = CAT_CUENTAS_PROPIAS; r.descripcion = 'Traslado: ' + m[1];
      }
    } else if ((m = c.match(/^TEF A\s*:\s*(.*)$/i))) {
      r.comercio = 'Cuenta ' + m[1]; r.descripcion = 'Transferencia enviada a la cuenta ' + m[1];
      return gastoEnviado(r, reglasUsuario);
    } else if ((m = c.match(/^SINPE MOVIL\s+(.*)$/i))) {
      r.comercio = m[1]; r.descripcion = 'SINPE Móvil enviado: ' + m[1];
      return gastoEnviado(r, reglasUsuario);
    } else if ((m = c.match(/^SINPE\s+(.*)$/i))) {
      r.comercio = m[1]; r.descripcion = 'SINPE enviado: ' + m[1];
      return gastoEnviado(r, reglasUsuario);
    } else {
      // Pagos de servicios, comisiones, compras con tarjeta de débito…
      r.tipo = 'gasto';
      r.comercio = c.replace(/^PAGO\s+/i, '');
      r.categoria = Cat.categorizar({ tipo: 'gasto', comercio: r.comercio, descripcion: c }, reglasUsuario);
      return r;
    }

    // Una regla del usuario puede convertir una transferencia en gasto (p. ej. un SINPE Móvil frecuente)
    var regla = reglasUsuario && reglasUsuario[Cat.claveComercio(r.comercio)];
    if (regla) {
      r.categoria = regla;
      r.tipo = esCategoriaTransferencia(regla) ? 'transferencia' : 'gasto';
    }
    return r;
  }

  /**
   * SINPE y transferencias enviadas son gasto: la categoría sale de las reglas (del usuario o por palabras
   * como "pizza") y, si no hay, es "SINPE y transferencias". Una regla del usuario con una categoría de
   * transferencia (p. ej. "Entre cuentas propias") la deja fuera del gasto.
   */
  function gastoEnviado(r, reglasUsuario) {
    r.categoria = Cat.categorizar({ tipo: 'gasto', comercio: r.comercio, descripcion: r.descripcion }, reglasUsuario);
    r.tipo = Cat.tipoSegunCategoria('gasto', r.categoria);
    return r;
  }

  function esCategoriaTransferencia(cat) {
    return (Cat.CATEGORIAS_TRANSFERENCIA || [Cat.CATEGORIA_TRANSFERENCIA]).indexOf(cat) >= 0;
  }

  function dias(a, b) {
    return Math.abs(Date.parse(a.slice(0, 10) + 'T12:00:00Z') - Date.parse(b.slice(0, 10) + 'T12:00:00Z')) / 864e5;
  }
  function ultimos4(t) { var m = String(t || '').match(/(\d{4})\s*$/); return m ? m[1] : ''; }

  /**
   * Concilia el estado bancario con los movimientos.
   * @param {Object} eb estado de parsearEstadoBancario
   * @param {Array} movimientos
   * @param {{reglas?:Object, tarjetasCredito?:string[]}} opciones tarjetasCredito: últimos 4 dígitos de
   *   las tarjetas de crédito (sus compras no salen de la cuenta, así que no se comparan)
   */
  function conciliarBanco(eb, movimientos, opciones) {
    opciones = opciones || {};
    var credito = opciones.tarjetasCredito || [];
    var usados = {};
    var coinciden = [], soloBanco = [];

    function candidato(m, l) {
      if (usados[m.id]) return false;
      if (m.refBanco && m.refBanco !== l.id) return false;
      if ((m.moneda || 'CRC') !== l.moneda) return false;
      if (Math.abs(m.monto - l.monto) > 0.005) return false;
      if (l.esCredito ? m.tipo !== 'ingreso' : (m.tipo !== 'gasto' && m.tipo !== 'transferencia')) return false;
      var t4 = ultimos4(m.tarjeta);
      if (t4 && credito.indexOf(t4) >= 0) return false;
      return dias(m.fecha, l.fecha) <= 3;
    }

    // Primero los vínculos exactos (líneas ya aplicadas), luego por cercanía de fecha
    var pendientes = [];
    eb.lineas.forEach(function (l) {
      var exacto = movimientos.filter(function (m) { return m.id === l.id || m.refBanco === l.id; })[0];
      if (exacto) { usados[exacto.id] = true; coinciden.push({ linea: l, movimiento: exacto }); } else pendientes.push(l);
    });
    pendientes.forEach(function (l) {
      var cands = movimientos.filter(function (m) { return candidato(m, l); })
        .sort(function (a, b) { return dias(a.fecha, l.fecha) - dias(b.fecha, l.fecha); });
      if (cands.length) { usados[cands[0].id] = true; coinciden.push({ linea: l, movimiento: cands[0] }); } else soloBanco.push({ linea: l });
    });
    coinciden.forEach(function (x) { x.sugerencia = clasificarLinea(x.linea, opciones.reglas); });
    soloBanco.forEach(function (x) { x.sugerencia = clasificarLinea(x.linea, opciones.reglas); });

    function suma(lista, cred) {
      return redondear(lista.reduce(function (s, x) { return s + (x.linea.esCredito === cred ? x.linea.monto : 0); }, 0));
    }
    var debitos = redondear(eb.lineas.reduce(function (s, l) { return s + (l.esCredito ? 0 : l.monto); }, 0));
    var creditos = redondear(eb.lineas.reduce(function (s, l) { return s + (l.esCredito ? l.monto : 0); }, 0));
    var cuadra = eb.totalDebitos == null ||
      (Math.abs(debitos - eb.totalDebitos) < 0.01 && Math.abs(creditos - eb.totalCreditos) < 0.01);
    if (cuadra && eb.saldoAnterior != null && eb.saldoFinal != null) {
      cuadra = Math.abs(eb.saldoAnterior + creditos - debitos - eb.saldoFinal) < 0.01;
    }

    // Entradas y salidas por categoría propuesta (o la del movimiento ya registrado)
    var porCategoria = {};
    coinciden.concat(soloBanco).forEach(function (x) {
      var cat = x.movimiento ? (x.movimiento.categoria || x.sugerencia.categoria) : x.sugerencia.categoria;
      var tipo = x.movimiento ? x.movimiento.tipo : x.sugerencia.tipo;
      var k = (x.linea.esCredito ? 'E' : 'S') + '|' + cat;
      porCategoria[k] = porCategoria[k] || { categoria: cat, tipo: tipo, entrada: x.linea.esCredito, total: 0, cantidad: 0 };
      porCategoria[k].total = redondear(porCategoria[k].total + x.linea.monto);
      porCategoria[k].cantidad++;
    });

    // Posibles cobros duplicados: mismo concepto y monto (débito) en 3 días o menos
    var duplicados = [];
    eb.lineas.forEach(function (l, i) {
      if (l.esCredito) return;
      for (var j = i + 1; j < eb.lineas.length; j++) {
        var o = eb.lineas[j];
        if (!o.esCredito && o.concepto === l.concepto && o.monto === l.monto && dias(o.fecha, l.fecha) <= 3 &&
            !/SINPE MOVIL/i.test(l.concepto)) {
          duplicados.push([l, o]);
        }
      }
    });

    return {
      coinciden: coinciden,
      soloBanco: soloBanco,
      duplicados: duplicados,
      porCategoria: Object.keys(porCategoria).map(function (k) { return porCategoria[k]; })
        .sort(function (a, b) { return (b.entrada - a.entrada) || (b.total - a.total); }),
      resumen: {
        debitos: debitos,
        creditos: creditos,
        cuadra: cuadra,
        coincidenDebitos: suma(coinciden, false),
        coincidenCreditos: suma(coinciden, true),
        soloBancoDebitos: suma(soloBanco, false),
        soloBancoCreditos: suma(soloBanco, true)
      }
    };
  }

  /** Propuesta del banco con la categoría que eligió el usuario, si eligió una. */
  function sugerenciaElegida(x, categorias) {
    var cat = categorias && categorias[x.linea.id];
    if (!cat || cat === x.sugerencia.categoria) return x.sugerencia;
    return Object.assign({}, x.sugerencia, { categoria: cat, tipo: Cat.tipoSegunCategoria(x.sugerencia.tipo, cat) });
  }

  /** Movimiento a partir de una línea del estado bancario. */
  function movimientoDesdeLinea(l, sug, eb) {
    return {
      id: l.id,
      fecha: l.fecha + 'T12:00',
      tipo: sug.tipo,
      descripcion: sug.descripcion,
      comercio: sug.comercio,
      monto: l.monto,
      moneda: l.moneda,
      referencia: l.referencia,
      fuente: 'Estado bancario',
      cuenta: eb.cuenta,
      categoria: sug.categoria,
      nota: 'Agregado desde el estado de cuenta ' + (eb.moneda === 'USD' ? 'en dólares' : 'en colones') + ': ' + l.concepto
    };
  }

  /**
   * Aplica la conciliación sobre una copia de los movimientos:
   *  - los que coinciden quedan vinculados a su línea (refBanco); si eran una transferencia genérica
   *    sin editar, toman la clasificación del banco (p. ej. pago de tarjeta o traslado a ahorros);
   *  - se agregan las líneas elegidas (idsAgregar) que faltaban.
   *  - categorias ({idLinea: categoría}) reemplaza la categoría propuesta de las líneas que se agregan; el tipo
   *    sigue a la categoría (una de "no es gasto" la deja como transferencia).
   */
  function aplicarConciliacionBanco(eb, conc, movimientos, idsAgregar, categorias) {
    var copia = movimientos.map(function (m) { return Object.assign({}, m); });
    var porId = {};
    copia.forEach(function (m) { porId[m.id] = m; });
    var vinculados = 0, reclasificados = 0;

    conc.coinciden.forEach(function (x) {
      var m = porId[x.movimiento.id];
      if (!m) return;
      if (m.refBanco !== x.linea.id && m.id !== x.linea.id) { m.refBanco = x.linea.id; vinculados++; }
      var s = x.sugerencia;
      // Un SINPE de correo sin categoría precisa toma la del banco (p. ej. traslado a ahorros o pago de tarjeta)
      var generica = m.categoria === CAT_SINPE || m.categoria === Cat.CATEGORIA_TRANSFERENCIA_ANTERIOR;
      if (!m.editado && (m.tipo === 'transferencia' || m.tipo === 'gasto') && generica && !m.tarjeta &&
          s.categoria !== CAT_SINPE && (s.tipo !== m.tipo || s.categoria !== m.categoria)) {
        m.tipo = s.tipo;
        m.categoria = s.categoria;
        m.editado = true;
        reclasificados++;
      }
      if (!m.nota) m.nota = 'Estado de cuenta: ' + x.linea.concepto;
    });

    var elegir = {};
    (idsAgregar || []).forEach(function (id) { elegir[id] = true; });
    var agregados = 0;
    conc.soloBanco.forEach(function (x) {
      if (!elegir[x.linea.id] || porId[x.linea.id]) return;
      copia.push(movimientoDesdeLinea(x.linea, sugerenciaElegida(x, categorias), eb));
      agregados++;
    });
    return { movimientos: copia, agregados: agregados, vinculados: vinculados, reclasificados: reclasificados };
  }

  var api = {
    parsearEstadoBancario: parsearEstadoBancario,
    clasificarLinea: clasificarLinea,
    conciliarBanco: conciliarBanco,
    aplicarConciliacionBanco: aplicarConciliacionBanco,
    movimientoDesdeLinea: movimientoDesdeLinea
  };

  if (enNode) {
    module.exports = api;
  } else {
    root.Presupuesto = root.Presupuesto || {};
    for (var k in api) root.Presupuesto[k] = api[k];
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
