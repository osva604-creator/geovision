// Ejecutar contra el servidor LOCAL. La sesión simulada solo existe en este contexto de prueba.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import JSZip from 'jszip';

const base = process.env.GEOVISION_TEST_URL || 'http://127.0.0.1:8787';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Esta prueba solo admite un servidor local.');
const userId = 'user_kmz_browser_test';
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1kAAAAASUVORK5CYII=';
const zip = new JSZip();
zip.file('doc.kml', `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Maleza detectada</name><ExtendedData><Data name="clase"><value>vegetación</value></Data></ExtendedData>
<Polygon><outerBoundaryIs><LinearRing><coordinates>-65.201,-26.831 -65.199,-26.831 -65.199,-26.829 -65.201,-26.829 -65.201,-26.831</coordinates></LinearRing></outerBoundaryIs>
<innerBoundaryIs><LinearRing><coordinates>-65.2002,-26.8302 -65.1998,-26.8302 -65.1998,-26.8298 -65.2002,-26.8298 -65.2002,-26.8302</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
<Placemark><name>Recorrido satelital</name><LineString><coordinates>-65.202,-26.832 -65.198,-26.828</coordinates></LineString></Placemark>
<Placemark><name>&lt;img src=x onerror=alert(1)&gt;</name><Point><coordinates>-65.201,-26.829</coordinates></Point></Placemark>
<GroundOverlay><name>Imagen satelital</name><Icon><href>image.png</href></Icon><LatLonBox><north>-26.828</north><south>-26.832</south><east>-65.198</east><west>-65.202</west></LatLonBox></GroundOverlay>
</Document></kml>`);
zip.file('image.png', Buffer.from(image, 'base64'));
const kmz = { name: 'identificacion-satelital.kmz', mimeType: 'application/vnd.google-earth.kmz', buffer: await zip.generateAsync({ type: 'nodebuffer' }) };
const browser = await chromium.launch({ headless: true, ...(process.env.GEOVISION_BROWSER_CHANNEL ? { channel: process.env.GEOVISION_BROWSER_CHANNEL } : {}) });
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { if (dialog.type() !== 'confirm') errors.push(`Unexpected dialog: ${dialog.message()}`); void dialog.accept(); });
    await page.route('**/js/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(base);
    // Crear datos con el esquema anterior para comprobar la migración v1 -> v2.
    await page.evaluate(async ({ userId, image }) => {
        await new Promise((resolve, reject) => {
            const request = indexedDB.open(`geovision_db:${userId}`, 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('foto_previews');
                request.result.createObjectStore('app_state');
            };
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction(['app_state', 'foto_previews'], 'readwrite');
                tx.objectStore('app_state').put({
                    fotos: [{ id: 101, nombre: 'Campo.png', lat: -26.8305, lon: -65.2005 }],
                    poligonos: [{ id: 201, nombre: 'Área de campo', coords: [[-26.833, -65.203], [-26.833, -65.202], [-26.832, -65.202]] }]
                }, `geovision_data:${userId}`);
                tx.objectStore('foto_previews').put(`data:image/png;base64,${image}`, '101');
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => reject(tx.error);
            };
        });
    }, { userId, image });
    await page.unroute('**/js/auth.js');
    const authScript = id => `window.geoAuth = { userId: '${id}', fetch: () => { throw new Error('No provider calls during test'); } };
      const appScript = document.createElement('script'); appScript.src = '/js/script.js';
      appScript.onload = () => {
        document.getElementById('app-container').classList.remove('hidden');
        document.getElementById('welcome-screen').classList.add('hidden');
        window.initializeGeoVision();
      }; document.head.appendChild(appScript);`;
    await page.route('**/js/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: authScript(userId) }));
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('btn-subir-kmz').disabled && document.querySelectorAll('#lista-fotos li').length === 1);
    await page.locator('#input-kmz').setInputFiles(kmz);
    await page.getByText(/Guardado en este dispositivo/).waitFor();
    assert.equal(await page.locator('.satellite-layer').count(), 1);
    assert.equal(await page.locator('.leaflet-satelliteVectors-pane path').count(), 3);
    assert.equal(await page.locator('.leaflet-satelliteRaster-pane img').count(), 1);
    await page.locator('.satellite-layer select').selectOption('doc.kml:0');
    await page.getByRole('button', { name: 'Vincular', exact: true }).click();
    await page.locator('#revision-satelital-estado').selectOption('coincide');
    await page.locator('#revision-satelital-notas').fill('Confirmado con foto de campo.');
    await page.locator('#revision-satelital-notas').press('Tab');
    await page.waitForFunction(async () => (await satelliteStore.list())[0]?.reviews['doc.kml:0']?.notes === 'Confirmado con foto de campo.');
    await page.getByRole('button', { name: 'Ver Campo.png', exact: true }).click();
    await page.locator('.popup-drone-grande').waitFor();
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/kmz-desktop.png' });
    await page.locator('.satellite-layer input[type=checkbox]').uncheck();
    assert.equal(await page.locator('.leaflet-satelliteVectors-pane path').count(), 0);
    assert.equal(await page.locator('.leaflet-satelliteRaster-pane img').count(), 0);
    await page.waitForFunction(async () => (await satelliteStore.list())[0]?.visible === false);
    await page.reload();
    await page.locator('.satellite-layer').waitFor();
    assert.equal(await page.locator('.satellite-layer input[type=checkbox]').isChecked(), false);
    await page.locator('.satellite-layer select').selectOption('doc.kml:0');
    assert.equal(await page.locator('#revision-satelital-estado').inputValue(), 'coincide');
    assert.equal(await page.locator('#revision-satelital-notas').inputValue(), 'Confirmado con foto de campo.');
    await page.getByRole('button', { name: 'Ver Campo.png', exact: true }).waitFor();
    assert.equal(await page.locator('#lista-fotos li').count(), 1);
    assert.equal(await page.locator('#lista-poligonos-manuales li').count(), 1);
    await page.locator('#input-kmz').setInputFiles(kmz);
    await page.getByText(/ya estaba importado/).waitFor();
    assert.equal(await page.locator('.satellite-layer').count(), 1);
    await page.locator('#input-kmz').setInputFiles({ name: 'bad.kmz', mimeType: 'application/octet-stream', buffer: Buffer.from('broken') });
    await page.getByText(/dañado/).waitFor();
    assert.equal(await page.locator('.satellite-layer').count(), 1);
    await page.locator('.satellite-layer select').selectOption('doc.kml:2');
    assert.equal(await page.locator('#detalle-satelital h4').first().textContent(), '<img src=x onerror=alert(1)>');
    assert.equal(await page.locator('#detalle-satelital img').count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.satellite-layer select').selectOption('doc.kml:0');
    await page.screenshot({ path: 'test-results/kmz-mobile.png' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Quitar', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.satellite-layer'));
    assert.equal(await page.locator('#lista-fotos li').count(), 1);
    assert.equal(await page.locator('#lista-poligonos-manuales li').count(), 1);
    await page.locator('#input-kmz').setInputFiles(kmz);
    await page.getByText(/Guardado en este dispositivo/).waitFor();
    // Otra cuenta del mismo navegador no debe heredar capas ni fotos.
    await page.unroute('**/js/auth.js');
    await page.route('**/js/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: authScript('user_other') }));
    await page.reload();
    await page.getByText('Importá una capa para compararla con las fotos del campo.').waitFor();
    assert.equal(await page.locator('.satellite-layer').count(), 0);
    assert.equal(await page.locator('#lista-fotos li').count(), 0);
    assert.deepEqual(errors, []);
    console.log('KMZ browser checks passed: vectors, holes, embedded raster, photos/reviews, reload, migration, visibility, duplicates, invalid file, safe text, mobile, deletion and account isolation.');
} finally { await browser.close(); }
