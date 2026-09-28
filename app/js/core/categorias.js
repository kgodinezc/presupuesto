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
