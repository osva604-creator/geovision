# GeoVision

Aplicación de mapas y fotos de drones con alojamiento en Cloudflare Workers, ingreso con Clerk y API protegida para clima y despacho DJI.

## Estado de la integración

**Dirección pública: https://geovision-886.pages.dev**, publicada el 17 de septiembre de 2026. Proyecto Pages: `geovision`; despliegue inicial de Pages: `78f56e12`. El servidor es el Worker independiente `geovision`, en la cuenta indicada en `wrangler.jsonc`.

La importación KMZ/KML y la revisión con fotos de campo se publicaron en la versión `126f6f29-9f6f-4354-acb4-f9525468a383`. Se verificó que los archivos publicados coinciden con los probados localmente. Pasaron 20 pruebas automatizadas y la prueba completa de navegador con archivos sintéticos; todavía no se ha validado un KMZ real del proveedor del usuario.

Clerk está conectado a la instancia de desarrollo propia de GeoVision (`bright-gorilla-1371.clerk.accounts.dev`). Las dos claves se guardaron en el Worker como secretos y se comprobó con Clerk que pertenecen a la misma instancia. En la URL pública, `/api/config` responde 200, el SDK carga y el formulario de ingreso se abre sin errores de JavaScript. `/api/session` rechaza con 401 tanto solicitudes sin sesión como tokens inválidos. La comprobación de navegador no creó usuarios ni inició sesión: falta validar el ingreso completo con la cuenta del usuario.

Esta instancia de Clerk es para pruebas; antes del uso en producción se debe configurar la instancia de producción con dominio propio y sus claves. Siguen pendientes las credenciales de clima y, si corresponde, DJI. GeoVision utiliza credenciales y usuarios propios, separados de ConteoLab.

La activación de Clerk incluyó una corrección para que los estilos generales de botones no deformen sus controles. Versión publicada: `a33df132-a491-4f37-9b81-56d5d38d43a2`; caché pública `v8`. Pasaron las 20 pruebas automatizadas y la verificación del formulario real en computadora y celular, incluida su apertura y cierre. El nombre que muestra Clerk actualmente es `My Application`; se puede cambiar a GeoVision desde su panel.

### Dirección independiente de GeoVision

La configuración de `hosting/pages` publica la dirección exclusiva `geovision-886.pages.dev`. Cloudflare asignó ese hostname al proyecto `geovision`.

Pages reenvía las solicitudes al Worker `geovision` mediante un enlace interno de servicio, conservando el origen, la autenticación y las cabeceras de seguridad. La aplicación no llama a la dirección pública anterior desde el navegador. Las demás aplicaciones de la cuenta no se modifican.

La dirección de Pages está verificada y activa en la rama de producción `main`. Para actualizarla, ejecutar `npm.cmd run deploy:pages` con la cuenta de GeoVision seleccionada; en equipos con varias cuentas, establecer `CLOUDFLARE_ACCOUNT_ID=12a7e7f8710c2fe571714ecfe0716614` en el entorno. Pages no acepta `account_id` dentro de su archivo de configuración.

La URL anterior `https://geovision.conteolab.workers.dev` fue desactivada con autorización del usuario y devuelve 404. El Worker tiene `workers_dev: false` y `preview_urls: false`; sigue disponible para Pages mediante el enlace interno. Versión del Worker tras el cambio: `0dfbfa87-ba70-4a2d-921d-d6bc88b3b9d0`. Se verificó que la dirección nueva responde 200, conserva las protecciones de acceso y que la aplicación ConteoLab continúa respondiendo en su dirección original.

