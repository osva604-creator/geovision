import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, 'dist');
if (path.dirname(output) !== path.resolve(root) || path.basename(output) !== 'dist') {
  throw new Error('Directorio de salida inesperado');
}
await mkdir(output, { recursive: true });
// Mantener el directorio raíz permite reconstruir con Wrangler observándolo en Windows.
for (const entry of await readdir(output)) {
  const target = path.resolve(output, entry);
  if (path.dirname(target) !== output) throw new Error('Ruta fuera de dist');
  await rm(target, { recursive: true, force: true });
}
// Lista explícita: nunca publicar secretos, fuentes del servidor o .git.
for (const entry of ['index.html', 'manifest.json', 'sw.js', 'css', 'js', 'assets']) {
  await cp(path.join(root, entry), path.join(output, entry), { recursive: true });
}
const vendor = path.join(output, 'vendor');
await mkdir(vendor, { recursive: true });
for (const [source, target] of [
  ['geotiff/dist-browser/geotiff.js', 'geotiff.js'],
  ['proj4/dist/proj4.js', 'proj4.js'],
  ['pdf-lib/dist/pdf-lib.min.js', 'pdf-lib.js'],
  ['pdf-lib/LICENSE.md', 'pdf-lib-LICENSE.txt'],
  ['pdfjs-dist/build/pdf.min.mjs', 'pdf.mjs'],
  ['pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.mjs'],
  ['pdfjs-dist/cmaps', 'cmaps'],
  ['pdfjs-dist/standard_fonts', 'standard_fonts'],
  ['pdfjs-dist/wasm', 'wasm'],
  ['geotiff/LICENSE', 'geotiff-LICENSE.txt'],
  ['proj4/LICENSE.md', 'proj4-LICENSE.txt'],
  ['pdfjs-dist/LICENSE', 'pdfjs-LICENSE.txt']
]) await cp(path.join(root, 'node_modules', source), path.join(vendor, target), { recursive: true });
console.log(`Build listo: ${(await readdir(output)).join(', ')}`);
