// ARCHIVO GENERADO con `npm run build:gas`. No editar a mano;
// modifique app/js/core/*.js o apps-script/Main.js y vuelva a generarlo.

// ===== app/js/core/parser.js =====
/**
 * Parser de notificaciones bancarias (BAC Credomatic Costa Rica).
 *
 * Funciona igual en el navegador, en Google Apps Script y en Node (pruebas).
 * Recibe el asunto y el cuerpo en texto plano de un correo y devuelve un
 * "movimiento" normalizado, o null si el correo no es una transacción.
 *
 * Formatos soportados:
 *  - "Notificación de transacción" (compras con tarjeta de crédito/débito)
 *  - "Notificación de Transferencia SINPE" recibida (ingreso)
 *  - "Notificación de Transferencia SINPE" en tiempo real enviada (salida)
 *  - "Notificación de Transferencia Local" recibida (ingreso)
 */
(function (root) {
  'use strict';

  var MESES = {
    JAN: 1, ENE: 1, FEB: 2, MAR: 3, APR: 4, ABR: 4, MAY: 5, JUN: 6, JUL: 7,
    AUG: 8, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DEC: 12, DIC: 12
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** Limpia el texto: quita tablas markdown, espacios dobles, &amp;, etc. */
  function limpiar(texto) {
    return String(texto || '')
      .replace(/&amp;/g, '&')
      .replace(/ /g, ' ')
      .replace(/\r/g, '');
  }

  /** Convierte "2,350.00", ".00", "1.234,56" a número. */
  function parsearMonto(txt) {
    if (txt == null) return NaN;
    var s = String(txt).replace(/[^\d.,-]/g, '');
    if (!s) return NaN;
    var ultimoPunto = s.lastIndexOf('.');
    var ultimaComa = s.lastIndexOf(',');
    if (ultimaComa > ultimoPunto) {
      // Formato europeo: 1.234,56
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
    if (s.charAt(0) === '.') s = '0' + s;
    return parseFloat(s);
  }

  function normalizarMoneda(txt) {
    var t = String(txt || '').toUpperCase();
    if (/USD|D[OÓ]LAR/.test(t)) return 'USD';
    if (/EUR/.test(t)) return 'EUR';
    return 'CRC';
  }

  /** Extrae el valor de una etiqueta "Etiqueta: valor" (tolera tablas | y saltos de línea). */
  function campo(texto, etiqueta) {
    var re = new RegExp(etiqueta + '\\s*:\\s*(?:\\|\\s*)?([^\\n|]+?)\\s*(?:\\||\\n|$)', 'i');
    var m = texto.match(re);
    return m ? m[1].trim() : '';
  }

  /** "Sep 24, 2026 , 19:32" -> "2026-09-24T19:32" */
  function parsearFechaTarjeta(txt) {
    var m = String(txt).match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})\s*,?\s*(\d{1,2}):(\d{2})/);
    if (!m) return '';
    var mes = MESES[m[1].toUpperCase()];
    if (!mes) return '';
    return m[3] + '-' + pad(mes) + '-' + pad(+m[2]) + 'T' + pad(+m[4]) + ':' + m[5];
  }

  /** "25/09/2026" + "07:48:59 p.m." -> "2026-09-25T19:48" (también acepta 7/8/2026 y 10-08-2026) */
  function parsearFechaDMY(fechaTxt, horaTxt) {
    var f = String(fechaTxt).match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (!f) return '';
    var h = 0, min = 0;
    var t = String(horaTxt || '').match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*m?\.?/i);
    if (t) {
      h = +t[1];
      min = +t[2];
      var ampm = (t[3] || '').toLowerCase();
      if (ampm === 'p' && h < 12) h += 12;
      if (ampm === 'a' && h === 12) h = 0;
    }
    return f[3] + '-' + pad(+f[2]) + '-' + pad(+f[1]) + 'T' + pad(h) + ':' + pad(min);
  }

  function parsearCompraTarjeta(texto, meta) {
    var comercio = campo(texto, 'Comercio');
    var montoTxt = campo(texto, 'Monto');
    if (!comercio || !montoTxt) return null;

    var mMonto = montoTxt.match(/([A-Z]{3})\s*([\d.,]+)/i);
    if (!mMonto) return null;
    var monto = parsearMonto(mMonto[2]);
    if (!(monto > 0)) return null; // Autorizaciones de verificación en 0.00

    var tarjeta = '';
    var mT = texto.match(/(MASTER(?:CARD)?|VISA|AMEX|AMERICAN EXPRESS)\s*:\s*(?:\|\s*)?\**(\d{4})/i);
    if (mT) tarjeta = mT[1].toUpperCase().replace('MASTERCARD', 'MASTER') + ' ' + mT[2];

    var tipoTx = campo(texto, 'Tipo de Transacci[oó]n');
    var esReembolso = /DEVOLUCI|REVERS|CR[EÉ]DITO|ANULACI/i.test(tipoTx);

    return {
      id: meta.id || '',
      fecha: parsearFechaTarjeta(campo(texto, 'Fecha')) || meta.fechaCorreo || '',
      tipo: esReembolso ? 'reembolso' : 'gasto',
      descripcion: comercio,
      comercio: comercio,
      monto: Math.round(monto * 100) / 100,
      moneda: normalizarMoneda(mMonto[1]),
      tarjeta: tarjeta,
      ciudad: campo(texto, 'Ciudad y pa[ií]s'),
      autorizacion: campo(texto, 'Autorizaci[oó]n'),
      referencia: campo(texto, 'Referencia'),
      tipoTransaccion: tipoTx,
      fuente: 'BAC tarjeta',
      categoria: ''
    };
  }

  function parsearSinpeRecibido(texto, meta) {
    var plano = texto.replace(/\s+/g, ' ');
    var mMonto = plano.match(/monto de\s*([\d.,]+)\s*(Colones|D[oó]lares|USD|CRC)/i);
    if (!mMonto) return null;
    var mFecha = plano.match(/(?:el d[ií]a|el dia)\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*a las\s*([\d:]+\s*[ap]?\.?\s*m?\.?)/i);
    var mConcepto = plano.match(/por concepto(?: de)?:?\s*"?(.+?)"?(?:\.\s|,\s*la cual|\s*Servicio para|\s*Muchas gracias|$)/i);
    var mRef = plano.match(/referencia\s*(\d{6,})/i);
    var concepto = mConcepto ? mConcepto[1].trim() : '';
    return {
      id: meta.id || '',
      fecha: (mFecha && parsearFechaDMY(mFecha[1], mFecha[2])) || meta.fechaCorreo || '',
      tipo: 'ingreso',
      descripcion: 'SINPE recibido' + (concepto ? ': ' + concepto : ''),
      comercio: concepto,
      monto: parsearMonto(mMonto[1]),
      moneda: normalizarMoneda(mMonto[2]),
      tarjeta: '',
      ciudad: '',
      autorizacion: '',
      referencia: mRef ? mRef[1] : '',
      tipoTransaccion: 'SINPE',
      fuente: 'BAC SINPE',
      categoria: ''
    };
  }

  function parsearSinpeEnviado(texto, meta) {
    var plano = texto.replace(/\s+/g, ' ');
    var mMonto = plano.match(/monto de\s*([\d.,]+)\s*(Colones|D[oó]lares|USD|CRC)/i);
    if (!mMonto) return null;
    var mFecha = plano.match(/D[ií]a y hora:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*([\d:]+\s*[ap]?\.?\s*m?\.?)/i);
    var mRef = plano.match(/referencia\s*(\d{6,})/i);
    return {
      id: meta.id || '',
      fecha: (mFecha && parsearFechaDMY(mFecha[1], mFecha[2])) || meta.fechaCorreo || '',
      tipo: 'transferencia',
      descripcion: 'SINPE enviado',
      comercio: 'SINPE enviado',
      monto: parsearMonto(mMonto[1]),
      moneda: normalizarMoneda(mMonto[2]),
      tarjeta: '',
      ciudad: '',
      autorizacion: '',
      referencia: mRef ? mRef[1] : '',
      tipoTransaccion: 'SINPE',
      fuente: 'BAC SINPE',
      categoria: ''
    };
  }

  function parsearTransferenciaLocal(texto, meta) {
    var plano = texto.replace(/\s+/g, ' ');
    var mOrigen = plano.match(/comunica que\s+(.+?)\s+realiz[oó] una transferencia/i);
    var mMonto = plano.match(/monto de\s*([\d.,]+)\s*(USD|CRC|Colones|D[oó]lares)/i);
    if (!mMonto) return null;
    var mFecha = plano.match(/el d[ií]a\s*(\d{1,2}-\d{1,2}-\d{4})\s*a las\s*([\d:]+)/i);
    var mConcepto = plano.match(/por concepto de:?\s*"([^"]+)"/i);
    var mRef = plano.match(/referencia es\s*(\d+)/i);
    var origen = mOrigen ? mOrigen[1].trim() : '';
    return {
      id: meta.id || '',
      fecha: (mFecha && parsearFechaDMY(mFecha[1], mFecha[2])) || meta.fechaCorreo || '',
      tipo: 'ingreso',
      descripcion: 'Transferencia de ' + origen + (mConcepto ? ': ' + mConcepto[1] : ''),
      comercio: origen,
      monto: parsearMonto(mMonto[1]),
      moneda: normalizarMoneda(mMonto[2]),
      tarjeta: '',
      ciudad: '',
      autorizacion: '',
      referencia: mRef ? mRef[1] : '',
      tipoTransaccion: 'Transferencia local',
      fuente: 'BAC transferencia',
      categoria: ''
    };
  }

  /**
   * Punto de entrada.
   * @param {{id?:string, asunto?:string, cuerpo:string, fechaCorreo?:string}} correo
   * @return {Object|null} movimiento
   */
  function parsearCorreo(correo) {
    var texto = limpiar(correo.cuerpo);
    var asunto = limpiar(correo.asunto);
    var meta = { id: correo.id, fechaCorreo: correo.fechaCorreo };

    if (/detallamos la transacci[oó]n|Notificaci[oó]n de transacci[oó]n/i.test(texto + ' ' + asunto)) {
      return parsearCompraTarjeta(texto, meta);
    }
    if (/recibi[oó] una transferencia SINPE/i.test(texto)) {
      return parsearSinpeRecibido(texto, meta);
    }
    if (/transferencia SINPE en tiempo real[\s\S]*debitando su cuenta/i.test(texto)) {
      return parsearSinpeEnviado(texto, meta);
    }
    if (/realiz[oó] una transferencia electr[oó]nica a su cuenta/i.test(texto)) {
      return parsearTransferenciaLocal(texto, meta);
    }
    return null;
  }

  var api = {
    parsearCorreo: parsearCorreo,
    parsearMonto: parsearMonto,
    parsearFechaTarjeta: parsearFechaTarjeta,
    parsearFechaDMY: parsearFechaDMY
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Presupuesto = root.Presupuesto || {};
    for (var k in api) root.Presupuesto[k] = api[k];
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

// ===== app/js/core/categorias.js =====
/**
 * Categorías y reglas de clasificación automática.
 *
 * Las reglas se evalúan en orden; gana la primera que coincide con el nombre
 * del comercio (en mayúsculas y sin tildes). Las reglas del usuario (aprendidas
 * al recategorizar un movimiento) tienen prioridad sobre las predeterminadas.
 */
(function (root) {
  'use strict';

  var CATEGORIAS_GASTO = [
    { nombre: 'Supermercado', icono: '🛒', presupuesto: 350000 },
    { nombre: 'Restaurantes y comidas', icono: '🍽️', presupuesto: 120000 },
    { nombre: 'Salud', icono: '💊', presupuesto: 60000 },
    { nombre: 'Transporte y vehículo', icono: '🚗', presupuesto: 80000 },
    { nombre: 'Servicios del hogar', icono: '💡', presupuesto: 90000 },
    { nombre: 'Suscripciones digitales', icono: '📱', presupuesto: 25000 },
    { nombre: 'Compras en línea', icono: '📦', presupuesto: 60000 },
    { nombre: 'Ropa y cuidado personal', icono: '👕', presupuesto: 60000 },
    { nombre: 'Hogar', icono: '🏠', presupuesto: 50000 },
    { nombre: 'Educación y libros', icono: '📚', presupuesto: 30000 },
    { nombre: 'Deporte', icono: '🏋️', presupuesto: 65000 },
    { nombre: 'Paseos y entretenimiento', icono: '🎡', presupuesto: 60000 },
    { nombre: 'Diezmos y ofrendas', icono: '⛪', presupuesto: 0 },
    { nombre: 'Ahorro e inversión', icono: '💰', presupuesto: 0, esAhorro: true },
    { nombre: 'Otros', icono: '❓', presupuesto: 40000 }
  ];

  var CATEGORIAS_INGRESO = ['Salario', 'Otros ingresos'];
  var CATEGORIA_TRANSFERENCIA = 'Transferencias';

  // [patrón (regex sobre el comercio normalizado), categoría]
  var REGLAS_PREDETERMINADAS = [
    ['EXN\\*|EXNESS|BINANCE|INVERSION|AHORRO|FONDO', 'Ahorro e inversión'],
    ['IGLESIA|MINISTERIO|OFRENDA|DIEZMO', 'Diezmos y ofrendas'],
    ['UBER ?EATS|DIDI ?FOOD|RAPPI|PEDIDOS ?YA', 'Restaurantes y comidas'],
    ['AUTO ?MERCADO|\\bMXM\\b|MAS ?X ?MENOS|PRICE ?SMART|WALMART|\\bPALI\\b|MEGA ?SUPER|FRESH ?MARKET|\\bAM ?PM\\b|DELIMART|PERIMERCADO|\\bSUPER\\b|SUPERMERCADO|CARNICERIA|VERDULERIA|PANADERIA|QUESO|FERIA|MACROBIOTICA', 'Supermercado'],
    ['RESTAURANTE|\\bSODA\\b|PIZZ|PAPA ?JOHN|MC ?DONALD|BURGER|\\bKFC\\b|TACO|STARBUCKS|\\bCAFE|COFFEE|SPOON|CASONA|SUBWAY|\\bPOPS\\b|HELAD|FRESI|CHURRER|MARISQ|SUSHI|POLLO|BAR ', 'Restaurantes y comidas'],
    ['BOTICA|FARMACIA|CLINICA|HOSPITAL|LABORATORIO|SALUD|MEDIC|DENTAL|OPTICA|FISCHEL|SUCRE|\\bCCSS\\b', 'Salud'],
    ['\\bUBER\\b|\\bDIDI\\b|GASOLINERA|SERVICENTRO|\\bDELTA\\b|\\bUNO\\b|LAVA ?CAR|PARQUEO|PARKING|RITEVE|DEKRA|PEAJE|QUICK ?PASS|REPUESTO|LLANTA|TALLER|\\bCOSEVI\\b|\\bINS\\b', 'Transporte y vehículo'],
    ['\\bICE\\b|KOLBI|\\bCNFL\\b|\\bAYA\\b|\\bA Y A\\b|\\bTIGO\\b|\\bCLARO\\b|LIBERTY|TELECABLE|CABLETICA|\\bESPH\\b|JASEC|COOPELESCA|MUNICIPALIDAD|CONDOMINIO', 'Servicios del hogar'],
    ['SPOTIFY|NETFLIX|GOOGLE|YOUTUBE|CANVA|APPLE|ICLOUD|DISNEY|\\bHBO\\b|\\bMAX\\b|PARAMOUNT|PRIME ?VIDEO|CLAUDE|ANTHROPIC|OPENAI|MICROSOFT|ADOBE|DROPBOX', 'Suscripciones digitales'],
    ['AMAZON|EBAY|ALIEXPRESS|SHEIN|TEMU', 'Compras en línea'],
    ['ZARA|H ?& ?M|SIMAN|BERSHKA|PULL ?AND ?BEAR|NIKE|ADIDAS|FOREVER|PAYLESS|STEVEN|\\bTOUS\\b|SALON|BARBER|LOLA|AMERICAN EAGLE', 'Ropa y cuidado personal'],
    ['EL REY|PEQUENO MUNDO|\\bEPA\\b|CONSTRUPLAZA|FERRETERIA|\\bMONGE\\b|\\bGOLLO\\b|\\bEXTRA\\b|IKEA|CEMACO|WALMART HOGAR', 'Hogar'],
    ['LIBRERIA|UNIVERSIDAD|COLEGIO|ESCUELA|UDEMY|COURSERA|UNIVERSAL|PLATZI', 'Educación y libros'],
    ['CROSSFIT|\\bGYM\\b|SMART ?FIT|DEPORT|DECATHLON|SPORT|FITNESS', 'Deporte'],
    ['HOTEL|KAYAK|EVENTOS|\\bCINE|\\bCCM\\b|\\bTOUR|PARQUE|MUSEO|AIRBNB|BOOKING|TICKET|TEATRO', 'Paseos y entretenimiento']
  ];

  var REGLAS_INGRESO = [
    ['SALARIO|PLANILLA|AGUINALDO|PAGO DE SALARIO', 'Salario']
  ];

  function normalizarTexto(txt) {
    return String(txt || '')
      .toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Clave para las reglas del usuario: comercio normalizado sin números de sucursal. */
  function claveComercio(comercio) {
    return normalizarTexto(comercio).replace(/[^A-Z&* ]/g, '').replace(/\s+/g, ' ').trim();
  }

  function primeraCoincidencia(reglas, texto) {
    for (var i = 0; i < reglas.length; i++) {
      if (new RegExp(reglas[i][0]).test(texto)) return reglas[i][1];
    }
    return '';
  }

  /**
   * Devuelve la categoría para un movimiento.
   * @param {Object} mov movimiento del parser
   * @param {Object<string,string>=} reglasUsuario { claveComercio: categoria }
   */
  function categorizar(mov, reglasUsuario) {
    if (mov.tipo === 'transferencia') return CATEGORIA_TRANSFERENCIA;
    var clave = claveComercio(mov.comercio || mov.descripcion);
    if (reglasUsuario && reglasUsuario[clave]) return reglasUsuario[clave];
    var texto = normalizarTexto((mov.comercio || '') + ' ' + (mov.descripcion || ''));
    if (mov.tipo === 'ingreso') {
      return primeraCoincidencia(REGLAS_INGRESO, texto) || 'Otros ingresos';
    }
    return primeraCoincidencia(REGLAS_PREDETERMINADAS, texto) || 'Otros';
  }

  function presupuestosPredeterminados() {
    var p = {};
    CATEGORIAS_GASTO.forEach(function (c) { p[c.nombre] = c.presupuesto; });
    return p;
  }

  function iconoDe(categoria) {
    for (var i = 0; i < CATEGORIAS_GASTO.length; i++) {
      if (CATEGORIAS_GASTO[i].nombre === categoria) return CATEGORIAS_GASTO[i].icono;
    }
    if (categoria === 'Salario') return '💼';
    if (categoria === CATEGORIA_TRANSFERENCIA) return '🔁';
    return '💵';
  }

  function esCategoriaAhorro(categoria) {
    for (var i = 0; i < CATEGORIAS_GASTO.length; i++) {
      if (CATEGORIAS_GASTO[i].nombre === categoria) return !!CATEGORIAS_GASTO[i].esAhorro;
    }
    return false;
  }

  var api = {
    CATEGORIAS_GASTO: CATEGORIAS_GASTO,
    CATEGORIAS_INGRESO: CATEGORIAS_INGRESO,
    CATEGORIA_TRANSFERENCIA: CATEGORIA_TRANSFERENCIA,
    REGLAS_PREDETERMINADAS: REGLAS_PREDETERMINADAS,
    categorizar: categorizar,
    claveComercio: claveComercio,
    normalizarTexto: normalizarTexto,
    presupuestosPredeterminados: presupuestosPredeterminados,
    iconoDe: iconoDe,
    esCategoriaAhorro: esCategoriaAhorro
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Presupuesto = root.Presupuesto || {};
    for (var k in api) root.Presupuesto[k] = api[k];
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

// ===== app/js/core/resumen.js =====
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

// ===== apps-script/Main.js =====
/**
 * Presupuesto Familiar — Google Apps Script
 *
 * Lee los correos de notificación del banco en Gmail, los convierte en
 * movimientos categorizados y los guarda en esta hoja de cálculo. También
 * expone los datos (con token) para la aplicación web.
 *
 * Uso: menú "💰 Presupuesto" > "1. Configurar". Ver README.md.
 *
 * Depende de Presupuesto.parsearCorreo / categorizar / resumenMes, que se
 * concatenan en dist/Codigo.gs con `npm run build:gas`.
 */

var CONFIG = {
  HOJA_MOVIMIENTOS: 'Movimientos',
  HOJA_PRESUPUESTO: 'Presupuesto',
  HOJA_REGLAS: 'Reglas',
  HOJA_RESUMEN: 'Resumen',
  // Remitentes de BAC Credomatic. Agregue otros bancos aquí cuando tengan parser.
  CONSULTA_GMAIL: 'from:(baccredomatic.cr OR baccredomatic.com) ' +
    '(subject:"Notificación de transacción" OR subject:"Transferencia" OR "transferencia SINPE")',
  DIAS_PRIMERA_CARGA: 90,
  DIAS_CARGA_NORMAL: 10,
  TIPO_CAMBIO_PREDETERMINADO: 505
};

var COLUMNAS = ['id', 'fecha', 'tipo', 'categoria', 'descripcion', 'comercio', 'monto', 'moneda',
  'montoCRC', 'tarjeta', 'ciudad', 'referencia', 'autorizacion', 'fuente', 'nota', 'excluir'];
var COLUMNAS_TEXTO = ['id', 'fecha', 'tarjeta', 'referencia', 'autorizacion'];

// ---------------------------------------------------------------- Menú

function onOpen() {
  SpreadsheetApp.getUi().createMenu('💰 Presupuesto')
    .addItem('1. Configurar (primera vez)', 'configurar')
    .addItem('Importar correos ahora', 'importarCorreos')
    .addItem('Recategorizar con reglas', 'recategorizarTodo')
    .addItem('Actualizar resumen', 'actualizarResumen')
    .addSeparator()
    .addItem('Ver token para la app web', 'mostrarToken')
    .addToUi();
}

// ---------------------------------------------------------------- Configuración

function configurar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();

  var hojaMov = obtenerHoja_(ss, CONFIG.HOJA_MOVIMIENTOS);
  if (hojaMov.getLastRow() === 0) {
    hojaMov.appendRow(COLUMNAS);
    hojaMov.setFrozenRows(1);
    hojaMov.getRange(1, 1, 1, COLUMNAS.length).setFontWeight('bold').setBackground('#e8f0fe');
  }

  var hojaPres = obtenerHoja_(ss, CONFIG.HOJA_PRESUPUESTO);
  if (hojaPres.getLastRow() === 0) {
    hojaPres.appendRow(['categoria', 'presupuestoMensualCRC']);
    Presupuesto.CATEGORIAS_GASTO.forEach(function (c) { hojaPres.appendRow([c.nombre, c.presupuesto]); });
    hojaPres.appendRow(['_tipoCambioUSD', CONFIG.TIPO_CAMBIO_PREDETERMINADO]);
    hojaPres.setFrozenRows(1);
  }

  var hojaReglas = obtenerHoja_(ss, CONFIG.HOJA_REGLAS);
  if (hojaReglas.getLastRow() === 0) {
    hojaReglas.appendRow(['comercio (tal como aparece en el correo)', 'categoria']);
    hojaReglas.setFrozenRows(1);
  }
  obtenerHoja_(ss, CONFIG.HOJA_RESUMEN);

  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid());

  // Disparador cada hora
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'importarCorreos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('importarCorreos').timeBased().everyHours(1).create();

  importarCorreos(CONFIG.DIAS_PRIMERA_CARGA);
  SpreadsheetApp.getUi().alert('Listo. Se importarán correos nuevos cada hora.\n\n' +
    'Token para la app web:\n' + props.getProperty('TOKEN'));
}

function mostrarToken() {
  SpreadsheetApp.getUi().alert('Token: ' + PropertiesService.getScriptProperties().getProperty('TOKEN'));
}

// ---------------------------------------------------------------- Importación

/**
 * Busca correos del banco de los últimos N días y agrega los movimientos nuevos.
 * @param {number=} dias
 */
function importarCorreos(dias) {
  if (typeof dias !== 'number') dias = CONFIG.DIAS_CARGA_NORMAL;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(CONFIG.HOJA_MOVIMIENTOS);
  if (!hoja) throw new Error('Ejecute primero "Configurar".');

  var existentes = {};
  leerMovimientos_(hoja).forEach(function (m) { existentes[m.id] = true; });
  var reglas = leerReglas_(ss);
  var tc = leerTipoCambio_(ss);

  var consulta = CONFIG.CONSULTA_GMAIL + ' newer_than:' + dias + 'd';
  var nuevos = [];
  var inicio = 0, lote = 100, hilos;
  do {
    hilos = GmailApp.search(consulta, inicio, lote);
    hilos.forEach(function (hilo) {
      hilo.getMessages().forEach(function (msg) {
        var id = msg.getId();
        if (existentes[id]) return;
        var mov = Presupuesto.parsearCorreo({
          id: id,
          asunto: msg.getSubject(),
          cuerpo: msg.getPlainBody(),
          fechaCorreo: Utilities.formatDate(msg.getDate(), 'America/Costa_Rica', "yyyy-MM-dd'T'HH:mm")
        });
        if (!mov) return;
        mov.categoria = Presupuesto.categorizar(mov, reglas);
        existentes[id] = true;
        nuevos.push(mov);
      });
    });
    inicio += lote;
  } while (hilos.length === lote);

  if (nuevos.length) {
    nuevos.sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
    var filas = nuevos.map(function (m) { return filaDe_(m, tc); });
    var filaInicio = hoja.getLastRow() + 1;
    // Texto plano para que Sheets no convierta ids, fechas ni referencias
    // (p. ej. "092326364623" perdería el cero inicial).
    COLUMNAS_TEXTO.forEach(function (c) {
      hoja.getRange(filaInicio, COLUMNAS.indexOf(c) + 1, filas.length, 1).setNumberFormat('@');
    });
    hoja.getRange(filaInicio, 1, filas.length, COLUMNAS.length).setValues(filas);
    actualizarResumen();
  }
  Logger.log('Movimientos nuevos: ' + nuevos.length);
  return nuevos.length;
}

/** Vuelve a categorizar todos los movimientos según la hoja Reglas. */
function recategorizarTodo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(CONFIG.HOJA_MOVIMIENTOS);
  var reglas = leerReglas_(ss);
  var movs = leerMovimientos_(hoja);
  if (!movs.length) return;
  var colCat = COLUMNAS.indexOf('categoria') + 1;
  hoja.getRange(2, colCat, movs.length, 1)
    .setValues(movs.map(function (m) { return [Presupuesto.categorizar(m, reglas)]; }));
  actualizarResumen();
}

// ---------------------------------------------------------------- Resumen

function actualizarResumen() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var movs = leerMovimientos_(ss.getSheetByName(CONFIG.HOJA_MOVIMIENTOS));
  var opciones = { tipoCambio: leerTipoCambio_(ss), presupuestos: leerPresupuestos_(ss) };
  var hoja = obtenerHoja_(ss, CONFIG.HOJA_RESUMEN);
  hoja.clear();

  var filas = [['Mes', 'Ingresos', 'Gastos', 'Ahorro/Inversión', 'Transferencias enviadas', 'Balance', '% ahorro']];
  Presupuesto.mesesDisponibles(movs).forEach(function (mes) {
    var r = Presupuesto.resumenMes(movs, mes, opciones);
    filas.push([mes, r.ingresos, r.gastos, r.ahorro, r.transferencias, r.balance,
      r.tasaAhorro == null ? '' : r.tasaAhorro]);
  });
  hoja.getRange(1, 1, filas.length, filas[0].length).setValues(filas);
  hoja.getRange(1, 1, 1, filas[0].length).setFontWeight('bold').setBackground('#e8f0fe');
  if (filas.length > 1) {
    hoja.getRange(2, 2, filas.length - 1, 5).setNumberFormat('₡#,##0');
    hoja.getRange(2, 7, filas.length - 1, 1).setNumberFormat('0%');
  }

  // Detalle por categoría del mes más reciente
  var meses = Presupuesto.mesesDisponibles(movs);
  if (!meses.length) return;
  var r = Presupuesto.resumenMes(movs, meses[0], opciones);
  var inicio = filas.length + 3;
  var det = [['Categoría (' + meses[0] + ')', 'Gastado', 'Presupuesto', '% usado']];
  r.porCategoria.forEach(function (c) {
    det.push([c.icono + ' ' + c.categoria, c.total, c.presupuesto, c.usoPresupuesto == null ? '' : c.usoPresupuesto]);
  });
  hoja.getRange(inicio, 1, det.length, 4).setValues(det);
  hoja.getRange(inicio, 1, 1, 4).setFontWeight('bold').setBackground('#e8f0fe');
  hoja.getRange(inicio + 1, 2, det.length - 1, 2).setNumberFormat('₡#,##0');
  hoja.getRange(inicio + 1, 4, det.length - 1, 1).setNumberFormat('0%');

  if (r.alertas.length) {
    var ini2 = inicio + det.length + 2;
    hoja.getRange(ini2, 1).setValue('⚠️ Alertas').setFontWeight('bold');
    hoja.getRange(ini2 + 1, 1, r.alertas.length, 1)
      .setValues(r.alertas.map(function (a) { return [a.mensaje]; }));
  }
}

// ---------------------------------------------------------------- API para la app web

/**
 * GET ?token=XXXX  -> { movimientos, presupuestos, tipoCambio }
 * Publique como Aplicación web (Ejecutar como: yo; Acceso: cualquier persona).
 * Sin el token correcto no se devuelve ningún dato.
 */
function doGet(e) {
  var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  var salida;
  if (!token || !e || !e.parameter || e.parameter.token !== token) {
    salida = { error: 'Token inválido' };
  } else {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    salida = {
      generado: new Date().toISOString(),
      movimientos: leerMovimientos_(ss.getSheetByName(CONFIG.HOJA_MOVIMIENTOS)),
      presupuestos: leerPresupuestos_(ss),
      tipoCambio: leerTipoCambio_(ss)
    };
  }
  return ContentService.createTextOutput(JSON.stringify(salida))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- Utilidades

function obtenerHoja_(ss, nombre) {
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

function filaDe_(m, tc) {
  var montoCRC = m.moneda === 'USD' ? Math.round(m.monto * tc * 100) / 100 : m.monto;
  var obj = {};
  for (var k in m) obj[k] = m[k];
  obj.montoCRC = montoCRC;
  obj.nota = m.nota || '';
  obj.excluir = m.excluir ? true : '';
  return COLUMNAS.map(function (c) { return obj[c] == null ? '' : obj[c]; });
}

function leerMovimientos_(hoja) {
  if (!hoja || hoja.getLastRow() < 2) return [];
  var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, COLUMNAS.length).getValues();
  return datos.filter(function (f) { return f[0]; }).map(function (f) {
    var m = {};
    COLUMNAS.forEach(function (c, i) { m[c] = f[i]; });
    if (m.fecha instanceof Date) {
      m.fecha = Utilities.formatDate(m.fecha, 'America/Costa_Rica', "yyyy-MM-dd'T'HH:mm");
    }
    m.id = String(m.id);
    m.monto = Number(m.monto) || 0;
    m.excluir = m.excluir === true || String(m.excluir).toUpperCase() === 'TRUE';
    return m;
  });
}

function leerReglas_(ss) {
  var hoja = ss.getSheetByName(CONFIG.HOJA_REGLAS);
  var reglas = {};
  if (!hoja || hoja.getLastRow() < 2) return reglas;
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues().forEach(function (f) {
    if (f[0] && f[1]) reglas[Presupuesto.claveComercio(f[0])] = String(f[1]);
  });
  return reglas;
}

function leerPresupuestos_(ss) {
  var hoja = ss.getSheetByName(CONFIG.HOJA_PRESUPUESTO);
  var p = {};
  if (!hoja || hoja.getLastRow() < 2) return Presupuesto.presupuestosPredeterminados();
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues().forEach(function (f) {
    if (f[0] && String(f[0]).charAt(0) !== '_') p[f[0]] = Number(f[1]) || 0;
  });
  return p;
}

function leerTipoCambio_(ss) {
  var hoja = ss.getSheetByName(CONFIG.HOJA_PRESUPUESTO);
  if (hoja && hoja.getLastRow() >= 2) {
    var filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < filas.length; i++) {
      if (filas[i][0] === '_tipoCambioUSD' && Number(filas[i][1]) > 0) return Number(filas[i][1]);
    }
  }
  return CONFIG.TIPO_CAMBIO_PREDETERMINADO;
}
