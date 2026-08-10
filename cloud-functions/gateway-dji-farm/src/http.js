const { AppError } = require("./errors");

function getHeader(req, name) {
  if (typeof req.get === "function") return req.get(name);
  const key = String(name).toLowerCase();
  return req.headers?.[key] || req.headers?.[name] || "";
}

function setHeader(res, name, value) {
  if (typeof res.set === "function") {
    res.set(name, value);
    return;
  }
  if (typeof res.setHeader === "function") {
    res.setHeader(name, value);
  }
}

function sendJson(res, statusCode, payload) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(statusCode).json(payload);
  }
  res.statusCode = statusCode;
  setHeader(res, "Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(payload));
}

function parseUrl(req) {
  const rawUrl = req.url || "/";
  return new URL(rawUrl, "http://localhost");
}

async function readJsonBody(req, maxBytes) {
  const contentLength = Number(getHeader(req, "content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new AppError(413, "BODY_TOO_LARGE", `JSON body exceeds ${maxBytes} bytes.`);
  }

  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  let buffer;
  if (Buffer.isBuffer(req.rawBody)) {
    buffer = req.rawBody;
  } else if (Buffer.isBuffer(req.body)) {
    buffer = req.body;
  } else if (typeof req.body === "string") {
    buffer = Buffer.from(req.body, "utf8");
  } else {
    buffer = await readStream(req, maxBytes);
  }

  if (buffer.length > maxBytes) {
    throw new AppError(413, "BODY_TOO_LARGE", `JSON body exceeds ${maxBytes} bytes.`);
  }
  if (buffer.length === 0) {
    throw new AppError(400, "BODY_REQUIRED", "A JSON body is required.");
  }

  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (_error) {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function readStream(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new AppError(413, "BODY_TOO_LARGE", `JSON body exceeds ${maxBytes} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = {
  getHeader,
  setHeader,
  sendJson,
  parseUrl,
  readJsonBody
};
