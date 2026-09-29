/* Georreferencia ISO 32000 /VP /Measure /GEO. No ejecuta acciones del PDF. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GeoVisionGeoPDF = api;
})(globalThis, function () {
    'use strict';
    function fit(points, targets) {
        // Resolver una transformación afín y verificar todos los puntos de control.
        const [p, q, r] = points, [u, v, w] = targets;
        const determinant = (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
        if (Math.abs(determinant) < 1e-10) throw new Error('Puntos de control GeoPDF degenerados.');
        const solve = axis => {
            const a = ((v[axis] - u[axis]) * (r[1] - p[1]) - (w[axis] - u[axis]) * (q[1] - p[1])) / determinant;
            const b = ((q[0] - p[0]) * (w[axis] - u[axis]) - (r[0] - p[0]) * (v[axis] - u[axis])) / determinant;
            return [a, b, u[axis] - a * p[0] - b * p[1]];
        };
        return [...solve(0), ...solve(1)];
    }
    async function metadata(buffer, pageIndex, lib) {
        const { PDFDocument, PDFName, PDFArray, PDFNumber, PDFDict } = lib;
        const document = await PDFDocument.load(buffer, { updateMetadata: false });
        const page = document.getPage(pageIndex);
        const get = (dict, name) => dict instanceof PDFDict ? dict.lookup(PDFName.of(name)) : undefined;
        const numbers = obj => {
            if (!(obj instanceof PDFArray) || obj.size() > 256) throw new Error('Coordenadas GeoPDF no compatibles.');
            return obj.asArray().map(value => document.context.lookup(value, PDFNumber).asNumber());
        };
        const viewports = get(page.node, 'VP');
        if (!(viewports instanceof PDFArray) || !viewports.size() || viewports.size() > 64) throw new Error('No se encontró georreferencia ISO 32000 en esta página.');
        const candidates = [];
        for (let i = 0; i < viewports.size(); i++) {
            const vp = viewports.lookup(i), measure = get(vp, 'Measure');
            if (String(get(measure, 'Subtype')) !== '/GEO') continue;
            const bbox = numbers(get(vp, 'BBox'));
            if (bbox.length !== 4 || !bbox.every(Number.isFinite) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) continue;
            candidates.push({ measure, bbox, area: (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) });
        }
        candidates.sort((a, b) => b.area - a.area);
        if (!candidates.length) throw new Error('No se encontró un mapa GeoPDF compatible en esta página.');
        const { measure, bbox } = candidates[0];
        const gcs = get(measure, 'GCS'), code = get(gcs, 'EPSG');
        let epsg = code instanceof PDFNumber ? code.asNumber() : null;
        if (!epsg) {
            const wkt = get(gcs, 'WKT')?.decodeText?.() || '';
            const authority = wkt.match(/(?:AUTHORITY|ID)\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]\s*\]\s*$/i);
            if (authority) epsg = Number(authority[1]);
        }
        const local = numbers(get(measure, 'LPTS')), geographic = numbers(get(measure, 'GPTS'));
        const bounds = get(measure, 'Bounds');
        const neatline = bounds ? numbers(bounds) : [0, 0, 1, 0, 1, 1, 0, 1];
        if (local.length < 8 || local.length !== geographic.length || local.length % 2 || neatline.length < 6 || neatline.length % 2 ||
            ![...local, ...neatline].every(v => Number.isFinite(v) && v >= 0 && v <= 1) || !geographic.every(Number.isFinite)) throw new Error('Puntos de control GeoPDF incompletos.');
        return { bbox, epsg, local, geographic, neatline, multiple: candidates.length > 1 };
    }
    async function render(data, lib, raster, proj4) {
        const meta = await metadata(data.buffer, data.page - 1, lib);
        const projection = proj4('EPSG:4326', raster.crs(meta.epsg));
        const [x0, y0, x1, y1] = meta.bbox;
        const [a, b, c, d, e, f] = data.viewport;
        const pagePoint = (x, y) => [a * x + c * y + e, b * x + d * y + f];
        const normalized = (x, y) => pagePoint(x0 + x * (x1 - x0), y0 + y * (y1 - y0));
        const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(p => normalized(...p));
        const left = Math.floor(Math.min(...corners.map(p => p[0]))), top = Math.floor(Math.min(...corners.map(p => p[1])));
        const right = Math.ceil(Math.max(...corners.map(p => p[0]))), bottom = Math.ceil(Math.max(...corners.map(p => p[1])));
        const bitmap = await createImageBitmap(data.blob);
        try {
            if (left < 0 || top < 0 || right > bitmap.width || bottom > bitmap.height) throw new Error('El mapa georreferenciado excede la página visible.');
            const width = right - left, height = bottom - top;
            raster.dimensions(width, height);
            const points = [], targets = [];
            for (let i = 0; i < meta.local.length; i += 2) {
                const point = normalized(meta.local[i], meta.local[i + 1]);
                points.push([point[0] - left, point[1] - top]);
                const lat = meta.geographic[i], lon = meta.geographic[i + 1];
                if (Math.abs(lat) > 85.05112878 || Math.abs(lon) > 180) throw new Error('El GeoPDF no usa coordenadas GPTS latitud/longitud compatibles.');
                targets.push(projection.forward([lon, lat]));
            }
            const matrix = fit(points, targets);
            for (let i = 0; i < targets.length; i++) {
                const check = raster.inverse(matrix, ...targets[i]);
                if (!check.every(Number.isFinite) || Math.hypot(check[0] - points[i][0], check[1] - points[i][1]) > 1) throw new Error('El GeoPDF requiere una transformación no afín. Exportalo como GeoTIFF.');
            }
            const surface = raster.canvas(width, height), ctx = surface.getContext('2d');
            const ring = [];
            ctx.beginPath();
            for (let i = 0; i < meta.neatline.length; i += 2) {
                const p = normalized(meta.neatline[i], meta.neatline[i + 1]);
                const x = p[0] - left, y = p[1] - top;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                ring.push(projection.inverse(raster.transform(matrix, x, y)));
            }
            ctx.closePath(); ctx.clip(); ctx.drawImage(bitmap, -left, -top);
            const result = await raster.warp(ctx.getImageData(0, 0, width, height).data, width, height, matrix, meta.epsg, proj4);
            ring.push([...ring[0]]);
            return { ...result, geometry: { type: 'Polygon', coordinates: [ring] }, epsg: meta.epsg, warnings: [
                'GeoPDF ISO 32000: se importó el mapa georreferenciado de la página elegida como imagen de referencia reducida.',
                ...(meta.multiple ? ['La página contiene varios mapas; se importó el de mayor superficie.'] : [])
            ] };
        } finally { bitmap.close(); }
    }
    return { metadata, fit, render };
});
