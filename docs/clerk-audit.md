# Auditoría de acceso Clerk — 19 de octubre de 2026

## Despliegue del flujo activo — 19 de octubre de 2026

Se publicó el commit de seguridad `af559b6` en el Worker `geovision`, versión
`a433df10-4351-40c3-afaf-566fb7b88441`. Pages conserva su proxy al servicio;
no necesitó un despliegue adicional porque su código no cambió.

Pasaron las 38 pruebas de la aplicación, el dry-run del Worker y el build de
Pages. En `https://geovision-886.pages.dev` se comprobó que `index.html`,
`js/auth.js` y `sw.js` coinciden exactamente con el build local (caché v14).
`/api/config` respondió 200; `/api/session` sin token y con token inválido,
y `/api/weather` sin sesión, respondieron 401; un origen externo recibió 403.
Las respuestas API verificadas conservan `no-store` y CSP. Chromium headless
confirmó el DOM privado vacío y el aviso de ingreso sin sesión.

No se desplegó el gateway heredado de Cloud Functions: es un servicio separado
que no participa del flujo actual. Siguen pendientes las pruebas con cuentas
reales de invitación, ingreso, bloqueo y revocación.

## Actualización: configuración del Dashboard mediante TinyFish

Con la sesión guardada por el propietario se continuó la configuración remota.
Se contrastó el ID de la instancia del Dashboard con `GET /v1/instance`
autenticado con la configuración local: ambos identifican
`ins_3JT4coGmNxx8kG8diNg39Y8nXg5`.

Una lectura independiente de `/v1/environment` del Frontend API confirmó:

- `application_name: GEO Vision`.
- `user_settings.sign_up.mode: restricted` (solo por invitación).
- Organizations deshabilitado y `force_organization_selection: false`.
- Home URL, enlace del logo, retornos después de ingreso, registro y cambio
  de sesión apuntan a `https://geovision-886.pages.dev`.
- Los retornos de cierre de sesión siguen en las páginas de ingreso de Clerk.
- La instancia sigue siendo de desarrollo. No se creó una de producción.

TinyFish informó que conservó la allowlist. No se enviaron invitaciones ni se
crearon o eliminaron usuarios. La aceptación de una invitación real, el ingreso
con una cuenta y las pruebas reales de revocación siguen pendientes. El ajuste
residual `actions.create_organization: true` sigue publicado, con Organizations
deshabilitado. Los diagnósticos y pendientes anteriores quedan como historial;
esta actualización reemplaza sus valores de nombre, acceso y retornos.

## Reparación remota posterior autorizada

El propietario autorizó reparar Clerk. Se instaló Chromium de Playwright
(Chromium 1243 y su Headless Shell) en el equipo. La herramienta de navegación
de esta sesión sigue sin navegadores conectados; instalar Chromium no conecta
automáticamente el control del navegador a ChatGPT.

Se aplicó `PATCH /instance/organization_settings` con `enabled: false` y se
verificó mediante lecturas independientes de Backend API y Frontend API:

- Organizations deshabilitado en ambos endpoints.
- `force_organization_selection: false` confirmado después del cambio.
- La organización existente no fue eliminada ni se alteraron sus miembros.
- `user_settings.actions.create_organization` sigue publicado como `true`,
  aunque la función Organizations está deshabilitada. Falta revisar ese ajuste
  residual en el panel; no se modificaron parámetros no documentados.

**Pendiente:** el registro sigue en `public` con allowlist. La API Backend
documentada no expone la modificación de Access mode, nombre público ni los
retornos del Account Portal. Requieren acceso al Dashboard con un navegador
conectado. No se usaron endpoints internos, no se desactivó la allowlist ni se
crearon credenciales. La instancia sigue siendo de desarrollo. Los apartados
de diagnóstico siguientes conservan el estado anterior como referencia.

## Alcance y diagnóstico

Git estaba limpio al comenzar. Se revisaron frontend, persistencia, service worker,
builds, Worker, proxy Pages, gateway Cloud Functions, dependencias y archivos
versionados. No se modificaron servicios remotos, credenciales ni despliegues.
En una revisión posterior autorizada se consultaron las API de Clerk y la
configuración pública desplegada, únicamente en modo lectura.

