const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { SCHEMA_VERSION, CRS } = require("../src/domain/task-draft");

test("health is healthy in disabled mode by default", async () => {
  const res = await request(createApp({ env: baseEnv() }), { method: "GET", url: "/healthz" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.configured.mode, "disabled");
  assert.equal(res.body.configured.ready, true);
});

test("healthz does not expose secret values", async () => {
  const env = {
    ...baseEnv(),
    DJI_GATEWAY_MODE: "flighthub-legacy",
    DJI_FLIGHTHUB_USER_TOKEN: "super-secret-token",
    DJI_FLIGHTHUB_PROJECT_UUID: "super-secret-project",
    AUTH_JWT_HS256_SECRET: "super-secret-jwt"
  };
  const res = await request(createApp({ env }), { method: "GET", url: "/healthz" });
  const serialized = JSON.stringify(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(serialized.includes("super-secret-token"), false);
  assert.equal(serialized.includes("super-secret-project"), false);
  assert.equal(serialized.includes("super-secret-jwt"), false);
});

test("rejects a CORS origin that is not explicitly allowed", async () => {
  const env = { ...baseEnv(), ALLOWED_ORIGINS: "https://allowed.example" };
  const res = await request(createApp({ env }), {
    method: "GET",
    url: "/healthz",
    headers: { origin: "https://evil.example" }
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "CORS_ORIGIN_NOT_ALLOWED");
  assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
});

test("rejects task draft creation without authentication", async () => {
  const env = {
    ...baseEnv(),
    DJI_GATEWAY_MODE: "smartfarm-mock",
    AUTH_MODE: "oidc-jwt",
    AUTH_JWT_ISSUER: "https://issuer.example",
    AUTH_JWT_AUDIENCE: "geovision-gateway",
    AUTH_JWT_HS256_SECRET: "test-secret"
  };
  const res = await request(createApp({ env }), {
    method: "POST",
    url: "/v1/agras/task-drafts",
    body: validDraft()
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "AUTH_REQUIRED");
});

test("rejects invalid geometry", async () => {
  const draft = validDraft();
  draft.fieldBoundary.coordinates[0].pop();

  const res = await request(createApp({ env: mockEnv() }), {
    method: "POST",
    url: "/v1/agras/task-drafts",
    body: draft
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "VALIDATION_ERROR");
  assert.match(res.body.message, /closed/);
});

test("creates a deterministic task draft in smartfarm-mock", async () => {
  const app = createApp({
    env: mockEnv(),
    now: () => new Date("2026-08-10T12:00:00.000Z")
  });

  const first = await request(app, {
    method: "POST",
    url: "/v1/agras/task-drafts",
    body: validDraft()
  });
  const second = await request(app, {
    method: "POST",
    url: "/v1/agras/task-drafts",
    body: validDraft()
  });

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.equal(first.body.id, second.body.id);
  assert.equal(first.body.status, "DRAFT_NOT_SENT");
  assert.equal(first.body.provider, "smartfarm-mock");
  assert.equal(first.body.transmittedToDji, false);
  assert.equal(first.body.executionAllowed, false);
});

test("retrieves an in-memory smartfarm-mock draft", async () => {
  const app = createApp({
    env: mockEnv(),
    now: () => new Date("2026-08-10T12:00:00.000Z")
  });
  const created = await request(app, {
    method: "POST",
    url: "/v1/agras/task-drafts",
    body: validDraft()
  });
  const fetched = await request(app, {
    method: "GET",
    url: `/v1/agras/task-drafts/${encodeURIComponent(created.body.id)}`
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.body.id, created.body.id);
  assert.equal(fetched.body.transmittedToDji, false);
});

test("smartfarm mode returns controlled not implemented response", async () => {
  const res = await request(createApp({ env: { ...baseEnv(), DJI_GATEWAY_MODE: "smartfarm" } }), {
    method: "POST",
    url: "/v1/agras/task-drafts",
    body: validDraft()
  });
  assert.equal(res.statusCode, 501);
  assert.equal(res.body.code, "SMARTFARM_ADAPTER_NOT_IMPLEMENTED");
});

test("legacy KMZ route cannot call FlightHub from smartfarm-mock mode", async () => {
  let calls = 0;
  const httpClient = {
    get() {
      calls += 1;
      throw new Error("should not call get");
    },
    post() {
      calls += 1;
      throw new Error("should not call post");
    },
    put() {
      calls += 1;
      throw new Error("should not call put");
    }
  };
  const res = await request(createApp({ env: mockEnv(), httpClient }), {
    method: "POST",
    url: "/",
    rawBody: Buffer.from([0x50, 0x4b, 0x03, 0x04])
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "LEGACY_KMZ_ROUTE_DISABLED");
  assert.equal(res.body.transmittedToDji, false);
  assert.equal(calls, 0);
});

test("rejects JSON bodies over the configured size limit", async () => {
  const res = await request(createApp({ env: { ...mockEnv(), MAX_JSON_BODY_BYTES: "12" } }), {
    method: "POST",
    url: "/v1/agras/task-drafts",
    headers: { "content-length": "13" },
    body: validDraft()
  });
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.code, "BODY_TOO_LARGE");
});

function baseEnv() {
  return {
    NODE_ENV: "test",
    AUTH_MODE: "off",
    ALLOWED_ORIGINS: ""
  };
}

function mockEnv() {
  return {
    ...baseEnv(),
    DJI_GATEWAY_MODE: "smartfarm-mock"
  };
}

function validDraft() {
  return {
    schemaVersion: SCHEMA_VERSION,
    externalId: "lot-42",
    name: "Lote norte prueba",
    operationType: "spray",
    fieldBoundary: {
      type: "Polygon",
      coordinates: [[
        [-65.20312, -26.83712],
        [-65.20288, -26.83712],
        [-65.20288, -26.83688],
        [-65.20312, -26.83688],
        [-65.20312, -26.83712]
      ]]
    },
    exclusionZones: [],
    desiredParameters: {
      operatorApproved: false,
      applicationRate: 12.5,
      flightAltitudeMeters: 4,
      swathWidthMeters: 7
    },
    createdAt: "2026-08-10T12:00:00.000Z",
    coordinateReferenceSystem: CRS
  };
}

async function request(app, options) {
  const req = {
    method: options.method || "GET",
    url: options.url || "/",
    headers: normalizeHeaders(options.headers || {}),
    body: options.body,
    rawBody: options.rawBody,
    get(name) {
      return this.headers[String(name).toLowerCase()];
    }
  };

  const res = {
    statusCode: 200,
    headers: {},
    payload: "",
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = JSON.stringify(payload);
      return this;
    },
    send(payload) {
      this.payload = payload || "";
      return this;
    },
    end(payload) {
      this.payload = payload || "";
      return this;
    }
  };

  await app(req, res);
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.payload ? JSON.parse(res.payload) : null
  };
}

function normalizeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
}
