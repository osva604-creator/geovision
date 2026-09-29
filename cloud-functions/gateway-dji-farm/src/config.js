const GATEWAY_CODE_VERSION = "geovision-gateway-2026-08-10";

const MODES = new Set(["disabled", "smartfarm-mock", "smartfarm", "flighthub-legacy"]);
const AUTH_MODES = new Set(["off", "oidc-jwt"]);

function readList(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readPositiveInteger(raw, fallback) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readBoolean(raw, fallback = false) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  return /^(1|true|yes|si|on)$/i.test(String(raw).trim());
}

function isProductionRuntime(env) {
  return env.NODE_ENV === "production" || Boolean(env.K_SERVICE || env.K_REVISION);
}

function loadConfig(env = process.env) {
  const requestedMode = String(env.DJI_GATEWAY_MODE || "disabled").trim();
  const mode = MODES.has(requestedMode) ? requestedMode : requestedMode || "disabled";
  const configErrors = [];
  const production = isProductionRuntime(env);
  const authMode = String(env.AUTH_MODE || (production ? "oidc-jwt" : "off")).trim();

  if (!MODES.has(mode)) {
    configErrors.push({
      code: "UNSUPPORTED_GATEWAY_MODE",
      message: `Unsupported DJI_GATEWAY_MODE: ${mode}`
    });
  }

  if (!AUTH_MODES.has(authMode)) {
    configErrors.push({
      code: "UNSUPPORTED_AUTH_MODE",
      message: `Unsupported AUTH_MODE: ${authMode}`
    });
  }

  if (production && authMode === "off") {
    configErrors.push({
      code: "AUTH_OFF_NOT_ALLOWED_IN_PRODUCTION",
      message: "AUTH_MODE=off is allowed only in development or tests."
    });
  }

  if (authMode === "oidc-jwt") {
    if (!env.AUTH_JWT_ISSUER) {
      configErrors.push({ code: "AUTH_JWT_ISSUER_REQUIRED", message: "AUTH_JWT_ISSUER is required." });
    }
    if (!env.AUTH_JWT_AUDIENCE) {
      configErrors.push({ code: "AUTH_JWT_AUDIENCE_REQUIRED", message: "AUTH_JWT_AUDIENCE is required." });
    }
    if (!env.AUTH_JWT_HS256_SECRET) {
      configErrors.push({
        code: "AUTH_JWT_HS256_SECRET_REQUIRED",
        message: "AUTH_JWT_HS256_SECRET is required for local JWT verification."
      });
    }
  }

  return {
    serviceName: "gateway-dji-farm",
    codeVersion: GATEWAY_CODE_VERSION,
    mode,
    configErrors,
    production,
    allowedOrigins: readList(env.ALLOWED_ORIGINS),
    maxJsonBodyBytes: readPositiveInteger(env.MAX_JSON_BODY_BYTES, 1024 * 1024),
    maxKmzBytes: readPositiveInteger(env.MAX_KMZ_BYTES, 25 * 1024 * 1024),
    auth: {
      mode: AUTH_MODES.has(authMode) ? authMode : "oidc-jwt",
      issuer: env.AUTH_JWT_ISSUER || "",
      audience: env.AUTH_JWT_AUDIENCE || "",
      hs256Secret: env.AUTH_JWT_HS256_SECRET || ""
    },
    smartfarm: {
      officialDocsAvailable: readBoolean(env.DJI_SMARTFARM_OFFICIAL_DOCS_AVAILABLE, false)
    },
    flighthubLegacy: {
      baseUrl: env.DJI_FLIGHTHUB_BASE_URL || "https://es-flight-api-us.djigate.com",
      apiPrefix: env.DJI_FLIGHTHUB_API_PREFIX || "/openapi/v0.1",
      language: env.DJI_FLIGHTHUB_LANGUAGE || "en",
      storageUrlStyle: env.DJI_STORAGE_URL_STYLE || "virtual",
      userToken: env.DJI_FLIGHTHUB_USER_TOKEN || "",
      projectUuid: env.DJI_FLIGHTHUB_PROJECT_UUID || "",
      createFlightTask: readBoolean(env.DJI_CREATE_FLIGHT_TASK, false),
      dockSn: env.DJI_FLIGHTHUB_DOCK_SN || "",
      legacyLoginUrl: env.DJI_LOGIN_URL || "https://uoms.dji.com/api/v1/login",
      legacyUploadUrl: env.DJI_UPLOAD_URL || "https://uoms.dji.com/api/v1/mission-upload",
      legacyAppKey: env.DJI_APP_KEY || "",
      legacyAppSecret: env.DJI_APP_SECRET || ""
    }
  };
}

function safeConfigSummary(config) {
  const missing = [];
  if (config.mode === "flighthub-legacy") {
    if (!config.flighthubLegacy.userToken) missing.push("DJI_FLIGHTHUB_USER_TOKEN");
    if (!config.flighthubLegacy.projectUuid) missing.push("DJI_FLIGHTHUB_PROJECT_UUID");
  }

  return {
    mode: config.mode,
    ready: config.configErrors.length === 0 && missing.length === 0,
    missing,
    auth: {
      mode: config.auth.mode,
      enabled: config.auth.mode !== "off",
      configured: config.auth.mode === "off" || (
        Boolean(config.auth.issuer) &&
        Boolean(config.auth.audience) &&
        Boolean(config.auth.hs256Secret)
      )
    },
    cors: {
      allowed_origins_count: config.allowedOrigins.length
    },
    config_errors: config.configErrors.map((error) => error.code)
  };
}

module.exports = {
  GATEWAY_CODE_VERSION,
  loadConfig,
  safeConfigSummary
};
