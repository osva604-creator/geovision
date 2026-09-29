const axios = require("axios");
const FormData = require("form-data");
const crypto = require("crypto");
const { AppError } = require("../errors");

const KMZ_CONTENT_TYPE = "application/vnd.google-earth.kmz";

class FlightHubLegacyProvider {
  constructor(config, httpClient = axios) {
    this.provider = "flighthub-legacy";
    this.config = config.flighthubLegacy;
    this.maxKmzBytes = config.maxKmzBytes;
    this.http = httpClient;
  }

  getCapabilities() {
    return {
      provider: this.provider,
      supportsKmzUpload: true,
      supportsAgrasT70T70P: false,
      transmitsToDji: true,
      warning: "Legacy FlightHub compatibility only. This mode is not the SmartFarm integration for Agras T70/T70P."
    };
  }

  async uploadKmz(kmzBuffer, metadata) {
    if (!Buffer.isBuffer(kmzBuffer) || kmzBuffer.length === 0) {
      throw new AppError(400, "KMZ_REQUIRED", "A KMZ body is required.");
    }
    if (!looksLikeZip(kmzBuffer)) {
      throw new AppError(415, "INVALID_KMZ", "The body does not look like a KMZ/ZIP file.");
    }
    if (kmzBuffer.length > this.maxKmzBytes) {
      throw new AppError(413, "KMZ_TOO_LARGE", `KMZ exceeds ${this.maxKmzBytes} bytes.`);
    }
    if (!this.config.userToken || !this.config.projectUuid) {
      throw new AppError(503, "FLIGHTHUB_LEGACY_NOT_CONFIGURED", "FlightHub legacy mode is missing required credentials.", {
        missing: [
          ...(!this.config.userToken ? ["DJI_FLIGHTHUB_USER_TOKEN"] : []),
          ...(!this.config.projectUuid ? ["DJI_FLIGHTHUB_PROJECT_UUID"] : [])
        ]
      });
    }

    const stsData = await this.getTemporaryStorageCredentials();
    const objectKey = buildObjectKey(stsData.object_key_prefix, metadata.name);
    await uploadToStorage({
      httpClient: this.http,
      stsData,
      objectKey,
      kmzBuffer,
      storageUrlStyle: this.config.storageUrlStyle
    });

    const waylineResponse = await this.http.post(
      openApiUrl(this.config, "/wayline/finish-upload"),
      {
        name: metadata.name,
        object_key: objectKey
      },
      {
        headers: this.headers({ "Content-Type": "application/json" }),
        timeout: 30000
      }
    );

    const wayline = validateOpenApiResponse(waylineResponse, "FlightHub legacy finish upload");
    return {
      success: true,
      provider: this.provider,
      transmittedToDji: true,
      executionAllowed: false,
      status: "LEGACY_ROUTE_UPLOADED",
      warning: "Uploaded through legacy FlightHub compatibility, not SmartFarm Agras T70/T70P.",
      mission_name: metadata.name,
      mission_date: metadata.date,
      kmz_bytes: kmzBuffer.length,
      flight_hub: {
        wayline_uuid: wayline?.uuid || null,
        wayline_name: wayline?.name || metadata.name,
        storage: {
          provider: stsData?.provider || null,
          bucket: Boolean(stsData?.bucket),
          object_key: objectKey
        }
      }
    };
  }

  async getTemporaryStorageCredentials() {
    const response = await this.http.get(openApiUrl(this.config, "/project/sts-token"), {
      headers: this.headers(),
      timeout: 20000
    });
    return validateOpenApiResponse(response, "FlightHub legacy temporary credentials");
  }

  headers(extraHeaders = {}) {
    return {
      "X-Request-Id": crypto.randomUUID(),
      "X-Language": this.config.language,
      "X-Project-Uuid": this.config.projectUuid,
      "X-User-Token": this.config.userToken,
      ...extraHeaders
    };
  }
}

