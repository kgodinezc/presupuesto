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
    ['AUTO ?MERCADO|\\bMXM\\b|MAS ?X ?MENOS|PRICE ?SMART|WALMART|\\bPALI\\b|MEGA ?SUPER|FRESH ?MARKET|\\bAM ?PM\\b|DELIMART|PERIMERCADO|\\bSUPER\\b|SUPERMERCADO|CARNICERIA|VERDULERIA|PANADERIA|QUESO|FERIA|MACROBIOTICA|MAXI ?PALI|MAYCA|MEGASUPER', 'Supermercado'],
    ['RESTAURANTE|\\bSODA\\b|PIZZ|PAPA ?JOHN|MC ?DONALD|BURGER|\\bKFC\\b|TACO|STARBUCKS|\\bCAFE|COFFEE|SPOON|CASONA|SUBWAY|\\bPOPS\\b|HELAD|FRESI|CHURRER|MARISQ|SUSHI|POLLO|BAR |CHILIS|ARCOS DORADOS', 'Restaurantes y comidas'],
    ['BOTICA|FARMACIA|FARMA|MEDISMART|CLINICA|HOSPITAL|LABORATORIO|SALUD|MEDIC|DENTAL|OPTICA|FISCHEL|SUCRE|\\bCCSS\\b', 'Salud'],
    ['\\bUBER\\b|\\bDIDI\\b|COMPASS|COMPAS\\b|GASOLINERA|SERVICENTRO|\\bDELTA\\b|\\bUNO\\b|LAVA ?CAR|PARQUEO|PARKING|RITEVE|DEKRA|PEAJE|QUICK ?PASS|REPUESTO|LLANTA|TALLER|\\bCOSEVI\\b|\\bINS\\b', 'Transporte y vehículo'],
    ['\\bICE\\b|KOLBI|\\bCNFL\\b|C\\.N\\.F\\.L|\\bAYA\\b|\\bA Y A\\b|\\bTIGO\\b|\\bCLARO\\b|LIBERTY|TELECABLE|CABLETICA|\\bESPH\\b|JASEC|COOPELESCA|MUNICIPALIDAD|CONDOMINIO', 'Servicios del hogar'],
    ['SPOTIFY|NETFLIX|GOOGLE|YOUTUBE|CANVA|APPLE|ICLOUD|DISNEY|\\bHBO\\b|\\bMAX\\b|PARAMOUNT|PRIME ?VIDEO|CLAUDE|ANTHROPIC|OPENAI|MICROSOFT|ADOBE|DROPBOX', 'Suscripciones digitales'],
    ['AMAZON|EBAY|ALIEXPRESS|SHEIN|TEMU', 'Compras en línea'],
    ['ZARA|H ?& ?M|SIMAN|BERSHKA|PULL ?AND ?BEAR|NIKE|ADIDAS|FOREVER|PAYLESS|STEVEN|\\bTOUS\\b|SALON|BARBER|LOLA|AMERICAN EAGLE|LILI PINK|\\bEPK\\b', 'Ropa y cuidado personal'],
    ['EL REY|PEQUENO MUNDO|\\bEPA\\b|CONSTRUPLAZA|FERRETERIA|\\bMONGE\\b|\\bGOLLO\\b|\\bEXTRA\\b|IKEA|CEMACO|WALMART HOGAR|CHINA DEPOT', 'Hogar'],
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
   * Mes al que corresponde un periodo, con su rango de corte:
   * "Octubre 2026 (7 set – 6 oct)". Sin día de corte: "Octubre 2026".
   * Como en el estado de cuenta de BAC, el periodo lleva el nombre del mes en que cierra.
   */
  function nombreMesCorte(clave, diaCorte) {
    if (!clave) return '';
    var mes = MESES_LARGOS[+clave.slice(5, 7) - 1] + ' ' + clave.slice(0, 4);
    if (!diaCorte) return mes;
    var r = rangoPeriodo(clave, diaCorte);
    var f = function (d) { return (+d.slice(8, 10)) + ' ' + MESES_CORTOS[+d.slice(5, 7) - 1]; };
    return mes + ' (' + f(r.inicio) + ' – ' + f(r.fin) + ')';
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
    nombreMesCorte: nombreMesCorte,
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

// ===== app/js/core/estadoCuenta.js =====
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
  TIPO_CAMBIO_PREDETERMINADO: 505,
  // Día de corte de la tarjeta (0 = mes calendario). Se cambia en la hoja Presupuesto, fila _diaCorte.
  DIA_CORTE_PREDETERMINADO: 0
};

