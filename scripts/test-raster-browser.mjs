import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { tiffFixture, pdfFixture } from '../test/raster-fixtures.mjs';

const base = process.env.GEOVISION_TEST_URL || 'http://127.0.0.1:8787';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Solo se admite un servidor local.');
const browser = await chromium.launch({ headless: true, ...(process.env.GEOVISION_BROWSER_CHANNEL ? { channel: process.env.GEOVISION_BROWSER_CHANNEL } : {}) });
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => void dialog.accept());
    await page.route('**/js/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: `
        window.geoAuth={userId:'user_raster_test',fetch:()=>{throw new Error('No API calls in test');}};
        const script=document.createElement('script');script.src='/js/script.js';
        script.onload=()=>{document.getElementById('app-container').classList.remove('hidden');document.getElementById('welcome-screen').classList.add('hidden');initializeGeoVision();};document.head.appendChild(script);` }));
    await page.goto(base);
    await page.waitForFunction(() => !document.getElementById('btn-subir-kmz').disabled);
    await page.getByRole('button', { name: 'Importar polígono', exact: false }).click();
    await page.getByRole('button', { name: 'KMZ / KML', exact: true }).waitFor();
    const load = async (name, buffer) => {
        await page.locator('#input-raster').setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
        await page.locator('#raster-dialog').waitFor();
    };
    const waitReady = async () => {
        try { await page.waitForFunction(() => !document.getElementById('raster-submit').disabled, null, { timeout: 30000 }); }
        catch (error) { throw new Error(`${await page.locator('#raster-status').textContent()}: ${error.message}`); }
    };
    const commit = async count => {
        await page.locator('#raster-submit').click();
        await page.locator('#raster-dialog').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('.satellite-layer').count(), count);
    };
    await load('WGS84.tif', tiffFixture());
    await waitReady();
    assert.match(await page.locator('#raster-location').textContent(), /4326/);
    await commit(1);
    let saved = await page.evaluate(async () => (await satelliteStore.list())[0]);
    assert.ok(Math.abs(saved.overlays[0].bounds[0][0] - (-26.8332)) < 1e-7);
    await load('WGS84.tif', tiffFixture()); await waitReady(); await commit(1);
    await load('UTM-sur.tif', tiffFixture({ epsg: 32720 })); await waitReady(); await commit(2);
    await load('Rotado.tif', tiffFixture({ rotated: true })); await waitReady(); await commit(3);
    await load('NoData.tif', tiffFixture({ nodata: true })); await waitReady(); await commit(4);
    const noDataPixels = await page.evaluate(async () => {
        const data = (await satelliteStore.list()).find(r => r.name === 'NoData.tif');
        const bitmap = await createImageBitmap(data.overlays[0].image), canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
        return [ctx.getImageData(0, 0, 1, 1).data[3], ctx.getImageData(10, bitmap.height - 1, 1, 1).data[3]];
    });
    assert.deepEqual(noDataPixels, [0, 255]);
    const png = Buffer.from(await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = 300; c.height = 200;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#00bb77'; ctx.fillRect(0, 0, 300, 200);
        return c.toDataURL().split(',')[1];
    }), 'base64');
    await load('Manual.png', png);
    await page.locator('#raster-manual').waitFor();
    assert.equal(await page.locator('#raster-submit').isDisabled(), true);
    for (const [key, value] of Object.entries({ west: '-65.203', east: '-65.2', south: '-26.833', north: '-26.83' })) await page.locator(`#raster-${key}`).fill(value);
    await page.locator('#raster-north-up').check();
    await commit(5);
    await load('Mapa.pdf', await pdfFixture());
    await waitReady();
    assert.match(await page.locator('#raster-location').textContent(), /automática/);
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/geopdf-desktop.png' });
    await commit(6);
    await load('Mapa-rotado.pdf', await pdfFixture({ rotation: 90 })); await waitReady(); await commit(7);
    await load('Mapa.pdf', await pdfFixture()); await waitReady();
    await page.locator('#raster-page').fill('2');
    assert.equal(await page.locator('#raster-submit').isDisabled(), true);
    await page.locator('#raster-render-page').click();
    await page.locator('#raster-manual').waitFor();
    assert.match(await page.locator('#raster-status').textContent(), /manual/);
    assert.equal(await page.locator('#raster-submit').isDisabled(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/raster-mobile.png' });
    assert.equal(await page.locator('#raster-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    for (const [key, value] of Object.entries({ west: '-65.203', east: '-65.2', south: '-26.833', north: '-26.83' })) await page.locator(`#raster-${key}`).fill(value);
    await page.locator('#raster-manual summary').click();
    await page.locator('#raster-crop-left').fill('7.5');
    await page.locator('#raster-crop-right').fill('7.5');
    await page.locator('#raster-north-up').check();
    await commit(8);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const jpg = Buffer.from(await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = 200; c.height = 100;
        c.getContext('2d').fillRect(0, 0, 200, 100); return c.toDataURL('image/jpeg').split(',')[1];
    }), 'base64');
    await load('Manual.jpg', jpg); await page.locator('#raster-manual').waitFor();
    for (const [key, value] of Object.entries({ west: '-65.2', east: '-65.203', south: '-26.833', north: '-26.83' })) await page.locator(`#raster-${key}`).fill(value);
    await page.locator('#raster-north-up').check();
    await page.locator('#raster-submit').click();
    await page.waitForFunction(() => document.getElementById('raster-status').textContent.includes('límites válidos'));
    assert.equal(await page.locator('.satellite-layer').count(), 8);
    await page.locator('#raster-west').fill('-65.203'); await page.locator('#raster-east').fill('-65.2');
    await commit(9);
    await load('Cancelado.png', png); await page.locator('#raster-manual').waitFor();
    await page.locator('#raster-cancel').click();
    assert.equal(await page.locator('.satellite-layer').count(), 9);
    await load('unsupported.tif', tiffFixture({ epsg: 22185 }));
    await page.waitForFunction(() => document.getElementById('raster-status').textContent.includes('no compatible'));
    assert.equal(await page.locator('#raster-submit').isDisabled(), true);
    await page.locator('#raster-cancel').click();
    await load('broken.pdf', Buffer.from('invalid'));
    try { await page.waitForFunction(() => document.getElementById('raster-status').classList.contains('import-error')); }
    catch (error) { throw new Error(`${await page.locator('#raster-status').textContent()} / ${errors.join(', ')}: ${error.message}`); }
    assert.equal(await page.locator('#raster-submit').isDisabled(), true);
    await page.locator('#raster-cancel').click();
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.satellite-layer').length === 9);
    assert.equal(await page.locator('.leaflet-satelliteRaster-pane img').count(), 9);
    await page.locator('.satellite-layer').filter({ hasText: 'WGS84.tif' }).getByRole('button', { name: 'Quitar', exact: true }).click();
    await page.waitForFunction(async () => (await satelliteStore.list()).length === 8);
    await page.unroute('**/js/auth.js');
    await page.route('**/js/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: `
        window.geoAuth={userId:'user_raster_other'};const script=document.createElement('script');script.src='/js/script.js';
        script.onload=()=>{document.getElementById('app-container').classList.remove('hidden');document.getElementById('welcome-screen').classList.add('hidden');initializeGeoVision();};document.head.appendChild(script);` }));
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('btn-subir-kmz').disabled);
    assert.equal(await page.locator('.satellite-layer').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Raster browser checks passed: WGS84, UTM south, rotation, NoData, PNG/JPG manual, GeoPDF, PDF page/rotation/crop/manual, cancellation, duplicate, invalid bounds/CRS/PDF, mobile, persistence, deletion and account isolation.');
} finally { await browser.close(); }
