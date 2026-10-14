// Dirección pública independiente. El servicio conserva la solicitud original
// para verificar Clerk contra el origen pages.dev y aplicar sus protecciones.
export default {
  async fetch(request, env) {
    try {
      if (!env.GEOVISION) throw new Error("Missing backend");
      return await env.GEOVISION.fetch(request);
    } catch {
      return new Response('GeoVision no está disponible temporalmente.', {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  }
};
