const functions = require("@google-cloud/functions-framework");
const axios = require("axios");
const FormData = require("form-data");
const crypto = require("crypto");

const KMZ_CONTENT_TYPE = "application/vnd.google-earth.kmz";
const GATEWAY_CODE_VERSION = "geovision-gateway-2026-08-10";
const MAX_KMZ_BYTES = Number(process.env.MAX_KMZ_BYTES || 25 * 1024 * 1024);

const MODO_GATEWAY_RAW = String(process.env.DJI_GATEWAY_MODE || "flighthub-sync").trim().toLowerCase();
const MODOS_FLIGHTHUB = new Set(["flighthub", "flighthub-sync", "openapi"]);
const MODOS_LEGACY = new Set(["legacy", "legacy-direct", "direct", "dji-direct"]);

const DJI_LEGACY_LOGIN_URL = process.env.DJI_LOGIN_URL || "https://uoms.dji.com/api/v1/login";
const DJI_LEGACY_UPLOAD_URL = process.env.DJI_UPLOAD_URL || "https://uoms.dji.com/api/v1/mission-upload";

const DJI_FLIGHTHUB_REGION = String(process.env.DJI_FLIGHTHUB_REGION || "us").trim().toLowerCase();
const DJI_FLIGHTHUB_BASE_URL = quitarBarraFinal(
  process.env.DJI_FLIGHTHUB_BASE_URL || obtenerFlightHubBaseUrlPorRegion(DJI_FLIGHTHUB_REGION)
);
const DJI_FLIGHTHUB_API_PREFIX = normalizarPrefijoOpenApi(process.env.DJI_FLIGHTHUB_API_PREFIX || "/openapi/v0.1");
const DJI_FLIGHTHUB_LANGUAGE = process.env.DJI_FLIGHTHUB_LANGUAGE || "en";
const DJI_STORAGE_URL_STYLE = String(process.env.DJI_STORAGE_URL_STYLE || "virtual").trim().toLowerCase();

function obtenerFlightHubBaseUrlPorRegion(region) {
  const endpoints = {
    us: "https://es-flight-api-us.djigate.com",
    eu: "https://es-flight-api-eu.djigate.com",
    cn: "https://es-flight-api-cn.djigate.com"
  };
  return endpoints[region] || endpoints.us;
}

function quitarBarraFinal(valor) {
  return String(valor || "").replace(/\/+$/, "");
}

function normalizarPrefijoOpenApi(valor) {
  const limpio = String(valor || "").trim();
  if (!limpio) return "";
  return `/${limpio.replace(/^\/+|\/+$/g, "")}`;
}

function leerEnv(...nombres) {
  for (const nombre of nombres) {
    const valor = process.env[nombre];
    if (typeof valor === "string" && valor.trim()) {
      return valor.trim();
    }
  }
  return "";
}

function booleanEnv(nombre, defaultValue = false) {
  const valor = process.env[nombre];
  if (valor === undefined || valor === null || valor === "") return defaultValue;
  return /^(1|true|yes|si|on)$/i.test(String(valor).trim());
}

function numeroEnv(nombre, defaultValue) {
  const valor = Number(process.env[nombre]);
  return Number.isFinite(valor) ? valor : defaultValue;
}

function uuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function resolverModoGateway() {
  if (MODOS_FLIGHTHUB.has(MODO_GATEWAY_RAW)) return "flighthub-sync";
  if (MODOS_LEGACY.has(MODO_GATEWAY_RAW)) return "legacy-direct";
  return "flighthub-sync";
}

function normalizarNombreMision(nombreRaw) {
  return (
    String(nombreRaw || "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "geovision-mision"
  );
}

function obtenerBufferKMZ(req) {
  if (Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) {
    return req.rawBody;
  }
  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    return req.body;
  }
  if (req.body instanceof Uint8Array && req.body.length > 0) {
    return Buffer.from(req.body);
  }
  if (typeof req.body === "string" && req.body.length > 0) {
    return Buffer.from(req.body);
  }
  return Buffer.alloc(0);
}