var COLUMNAS = ['id', 'fecha', 'tipo', 'categoria', 'descripcion', 'comercio', 'monto', 'moneda',
  'montoCRC', 'tarjeta', 'ciudad', 'referencia', 'autorizacion', 'fuente', 'nota', 'excluir', 'mesCorte'];
var COLUMNAS_TEXTO = ['id', 'fecha', 'tarjeta', 'referencia', 'autorizacion', 'mesCorte'];

// ---------------------------------------------------------------- Menú

function onOpen() {
  SpreadsheetApp.getUi().createMenu('💰 Presupuesto')
    .addItem('1. Configurar (primera vez)', 'configurar')
    .addItem('Importar correos ahora', 'importarCorreos')
    .addItem('Recategorizar con reglas', 'recategorizarTodo')
    .addItem('Actualizar resumen y mes de corte', 'actualizarResumen')
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
  if (leerAjuste_(ss, '_diaCorte') === null) {
    hojaPres.appendRow(['_diaCorte', CONFIG.DIA_CORTE_PREDETERMINADO]);
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
  var diaCorte = leerDiaCorte_(ss);

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
    var filas = nuevos.map(function (m) { return filaDe_(m, tc, diaCorte); });
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
  asegurarAjuste_(ss, '_diaCorte', CONFIG.DIA_CORTE_PREDETERMINADO);
  actualizarMesCorte_(ss);
  var movs = leerMovimientos_(ss.getSheetByName(CONFIG.HOJA_MOVIMIENTOS));
  var diaCorte = leerDiaCorte_(ss);
  var opciones = { tipoCambio: leerTipoCambio_(ss), presupuestos: leerPresupuestos_(ss), diaCorte: diaCorte };
  var hoja = obtenerHoja_(ss, CONFIG.HOJA_RESUMEN);
  hoja.clear();

  var filas = [[diaCorte ? 'Periodo (corte día ' + diaCorte + ')' : 'Mes', 'Ingresos', 'Gastos', 'Ahorro/Inversión', 'Transferencias enviadas', 'Balance', '% ahorro']];
  Presupuesto.mesesDisponibles(movs, diaCorte).forEach(function (mes) {
    var r = Presupuesto.resumenMes(movs, mes, opciones);
    filas.push([Presupuesto.etiquetaPeriodo(mes, diaCorte), r.ingresos, r.gastos, r.ahorro, r.transferencias, r.balance,
      r.tasaAhorro == null ? '' : r.tasaAhorro]);
  });
  hoja.getRange(1, 1, filas.length, filas[0].length).setValues(filas);
  hoja.getRange(1, 1, 1, filas[0].length).setFontWeight('bold').setBackground('#e8f0fe');
  if (filas.length > 1) {
    hoja.getRange(2, 2, filas.length - 1, 5).setNumberFormat('₡#,##0');
    hoja.getRange(2, 7, filas.length - 1, 1).setNumberFormat('0%');
  }

  // Detalle por categoría del mes más reciente
  var meses = Presupuesto.mesesDisponibles(movs, diaCorte);
  if (!meses.length) return;
  var r = Presupuesto.resumenMes(movs, meses[0], opciones);
  var inicio = filas.length + 3;
  var det = [['Categoría (' + Presupuesto.etiquetaPeriodo(meses[0], diaCorte) + ')', 'Gastado', 'Presupuesto', '% usado']];
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
      tipoCambio: leerTipoCambio_(ss),
      diaCorte: leerDiaCorte_(ss)
    };
  }
  // JSONP (?callback=fn): permite leer los datos desde otro dominio sin depender de CORS.
  var callback = e && e.parameter && e.parameter.callback;
  if (callback && /^[A-Za-z_$][\w$.]{0,60}$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(salida) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(salida))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- Utilidades

