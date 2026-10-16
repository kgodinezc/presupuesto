/* Presupuesto Familiar — interfaz web (sin dependencias). */
(function () {
  'use strict';

  var P = window.Presupuesto;
  var CLAVE = 'presupuesto-familiar:v1';

  // ------------------------------------------------------------ Estado

  var estado = cargar();
  normalizarTipos();

  function estadoInicial() {
    return {
      movimientos: [],
      presupuestos: P.presupuestosPredeterminados(),
      reglas: {},
      ajustes: { tipoCambio: 505, url: '', token: '', diaCorte: 0 },
      estadosCuenta: [],
      estadosBancarios: [],
      mes: ''
    };
  }

  function cargar() {
    try {
      var raw = localStorage.getItem(CLAVE);
      if (raw) {
        var e = JSON.parse(raw);
        var base = estadoInicial();
        return {
          movimientos: e.movimientos || [],
          presupuestos: e.presupuestos || base.presupuestos,
          reglas: e.reglas || {},
          ajustes: Object.assign(base.ajustes, e.ajustes || {}),
          estadosCuenta: e.estadosCuenta || [],
          estadosBancarios: e.estadosBancarios || [],
          mes: e.mes || ''
        };
      }
    } catch (err) { /* almacenamiento no disponible */ }
    return estadoInicial();
  }

  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (err) {
      aviso('No se pudo guardar en este navegador. Exporte un respaldo.');
    }
  }

  // ------------------------------------------------------------ Utilidades

  var $ = function (s) { return document.querySelector(s); };
  var fmtCRC = new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 });
  var fmtUSD = new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'USD' });
  function crc(n) { return fmtCRC.format(n || 0); }
  function montoOriginal(m) { return m.moneda === 'USD' ? fmtUSD.format(m.monto) : crc(m.monto); }
  function pct(n) { return n == null ? '—' : Math.round(n * 100) + '%'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function diaCorte() { return +estado.ajustes.diaCorte || 0; }
  /** Mes calendario 'YYYY-MM' de una fecha. El Resumen y la lista de movimientos usan meses calendario. */
  function mesDeFecha(fecha) { return String(fecha || '').slice(0, 7); }
  function nombreMes(clave) { return P.etiquetaPeriodo(clave, 0); }   // "Octubre 2026"
  function hoyISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /** "Oct 2026": mes de corte del movimiento (respeta el periodo asignado por un estado de cuenta). */
  function mesCorteCorto(m) {
    var clave = P.periodoMovimiento(m, diaCorte());
    if (!clave) return '';
    return P.nombreMesCorte(clave, 0).slice(0, 3) + ' ' + clave.slice(0, 4);
  }
  /** "Oct 2026": mes calendario del movimiento. */
  function mesCalendarioCorto(m) {
    var clave = mesDeFecha(m.fecha);
    return clave ? nombreMes(clave).slice(0, 3) + ' ' + clave.slice(0, 4) : '';
  }
  /** Resumen: por mes calendario. */
  function opciones() {
    return { tipoCambio: estado.ajustes.tipoCambio, presupuestos: estado.presupuestos, diaCorte: 0 };
  }
  /** Estado de cuenta: por periodo de corte de la tarjeta. */
  function opcionesCorte() {
    return { tipoCambio: estado.ajustes.tipoCambio, presupuestos: estado.presupuestos, diaCorte: diaCorte() };
  }
  /** Categorías de gasto: las predeterminadas más las propias que tenga el presupuesto (p. ej. de la hoja). */
  function categoriasGasto() {
    var lista = P.CATEGORIAS_GASTO.map(function (c) { return { nombre: c.nombre, icono: c.icono, esAhorro: !!c.esAhorro }; });
    var conocidas = {};
    lista.forEach(function (c) { conocidas[c.nombre] = true; });
    Object.keys(estado.presupuestos).forEach(function (k) {
      if (!conocidas[k] && k.charAt(0) !== '_' && P.CATEGORIAS_INGRESO.indexOf(k) < 0 && P.CATEGORIAS_TRANSFERENCIA.indexOf(k) < 0) {
        lista.splice(lista.length - 1, 0, { nombre: k, icono: P.iconoDe(k), esAhorro: false }); // antes de "Otros"
      }
    });
    return lista;
  }
  function categoriasPara(tipo) {
    if (tipo === 'ingreso') return P.CATEGORIAS_INGRESO;
    if (tipo === 'transferencia') return P.CATEGORIAS_TRANSFERENCIA;
    return categoriasGasto().map(function (c) { return c.nombre; });
  }
  function aviso(txt) {
    var t = $('#toast');
    t.textContent = txt;
    t.classList.add('visible');
    clearTimeout(aviso._t);
    aviso._t = setTimeout(function () { t.classList.remove('visible'); }, 3200);
  }
  function descargar(nombre, contenido, tipo) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([contenido], { type: tipo }));
    a.download = nombre;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ------------------------------------------------------------ Datos

  /** Agrega o actualiza movimientos por id. Respeta categorías editadas a mano. */
  function fusionar(entrantes) {
    var porId = {};
    estado.movimientos.forEach(function (m) { porId[m.id] = m; });
    var nuevos = 0;
    entrantes.forEach(function (m) {
      if (!m || !m.id || !m.fecha) return;
      var previo = porId[m.id];
      if (!previo) {
        if (!m.categoria) m.categoria = P.categorizar(m, estado.reglas);
        porId[m.id] = m;
        nuevos++;
      } else if (!previo.editado) {
        porId[m.id] = Object.assign({}, previo, m, { excluir: previo.excluir || m.excluir });
      }
    });
    estado.movimientos = Object.keys(porId).map(function (k) { return porId[k]; })
      .sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
    normalizarTipos();
    return nuevos;
  }

  /**
   * Todo SINPE o transferencia enviada es gasto, salvo que tenga una categoría de "no es gasto"
   * (pago de tarjeta, entre cuentas propias…). Pasa a gasto los SINPE que antes eran "Transferencias".
   */
  function normalizarTipos() {
    var n = 0;
    estado.movimientos.forEach(function (m) { if (P.normalizarTipo(m, estado.reglas)) n++; });
    return n;
  }

  /** "SINPE enviado" de los correos, "Sin descripción", "Cuenta 123…": no identifican un destinatario. */
  function esComercioGenerico(clave) {
    return !clave || /^(SINPE ENVIADO|SIN DESCRIPCION|CUENTA)$/.test(clave);
  }

  /** Elegir una categoría de transferencia convierte un gasto en transferencia y viceversa. */
  function tipoParaCategoria(mov, categoria) {
    return P.tipoSegunCategoria(mov.tipo, categoria);
  }

  function cambiarCategoria(id, categoria, recordar) {
    var mov = estado.movimientos.find(function (m) { return m.id === id; });
    if (!mov) return;
    var tipoNuevo = tipoParaCategoria(mov, categoria);
    mov.categoria = categoria;
    mov.tipo = tipoNuevo;
    mov.editado = true;
    // No se aprenden nombres genéricos ("SINPE enviado" de los correos, "Sin descripción", "Cuenta 123…"):
    // la regla cambiaría todos los SINPE, no solo los de ese destinatario.
    var clave = P.claveComercio(mov.comercio);
    if (recordar && !esComercioGenerico(clave)) {
      estado.reglas[clave] = categoria;
      var otros = 0;
      estado.movimientos.forEach(function (m) {
        if (m === mov || P.claveComercio(m.comercio) !== clave) return;
        var salida = function (x) { return x.tipo === 'gasto' || x.tipo === 'transferencia'; };
        if (m.tipo === mov.tipo || (!mov.tarjeta && !m.tarjeta && salida(m) && salida(mov))) {
          m.categoria = categoria; m.tipo = mov.tipo; m.editado = true; otros++;
        }
      });
      if (otros) aviso('También se actualizaron ' + otros + ' movimientos de ' + mov.comercio + '.');
    }
    guardar();
    render();
  }

  // ------------------------------------------------------------ Render: Resumen

  function renderMeses() {
    var meses = P.mesesDisponibles(estado.movimientos, 0);
    var actual = mesDeFecha(hoyISO());
    if (meses.indexOf(actual) < 0) { meses.push(actual); meses.sort().reverse(); }
    if (!estado.mes || meses.indexOf(estado.mes) < 0) {
      estado.mes = P.mesesDisponibles(estado.movimientos, 0)[0] || actual;
    }
    $('#mes').innerHTML = meses.map(function (m) {
      return '<option value="' + m + '"' + (m === estado.mes ? ' selected' : '') + '>' + nombreMes(m) + '</option>';
    }).join('');
  }

  function renderResumen() {
    var r = P.resumenMes(estado.movimientos, estado.mes, opciones());
    $('#vacio').hidden = estado.movimientos.length > 0;

    var kpis = [
      { e: 'Ingresos', v: crc(r.ingresos), c: 'pos', s: r.porIngreso.length + ' fuente(s)' },
      { e: 'Gastos', v: crc(r.gastos), c: 'neg', s: r.presupuestoTotal ? pct(r.gastos / r.presupuestoTotal) + ' del presupuesto' : '' },
      { e: 'Balance del mes', v: crc(r.balance), c: r.balance >= 0 ? 'pos' : 'neg', s: 'Ingresos − gastos − ahorro' },
      { e: 'Tasa de ahorro', v: pct(r.tasaAhorro), c: (r.tasaAhorro || 0) >= 0.1 ? 'pos' : 'neg', s: 'Meta sugerida: 10–20%' }
    ];
    if (r.ahorro) kpis.push({ e: 'Ahorro e inversión', v: crc(r.ahorro), c: '', s: 'Separado del gasto' });
    if (r.transferencias) kpis.push({ e: 'No es gasto', v: crc(r.transferencias), c: '', s: 'Pagos de tarjeta, entre cuentas propias…' });
    $('#kpis').innerHTML = kpis.map(function (k) {
      return '<div class="kpi"><div class="etiqueta">' + k.e + '</div><div class="valor ' + k.c + '">' +
        k.v + '</div><div class="sub">' + esc(k.s) + '</div></div>';
    }).join('');

    $('#alertas').innerHTML = r.alertas.map(function (a) {
      return '<div class="alerta">⚠️ ' + esc(a.mensaje) + '</div>';
    }).join('');

    var cats = r.porCategoria.filter(function (c) { return c.total !== 0 || c.presupuesto > 0; });
    $('#categorias').innerHTML = cats.length ? cats.map(function (c) {
      var ahorro = P.esCategoriaAhorro(c.categoria);
      var ref = c.presupuesto || c.total || 1;
      var ancho = Math.min(100, Math.max(0, c.total / ref * 100));
      var clase = ahorro ? 'ahorro' : (c.presupuesto && c.total > c.presupuesto ? 'exceso' : '');
      var det = c.cantidad + ' mov.' +
        (c.presupuesto ? ' · presupuesto ' + crc(c.presupuesto) + ' · ' + pct(c.usoPresupuesto) + ' usado' : ' · sin presupuesto');
      return '<div class="cat"><span class="nombre">' + c.icono + ' ' + esc(c.categoria) + '</span>' +
        '<span class="monto">' + crc(c.total) + '</span>' +
        '<div class="barra-fondo"><div class="barra-uso ' + clase + '" style="width:' + ancho + '%"></div></div>' +
        '<span class="detalle">' + det + '</span></div>';
    }).join('') : '<p class="ayuda">Sin gastos este mes.</p>';

    $('#ingresos').innerHTML = r.porIngreso.length ? r.porIngreso.map(function (i) {
      return '<div class="cat"><span class="nombre">' + P.iconoDe(i.categoria) + ' ' + esc(i.categoria) +
        '</span><span class="monto pos">' + crc(i.total) + '</span></div>';
    }).join('') : '<p class="ayuda">Sin ingresos registrados este mes.</p>';

    renderCuentas(r);
    renderTendencia();
  }

  /** Flujo de dinero del mes: transferencias por tipo y saldos de las cuentas bancarias cargadas. */
  function renderCuentas(r) {
    var html = '';
    var recibidas = r.porIngreso.filter(function (i) { return i.categoria === 'Transferencias recibidas'; })[0];
    if (r.porTransferencia.length || recibidas || r.enviadosGasto) {
      html += '<h2>Transferencias del mes</h2>';
      if (recibidas) {
        html += '<div class="cat"><span class="nombre">📥 Recibidas</span><span class="monto pos">' + crc(recibidas.total) + '</span></div>';
      }
      if (r.enviadosGasto) {
        html += '<div class="cat"><span class="nombre">📲 SINPE y transferencias enviadas</span><span class="monto neg">' +
          crc(r.enviadosGasto) + '</span><span class="detalle">Incluidas en el gasto, en su categoría</span></div>';
      }
      html += r.porTransferencia.map(function (t) {
        return '<div class="cat"><span class="nombre">' + P.iconoDe(t.categoria) + ' ' + esc(t.categoria) +
          '</span><span class="monto">' + crc(t.total) + '</span><span class="detalle">No es gasto</span></div>';
      }).join('');
      html += '<p class="ayuda">Los SINPE y transferencias enviados cuentan como gasto. Para excluir uno (p. ej. un traslado a ' +
        'otra cuenta suya), en <b>Movimientos</b> elija una categoría del grupo "No es gasto".</p>';
    }
    var cuentas = estado.estadosBancarios.filter(function (eb) { return eb.clave === estado.mes; });
    if (cuentas.length) {
      html += '<h2' + (html ? ' class="mt"' : '') + '>Cuentas bancarias</h2><div class="tabla-envoltura"><table class="tabla">' +
        '<thead><tr><th>Cuenta</th><th class="num">Entradas</th><th class="num">Salidas</th><th class="num">Saldo al corte</th></tr></thead><tbody>' +
        cuentas.map(function (eb) {
          var cre = 0, deb = 0;
          eb.lineas.forEach(function (l) { if (l.esCredito) cre += l.monto; else deb += l.monto; });
          return '<tr><td>' + (eb.moneda === 'USD' ? 'Dólares' : 'Colones') + ' ···' + esc(eb.cuenta) + '</td><td class="num pos">' +
            fmtMoneda(cre, eb.moneda) + '</td><td class="num neg">' + fmtMoneda(deb, eb.moneda) + '</td><td class="num">' +
            fmtMoneda(eb.saldoFinal, eb.moneda) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } else if (estado.estadosBancarios.length || r.porTransferencia.length) {
      html += '<p class="ayuda">Cargue el estado de cuenta bancario de este mes en <b>Estados de cuenta</b> para ver las entradas y salidas de sus cuentas.</p>';
    }
    $('#cuentas').innerHTML = html;
    $('#cuentas').hidden = !html;
  }

  function renderTendencia() {
    var serie = P.serieMensual(estado.movimientos, opciones()).slice(-6);
    if (!serie.length) { $('#tendencia').innerHTML = ''; return; }
    var max = Math.max.apply(null, serie.map(function (s) { return Math.max(s.ingresos, s.gastos); })) || 1;
    $('#tendencia').innerHTML = '<div class="tendencia">' + serie.map(function (s) {
      return '<div class="mes" title="' + nombreMes(s.mes) + ': ingresos ' + crc(s.ingresos) + ', gastos ' + crc(s.gastos) + '">' +
        '<div class="barras"><div class="b i" style="height:' + (s.ingresos / max * 100) + '%"></div>' +
        '<div class="b g" style="height:' + (s.gastos / max * 100) + '%"></div></div>' +
        '<span class="lbl">' + P.etiquetaPeriodo(s.mes, 0).slice(0, 3) + '</span></div>';
    }).join('') + '</div><div class="leyenda"><span><i style="background:var(--ingreso)"></i>Ingresos</span>' +
      '<span><i style="background:var(--gasto)"></i>Gastos</span></div>';
  }

  // ------------------------------------------------------------ Render: Movimientos

  function renderFiltroCategorias() {
    var todas = categoriasPara('gasto').concat(P.CATEGORIAS_INGRESO, P.CATEGORIAS_TRANSFERENCIA);
    var sel = $('#f-categoria');
    var actual = sel.value;
    sel.innerHTML = '<option value="">Todas las categorías</option>' + todas.map(function (c) {
      return '<option' + (c === actual ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
  }

  function opcionesDe(lista, actual) {
    return lista.map(function (c) {
      return '<option' + (c === actual ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
  }
  /** Transferencias y gastos fuera de tarjeta pueden pasar de un tipo al otro. */
  function opcionesCategoria(m) {
    if (m.tipo === 'transferencia' || (m.tipo === 'gasto' && !m.tarjeta)) {
      var transf = '<optgroup label="No es gasto (excepción)">' + opcionesDe(categoriasPara('transferencia'), m.categoria) + '</optgroup>';
      var gasto = '<optgroup label="' + (m.tipo === 'gasto' ? 'Gasto' : 'Contar como gasto') + '">' +
        opcionesDe(categoriasPara('gasto'), m.categoria) + '</optgroup>';
      return m.tipo === 'gasto' ? gasto + transf : transf + gasto;
    }
    return opcionesDe(categoriasPara(m.tipo === 'reembolso' ? 'gasto' : m.tipo), m.categoria);
  }

  function renderMovimientos() {
    var texto = P.normalizarTexto($('#f-texto').value);
    var tipo = $('#f-tipo').value;
    var cat = $('#f-categoria').value;
    var lista = estado.movimientos.filter(function (m) {
      if (!$('#f-todos').checked && mesDeFecha(m.fecha) !== estado.mes) return false;
      if (tipo && m.tipo !== tipo) return false;
      if (cat && m.categoria !== cat) return false;
      if (texto && P.normalizarTexto((m.descripcion || '') + ' ' + (m.comercio || '')).indexOf(texto) < 0) return false;
      return true;
    });

    $('#lista').innerHTML = lista.map(function (m) {
      var signo = m.tipo === 'ingreso' || m.tipo === 'reembolso' ? '+' : '−';
      var clase = m.tipo === 'ingreso' || m.tipo === 'reembolso' ? 'pos' : (m.tipo === 'transferencia' ? '' : 'neg');
      var opts = opcionesCategoria(m);
      var sub = [m.tarjeta, m.ciudad, m.cuenta ? 'Cuenta ···' + m.cuenta : '',
        m.tipo === 'transferencia' ? 'no suma al gasto' : ''].filter(Boolean).join(' · ');
      return '<tr class="' + (m.excluir ? 'excluido' : '') + '">' +
        '<td>' + esc(String(m.fecha).slice(0, 10).split('-').reverse().slice(0, $('#f-todos').checked ? 3 : 2).join('/')) + '</td>' +
        '<td class="mes-corte">' + esc(mesCalendarioCorto(m)) + '</td>' +
        '<td class="mes-corte">' + esc(mesCorteCorto(m)) + '</td>' +
        '<td class="desc">' + esc(m.descripcion) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</td>' +
        '<td><select data-id="' + esc(m.id) + '" class="sel-cat">' + opts + '</select></td>' +
        '<td class="num ' + clase + '">' + signo + ' ' + montoOriginal(m) + '</td>' +
        '<td class="num"><button class="icono-btn" data-excluir="' + esc(m.id) + '" title="' +
        (m.excluir ? 'Incluir en el resumen' : 'Excluir del resumen') + '">' + (m.excluir ? '↩️' : '🚫') + '</button>' +
        (m.manual ? '<button class="icono-btn" data-borrar="' + esc(m.id) + '" title="Eliminar">🗑️</button>' : '') +
        '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="ayuda">No hay movimientos con estos filtros.</td></tr>';

    var tc = estado.ajustes.tipoCambio;
    var total = lista.filter(function (m) { return !m.excluir; }).reduce(function (s, m) {
      var v = P.aColones(m, tc);
      return s + (m.tipo === 'ingreso' || m.tipo === 'reembolso' ? v : -v);
    }, 0);
    $('#total-filtro').textContent = lista.length + ' movimientos · neto ' + crc(total) +
      ' (US$ convertidos a ₡' + tc + ')';
  }

  // ------------------------------------------------------------ Render: Presupuesto y formularios

  function renderPresupuesto() {
    $('#lista-presupuesto').innerHTML = categoriasGasto().map(function (c) {
      return '<label>' + c.icono + ' ' + esc(c.nombre) +
        '<input type="number" min="0" step="1000" name="' + esc(c.nombre) + '" value="' +
        (estado.presupuestos[c.nombre] || 0) + '"></label>';
    }).join('');
    var total = categoriasGasto().reduce(function (s, c) {
      return s + (c.esAhorro ? 0 : (estado.presupuestos[c.nombre] || 0));
    }, 0);
    $('#total-presupuesto').textContent = 'Total de gastos presupuestados: ' + crc(total) + ' por mes.' +
      (estado.ajustes.url && estado.ajustes.token
        ? ' Con la hoja de Google conectada, el presupuesto se toma de su pestaña Presupuesto: edítelo allá.'
        : '');
  }

  function renderFormManual() {
    var f = $('#form-manual');
    f.categoria.innerHTML = categoriasPara(f.tipo.value).map(function (c) {
      return '<option>' + esc(c) + '</option>';
    }).join('');
    if (!f.fecha.value) f.fecha.value = new Date().toISOString().slice(0, 10);
  }

  function renderDatos() {
    var f = $('#form-sync');
    f.url.value = estado.ajustes.url || '';
    f.token.value = estado.ajustes.token || '';
    $('#tipo-cambio').value = estado.ajustes.tipoCambio;
    $('#dia-corte').value = diaCorte();
    renderEstadoSync();
  }

  function render() {
    renderMeses();
    renderResumen();
    renderFiltroCategorias();
    renderMovimientos();
    renderEstadoCuenta();
    renderEstadoBancario();
  }

  // ------------------------------------------------------------ Eventos

  document.querySelectorAll('.pestanas button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.pestanas button').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('activa'); });
      $('#tab-' + b.dataset.tab).classList.add('activa');
    });
  });

  $('#mes').addEventListener('change', function (e) { estado.mes = e.target.value; guardar(); render(); });
  ['#f-texto', '#f-tipo', '#f-categoria', '#f-todos'].forEach(function (s) {
    $(s).addEventListener('input', renderMovimientos);
  });

  $('#lista').addEventListener('change', function (e) {
    if (!e.target.classList.contains('sel-cat')) return;
    cambiarCategoria(e.target.dataset.id, e.target.value, true);
  });
  $('#lista').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.excluir) {
      var m = estado.movimientos.find(function (x) { return x.id === b.dataset.excluir; });
      m.excluir = !m.excluir;
      m.editado = true;
    } else if (b.dataset.borrar && confirm('¿Eliminar este movimiento?')) {
      estado.movimientos = estado.movimientos.filter(function (x) { return x.id !== b.dataset.borrar; });
    } else { return; }
    guardar(); render();
  });

  $('#form-manual').tipo.addEventListener('change', renderFormManual);
  $('#form-manual').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var mov = {
      id: 'manual-' + Date.now(),
      fecha: f.fecha.value + 'T12:00',
      tipo: f.tipo.value,
      descripcion: f.descripcion.value.trim(),
      comercio: f.descripcion.value.trim(),
      monto: parseFloat(f.monto.value),
      moneda: f.moneda.value,
      categoria: f.categoria.value,
      fuente: 'Manual',
      manual: true,
      editado: true
    };
    fusionar([mov]);
    estado.mes = mesDeFecha(f.fecha.value);
    guardar(); render();
    f.descripcion.value = ''; f.monto.value = '';
    aviso('Movimiento agregado.');
  });

  $('#btn-parsear').addEventListener('click', function () {
    var texto = $('#correo-texto').value;
    var mov = P.parsearCorreo({ id: '', cuerpo: texto, asunto: '' });
    if (!mov) {
      $('#correo-resultado').innerHTML = '<p class="alerta">No se reconoció una transacción en ese texto.</p>';
      return;
    }
    // id estable para no duplicar si se pega dos veces
    mov.id = 'pegado-' + [mov.fecha, mov.comercio, mov.monto, mov.autorizacion || mov.referencia].join('|');
    var nuevos = fusionar([mov]);
    estado.mes = mesDeFecha(mov.fecha);
    guardar(); render();
    $('#correo-resultado').innerHTML = '<p class="ayuda">' + (nuevos ? '✅ Agregado: ' : 'Ya existía: ') +
      esc(mov.descripcion) + ' · ' + montoOriginal(mov) + ' · ' + esc(mov.categoria) + '</p>';
    $('#correo-texto').value = '';
  });

  $('#form-presupuesto').addEventListener('submit', function (e) {
    e.preventDefault();
    categoriasGasto().forEach(function (c) {
      estado.presupuestos[c.nombre] = parseFloat(e.target.elements[c.nombre].value) || 0;
    });
    guardar(); renderPresupuesto(); render();
    aviso('Presupuesto guardado.');
  });

  $('#form-sync').addEventListener('submit', function (e) {
    e.preventDefault();
    estado.ajustes.url = e.target.url.value.trim();
    estado.ajustes.token = e.target.token.value.trim();
    guardar();
    if (!estado.ajustes.url || !estado.ajustes.token) { aviso('Ingrese la URL y el token.'); return; }
    sincronizar(false);
  });

  // ------------------------------------------------------------ Sincronización automática
  //
  // La hoja de Google lee los correos cada hora. La app trae esos datos sola:
  // al abrirse, al volver a su pestaña y cada 15 minutos mientras está abierta.

  var CADA_MS = 15 * 60 * 1000;
  var sincronizando = false;

  function sincronizar(silencioso) {
    var url = estado.ajustes.url, token = estado.ajustes.token;
    if (!url || !token || sincronizando) return Promise.resolve();
    sincronizando = true;
    if (!silencioso) $('#sync-estado').textContent = 'Sincronizando…';
    return obtenerDatosGoogle(url, token)
      .then(function (datos) {
        if (datos.error) throw new Error(datos.error);
        var n = fusionar(datos.movimientos || []);
        if (datos.tipoCambio) estado.ajustes.tipoCambio = datos.tipoCambio;
        if (datos.diaCorte > 0) estado.ajustes.diaCorte = datos.diaCorte;
        // La hoja manda en el presupuesto (incluye categorías propias como "Familia …")
        if (datos.presupuestos && Object.keys(datos.presupuestos).length) {
          estado.presupuestos = Object.assign({}, datos.presupuestos);
          renderPresupuesto();
        }
        estado.ajustes.ultimaSync = new Date().toISOString();
        estado.ajustes.errorSync = '';
        guardar(); render(); renderDatos();
        if (n && silencioso) aviso(n === 1 ? '1 movimiento nuevo del banco.' : n + ' movimientos nuevos del banco.');
        if (!silencioso) aviso(n ? n + ' movimientos nuevos.' : 'Todo al día.');
      })
      .catch(function (err) {
        estado.ajustes.errorSync = err.message || String(err);
        guardar(); renderEstadoSync();
        if (!silencioso) aviso('No se pudo sincronizar.');
      })
      .then(function () { sincronizando = false; });
  }

  function haceCuanto(iso) {
    var min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (min < 1) return 'hace un momento';
    if (min < 60) return 'hace ' + min + ' min';
    var h = Math.round(min / 60);
    return h < 24 ? 'hace ' + h + ' h' : new Date(iso).toLocaleString('es-CR');
  }

  function renderEstadoSync() {
    var a = estado.ajustes;
    var txt = '';
    if (a.errorSync) {
      var url = esc(a.url), tok = encodeURIComponent(a.token || '');
      $('#sync-estado').innerHTML = '❌ No se pudo sincronizar: ' + esc(a.errorSync) +
        '<br>Revise: (1) la URL termina en <b>/exec</b>; (2) la implementación tiene acceso ' +
        '<b>“Cualquier persona”</b>; (3) si cambió el código, cree una <b>versión nueva</b> de la implementación. ' +
        'Prueba rápida: abra <a target="_blank" rel="noopener" href="' + url + '?token=' + tok +
        '">este enlace</a>; debería mostrar texto que empieza con {"generado".';
    } else {
      if (a.ultimaSync) txt = '✅ Sincronizado ' + haceCuanto(a.ultimaSync) + '. Se actualiza sola cada 15 minutos mientras la app está abierta.';
      else if (a.url && a.token) txt = 'Se sincroniza sola al abrir la app y cada 15 minutos.';
      $('#sync-estado').textContent = txt;
    }
    var ind = $('#sync-indicador');
    if (ind) {
      ind.hidden = !(a.url && a.token);
      ind.textContent = a.errorSync ? '⚠️ Sin sincronizar' : (a.ultimaSync ? '🔄 ' + haceCuanto(a.ultimaSync) : '🔄');
      ind.title = a.errorSync ? 'Error al sincronizar: ' + a.errorSync : 'Toque para sincronizar ahora';
    }
  }

  function sincronizarSiHaceFalta() {
    var ultima = Date.parse(estado.ajustes.ultimaSync || 0) || 0;
    if (document.visibilityState === 'visible' && Date.now() - ultima > 5 * 60 * 1000) sincronizar(true);
  }

  document.addEventListener('visibilitychange', sincronizarSiHaceFalta);
  setInterval(function () { if (document.visibilityState === 'visible') sincronizar(true); }, CADA_MS);
  setInterval(renderEstadoSync, 60 * 1000);

  /** Pide los datos a Apps Script: primero con fetch y, si el navegador lo bloquea, con JSONP. */
  function obtenerDatosGoogle(url, token) {
    var base = url + (url.indexOf('?') < 0 ? '?' : '&') + 'token=' + encodeURIComponent(token);
    return fetch(base)
      .then(function (r) { return r.json(); })
      .catch(function () { return jsonp(base); });
  }

  function jsonp(url) {
    return new Promise(function (resolve, reject) {
      var nombre = 'presupuestoCb' + Date.now();
      var s = document.createElement('script');
      var fin = function () { delete window[nombre]; s.remove(); clearTimeout(t); };
      var t = setTimeout(function () { fin(); reject(new Error('Google no respondió')); }, 20000);
      window[nombre] = function (datos) { fin(); resolve(datos); };
      s.onerror = function () {
        fin();
        reject(new Error('Google rechazó la solicitud (acceso de la implementación o código desactualizado)'));
      };
      s.src = url + '&callback=' + nombre;
      document.head.appendChild(s);
    });
  }

  $('#tipo-cambio').addEventListener('change', function (e) {
    var v = parseFloat(e.target.value);
    if (v > 0) { estado.ajustes.tipoCambio = v; guardar(); render(); aviso('Tipo de cambio actualizado.'); }
  });

  $('#dia-corte').addEventListener('change', function (e) {
    var v = parseInt(e.target.value, 10);
    if (v >= 0 && v <= 31) {
      estado.ajustes.diaCorte = v;
      guardar(); render(); aviso(v ? 'Mes de corte: del ' + (v + 1) + ' al ' + v + ' de cada mes.' : 'Sin día de corte: el mes de corte será el mes calendario.');
    }
  });

  $('#archivo').addEventListener('change', function (e) {
    var archivo = e.target.files[0];
    if (!archivo) return;
    archivo.text().then(function (txt) {
      var datos = JSON.parse(txt);
      var movs = Array.isArray(datos) ? datos : (datos.movimientos || []);
      var n = fusionar(movs);
      if (datos.presupuestos) estado.presupuestos = Object.assign(estado.presupuestos, datos.presupuestos);
      if (datos.reglas) estado.reglas = Object.assign(estado.reglas, datos.reglas);
      if (datos.tipoCambio) estado.ajustes.tipoCambio = datos.tipoCambio;
      if (datos.diaCorte != null) estado.ajustes.diaCorte = datos.diaCorte;
      if (Array.isArray(datos.estadosBancarios)) {
        datos.estadosBancarios.forEach(function (eb) { guardarEstadoBancario(eb); });
      }
      if (Array.isArray(datos.estadosCuenta)) {
        datos.estadosCuenta.forEach(function (ec) { guardarEstadoCuenta(ec); });
      }
      estado.mes = '';
      guardar(); render(); renderPresupuesto(); renderDatos();
      aviso('Importados ' + n + ' movimientos nuevos.');
    }).catch(function (err) { aviso('Archivo inválido: ' + err.message); });
    e.target.value = '';
  });

  $('#btn-exportar-json').addEventListener('click', function () {
    var respaldo = {
      exportado: new Date().toISOString(),
      movimientos: estado.movimientos,
      presupuestos: estado.presupuestos,
      reglas: estado.reglas,
      tipoCambio: estado.ajustes.tipoCambio,
      diaCorte: diaCorte(),
      estadosCuenta: estado.estadosCuenta,
      estadosBancarios: estado.estadosBancarios
    };
    descargar('presupuesto-respaldo-' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify(respaldo, null, 2), 'application/json');
  });

  $('#btn-exportar-csv').addEventListener('click', function () {
    var cols = ['fecha', 'mesCalendario', 'mesCorte', 'tipo', 'categoria', 'descripcion', 'monto', 'moneda', 'montoCRC', 'tarjeta', 'fuente'];
    var tc = estado.ajustes.tipoCambio;
    var filas = [cols.join(',')].concat(estado.movimientos.map(function (m) {
      var fila = Object.assign({}, m, {
        montoCRC: Math.round(P.aColones(m, tc) * 100) / 100,
        mesCorte: P.nombreMesCorte(P.periodoMovimiento(m, diaCorte()), diaCorte()),
        mesCalendario: nombreMes(mesDeFecha(m.fecha))
      });
      return cols.map(function (c) { return '"' + String(fila[c] == null ? '' : fila[c]).replace(/"/g, '""') + '"'; }).join(',');
    }));
    descargar('movimientos.csv', '﻿' + filas.join('\n'), 'text/csv');
  });

  $('#btn-borrar').addEventListener('click', function () {
    if (!confirm('Esto borra todos los movimientos, reglas y presupuesto de este navegador. ¿Continuar?')) return;
    estado = estadoInicial();
    guardar(); render(); renderPresupuesto(); renderDatos();
  });

  // ------------------------------------------------------------ Estado de cuenta (PDF)

  var pdfPendiente = null;   // archivo esperando contraseña
  var ecActual = '';         // clave del estado de cuenta mostrado

  function cargarPdfJs() {
    if (!cargarPdfJs.promesa) {
      var base = new URL('vendor/pdfjs/', document.baseURI).href;
      cargarPdfJs.promesa = import(base + 'pdf.min.mjs').then(function (pdfjs) {
        pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
        return pdfjs;
      });
    }
    return cargarPdfJs.promesa;
  }

  /** Lee el PDF y devuelve sus fragmentos de texto con su posición. */
  function leerItemsPdf(archivo, clave) {
    return Promise.all([cargarPdfJs(), archivo.arrayBuffer()]).then(function (r) {
      var pdfjs = r[0];
      return pdfjs.getDocument({ data: new Uint8Array(r[1]), password: clave || '' }).promise;
    }).then(function (doc) {
      var paginas = [];
      for (var n = 1; n <= doc.numPages; n++) paginas.push(n);
      return Promise.all(paginas.map(function (n) {
        return doc.getPage(n).then(function (p) { return p.getTextContent(); }).then(function (tc) {
          return tc.items.map(function (it) {
            return { pagina: n, str: it.str, x: it.transform[4], y: it.transform[5], ancho: it.width };
          });
        });
      }));
    }).then(function (porPagina) {
      return [].concat.apply([], porPagina);
    });
  }

  function guardarEstadoBancario(eb) {
    estado.estadosBancarios = estado.estadosBancarios.filter(function (x) {
      return !(x.clave === eb.clave && x.cuenta === eb.cuenta && x.moneda === eb.moneda);
    });
    estado.estadosBancarios.push(eb);
    estado.estadosBancarios.sort(function (a, b) { return a.clave < b.clave ? 1 : (a.clave > b.clave ? -1 : (a.moneda < b.moneda ? -1 : 1)); });
  }

  function guardarEstadoCuenta(ec) {
    estado.estadosCuenta = estado.estadosCuenta.filter(function (x) {
      return !(x.clave === ec.clave && x.tarjetas.map(function (t) { return t.tarjeta; }).join() ===
        ec.tarjetas.map(function (t) { return t.tarjeta; }).join());
    });
    estado.estadosCuenta.push(ec);
    estado.estadosCuenta.sort(function (a, b) { return a.clave < b.clave ? 1 : -1; });
  }

  function procesarPdf(archivo, clave) {
    $('#ec-estado').textContent = 'Leyendo el estado de cuenta…';
    leerItemsPdf(archivo, clave).then(function (items) {
      var ec = P.parsearEstadoCuenta(P.agruparFilas(items));
      if (!ec.tarjetas.length || !ec.fechaCorte) {
        var eb = P.parsearEstadoBancario(items);
        if (!eb.fechaCorte || !eb.lineas.length) {
          throw new Error('No se reconoció un estado de cuenta de BAC (tarjeta o cuenta bancaria) en este PDF.');
        }
        eb.importado = new Date().toISOString();
        guardarEstadoBancario(eb);
        ebActual = ebClave(eb);
        pdfPendiente = null;
        $('#ec-clave-envoltura').hidden = true;
        $('#ec-clave').value = '';
        guardar(); render();
        var conc = P.conciliarBanco(eb, estado.movimientos, opcionesBanco());
        $('#ec-estado').textContent = '✅ ' + eb.nombre + ' leída: ' + eb.lineas.length + ' movimientos' +
          (conc.resumen.cuadra ? ', cuadra con los totales del banco.' : '. ⚠️ No cuadra con los totales del banco: revise.');
        var sec = $('#eb-resultado');
        if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      ec.importado = new Date().toISOString();
      guardarEstadoCuenta(ec);
      ecActual = ec.clave;
      pdfPendiente = null;
      $('#ec-clave-envoltura').hidden = true;
      $('#ec-clave').value = '';

      var dia = +ec.fechaCorte.slice(8, 10);
      var msj = '✅ Estado ' + ec.mesEstado + ' leído: ' + ec.tarjetas.length + ' tarjeta(s), corte ' +
        ec.fechaCorte.split('-').reverse().join('/') + '.';
      if (diaCorte() !== dia) {
        estado.ajustes.diaCorte = dia;
        msj += ' Día de corte ajustado a ' + dia + ': el mes de corte de cada movimiento va del ' + (dia + 1) + ' al ' + dia + '.';
      }
      guardar(); render(); renderDatos();
      $('#ec-estado').textContent = msj;
    }).catch(function (err) {
      if (err && err.name === 'PasswordException') {
        pdfPendiente = archivo;
        $('#ec-clave-envoltura').hidden = false;
        $('#ec-estado').textContent = clave ? '❌ Contraseña incorrecta.' : 'Este PDF tiene contraseña. Escríbala y presione Enter.';
        $('#ec-clave').focus();
        return;
      }
      $('#ec-estado').textContent = '❌ ' + (err && err.message || err);
    });
  }

  function fmtMoneda(n, moneda) { return moneda === 'USD' ? fmtUSD.format(n || 0) : crc(n); }
  function fmtDoble(v) {
    return crc(v.CRC) + (v.USD ? ' + ' + fmtUSD.format(v.USD) : '');
  }
  function fechaCorta(f) { return String(f).slice(0, 10).split('-').reverse().slice(0, 2).join('/'); }

  function renderEstadoCuenta() {
    var cont = $('#ec-resultado');
    var lista = estado.estadosCuenta;
    $('#ec-selector-envoltura').hidden = !lista.length;
    if (!lista.length) { cont.innerHTML = ''; return; }
    if (!ecActual || !lista.some(function (x) { return x.clave === ecActual; })) ecActual = lista[0].clave;
    $('#ec-selector').innerHTML = lista.map(function (x) {
      return '<option value="' + x.clave + '"' + (x.clave === ecActual ? ' selected' : '') + '>' +
        esc(x.mesEstado) + ' · ' + esc(P.etiquetaPeriodo(x.clave, +x.fechaCorte.slice(8, 10))) + '</option>';
    }).join('');

    var ec = lista.filter(function (x) { return x.clave === ecActual; })[0];
    var c = P.conciliar(ec, estado.movimientos);
    var tc = estado.ajustes.tipoCambio;
    var aCRC = function (monto, moneda) { return moneda === 'USD' ? monto * tc : monto; };

    // Gasto según el estado, por categoría (usa la categoría del movimiento si ya está en la app)
    var porCat = {};
    c.coinciden.forEach(function (x) {
      var cat = x.movimiento.categoria || 'Otros';
      porCat[cat] = (porCat[cat] || 0) + (x.cargo.esCredito ? -1 : 1) * aCRC(x.cargo.monto, x.cargo.moneda);
    });
    c.soloEstado.forEach(function (x) {
      var cat = P.categorizar({ tipo: 'gasto', comercio: x.cargo.comercio, descripcion: x.cargo.descripcion }, estado.reglas);
      x.categoria = cat;
      porCat[cat] = (porCat[cat] || 0) + (x.cargo.esCredito ? -1 : 1) * aCRC(x.cargo.monto, x.cargo.moneda);
    });
    var totalEstado = Object.keys(porCat).reduce(function (s, k) { return s + porCat[k]; }, 0);
    var rApp = P.resumenMes(estado.movimientos, ec.clave, opcionesCorte());

    var html = '';

    // Tarjetas
    html += '<div class="tarjeta"><h2>' + esc(ec.mesEstado) + ' <small>periodo ' +
      esc(P.etiquetaPeriodo(ec.clave, +ec.fechaCorte.slice(8, 10))) + '</small></h2>' +
      '<div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Tarjeta</th><th class="num">Compras</th>' +
      '<th class="num">Otros cargos</th><th class="num">Pago de contado</th><th>Fecha límite</th></tr></thead><tbody>' +
      ec.tarjetas.map(function (t) {
        return '<tr><td>' + esc(t.marca) + ' ' + esc(t.tarjeta) + '</td><td class="num">' + fmtDoble(t.totales.compras) +
          '</td><td class="num">' + fmtDoble(t.totales.otrosCargos) + '</td><td class="num"><b>' + fmtDoble(t.pagoContado) +
          '</b></td><td>' + (t.fechaLimitePago ? fechaCorta(t.fechaLimitePago) : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    var intereses = ec.tarjetas.filter(function (t) { return t.totales.interesesPeriodo.CRC || t.totales.interesesPeriodo.USD; });
    if (intereses.length) {
      html += '<p class="ayuda">💡 Intereses del periodo: ' + intereses.map(function (t) {
        return t.tarjeta + ': ' + fmtDoble(t.totales.interesesPeriodo);
      }).join(' · ') + '. BAC los reversa si paga el <b>pago de contado</b> completo antes de la fecha límite.</p>';
    }
    html += '</div>';

    // KPIs de conciliación
    html += '<div class="kpis">' +
      kpi('Cargos en el estado', fmtDoble(c.resumen.cargosEstado), '', (c.coinciden.length + c.soloEstado.length) + ' cargos') +
      kpi('Ya registrados en la app', fmtDoble(c.resumen.coinciden), 'pos', c.coinciden.length + ' coinciden') +
      kpi('Faltan en su presupuesto', fmtDoble(c.resumen.soloEstado), c.soloEstado.length ? 'neg' : 'pos', c.soloEstado.length + ' cargos sin correo') +
      kpi('Compras para el próximo estado', fmtDoble(c.resumen.soloApp), '', c.soloApp.length + ' compras con tarjeta') +
      '</div>';

    // Comparación con el presupuesto
    var filasCat = Object.keys(porCat).sort(function (a, b) { return porCat[b] - porCat[a]; });
    html += '<div class="tarjeta"><h2>Estado de cuenta vs. presupuesto <small>por categoría, en colones</small></h2>' +
      '<div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Categoría</th><th class="num">Según estado</th>' +
      '<th class="num">Presupuesto</th><th class="num">Diferencia</th></tr></thead><tbody>' +
      filasCat.map(function (k) {
        var pres = estado.presupuestos[k] || 0;
        var dif = pres - porCat[k];
        return '<tr><td>' + P.iconoDe(k) + ' ' + esc(k) + '</td><td class="num">' + crc(porCat[k]) + '</td><td class="num">' +
          (pres ? crc(pres) : '—') + '</td><td class="num ' + (pres ? (dif >= 0 ? 'pos' : 'neg') : '') + '">' +
          (pres ? (dif >= 0 ? '' : '−') + crc(Math.abs(dif)) : '') + '</td></tr>';
      }).join('') +
      '<tr><td><b>Total tarjetas</b></td><td class="num"><b>' + crc(totalEstado) + '</b></td><td class="num"><b>' +
      crc(rApp.presupuestoTotal) + '</b></td><td></td></tr></tbody></table></div>' +
      '<p class="ayuda">Gastos del periodo registrados en la app (todas las fuentes): <b>' + crc(rApp.gastos) +
      '</b>. US$ a ₡' + tc + '.</p></div>';

    // Faltan en la app
    if (c.soloEstado.length) {
      html += '<div class="tarjeta"><h2>Cargos del estado que no están en su presupuesto</h2>' +
        '<p class="ayuda">Son cargos que no llegaron por correo (peajes, servicios domiciliados, IVA de servicios digitales…). ' +
        'Marque los que quiere agregar.</p><div class="tabla-envoltura"><table class="tabla"><thead><tr>' +
        '<th><input type="checkbox" id="ec-todos" checked aria-label="Seleccionar todos"></th><th>Fecha</th><th>Descripción</th>' +
        '<th>Categoría</th><th class="num">Monto</th></tr></thead><tbody>' +
        c.soloEstado.map(function (x) {
          return '<tr><td><input type="checkbox" class="ec-sel" value="' + esc(x.cargo.id) + '" checked></td><td>' +
            fechaCorta(x.cargo.fecha) + '</td><td class="desc">' + esc(x.cargo.comercio) + '<small>' + esc(x.cargo.tarjeta) +
            ' · ' + esc(x.cargo.seccion) + '</small></td><td>' + P.iconoDe(x.categoria) + ' ' + esc(x.categoria) +
            '</td><td class="num ' + (x.cargo.esCredito ? 'pos' : 'neg') + '">' + (x.cargo.esCredito ? '+ ' : '− ') +
            fmtMoneda(x.cargo.monto, x.cargo.moneda) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }

    // En la app pero no en el estado
    if (c.soloApp.length) {
      html += '<div class="tarjeta"><h2>Compras con tarjeta que no están en este estado</h2><div class="tabla-envoltura"><table class="tabla">' +
        '<thead><tr><th>Fecha</th><th>Descripción</th><th class="num">Monto</th><th>Qué significa</th></tr></thead><tbody>' +
        c.soloApp.map(function (x) {
          var m = x.movimiento;
          return '<tr><td>' + fechaCorta(m.fecha) + '</td><td class="desc">' + esc(m.comercio || m.descripcion) +
            '<small>' + esc(m.tarjeta || '') + '</small></td><td class="num">' + montoOriginal(m) + '</td><td>' +
            (x.proximoEstado ? '⏭️ Compra cerca del corte: saldrá en el próximo estado' :
              '🔎 Revise: ¿se anuló, fue con otra tarjeta o es un cobro duplicado?') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }

    // Pagos
    var pagos = c.pagos;
    if (pagos.length) {
      html += '<div class="tarjeta"><h2>Pagos a la tarjeta en el periodo</h2><div class="tabla-envoltura"><table class="tabla">' +
        '<thead><tr><th>Fecha</th><th>Tarjeta</th><th class="num">Monto</th><th>Transferencia en la app</th></tr></thead><tbody>' +
        pagos.map(function (x) {
          return '<tr><td>' + fechaCorta(x.pago.fecha) + '</td><td>' + esc(x.tarjeta) + '</td><td class="num">' +
            fmtMoneda(x.pago.monto, x.pago.moneda) + '</td><td>' +
            (x.transferencia ? '✅ ' + esc(x.transferencia.descripcion) + ' del ' + fechaCorta(x.transferencia.fecha) : '—') +
            '</td></tr>';
        }).join('') + '</tbody></table></div><p class="ayuda">Los pagos a la tarjeta no son gasto: el gasto son las compras.</p></div>';
    }

    html += '<div class="tarjeta"><button id="ec-aplicar" class="primario">Aplicar conciliación</button>' +
      '<p class="ayuda">Agrega los cargos marcados y asigna cada movimiento al periodo del estado de cuenta, ' +
      'para que el resumen de ese periodo cuadre con el banco. Las compras cerca del corte pasan al periodo siguiente.</p>' +
      '<button id="ec-borrar" class="peligro">Quitar este estado de cuenta</button></div>';

    cont.innerHTML = html;
    cont._conciliacion = { ec: ec, c: c };
  }

  function kpi(etiqueta, valor, clase, sub) {
    return '<div class="kpi"><div class="etiqueta">' + etiqueta + '</div><div class="valor ' + clase + '">' + valor +
      '</div><div class="sub">' + esc(sub) + '</div></div>';
  }

  $('#ec-archivo').addEventListener('change', function (e) {
    var archivo = e.target.files[0];
    if (archivo) procesarPdf(archivo, '');
    e.target.value = '';
  });
  $('#ec-clave').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && pdfPendiente) { e.preventDefault(); procesarPdf(pdfPendiente, e.target.value); }
  });
  $('#ec-selector').addEventListener('change', function (e) { ecActual = e.target.value; renderEstadoCuenta(); });
  $('#ec-resultado').addEventListener('change', function (e) {
    if (e.target.id === 'ec-todos') {
      document.querySelectorAll('.ec-sel').forEach(function (x) { x.checked = e.target.checked; });
    }
  });
  $('#ec-resultado').addEventListener('click', function (e) {
    var datos = $('#ec-resultado')._conciliacion;
    if (!datos) return;
    if (e.target.id === 'ec-aplicar') {
      var ids = Array.prototype.map.call(document.querySelectorAll('.ec-sel:checked'), function (x) { return x.value; });
      var r = P.aplicarConciliacion(datos.ec, datos.c, estado.movimientos, ids, estado.reglas);
      estado.movimientos = r.movimientos.sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
      guardar(); render();
      aviso('Listo: ' + r.agregados + ' cargos agregados, ' + r.asignados + ' movimientos asignados al periodo' +
        (r.movidos ? ', ' + r.movidos + ' pasan al siguiente' : '') + '.');
    } else if (e.target.id === 'ec-borrar' && confirm('¿Quitar este estado de cuenta? Los movimientos ya agregados se mantienen.')) {
      estado.estadosCuenta = estado.estadosCuenta.filter(function (x) { return x !== datos.ec; });
      ecActual = '';
      guardar(); render();
    }
  });

  // ------------------------------------------------------------ Estado de cuenta bancario (PDF)

  var ebActual = '';         // clave del estado bancario mostrado: 'YYYY-MM|moneda|cuenta'
  // Elecciones antes de aplicar, por línea; sobreviven a los re-render (p. ej. la sincronización automática)
  var ebElecciones = {};     // id de línea -> categoría elegida
  var ebOmitidos = {};       // id de línea -> true si se desmarcó

  function ebClave(eb) { return eb.clave + '|' + eb.moneda + '|' + eb.cuenta; }
  /** Últimos 4 dígitos de las tarjetas de crédito conocidas (sus compras no salen de la cuenta). */
  function tarjetasCredito() {
    var t = {};
    estado.estadosCuenta.forEach(function (ec) { ec.tarjetas.forEach(function (x) { t[x.tarjeta] = true; }); });
    return Object.keys(t);
  }
  function opcionesBanco() { return { reglas: estado.reglas, tarjetasCredito: tarjetasCredito() }; }

  function renderEstadoBancario() {
    var cont = $('#eb-resultado');
    var lista = estado.estadosBancarios;
    if (!lista.length) { cont.innerHTML = ''; cont._conciliacion = null; return; }
    if (!ebActual || !lista.some(function (x) { return ebClave(x) === ebActual; })) ebActual = ebClave(lista[0]);
    var eb = lista.filter(function (x) { return ebClave(x) === ebActual; })[0];
    var c = P.conciliarBanco(eb, estado.movimientos, opcionesBanco());
    var m$ = function (n) { return fmtMoneda(n, eb.moneda); };

    var html = '<div class="tarjeta"><h2>Cuentas bancarias</h2>';
    if (lista.length > 1) {
      html += '<label class="formulario-linea">Estado mostrado <select id="eb-selector">' + lista.map(function (x) {
        return '<option value="' + esc(ebClave(x)) + '"' + (ebClave(x) === ebActual ? ' selected' : '') + '>' + esc(x.nombre) + '</option>';
      }).join('') + '</select></label>';
    }
    html += '<h2 class="mt">' + esc(eb.nombre) + ' <small>corte ' + fechaCorta(eb.fechaCorte) + '/' + eb.fechaCorte.slice(0, 4) + '</small></h2>' +
      '<div class="tabla-envoltura"><table class="tabla"><tbody>' +
      '<tr><td>Saldo anterior</td><td class="num">' + m$(eb.saldoAnterior) + '</td></tr>' +
      '<tr><td>+ Entradas (créditos)</td><td class="num pos">' + m$(c.resumen.creditos) + '</td></tr>' +
      '<tr><td>− Salidas (débitos)</td><td class="num neg">' + m$(c.resumen.debitos) + '</td></tr>' +
      '<tr><td><b>Saldo al corte</b></td><td class="num"><b>' + m$(eb.saldoFinal) + '</b></td></tr>' +
      '</tbody></table></div><p class="ayuda">' + (c.resumen.cuadra
        ? '✅ Cuadra con el cuadro resumen del banco (' + eb.lineas.length + ' movimientos).'
        : '⚠️ La suma de los movimientos no cuadra con el cuadro resumen del banco: revise el PDF.') + '</p></div>';

    html += '<div class="kpis">' +
      kpi('Entradas a la cuenta', m$(c.resumen.creditos), 'pos', 'salario, transferencias recibidas…') +
      kpi('Salidas de la cuenta', m$(c.resumen.debitos), 'neg', 'pagos de tarjeta, transferencias, servicios…') +
      kpi('Ya registrados en la app', m$(c.resumen.coincidenCreditos + c.resumen.coincidenDebitos), 'pos', c.coinciden.length + ' coinciden') +
      kpi('Faltan en su presupuesto', m$(c.resumen.soloBancoCreditos + c.resumen.soloBancoDebitos), c.soloBanco.length ? 'neg' : 'pos',
        c.soloBanco.length + ' movimientos sin correo') +
      '</div>';

    // Entradas y salidas por categoría
    var nota = { 'transferencia': 'no suma al gasto', 'gasto': 'gasto', 'ingreso': 'ingreso' };
    html += '<div class="tarjeta"><h2>Entradas y salidas por tipo</h2><div class="tabla-envoltura"><table class="tabla">' +
      '<thead><tr><th>Categoría</th><th>Cómo cuenta</th><th class="num">Mov.</th><th class="num">Entradas</th><th class="num">Salidas</th></tr></thead><tbody>' +
      c.porCategoria.map(function (x) {
        var como = P.esCategoriaAhorro(x.categoria) ? 'ahorro' : nota[x.tipo] || x.tipo;
        return '<tr><td>' + P.iconoDe(x.categoria) + ' ' + esc(x.categoria) + '</td><td class="ayuda">' + esc(como) + '</td><td class="num">' +
          x.cantidad + '</td><td class="num pos">' + (x.entrada ? m$(x.total) : '') + '</td><td class="num neg">' +
          (x.entrada ? '' : m$(x.total)) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="ayuda">Los SINPE y transferencias enviados son gasto (categoría "SINPE y transferencias" si no hay una más ' +
      'precisa). Los pagos de tarjeta no lo son: el gasto son las compras de la tarjeta. En <b>Movimientos</b> puede darle ' +
      'otra categoría a un SINPE o marcarlo como "No es gasto"; la app recordará ese destinatario.</p></div>';

    if (c.duplicados.length) {
      html += c.duplicados.map(function (d) {
        return '<div class="alerta">⚠️ Posible cobro duplicado: ' + esc(d[0].concepto) + ' por ' + m$(d[0].monto) + ' el ' +
          fechaCorta(d[0].fecha) + ' y el ' + fechaCorta(d[1].fecha) + '.</div>';
      }).join('');
    }

    // Movimientos que faltan
    if (c.soloBanco.length) {
      html += '<div class="tarjeta"><h2>Movimientos de la cuenta que no están en su presupuesto</h2>' +
        '<p class="ayuda">No llegaron por correo. Antes de aplicar, elija el rubro del presupuesto de cada uno (p. ej. un SINPE ' +
        'por huevos → Supermercado) o márquelo en "No es gasto" si es a una cuenta suya. La app recuerda el destinatario para los ' +
        'próximos meses y aplica la misma categoría a los demás envíos a ese destinatario en esta lista.</p>' +
        '<div class="tabla-envoltura"><table class="tabla"><thead><tr>' +
        '<th><input type="checkbox" id="eb-todos" checked aria-label="Seleccionar todos"></th><th>Fecha</th><th>Descripción</th>' +
        '<th>Categoría</th><th class="num">Monto</th></tr></thead><tbody>' +
        c.soloBanco.map(function (x) {
          var l = x.linea, s = x.sugerencia;
          var cat = ebElecciones[l.id] || s.categoria;
          var opts = opcionesCategoria({ tipo: P.tipoSegunCategoria(s.tipo, cat), categoria: cat });
          return '<tr><td><input type="checkbox" class="eb-sel" value="' + esc(l.id) + '"' + (ebOmitidos[l.id] ? '' : ' checked') +
            '></td><td>' + fechaCorta(l.fecha) +
            '</td><td class="desc">' + esc(s.descripcion) + '<small>' + esc(l.concepto) + ' · ref. ' + esc(l.referencia) + '</small></td><td>' +
            '<select class="eb-cat" data-id="' + esc(l.id) + '" data-clave="' + esc(P.claveComercio(s.comercio)) + '" data-entrada="' +
            (l.esCredito ? '1' : '') + '" aria-label="Categoría">' + opts + '</select>' +
            '</td><td class="num ' + (l.esCredito ? 'pos' : 'neg') + '">' + (l.esCredito ? '+ ' : '− ') + m$(l.monto) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }

    if (c.coinciden.length) {
      html += '<div class="tarjeta"><h2>Ya registrados en la app</h2><div class="tabla-envoltura"><table class="tabla">' +
        '<thead><tr><th>Fecha</th><th>En el estado</th><th>En la app</th><th class="num">Monto</th></tr></thead><tbody>' +
        c.coinciden.map(function (x) {
          var mv = x.movimiento, s = x.sugerencia;
          var cambia = !mv.editado && !mv.tarjeta && (mv.categoria === 'SINPE y transferencias' ||
            mv.categoria === P.CATEGORIA_TRANSFERENCIA_ANTERIOR) && s.categoria !== 'SINPE y transferencias' &&
            (s.tipo !== mv.tipo || s.categoria !== mv.categoria);
          return '<tr><td>' + fechaCorta(x.linea.fecha) + '</td><td class="desc">' + esc(s.descripcion) + '</td><td class="desc">✅ ' +
            esc(mv.descripcion) + '<small>' + P.iconoDe(mv.categoria) + ' ' + esc(mv.categoria) +
            (cambia ? ' → ' + esc(s.categoria) + ' al aplicar' : '') + '</small></td><td class="num ' + (x.linea.esCredito ? 'pos' : 'neg') + '">' +
            (x.linea.esCredito ? '+ ' : '− ') + m$(x.linea.monto) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }

    html += '<div class="tarjeta"><button id="eb-aplicar" class="primario">Aplicar conciliación</button>' +
      '<p class="ayuda">Agrega los movimientos marcados con la categoría elegida y vincula los que ya estaban. Un SINPE de correo que el banco ' +
      'identifica como pago de tarjeta o traslado a ahorros toma esa categoría.</p>' +
      '<button id="eb-borrar" class="peligro">Quitar este estado de cuenta</button></div>';

    cont.innerHTML = html;
    cont._conciliacion = { eb: eb, c: c };
  }

  $('#eb-resultado').addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'eb-todos') {
      document.querySelectorAll('.eb-sel').forEach(function (x) {
        x.checked = t.checked;
        if (t.checked) delete ebOmitidos[x.value]; else ebOmitidos[x.value] = true;
      });
    } else if (t.classList.contains('eb-sel')) {
      if (t.checked) delete ebOmitidos[t.value]; else ebOmitidos[t.value] = true;
    } else if (t.classList.contains('eb-cat')) {
      // La misma categoría para los demás envíos a ese destinatario (p. ej. todos los SINPE "Huevos")
      var otros = 0;
      ebElecciones[t.dataset.id] = t.value;
      if (!esComercioGenerico(t.dataset.clave)) {
        document.querySelectorAll('.eb-cat').forEach(function (x) {
          if (x === t || x.dataset.clave !== t.dataset.clave || x.dataset.entrada !== t.dataset.entrada) return;
          if (!Array.prototype.some.call(x.options, function (o) { return o.value === t.value; })) return;
          x.value = t.value;
          ebElecciones[x.dataset.id] = t.value;
          otros++;
        });
      }
      if (otros) aviso('También se asignó ' + t.value + ' a ' + otros + ' movimiento(s) del mismo destinatario.');
    } else if (t.id === 'eb-selector') {
      ebActual = e.target.value; renderEstadoBancario();
    }
  });
  $('#eb-resultado').addEventListener('click', function (e) {
    var datos = $('#eb-resultado')._conciliacion;
    if (!datos) return;
    if (e.target.id === 'eb-aplicar') {
      var ids = Array.prototype.map.call(document.querySelectorAll('.eb-sel:checked'), function (x) { return x.value; });
      // Recordar el destinatario de las categorías elegidas a mano, para los próximos estados de cuenta
      datos.c.soloBanco.forEach(function (x) {
        var cat = ebElecciones[x.linea.id];
        var clave = P.claveComercio(x.sugerencia.comercio);
        if (cat && cat !== x.sugerencia.categoria && ids.indexOf(x.linea.id) >= 0 && !esComercioGenerico(clave)) {
          estado.reglas[clave] = cat;
        }
      });
      var r = P.aplicarConciliacionBanco(datos.eb, datos.c, estado.movimientos, ids, ebElecciones);
      ebElecciones = {};
      ebOmitidos = {};
      estado.movimientos = r.movimientos.sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
      guardar(); render();
      aviso('Listo: ' + r.agregados + ' movimientos agregados, ' + r.vinculados + ' vinculados' +
        (r.reclasificados ? ', ' + r.reclasificados + ' reclasificados' : '') + '.');
    } else if (e.target.id === 'eb-borrar' && confirm('¿Quitar este estado de cuenta? Los movimientos ya agregados se mantienen.')) {
      estado.estadosBancarios = estado.estadosBancarios.filter(function (x) { return x !== datos.eb; });
      ebActual = '';
      guardar(); render();
    }
  });

  var indicador = $('#sync-indicador');
  if (indicador) indicador.addEventListener('click', function () { sincronizar(false); });

  // ------------------------------------------------------------ Inicio

  render();
  renderPresupuesto();
  renderFormManual();
  renderDatos();
  renderEstadoSync();
  sincronizar(true);
})();