Referencia: [enlaces internos de servicios en Pages](https://developers.cloudflare.com/pages/functions/bindings/).

Cloudflare aloja la aplicación y ejecuta su servidor. Las fotos y los mapas siguen guardándose **en el dispositivo**, separados por ID de usuario; esta integración no agrega sincronización ni copias de seguridad en la nube. Se requiere conexión para iniciar y validar la sesión. La caché solo guarda archivos públicos de la aplicación, nunca sesiones ni respuestas de las API.

Los datos anteriores sin cuenta se conservan en `geovision_db` y `geovision_data`; no se asignan automáticamente al primer usuario que ingresa. Antes de cambiar de sitio, exportar los datos necesarios desde la versión anterior. El almacenamiento del navegador no se traslada entre dominios.

## Identificación satelital y verificación en campo

1. En **Identificación satelital**, usar **Importar polígono → KMZ / KML**. Se pueden seleccionar varios archivos. El mapa se centra en la capa importada sin borrar fotos, mediciones ni polígonos existentes.
2. Usar la casilla de cada capa para mostrarla u ocultarla, el control de transparencia para comparar y **Ver capa** para centrarla. Elegir una identificación en el selector o tocarla en el mapa para ver su nombre, descripción y atributos.
3. Cargar fotos originales con GPS desde **Subir foto de campo / drone**. Al seleccionar una identificación, aparecen las fotos cuyo GPS cae dentro de la geometría o a menos de 100 m de ella. **Ver** muestra la foto y su zona en el mapa; **Vincular** la asocia a esa identificación. También se puede elegir cualquier foto del historial y vincularla aunque esté más lejos.
4. Registrar la validación manual (**Pendiente**, **Coincide con campo**, **No coincide** o **Revisar**) y observaciones. La proximidad usa la posición GPS de la cámara y no demuestra por sí misma qué objeto aparece en la imagen. Los huecos de polígonos no se consideran parte de la superficie identificada.

Se admiten puntos, líneas, polígonos con huecos, geometrías múltiples y carpetas KML, incluidos varios KML dentro de un KMZ. Se conservan nombres, atributos y colores básicos. También se admiten imágenes PNG/JPEG incluidas en el archivo con `GroundOverlay` y `LatLonBox` sin rotación. Se informan los elementos omitidos: imágenes rotadas, `gx:LatLonQuad`, modelos 3D, trayectorias `gx:Track`, cruces del antimeridiano e imágenes externas. No se siguen enlaces de red ni se ejecuta HTML del archivo. Para un KMZ con una estructura distinta conviene verificar un archivo real del proveedor antes de usarlo en una campaña.

Los archivos se leen localmente, sin subirlos a un proveedor. Capas, imágenes embebidas, revisiones y asociaciones se guardan en IndexedDB por usuario. No se comparte información entre cuentas ni se sincroniza entre dispositivos. La actualización del almacenamiento conserva los datos de campo existentes. Si el navegador no permite guardar, se avisa que la importación dura solo esa sesión. La eliminación de una capa no borra las fotos; **Borrar todo el mapa** sí incluye capas y revisiones. Importar otra vez un archivo idéntico muestra la capa existente.

Límites: 25 MB por archivo, 10 MB por KML, 40 MB de contenido descomprimido leído por KMZ, 512 entradas por archivo, 5.000 identificaciones, 100.000 coordenadas y 20 capas guardadas. Las capas importadas son de referencia; no se agregan automáticamente a las misiones DJI ni a la exportación de polígonos dibujados.

## Importar rásteres y GeoPDF

En **Importar polígono → Ráster / PDF con coordenadas** se abre un formulario con vista previa. La capa se agrega recién al pulsar **Agregar al mapa**.

- **GeoTIFF (.tif/.tiff):** ubicación automática con transformación afín, incluida rotación. Se admiten WGS84 (EPSG:4326), Web Mercator (EPSG:3857) y UTM WGS84 (EPSG:32601–32660 y 32701–32760). Se reproyectan los píxeles al mapa, se conserva la transparencia y se aplica NoData. RGB, grises y paleta; hasta cuatro bandas. Los datos de punto flotante se muestran con un estiramiento de valores para visualización.
- **GeoPDF:** selección de página y lectura automática de la georreferencia ISO 32000 (`VP/Measure/GEO`, `GPTS/LPTS`, código EPSG compatible o autoridad EPSG raíz en WKT). Se recorta el marco del mapa, se respeta la rotación de la página y se comprueba el ajuste de los puntos de control. Si hay varios marcos, se importa el más grande y se avisa. No se interpretan automáticamente la codificación antigua OGC/LGIDict, sistemas de coordenadas distintos de los indicados ni transformaciones no afines: se ofrece ubicación manual o conversión a GeoTIFF. Falta verificar los archivos reales del proveedor del usuario.
- **PNG/JPG y PDF sin georreferencia compatible:** ubicación manual mediante límites oeste, este, sur y norte en el sistema EPSG elegido. Se puede recortar cada margen en porcentaje para excluir leyendas. El mapa debe estar orientado al norte, con límites que correspondan al recorte. No se deduce la extensión a partir del GPS de una foto, no se leen coordenadas impresas por OCR ni archivos auxiliares world file/PRJ.

Los archivos se procesan localmente y las imágenes resultantes se guardan en IndexedDB por cuenta, junto con las capas KMZ, con los mismos controles de transparencia, visibilidad, revisión y eliminación. Se conserva la huella geográfica para comparar fotos. Reimportar el mismo archivo con la misma página y ubicación no duplica la capa. La cancelación no agrega datos al mapa.

Límites de esta importación: 50 MB por archivo; imágenes de hasta 16 millones de píxeles y 128 MB de datos decodificados; vistas de referencia de hasta 1.600 píxeles por lado. Se comparte el máximo de 20 capas. No se conserva el original en la aplicación: guardalo aparte. Las capas ráster/PDF no se vectorizan ni se envían a DJI. Para ortomosaicos mayores, exportar una versión de menor resolución.

Las bibliotecas se copian desde dependencias con versión fija a `dist/vendor` durante `npm run build`, con sus licencias. PDF.js y los decodificadores se cargan al importar; requieren tener esos recursos disponibles desde el servidor local o publicado. No se ejecutan acciones ni scripts contenidos en PDF.

Prueba completa con el servidor local activo: `npm.cmd run test:raster:browser` (con `GEOVISION_BROWSER_CHANNEL=chrome` si se usa Chrome instalado). Incluye GeoTIFF WGS84/UTM, rotación, NoData, PNG/JPG manual, GeoPDF, páginas, PDF manual, cancelación, persistencia, errores y móvil. Se ejecuta con una sesión simulada aislada.

Referencias técnicas: [GeoTIFF.js](https://geotiffjs.github.io/geotiff.js/classes/geotiff.GeoTIFFImage.html), [PDF.js](https://mozilla.github.io/pdf.js/examples/), [Proj4js](https://proj4js.org/), [codificaciones GeoPDF de GDAL](https://gdal.org/en/stable/drivers/raster/pdf.html).

## Desarrollo local

Requiere Node.js 22 o superior. En PowerShell, usar `npm.cmd` y `npx.cmd` si está deshabilitada la ejecución de archivos `.ps1`.

```powershell
npm.cmd ci
Copy-Item .dev.vars.example .dev.vars
# Completar .dev.vars en un editor, nunca en el repositorio ni en el chat.
npm.cmd run dev
```

Abrir `http://localhost:8787`. La aplicación necesita el servidor Worker; abrir `index.html` o usar un servidor estático no habilita las API ni la sesión.

Variables obligatorias para el ingreso:

| Variable | Valor |
| --- | --- |
| `CLERK_PUBLISHABLE_KEY` | Clave pública `pk_…` de la aplicación de Clerk. |
| `CLERK_SECRET_KEY` | Clave secreta de la misma instancia. Solo en el servidor. |
| `WEATHER_API_KEY` | Clave de OpenWeather para habilitar el clima. |

Para habilitar DJI también se requieren `DJI_APP_KEY`, `DJI_APP_SECRET`, `DJI_LOGIN_URL`, `DJI_UPLOAD_URL` y `DJI_ALLOWED_USER_IDS` (IDs de usuarios de Clerk, separados por comas). Sin autorización explícita, ningún usuario puede despachar misiones. Los endpoints y el contrato de login/carga deben confirmarse con el proveedor DJI: el código conserva la forma del gateway anterior, pero no se verificó con el servicio real. Una respuesta de recepción no confirma ejecución del vuelo.

## Activación en Cloudflare y Clerk

1. Crear una aplicación **GeoVision** en [Clerk](https://dashboard.clerk.com/), elegir los métodos de ingreso y definir quién puede registrarse. Para acceso privado, configurar invitaciones o restricciones de registro en Clerk. Obtener las dos claves de la misma instancia.
2. Conectar la cuenta de Cloudflare:

   ```powershell
   npx.cmd wrangler login
   npx.cmd wrangler whoami
   ```

   Si no se puede abrir el navegador automáticamente, usar `npx.cmd wrangler login --browser=false --scopes account:read user:read workers:write workers_scripts:write pages:write` y abrir el enlace en la misma computadora. Si se usa otro dispositivo, agregar `--device` y completar la autorización con el código temporal que muestra Wrangler. Los enlaces y códigos de autorización no deben guardarse en el repositorio.

3. Ejecutar `npm.cmd test` y `npm.cmd run check:deploy`. El servidor se actualiza con `npm.cmd run deploy`. La entrada pública se actualiza con `npm.cmd run deploy:pages`. Abrir `https://geovision-886.pages.dev`. Inicialmente muestra el acceso pendiente hasta completar las variables. No hace falta comprar un dominio para esta etapa de prueba.
4. Cargar los valores de forma interactiva (sin incluirlos en los comandos ni en Git):

   ```powershell
   npx.cmd wrangler secret put CLERK_PUBLISHABLE_KEY
   npx.cmd wrangler secret put CLERK_SECRET_KEY
   npx.cmd wrangler secret put WEATHER_API_KEY
   ```

   Aunque la clave pública se carga como variable segura por comodidad, `/api/config` la entrega al navegador. La clave secreta nunca se entrega. Para DJI, usar el mismo comando para cada variable opcional indicada arriba.
5. Verificar el inicio/cierre de sesión con una cuenta de prueba en la dirección publicada. Las instancias de desarrollo de Clerk sirven para esta etapa. Para producción, configurar la instancia de producción, su dominio/DNS y sus claves según [Clerk: despliegue](https://clerk.com/docs/guides/development/deployment/production). No cambiar únicamente `pk_test` por `pk_live` en el texto de una clave.
6. Para un dominio propio, agregarlo al proyecto Pages y actualizar la configuración de Clerk. Las API comprueban que el token fue emitido desde el mismo origen al que se hace la solicitud.

Antes de completar la migración, **revocar o rotar la clave de OpenWeather que estuvo incluida en el JavaScript anterior**, y deshabilitar el acceso público al gateway antiguo de Google Cloud. Este repositorio no modifica ese servicio ya desplegado: mientras siga público, su URL anterior puede usarse por fuera de Cloudflare. La carpeta `cloud-functions/gateway-dji-farm` queda como referencia histórica y no forma parte del despliegue nuevo.

## Seguridad aplicada

- Sesión verificada con el SDK oficial de Clerk, tipo `session_token` y comprobación del origen (`authorizedParties`). Las API requieren Bearer explícito y rechazan orígenes externos.
- API de clima: 60 solicitudes por minuto por usuario; DJI: 5 por minuto por usuario. Los límites de Cloudflare son por ubicación y no constituyen una cuota global estricta.
- Cabeceras CSP, HSTS, protección contra inclusión en marcos, `nosniff` y permisos del navegador restringidos.
- Las claves de los proveedores se usan solamente en el Worker; no se publican fuentes del servidor ni archivos de configuración privados.
- KMZ limitado a 25 MB durante la lectura, comprobación básica de firma ZIP y tiempos máximos para proveedores. DJI debe validar el contenido de la misión.
- Cambio de usuario y cierre de sesión recargan la aplicación para limpiar la vista. Los datos locales por cuenta permanecen en el dispositivo; no están cifrados contra alguien con acceso al perfil del navegador.

El despliegue usa Workers y sus controles de aplicación. No se han activado reglas WAF de una zona, Cloudflare Access ni Turnstile independiente. Esos controles dependen de la cuenta/dominio y se configuran cuando estén disponibles.

Referencias: [Assets de Workers](https://developers.cloudflare.com/workers/static-assets/), [límites de solicitudes](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [validación de Clerk](https://clerk.com/docs/reference/backend/authenticate-request), [SDK de navegador de Clerk](https://clerk.com/docs/js-frontend/getting-started/quickstart).

## Verificación

```powershell
npm.cmd test
npm.cmd run check:deploy
```

Las pruebas verifican tokens RSA firmados localmente, rechazo de credenciales inválidas, orígenes, límites, protección DJI y caché/autenticación del navegador. Usan proveedores simulados: no despachan misiones ni validan credenciales de producción.

El lector KMZ se prueba con archivos sintéticos: geometrías, huecos, colores, imágenes embebidas, coordenadas inválidas, archivos dañados y límites de descompresión. La prueba de interfaz agrega importación, revisión con fotos, persistencia, migración de datos anteriores, aislamiento por cuenta y vista móvil. Con `npm.cmd run dev` activo, ejecutarla en otra terminal:

```powershell
$env:GEOVISION_BROWSER_CHANNEL = 'chrome'
npm.cmd run test:kmz:browser
```

Requiere Chrome instalado; si se prefiere el navegador de Playwright, ejecutar `npx.cmd playwright install chromium` y omitir la variable. La prueba solo admite un servidor local y simula la sesión en un navegador aislado; no modifica el ingreso de producción ni usa datos del usuario.
