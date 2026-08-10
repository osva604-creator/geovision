# GeoVision DJI Gateway

Base modular para migrar el gateway DJI de GeoVision hacia una futura
integracion oficial con DJI SmartFarm / DJI Smart Farm Ecosystem para Agras
T70/T70P.

Esta fase no implementa llamadas reales a SmartFarm. No hay endpoints,
cabeceras, firmas, credenciales ni formatos oficiales inventados. El adaptador
real queda bloqueado hasta recibir documentacion oficial de DJI.

## Arquitectura

```text
index.js
src/app.js
src/config.js
src/domain/task-draft.js
src/middleware/auth.js
src/middleware/cors.js
src/middleware/request-id.js
src/providers/smartfarm-mock.js
src/providers/smartfarm.js
src/providers/flighthub-legacy.js
test/app.test.js
```

- `index.js`: registra la funcion HTTP en Google Functions Framework.
- `src/app.js`: rutas HTTP versionadas, healthcheck y compatibilidad legacy.
- `src/config.js`: lectura segura de variables de entorno.
- `src/domain/task-draft.js`: modelo neutral de borrador agricola.
- `src/providers/smartfarm-mock.js`: mock en memoria para pruebas locales.
- `src/providers/smartfarm.js`: punto de extension real, todavia no implementado.
- `src/providers/flighthub-legacy.js`: compatibilidad heredada, no SmartFarm.
- `src/middleware/*`: request ID, CORS y autenticacion.

## Modos

`DJI_GATEWAY_MODE=disabled` es el valor predeterminado y no contacta ningun
servicio DJI.

```text
disabled          Default seguro. No transmite nada a DJI.
smartfarm-mock    Crea borradores simulados en memoria. No transmite nada a DJI.
smartfarm         Reservado. Devuelve 501 SMARTFARM_ADAPTER_NOT_IMPLEMENTED.
flighthub-legacy  Compatibilidad FlightHub anterior. No compatible con Agras T70/T70P.
```

No existe fallback automatico hacia FlightHub ni hacia legacy-direct.

## Variables

Ver tambien `.env.example`.

```text
DJI_GATEWAY_MODE=disabled
ALLOWED_ORIGINS=http://127.0.0.1:5500,http://localhost:5500
AUTH_MODE=off
MAX_JSON_BODY_BYTES=1048576
MAX_KMZ_BYTES=26214400
```

`AUTH_MODE=off` se permite solo en desarrollo o tests. En produccion el gateway
falla de forma cerrada si la autenticacion no esta configurada.

Modo JWT local:

```text
AUTH_MODE=oidc-jwt
AUTH_JWT_ISSUER=https://issuer.example
AUTH_JWT_AUDIENCE=geovision-gateway
AUTH_JWT_HS256_SECRET=<secret-from-secret-manager>
```

Guardar secretos en Google Secret Manager. No poner tokens permanentes en
`script.js` ni en el navegador.

## API

```text
GET  /healthz
GET  /v1/capabilities
POST /v1/agras/task-drafts
GET  /v1/agras/task-drafts/:id
```

`GET /healthz` es publico y solo muestra informacion no sensible.

Las rutas de borradores requieren autenticacion salvo `AUTH_MODE=off` en
desarrollo/tests.

El POST legacy `/` ya no envia nada a FlightHub salvo que el modo sea
explicitamente `flighthub-legacy`. En los modos nuevos devuelve una respuesta de
compatibilidad con `transmittedToDji: false`.

## Modelo de borrador

Este JSON es un modelo interno de GeoVision. No es una mision ejecutable y no se
declara compatible con DJI.

```json
{
  "schemaVersion": "geovision.agras.taskDraft.v1",
  "externalId": "lot-42",
  "name": "Lote norte prueba",
  "operationType": "spray",
  "fieldBoundary": {
    "type": "Polygon",
    "coordinates": [[
      [-65.20312, -26.83712],
      [-65.20288, -26.83712],
      [-65.20288, -26.83688],
      [-65.20312, -26.83688],
      [-65.20312, -26.83712]
    ]]
  },
  "exclusionZones": [],
  "desiredParameters": {
    "operatorApproved": false,
    "applicationRate": 12.5,
    "flightAltitudeMeters": 4,
    "swathWidthMeters": 7
  },
  "createdAt": "2026-08-10T12:00:00.000Z",
  "coordinateReferenceSystem": "EPSG:4326"
}
```

Validaciones incluidas:

- Campos obligatorios y tipos.
- Rechazo de propiedades inesperadas en el nivel superior, GeoJSON y parametros.
- Longitudes maximas de texto.
- Latitud entre `-90` y `90`.
- Longitud entre `-180` y `180`.
- Anillos cerrados con cantidad suficiente de puntos.
- Numeros finitos y positivos para parametros cuantitativos.
- Limite maximo del body JSON.
- `desiredParameters.operatorApproved` debe ser `false`.

## Ejemplos locales

```powershell
cd cloud-functions/gateway-dji-farm
npm.cmd install
npm.cmd run check
npm.cmd test
$env:DJI_GATEWAY_MODE='smartfarm-mock'
$env:AUTH_MODE='off'
$env:ALLOWED_ORIGINS='http://127.0.0.1:5500'
$env:PORT='8787'
npm.cmd start
```

Health:

```powershell
curl.exe -s http://127.0.0.1:8787/healthz
```

Capacidades:

```powershell
curl.exe -s http://127.0.0.1:8787/v1/capabilities
```

Crear borrador en mock:

```powershell
curl.exe -s -X POST http://127.0.0.1:8787/v1/agras/task-drafts `
  -H "Content-Type: application/json" `
  --data-binary "@draft.json"
```

Respuesta esperada en `smartfarm-mock`:

```json
{
  "id": "draft_...",
  "status": "DRAFT_NOT_SENT",
  "provider": "smartfarm-mock",
  "transmittedToDji": false,
  "executionAllowed": false,
  "warning": "Mock mode only. No information was sent to DJI and this is not an executable mission."
}
```

El mock guarda datos solo en memoria. Los borradores se pierden al reiniciar la
instancia.

## Produccion

Antes de conectar el entorno real se necesita documentacion oficial del programa
DJI Smart Farm Ecosystem para Agras T70/T70P. Hasta entonces:

- No configurar endpoints reales SmartFarm.
- No convertir KMZ/WPML en formato SmartFarm.
- No activar `flighthub-legacy` como camino Agras.
- No usar `--allow-unauthenticated` sin autenticacion valida en la aplicacion o
  una capa frontal equivalente.

El rate limiting de produccion debe implementarse en una capa distribuida como
Cloud Armor, API Gateway u otra solucion equivalente. No confiar en contadores
en memoria dentro de Cloud Run.

Los scripts `deploy` y `deploy:function` usan `--no-allow-unauthenticated` por
defecto. Si se expone publicamente, la aplicacion debe requerir y verificar
tokens validos.

## Tests

```powershell
npm.cmd run check
npm.cmd test
```

Las pruebas cubren:

- Health en `disabled`.
- No exposicion de secretos en `/healthz`.
- Rechazo de origen CORS no permitido.
- Rechazo de solicitudes sin autenticacion.
- Rechazo de geometria invalida.
- Creacion y consulta de borradores en `smartfarm-mock`.
- `transmittedToDji: false`.
- `smartfarm` no implementado con `501`.
- Imposibilidad de activar FlightHub desde otros modos.
- Limite de tamano de body.
