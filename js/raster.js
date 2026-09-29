/* Conversión local de imágenes a una capa de referencia en Web Mercator. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GeoVisionRaster = api;
})(globalThis, function () {
    'use strict';
    const LIMITS = Object.freeze({ file: 50 * 1024 * 1024, pixels: 16000000, decoded: 128 * 1024 * 1024, side: 1600 });
    function checkFile(file) {
        if (!/\.(tiff?|png|jpe?g|pdf)$/i.test(file.name)) throw new Error('Elegí GeoTIFF, PNG, JPG o PDF.');
        if (!file.size || file.size > LIMITS.file) throw new Error('El archivo está vacío o supera los 50 MB.');
    }
    function dimensions(width, height, bytes = 4) {
        if (![width, height].every(v => Number.isSafeInteger(v) && v > 0) || width * height > LIMITS.pixels || width * height * bytes > LIMITS.decoded) {
            throw new Error('La imagen supera 16 millones de píxeles o 128 MB descomprimidos. Exportá una versión de menor resolución.');
        }
        const scale = Math.min(1, LIMITS.side / Math.max(width, height));
        return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
    }
    function imageDimensions(buffer) {
        const data = new DataView(buffer), bytes = new Uint8Array(buffer);
        if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
            const width = data.getUint32(16), height = data.getUint32(20); dimensions(width, height); return { width, height };
        }
        if (bytes[0] === 255 && bytes[1] === 216) {
            let offset = 2;
            while (offset + 4 <= bytes.length) {
                if (bytes[offset++] !== 255) break;
                while (bytes[offset] === 255) offset++;
                const marker = bytes[offset++];
                if (marker === 217 || marker === 218) break;
                if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
                if (offset + 2 > bytes.length) break;
                const length = data.getUint16(offset);
                if (length < 2 || offset + length > bytes.length) break;
                if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
                    const height = data.getUint16(offset + 3), width = data.getUint16(offset + 5);
                    dimensions(width, height); return { width, height };
                }
                offset += length;
            }
        }
        throw new Error('No se pudo leer una imagen PNG/JPG válida.');
    }
    function crs(code) {
        const n = Number(code);
        if (n === 4326 || n === 3857) return `EPSG:${n}`;
        if (Number.isInteger(n) && ((n >= 32601 && n <= 32660) || (n >= 32701 && n <= 32760))) {
            return `+proj=utm +zone=${n % 100} ${n >= 32701 ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`;
        }
        throw new Error(`EPSG ${code || 'desconocido'} no compatible. Exportá el mapa en WGS84 (4326), Web Mercator (3857) o UTM WGS84.`);
    }
    function extent(values, epsg = 4326) {
        const parsed = values.map(value => value === null || String(value).trim() === '' ? NaN : Number(value));
        const [west, south, east, north] = parsed;
        crs(epsg);
        if (!parsed.every(Number.isFinite) || west >= east || south >= north) throw new Error('Completá límites válidos: oeste menor que este y sur menor que norte.');
        if (Number(epsg) === 4326 && (west < -180 || east > 180 || south < -85.05112878 || north > 85.05112878 || east - west >= 180)) {
            throw new Error('Usá longitud/latitud en grados decimales, dentro de ±180° y ±85,05°, sin cruzar el antimeridiano.');
        }
        return parsed;
    }
    function crop(values) {
        const [left, top, right, bottom] = values.map(value => String(value).trim() === '' ? NaN : Number(value));
        if (![left, top, right, bottom].every(v => Number.isFinite(v) && v >= 0 && v < 100) || left + right >= 100 || top + bottom >= 100) throw new Error('El recorte debe dejar una superficie visible. Usá porcentajes entre 0 y 99.');
        return [left, top, right, bottom];
    }
    function affine(directory, keys = {}) {
        const tag = name => directory.getValue ? directory.getValue(name) : directory[name];
        const matrix = tag('ModelTransformation');
        let a, b, c, d, e, f;
        if (matrix) {
            if (matrix.length !== 16 || matrix[12] || matrix[13] || matrix[14] || matrix[15] !== 1) throw new Error('Transformación GeoTIFF no compatible.');
            [a, b, c, d, e, f] = [matrix[0], matrix[1], matrix[3], matrix[4], matrix[5], matrix[7]];
        } else {
            const tie = tag('ModelTiepoint'), scale = tag('ModelPixelScale');
            if (!tie || tie.length !== 6 || !scale || scale.length < 2 || scale[0] <= 0 || scale[1] <= 0) throw new Error('El TIFF no tiene una georreferencia afín compatible. Exportalo como GeoTIFF georreferenciado.');
            [a, b, d, e] = [scale[0], 0, 0, -scale[1]];
            c = tie[3] - tie[0] * a; f = tie[4] - tie[1] * e;
        }
        if (![a, b, c, d, e, f].every(Number.isFinite) || Math.abs(a * e - b * d) < 1e-20) throw new Error('La transformación del GeoTIFF es inválida.');
        // RasterPixelIsPoint ubica el centro del primer píxel, no su esquina.
        if (keys.GTRasterTypeGeoKey === 2) { c -= (a + b) / 2; f -= (d + e) / 2; }
        return [a, b, c, d, e, f];
    }
    function transform(matrix, x, y) {
        const [a, b, c, d, e, f] = matrix;
        return [a * x + b * y + c, d * x + e * y + f];
    }
    function inverse(matrix, x, y) {
        const [a, b, c, d, e, f] = matrix, determinant = a * e - b * d;
        return [(e * (x - c) - b * (y - f)) / determinant, (-d * (x - c) + a * (y - f)) / determinant];
    }
    function projectedExtent(matrix, width, height, projection) {
        const ring = [];
        for (const [start, end] of [[[0, 0], [width, 0]], [[width, 0], [width, height]], [[width, height], [0, height]], [[0, height], [0, 0]]]) {
            for (let i = 0; i < 32; i++) {
                const xy = transform(matrix, start[0] + (end[0] - start[0]) * i / 32, start[1] + (end[1] - start[1]) * i / 32);
                ring.push(projection.forward(xy));
            }
        }
        if (ring.some(p => !p.every(Number.isFinite))) throw new Error('No se pudieron transformar las coordenadas.');
        const box = extent([Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])), Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))]);
        ring.push([...ring[0]]);
        return { box, geometry: { type: 'Polygon', coordinates: [ring] } };
    }
    function canvas(width, height) {
        if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
        const result = document.createElement('canvas'); result.width = width; result.height = height; return result;
    }
    async function png(surface) {
        const blob = surface.convertToBlob ? await surface.convertToBlob({ type: 'image/png' }) : await new Promise(resolve => surface.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('No se pudo crear la imagen del mapa.');
        return blob;
    }
    const mercatorY = latitude => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));
    async function warp(rgba, width, height, matrix, epsg, proj4) {
        const projection = proj4(crs(epsg), 'EPSG:4326');
        const { box, geometry } = projectedExtent(matrix, width, height, projection);
        const [west, south, east, north] = box;
        const northY = mercatorY(north), southY = mercatorY(south);
        const ratio = (east - west) * Math.PI / 180 / (northY - southY);
        const longest = Math.min(LIMITS.side, Math.max(width, height));
        const outW = Math.max(1, Math.round(ratio >= 1 ? longest : longest * ratio));
        const outH = Math.max(1, Math.round(ratio >= 1 ? longest / ratio : longest));
        const surface = canvas(outW, outH), ctx = surface.getContext('2d'), output = ctx.createImageData(outW, outH);
        for (let y = 0; y < outH; y++) {
            const latitude = (2 * Math.atan(Math.exp(northY + (southY - northY) * (y + 0.5) / outH)) - Math.PI / 2) * 180 / Math.PI;
            for (let x = 0; x < outW; x++) {
                const coordinate = projection.inverse([west + (east - west) * (x + 0.5) / outW, latitude]);
                const point = inverse(matrix, coordinate[0], coordinate[1]);
                const sx = Math.floor(point[0]), sy = Math.floor(point[1]);
                if (sx >= 0 && sy >= 0 && sx < width && sy < height) {
                    const source = (sy * width + sx) * 4, target = (y * outW + x) * 4;
                    output.data.set(rgba.subarray(source, source + 4), target);
                }
            }
        }
        ctx.putImageData(output, 0, 0);
        return { image: await png(surface), bounds: [[south, west], [north, east]], geometry };
    }
    async function geotiff(buffer, GeoTIFF, proj4) {
        const tiff = await GeoTIFF.fromArrayBuffer(buffer);
        try {
            const image = await tiff.getImage(), directory = image.getFileDirectory(), keys = image.getGeoKeys() || {};
            const tag = name => directory.getValue(name);
            const epsg = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey;
            crs(epsg);
            if ((tag('Orientation') || 1) !== 1) throw new Error('Orientación TIFF no compatible. Exportá una imagen con orientación normal.');
            const originalW = image.getWidth(), originalH = image.getHeight(), samples = image.getSamplesPerPixel();
            if (samples > 4) throw new Error('El TIFF tiene más de cuatro bandas. Exportá una composición RGB o una sola banda.');
            const size = dimensions(originalW, originalH, image.getBytesPerPixel());
            dimensions(image.getBlockWidth(), image.getBlockHeight(0), image.getBytesPerPixel());
            const matrix = affine(directory, keys);
            // Validar antes de descomprimir los píxeles.
            projectedExtent(matrix, originalW, originalH, proj4(crs(epsg), 'EPSG:4326'));
            const photo = tag('PhotometricInterpretation');
            if (![0, 1, 2, 3].includes(photo)) throw new Error('Exportá el TIFF como RGB, escala de grises o paleta de colores.');
            const bands = await image.readRasters({ width: size.width, height: size.height, interleave: false });
            const noData = image.getGDALNoData(), rgba = new Uint8ClampedArray(size.width * size.height * 4);
            const colorMap = photo === 3 ? await directory.loadValue('ColorMap') : null;
            const baseBands = photo === 2 ? 3 : 1;
            if (samples < baseBands || (photo === 3 && !colorMap)) throw new Error('Bandas o paleta TIFF incompletas.');
            const extra = tag('ExtraSamples') || [];
            const alpha = [1, 2].includes(extra[0]) && samples > baseBands ? baseBands : -1;
            const valid = value => Number.isFinite(value) && (noData === null || value !== noData);
            const ranges = bands.map((band, index) => {
                if (image.getSampleFormat(index) === 1) return [0, 2 ** image.getBitsPerSample(index) - 1];
                let min = Infinity, max = -Infinity;
                for (const value of band) if (valid(value)) { min = Math.min(min, value); max = Math.max(max, value); }
                return [min, max];
            });
            const scale = (value, band) => ranges[band][1] === ranges[band][0] ? 128 : Math.max(0, Math.min(255, (value - ranges[band][0]) * 255 / (ranges[band][1] - ranges[band][0])));
            for (let i = 0; i < size.width * size.height; i++) {
                if (bands.slice(0, baseBands).some(band => !Number.isFinite(band[i])) ||
                    (noData !== null && bands.slice(0, baseBands).every(band => band[i] === noData))) continue;
                let opacity = alpha >= 0 ? scale(bands[alpha][i], alpha) : 255;
                if (!Number.isFinite(opacity)) opacity = 0;
                for (let channel = 0; channel < 3; channel++) {
                    let value = photo === 3 ? colorMap[bands[0][i] + channel * (colorMap.length / 3)] / 257 : scale(bands[photo === 2 ? channel : 0][i], photo === 2 ? channel : 0);
                    if (photo === 0) value = 255 - value;
                    if (alpha >= 0 && extra[0] === 1 && opacity > 0) value *= 255 / opacity;
                    rgba[i * 4 + channel] = value;
                }
                rgba[i * 4 + 3] = opacity;
            }
            const sampled = [matrix[0] * originalW / size.width, matrix[1] * originalH / size.height, matrix[2], matrix[3] * originalW / size.width, matrix[4] * originalH / size.height, matrix[5]];
            return { ...await warp(rgba, size.width, size.height, sampled, epsg, proj4), epsg,
                warnings: ['Vista de referencia remuestreada a un máximo de 1.600 píxeles por lado; conservá el ráster original.'] };
        } finally { await tiff.close(); }
    }
    async function manual(blob, values, epsg, margins, proj4) {
        const [west, south, east, north] = extent(values, epsg);
        const [left, top, right, bottom] = crop(margins);
        const bitmap = await createImageBitmap(blob);
        try {
            const width = Math.max(1, Math.round(bitmap.width * (100 - left - right) / 100));
            const height = Math.max(1, Math.round(bitmap.height * (100 - top - bottom) / 100));
            const size = dimensions(width, height), surface = canvas(size.width, size.height), ctx = surface.getContext('2d');
            ctx.drawImage(bitmap, bitmap.width * left / 100, bitmap.height * top / 100, width, height, 0, 0, size.width, size.height);
            return { ...await warp(ctx.getImageData(0, 0, size.width, size.height).data, size.width, size.height,
                [(east - west) / size.width, 0, west, 0, (south - north) / size.height, north], epsg, proj4), epsg,
                warnings: ['Ubicación ingresada manualmente: verificá la alineación con puntos conocidos del terreno. Vista de referencia reducida; conservá el original.'] };
        } finally { bitmap.close(); }
    }
    async function layer(file, rendered, placement = {}) {
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        const placementDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(placement)));
        const suffix = Array.from(new Uint8Array(placementDigest), b => b.toString(16).padStart(2, '0')).join('');
        return { id: `raster:${hash}:${suffix}`, name: file.name, features: [], visible: true, opacity: 0.75, reviews: {}, warnings: rendered.warnings || [],
            overlays: [{ image: rendered.image, bounds: rendered.bounds, geometry: rendered.geometry, opacity: 1,
                properties: { id: 'raster:0', name: `${file.name}${placement.page ? ` · página ${placement.page}` : ''}`, description: 'Capa de referencia. No se convierte en una misión ni en polígonos de exportación.', folder: '', source: file.name,
                    fields: [['Coordenadas de origen', `EPSG:${rendered.epsg}`], ['Ubicación', placement.manual ? 'Ingresada manualmente' : placement.page ? 'GeoPDF' : 'GeoTIFF']], style: {} } }] };
    }
    return { LIMITS, checkFile, dimensions, imageDimensions, crs, extent, crop, affine, transform, inverse, projectedExtent, canvas, png, warp, geotiff, manual, layer };
});
