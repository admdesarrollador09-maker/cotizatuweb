# CotizaTuWeb

Cotizador web de **Codigo RM Desarrolladores**. Tus clientes eligen el tipo de proyecto, configuran características y funcionalidades, ven el precio en soles al instante y reciben su cotización en PDF, por WhatsApp o como solicitud de propuesta. Tú administras precios y cotizaciones desde un panel privado.

## Requisitos

- **Node.js 22.13 o superior** (incluye la base de datos SQLite; no hay que instalar paquetes).
- Nada más: el proyecto no tiene dependencias externas, por eso no lleva `node_modules`.

## Poner en marcha (en tu computadora)

```bash
cd cotizatuweb
cp .env.example .env        # edita los valores si quieres
npm run crear-admin         # crea tu usuario administrador
npm start                   # abre http://localhost:3000
```

- Sitio público: `http://localhost:3000`
- Panel administrativo: `http://localhost:3000/admin/`

La base de datos se crea sola en `data/cotizatuweb.db` la primera vez, con los precios oficiales iniciales.

El WhatsApp comercial (**956 354 120**, guardado como `51956354120`) y el correo **admdesarrollador09@gmail.com** ya vienen configurados. Puedes cambiarlos en el panel → *Configuración*. Si borras el número, los botones de WhatsApp se ocultan.

## Cómo se calcula el precio

```
Precio base del proyecto
+ páginas adicionales (solo las que superan las incluidas en el paquete)
+ diseño + idiomas + contenido
+ funcionalidades adicionales (las incluidas en el paquete no se cobran)
= Subtotal de desarrollo
+ recargo por plazo (porcentaje sobre el subtotal o sobre el precio base, configurable)
− descuento (se aplica el mayor; no se acumulan)
+ IGV (opcional: no se muestra, se suma o ya está incluido)
= Total estimado
```

Los costos recurrentes (dominio, hosting, licencias, etc.) se muestran aparte y **nunca** se suman al total.

El navegador solo envía las opciones elegidas. El servidor vuelve a calcular todo con los precios de la base de datos, así que nadie puede alterar el total desde el navegador.

## Administrar precios (sin tocar código)

| Quiero cambiar… | Dónde |
|---|---|
| Precio base, páginas incluidas, descripción o visibilidad de un servicio | Panel → **Servicios** |
| Precio de una funcionalidad, o si está incluida / disponible / no disponible en cada servicio | Panel → **Funcionalidades** |
| Precio por página adicional, opciones de páginas, base del recargo, IGV, vigencia de tarifas | Panel → **Precios y reglas** → Reglas generales |
| Precios de diseño, idiomas, contenido y plazo (incluido el % de urgencia) | Panel → **Precios y reglas** → Opciones de características |
| Descuentos automáticos o con código | Panel → **Precios y reglas** → Descuentos |
| Dominio, hosting y demás costos aparte | Panel → **Costos aparte** |
| WhatsApp, correo, vigencia de cotizaciones, condiciones comerciales del PDF | Panel → **Configuración** |

Cada cambio de tarifas queda registrado en *Configuración → Historial de cambios de tarifas*. **Las cotizaciones ya emitidas conservan sus importes**: cada una guarda una copia de sus conceptos y precios.

## Administrar cotizaciones

Panel → **Cotizaciones**: filtra por estado, busca por número, nombre o correo, y abre cualquier cotización para:

- ver los datos del cliente y el detalle del presupuesto;
- cambiar el estado (Nueva solicitud, Pendiente de revisión, Cotización enviada, En negociación, Aceptada, Rechazada, Proyecto en ejecución);
- registrar fecha de seguimiento y observaciones internas;
- ajustar plazo y vigencia;
- **Ajustar propuesta**: editar, agregar o quitar conceptos (incluidos descuentos); el total y el PDF se recalculan;
- ver o descargar el PDF de nuevo;
- revisar el historial de todo lo que pasó con esa cotización.

Si el mismo cliente descarga el PDF y luego pulsa WhatsApp sin cambiar nada, se reutiliza la misma cotización en vez de crear una duplicada.

## Valores iniciales que conviene revisar

Los precios base son los oficiales. El resto son valores de partida que puedes cambiar en el panel:

