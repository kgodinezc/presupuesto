/* Presupuesto Familiar — interfaz web (sin dependencias). */
(function () {
  'use strict';

  var P = window.Presupuesto;
  var CLAVE = 'presupuesto-familiar:v1';

  // ------------------------------------------------------------ Estado

  var estado = cargar();

  function estadoInicial() {
    return {
      movimientos: [],
      presupuestos: P.presupuestosPredeterminados(),
      reglas: {},
      ajustes: { tipoCambio: 505, url: '', token: '' },
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
  function nombreMes(mes) {
    var partes = mes.split('-');
    var d = new Date(+partes[0], +partes[1] - 1, 1);
    var s = d.toLocaleDateString('es-CR', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function opciones() { return { tipoCambio: estado.ajustes.tipoCambio, presupuestos: estado.presupuestos }; }
  function categoriasPara(tipo) {
    if (tipo === 'ingreso') return P.CATEGORIAS_INGRESO;
    if (tipo === 'transferencia') return [P.CATEGORIA_TRANSFERENCIA];
    return P.CATEGORIAS_GASTO.map(function (c) { return c.nombre; });
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
    return nuevos;
  }

  function cambiarCategoria(id, categoria, recordar) {
    var mov = estado.movimientos.find(function (m) { return m.id === id; });
    if (!mov) return;
    mov.categoria = categoria;
    mov.editado = true;
    if (recordar && mov.comercio && mov.tipo !== 'transferencia') {
      var clave = P.claveComercio(mov.comercio);
      estado.reglas[clave] = categoria;
      var otros = 0;
      estado.movimientos.forEach(function (m) {
        if (m !== mov && m.tipo === mov.tipo && P.claveComercio(m.comercio) === clave) {
          m.categoria = categoria; m.editado = true; otros++;
        }
      });
      if (otros) aviso('También se actualizaron ' + otros + ' movimientos de ' + mov.comercio + '.');
    }
    guardar();
    render();
  }

  // ------------------------------------------------------------ Render: Resumen

  function renderMeses() {
    var meses = P.mesesDisponibles(estado.movimientos);
    var hoy = new Date();
    var actual = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0');
    if (meses.indexOf(actual) < 0) meses.unshift(actual);
    if (!estado.mes || meses.indexOf(estado.mes) < 0) {
      estado.mes = P.mesesDisponibles(estado.movimientos)[0] || actual;
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
    if (r.transferencias) kpis.push({ e: 'Transferencias enviadas', v: crc(r.transferencias), c: '', s: 'No se suman al gasto: revíselas' });
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

    renderTendencia();
  }

  function renderTendencia() {
    var serie = P.serieMensual(estado.movimientos, opciones()).slice(-6);
    if (!serie.length) { $('#tendencia').innerHTML = ''; return; }
    var max = Math.max.apply(null, serie.map(function (s) { return Math.max(s.ingresos, s.gastos); })) || 1;
    $('#tendencia').innerHTML = '<div class="tendencia">' + serie.map(function (s) {
      return '<div class="mes" title="' + nombreMes(s.mes) + ': ingresos ' + crc(s.ingresos) + ', gastos ' + crc(s.gastos) + '">' +
        '<div class="barras"><div class="b i" style="height:' + (s.ingresos / max * 100) + '%"></div>' +
        '<div class="b g" style="height:' + (s.gastos / max * 100) + '%"></div></div>' +
        '<span class="lbl">' + nombreMes(s.mes).slice(0, 3) + '</span></div>';
    }).join('') + '</div><div class="leyenda"><span><i style="background:var(--ingreso)"></i>Ingresos</span>' +
      '<span><i style="background:var(--gasto)"></i>Gastos</span></div>';
  }

  // ------------------------------------------------------------ Render: Movimientos

  function renderFiltroCategorias() {
    var todas = categoriasPara('gasto').concat(P.CATEGORIAS_INGRESO, [P.CATEGORIA_TRANSFERENCIA]);
    var sel = $('#f-categoria');
    var actual = sel.value;
    sel.innerHTML = '<option value="">Todas las categorías</option>' + todas.map(function (c) {
      return '<option' + (c === actual ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
  }

  function renderMovimientos() {
    var texto = P.normalizarTexto($('#f-texto').value);
    var tipo = $('#f-tipo').value;
    var cat = $('#f-categoria').value;
    var lista = estado.movimientos.filter(function (m) {
      if (String(m.fecha).slice(0, 7) !== estado.mes) return false;
      if (tipo && m.tipo !== tipo) return false;
      if (cat && m.categoria !== cat) return false;
      if (texto && P.normalizarTexto((m.descripcion || '') + ' ' + (m.comercio || '')).indexOf(texto) < 0) return false;
      return true;
    });

    $('#lista').innerHTML = lista.map(function (m) {
      var signo = m.tipo === 'ingreso' || m.tipo === 'reembolso' ? '+' : '−';
      var clase = m.tipo === 'ingreso' || m.tipo === 'reembolso' ? 'pos' : (m.tipo === 'transferencia' ? '' : 'neg');
      var opts = categoriasPara(m.tipo === 'reembolso' ? 'gasto' : m.tipo).map(function (c) {
        return '<option' + (c === m.categoria ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('');
      var sub = [m.tarjeta, m.ciudad, m.tipo === 'transferencia' ? 'no suma al gasto' : ''].filter(Boolean).join(' · ');
      return '<tr class="' + (m.excluir ? 'excluido' : '') + '">' +
        '<td>' + esc(String(m.fecha).slice(5, 10).split('-').reverse().join('/')) + '</td>' +
        '<td class="desc">' + esc(m.descripcion) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</td>' +
        '<td><select data-id="' + esc(m.id) + '" class="sel-cat">' + opts + '</select></td>' +
        '<td class="num ' + clase + '">' + signo + ' ' + montoOriginal(m) + '</td>' +
        '<td class="num"><button class="icono-btn" data-excluir="' + esc(m.id) + '" title="' +
        (m.excluir ? 'Incluir en el resumen' : 'Excluir del resumen') + '">' + (m.excluir ? '↩️' : '🚫') + '</button>' +
        (m.manual ? '<button class="icono-btn" data-borrar="' + esc(m.id) + '" title="Eliminar">🗑️</button>' : '') +
        '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="ayuda">No hay movimientos con estos filtros.</td></tr>';

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
    $('#lista-presupuesto').innerHTML = P.CATEGORIAS_GASTO.map(function (c) {
      return '<label>' + c.icono + ' ' + esc(c.nombre) +
        '<input type="number" min="0" step="1000" name="' + esc(c.nombre) + '" value="' +
        (estado.presupuestos[c.nombre] || 0) + '"></label>';
    }).join('');
    var total = P.CATEGORIAS_GASTO.reduce(function (s, c) {
      return s + (c.esAhorro ? 0 : (estado.presupuestos[c.nombre] || 0));
    }, 0);
    $('#total-presupuesto').textContent = 'Total de gastos presupuestados: ' + crc(total) + ' por mes.';
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
  }

  function render() {
    renderMeses();
    renderResumen();
    renderFiltroCategorias();
    renderMovimientos();
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
  ['#f-texto', '#f-tipo', '#f-categoria'].forEach(function (s) {
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
    estado.mes = f.fecha.value.slice(0, 7);
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
    estado.mes = mov.fecha.slice(0, 7);
    guardar(); render();
    $('#correo-resultado').innerHTML = '<p class="ayuda">' + (nuevos ? '✅ Agregado: ' : 'Ya existía: ') +
      esc(mov.descripcion) + ' · ' + montoOriginal(mov) + ' · ' + esc(mov.categoria) + '</p>';
    $('#correo-texto').value = '';
  });

  $('#form-presupuesto').addEventListener('submit', function (e) {
    e.preventDefault();
    P.CATEGORIAS_GASTO.forEach(function (c) {
      estado.presupuestos[c.nombre] = parseFloat(e.target.elements[c.nombre].value) || 0;
    });
    guardar(); renderPresupuesto(); render();
    aviso('Presupuesto guardado.');
  });

  $('#form-sync').addEventListener('submit', function (e) {
    e.preventDefault();
    var url = e.target.url.value.trim();
    var token = e.target.token.value.trim();
    estado.ajustes.url = url;
    estado.ajustes.token = token;
    guardar();
    if (!url || !token) { aviso('Ingrese la URL y el token.'); return; }
    $('#sync-estado').textContent = 'Sincronizando…';
    fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'token=' + encodeURIComponent(token))
      .then(function (r) { return r.json(); })
      .then(function (datos) {
        if (datos.error) throw new Error(datos.error);
        var n = fusionar(datos.movimientos || []);
        if (datos.tipoCambio) estado.ajustes.tipoCambio = datos.tipoCambio;
        guardar(); render(); renderDatos();
        $('#sync-estado').textContent = '✅ ' + n + ' movimientos nuevos (' + new Date().toLocaleString('es-CR') + ').';
      })
      .catch(function (err) {
        $('#sync-estado').textContent = '❌ No se pudo sincronizar: ' + err.message;
      });
  });

  $('#tipo-cambio').addEventListener('change', function (e) {
    var v = parseFloat(e.target.value);
    if (v > 0) { estado.ajustes.tipoCambio = v; guardar(); render(); aviso('Tipo de cambio actualizado.'); }
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
      tipoCambio: estado.ajustes.tipoCambio
    };
    descargar('presupuesto-respaldo-' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify(respaldo, null, 2), 'application/json');
  });

  $('#btn-exportar-csv').addEventListener('click', function () {
    var cols = ['fecha', 'tipo', 'categoria', 'descripcion', 'monto', 'moneda', 'montoCRC', 'tarjeta', 'fuente'];
    var tc = estado.ajustes.tipoCambio;
    var filas = [cols.join(',')].concat(estado.movimientos.map(function (m) {
      var fila = Object.assign({}, m, { montoCRC: Math.round(P.aColones(m, tc) * 100) / 100 });
      return cols.map(function (c) { return '"' + String(fila[c] == null ? '' : fila[c]).replace(/"/g, '""') + '"'; }).join(',');
    }));
    descargar('movimientos.csv', '﻿' + filas.join('\n'), 'text/csv');
  });

  $('#btn-borrar').addEventListener('click', function () {
    if (!confirm('Esto borra todos los movimientos, reglas y presupuesto de este navegador. ¿Continuar?')) return;
    estado = estadoInicial();
    guardar(); render(); renderPresupuesto(); renderDatos();
  });

  // ------------------------------------------------------------ Inicio

  render();
  renderPresupuesto();
  renderFormManual();
  renderDatos();
})();