function pareceKMZ(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function crearErrorOperacion(message, statusCode = 500, detalle = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (detalle) error.detalle = detalle;
  return error;
}

function obtenerConfigFlightHub() {
  return {
    baseUrl: DJI_FLIGHTHUB_BASE_URL,
    apiPrefix: DJI_FLIGHTHUB_API_PREFIX,
    userToken: leerEnv("DJI_FLIGHTHUB_USER_TOKEN", "DJI_USER_TOKEN", "DJI_ORGANIZATION_KEY"),
    projectUuid: leerEnv("DJI_FLIGHTHUB_PROJECT_UUID", "DJI_PROJECT_UUID"),
    dockSn: leerEnv("DJI_FLIGHTHUB_DOCK_SN", "DJI_DOCK_SN"),
    crearTarea: booleanEnv("DJI_CREATE_FLIGHT_TASK", false),
    taskEndpoint: process.env.DJI_FLIGHTHUB_TASK_ENDPOINT || "/flight-task"
  };
}

function obtenerConfigLegacy() {
  return {
    appKey: leerEnv("DJI_APP_KEY"),
    appSecret: leerEnv("DJI_APP_SECRET"),
    loginUrl: DJI_LEGACY_LOGIN_URL,
    uploadUrl: DJI_LEGACY_UPLOAD_URL
  };
}

function crearDiagnosticoConfiguracion() {
  const mode = resolverModoGateway();
  const flightHub = obtenerConfigFlightHub();
  const legacy = obtenerConfigLegacy();
  const missing = [];

  if (mode === "flighthub-sync") {
    if (!flightHub.baseUrl) missing.push("DJI_FLIGHTHUB_BASE_URL");
    if (!flightHub.userToken) missing.push("DJI_FLIGHTHUB_USER_TOKEN");
    if (!flightHub.projectUuid) missing.push("DJI_FLIGHTHUB_PROJECT_UUID");
    if (flightHub.crearTarea && !flightHub.dockSn) missing.push("DJI_FLIGHTHUB_DOCK_SN");
  } else {
    if (!legacy.appKey) missing.push("DJI_APP_KEY");
    if (!legacy.appSecret) missing.push("DJI_APP_SECRET");
  }

  return {
    mode,
    ready: missing.length === 0,
    missing,
    flight_hub: {
      base_url: flightHub.baseUrl,
      api_prefix: flightHub.apiPrefix,
      region: DJI_FLIGHTHUB_REGION,
      user_token: Boolean(flightHub.userToken),
      project_uuid: Boolean(flightHub.projectUuid),
      auto_create_task: flightHub.crearTarea,
      dock_sn: Boolean(flightHub.dockSn),
      storage_url_style: DJI_STORAGE_URL_STYLE
    },
    legacy_direct: {
      dji_app_key: Boolean(legacy.appKey),
      dji_app_secret: Boolean(legacy.appSecret),
      login_url: legacy.loginUrl,
      upload_url: legacy.uploadUrl
    }
  };
}

function crearEstadoGateway() {
  const configured = crearDiagnosticoConfiguracion();
  return {
    success: true,
    service: "gateway-dji-farm",
    code_version: GATEWAY_CODE_VERSION,
    revision: process.env.K_REVISION || null,
    region: process.env.FUNCTION_REGION || process.env.K_REGION || "unknown",
    configured,
    capabilities: {
      wayline_upload: configured.mode === "flighthub-sync",
      flight_task_create: configured.mode === "flighthub-sync" && configured.flight_hub.auto_create_task,
      legacy_mission_upload: configured.mode === "legacy-direct"
    },
    limits: {
      max_kmz_bytes: MAX_KMZ_BYTES
    },
    expected_request: {
      method: "POST",
      content_type: KMZ_CONTENT_TYPE,
      headers: ["X-Mission-Name", "X-Mission-Date"]
    },
    diagnostics: {
      flight_hub_probe: "GET ?probe=flightHub"
    }
  };
}

function urlFlightHub(pathname) {
  const path = String(pathname || "").startsWith("/") ? pathname : `/${pathname}`;
  return `${DJI_FLIGHTHUB_BASE_URL}${DJI_FLIGHTHUB_API_PREFIX}${path}`;
}

function headersFlightHub(extraHeaders = {}) {
  const config = obtenerConfigFlightHub();
  return {
    "X-Request-Id": uuid(),
    "X-Language": DJI_FLIGHTHUB_LANGUAGE,
    "X-Project-Uuid": config.projectUuid,
    "X-User-Token": config.userToken,
    ...extraHeaders
  };
}

function validarRespuestaOpenApi(response, operacion) {
  const payload = response?.data || {};
  if (Number(payload.code) !== 0) {
    throw crearErrorOperacion(
      `${operacion} devolvio codigo DJI ${payload.code ?? "desconocido"}`,
      502,
      {
        message: payload.message || null,
        data: payload.data || null
      }
    );
  }
  return payload.data || {};
}

async function obtenerCredencialesTemporalesFlightHub() {
  const response = await axios.get(urlFlightHub("/project/sts-token"), {
    headers: headersFlightHub(),
    timeout: 20000
  });
  return validarRespuestaOpenApi(response, "Credenciales temporales FlightHub");
}

function obtenerAccessTokenLegacy(djiAuthResponse) {
  return (
    djiAuthResponse?.data?.data?.access_token ||
    djiAuthResponse?.data?.access_token ||
    djiAuthResponse?.data?.token ||
    null
  );
}

function hmac(algoritmo, key, data, output) {
  return crypto.createHmac(algoritmo, key).update(data, "utf8").digest(output);
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function encodeObjectKey(objectKey) {
  return String(objectKey)
    .split("/")
    .map((parte) => encodeURIComponent(parte))
    .join("/");
}

function construirObjectKey(prefix, missionName) {
  const prefijo = String(prefix || "").replace(/^\/+|\/+$/g, "");
  const nombreArchivo = `${normalizarNombreMision(missionName)}.kmz`;
  return [prefijo, uuid(), nombreArchivo].filter(Boolean).join("/");
}

function extraerCredencialesStorage(stsData) {
  const raw = stsData?.credentials || {};
  return {
    accessKeyId: raw.access_key_id || raw.accessKeyId || raw.AccessKeyId || "",
    accessKeySecret: raw.access_key_secret || raw.accessKeySecret || raw.AccessKeySecret || "",
    securityToken: raw.security_token || raw.securityToken || raw.SecurityToken || raw.token || ""
  };
}

function crearStorageUrl(stsData, objectKey) {
  const endpoint = stsData?.endpoint;
  const bucket = stsData?.bucket;
  if (!endpoint || !bucket) {
    throw crearErrorOperacion("DJI no devolvio endpoint o bucket de storage", 502, {
      endpoint: Boolean(endpoint),
      bucket: Boolean(bucket)
    });
  }

  const url = new URL(endpoint);
  const encodedObjectKey = encodeObjectKey(objectKey);
  if (DJI_STORAGE_URL_STYLE === "path") {
    url.pathname = `/${bucket}/${encodedObjectKey}`;
  } else {
    url.hostname = `${bucket}.${url.hostname}`;
    url.pathname = `/${encodedObjectKey}`;
  }
  return url;
}

function firmarAliOss({ method, bucket, objectKey, contentType, date, credentials }) {
  const canonicalHeaders = credentials.securityToken
    ? `x-oss-security-token:${credentials.securityToken}\n`
    : "";
  const canonicalResource = `/${bucket}/${objectKey}`;
  const stringToSign = `${method}\n\n${contentType}\n${date}\n${canonicalHeaders}${canonicalResource}`;
  const signature = hmac("sha1", credentials.accessKeySecret, stringToSign, "base64");
  return `OSS ${credentials.accessKeyId}:${signature}`;
}

function fechaAws(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8)
  };
}

