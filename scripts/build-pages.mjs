import { cp, mkdir } from 'node:fs/promises';

const root = new URL('../hosting/pages/', import.meta.url);
const output = new URL('dist/', root);
await mkdir(output, { recursive: true });
await cp(new URL('worker.mjs', root), new URL('_worker.js', output));
for (const name of ['404.html', '_routes.json']) {
  await cp(new URL(name, root), new URL(name, output));
}
console.log('Entrada de Cloudflare Pages preparada. Sin credenciales ni archivos privados.');