function openApiUrl(config, pathname) {
  const base = String(config.baseUrl || "").replace(/\/+$/, "");
  const prefix = `/${String(config.apiPrefix || "").replace(/^\/+|\/+$/g, "")}`;
  const path = String(pathname || "").startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${prefix}${path}`;
}

function validateOpenApiResponse(response, operation) {
  const payload = response?.data || {};
  if (Number(payload.code) !== 0) {
    throw new AppError(502, "FLIGHTHUB_LEGACY_ERROR", `${operation} failed.`, {
      djiCode: payload.code ?? null,
      djiMessage: payload.message || null
    });
  }
  return payload.data || {};
}

function looksLikeZip(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function normalizeName(name) {
  return (
    String(name || "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "geovision-mision"
  );
}

function buildObjectKey(prefix, missionName) {
  const cleanPrefix = String(prefix || "").replace(/^\/+|\/+$/g, "");
  return [cleanPrefix, crypto.randomUUID(), `${normalizeName(missionName)}.kmz`].filter(Boolean).join("/");
}

async function uploadToStorage({ httpClient, stsData, objectKey, kmzBuffer, storageUrlStyle }) {
  const credentials = extractStorageCredentials(stsData);
  if (!credentials.accessKeyId || !credentials.accessKeySecret) {
    throw new AppError(502, "FLIGHTHUB_STORAGE_CREDENTIALS_INCOMPLETE", "FlightHub returned incomplete storage credentials.");
  }

  const provider = String(stsData?.provider || "").toLowerCase();
  const uploadUrl = buildStorageUrl(stsData, objectKey, storageUrlStyle);
  if (!(provider.includes("ali") || provider.includes("oss"))) {
    throw new AppError(502, "FLIGHTHUB_STORAGE_PROVIDER_UNSUPPORTED", "Only Ali OSS storage signing is preserved in legacy mode.", {
      provider: stsData?.provider || null
    });
  }

  const date = new Date().toUTCString();
  const headers = {
    Date: date,
    "Content-Type": KMZ_CONTENT_TYPE,
    "Content-Length": kmzBuffer.length,
    ...(credentials.securityToken ? { "x-oss-security-token": credentials.securityToken } : {}),
    Authorization: signAliOss({
      method: "PUT",
      bucket: stsData.bucket,
      objectKey,
      contentType: KMZ_CONTENT_TYPE,
      date,
      credentials
    })
  };

  await httpClient.put(uploadUrl.toString(), kmzBuffer, {
    headers,
    maxBodyLength: Infinity,
    timeout: 60000
  });
}

function extractStorageCredentials(stsData) {
  const raw = stsData?.credentials || {};
  return {
    accessKeyId: raw.access_key_id || raw.accessKeyId || raw.AccessKeyId || "",
    accessKeySecret: raw.access_key_secret || raw.accessKeySecret || raw.AccessKeySecret || "",
    securityToken: raw.security_token || raw.securityToken || raw.SecurityToken || raw.token || ""
  };
}

function buildStorageUrl(stsData, objectKey, storageUrlStyle) {
  if (!stsData?.endpoint || !stsData?.bucket) {
    throw new AppError(502, "FLIGHTHUB_STORAGE_TARGET_INCOMPLETE", "FlightHub did not return endpoint or bucket.");
  }
  const url = new URL(stsData.endpoint);
  const encodedObjectKey = encodeObjectKey(objectKey);
  if (storageUrlStyle === "path") {
    url.pathname = `/${stsData.bucket}/${encodedObjectKey}`;
  } else {
    url.hostname = `${stsData.bucket}.${url.hostname}`;
    url.pathname = `/${encodedObjectKey}`;
  }
  return url;
}

function signAliOss({ method, bucket, objectKey, contentType, date, credentials }) {
  const canonicalHeaders = credentials.securityToken
    ? `x-oss-security-token:${credentials.securityToken}\n`
    : "";
  const canonicalResource = `/${bucket}/${objectKey}`;
  const stringToSign = `${method}\n\n${contentType}\n${date}\n${canonicalHeaders}${canonicalResource}`;
  const signature = crypto.createHmac("sha1", credentials.accessKeySecret).update(stringToSign, "utf8").digest("base64");
  return `OSS ${credentials.accessKeyId}:${signature}`;
}

function encodeObjectKey(objectKey) {
  return String(objectKey)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function getKmzBuffer(req) {
  if (Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) return req.rawBody;
  if (Buffer.isBuffer(req.body) && req.body.length > 0) return req.body;
  if (req.body instanceof Uint8Array && req.body.length > 0) return Buffer.from(req.body);
  if (typeof req.body === "string" && req.body.length > 0) return Buffer.from(req.body);
  return Buffer.alloc(0);
}

module.exports = {
  FlightHubLegacyProvider,
  getKmzBuffer
};