- Páginas incluidas: Emprendedores 1, Negocios 3, Profesional 5, Tienda 5, Aplicación 3. Página adicional: S/ 60.
- Diseño personalizado + S/ 400; premium + S/ 900. Dos idiomas + 30 % del precio base; tres idiomas + 50 %.
- Apoyo en redacción S/ 40 por página; redacción + imágenes S/ 70 por página.
- Plazo urgente: recargo de 20 % sobre el subtotal de desarrollo y plazo al 60 %; flexible amplía el plazo un 30 % sin recargo.
- Precios y compatibilidades de las 12 funcionalidades (por ejemplo, el carrito viene incluido en la Tienda virtual y solo está disponible en Tienda y Aplicación).
- Condiciones comerciales del PDF (forma de pago 50/50, dos rondas de ajustes, etc.).
- IGV desactivado (los precios se muestran sin impuesto). Actívalo en *Precios y reglas* si corresponde.
- El código de descuento `BIENVENIDA` (10 %) viene creado pero **inactivo**.

## Publicar en internet

Necesitas un servicio que ejecute **Node.js 22.13+** y guarde archivos de forma **persistente** (SQLite es un archivo).

| Opción | Notas |
|---|---|
| **VPS** (DigitalOcean, Hetzner, Contabo, Hostinger VPS…) | Control total. Usa Nginx como proxy con HTTPS (Let's Encrypt) y `pm2` o `systemd` para mantener el proceso encendido. |
| **Railway / Render** | Despliegue desde GitHub. **Agrega un volumen o disco persistente** y apunta `DB_PATH` a él; sin eso, la base de datos se borra en cada despliegue. |
| **Hosting compartido con “Node.js App”** en cPanel | Funciona si el proveedor ofrece Node.js 22.13 o superior. Verifica la versión antes de contratar. |

Variables de entorno en producción (ver `.env.example`):

```
PORT=3000
DB_PATH=/ruta/persistente/cotizatuweb.db
PUBLIC_URL=https://www.tudominio.com
COOKIE_SECURE=1      # solo con HTTPS
TRUST_PROXY=1        # si hay Nginx, Render, Railway u otro proxy delante
```

Para crear el administrador en el servidor: `npm run crear-admin`, o define `ADMIN_USER` y `ADMIN_PASSWORD` antes del primer arranque (luego bórralas).

### Copias de seguridad

```bash
npm run respaldo
```

Crea una copia en `data/respaldos/` aunque el servidor esté encendido. Programa este comando a diario (cron) y descarga las copias a otro lugar.

## Seguridad incluida

- Contraseñas cifradas con scrypt; sesiones con cookie `HttpOnly` y `SameSite=Strict`, vencen a las 8 horas.
- Bloqueo temporal tras 5 intentos fallidos de ingreso.
- Protección CSRF en el panel y cabeceras de seguridad (CSP, anti-iframe, etc.).
- Límite de solicitudes por IP en el cotizador y campo trampa contra spam.
- Validación de todos los datos en el servidor; el precio siempre lo calcula el servidor.
- Los códigos de descuento no se exponen en la web pública.

## Pruebas

```bash
npm test
```

Comprueba los precios oficiales, el cálculo de páginas adicionales, que no haya cobros duplicados, que el total coincida con la suma de conceptos en más de mil combinaciones, las validaciones, el PDF, el mensaje de WhatsApp, la seguridad del panel y que cambiar tarifas no altere cotizaciones anteriores.

## Estructura

```
server.js              Servidor y rutas de la API
src/db.js              Base de datos, estructura y valores iniciales
src/quotes.js          Creación y ajuste de cotizaciones
src/quotePdf.js        Diseño del PDF
src/pdfwriter.js       Generador de PDF (sin dependencias)
src/auth.js            Contraseñas, sesiones y límites de intentos
public/index.html      Página pública y cotizador
public/js/pricing.js   Motor de cálculo (único, compartido por navegador y servidor)
public/js/app.js       Lógica del cotizador
public/admin/          Panel administrativo
public/privacidad.html Política de privacidad
scripts/               crear-admin y respaldo
test/                  Pruebas automáticas
```
