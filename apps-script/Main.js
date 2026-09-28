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
