(function () {
    'use strict';
    window.GeoVisionRasterImport = {
        create({ onImport }) {
            const node = id => document.getElementById(id);
            const dialog = node('raster-dialog'), form = node('raster-form'), input = node('input-raster');
            const submit = node('raster-submit'), manual = node('raster-manual'), preview = node('raster-preview');
            let current = null, worker = null, cancelWorker = null, previewURL = null, generation = 0, pdfModule = null, committing = false;
            const status = (text, error = false) => { node('raster-status').textContent = text; node('raster-status').classList.toggle('import-error', error); };
            function runWorker(payload) {
                return new Promise((resolve, reject) => {
                    const active = new Worker('/js/raster-worker.js'); worker = active;
                    const finish = (error, result) => {
                        clearTimeout(timer); active.terminate();
                        if (worker === active) { worker = null; cancelWorker = null; }
                        if (error) reject(error); else resolve(result);
                    };
                    const timer = setTimeout(() => finish(new Error('La lectura tardó demasiado. Probá una versión más pequeña del archivo.')), 60000);
                    cancelWorker = () => finish(new Error('Importación cancelada.'));
                    active.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.result);
                    active.onerror = () => finish(new Error('No se pudo procesar la imagen. Revisá el formato y el tamaño.'));
                    active.postMessage(payload);
                });
            }
            function showPreview(blob) {
                if (previewURL) URL.revokeObjectURL(previewURL);
                previewURL = URL.createObjectURL(blob); preview.src = previewURL;
                node('raster-preview-wrap').hidden = false;
                node('raster-crop-frame').hidden = manual.hidden;
            }
            function dispose() {
                generation++; cancelWorker?.();
                current?.renderTask?.cancel();
                if (current?.pdfTask) void current.pdfTask.destroy().catch(() => {});
                current = null;
                if (previewURL) URL.revokeObjectURL(previewURL);
                previewURL = null; preview.removeAttribute('src'); input.value = '';
            }
            function close() { if (!committing) dialog.close(); }
            dialog.addEventListener('cancel', event => { if (committing) event.preventDefault(); });
            // El evento close puede llegar después de abrir otro archivo.
            dialog.addEventListener('close', () => { if (!dialog.open) dispose(); });
            node('raster-cancel').onclick = close;
            function available() {
                submit.disabled = !current?.blob || current.loading || (!manual.hidden && !node('raster-north-up').checked);
            }
            node('raster-north-up').onchange = available;
            const margins = () => ['left', 'top', 'right', 'bottom'].map(key => node(`raster-crop-${key}`).value);
            function updateCrop() {
                try {
                    const [left, top, right, bottom] = GeoVisionRaster.crop(margins());
                    Object.assign(node('raster-crop-frame').style, { left: `${left}%`, top: `${top}%`, right: `${right}%`, bottom: `${bottom}%` });
                } catch (error) { status(error.message, true); }
            }
            for (const key of ['left', 'top', 'right', 'bottom']) node(`raster-crop-${key}`).oninput = updateCrop;
            function showResult(result) {
                current.result = result; current.blob = result.image; manual.hidden = true;
                showPreview(result.image);
                const [[south, west], [north, east]] = result.bounds;
                node('raster-location').textContent = `Ubicación automática · EPSG:${result.epsg}. Sur ${south.toFixed(6)}, norte ${north.toFixed(6)}, oeste ${west.toFixed(6)}, este ${east.toFixed(6)}.`;
                status('Georreferencia encontrada. Revisá la vista previa y agregala al mapa.');
            }
            async function renderPDF() {
                const state = current, token = generation;
                if (!state?.pdf || state.loading) return;
                state.loading = true; state.blob = null; state.result = null; available();
                node('raster-render-page').disabled = true; node('raster-page').disabled = true;
                manual.hidden = true; node('raster-location').textContent = ''; node('raster-preview-wrap').hidden = true;
                // Cada página tiene su propia ubicación; nunca heredar coordenadas de otra.
                for (const key of ['west', 'south', 'east', 'north']) node(`raster-${key}`).value = '';
                for (const key of ['left', 'top', 'right', 'bottom']) node(`raster-crop-${key}`).value = '0';
                node('raster-north-up').checked = false; node('raster-epsg').value = '4326';
                try {
                    const number = Number(node('raster-page').value);
                    if (!Number.isInteger(number) || number < 1 || number > state.pdf.numPages) throw new Error(`Elegí una página entre 1 y ${state.pdf.numPages}.`);
                    status(`Leyendo página ${number} y su georreferencia…`);
                    const page = await state.pdf.getPage(number);
                    if (generation !== token) return;
                    const original = page.getViewport({ scale: 1 });
                    if (![original.width, original.height].every(v => Number.isFinite(v) && v > 0)) throw new Error('Tamaño de página inválido.');
                    const viewport = page.getViewport({ scale: Math.min(2, GeoVisionRaster.LIMITS.side / Math.max(original.width, original.height)) });
                    const surface = document.createElement('canvas'); surface.width = Math.ceil(viewport.width); surface.height = Math.ceil(viewport.height);
                    state.renderTask = page.render({ canvasContext: surface.getContext('2d'), viewport, annotationMode: 0 });
                    await state.renderTask.promise;
                    const blob = await GeoVisionRaster.png(surface);
                    if (generation !== token) return;
                    state.page = number; state.blob = blob;
                    try {
                        const result = await runWorker({ kind: 'geopdf', buffer: await state.file.arrayBuffer(), page: number, viewport: viewport.transform, blob });
                        if (generation !== token) return;
                        showResult(result);
                    } catch (error) {
                        if (generation !== token) return;
                        manual.hidden = false; showPreview(blob); updateCrop();
                        status(`${error.message} Podés ingresar la ubicación manualmente o exportar un GeoTIFF.`, true);
                    }
                    page.cleanup();
                } catch (error) { if (generation === token) status(error.message || 'No se pudo mostrar esta página.', true); }
                finally {
                    if (generation === token) {
                        state.loading = false; available(); node('raster-render-page').disabled = false; node('raster-page').disabled = false;
                    }
                }
            }
            node('raster-render-page').onclick = renderPDF;
            node('raster-page').oninput = () => { submit.disabled = true; };
            node('btn-importar-raster').onclick = () => input.click();
            input.onchange = async () => {
                const file = input.files?.[0]; if (!file) return;
                dispose(); form.reset();
                current = { file, loading: true, blob: null };
                const state = current, token = generation;
                manual.hidden = true; node('raster-page-controls').hidden = true; node('raster-preview-wrap').hidden = true;
                node('raster-location').textContent = ''; node('raster-file-name').textContent = file.name;
                submit.disabled = true; node('raster-cancel').disabled = false;
                dialog.showModal(); status('Leyendo archivo en este dispositivo…');
                try {
                    GeoVisionRaster.checkFile(file);
                    if (/\.tiff?$/i.test(file.name)) {
                        const result = await runWorker({ kind: 'geotiff', buffer: await file.arrayBuffer() });
                        if (generation !== token) return;
                        showResult(result);
                    } else if (/\.pdf$/i.test(file.name)) {
                        pdfModule ||= await import('/vendor/pdf.mjs');
                        if (generation !== token) return;
                        pdfModule.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs';
                        state.pdfTask = pdfModule.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false,
                            cMapUrl: '/vendor/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/standard_fonts/', wasmUrl: '/vendor/wasm/',
                            maxImageSize: GeoVisionRaster.LIMITS.pixels, stopAtErrors: true, useWasm: false });
                        state.pdfTask.onPassword = () => { status('El PDF está protegido. Importá una copia sin contraseña.', true); void state.pdfTask.destroy().catch(() => {}); };
                        state.pdf = await state.pdfTask.promise;
                        if (generation !== token) return;
                        node('raster-page-controls').hidden = false; node('raster-page').max = String(state.pdf.numPages);
                        state.loading = false;
                        await renderPDF();
                    } else {
                        // Comprobar el encabezado antes de pedir al navegador que decodifique.
                        GeoVisionRaster.imageDimensions(await file.arrayBuffer());
                        if (generation !== token) return;
                        const headerURL = URL.createObjectURL(file), header = new Image();
                        try {
                            header.src = headerURL; await header.decode();
                            const size = GeoVisionRaster.dimensions(header.naturalWidth, header.naturalHeight);
                            const surface = document.createElement('canvas'); surface.width = size.width; surface.height = size.height;
                            surface.getContext('2d').drawImage(header, 0, 0, size.width, size.height);
                            const blob = await GeoVisionRaster.png(surface);
                            if (generation !== token) return;
                            state.blob = blob; manual.hidden = false; showPreview(blob); updateCrop();
                            status('Ingresá las coordenadas de los bordes de la imagen y verificá su orientación.');
                        } finally { URL.revokeObjectURL(headerURL); }
                    }
                } catch (error) { if (generation === token) status(error.message || 'No se pudo leer el archivo.', true); }
                finally { if (generation === token) { state.loading = false; available(); } }
            };
            form.onsubmit = async event => {
                event.preventDefault();
                const state = current, token = generation;
                if (!state?.blob || state.loading || committing || (state.pdf && Number(node('raster-page').value) !== state.page)) return;
                state.loading = true; available(); node('raster-render-page').disabled = true;
                try {
                    let result = state.result;
                    const placement = { page: state.page || null, manual: !result };
                    if (!result) {
                        if (!node('raster-north-up').checked) throw new Error('Confirmá la orientación y los límites del mapa.');
                        placement.epsg = Number(node('raster-epsg').value);
                        placement.bounds = GeoVisionRaster.extent(['west', 'south', 'east', 'north'].map(key => node(`raster-${key}`).value), placement.epsg);
                        placement.crop = GeoVisionRaster.crop(margins());
                        status('Ubicando la imagen en el mapa…');
                        result = await runWorker({ kind: 'manual', blob: state.blob, bounds: placement.bounds, epsg: placement.epsg, crop: placement.crop });
                    }
                    if (generation !== token) return;
                    const layer = await GeoVisionRaster.layer(state.file, result, placement);
                    if (generation !== token) return;
                    committing = true; node('raster-cancel').disabled = true;
                    await onImport(layer);
                    committing = false; dialog.close();
                } catch (error) { if (generation === token) status(error.message || 'No se pudo importar la capa.', true); }
                finally {
                    committing = false;
                    if (generation === token) { state.loading = false; available(); node('raster-cancel').disabled = false; node('raster-render-page').disabled = false; }
                }
            };
            return { isOpen: () => dialog.open };
        }
    };
})();
