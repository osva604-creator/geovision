(function () {
    'use strict';
    const element = (tag, text, className) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    const button = (label, action) => {
        const node = element('button', label);
        node.type = 'button'; node.addEventListener('click', action);
        return node;
    };
    const palette = ['#c084fc', '#fb923c', '#22d3ee', '#facc15'];
    const statuses = [['pendiente', 'Pendiente'], ['coincide', 'Coincide con campo'], ['no-coincide', 'No coincide'], ['revisar', 'Revisar']];

    window.GeoVisionSatellite = {
        create({ map, store, getPhotos, getSelectedPhoto, selectPhoto }) {
            const input = document.getElementById('input-kmz');
            const upload = document.getElementById('btn-subir-kmz');
            const notice = document.getElementById('estado-kmz');
            const list = document.getElementById('lista-capas-satelitales');
            const detail = document.getElementById('detalle-satelital');
            const records = new Map();
            let selected = null, busy = false;
            for (const [name, zIndex] of [['satelliteRaster', 320], ['satelliteVectors', 350]]) {
                if (!map.getPane(name)) map.createPane(name).style.zIndex = String(zIndex);
            }
            function message(text, error = false) {
                notice.textContent = text;
                notice.classList.toggle('satellite-error', error);
            }
            async function persist(record) {
                const snapshot = structuredClone(record.data);
                record.pending = (record.pending || Promise.resolve()).then(() => store.put(snapshot));
                try {
                    if (!await record.pending) throw new Error('storage');
                    record.persisted = true;
                    return true;
                } catch {
                    record.pending = Promise.resolve(false);
                    message('No se pudo guardar esta capa. Los últimos cambios quedan solo en esta sesión; conservá el KMZ original.', true);
                    return false;
                }
            }
            function boundsOf(layer) {
                if (layer.getBounds) return layer.getBounds();
                return L.latLngBounds([layer.getLatLng()]);
            }
            function ensureVisible(record) {
                if (!record.data.visible) {
                    record.data.visible = true;
                    record.group.addTo(map);
                    void persist(record); renderList();
                }
            }
            function focus(record, target) {
                ensureVisible(record);
                const bounds = boundsOf(target || record.group);
                if (bounds.isValid()) map.fitBounds(bounds.pad(0.1), { maxZoom: 19, padding: [25, 25] });
            }
            function applyOpacity(record) {
                for (const item of record.items.values()) {
                    if (item.overlay) item.layer.setOpacity(item.overlay.opacity * record.data.opacity);
                    else {
                        const style = item.feature.properties.style;
                        item.layer.setStyle({ opacity: (style.opacity ?? 1) * record.data.opacity,
                            fillOpacity: (style.fillOpacity ?? style.pointOpacity ?? (item.feature.geometry.type === 'Point' ? 0.8 : 0.25)) * record.data.opacity });
                    }
                }
            }
            function add(data, persisted = false) {
                const record = { data, group: L.featureGroup(), items: new Map(), urls: [], pending: Promise.resolve(true), persisted };
                const color = palette[records.size % palette.length];
                data.reviews ||= {};
                data.opacity = Number.isFinite(data.opacity) ? Math.max(0, Math.min(1, data.opacity)) : 0.75;
                for (const feature of data.features) {
                    const custom = feature.properties.style;
                    const style = { color, weight: 2, fillColor: color, fillOpacity: 0.25, ...custom,
                        pane: 'satelliteVectors', bubblingMouseEvents: false };
                    const layer = L.geoJSON(feature, {
                        style,
                        pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
                            ...style, color: custom.pointColor || style.color,
                            fillColor: custom.pointColor || style.fillColor, fillOpacity: custom.pointOpacity ?? 0.8, radius: 7
                        })
                    });
                    const item = { feature, layer, properties: feature.properties };
                    record.items.set(feature.properties.id, item);
                    layer.bindTooltip(element('span', feature.properties.name));
                    layer.on('click', () => select(record, item));
                    record.group.addLayer(layer);
                }
                for (const overlay of data.overlays) {
                    const url = URL.createObjectURL(overlay.image);
                    record.urls.push(url);
                    const layer = L.imageOverlay(url, overlay.bounds, { pane: 'satelliteRaster', interactive: true,
                        bubblingMouseEvents: false, opacity: overlay.opacity * data.opacity });
                    const item = { overlay, layer, properties: overlay.properties };
                    record.items.set(overlay.properties.id, item);
                    layer.bindTooltip(element('span', overlay.properties.name));
                    layer.on('click', () => select(record, item));
                    layer.on('error', () => message(`No se pudo mostrar la imagen «${overlay.properties.name}». Verificá el KMZ original.`, true));
                    record.group.addLayer(layer);
                }
                records.set(data.id, record);
                applyOpacity(record);
                if (data.visible !== false) record.group.addTo(map);
                return record;
            }
            async function remove(record) {
                try { await record.pending; } catch { /* Se informa abajo si no puede borrarse. */ }
                let deleted = false;
                try { deleted = await store.remove(record.data.id); } catch { /* Almacenamiento no disponible. */ }
                if (!deleted && record.persisted) {
                    message('No se pudo eliminar la capa guardada. Reintentá.', true); return false;
                }
                map.removeLayer(record.group);
                record.urls.forEach(url => URL.revokeObjectURL(url));
                records.delete(record.data.id);
                if (selected?.record === record) { selected = null; detail.replaceChildren(); detail.classList.add('hidden'); }
                renderList(); return true;
            }
            function renderList() {
                list.replaceChildren();
                for (const record of records.values()) {
                    const data = record.data;
                    const li = element('li', undefined, 'satellite-layer');
                    const title = element('label', undefined, 'satellite-layer-title');
                    const visible = element('input'); visible.type = 'checkbox'; visible.checked = data.visible !== false;
                    visible.addEventListener('change', () => {
                        data.visible = visible.checked;
                        if (data.visible) record.group.addTo(map); else map.removeLayer(record.group);
                        void persist(record);
                    });
                    title.append(visible, element('strong', data.name));
                    const meta = element('small', `${data.features.length} identificaciones · ${data.overlays.length} imágenes`);
                    const actions = element('div', undefined, 'satellite-actions');
                    actions.append(button('Ver capa', () => focus(record)), button('Quitar', async () => {
                        if (confirm(`¿Quitar «${data.name}» y sus revisiones? Las fotos del campo se conservan.`)) await remove(record);
                    }));
                    const opacityLabel = element('label', 'Transparencia de la capa', 'satellite-opacity');
                    const opacity = element('input'); opacity.type = 'range'; opacity.min = '0'; opacity.max = '100';
                    opacity.value = String(Math.round((1 - data.opacity) * 100));
                    opacity.setAttribute('aria-label', `Transparencia de ${data.name}`);
                    opacity.addEventListener('input', () => { data.opacity = 1 - Number(opacity.value) / 100; applyOpacity(record); });
                    opacity.addEventListener('change', () => void persist(record));
                    opacityLabel.append(opacity);
                    const choose = element('select'); choose.setAttribute('aria-label', `Identificación de ${data.name}`);
                    const placeholder = element('option', 'Elegir identificación…'); placeholder.value = ''; choose.append(placeholder);
                    for (const [id, item] of record.items) {
                        const option = element('option', item.properties.name); option.value = id; choose.append(option);
                    }
                    choose.addEventListener('change', () => {
                        const item = record.items.get(choose.value);
                        if (item) { focus(record, item.layer); select(record, item); }
                    });
                    li.append(title, meta, actions, opacityLabel, choose);
                    if (data.warnings.length) {
                        const details = element('details'); details.append(element('summary', `${data.warnings.length} avisos de importación`));
                        const warnings = element('ul');
                        data.warnings.slice(0, 50).forEach(warning => warnings.append(element('li', warning)));
                        if (data.warnings.length > 50) warnings.append(element('li', 'Hay más elementos omitidos. Revisá el archivo original.'));
                        details.append(warnings); li.append(details);
                    }
                    list.append(li);
                }
            }
            function review() {
                const { record, item } = selected;
                return record.data.reviews[item.properties.id] ||= { status: 'pendiente', notes: '', photoIds: [] };
            }
            function select(record, item) {
                selected = { record, item };
                detail.classList.remove('hidden'); detail.replaceChildren();
                const props = item.properties;
                detail.append(element('h4', props.name), element('small', `${record.data.name}${props.folder ? ` · ${props.folder}` : ''}`));
                if (props.description) detail.append(element('p', props.description, 'satellite-description'));
                if (props.fields.length) {
                    const fields = element('dl');
                    for (const [name, value] of props.fields) fields.append(element('dt', name), element('dd', value));
                    detail.append(fields);
                }
                detail.append(button('Centrar identificación', () => focus(record, item.layer)));
                const statusLabel = element('label', 'Validación en campo');
                const status = element('select'); status.id = 'revision-satelital-estado';
                for (const [value, label] of statuses) { const option = element('option', label); option.value = value; status.append(option); }
                status.value = review().status;
                status.addEventListener('change', () => { review().status = status.value; void persist(record); });
                statusLabel.append(status);
                const notesLabel = element('label', 'Observaciones');
                const notes = element('textarea'); notes.id = 'revision-satelital-notas'; notes.rows = 3; notes.maxLength = 2000;
                notes.placeholder = 'Qué observaste al comparar con las fotos…'; notes.value = review().notes;
                notes.addEventListener('change', () => { review().notes = notes.value; void persist(record); });
                notesLabel.append(notes);
                detail.append(statusLabel, notesLabel);
                const photos = element('div'); photos.id = 'fotos-comparacion-satelital'; detail.append(photos);
                refreshPhotos();
                const sidebar = document.getElementById('sidebar');
                if (matchMedia('(max-width: 768px)').matches && !sidebar.classList.contains('mobile-open')) document.getElementById('btn-mobile-controles').click();
                detail.scrollIntoView({ block: 'nearest' });
            }
            function refreshPhotos() {
                if (!selected) return;
                const target = document.getElementById('fotos-comparacion-satelital');
                if (!target) return;
                target.replaceChildren(element('h4', 'Fotos de campo'));
                const { record, item } = selected;
                const photos = getPhotos();
                const current = getSelectedPhoto();
                const linkCurrent = button(current ? `Vincular foto: ${current.nombre}` : 'Elegí una foto del historial para vincularla', () => {
                    const photo = getSelectedPhoto();
                    if (photo && !review().photoIds.includes(photo.id)) {
                        review().photoIds.push(photo.id); void persist(record); refreshPhotos();
                    }
                });
                linkCurrent.disabled = !current; target.append(linkCurrent);
                const linked = element('div', undefined, 'satellite-linked');
                for (const id of review().photoIds) {
                    const photo = photos.find(value => value.id === id);
                    const row = element('div', undefined, 'satellite-photo-row');
                    if (photo) row.append(button(`Ver ${photo.nombre}`, () => comparePhoto(photo)));
                    else row.append(element('small', 'Foto vinculada eliminada del historial'));
                    row.append(button('Desvincular', () => {
                        review().photoIds = review().photoIds.filter(value => value !== id);
                        void persist(record); refreshPhotos();
                    }));
                    linked.append(row);
                }
                target.append(linked);
                let geom = item.feature?.geometry || item.overlay?.geometry;
                if (!geom) {
                    const [[south, west], [north, east]] = item.overlay.bounds;
                    geom = { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] };
                }
                const nearby = photos.map(photo => ({ photo, distance: GeoVisionKMZ.distanceToGeometry([photo.lon, photo.lat], geom) }))
                    .filter(entry => entry.distance <= 100).sort((a, b) => a.distance - b.distance);
                target.append(element('small', nearby.length ? 'GPS dentro de la zona o a menos de 100 m:' : 'No hay fotos con GPS dentro de la zona ni a menos de 100 m. Podés vincular otra foto desde el historial.'));
                for (const { photo, distance } of nearby.slice(0, 20)) {
                    const row = element('div', undefined, 'satellite-photo-row');
                    row.append(button(`${photo.nombre} · ${distance < 1 ? 'en la zona' : `${Math.round(distance)} m`}`, () => comparePhoto(photo)));
                    const link = button(review().photoIds.includes(photo.id) ? 'Vinculada' : 'Vincular', () => {
                        if (!review().photoIds.includes(photo.id)) review().photoIds.push(photo.id);
                        void persist(record); refreshPhotos();
                    });
                    link.disabled = review().photoIds.includes(photo.id); row.append(link); target.append(row);
                }
                if (nearby.length > 20) target.append(element('small', `Se muestran las 20 más cercanas de ${nearby.length} fotos.`));
                target.append(element('p', 'El GPS indica dónde estaba la cámara. La cercanía no confirma por sí sola la identificación del satélite.', 'satellite-hint'));
            }
            function comparePhoto(photo) {
                const { record, item } = selected;
                selectPhoto(photo, false);
                photo.marcador?.closePopup();
                ensureVisible(record);
                const bounds = boundsOf(item.layer).extend([photo.lat, photo.lon]);
                map.fitBounds(bounds.pad(0.15), { maxZoom: 19, padding: [30, 30], animate: false });
                photo.marcador?.openPopup();
            }
            const ready = (async () => {
                upload.disabled = true;
                try {
                    for (const data of await store.list()) add(data, true);
                    renderList();
                    message(records.size ? `${records.size} capas satelitales recuperadas.` : 'Importá una capa para compararla con las fotos del campo.');
                } catch { message('No se pudieron recuperar las capas guardadas. Revisá el almacenamiento del navegador.', true); }
                finally { upload.disabled = false; }
            })();
            upload.onclick = () => {
                const options = document.getElementById('opciones-importar');
                options.hidden = !options.hidden;
                upload.setAttribute('aria-expanded', String(!options.hidden));
            };
            document.getElementById('btn-importar-kmz').onclick = () => input.click();
            const rasterImporter = GeoVisionRasterImport.create({
                async onImport(data) {
                    await ready;
                    if (busy) throw new Error('Esperá a que termine la otra importación.');
                    if (records.has(data.id)) { focus(records.get(data.id)); message(`${data.name}: ya estaba importado.`); return; }
                    if (records.size >= 20) throw new Error('Podés guardar hasta 20 capas. Quitá una antes de continuar.');
                    busy = true; upload.disabled = true;
                    try {
                        const record = add(data); renderList(); focus(record);
                        const saved = await persist(record);
                        message(`${data.name}: capa de referencia agregada.${saved ? ' Guardado en este dispositivo.' : ' No se pudo guardar: solo esta sesión.'}`, !saved);
                    } finally { busy = false; upload.disabled = false; }
                }
            });
            input.onchange = async () => {
                const files = Array.from(input.files || []);
                if (!files.length) return;
                await ready;
                if (busy) return;
                busy = true; upload.disabled = true;
                const messages = [];
                let failed = false;
                try {
                    for (const file of files) {
                        try {
                            message(`Leyendo ${file.name}…`);
                            const data = await GeoVisionKMZ.readFile(file);
                            if (records.has(data.id)) { focus(records.get(data.id)); messages.push(`${file.name}: ya estaba importado.`); continue; }
                            if (records.size >= 20) throw new Error('Podés guardar hasta 20 capas. Quitá una antes de continuar.');
                            const record = add(data); renderList(); focus(record);
                            const saved = await persist(record);
                            messages.push(`${file.name}: ${data.features.length} identificaciones y ${data.overlays.length} imágenes.${data.warnings.length ? ` ${data.warnings.length} avisos: revisá el detalle de la capa.` : ''}${saved ? ' Guardado en este dispositivo.' : ' No se pudo guardar: solo esta sesión.'}`);
                            if (!saved) failed = true;
                        } catch (error) { failed = true; messages.push(`${file.name}: ${error.message}`); }
                    }
                } finally { busy = false; upload.disabled = false; input.value = ''; message(messages.join('\n'), failed); }
            };
            return { ready, refreshPhotos,
                async clear() {
                    await ready;
                    if (busy || rasterImporter.isOpen()) { message('Esperá a que termine la importación antes de borrar el mapa.', true); return false; }
                    for (const record of [...records.values()]) if (!await remove(record)) return false;
                    message('Capas satelitales eliminadas.'); return true;
                }
            };
        }
    };
})();