function firmarAwsS3({ method, uploadUrl, region, objectKey, contentType, body, credentials }) {
  const parsedUrl = new URL(uploadUrl);
  const payloadHash = sha256Hex(body);
  const { amzDate, dateStamp } = fechaAws();
  const headers = {
    "content-type": contentType,
    host: parsedUrl.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };

  if (credentials.securityToken) {
    headers["x-amz-security-token"] = credentials.securityToken;
  }

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]}`)
    .join("\n");
  const canonicalUri = DJI_STORAGE_URL_STYLE === "path"
    ? parsedUrl.pathname
    : `/${encodeObjectKey(objectKey)}`;
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${dateStamp}/${region || "us-east-1"}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const kDate = hmac("sha256", `AWS4${credentials.accessKeySecret}`, dateStamp);
  const kRegion = crypto.createHmac("sha256", kDate).update(region || "us-east-1", "utf8").digest();
  const kService = crypto.createHmac("sha256", kRegion).update("s3", "utf8").digest();
  const kSigning = crypto.createHmac("sha256", kService).update("aws4_request", "utf8").digest();
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return {
    "Content-Type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(credentials.securityToken ? { "x-amz-security-token": credentials.securityToken } : {}),
    Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

async function subirObjetoStorage(stsData, objectKey, kmzBuffer) {
  const credentials = extraerCredencialesStorage(stsData);
  if (!credentials.accessKeyId || !credentials.accessKeySecret) {
    throw crearErrorOperacion("DJI devolvio credenciales de storage incompletas", 502);
  }

  const provider = String(stsData?.provider || "").toLowerCase();
  const uploadUrl = crearStorageUrl(stsData, objectKey);
  const method = "PUT";
  let headers;

  if (provider.includes("ali") || provider.includes("oss")) {
    const date = new Date().toUTCString();
    headers = {
      Date: date,
      "Content-Type": KMZ_CONTENT_TYPE,
      "Content-Length": kmzBuffer.length,
      ...(credentials.securityToken ? { "x-oss-security-token": credentials.securityToken } : {}),
      Authorization: firmarAliOss({
        method,
        bucket: stsData.bucket,
        objectKey,
        contentType: KMZ_CONTENT_TYPE,
        date,
        credentials
      })
    };
  } else if (provider.includes("aws") || provider.includes("s3")) {
    headers = firmarAwsS3({
      method,
      uploadUrl: uploadUrl.toString(),
      region: stsData.region,
      objectKey,
      contentType: KMZ_CONTENT_TYPE,
      body: kmzBuffer,
      credentials
    });
  } else {
    throw crearErrorOperacion(`Proveedor de storage DJI no soportado: ${stsData?.provider || "sin provider"}`, 502);
  }

  await axios.put(uploadUrl.toString(), kmzBuffer, {
    headers,
    maxBodyLength: Infinity,
    timeout: 60000
  });

  return {
    provider: stsData.provider,
    bucket: stsData.bucket,
    object_key: objectKey
  };
}

async function crearTareaFlightHub(waylineUuid, missionName) {
  const config = obtenerConfigFlightHub();
  if (!config.crearTarea) return null;

  const fileField = process.env.DJI_FLIGHTHUB_TASK_FILE_FIELD || "fileId";
  const payload = {
    name: missionName,
    [fileField]: waylineUuid,
    dockSn: config.dockSn,
    waylineType: process.env.DJI_FLIGHTHUB_WAYLINE_TYPE || "WAYPOINT",
    taskType: process.env.DJI_FLIGHTHUB_TASK_TYPE || "IMMEDIATE",
    rthAltitude: numeroEnv("DJI_FLIGHTHUB_RTH_ALTITUDE", 50),
    outOfControlAction: process.env.DJI_FLIGHTHUB_OUT_OF_CONTROL_ACTION || "RETURN_TO_HOME",
    minBatteryCapacity: numeroEnv("DJI_FLIGHTHUB_MIN_BATTERY", 50),
    minStorageCapacity: numeroEnv("DJI_FLIGHTHUB_MIN_STORAGE", 0)
  };

  const response = await axios.post(urlFlightHub(config.taskEndpoint), payload, {
    headers: headersFlightHub({ "Content-Type": "application/json" }),
    timeout: 30000
  });
  const data = validarRespuestaOpenApi(response, "Crear tarea FlightHub");
  return {
    request: payload,
    response: data
  };
}

async function enviarAFlightHub(kmzBuffer, missionName, missionDate) {
  const stsData = await obtenerCredencialesTemporalesFlightHub();
  const objectKey = construirObjectKey(stsData.object_key_prefix, missionName);
  const storage = await subirObjetoStorage(stsData, objectKey, kmzBuffer);

  const finishResponse = await axios.post(
    urlFlightHub("/wayline/finish-upload"),
    {
      name: missionName,
      object_key: objectKey
    },
    {
      headers: headersFlightHub({ "Content-Type": "application/json" }),
      timeout: 30000
    }
  );
  const wayline = validarRespuestaOpenApi(finishResponse, "Notificar carga de ruta FlightHub");
  const task = wayline?.uuid ? await crearTareaFlightHub(wayline.uuid, missionName) : null;

  return {
    success: true,
    mode: "flighthub-sync",
    message: task ? "Ruta subida y tarea de vuelo creada en FlightHub" : "Ruta de vuelo subida a FlightHub",
    code_version: GATEWAY_CODE_VERSION,
    mission_name: missionName,
    mission_date: missionDate,
    kmz_bytes: kmzBuffer.length,
    flight_hub: {
      wayline_name: wayline?.name || missionName,
      wayline_uuid: wayline?.uuid || null,
      storage,
      flight_task: task
    }
  };
}

async function probarCredencialesFlightHub() {
  const configured = crearDiagnosticoConfiguracion();
  if (configured.mode !== "flighthub-sync") {
    throw crearErrorOperacion("El probe FlightHub solo esta disponible en modo flighthub-sync", 400, {
      mode: configured.mode
    });
  }
  if (!configured.ready) {
    throw crearErrorOperacion("Gateway DJI no configurado", 503, {
      mode: configured.mode,
      missing: configured.missing
    });
  }

  const stsData = await obtenerCredencialesTemporalesFlightHub();
  return {
    success: true,
    service: "gateway-dji-farm",
    code_version: GATEWAY_CODE_VERSION,
    probe: "flightHub",
    configured,
    flight_hub: {
      auth: true,
      storage: {
        provider: stsData?.provider || null,
        region: stsData?.region || null,
        endpoint: Boolean(stsData?.endpoint),
        bucket: Boolean(stsData?.bucket),
        object_key_prefix: Boolean(stsData?.object_key_prefix),
        credentials: Boolean(stsData?.credentials)
      }
    }
  };
}

async function enviarLegacyDirect(kmzBuffer, missionName, missionDate) {
  const config = obtenerConfigLegacy();
  const djiAuthResponse = await axios.post(
    config.loginUrl,
    {
      app_key: config.appKey,
      app_secret: config.appSecret
    },
    { timeout: 15000 }
  );

  const accessToken = obtenerAccessTokenLegacy(djiAuthResponse);
  if (!accessToken) {
    throw crearErrorOperacion("DJI no devolvio access_token", 502, djiAuthResponse?.data || null);
  }

  const form = new FormData();
  form.append("file", kmzBuffer, {
    filename: `${missionName}.kmz`,
    contentType: KMZ_CONTENT_TYPE
  });

  const djiUploadResponse = await axios.post(config.uploadUrl, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${accessToken}`
    },
    maxBodyLength: Infinity,
    timeout: 30000
  });

  const djiData = djiUploadResponse?.data || null;
  return {
    success: true,
    mode: "legacy-direct",
    message: "Mision despachada al endpoint DJI legacy",
    code_version: GATEWAY_CODE_VERSION,
    mission_name: missionName,
    mission_date: missionDate,
    kmz_bytes: kmzBuffer.length,
    dji_ref: djiData?.data?.job_id || djiData?.data?.id || null,
    dji_response: djiData
  };
}

