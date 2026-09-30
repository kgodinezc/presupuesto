# 💰 Presupuesto Familiar

Aplicación para llevar el presupuesto familiar a partir de los **correos de notificación del banco**
(BAC Credomatic, Costa Rica). Lee automáticamente las compras con tarjeta y las transferencias SINPE,
las **categoriza**, y las **compara con los ingresos** y con un presupuesto mensual por categoría.

```
Gmail (notificaciones BAC)
        │  cada hora
        ▼
Google Apps Script ──► Hoja de Google "Presupuesto"  (Movimientos · Presupuesto · Reglas · Resumen)
        │  doGet?token=…
        ▼
App web (GitHub Pages) ──► Resumen del mes · gastos vs. presupuesto · alertas · tendencia
```

## Qué hace

| Correo del banco | Se registra como |
|---|---|
| *Notificación de transacción* (tarjeta de crédito/débito) | **Gasto** (CRC o USD) |
| *Transferencia SINPE* recibida | **Ingreso** (p. ej. salario) |
| *Transferencia Local* recibida | **Ingreso** |
| *Transferencia SINPE en tiempo real* enviada | **Transferencia** (no se suma al gasto) |

- **Categorización automática** por comercio (Supermercado, Restaurantes, Salud, Transporte,
  Suscripciones, Compras en línea, Ropa, Hogar, Educación, Deporte, Paseos, Servicios,
  Diezmos y ofrendas, Ahorro e inversión, Otros). Si corrige una categoría, la app **aprende** ese
  comercio.
- **Resumen mensual**: ingresos, gastos, balance, tasa de ahorro, gasto por categoría vs. presupuesto.
- **Alertas**: categorías que superan el presupuesto y **posibles cobros duplicados**
  (mismo comercio y monto en menos de 10 minutos).
- **Dólares** convertidos a colones con el tipo de cambio configurable.
- Movimientos manuales (efectivo, diezmos, alquiler…) y opción de **pegar el texto de un correo**.
- **Periodos por fecha de corte**: con día de corte 6, cada periodo va del 7 de un mes al 6 del siguiente,
  igual que el estado de cuenta de la tarjeta (0 = mes calendario).
- **Estado de cuenta (PDF)**: al cierre de cada periodo cargue el PDF de BAC. Se lee en el navegador
  (no se sube a ningún servidor) y se concilia cargo por cargo con sus movimientos:
  - cargos que **no llegaron por correo** (peajes Compass, servicios domiciliados, IVA de servicios
    digitales…) y se pueden agregar al presupuesto con un clic;
  - movimientos de la app que **no aparecen** en el estado (compras cerca del corte que pasan al
    siguiente periodo, anulaciones, posibles cobros duplicados);
  - pagos a la tarjeta, intereses del periodo y **pago de contado**;
  - gasto por categoría según el estado **vs. presupuesto**.

  Al aplicar la conciliación, cada movimiento queda asignado al periodo del estado de cuenta. El banco
  agrupa por fecha de registro, que puede ser uno o dos días después de la compra; así el resumen de
  cada periodo cuadra con el banco.
- Se ignoran las autorizaciones de verificación en ₡0,00 / US$0,00.

### Decisiones de diseño importantes

- **Las transferencias enviadas no se cuentan como gasto.** Con frecuencia son el pago de la tarjeta
  o un traslado entre cuentas propias; como las compras con tarjeta ya se registraron una por una,
  sumarlas duplicaría el gasto. Aparecen aparte para revisarlas; si una transferencia sí es un gasto
  (p. ej. alquiler), agréguelo como movimiento manual.
- **"Ahorro e inversión"** se muestra separado del gasto de consumo.
- **Privacidad**: este repositorio es público y **no contiene datos personales**. Los movimientos
  viven en su hoja de Google y en el `localStorage` de su navegador. La carpeta `datos/` está en
  `.gitignore`.

## Instalación

### 1. Hoja de Google + lector de Gmail (automático)

