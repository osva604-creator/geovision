window.VISION_ENGINE = (function () {
    const ONNX_MODEL_URL = "models/yolov10_medium.onnx";
    const TF_MODEL_URL = "models/yolov8_nano_quant/model.json";
    const TILE_SIZE = 1280;
    const MAX_IMAGE_SIZE = 4096;

    const state = {
        kind: null,
        model: null,
        ready: false,
        fallback: false
    };

    function isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
            || navigator.maxTouchPoints > 1
            || navigator.userAgent.includes("Mobile");
    }

    function isDesktopDevice() {
        return !isMobileDevice();
    }

    async function loadDetector() {
        if (state.ready) return state;

        if (isDesktopDevice()) {
            try {
                await loadYoloOnnx();
                return state;
            } catch (error) {
                console.warn("Error cargando YOLOv10 ONNX, usando fallback:", error);
            }
        }

        if (isMobileDevice()) {
            try {
                await loadYoloTfjs();
                return state;
            } catch (error) {
                console.warn("Error cargando YOLOv8 TFJS, usando fallback:", error);
            }
        }

        await loadCocoFallback();
        return state;
    }

    async function loadYoloOnnx() {
        if (!window.ort) {
            throw new Error("onnxruntime-web no está cargado.");
        }
        state.kind = "onnx";
        state.model = await ort.InferenceSession.create(ONNX_MODEL_URL, {
            executionProviders: ["wasm", "webgl"],
            graphOptimizationLevel: "all"
        });
        state.ready = true;
        return state;
    }

    async function loadYoloTfjs() {
        if (!window.tf) {
            throw new Error("TensorFlow.js no está cargado.");
        }
        state.kind = "tfjs";
        state.model = await tf.loadGraphModel(TF_MODEL_URL);
        state.ready = true;
        return state;
    }

    async function loadCocoFallback() {
        if (!window.cocoSsd) {
            throw new Error("No hay ningún modelo disponible para detección.");
        }
        state.kind = "coco";
        state.model = await cocoSsd.load();
        state.ready = true;
        state.fallback = true;
        return state;
    }

    async function detectImage(input) {
        await loadDetector();
        if (!state.model) {
            throw new Error("Detector no inicializado.");
        }

        const canvas = await prepareImageForInference(input);
        state.lastInputWidth = canvas.width;
        state.lastInputHeight = canvas.height;

        const tiles = getTiles(canvas, TILE_SIZE);
        const detecciones = [];

        for (const tile of tiles) {
            const resultados = state.kind === "onnx"
                ? await detectOnOnnx(tile.canvas)
                : state.kind === "tfjs"
                    ? await detectOnTfjs(tile.canvas)
                    : await detectOnCoco(tile.canvas);
            resultados.forEach((item) => {
                detecciones.push({
                    ...item,
                    x: item.x + tile.x,
                    y: item.y + tile.y
                });
            });
        }

        return detecciones;
    }

    async function detectOnCoco(input) {
        const detecciones = await state.model.detect(input);
        return detecciones.map(normalizarDeteccion);
    }

    async function detectOnOnnx(input) {
        const output = await runOnnxInference(input);
        return normalizeYoloDetections(output, input.width, input.height);
    }

    async function detectOnTfjs(input) {
        const output = await runTfjsInference(input);
        return normalizeYoloDetections(output, input.width, input.height);
    }

    async function runOnnxInference(canvas) {
        const inputName = state.model.inputNames[0];
        const tensorData = canvasToCHWTensor(canvas);
        const feeds = {};
        feeds[inputName] = new ort.Tensor("float32", tensorData, [1, 3, canvas.height, canvas.width]);
        const results = await state.model.run(feeds);
        const outputName = state.model.outputNames[0];
        const output = results[outputName];
        return { data: output.data || output, shape: output.dims || output.shape || [] };
    }

    async function runTfjsInference(canvas) {
        const inputShape = state.model.inputs?.[0]?.shape || [];
        let tensor = tf.browser.fromPixels(canvas).toFloat().div(255.0);
        if (inputShape.length === 4 && inputShape[1] === 3) {
            tensor = tensor.transpose([2, 0, 1]).expandDims(0);
        } else {
            tensor = tensor.expandDims(0);
        }

        const output = await state.model.executeAsync(tensor);
        const tensors = Array.isArray(output) ? output : Object.values(output);
        const firstOutput = tensors[0];
        const data = firstOutput.dataSync ? firstOutput.dataSync() : firstOutput;
        const shape = firstOutput.shape || [];
        if (Array.isArray(output)) {
            output.forEach((item) => { if (item.dispose) item.dispose(); });
        } else {
            Object.values(output).forEach((item) => { if (item.dispose) item.dispose(); });
        }
        tensor.dispose();
        return { data, shape };
    }

    function canvasToCHWTensor(canvas) {
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("No se pudo obtener el contexto del canvas.");
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { data } = imageData;
        const tensor = new Float32Array(canvas.width * canvas.height * 3);
        let ptr = 0;

        for (let c = 0; c < 3; c += 1) {
            for (let y = 0; y < canvas.height; y += 1) {
                for (let x = 0; x < canvas.width; x += 1) {
                    const idx = (y * canvas.width + x) * 4;
                    const value = data[idx + c] / 255.0;
                    tensor[ptr] = value;
                    ptr += 1;
                }
            }
        }

        return tensor;
    }

    function normalizeYoloDetections(output, width, height) {
        if (!output || !output.data || !output.shape) return [];
        const raw = output.data;
        const shape = output.shape;
        let rows = 0;
        if (shape.length === 3) {
            rows = shape[1];
        } else if (shape.length === 2) {
            rows = shape[0];
        } else if (shape.length === 4 && shape[3] === 85) {
            rows = shape[2] * shape[1];
        } else {
            rows = Math.floor(raw.length / 85);
        }
        const detecciones = [];

        for (let i = 0; i < rows; i += 1) {
            const base = i * 85;
            const x = raw[base];
            const y = raw[base + 1];
            const w = raw[base + 2];
            const h = raw[base + 3];
            const obj = raw[base + 4];
            let bestClass = 0;
            let bestScore = 0;
            for (let c = 5; c < 85; c += 1) {
                if (raw[base + c] > bestScore) {
                    bestScore = raw[base + c];
                    bestClass = c - 5;
                }
            }
            const score = obj * bestScore;
            if (score < 0.25) continue;

            const normalized = x <= 1 && y <= 1 && w <= 1 && h <= 1;
            const centerX = normalized ? x * width : x;
            const centerY = normalized ? y * height : y;
            const boxW = normalized ? w * width : w;
            const boxH = normalized ? h * height : h;
            const left = centerX - boxW / 2;
            const top = centerY - boxH / 2;
            detecciones.push({
                id: `obj${bestClass}`,
                x: left,
                y: top,
                w: boxW,
                h: boxH,
                confidence: score,
                multiplier: 1
            });
        }

        return applyNms(detecciones, 0.45);
    }

    function applyNms(detecciones, iouThreshold = 0.45) {
        const boxes = detecciones.map((item) => ({ x1: item.x, y1: item.y, x2: item.x + item.w, y2: item.y + item.h, score: item.confidence }));
        const sorted = detecciones
            .map((item, index) => ({ item, index }))
            .sort((a, b) => b.item.confidence - a.item.confidence);
        const keep = [];

        for (const current of sorted) {
            const candidato = current.item;
            let descartado = false;
            for (const guardado of keep) {
                if (computeIoU(candidato, guardado) > iouThreshold) {
                    descartado = true;
                    break;
                }
            }
            if (!descartado) {
                keep.push(candidato);
            }
        }

        return keep;
    }

    function computeIoU(a, b) {
        const x1 = Math.max(a.x, b.x);
        const y1 = Math.max(a.y, b.y);
        const x2 = Math.min(a.x + a.w, b.x + b.w);
        const y2 = Math.min(a.y + a.h, b.y + b.h);
        const interArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        const areaA = a.w * a.h;
        const areaB = b.w * b.h;
        return areaA && areaB ? interArea / (areaA + areaB - interArea) : 0;
    }

    function normalizarDeteccion(item) {
        return {
            id: String(item.class || item.label || "obj").replace(/\s+/g, "_").toLowerCase(),
            x: Number.isFinite(item.bbox?.[0]) ? item.bbox[0] : 0,
            y: Number.isFinite(item.bbox?.[1]) ? item.bbox[1] : 0,
            w: Number.isFinite(item.bbox?.[2]) ? item.bbox[2] : 0,
            h: Number.isFinite(item.bbox?.[3]) ? item.bbox[3] : 0,
            confidence: Number(item.score || item.confidence || 0),
            multiplier: 1
        };
    }

    async function prepareImageForInference(source) {
        if (source instanceof File) {
            return await prepareFileCanvas(source);
        }
        if (source instanceof HTMLImageElement) {
            return resizeCanvasFromImage(source, MAX_IMAGE_SIZE);
        }
        if (source instanceof HTMLCanvasElement || typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas) {
            return resizeCanvasFromCanvas(source, MAX_IMAGE_SIZE);
        }
        throw new Error("Tipo de entrada no compatible para la inferencia.");
    }

    async function prepareFileCanvas(file) {
        const temporaryUrl = URL.createObjectURL(file);
        try {
            const img = await loadImage(temporaryUrl);
            return resizeCanvasFromImage(img, MAX_IMAGE_SIZE);
        } finally {
            URL.revokeObjectURL(temporaryUrl);
        }
    }

    function resizeCanvasFromImage(img, maxDimension) {
        const ratio = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const width = Math.round(img.width * ratio);
        const height = Math.round(img.height * ratio);
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("No se pudo crear contexto de canvas.");
        ctx.drawImage(img, 0, 0, width, height);
        return canvas;
    }

    function resizeCanvasFromCanvas(sourceCanvas, maxDimension) {
        const width = sourceCanvas.width;
        const height = sourceCanvas.height;
        const ratio = Math.min(1, maxDimension / Math.max(width, height));
        if (ratio === 1) {
            return sourceCanvas;
        }
        const outputCanvas = createCanvas(Math.round(width * ratio), Math.round(height * ratio));
        const ctx = outputCanvas.getContext("2d");
        if (!ctx) throw new Error("No se pudo crear contexto de canvas.");
        if (sourceCanvas instanceof OffscreenCanvas) {
            const bitmap = sourceCanvas.transferToImageBitmap();
            ctx.drawImage(bitmap, 0, 0, outputCanvas.width, outputCanvas.height);
        } else {
            ctx.drawImage(sourceCanvas, 0, 0, outputCanvas.width, outputCanvas.height);
        }
        return outputCanvas;
    }

    function createCanvas(width, height) {
        if (typeof OffscreenCanvas !== "undefined") {
            return new OffscreenCanvas(width, height);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    async function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = (err) => reject(new Error("No se pudo cargar la imagen para inferencia."));
            img.src = src;
        });
    }

    function getTiles(canvas, tileSize = TILE_SIZE) {
        const tiles = [];
        const cols = Math.ceil(canvas.width / tileSize);
        const rows = Math.ceil(canvas.height / tileSize);

        for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
                const x = col * tileSize;
                const y = row * tileSize;
                const width = Math.min(tileSize, canvas.width - x);
                const height = Math.min(tileSize, canvas.height - y);
                const tileCanvas = createCanvas(width, height);
                const ctx = tileCanvas.getContext("2d");
                const sourceCtx = canvas.getContext("2d");
                if (!ctx || !sourceCtx) continue;
                const imageData = sourceCtx.getImageData(x, y, width, height);
                ctx.putImageData(imageData, 0, 0);
                tiles.push({ canvas: tileCanvas, x, y });
            }
        }
        return tiles;
    }

    return {
        isMobileDevice,
        isDesktopDevice,
        loadDetector,
        detectImage,
        prepareImageForInference,
        getTiles
    };
})();