function formatearErrorDJI(error) {
  if (!error) return "Error desconocido";
  if (error.detalle) {
    return `${error.message}: ${JSON.stringify(error.detalle)}`;
  }
  if (error.code === "ENOTFOUND") {
    return `No se pudo resolver el host DJI (ENOTFOUND). URL probada: ${error.config?.url || "sin url"}`;
  }
  if (error.response) {
    const respuesta = error.response.data || error.response.statusText || error.message;
    return `HTTP ${error.response.status}: ${JSON.stringify(respuesta)}`;
  }
  if (error.request) {
    return error.message || "No hubo respuesta del servidor DJI.";
  }
  return error.message || String(error);
}

function responderErrorGateway(res, error) {
  const statusCode = error?.statusCode || (error?.response ? 502 : 500);
  const detalle = formatearErrorDJI(error);
  console.error("Error en el gateway DJI:", detalle, {
    code: error?.code,
    url: error?.config?.url,
    method: error?.config?.method,
    status: error?.response?.status,
    statusText: error?.response?.statusText
  });
  return res.status(statusCode).json({
    success: false,
    error: error?.message || "Falla en el despacho a DJI",
    code_version: GATEWAY_CODE_VERSION,
    detalle,
    configured: crearDiagnosticoConfiguracion()
  });
}

