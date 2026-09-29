import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('service worker never intercepts API, Clerk, authorized or third-party requests', async () => {
  const handlers = {};
  vm.runInNewContext(await readFile(new URL('../sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: 'https://geo.example', href: 'https://geo.example/sw.js' },
      addEventListener: (name, handler) => { handlers[name] = handler; } },
    URL, Response
  });
  for (const [path, options] of [
    ['/api/session'], ['/api/weather?lat=0&lon=0'], ['/api/config'],
    ['https://example.clerk.accounts.dev/v1/client'],
    ['https://mt0.google.com/vt/lyrs=y'],
    ['/index.html', { headers: { Authorization: 'Bearer private' } }],
    ['/index.html?token=private']
  ]) {
    let intercepted = false;
    handlers.fetch({ request: new Request(new URL(path, 'https://geo.example'), options),
      respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, path);
  }
});

function fakeDocument() {
  const nodes = new Map();
  const getElementById = id => {
    if (!nodes.has(id)) {
      const classes = new Set(id === 'app-container' ? ['hidden'] : []);
      nodes.set(id, { textContent: '', disabled: id === 'btn-welcome-start',
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) } });
    }
    return nodes.get(id);
  };
  return { getElementById, createElement: () => ({ setAttribute() {} }), head: { appendChild() {} } };
}

test('unconfigured or offline browser stays locked without loading app data', async () => {
  const source = await readFile(new URL('../js/auth.js', import.meta.url), 'utf8');
  for (const fetch of [async () => new Response('', { status: 503 }), async () => { throw new Error('offline'); }]) {
    const document = fakeDocument();
    let scripts = 0;
    document.head.appendChild = () => { scripts++; };
    vm.runInNewContext(source, { document, window: {}, navigator: {}, fetch,
      location: { origin: 'https://geo.example' }, URL, Headers });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.getElementById('app-container').classList.contains('hidden'), true);
    assert.equal(document.getElementById('btn-welcome-start').disabled, true);
    assert.equal(scripts, 0);
    assert.ok(document.getElementById('auth-notice').textContent);
  }
});

test('browser validates session before loading map and reloads on account change', async () => {
  const document = fakeDocument();
  const events = [];
  let listener;
  const key = `pk_test_${Buffer.from('example.clerk.accounts.dev$').toString('base64')}`;
  const window = { initializeGeoVision: () => events.push('map-initialized'), Clerk: {
    session: { id: 'sess_1', getToken: async () => 'signed-token' },
    user: { id: 'user_1', fullName: 'Usuario Uno' }, load: async () => {},
    addListener: callback => { listener = callback; }, mountUserButton: () => {},
  } };
  document.head.appendChild = script => {
    events.push(script.src);
    queueMicrotask(() => script.onload());
  };
  vm.runInNewContext(await readFile(new URL('../js/auth.js', import.meta.url), 'utf8'), {
    document, window, navigator: {}, URL, Headers, atob,
    location: { origin: 'https://geo.example', reload: () => events.push('reload') },
    fetch: async (path, options) => {
      if (String(path).endsWith('/api/config')) return Response.json({ publishableKey: key });
      assert.equal(options.headers.get('Authorization'), 'Bearer signed-token');
      events.push('server-validated');
      return Response.json({ userId: 'user_1' });
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.geoAuth.userId, 'user_1');
  assert.ok(events.indexOf('server-validated') < events.indexOf('/js/script.js'));
  assert.ok(events.includes('map-initialized'));
  assert.equal(document.getElementById('app-container').classList.contains('hidden'), false);
  await assert.rejects(window.geoAuth.fetch('https://evil.example/api/test'), /Destino no permitido/);
  listener({ user: { id: 'user_2' }, session: { id: 'sess_2' } });
  assert.equal(document.getElementById('app-container').classList.contains('hidden'), true);
  assert.ok(events.includes('reload'));
});
