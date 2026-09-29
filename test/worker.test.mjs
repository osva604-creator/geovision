import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import worker, { createWorker } from '../src/worker.mjs';

const origin = 'https://geovision.example.com';
const host = 'example.clerk.accounts.dev';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from(`${host}$`).toString('base64')}`,
  CLERK_SECRET_KEY: 'sk_test_example',
  CLERK_JWT_KEY: keys.publicKey.export({ type: 'spki', format: 'pem' }),
  WEATHER_API_KEY: 'server-only-weather-key',
  API_RATE_LIMITER: { limit: async () => ({ success: true }) },
  DJI_RATE_LIMITER: { limit: async () => ({ success: true }) },
  ASSETS: { fetch: async () => new Response('<html>GeoVision</html>', { headers: { 'Content-Type': 'text/html' } }) }
};
function token(overrides = {}, privateKey = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: `https://${host}`, sub: 'user_test', sid: 'sess_test', azp: origin,
    iat: now, nbf: now - 5, exp: now + 60, ...overrides
  })).toString('base64url');
  return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')}`;
}
function request(path, options = {}) {
  return new Request(`${origin}${path}`, { ...options, headers: { Authorization: `Bearer ${token()}`, ...options.headers } });
}

test('missing configuration fails closed and never reveals secrets', async () => {
  const response = await worker.fetch(request('/api/config'), {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const configured = await worker.fetch(request('/api/config'), env);
  assert.deepEqual(await configured.json(), { publishableKey: env.CLERK_PUBLISHABLE_KEY });
});

test('Clerk verifies a real signed token and rejects absent, expired, tampered and wrong-origin tokens', async () => {
  const good = await worker.fetch(request('/api/session'), env);
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), { userId: 'user_test' });
  const forgedKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  for (const value of ['', 'Bearer invalid', `Bearer ${token({ exp: 1 })}`, `Bearer ${token({ azp: 'https://evil.example' })}`, `Bearer ${token({}, forgedKeys.privateKey)}`]) {
    assert.equal((await worker.fetch(request('/api/session', { headers: { Authorization: value } }), env)).status, 401);
  }
});

test('foreign origins and unsupported routes/methods are rejected', async () => {
  assert.equal((await worker.fetch(request('/api/session', { headers: { Origin: 'https://evil.example' } }), env)).status, 403);
  assert.equal((await worker.fetch(request('/api/session', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), env)).status, 403);
  assert.equal((await worker.fetch(request('/api/weather', { method: 'POST' }), env)).status, 405);
  assert.equal((await worker.fetch(request('/api/unknown'), env)).status, 404);
});

test('weather validates coordinates, hides its key and honors rate limits', async () => {
  const calls = [];
  const app = createWorker({ fetchUpstream: async (url) => {
    calls.push(String(url));
    return Response.json({ cod: 200, main: { temp: 24 } });
  } });
  for (const query of ['', '?lat=&lon=0', '?lat=91&lon=0', '?lat=0&lon=181', '?lat=NaN&lon=0']) {
    assert.equal((await app.fetch(request(`/api/weather${query}`), env)).status, 400);
  }
  assert.equal(calls.length, 0);
  const response = await app.fetch(request('/api/weather?lat=-26&lon=-65'), env);
  assert.equal(response.status, 200);
  assert.match(calls[0], /appid=server-only-weather-key/);
  assert.doesNotMatch(await response.text(), /server-only-weather-key/);
  const limited = await app.fetch(request('/api/weather?lat=0&lon=0'), {
    ...env, API_RATE_LIMITER: { limit: async () => ({ success: false }) }
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '60');
  assert.equal(calls.length, 1);
});

test('DJI requires explicit authorization, correct content and bounded upload size', async () => {
  let called = false;
  const app = createWorker({ fetchUpstream: async () => { called = true; throw new Error('must not call'); } });
  const post = (headers = {}, body = 'PK\x03\x04test') => request('/api/dji/mission', {
    method: 'POST', body, headers: { 'Content-Type': 'application/vnd.google-earth.kmz', ...headers }
  });
  assert.equal((await app.fetch(post(), env)).status, 403);
  const allowed = { ...env, DJI_ALLOWED_USER_IDS: 'user_test', DJI_APP_KEY: 'key', DJI_APP_SECRET: 'secret',
    DJI_LOGIN_URL: 'https://dji.example/login', DJI_UPLOAD_URL: 'https://dji.example/upload' };
  assert.equal((await app.fetch(post(), { ...allowed, DJI_APP_KEY: '' })).status, 503);
  assert.equal((await app.fetch(post({ 'Content-Type': 'text/plain' }), allowed)).status, 415);
  assert.equal((await app.fetch(post({}, 'invalid'), allowed)).status, 400);
  assert.equal((await app.fetch(post({ 'Content-Length': String(26 * 1024 * 1024) }), allowed)).status, 413);
  assert.equal((await app.fetch(post({}, new Uint8Array(26 * 1024 * 1024)), allowed)).status, 413);
  assert.equal(called, false);
});

test('DJI credentials stay upstream and provider errors are redacted', async () => {
  const allowed = { ...env, DJI_ALLOWED_USER_IDS: 'user_test', DJI_APP_KEY: 'key', DJI_APP_SECRET: 'private-secret',
    DJI_LOGIN_URL: 'https://dji.example/login', DJI_UPLOAD_URL: 'https://dji.example/upload' };
  const app = createWorker({ fetchUpstream: async (url, options) => {
    if (url.pathname === '/login') {
      assert.equal(JSON.parse(options.body).app_secret, 'private-secret');
      return Response.json({ access_token: 'private-token' });
    }
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    assert.equal(options.body.get('file').name, 'test-mission.kmz');
    return Response.json({ data: { id: 'mission-123' }, internal_secret: 'do-not-return' });
  } });
  const post = () => request('/api/dji/mission', { method: 'POST', body: 'PK\x03\x04test',
    headers: { 'Content-Type': 'application/vnd.google-earth.kmz', 'X-Mission-Name': 'test mission' } });
  const response = await app.fetch(post(), allowed);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).dji_ref, 'mission-123');
  const broken = createWorker({ fetchUpstream: async () => { throw new Error('private-secret'); } });
  const failure = await broken.fetch(post(), allowed);
  assert.equal(failure.status, 502);
  assert.doesNotMatch(await failure.text(), /private-secret/);
});

test('security headers also wrap static assets and error responses', async () => {
  for (const path of ['/', '/api/session', '/api/unknown']) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    assert.match(response.headers.get('Content-Security-Policy'), /example.clerk.accounts.dev/);
  }
});
