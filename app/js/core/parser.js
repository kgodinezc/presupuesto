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
