# GeoVision DJI Gateway

HTTP gateway used by the GeoVision PWA to send KMZ missions to DJI.

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
  "code_version": "geovision-gateway-2026-08-06"
}
```

## Deploy

Install and authenticate Google Cloud SDK first, then choose the project that owns the current public URL.

The current public URL contains project number `498689304873`:

```text
https://gateway-dji-farm-498689304873.southamerica-east1.run.app
```

Find the matching project ID:

```powershell
gcloud projects list --filter="projectNumber=498689304873" --format="table(projectId,projectNumber,name)"
```

Then set that project:

```powershell
gcloud auth login
gcloud config set project geovision-drones
gcloud config get-value project
```

Inspect both possible resource types. The old endpoint behavior (`GET` returns `405 Metodo no permitido`) means the URL has not received this version yet.

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

Both deploy scripts publish this folder as `gateway-dji-farm` in `southamerica-east1`.

After deployment:

```powershell
curl.exe -s https://gateway-dji-farm-498689304873.southamerica-east1.run.app
```

The response must include:

```json
"code_version": "geovision-gateway-2026-08-06"
```

If the PWA says the gateway version does not match, production is still running an older revision.

Last verified production revision:

```text
gateway-dji-farm-00020-gt6
```

Health check result:

```json
{
  "code_version": "geovision-gateway-2026-08-06",
  "configured": {
    "dji_app_key": true,
    "dji_app_secret": true
  }
}
```

Current DJI-side failure after the gateway deployment:

```text
ENOTFOUND https://uoms.dji.com/api/v1/login
```

That means the deployed gateway is now running the new code, but the configured DJI login host is not resolving from Cloud Run or the endpoint is not the correct DJI Cloud API endpoint.

You can also verify headers:

```powershell
curl.exe -s -i https://gateway-dji-farm-498689304873.southamerica-east1.run.app
```

Expected headers include:

```text
X-GeoVision-Gateway-Version: geovision-gateway-2026-08-06
access-control-allow-methods: GET, POST, OPTIONS
```

## Required environment variables

The service needs these Cloud Run environment variables before sending a real mission:

```text
DJI_APP_KEY
DJI_APP_SECRET
```

Optional overrides:

```text
DJI_LOGIN_URL
DJI_UPLOAD_URL
MAX_KMZ_BYTES
```
