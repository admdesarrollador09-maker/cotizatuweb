# CotizaTuWeb

Cotizador web de **Codigo RM Desarrolladores**. Tus clientes eligen el tipo de proyecto, configuran características y funcionalidades, ven el precio en soles al instante y reciben su cotización en PDF, por WhatsApp o como solicitud de propuesta. Tú administras precios y cotizaciones desde un panel privado.

## Publicar en Netlify

El proyecto está listo para Netlify:

- La página y el panel se publican desde la carpeta `public/`.
- La API (cálculo, cotizaciones, PDF y panel) es una **Netlify Function** en `netlify/functions/api.mjs`, que responde en `/api/*`.
- Los datos (tarifas, configuración y cotizaciones) se guardan en **Netlify Blobs**, el almacenamiento de Netlify. No hay que crear ni conectar ninguna base de datos.
- `netlify.toml` ya define todo: carpeta publicada, función, cabeceras de seguridad y la versión de Node.

> No uses “arrastrar y soltar” (Netlify Drop): ese método solo publica archivos estáticos, así que el cotizador no podría guardar cotizaciones ni el panel funcionaría. Usa GitHub o la CLI de Netlify.

### Opción A: desde GitHub (recomendada)

Cada vez que subas un cambio a GitHub, Netlify publica la nueva versión sola.

1. **Sube el proyecto a GitHub.** Crea un repositorio privado (por ejemplo `cotizatuweb`) y sube el contenido de la carpeta `cotizatuweb` (con GitHub Desktop o con *Add file → Upload files*). La carpeta `data/` no debe subirse; ya está en `.gitignore`.
2. **Crea el proyecto en Netlify.** En app.netlify.com: *Add new project → Import an existing project → GitHub* y elige el repositorio. Netlify toma la configuración de `netlify.toml`; no cambies los campos de compilación.
3. **Define tu usuario administrador.** En el proyecto: *Project configuration → Environment variables → Add a variable*:
   - `ADMIN_USER` = el usuario que quieras (por ejemplo `marlon`).
   - `ADMIN_PASSWORD` = una contraseña de al menos 10 caracteres con letras y números. Marca la opción de valor secreto.
4. **Publica.** Pulsa *Deploy* (o *Trigger deploy → Deploy site* si ya se había publicado antes de crear las variables). La compilación ejecuta las pruebas automáticas; si alguna falla, Netlify no publica la versión rota.
5. **Prueba.** Abre la dirección que te da Netlify (algo como `https://cotizatuweb.netlify.app`), haz una cotización y descarga el PDF. Luego entra a `https://…netlify.app/admin/` con el usuario y la contraseña del paso 3.
6. **Cambia la contraseña** desde el panel (*Configuración → Cambiar contraseña*). Desde ese momento vale la nueva; puedes borrar la variable `ADMIN_PASSWORD` de Netlify.
7. **Dominio propio (opcional).** *Domain management → Add a domain* y sigue las instrucciones para apuntar tu dominio. Netlify activa el HTTPS automáticamente.

### Opción B: con la CLI de Netlify

Requiere Node.js 22 en tu computadora.

```bash
npm install -g netlify-cli
cd cotizatuweb
netlify login                      # abre el navegador para autorizar
netlify init                       # crea el proyecto en tu cuenta
netlify env:set ADMIN_USER marlon
netlify env:set ADMIN_PASSWORD "TuClaveSegura2026" --secret
netlify deploy --build --prod      # publica
```

Para publicar cambios después: `netlify deploy --build --prod`.

### Datos iniciales

La primera vez que alguien abre la web, el sistema crea el catálogo con los precios oficiales y la configuración inicial. El WhatsApp comercial (**956 354 120**, guardado como `51956354120`) y el correo **admdesarrollador09@gmail.com** ya vienen configurados; puedes cambiarlos en *Configuración*.

Los datos viven en Netlify Blobs y **se conservan entre publicaciones**: subir una nueva versión del código no borra tarifas ni cotizaciones.

### Copias de seguridad

Panel → *Configuración → Descargar respaldo*. Descarga un archivo con todas las tarifas, la configuración y las cotizaciones. Hazlo de vez en cuando y guárdalo en un lugar seguro.

### Consumo

Las funciones y Blobs consumen parte de los recursos de tu plan de Netlify. Para una web de cotizaciones el consumo suele ser bajo, pero revisa *Usage* en tu cuenta durante las primeras semanas.

## Probar en tu computadora (opcional)

Requiere **Node.js 22 o superior**.

```bash
cd cotizatuweb
npm install            # instala @netlify/blobs (solo se usa en Netlify)
npm run crear-admin    # crea tu usuario administrador local
npm start              # abre http://localhost:3000
```

En tu computadora los datos se guardan en archivos dentro de `data/`, separados de los datos de Netlify.

## Cómo funciona el cotizador

El cliente avanza en cinco pasos. Las preguntas cambian según el tipo de proyecto:

1. **Proyecto**: los cinco paquetes, con descripción y beneficios, sin precios.
2. **Alcance**:
   - Páginas web: rango de páginas, tipo de web, galería, blog, fotos y videos.
   - Tienda virtual: productos, carga de productos, variantes, inventario y panel.
   - Aplicación web: objetivo, usuarios, procesos, reportes, integraciones y datos.
