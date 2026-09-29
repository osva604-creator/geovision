/* Lectura local de identificaciones KML/KMZ. No ejecuta HTML ni sigue enlaces. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GeoVisionKMZ = api;
})(globalThis, function () {
    'use strict';
    const LIMITS = Object.freeze({ file: 25 * 1024 * 1024, expanded: 40 * 1024 * 1024,
        kml: 10 * 1024 * 1024, entries: 512, features: 5000, coordinates: 100000 });
    const children = (node, name) => Array.from(node?.childNodes || []).filter(n => n.nodeType === 1 && (!name || n.localName === name));
    const first = (node, name) => children(node, name)[0];
    const text = (node, name) => (first(node, name)?.textContent || '').trim();
    const all = (node, name) => Array.from(node.getElementsByTagName('*')).filter(n => n.localName === name);
    function color(value) {
        if (!/^[a-f\d]{8}$/i.test(value)) return null;
        return { color: `#${value.slice(6, 8)}${value.slice(4, 6)}${value.slice(2, 4)}`, opacity: parseInt(value.slice(0, 2), 16) / 255 };
    }
    function styleOf(node) {
        const style = {};
        const line = first(node, 'LineStyle'), poly = first(node, 'PolyStyle'), icon = first(node, 'IconStyle');
        const stroke = color(text(line, 'color')), fill = color(text(poly, 'color')), point = color(text(icon, 'color'));
        if (stroke) Object.assign(style, stroke);
        if (text(line, 'width') && Number.isFinite(Number(text(line, 'width')))) style.weight = Math.max(0, Math.min(12, Number(text(line, 'width'))));
        if (fill) Object.assign(style, { fillColor: fill.color, fillOpacity: fill.opacity });
        if (text(poly, 'fill') === '0') style.fillOpacity = 0;
        if (text(poly, 'outline') === '0') style.weight = 0;
        if (point) Object.assign(style, { pointColor: point.color, pointOpacity: point.opacity });
        return style;
    }
    function coordinates(node, budget, minimum = 1, ring = false) {
        const raw = text(node, 'coordinates');
        if (!raw) throw new Error('sin coordenadas');
        const values = raw.split(/\s+/).map(tuple => {
            const parts = tuple.split(',');
            const lon = Number(parts[0]), lat = Number(parts[1]);
            if (parts.length < 2 || !parts[0].trim() || !parts[1].trim() || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new Error('coordenadas inválidas');
            if (++budget.coordinates > LIMITS.coordinates) throw new RangeError('El archivo supera las 100.000 coordenadas. Dividilo en capas más pequeñas.');
            return [lon, lat];
        });
        if (values.length < minimum) throw new Error('geometría incompleta');
        if (values.some((p, i) => i && Math.abs(p[0] - values[i - 1][0]) > 180)) throw new Error('cruce del antimeridiano no compatible');
        if (ring) {
            if (new Set(values.map(p => p.join(','))).size < 3) throw new Error('polígono sin tres vértices distintos');
            const a = values[0], b = values[values.length - 1];
            if (a[0] !== b[0] || a[1] !== b[1]) values.push([...a]);
        }
        return values;
    }
    function geometry(node, budget, depth = 0) {
        if (depth > 20) throw new Error('geometrías anidadas en exceso');
        if (node.localName === 'Point') {
            const coords = coordinates(node, budget);
            if (coords.length !== 1) throw new Error('punto con múltiples coordenadas');
            return { type: 'Point', coordinates: coords[0] };
        }
        if (node.localName === 'LineString' || node.localName === 'LinearRing') return { type: 'LineString', coordinates: coordinates(node, budget, 2) };
        if (node.localName === 'Polygon') {
            const exterior = first(first(node, 'outerBoundaryIs'), 'LinearRing');
            if (!exterior) throw new Error('polígono sin borde exterior');
            const rings = [coordinates(exterior, budget, 3, true)];
            for (const hole of children(node, 'innerBoundaryIs')) rings.push(coordinates(first(hole, 'LinearRing'), budget, 3, true));
            return { type: 'Polygon', coordinates: rings };
        }
        if (node.localName === 'MultiGeometry') {
            const geometries = children(node).map(n => geometry(n, budget, depth + 1));
            if (!geometries.length) throw new Error('geometría vacía');
            return { type: 'GeometryCollection', geometries };
        }
        throw new Error(`geometría ${node.localName} no compatible`);
    }
    function plain(value, Parser) {
        // Solo texto; se renderiza siempre con textContent, nunca con innerHTML.
        const string = String(value || '').slice(0, 12000);
        if (!string.includes('<')) return string.trim();
        try { return new Parser().parseFromString(`<div>${string}</div>`, 'text/xml').documentElement.textContent.slice(0, 4000).trim(); }
        catch { return string.replace(/<[^>]*>/g, ' ').slice(0, 4000).trim(); }
    }
    function parseKml(source, { Parser = globalThis.DOMParser, sourceName = 'doc.kml', budget = { coordinates: 0, features: 0 } } = {}) {
        if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('El KML contiene declaraciones XML no admitidas.');
        const document = new Parser().parseFromString(source, 'text/xml');
        if (!document.documentElement || all(document, 'parsererror').length || document.documentElement.localName !== 'kml') throw new Error('El archivo no contiene un KML válido.');
        const features = [], overlays = [], warnings = [];
        const selectors = new Map();
        for (const node of [...all(document, 'Style'), ...all(document, 'StyleMap')]) if (node.getAttribute('id')) selectors.set(node.getAttribute('id'), node);
        function resolveStyle(url, depth = 0) {
            if (!url.startsWith('#') || depth > 8) return {};
            const node = selectors.get(url.slice(1));
            if (!node) return {};
            if (node.localName === 'Style') return styleOf(node);
            const pair = children(node, 'Pair').find(p => text(p, 'key') === 'normal');
            return { ...resolveStyle(text(pair, 'styleUrl'), depth + 1), ...styleOf(first(pair, 'Style')) };
        }
        function properties(node, index) {
            const fields = [];
            const extended = first(node, 'ExtendedData');
            if (extended) {
                for (const data of [...all(extended, 'Data'), ...all(extended, 'SimpleData')].slice(0, 40)) {
                    fields.push([plain(text(data, 'displayName') || data.getAttribute('name'), Parser).slice(0, 200),
                        plain(data.localName === 'Data' ? text(data, 'value') : data.textContent, Parser)]);
                }
            }
            const folders = [];
            for (let parent = node.parentNode; parent && parent.nodeType === 1; parent = parent.parentNode) {
                if (parent.localName === 'Folder' && text(parent, 'name')) folders.unshift(text(parent, 'name').slice(0, 200));
            }
            return { id: `${sourceName}:${index}`, name: text(node, 'name').slice(0, 300) || `Identificación ${index + 1}`,
                description: plain(text(node, 'description'), Parser), fields, folder: folders.join(' / '), source: sourceName,
                style: { ...resolveStyle(text(node, 'styleUrl')), ...styleOf(first(node, 'Style')) } };
        }
        const placemarks = all(document, 'Placemark');
        if (placemarks.length + all(document, 'GroundOverlay').length + budget.features > LIMITS.features) throw new RangeError('El archivo supera las 5.000 identificaciones. Dividilo en capas más pequeñas.');
        placemarks.forEach((node, index) => {
            const props = properties(node, index);
            try {
                const nodes = children(node).filter(n => ['Point', 'LineString', 'LinearRing', 'Polygon', 'MultiGeometry', 'Track', 'MultiTrack', 'Model'].includes(n.localName));
                if (!nodes.length) throw new Error('sin geometría compatible');
                const geometries = nodes.map(n => geometry(n, budget));
                features.push({ type: 'Feature', properties: props,
                    geometry: geometries.length === 1 ? geometries[0] : { type: 'GeometryCollection', geometries } });
                budget.features++;
            } catch (error) {
                if (error instanceof RangeError) throw error;
                warnings.push(`${props.name}: ${error.message}.`);
            }
        });
        all(document, 'GroundOverlay').forEach((node, index) => {
            const props = properties(node, placemarks.length + index);
            try {
                const box = first(node, 'LatLonBox');
                if (!box || first(node, 'LatLonQuad')) throw new Error('imagen con encuadre no compatible; se requiere LatLonBox sin rotación');
                const values = ['north', 'south', 'east', 'west'].map(key => text(box, key) === '' ? NaN : Number(text(box, key)));
                const [north, south, east, west] = values;
                if (!values.every(Number.isFinite) || north <= south || east <= west || north > 90 || south < -90 || east > 180 || west < -180) throw new Error('límites geográficos inválidos');
                if (Number(text(box, 'rotation')) !== 0) throw new Error('imagen rotada no compatible');
                const href = text(first(node, 'Icon'), 'href');
                if (!href || /^(?:[a-z][a-z\d+.-]*:|[\/\\])/i.test(href)) throw new Error('imagen externa no cargada; debe estar dentro del KMZ');
                overlays.push({ properties: props, href, bounds: [[south, west], [north, east]], opacity: color(text(node, 'color'))?.opacity ?? 0.7 });
                budget.features++;
            } catch (error) { warnings.push(`${props.name}: ${error.message}.`); }
        });
        if (all(document, 'NetworkLink').length) warnings.push('No se consultaron enlaces de red. Solo se leen los archivos incluidos.');
        if (all(document, 'ScreenOverlay').length) warnings.push('Se omitieron imágenes de pantalla (leyendas sin ubicación geográfica).');
        return { features, overlays, warnings };
    }
    function readEntry(entry, remaining) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            let total = 0, ended = false;
            const stream = entry.internalStream('uint8array');
            stream.on('data', chunk => {
                if (ended) return;
                total += chunk.byteLength;
                if (total > remaining) {
                    ended = true; stream.pause(); chunks.length = 0;
                    reject(new Error('El contenido descomprimido supera el límite permitido. Dividí el KMZ en archivos más pequeños.'));
                    return;
                }
                chunks.push(chunk);
            }).on('error', error => { if (!ended) { ended = true; reject(error); } }).on('end', () => {
                if (ended) return;
                ended = true;
                const result = new Uint8Array(total);
                let offset = 0;
                for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
                resolve(result);
            }).resume();
        });
    }
    function relativePath(kml, href) {
        let decoded;
        try { decoded = decodeURIComponent(href); } catch { return null; }
        if (/^(?:[a-z][a-z\d+.-]*:|[\/\\])/i.test(decoded) || decoded.includes('\\')) return null;
        const parts = kml.split('/').slice(0, -1);
        for (const part of decoded.split('/')) {
            if (part === '..') { if (!parts.length) return null; parts.pop(); }
            else if (part !== '.' && part) parts.push(part);
        }
        return parts.join('/');
    }
    function decodeXml(bytes) {
        let encoding = 'utf-8';
        if (bytes[0] === 255 && bytes[1] === 254) encoding = 'utf-16le';
        else if (bytes[0] === 254 && bytes[1] === 255) encoding = 'utf-16be';
        else encoding = new TextDecoder().decode(bytes.slice(0, 200)).match(/<\?xml[^>]*encoding=["']([^"']+)/i)?.[1] || encoding;
        try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
        catch { throw new Error('No se pudo leer la codificación del KML. Exportalo como UTF-8.'); }
    }
    async function readFile(file, { JSZip = globalThis.JSZip, Parser = globalThis.DOMParser } = {}) {
        if (!/\.(kmz|kml)$/i.test(file.name)) throw new Error('Elegí un archivo .kmz o .kml.');
        if (file.size > LIMITS.file) throw new Error('El archivo supera los 25 MB.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
        const result = { id: hash, name: file.name, features: [], overlays: [], warnings: [], visible: true, opacity: 0.75, reviews: {} };
        const budget = { features: 0, coordinates: 0 };
        let zip, entries;
        if (/\.kmz$/i.test(file.name)) {
            if (!JSZip) throw new Error('No se cargó el lector KMZ. Revisá tu conexión y recargá la página.');
            try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error('El KMZ está dañado, cifrado o no es un ZIP compatible.'); }
            if (Object.keys(zip.files).length > LIMITS.entries) throw new Error('El KMZ contiene demasiados archivos (máximo 512).');
            entries = Object.values(zip.files).filter(entry => !entry.dir && /\.kml$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
            if (!entries.length) throw new Error('El KMZ no contiene ningún archivo KML.');
        } else {
            if (bytes.byteLength > LIMITS.kml) throw new Error('El KML supera los 10 MB.');
            entries = [{ name: file.name }];
        }
        let expanded = 0;
        for (const entry of entries) {
            const content = zip ? await readEntry(entry, Math.min(LIMITS.kml, LIMITS.expanded - expanded)) : bytes;
            expanded += content.byteLength;
            let parsed;
            try { parsed = parseKml(decodeXml(content), { Parser, sourceName: entry.name, budget }); }
            catch (error) { throw new Error(`${entry.name}: ${error.message}`); }
            result.features.push(...parsed.features);
            result.warnings.push(...parsed.warnings);
            for (const overlay of parsed.overlays) {
                const path = relativePath(entry.name, overlay.href);
                const image = path && zip?.file(path);
                if (!image) { result.warnings.push(`${overlay.properties.name}: imagen no encontrada dentro del KMZ.`); continue; }
                const data = await readEntry(image, LIMITS.expanded - expanded);
                expanded += data.byteLength;
                const png = data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71;
                const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
                if (!png && !jpeg) { result.warnings.push(`${overlay.properties.name}: la imagen debe ser PNG o JPEG.`); continue; }
                result.overlays.push({ ...overlay, image: new Blob([data], { type: png ? 'image/png' : 'image/jpeg' }) });
            }
        }
        if (!result.features.length && !result.overlays.length) throw new Error(`No se encontraron elementos compatibles para el mapa. ${result.warnings.slice(0, 3).join(' ')}`);
        return result;
    }

    function inRing(point, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i], [xj, yj] = ring[j];
            if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }
    function segmentDistance(point, a, b) {
        const scale = Math.PI * 6371000 / 180, cos = Math.cos(point[1] * Math.PI / 180);
        const ax = (a[0] - point[0]) * scale * cos, ay = (a[1] - point[1]) * scale;
        const bx = (b[0] - point[0]) * scale * cos, by = (b[1] - point[1]) * scale;
        const dx = bx - ax, dy = by - ay;
        const t = dx * dx + dy * dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
        return Math.hypot(ax + t * dx, ay + t * dy);
    }
    function distanceToGeometry(point, geom) {
        if (geom.type === 'GeometryCollection') return Math.min(...geom.geometries.map(g => distanceToGeometry(point, g)));
        if (geom.type === 'Point') return segmentDistance(point, geom.coordinates, geom.coordinates);
        if (geom.type === 'Polygon' && inRing(point, geom.coordinates[0]) && !geom.coordinates.slice(1).some(r => inRing(point, r))) return 0;
        const lines = geom.type === 'Polygon' ? geom.coordinates : [geom.coordinates];
        let distance = Infinity;
        for (const line of lines) for (let i = 1; i < line.length; i++) distance = Math.min(distance, segmentDistance(point, line[i - 1], line[i]));
        return distance;
    }
    return { LIMITS, parseKml, readFile, distanceToGeometry, relativePath };
});
