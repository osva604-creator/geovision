const { AppError } = require("../errors");
const { getHeader, setHeader } = require("../http");

const ALLOWED_HEADERS = [
  "Authorization",
  "Content-Type",
  "Accept",
  "X-Request-Id",
  "X-Mission-Name",
  "X-Mission-Date"
].join(", ");

function applyCors(req, res, config) {
  const origin = getHeader(req, "origin");
  if (!origin) return;

  setHeader(res, "Vary", "Origin");
  if (!config.allowedOrigins.includes(origin)) {
    throw new AppError(403, "CORS_ORIGIN_NOT_ALLOWED", "Origin is not allowed.");
  }

  setHeader(res, "Access-Control-Allow-Origin", origin);
  setHeader(res, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  setHeader(res, "Access-Control-Allow-Headers", ALLOWED_HEADERS);
  setHeader(res, "Access-Control-Max-Age", "3600");
}

module.exports = {
  applyCors,
  ALLOWED_HEADERS
};