/**
 * Gateway GeoVision -> DJI FlightHub/Cloud
 * Region sugerida: southamerica-east1
 */
functions.http("gateway-dji-farm", async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, X-Mission-Name, X-Mission-Date"
  );
  res.set("Access-Control-Max-Age", "3600");
  res.set("X-GeoVision-Gateway-Version", GATEWAY_CODE_VERSION);

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method === "GET" || req.method === "HEAD") {
    const probe = String(req.query?.probe || "").trim().toLowerCase();
    if (req.method === "GET" && ["dji", "flighthub", "flightHub", "credentials"].includes(probe)) {
      try {
        return res.status(200).json(await probarCredencialesFlightHub());
      } catch (error) {
        return responderErrorGateway(res, error);
      }
    }
    return res.status(200).json(crearEstadoGateway());
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Metodo no permitido" });
  }

  try {
    const configured = crearDiagnosticoConfiguracion();
    if (!configured.ready) {
      throw crearErrorOperacion("Gateway DJI no configurado", 503, {
        mode: configured.mode,
        missing: configured.missing
      });
    }

    const missionName = normalizarNombreMision(req.get("X-Mission-Name"));
    const missionDate = req.get("X-Mission-Date") || new Date().toISOString();
    const kmzBuffer = obtenerBufferKMZ(req);

    if (!kmzBuffer.length) {
      throw crearErrorOperacion("No se recibio archivo KMZ en el body", 400);
    }
    if (!pareceKMZ(kmzBuffer)) {
      throw crearErrorOperacion("El body recibido no parece ser un KMZ/ZIP valido", 415);
    }
    if (kmzBuffer.length > MAX_KMZ_BYTES) {
      throw crearErrorOperacion(`El KMZ excede el limite de ${MAX_KMZ_BYTES} bytes`, 413);
    }

    console.info("Mision recibida:", {
      missionName,
      missionDate,
      bytes: kmzBuffer.length,
      mode: configured.mode,
      code_version: GATEWAY_CODE_VERSION
    });

    const resultado = configured.mode === "flighthub-sync"
      ? await enviarAFlightHub(kmzBuffer, missionName, missionDate)
      : await enviarLegacyDirect(kmzBuffer, missionName, missionDate);

    return res.status(200).json(resultado);
  } catch (error) {
    return responderErrorGateway(res, error);
  }
});