El flujo activo es navegador → Pages → Worker (`src/worker.mjs`) → proveedor.
Usa Clerk JS 6 y UI 1 desde el Frontend API de la instancia, y `@clerk/backend`
3.18.1 instalado y fijado en el lockfile. No fue necesario actualizar dependencias.
Las versiones mayores de los bundles CDN reciben actualizaciones de Clerk.

La verificación de firma, origen y expiración ya existía. Faltaba consultar el
estado actual de sesión y usuario: ahora cada API protegida consulta `getSession`
y `getUser`, exige sesión activa y vigente del mismo usuario, y rechaza usuarios
bloqueados o suspendidos. Si Clerk no responde, se deniega el acceso. Esto añade
dos consultas BAPI por solicitud: considerar su latencia y cuota antes de escalar;
no se cachea la autorización para evitar demorar revocaciones.

La interfaz privada ahora vive en un template inerte hasta validar `/api/session`.
El código de mapas solo se carga después. Se revalida cada 30 segundos, al volver
a la pestaña y al restaurar la página; una validación tiene vigencia de 60 segundos.
Al detectar desconexión, rechazo o cambio de cuenta se retira el DOM privado y se
recarga para liberar memoria, fotos y callbacks. El servidor valida siempre las
operaciones sensibles, independientemente del temporizador del navegador.

El login conserva recuperación de acceso de Clerk, fija el retorno al origen
actual y deshabilita transferencia a registro y el enlace visual de alta. Esta
personalización no impone Invite-only: la restricción real pertenece a Clerk.

## Cambios manuales obligatorios en Clerk

1. En la instancia correcta, seleccionar **Access mode → Invite-only (restricted)**.
   Confirmar que un correo no invitado no pueda registrarse, incluso por OAuth o
   Account Portal. La revisión remota confirmó `sign_up.mode: public` con allowlist
   activada: todavía no cumple Invite-only. No se cambió la configuración.
2. No habilitar Organizations. Usar únicamente usuarios individuales y el panel
   oficial del propietario para invitar, bloquear, desbloquear, revocar sesiones
   o eliminar usuarios. No se agregó un panel administrativo ni roles públicos.
3. Configurar el correo de invitación y el Account Portal de Clerk para completar
   la aceptación y verificación del correo; no crear una ruta pública de alta en
   GEO Vision. Probar una invitación real, su aceptación y posterior ingreso.
4. Revisar métodos de ingreso, verificación de email y recuperación de contraseña.
   Configurar Home URL y retornos para cada entorno usando sus URLs reales.
5. Usar una instancia de producción y dominio verificado para uso productivo;
   el README describe una instancia de desarrollo. Configurar sus claves solo
   como variables/secretos del Worker, sin reutilizar valores de otros proyectos.
6. Probar revocación y bloqueo con una sesión abierta y cambio de cuenta en el
   mismo dispositivo. Estas pruebas reales quedan pendientes de ejecución manual.

## Resultado de la revisión remota de configuración

La clave publicable de la PWA desplegada apunta a la misma instancia que la
configuración local: `bright-gorilla-1371.clerk.accounts.dev`. Se consultaron
`GET /instance`, `GET /instance/organization_settings`, `GET /domains` y
`GET /v1/environment` del Frontend API, sin escrituras ni cambios de usuarios.

**La configuración actual no cumple todavía el modelo de acceso solicitado:**

- Registro en modo `public`, con allowlist habilitada. Una allowlist no equivale
  a Invite-only y no se revisó su contenido. Cambiar Access mode a Invite-only.
- Organizations habilitado, creación de organizaciones permitida y
  `force_organization_selection: true`. Desactivar la selección obligatoria y
  Organizations para el modelo de usuarios individuales. No se inspeccionaron
  organizaciones existentes ni se eliminó ninguna.
- Instancia de desarrollo con `test_mode: true`. Antes del uso productivo,
  completar la instancia de producción y su dominio.
- Nombre público `My Application`, sin logo y Home URL/retornos apuntando al
  `default-redirect` del Account Portal. Configurar GEO Vision y la URL real de
  la aplicación; revisar especialmente el retorno después de aceptar invitaciones.
- `allowed_origins` y `development_origin` no tienen valores configurados en los
  endpoints consultados. No se verificó una configuración de dominio productivo.
  El Worker mantiene su comprobación de origen mediante `authorizedParties`.

