# GeoVision DJI Gateway

HTTP gateway used by the GeoVision PWA to send generated WPML/KMZ missions to DJI.

The default integration mode is `flighthub-sync`: the gateway requests temporary
FlightHub storage credentials, uploads the KMZ, and calls the FlightHub OpenAPI
`/wayline/finish-upload` endpoint so the route appears in FlightHub.

References:

- FlightHub Sync maps storage credentials to `/openapi/v0.1/project/sts-token`.
- FlightHub Sync maps route upload notification to `/openapi/v0.1/wayline/finish-upload`.
- FlightHub Sync maps task creation to `/openapi/v0.1/flight-task`.

## Local check

```powershell
npm.cmd install
npm.cmd run check
$env:PORT='8787'; npm.cmd start
```

In another terminal:

```powershell
curl.exe -s http://127.0.0.1:8787
```

Expected response includes:

```json
{
  "success": true,
  "service": "gateway-dji-farm",
  "code_version": "geovision-gateway-2026-08-10",
  "configured": {
    "mode": "flighthub-sync",
    "ready": false,
    "missing": [
      "DJI_FLIGHTHUB_USER_TOKEN",
      "DJI_FLIGHTHUB_PROJECT_UUID"
    ]
  }
}
```

## FlightHub Sync configuration

Required Cloud Run environment variables:

```text
DJI_GATEWAY_MODE=flighthub-sync
DJI_FLIGHTHUB_USER_TOKEN=<Organization Key / X-User-Token>
DJI_FLIGHTHUB_PROJECT_UUID=<Project UUID / X-Project-Uuid>
```

Optional:

```text
DJI_FLIGHTHUB_REGION=us
DJI_FLIGHTHUB_BASE_URL=https://es-flight-api-us.djigate.com
DJI_FLIGHTHUB_API_PREFIX=/openapi/v0.1
DJI_FLIGHTHUB_LANGUAGE=en
DJI_STORAGE_URL_STYLE=virtual
MAX_KMZ_BYTES=26214400
```

Supported `DJI_FLIGHTHUB_REGION` values are `us`, `eu`, and `cn`. Use
`DJI_FLIGHTHUB_BASE_URL` when DJI gives you a specific public-cloud or
on-premises OpenAPI host.

Validate FlightHub credentials without uploading a KMZ:

```powershell
curl.exe -s "https://gateway-dji-farm-498689304873.southamerica-east1.run.app?probe=flightHub"
```

If the token is wrong, DJI responds through the gateway with a `502` and the DJI
error code, for example `200401 invalid token format`.

To create a FlightHub task after uploading the route:

```text
DJI_CREATE_FLIGHT_TASK=true
DJI_FLIGHTHUB_DOCK_SN=<dock serial number>
```

Optional task overrides:

```text
DJI_FLIGHTHUB_TASK_ENDPOINT=/flight-task
DJI_FLIGHTHUB_TASK_FILE_FIELD=fileId
DJI_FLIGHTHUB_WAYLINE_TYPE=WAYPOINT
DJI_FLIGHTHUB_TASK_TYPE=IMMEDIATE
DJI_FLIGHTHUB_RTH_ALTITUDE=50
DJI_FLIGHTHUB_OUT_OF_CONTROL_ACTION=RETURN_TO_HOME
DJI_FLIGHTHUB_MIN_BATTERY=50
DJI_FLIGHTHUB_MIN_STORAGE=0
```

## Legacy direct mode

The older experimental mode is still available, but it is no longer the default:

```text
DJI_GATEWAY_MODE=legacy-direct
DJI_APP_KEY=<legacy app key>
DJI_APP_SECRET=<legacy app secret>
DJI_LOGIN_URL=<legacy login url>
DJI_UPLOAD_URL=<legacy upload url>
```

Use this only if DJI provides a direct mission upload API for your account.

## Deploy

The current public URL contains project number `498689304873`:

```text
https://gateway-dji-farm-498689304873.southamerica-east1.run.app
```

Find the matching project ID:

```powershell
gcloud projects list --filter="projectNumber=498689304873" --format="table(projectId,projectNumber,name)"
```

Set the project:

```powershell
gcloud auth login
gcloud config set project geovision-drones
gcloud config get-value project
```

Inspect both possible resource types:

```powershell
npm.cmd run describe
npm.cmd run describe:function
```

If the service exists as a plain Cloud Run service, deploy with:

```powershell
npm.cmd run deploy
```

If it exists as a Cloud Functions Gen2 / Cloud Run Function resource, deploy with:

```powershell
npm.cmd run deploy:function
```

After deployment:

```powershell
curl.exe -s https://gateway-dji-farm-498689304873.southamerica-east1.run.app
```

The response must include:

```json
"code_version": "geovision-gateway-2026-08-10"
```

If the PWA says the gateway version does not match, production is still running an older revision.
