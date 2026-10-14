import test from 'node:test';
import assert from 'node:assert/strict';
import pages from '../hosting/pages/worker.mjs';

test('independent Pages address preserves origin, token, body and security headers', async () => {
  const request = new Request('https://geovision.pages.dev/api/dji/mission', {
    method: 'POST', body: 'PK\x03\x04test',
    headers: { Authorization: 'Bearer session', Origin: 'https://geovision.pages.dev' }
  });
  const response = await pages.fetch(request, { GEOVISION: { fetch: async forwarded => {
    assert.equal(forwarded, request);
    assert.equal(new URL(forwarded.url).origin, 'https://geovision.pages.dev');
    assert.equal(forwarded.headers.get('Authorization'), 'Bearer session');
    assert.equal(forwarded.headers.get('Origin'), 'https://geovision.pages.dev');
    assert.equal(await forwarded.text(), 'PK\x03\x04test');
    return new Response('Unauthorized', { status: 401, headers: {
      'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'"
    } });
  } } });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Content-Security-Policy'), "default-src 'self'");
});

test('Pages fails closed when its backend binding is missing', async () => {
  const response = await pages.fetch(new Request('https://geovision.pages.dev/'), {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});


test('Pages reports unavailable when its backend service was removed', async () => {
  const response = await pages.fetch(new Request('https://geovision.pages.dev/api/config'), {
    GEOVISION: { fetch: async () => { throw new Error('Service unavailable'); } }
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.ok(!(await response.text()).includes('Service unavailable'));
});
