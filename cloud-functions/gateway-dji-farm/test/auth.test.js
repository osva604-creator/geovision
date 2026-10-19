const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyHs256Jwt } = require('../src/middleware/auth');

test('legacy gateway requires signed tokens with a subject and finite expiration', () => {
  const config = { issuer: 'https://issuer.example', audience: 'gateway', hs256Secret: 'test-only' };
  const sign = payload => {
    const parts = [ { alg: 'HS256' }, payload ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url'));
    return [...parts, crypto.createHmac('sha256', config.hs256Secret).update(parts.join('.')).digest('base64url')].join('.');
  };
  const valid = { iss: config.issuer, aud: config.audience, sub: 'user_1', exp: Math.floor(Date.now() / 1000) + 60 };
  assert.equal(verifyHs256Jwt(sign(valid), config).subject, 'user_1');
  for (const payload of [null, [], { ...valid, exp: undefined }, { ...valid, exp: 'tomorrow' },
    { ...valid, sub: '' }, { ...valid, nbf: 'invalid' }, { ...valid, exp: 0 }]) {
    assert.throws(() => verifyHs256Jwt(sign(payload), config), error => error.status === 401 || error.statusCode === 401);
  }
});
