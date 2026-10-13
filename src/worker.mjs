import { createClerkClient } from '@clerk/backend';

const MAX_KMZ_BYTES = 25 * 1024 * 1024;
const json = (data, status = 200, headers = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', ...headers }
});
const fail = (message, status) => json({ success: false, error: message, message }, status);

export function clerkHost(key = '') {
  if (!/^pk_(test|live)_[A-Za-z0-9_-]+$/.test(key)) return null;
  try {
    const decoded = atob(key.slice(8).replace(/-/g, '+').replace(/_/g, '/'));
    const host = decoded.replace(/\$$/, '');
    return /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/i.test(host) ? host : null;
  } catch { return null; }
}

function secure(response, env) {
  const result = new Response(response.body, response);
  const host = clerkHost(env.CLERK_PUBLISHABLE_KEY);
  const clerk = host ? `https://${host}` : '';
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('X-Frame-Options', 'DENY');
  result.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  result.headers.set('Strict-Transport-Security', 'max-age=31536000');
  result.headers.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  result.headers.set('Content-Security-Policy', [
    "default-src 'self'",
    `script-src 'self' https://unpkg.com https://cdn.jsdelivr.net https://challenges.cloudflare.com ${clerk}`,
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
    `img-src 'self' data: blob: https://*.google.com https://*.tile.openstreetmap.org https://img.clerk.com ${clerk}`,
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src 'self' https://*.google.com https://*.tile.openstreetmap.org https://clerk-telemetry.com ${clerk}`,
    `frame-src https://challenges.cloudflare.com ${clerk}`,
    "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"
  ].join('; '));
  return result;
}

async function authenticate(request, env) {
  const client = createClerkClient({
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    secretKey: env.CLERK_SECRET_KEY,
    jwtKey: env.CLERK_JWT_KEY
  });
  const state = await client.authenticateRequest(request, {
    authorizedParties: [new URL(request.url).origin],
    acceptsToken: 'session_token'
  });
  return state.isAuthenticated ? state.toAuth() : null;
}

export function createWorker({ authenticateRequest = authenticate, fetchUpstream = fetch } = {}) {
  return {
    async fetch(request, env) {
      try { return secure(await route(request, env, authenticateRequest, fetchUpstream), env); }
      catch { return secure(fail('No se pudo completar la solicitud.', 502), env); }
    }
  };
}

async function route(request, env, authenticateRequest, fetchUpstream) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) {
    if (!['GET', 'HEAD'].includes(request.method)) return fail('Método no permitido.', 405);
    const response = await env.ASSETS.fetch(request);
    const result = new Response(response.body, response);
    if (pathname === '/sw.js' || response.headers.get('Content-Type')?.includes('text/html')) {
      result.headers.set('Cache-Control', 'no-cache');
    }
    return result;
  }
  const methods = { '/api/config': 'GET', '/api/session': 'GET', '/api/weather': 'GET', '/api/dji/mission': 'POST' };
  if (!methods[pathname]) return fail('Ruta no encontrada.', 404);
  if (request.method !== methods[pathname]) return fail('Método no permitido.', 405);
  if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) {
    return fail('Origen no autorizado.', 403);
  }
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return fail('Origen no autorizado.', 403);
  if (!clerkHost(env.CLERK_PUBLISHABLE_KEY) || !env.CLERK_SECRET_KEY) {
    return fail('El acceso todavía no está habilitado. Contactá al administrador.', 503);
  }
  if (pathname === '/api/config') return json({ publishableKey: env.CLERK_PUBLISHABLE_KEY });
  // Usamos Bearer explícito para evitar depender de cookies/handshakes en las API.
  if (!/^Bearer \S+$/i.test(request.headers.get('Authorization') || '')) {
    return fail('Iniciá sesión para continuar.', 401);
  }
  let auth;
  try { auth = await authenticateRequest(request, env); }
  catch { return fail('La sesión no es válida. Volvé a ingresar.', 401); }
  if (!auth?.userId) return fail('Iniciá sesión para continuar.', 401);
  if (pathname === '/api/session') return json({ userId: auth.userId });
  const limiter = pathname === '/api/dji/mission' ? env.DJI_RATE_LIMITER : env.API_RATE_LIMITER;
  if (!limiter) return fail('El servicio no está configurado.', 503);
  if (!(await limiter.limit({ key: `geovision:${pathname}:${auth.userId}` })).success) {
    return json({ success: false, error: 'Demasiadas solicitudes. Esperá un minuto.', message: 'Demasiadas solicitudes. Esperá un minuto.' }, 429, { 'Retry-After': '60' });
  }
  if (pathname === '/api/weather') return weather(url, env, fetchUpstream);
  return mission(request, env, auth, fetchUpstream);
}

