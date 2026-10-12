/**
 * Estado de cuenta bancario de ejemplo (anonimizado), con el formato de los fragmentos que entrega
 * pdf.js: {pagina, str, x, y, ancho}. Los montos van alineados a la derecha en la columna
 * DÉBITOS (termina en x≈519) o CRÉDITOS (termina en x≈594), como en el PDF de BAC.
 */
const items = [];
const fila = (pagina, y, celdas) => celdas.forEach(([x, str, ancho]) => items.push({ pagina, y, x, str, ancho: ancho || str.length * 4 }));
const debito = (s) => [519 - s.length * 3.5, s, s.length * 3.5];
const credito = (s) => [594 - s.length * 3.5, s, s.length * 3.5];
const linea = (pagina, y, ref, fecha, concepto, monto) => fila(pagina, y, [[90, ref], [147, fecha, 24], [194, concepto], monto]);

fila(1, 760, [[18, 'Tasas de interés escalonadas'], [250, 'Banco BAC San José SA'], [450, 'Fecha de Corte:']]);
fila(1, 750, [[18, 'Nombre:'], [80, 'PERSONA DE PRUEBA']]);
fila(1, 740, [[18, 'Para el rango de su'], [120, 'Tasa anual:'], [250, '3101012009'], [450, '31/OCT/26']]);
fila(1, 730, [[18, 'Cuenta IBAN:'], [80, 'CR00 0000 0000 0000 0012 34']]);
fila(1, 720, [[18, 'Moneda:'], [80, 'COLONES'], [200, '10,000,001']]);
fila(1, 600, [[250, 'CUADRO RESUMEN']]);
fila(1, 560, [[72, 'DÉBITOS', 39], [212, 'CRÉDITOS', 46], [380, 'SALDOS']]);
fila(1, 548, [[18, 'TOTAL'], [116, 'MONTO'], [150, 'TOTAL'], [241, 'MONTO'], [329, 'SALDO PROMEDIO'], [431, 'SALDO ANTERIOR'], [514, 'SALDO A LA FECHA']]);
fila(1, 535, [[30, '7'], [116, '1525,500.00', 39], [180, '3'], [241, '1010,250.50', 39], [329, '800,000.00'], [431, '1,000,000.00'], [514, '484,750.50']]);
fila(1, 515, [[18, 'Estado de Cuenta:'], [100, 'ACTIVA'], [400, 'Marca:']]);
fila(1, 504, [[18, 'NO. REFERENCIA'], [147, 'FECHA'], [194, 'CONCEPTO'], [467, 'DÉBITOS', 35], [539, 'CRÉDITOS', 41]]);
linea(1, 493, '406000001', 'OCT/02', 'TEF A : 900000001', debito('150,000.00'));
linea(1, 483, '966000002', 'OCT/03', 'SINPE MOVIL Huevos_Ana______', debito('3,500.00'));
linea(1, 473, '960000003', 'OCT/10', 'CD SINPE EMPRESA PATRONAL S', credito('900,000.00'));
linea(1, 463, '000000004', 'OCT/11', 'PAGO 400000******1111', debito('250,000.00'));
linea(1, 453, '666000005', 'OCT/11', 'DTR:Ahorros_colones', debito('1,000,000.00'));
linea(1, 443, '951000006', 'OCT/14', 'Pago Liberty Móvil (Movistar 8', debito('12,000.00'));
linea(1, 433, '951000007', 'OCT/15', 'Pago Liberty Móvil (Movistar 8', debito('12,000.00'));
fila(1, 300, [[18, 'SERVICIO AL CLIENTE']]);
fila(2, 620, [[18, 'Fecha de corte:']]);
fila(2, 610, [[18, '31/OCT/26']]);
fila(2, 594, [[18, 'NO. REFERENCIA'], [147, 'FECHA'], [194, 'CONCEPTO'], [467, 'DÉBITOS', 35], [539, 'CRÉDITOS', 41]]);
linea(2, 583, '406000008', 'OCT/20', 'TEF DE:FAMILIAR DE PRUEBA', credito('110,000.00'));
linea(2, 572, '966000009', 'OCT/28', 'SINPE MOVIL Sin_Descripcion', debito('98,000.00'));
linea(2, 561, '093000010', 'OCT/31', 'INTERESES', credito('250.50'));
fila(2, 548, [[18, 'ÚLTIMA LÍNEA'], [300, 'SALDO AL CORTE'], [554, '484,750.50', 40]]);

module.exports = items;