3. **Diseño y contenido**: plantilla o diseño exclusivo, identidad visual, textos, fotografías, idiomas y plazo.
4. **Funciones**: agrupadas por tipo de proyecto. Las incluidas en el paquete aparecen marcadas y no se cobran. También se eligen aquí los servicios recurrentes (dominio, hosting, mantenimiento, soporte).
5. **Resumen**: datos del cliente, alcance, funciones, plazo y **un solo total**. Desde aquí se genera la cotización, se descarga en PDF o Excel, se envía por WhatsApp o se vuelve a editar.

**Precios ocultos de verdad:** el navegador nunca recibe tarifas. El servidor calcula el total y solo devuelve ese monto. El PDF, el Excel y el mensaje de WhatsApp tampoco muestran precios por concepto. El desglose interno solo lo ves tú en el panel.

## Cómo se calcula el precio (interno)

```
Precio base del paquete
+ páginas adicionales (páginas del rango elegido − páginas incluidas) × precio por página
+ respuestas con tarifa (cantidad de productos, edición de fotos, etc.)
+ diseño + textos + idiomas
+ funcionalidades adicionales (las incluidas en el paquete no se cobran)
= Subtotal de desarrollo
+ recargo por plazo urgente
− descuento (se aplica el mayor; no se acumulan)
+ IGV (opcional)
= Total del desarrollo
```

Los servicios recurrentes se totalizan aparte, por periodo (mensual, anual), y nunca se suman al desarrollo.

### Conceptos "pendientes de configuración"

Las opciones nuevas que todavía no tienen tarifa (por ejemplo, "De 51 a 100 productos", "Billeteras digitales" o "Hosting") **no suman nada al total**. El cliente ve que esos puntos "se confirman en la propuesta final". En el panel, **Precios y reglas → Pendientes de configuración** muestra la lista completa. Cuando les pongas precio, empezarán a sumarse automáticamente en las cotizaciones nuevas.

## Administrar precios (sin tocar código)

| Quiero cambiar… | Dónde |
|---|---|
| Precio base, páginas incluidas, beneficios o tipo de preguntas de un paquete | Panel → **Servicios** |
| Preguntas de los pasos 2 y 3, sus opciones y el precio de cada opción | Panel → **Preguntas** |
| Precio de una funcionalidad y si está incluida, disponible o no disponible en cada paquete | Panel → **Funcionalidades** |
| Rangos de páginas, precio por página adicional, IGV, recargo por plazo y vigencia de tarifas | Panel → **Precios y reglas** |
| Precios de diseño, textos, idiomas y plazo de entrega | Panel → **Precios y reglas** → Opciones de características |
| Descuentos automáticos o con código | Panel → **Precios y reglas** → Descuentos |
| Dominio, hosting, mantenimiento, soporte: precio, periodicidad y si el cliente puede elegirlo | Panel → **Costos aparte** |
| WhatsApp, correo, vigencia de cotizaciones y condiciones comerciales | Panel → **Configuración** |

En los precios, **un campo vacío significa "pendiente"** y **0 significa "sin costo"**.

Cada cambio de tarifas queda registrado en *Configuración → Historial de cambios de tarifas*. **Las cotizaciones ya emitidas conservan sus importes.**

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

## Seguridad incluida

- Contraseñas cifradas con scrypt; sesiones con cookie `HttpOnly`, `Secure` y `SameSite=Strict`, vencen a las 8 horas.
- Bloqueo temporal tras 5 intentos fallidos de ingreso.
- Protección CSRF en el panel y cabeceras de seguridad (CSP, anti-iframe, etc.).
- Límite de solicitudes por IP en el cotizador y campo trampa contra spam.
- Validación de todos los datos en el servidor; el precio siempre lo calcula el servidor.
- Los códigos de descuento no se exponen en la web pública.

## Pruebas

```bash
npm test
```

Netlify también las ejecuta antes de cada publicación. Comprueban los precios oficiales, el cálculo de páginas adicionales, que no haya cobros duplicados, que el total coincida con la suma de conceptos en más de mil combinaciones, las validaciones, el PDF, el mensaje de WhatsApp, la seguridad del panel y que cambiar tarifas no altere cotizaciones anteriores.

## Estructura

```
netlify.toml                 Configuración de Netlify
netlify/functions/api.mjs    Netlify Function que atiende /api/*
src/app.js                   Rutas de la API (cotizador y panel)
src/catalog.js               Precios y configuración iniciales
src/repo.js                  Acceso a los datos (cotizaciones, sesiones, historial)
src/store.js                 Almacenamiento: Netlify Blobs o archivos locales
src/quotes.js                Creación y ajuste de cotizaciones
src/quotePdf.js              Diseño del PDF
src/pdfwriter.js             Generador de PDF (sin dependencias)
src/auth.js                  Contraseñas cifradas
public/index.html            Página pública y cotizador
src/pricing.js               Motor de cálculo (solo en el servidor)
src/quoteXlsx.js             Exportación a Excel
public/js/questions.js       Reglas de visibilidad de preguntas (sin precios)
public/js/app.js             Cotizador de 5 pasos
public/admin/                Panel administrativo
public/privacidad.html       Política de privacidad
server.js                    Servidor para probar en tu computadora
scripts/crear-admin.js       Crear administrador local
test/                        Pruebas automáticas
```