function obtenerHoja_(ss, nombre) {
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

/** Texto de la columna mesCorte: "Octubre 2026 (7 set – 6 oct)". */
function mesCorteDe_(fecha, diaCorte) {
  return Presupuesto.nombreMesCorte(Presupuesto.periodoDe(fecha, diaCorte), diaCorte);
}

/**
 * Llena la columna mesCorte de todos los movimientos según el _diaCorte actual.
 * Agrega el encabezado si la hoja es anterior a esta columna.
 */
function actualizarMesCorte_(ss) {
  var hoja = ss.getSheetByName(CONFIG.HOJA_MOVIMIENTOS);
  if (!hoja || hoja.getLastRow() < 1) return;
  var col = COLUMNAS.indexOf('mesCorte') + 1;
  if (hoja.getRange(1, col).getValue() !== 'mesCorte') {
    hoja.getRange(1, col).setValue('mesCorte').setFontWeight('bold').setBackground('#e8f0fe');
  }
  var n = hoja.getLastRow() - 1;
  if (n < 1) return;
  var diaCorte = leerDiaCorte_(ss);
  var colFecha = COLUMNAS.indexOf('fecha') + 1;
  var fechas = hoja.getRange(2, colFecha, n, 1).getValues();
  var valores = fechas.map(function (f) {
    var fecha = f[0] instanceof Date
      ? Utilities.formatDate(f[0], 'America/Costa_Rica', "yyyy-MM-dd'T'HH:mm")
      : String(f[0] || '');
    return [fecha ? mesCorteDe_(fecha, diaCorte) : ''];
  });
  hoja.getRange(2, col, n, 1).setNumberFormat('@').setValues(valores);
}

/** Agrega una fila de ajuste (p. ej. _diaCorte) a la hoja Presupuesto si no existe. */
function asegurarAjuste_(ss, nombre, valor) {
  var hoja = ss.getSheetByName(CONFIG.HOJA_PRESUPUESTO);
  if (hoja && leerAjuste_(ss, nombre) === null) hoja.appendRow([nombre, valor]);
}

function filaDe_(m, tc, diaCorte) {
  var montoCRC = m.moneda === 'USD' ? Math.round(m.monto * tc * 100) / 100 : m.monto;
  var obj = {};
  for (var k in m) obj[k] = m[k];
  obj.montoCRC = montoCRC;
  obj.mesCorte = m.fecha ? mesCorteDe_(m.fecha, diaCorte || 0) : '';
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

/** Valor de una fila de ajuste (_tipoCambioUSD, _diaCorte) en la hoja Presupuesto, o null. */
function leerAjuste_(ss, nombre) {
  var hoja = ss.getSheetByName(CONFIG.HOJA_PRESUPUESTO);
  if (hoja && hoja.getLastRow() >= 2) {
    var filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < filas.length; i++) {
      if (filas[i][0] === nombre && filas[i][1] !== '') return Number(filas[i][1]);
    }
  }
  return null;
}

function leerTipoCambio_(ss) {
  var v = leerAjuste_(ss, '_tipoCambioUSD');
  return v > 0 ? v : CONFIG.TIPO_CAMBIO_PREDETERMINADO;
}

function leerDiaCorte_(ss) {
  var v = leerAjuste_(ss, '_diaCorte');
  return v >= 1 && v <= 31 ? Math.floor(v) : CONFIG.DIA_CORTE_PREDETERMINADO;
}
