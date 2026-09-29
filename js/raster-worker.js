importScripts('/vendor/geotiff.js', '/vendor/proj4.js', '/js/raster.js');
self.onmessage = async ({ data }) => {
    try {
        let result;
        if (data.kind === 'geotiff') result = await GeoVisionRaster.geotiff(data.buffer, GeoTIFF, proj4);
        else if (data.kind === 'geopdf') {
            importScripts('/vendor/pdf-lib.js', '/js/geopdf.js');
            result = await GeoVisionGeoPDF.render(data, PDFLib, GeoVisionRaster, proj4);
        } else result = await GeoVisionRaster.manual(data.blob, data.bounds, data.epsg, data.crop, proj4);
        self.postMessage({ result });
    } catch (error) { self.postMessage({ error: error.message || 'No se pudo leer el ráster.' }); }
};
