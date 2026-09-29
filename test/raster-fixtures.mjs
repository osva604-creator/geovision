import { writeArrayBuffer } from 'geotiff';
import { PDFDocument, PDFName, rgb, degrees } from 'pdf-lib';

export function tiffFixture({ epsg = 4326, rotated = false, nodata = false } = {}) {
    const width = 32, height = 32, values = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        values.set(x < 16 ? [220, 40, 30] : [30, 200, 70], i);
    }
    if (nodata) values.fill(0, 0, 3 * width * 8);
    const geographic = epsg === 4326;
    const meta = { width, height, BitsPerSample: [8, 8, 8], SamplesPerPixel: 3, PhotometricInterpretation: 2,
        GTModelTypeGeoKey: geographic ? 2 : 1, GTRasterTypeGeoKey: 1,
        ...(geographic ? { GeographicTypeGeoKey: epsg } : { ProjectedCSTypeGeoKey: epsg }),
        ModelPixelScale: geographic ? [0.0001, 0.0001, 0] : [10, 10, 0],
        ModelTiepoint: geographic ? [0, 0, 0, -65.203, -26.83, 0] : [0, 0, 0, 300000, 7030000, 0],
        ...(nodata ? { GDAL_NODATA: '0\0' } : {}) };
    if (rotated) {
        delete meta.ModelPixelScale; delete meta.ModelTiepoint;
        meta.ModelTransformation = [0.0001, 0.00003, 0, -65.203, 0.00003, -0.0001, 0, -26.83, 0, 0, 1, 0, 0, 0, 0, 1];
    }
    return Buffer.from(writeArrayBuffer(values, meta));
}

export async function pdfFixture({ georeferenced = true, rotation = 0, epsg = 4326 } = {}) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    page.setRotation(degrees(rotation));
    page.drawRectangle({ x: 50, y: 50, width: 150, height: 300, color: rgb(0.8, 0.1, 0.1) });
    page.drawRectangle({ x: 200, y: 50, width: 150, height: 300, color: rgb(0.1, 0.8, 0.2) });
    if (georeferenced) {
        const measure = doc.context.obj({ Type: 'Measure', Subtype: 'GEO',
            Bounds: [0, 0, 0, 1, 1, 1, 1, 0], LPTS: [0, 0, 0, 1, 1, 1, 1, 0],
            GPTS: [-26.833, -65.203, -26.830, -65.203, -26.830, -65.200, -26.833, -65.200],
            GCS: { Type: 'GEOGCS', EPSG: epsg } });
        page.node.set(PDFName.of('VP'), doc.context.obj([{ Type: 'Viewport', BBox: [50, 50, 350, 350], Measure: doc.context.register(measure) }]));
    }
    const other = doc.addPage([400, 400]);
    other.drawRectangle({ x: 30, y: 30, width: 340, height: 340, color: rgb(0.1, 0.3, 0.7) });
    return Buffer.from(await doc.save());
}
