const crypto = require("crypto");
const { AppError } = require("../errors");
const { getHeader } = require("../http");

function requireAuth(req, config) {
  if (config.configErrors.length > 0) {
    throw new AppError(500, "CONFIGURATION_ERROR", "Gateway configuration is invalid.", {
      errors: config.configErrors.map((error) => error.code)
    });
  }

  if (config.auth.mode === "off") {
    return { subject: "development", mode: "off" };
  }

  const authorization = getHeader(req, "authorization");
  const match = /^Bearer\s+(.+)$/i.exec(String(authorization || ""));
  if (!match) {
    throw new AppError(401, "AUTH_REQUIRED", "A bearer token is required.");
  }

  return verifyHs256Jwt(match[1], config.auth);
}

function verifyHs256Jwt(token, authConfig) {
  const parts = String(token).split(".");
  if (parts.length !== 3) {
    throw new AppError(401, "INVALID_TOKEN", "Bearer token must be a JWT.");
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader).toString("utf8"));
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  } catch (_error) {
    throw new AppError(401, "INVALID_TOKEN", "Bearer token is not a valid JWT.");
  }

  if (!header || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AppError(401, "INVALID_TOKEN", "Bearer token payload is invalid.");
  }
  if (header.alg !== "HS256") {
    throw new AppError(401, "UNSUPPORTED_TOKEN_ALGORITHM", "Only HS256 JWT verification is configured.");
  }

  const expectedSignature = crypto
    .createHmac("sha256", authConfig.hs256Secret)
    .update(`${encodedHeader}.${encodedPayload}`, "utf8")
    .digest("base64url");

  if (!timingSafeEqual(signature, expectedSignature)) {
    throw new AppError(401, "INVALID_TOKEN_SIGNATURE", "Bearer token signature is invalid.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || typeof payload.sub !== "string" || !payload.sub.trim() ||
      (payload.nbf !== undefined && !Number.isFinite(payload.nbf))) {
    throw new AppError(401, "INVALID_TOKEN", "Bearer token requires a subject and a numeric expiration.");
  }
  if (payload.iss !== authConfig.issuer) {
    throw new AppError(401, "INVALID_TOKEN_ISSUER", "Bearer token issuer is invalid.");
  }
  if (!audienceMatches(payload.aud, authConfig.audience)) {
    throw new AppError(401, "INVALID_TOKEN_AUDIENCE", "Bearer token audience is invalid.");
  }
  if (payload.exp !== undefined && Number(payload.exp) <= nowSeconds) {
    throw new AppError(401, "TOKEN_EXPIRED", "Bearer token is expired.");
  }
  if (payload.nbf !== undefined && Number(payload.nbf) > nowSeconds) {
    throw new AppError(401, "TOKEN_NOT_YET_VALID", "Bearer token is not yet valid.");
  }

  return {
    subject: String(payload.sub || ""),
    issuer: payload.iss,
    audience: payload.aud
  };
}

function audienceMatches(aud, expected) {
  if (Array.isArray(aud)) return aud.includes(expected);
  return aud === expected;
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url");
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = {
  requireAuth,
  verifyHs256Jwt
};
