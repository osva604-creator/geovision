import test from 'node:test';
import assert from 'node:assert/strict';
import proj4 from 'proj4';
import * as PDFLib from 'pdf-lib';
import { fromArrayBuffer } from 'geotiff';
import raster from '../js/raster.js';
import geopdf from '../js/geopdf.js';
import { tiffFixture, pdfFixture } from './raster-fixtures.mjs';

test('raster rejects empty bounds, invalid extents, unsupported CRS and excessive resources', () => {
    assert.throws(() => raster.extent(['', -27, -65, -26]), /límites/);
    assert.throws(() => raster.extent([-65, -27, -66, -26]), /límites/);
    assert.throws(() => raster.extent([-65, -27, -64, 89]), /grados/);
    assert.throws(() => raster.crs(22185), /no compatible/);
    assert.throws(() => raster.dimensions(100000, 100000), /millones/);
    assert.throws(() => raster.dimensions(4000, 4000, 16), /128 MB/);
    assert.throws(() => raster.checkFile({ name: 'big.tif', size: raster.LIMITS.file + 1 }), /50 MB/);
    assert.throws(() => raster.crop([50, 0, 50, 0]), /recorte/);
    assert.throws(() => raster.crop(['', 0, 0, 0]), /recorte/);
    assert.deepEqual(raster.extent([300000, 7030000, 300100, 7030100], 32720), [300000, 7030000, 300100, 7030100]);
});

test('GeoTIFF geotransform accounts for tiepoint offsets, pixel centers and rotation', async () => {
    assert.deepEqual(raster.affine({ ModelPixelScale: [2, 3, 0], ModelTiepoint: [10, 20, 0, 100, 200, 0] }), [2, 0, 80, 0, -3, 260]);
    assert.deepEqual(raster.affine({ ModelPixelScale: [2, 3, 0], ModelTiepoint: [0, 0, 0, 100, 200, 0] }, { GTRasterTypeGeoKey: 2 }), [2, 0, 99, 0, -3, 201.5]);
    for (const rotated of [false, true]) {
        const file = tiffFixture({ rotated });
        const tiff = await fromArrayBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
        const image = await tiff.getImage();
        const matrix = raster.affine(image.getFileDirectory(), image.getGeoKeys());
        const p = raster.transform(matrix, 5, 8), inverse = raster.inverse(matrix, ...p);
        assert.ok(Math.abs(inverse[0] - 5) < 1e-7 && Math.abs(inverse[1] - 8) < 1e-7);
        const bounds = raster.projectedExtent(matrix, 32, 32, proj4('EPSG:4326', 'EPSG:4326'));
        assert.ok(bounds.box[0] < -65.2 && bounds.box[1] < -26.83);
        await tiff.close();
    }
});

test('PNG and JPEG dimensions are bounded before decoding', () => {
    const png = new Uint8Array(24); png.set([137, 80, 78, 71]);
    const view = new DataView(png.buffer); view.setUint32(16, 300); view.setUint32(20, 200);
    assert.deepEqual(raster.imageDimensions(png.buffer), { width: 300, height: 200 });
    view.setUint32(16, 100000);
    assert.throws(() => raster.imageDimensions(png.buffer), /millones/);
    const jpeg = new Uint8Array([255, 216, 255, 192, 0, 8, 8, 0, 100, 0, 200, 3]);
    assert.deepEqual(raster.imageDimensions(jpeg.buffer), { width: 200, height: 100 });
    assert.throws(() => raster.imageDimensions(new Uint8Array([255, 216, 255]).buffer), /válida/);
});

test('UTM south transforms to the correct hemisphere and longitude', () => {
    const projection = proj4(raster.crs(32720), 'EPSG:4326');
    const [lon, lat] = projection.forward([300000, 7030000]);
    assert.ok(lon > -66 && lon < -64);
    assert.ok(lat > -28 && lat < -26);
    const back = projection.inverse([lon, lat]);
    assert.ok(Math.abs(back[0] - 300000) < 0.001 && Math.abs(back[1] - 7030000) < 0.001);
});

test('GeoPDF resolves compressed indirect geospatial dictionaries per page', async () => {
    const data = await pdfFixture();
    const result = await geopdf.metadata(data, 0, PDFLib);
    assert.equal(result.epsg, 4326);
    assert.deepEqual(result.bbox, [50, 50, 350, 350]);
    assert.deepEqual(result.geographic.slice(0, 2), [-26.833, -65.203]);
    await assert.rejects(geopdf.metadata(data, 1, PDFLib), /georreferencia/);
    await assert.rejects(geopdf.metadata(await pdfFixture({ georeferenced: false }), 0, PDFLib), /georreferencia/);
});

test('GeoPDF affine fit preserves all control point axes and rejects degenerate points', () => {
    const matrix = geopdf.fit([[0, 0], [0, 100], [100, 100]], [[10, 30], [12, 20], [22, 21]]);
    assert.deepEqual(raster.transform(matrix, 100, 0), [20, 31]);
    assert.throws(() => geopdf.fit([[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 1], [2, 2]]), /degenerados/);
});

test('raster identity includes page and manual placement, preserving distinct georeferences', async () => {
    const file = new File(['image'], 'map.png');
    const rendered = { image: new Blob(['preview']), bounds: [[-27, -66], [-26, -65]], epsg: 4326 };
    const a = await raster.layer(file, rendered, { page: 1 });
    assert.equal(a.id, (await raster.layer(file, rendered, { page: 1 })).id);
    assert.notEqual(a.id, (await raster.layer(file, rendered, { page: 2 })).id);
    assert.notEqual(a.id, (await raster.layer(file, rendered, { bounds: [-66, -27, -65, -26] })).id);
    assert.equal(a.features.length, 0);
    assert.equal(a.overlays[0].image, rendered.image);
});
