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
    // SINPE y transferencias enviadas que no tienen una categoría más precisa
    { nombre: 'SINPE y transferencias', icono: '📲', presupuesto: 0 },
    { nombre: 'Otros', icono: '❓', presupuesto: 40000 }
  ];

  var CATEGORIAS_INGRESO = ['Salario', 'Transferencias recibidas', 'Otros ingresos'];
  // Salidas de dinero que NO son gasto (el usuario las elige como excepción): el gasto ya está en las
  // compras de la tarjeta o el dinero sigue siendo de la familia. Todo lo demás que sale es gasto.
  var CATEGORIA_TRANSFERENCIA = 'Transferencia (no es gasto)';
  var CATEGORIAS_TRANSFERENCIA = ['Pago de tarjeta', 'Entre cuentas propias', CATEGORIA_TRANSFERENCIA];
  // Nombre anterior: los SINPE enviados se registraban como "Transferencias" y no sumaban al gasto
  var CATEGORIA_TRANSFERENCIA_ANTERIOR = 'Transferencias';

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
    ['HOTEL|KAYAK|EVENTOS|\\bCINE|\\bCCM\\b|\\bTOUR|PARQUE|MUSEO|AIRBNB|BOOKING|TICKET|TEATRO', 'Paseos y entretenimiento'],
    // Al final: un SINPE o transferencia enviada sin otra pista es gasto en esta categoría
    ['\\bSINPE\\b|TRANSFERENCIA', 'SINPE y transferencias']
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
    var clave = claveComercio(mov.comercio || mov.descripcion);
    if (reglasUsuario && reglasUsuario[clave]) return reglasUsuario[clave];
    if (mov.tipo === 'transferencia') {
      return CATEGORIAS_TRANSFERENCIA.indexOf(mov.categoria) >= 0 ? mov.categoria : CATEGORIA_TRANSFERENCIA;
    }
    var texto = normalizarTexto((mov.comercio || '') + ' ' + (mov.descripcion || ''));
    if (mov.tipo === 'ingreso') {
      return primeraCoincidencia(REGLAS_INGRESO, texto) || 'Otros ingresos';
    }
    return primeraCoincidencia(REGLAS_PREDETERMINADAS, texto) || 'Otros';
  }

  /** Gastos y transferencias enviadas: es transferencia (no suma al gasto) solo con una categoría de transferencia. */
  function tipoSegunCategoria(tipo, categoria) {
    if (tipo !== 'gasto' && tipo !== 'transferencia') return tipo;
    return CATEGORIAS_TRANSFERENCIA.indexOf(categoria) >= 0 ? 'transferencia' : 'gasto';
  }

  /**
   * Ajusta tipo y categoría de un movimiento a la regla "todo lo que sale es gasto, salvo las excepciones":
   * los SINPE enviados que antes quedaban como "Transferencias" pasan a gasto (con su categoría), salvo que
   * el usuario los haya marcado a mano. Modifica el movimiento y devuelve true si cambió.
   */
  function normalizarTipo(mov, reglasUsuario) {
    if (mov.tipo !== 'gasto' && mov.tipo !== 'transferencia') return false;
    var antes = mov.tipo + '|' + mov.categoria;
    if (mov.categoria === CATEGORIA_TRANSFERENCIA_ANTERIOR || (mov.tipo === 'transferencia' && !mov.categoria)) {
      if (mov.editado) {
        mov.categoria = CATEGORIA_TRANSFERENCIA;
      } else {
        mov.tipo = 'gasto';
        mov.categoria = categorizar(mov, reglasUsuario);
      }
    }
    mov.tipo = tipoSegunCategoria(mov.tipo, mov.categoria);
    return antes !== mov.tipo + '|' + mov.categoria;
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
    if (categoria === CATEGORIA_TRANSFERENCIA || categoria === CATEGORIA_TRANSFERENCIA_ANTERIOR) return '🔁';
    if (categoria === 'Pago de tarjeta') return '💳';
    if (categoria === 'Entre cuentas propias') return '🏦';
    if (categoria === 'Transferencias recibidas') return '📥';
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
    CATEGORIAS_TRANSFERENCIA: CATEGORIAS_TRANSFERENCIA,
    CATEGORIA_TRANSFERENCIA_ANTERIOR: CATEGORIA_TRANSFERENCIA_ANTERIOR,
    tipoSegunCategoria: tipoSegunCategoria,
    normalizarTipo: normalizarTipo,
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