async function weather(url, env, fetchUpstream) {
  const latRaw = url.searchParams.get('lat');
  const lonRaw = url.searchParams.get('lon');
  const lat = Number(latRaw), lon = Number(lonRaw);
  if (!latRaw?.trim() || !lonRaw?.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return fail('Coordenadas inválidas.', 400);
  }
  if (!env.WEATHER_API_KEY) return fail('El servicio de clima no está configurado.', 503);
  const endpoint = new URL('https://api.openweathermap.org/data/2.5/weather');
  endpoint.search = new URLSearchParams({ lat, lon, appid: env.WEATHER_API_KEY, units: 'metric', lang: 'es' });
  const response = await fetchUpstream(endpoint, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) return fail('El proveedor de clima no está disponible.', 502);
  return json(await response.json());
}

async function readLimitedBody(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_KMZ_BYTES) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_KMZ_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function mission(request, env, auth, fetchUpstream) {
  const allowedUsers = String(env.DJI_ALLOWED_USER_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!allowedUsers.includes(auth.userId)) return fail('Tu cuenta no tiene permiso para despachar misiones.', 403);
  if (!env.DJI_APP_KEY || !env.DJI_APP_SECRET || !env.DJI_LOGIN_URL || !env.DJI_UPLOAD_URL) {
    return fail('La integración DJI todavía no está configurada.', 503);
  }
  const endpoints = [env.DJI_LOGIN_URL, env.DJI_UPLOAD_URL].map(value => new URL(value));
  if (endpoints.some(url => url.protocol !== 'https:' || url.username || url.password)) return fail('Configuración DJI inválida.', 503);
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/vnd.google-earth.kmz') return fail('Se requiere un archivo KMZ.', 415);
  const bytes = await readLimitedBody(request);
  if (!bytes) return fail('El KMZ supera el límite de 25 MB.', 413);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) return fail('El archivo no es un KMZ válido.', 400);
  const name = String(request.headers.get('X-Mission-Name') || 'geovision-mision').trim().replace(/\s+/g, '-').replace(/[^\w-]/g, '').slice(0, 100) || 'geovision-mision';
  const login = await fetchUpstream(endpoints[0], {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_key: env.DJI_APP_KEY, app_secret: env.DJI_APP_SECRET }),
    signal: AbortSignal.timeout(15000), redirect: 'error'
  });
  if (!login.ok) return fail('No se pudo autenticar con DJI.', 502);
  const data = await login.json();
  const token = data?.data?.access_token || data?.access_token || data?.token;
  if (!token) return fail('DJI no confirmó la autenticación.', 502);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/vnd.google-earth.kmz' }), `${name}.kmz`);
  const upload = await fetchUpstream(endpoints[1], {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    signal: AbortSignal.timeout(30000), redirect: 'error'
  });
  if (!upload.ok) return fail('DJI no pudo recibir la misión.', 502);
  const result = await upload.json();
  if (result?.success === false) return fail('DJI rechazó la misión.', 502);
  return json({ success: true, message: 'Misión recibida por el servicio DJI.', mission_name: name,
    mission_date: new Date().toISOString(), dji_ref: result?.data?.job_id || result?.data?.id || null });
}

export default createWorker();
