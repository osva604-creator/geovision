const { loadConfig, safeConfigSummary } = require("./config");
const { AppError, isAppError } = require("./errors");
const { getHeader, parseUrl, readJsonBody, sendJson, setHeader } = require("./http");
const { attachRequestId } = require("./middleware/request-id");
const { applyCors } = require("./middleware/cors");
const { requireAuth } = require("./middleware/auth");
const { normalizeTaskDraft, SCHEMA_VERSION, CRS } = require("./domain/task-draft");
const { SmartFarmMockProvider } = require("./providers/smartfarm-mock");
const { SmartFarmProvider } = require("./providers/smartfarm");
const { FlightHubLegacyProvider, getKmzBuffer } = require("./providers/flighthub-legacy");

function createApp(options = {}) {
  const config = loadConfig(options.env || process.env);
  const providers = {
    smartfarmMock: options.smartfarmMockProvider || new SmartFarmMockProvider(),
    smartfarm: options.smartfarmProvider || new SmartFarmProvider(),
    flighthubLegacy: options.flighthubLegacyProvider || new FlightHubLegacyProvider(config, options.httpClient)
  };
  const now = options.now || (() => new Date());

  return async function gateway(req, res) {
    attachRequestId(req, res);
    setHeader(res, "X-GeoVision-Gateway-Version", config.codeVersion);

    try {
      applyCors(req, res, config);
      if (req.method === "OPTIONS") {
        setHeader(res, "Content-Length", "0");
        if (typeof res.status === "function" && typeof res.send === "function") {
          return res.status(204).send("");
        }
        res.statusCode = 204;
        return res.end("");
      }

      const url = parseUrl(req);
      const pathname = normalizePath(url.pathname);

      if ((req.method === "GET" || req.method === "HEAD") && (pathname === "/" || pathname === "/healthz")) {
        return sendJson(res, 200, buildHealth(config));
      }

      if (req.method === "GET" && pathname === "/v1/capabilities") {
        return sendJson(res, 200, buildCapabilities(config, providers));
      }

      if (req.method === "POST" && pathname === "/v1/agras/task-drafts") {
        requireAuth(req, config);
        const body = await readJsonBody(req, config.maxJsonBodyBytes);
        const draft = normalizeTaskDraft(body, now());
        return sendJson(res, 201, await createTaskDraft(config, providers, draft));
      }

      const draftMatch = /^\/v1\/agras\/task-drafts\/([^/]+)$/.exec(pathname);
      if (req.method === "GET" && draftMatch) {
        requireAuth(req, config);
        return sendJson(res, 200, await getTaskDraft(config, providers, decodeURIComponent(draftMatch[1])));
      }

      if (req.method === "POST" && pathname === "/") {
        return handleLegacyPost(req, res, config, providers);
      }

      throw new AppError(404, "NOT_FOUND", "Route not found.");
    } catch (error) {
      return handleError(req, res, config, error);
    }
  };
}

function buildHealth(config) {
  return {
    success: true,
    service: config.serviceName,
    code_version: config.codeVersion,
    revision: process.env.K_REVISION || null,
    configured: safeConfigSummary(config),
    smartfarm: {
      real_adapter_implemented: false,
      official_docs_required: true
    }
  };
}

function buildCapabilities(config, providers) {
  return {
    success: true,
    service: config.serviceName,
    code_version: config.codeVersion,
    configured: safeConfigSummary(config),
    schema: {
      taskDraft: SCHEMA_VERSION,
      coordinateReferenceSystem: CRS
    },
    modes: {
      disabled: {
        default: true,
        transmitsToDji: false,
        executionAllowed: false
      },
      "smartfarm-mock": providers.smartfarmMock.getCapabilities(),
      smartfarm: providers.smartfarm.getCapabilities(),
      "flighthub-legacy": providers.flighthubLegacy.getCapabilities()
    }
  };
}

async function createTaskDraft(config, providers, draft) {
  if (config.mode === "disabled") {
    throw new AppError(503, "GATEWAY_DISABLED", "DJI gateway is disabled. No data was sent to DJI.");
  }
  if (config.mode === "smartfarm-mock") {
    return providers.smartfarmMock.createTaskDraft(draft);
  }
  if (config.mode === "smartfarm") {
    return providers.smartfarm.createTaskDraft(draft);
  }
  if (config.mode === "flighthub-legacy") {
    throw new AppError(
      409,
      "AGRAS_SMARTFARM_NOT_AVAILABLE_IN_FLIGHTHUB_LEGACY",
      "FlightHub legacy mode is not compatible with the Agras T70/T70P SmartFarm task-draft API."
    );
  }
  throw invalidMode(config.mode);
}

async function getTaskDraft(config, providers, id) {
  if (config.mode === "disabled") {
    throw new AppError(503, "GATEWAY_DISABLED", "DJI gateway is disabled. No data was sent to DJI.");
  }
  if (config.mode === "smartfarm-mock") {
    return providers.smartfarmMock.getTaskDraft(id);
  }
  if (config.mode === "smartfarm") {
    return providers.smartfarm.getTaskDraft(id);
  }
  if (config.mode === "flighthub-legacy") {
    throw new AppError(
      409,
      "AGRAS_SMARTFARM_NOT_AVAILABLE_IN_FLIGHTHUB_LEGACY",
      "FlightHub legacy mode is not compatible with Agras T70/T70P SmartFarm task drafts."
    );
  }
  throw invalidMode(config.mode);
}

async function handleLegacyPost(req, res, config, providers) {
  if (config.mode !== "flighthub-legacy") {
    return sendJson(res, 409, {
      success: false,
      code: "LEGACY_KMZ_ROUTE_DISABLED",
      message: "Legacy KMZ/WPML upload is disabled for the current gateway mode. No information was sent to DJI.",
      provider: config.mode,
      transmittedToDji: false,
      executionAllowed: false,
      frontendMigrationRequired: "Use POST /v1/agras/task-drafts with the neutral Agras task-draft JSON model."
    });
  }

  requireAuth(req, config);
  const kmzBuffer = getKmzBuffer(req);
  const metadata = {
    name: normalizeMissionName(getHeader(req, "x-mission-name")),
    date: getHeader(req, "x-mission-date") || new Date().toISOString()
  };
  return sendJson(res, 200, await providers.flighthubLegacy.uploadKmz(kmzBuffer, metadata));
}

function handleError(req, res, config, error) {
  const appError = isAppError(error)
    ? error
    : new AppError(500, "INTERNAL_ERROR", "Unexpected gateway error.");

  const payload = {
    success: false,
    code: appError.code,
    message: appError.message,
    requestId: req.requestId,
    code_version: config.codeVersion
  };
  if (appError.details !== undefined) {
    payload.details = appError.details;
  }

  if (!isAppError(error)) {
    console.error("Unhandled gateway error", {
      requestId: req.requestId,
      message: error?.message || String(error)
    });
  }

  return sendJson(res, appError.statusCode, payload);
}

function invalidMode(mode) {
  return new AppError(500, "UNSUPPORTED_GATEWAY_MODE", `Unsupported DJI_GATEWAY_MODE: ${mode}`);
}

function normalizePath(pathname) {
  if (!pathname || pathname === "") return "/";
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function normalizeMissionName(name) {
  return (
    String(name || "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "geovision-mision"
  );
}

module.exports = {
  createApp,
  buildHealth,
  buildCapabilities
};