1. Cree una hoja nueva en [sheets.new](https://sheets.new) y llámela *Presupuesto Familiar*.
2. Menú **Extensiones → Apps Script**.
3. Borre el contenido de `Código.gs` y pegue **todo** el archivo
   [`apps-script/dist/Codigo.gs`](apps-script/dist/Codigo.gs).
4. En *Configuración del proyecto* (⚙️) active **“Mostrar el archivo de manifiesto appsscript.json”**
   y reemplace su contenido por [`apps-script/appsscript.json`](apps-script/appsscript.json).
5. Guarde, vuelva a la hoja y recárguela. Aparece el menú **💰 Presupuesto**.
6. **💰 Presupuesto → 1. Configurar**. Google pedirá permisos (lectura de Gmail y de esta hoja).
   Se importan los correos de los últimos 90 días y se programa una importación **cada hora**.
7. Ajuste en la hoja **Presupuesto** los montos por categoría, el `_tipoCambioUSD` y el `_diaCorte`
   (día de corte de la tarjeta; 0 = mes calendario). Si su hoja es anterior a esta versión, agregue la
   fila `_diaCorte` a mano.
8. Para fijar la categoría de un comercio, agréguelo a la hoja **Reglas** y use
   **💰 Presupuesto → Recategorizar con reglas**.

### 2. App web

1. En GitHub: **Settings → Pages → Source: GitHub Actions**. Al hacer *merge* a `main`, el flujo
   `Publicar app web` publica la carpeta `app/` en `https://kgodinezc.github.io/presupuesto/`.
2. En Apps Script: **Implementar → Nueva implementación → Aplicación web**
   (Ejecutar como: *yo*; Acceso: *cualquier persona*). Copie la URL que termina en `/exec`.
3. En la app web, pestaña **Datos**, pegue la URL y el token
   (**💰 Presupuesto → Ver token para la app web**) y pulse **Sincronizar ahora**.
   Desde entonces la app **se sincroniza sola**: al abrirse, al volver a su pestaña y cada 15 minutos
   mientras está abierta. El indicador del encabezado muestra la última sincronización; tóquelo para
   sincronizar al momento. El presupuesto (incluidas categorías propias que agregue en la hoja, como
   "Familia …") también se toma de la hoja.

> El token evita que alguien que conozca la URL vea sus datos. No lo comparta.

También puede usar la app sin Google: importe un respaldo JSON o agregue movimientos a mano.

## Desarrollo

```bash
npm test            # pruebas (Node 18+), con correos de ejemplo anonimizados
npm run build:gas   # regenera apps-script/dist/Codigo.gs
npm start           # sirve la app en http://localhost:8080
```

```
app/
  index.html, css/, js/app.js     interfaz web (sin dependencias)
  js/core/parser.js               lee correos del banco → movimiento
  js/core/categorias.js           categorías, reglas y categorizador
  js/core/resumen.js              periodos de corte, totales, presupuesto, alertas, tendencia
  js/core/estadoCuenta.js         lee el estado de cuenta (PDF) y lo concilia con los movimientos
  vendor/pdfjs/                   pdf.js 4.10 (Apache-2.0) para leer el PDF en el navegador
apps-script/
  Main.js                         Gmail → Hoja, disparador, API doGet
  appsscript.json                 manifiesto (zona horaria, permisos)
  dist/Codigo.gs                  archivo único generado para pegar en Apps Script
tests/                            pruebas y correos de ejemplo anonimizados
```

La lógica de `app/js/core/` es la misma en el navegador, en Apps Script y en las pruebas.

### Agregar otro banco

1. Guarde un correo de ejemplo **anonimizado** en `tests/fixtures/`.
2. Agregue un `parsearXxx()` en `app/js/core/parser.js` y su detección en `parsearCorreo()`.
3. Agregue el remitente a `CONFIG.CONSULTA_GMAIL` en `apps-script/Main.js`.
4. `npm test && npm run build:gas`.