**Configuraciones compatibles ya verificadas:** email obligatorio y verificado
al registrarse mediante código o enlace; contraseña habilitada y obligatoria;
recuperación por código de email; CAPTCHA de registro; modo de una sola sesión.
Google también está habilitado: comprobar su comportamiento después de activar
Invite-only, incluyendo un correo no invitado. No se probó un registro real.

Esta revisión no valida privilegios del propietario en el Dashboard, entrega
real de correos, aceptación de invitaciones ni bloqueo con una cuenta real.
No se rotaron claves ni se alteraron los ajustes indicados.

## Credenciales y PWA

No se encontraron claves secretas reales reconocibles en los archivos actuales
versionados (incluidos ejemplos, comentarios y documentación). No es una búsqueda
forense de todos los commits históricos ni una certificación de secretos remotos.
Se buscaron las referencias solicitadas, patrones de claves Clerk, JWT y claves
privadas sin imprimir valores. Los valores de pruebas son sintéticos.

`/api/config` devuelve solo la clave publicable. Claves Clerk secretas, clima y
DJI se leen en backend. El build usa una lista explícita de archivos públicos.
`.env`, variantes y `.dev.vars` están ignorados; `.env.example` y
`.dev.vars.example` contienen únicamente nombres y valores vacíos.

El service worker solo permite archivos públicos exactos del mismo origen,
excluye Authorization, API, query strings ajenas y terceros. No guarda tokens,
cabeceras Authorization ni respuestas privadas. Se incrementó la versión de caché
para renovar la carcasa. Las API devuelven `Cache-Control: no-store`.

IndexedDB y localStorage ya separan los datos con el ID de Clerk en el nombre
de base/clave. No se borraron fotos, telemetría, capas ni historiales persistentes:
son documentos locales del propietario y se recuperan solo después de validar
su cuenta. Cerrar sesión elimina el estado cargado, no estos documentos. Los datos
antiguos sin cuenta se conservan aislados y no se migran automáticamente. No se
persisten credenciales manualmente; sessionStorage solo guarda un indicador de
cierre pendiente para reintentar si falla Clerk. El almacenamiento local no está
cifrado y no protege frente a quien controla el perfil del navegador o dispositivo.

Offline se conserva la carcasa de acceso; no se habilita el espacio privado ni se
envían operaciones protegidas. No hay cola de envío offline.

## Gateway heredado

`cloud-functions/gateway-dji-farm` es un servicio separado, no invocado por la PWA
actual. Su modo `oidc-jwt` verifica HS256: **no acepta tokens RS256 de Clerk** y
no debe usarse como gateway Clerk ni recibir una clave secreta Clerk como secreto
HMAC. Su despliegue conserva IAM privado y prohíbe AUTH_MODE=off en producción.
Se corrigió la aceptación de JWT sin expiración o sujeto y fechas inválidas.
Antes de conectarlo a la PWA debe integrarse verificación Clerk y autorización
por usuario también allí; no se conectó ni se reescribió ese servicio.

El despacho actual del Worker exige además `DJI_ALLOWED_USER_IDS` del servidor;
esto es un permiso de operación, no un rol administrativo. SmartFarm no está
conectado al flujo actual. No se añadieron organizaciones ni jerarquías.

## Referencias oficiales consultadas

Verificación local: 38 pruebas de la aplicación y 11 del gateway aprobadas;
builds de Worker y Pages, comprobación sintáctica del gateway y `git diff --check`
correctos. Chrome headless confirmó el mensaje restringido y la ausencia de DOM
privado sin autenticación. Las pruebas de bloqueo/revocación usan respuestas
simuladas; la firma y expiración JWT se prueban con claves RSA sintéticas reales.
No se ingresó a una cuenta real ni se envió ninguna operación a DJI/SmartFarm.

- [Clerk JavaScript 6: carga de SDK y UI](https://clerk.com/docs/js-frontend/getting-started/quickstart)
- [Invite-only y acceso restringido](https://clerk.com/docs/guides/secure/restricting-access)
- [authenticateRequest y authorizedParties](https://clerk.com/docs/reference/backend/authenticate-request)
- [Consulta de sesión](https://clerk.com/docs/reference/backend/sessions/get-session)
- [SignIn: transferable y forceRedirectUrl](https://clerk.com/docs/js-frontend/reference/components/authentication/sign-in)
- [Tokens cortos y revocación](https://clerk.com/docs/guides/how-clerk-works/overview)
