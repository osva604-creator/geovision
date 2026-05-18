// =========================================================
// 1. VARIABLES GLOBALES Y MAPA
// =========================================================
let ultimasCoordsReales = null;
let modoMedicion = false;
let modoPoligono = false;
let modoMarcadoManual = false;
let puntosTemp = [];
let marcadoresTemp = [];
let historialMediciones = [];
let historialPoligonos = [];
let historialPuntos = [];
let historialFotos = [];
let historialObjetivos = [];
const urlsTemporalesFotos = new Set();
let capaOrientacionFoto = null;
let capaVisionCalculada = null;
let ultimaTelemetriaFoto = { zoom: 1, hfov: 73.74 };
let deferredInstallPrompt = null;
let estaHidratando = false;
let ultimoHtmlCoords = "<strong>Mi Ubicacion:</strong><br>Esperando señal GPS...";
let ultimoHtmlClimaLocal = "";

const WEATHER_API_KEY = window.WEATHER_API_KEY || "ee2057b73b750d1fae6127e3ce2d091d";
const STORAGE_KEY = "geovision_data";
const IDB_NAME = "geovision_db";
const IDB_VERSION = 1;
const IDB_STORE_FOTOS = "foto_previews";
const IDB_STORE_APP_STATE = "app_state";
const PITCH_GIMBAL_DEFAULT = 25;
const URL_GATEWAY_DJI_FARM = "https://gateway-dji-farm-498689304873.southamerica-east1.run.app";
const HEADER_MISSION_NAME = "X-Mission-Name";
const HEADER_MISSION_DATE = "X-Mission-Date";

const googleHybrid = L.tileLayer("https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
    maxZoom: 21,
    subdomains: ["mt0", "mt1", "mt2", "mt3"]
});

const map = L.map("map", {
    center: [-26.837, -65.203],
    zoom: 15,
    layers: [googleHybrid],
    doubleClickZoom: false
});

let idbPromise = null;

function getIdb() {
    if (!("indexedDB" in window)) return Promise.resolve(null);
    if (idbPromise) return idbPromise;

    idbPromise = new Promise((resolve) => {
        const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE_FOTOS)) {
                db.createObjectStore(IDB_STORE_FOTOS);
            }
            if (!db.objectStoreNames.contains(IDB_STORE_APP_STATE)) {
                db.createObjectStore(IDB_STORE_APP_STATE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
            console.warn("IndexedDB no disponible:", req.error);
            resolve(null);
        };
    });

    return idbPromise;
}

async function idbSetFotoPreview(id, previewDataUrl) {
    const db = await getIdb();
    if (!db) return false;
    return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE_FOTOS, "readwrite");
        tx.objectStore(IDB_STORE_FOTOS).put(previewDataUrl, String(id));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
    });
}

async function idbGetFotoPreview(id) {
    const db = await getIdb();
    if (!db) return null;
    return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE_FOTOS, "readonly");
        const req = tx.objectStore(IDB_STORE_FOTOS).get(String(id));
        req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
        req.onerror = () => resolve(null);
    });
}

async function idbDeleteFotoPreview(id) {
    const db = await getIdb();
    if (!db) return false;
    return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE_FOTOS, "readwrite");
        tx.objectStore(IDB_STORE_FOTOS).delete(String(id));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
    });
}

async function idbClearFotoPreviews() {
    const db = await getIdb();
    if (!db) return false;
    return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE_FOTOS, "readwrite");
        tx.objectStore(IDB_STORE_FOTOS).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
    });
}

async function idbSetAppState(data) {
    const db = await getIdb();
    if (!db) return false;
    return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE_APP_STATE, "readwrite");
        tx.objectStore(IDB_STORE_APP_STATE).put(data, STORAGE_KEY);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
    });
}

async function idbGetAppState() {
    const db = await getIdb();
    if (!db) return null;
    return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE_APP_STATE, "readonly");
        const req = tx.objectStore(IDB_STORE_APP_STATE).get(STORAGE_KEY);
        req.onsuccess = () => resolve(req.result && typeof req.result === "object" ? req.result : null);
        req.onerror = () => resolve(null);
    });
}

async function solicitarAlmacenamientoPersistente() {
    if (!navigator.storage || typeof navigator.storage.persisted !== "function" || typeof navigator.storage.persist !== "function") {
        return;
    }
    try {
        const yaPersistente = await navigator.storage.persisted();
        if (yaPersistente) return;
        const concedido = await navigator.storage.persist();
        console.log(concedido ? "Storage persistente habilitado." : "Storage persistente no concedido por el navegador.");
    } catch (error) {
        console.warn("No se pudo solicitar storage persistente:", error);
    }
}

function refrescarTamanoMapa() {
    map.invalidateSize();
}

const mapContainerEl = document.getElementById("map-container");
if (mapContainerEl && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => refrescarTamanoMapa());
    ro.observe(mapContainerEl);
}

requestAnimationFrame(() => {
    refrescarTamanoMapa();
    requestAnimationFrame(refrescarTamanoMapa);
});

const droneIcon = L.icon({
    iconUrl: "https://cdn-icons-png.flaticon.com/512/252/252025.png",
    iconSize: [45, 45],
    iconAnchor: [22, 22]
});

const iconoMira = L.icon({
    iconUrl: "https://cdn-icons-png.flaticon.com/512/252/252025.png",
    iconSize: [40, 40],
    iconAnchor: [20, 20]
});

const iconoVaca = L.divIcon({
    className: "vaca-marker",
    html: '<div style="font-size: 24px; line-height: 1;">🐄</div>',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
});
let modeloGanado = null;
let marcadoresGanado = [];
let ultimaFotoFile = null;
let currentPreviewDataUrl = null;
let laboratorioFotoURL = null;
let laboratorioStage = null;
let laboratorioLayer = null;
let laboratorioImageObj = null;
let konvaStage = null;
let konvaLayer = null;
let konvaImage = null;
let konvaDetections = [];
let selectedDetectionGroup = null;
let conteoTotal = 0;
let conteoCorreccionesManual = 0;

// =========================================================
// 2. FUNCIONES DE APOYO
// =========================================================
function decimalADMS(d, esLat) {
    const abs = Math.abs(d);
    const g = Math.floor(abs);
    const m = Math.floor((abs - g) * 60);
    const s = ((abs - g - m / 60) * 3600).toFixed(2);
    return `${g}° ${m}' ${s}" ${esLat ? (d >= 0 ? "N" : "S") : (d >= 0 ? "E" : "W")}`;
}

function normalizarGrados(grados) {
    return ((grados % 360) + 360) % 360;
}

function normalizarClave(tag) {
    return String(tag || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function escapeHtml(valor) {
    return String(valor ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttr(valor) {
    return escapeHtml(valor).replace(/`/g, "&#96;");
}

function extraerNumeros(valor) {
    if (typeof valor === "number" && Number.isFinite(valor)) return [valor];
    if (Array.isArray(valor)) return valor.flatMap((item) => extraerNumeros(item));
    if (valor && typeof valor === "object") {
        if (typeof valor.numerator === "number" && typeof valor.denominator === "number" && valor.denominator !== 0) {
            return [valor.numerator / valor.denominator];
        }
        if ("value" in valor) return extraerNumeros(valor.value);
        return [];
    }
    if (typeof valor !== "string") return [];
    const matches = valor.match(/-?\d+(?:[.,]\d+)?/g);
    if (!matches) return [];
    return matches
        .map((item) => Number.parseFloat(item.replace(",", ".")))
        .filter(Number.isFinite);
}

function recolectarCamposNumericosDetallados(origen) {
    const campos = {};
    const fuentes = {};
    if (!origen || typeof origen !== "object") return { campos, fuentes };

    const stack = [{ valor: origen, ruta: "" }];
    while (stack.length > 0) {
        const actual = stack.pop();
        if (!actual.valor || typeof actual.valor !== "object") continue;

        Object.entries(actual.valor).forEach(([k, v]) => {
            const key = normalizarClave(k);
            const ruta = actual.ruta ? `${actual.ruta}.${k}` : k;
            const numeros = extraerNumeros(v);
            if (numeros.length > 0 && !(key in campos)) {
                campos[key] = numeros[0];
                fuentes[key] = { ruta, numeros, raw: v };
            }
            if (v && typeof v === "object") {
                stack.push({ valor: v, ruta });
            }
        });
    }

    return { campos, fuentes };
}

function resumirValorDebug(valor) {
    if (valor === null || typeof valor === "undefined") return String(valor);
    if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
    if (typeof valor === "string") return valor.length > 120 ? `${valor.slice(0, 117)}...` : valor;
    try {
        const json = JSON.stringify(valor);
        return json.length > 120 ? `${json.slice(0, 117)}...` : json;
    } catch (_error) {
        return Object.prototype.toString.call(valor);
    }
}

function recolectarCamposDebug(origen, patrones) {
    const encontrados = [];
    if (!origen || typeof origen !== "object") return encontrados;

    const stack = [{ valor: origen, ruta: "" }];
    while (stack.length > 0) {
        const actual = stack.pop();
        if (!actual.valor || typeof actual.valor !== "object") continue;

        Object.entries(actual.valor).forEach(([k, v]) => {
            const ruta = actual.ruta ? `${actual.ruta}.${k}` : k;
            const key = normalizarClave(ruta);
            if (patrones.some((patron) => key.includes(patron))) {
                encontrados.push(`${ruta}: ${resumirValorDebug(v)}`);
            }
            if (v && typeof v === "object") {
                stack.push({ valor: v, ruta });
            }
        });
    }

    return encontrados.slice(0, 60);
}

function resolverCandidatoTelemetria(campos, fuentes, candidatos, opciones = {}) {
    const claves = Object.keys(campos);
    const rechazos = [];

    for (const candidato of candidatos) {
        const config = typeof candidato === "string" ? { nombre: candidato } : candidato;
        const key = normalizarClave(config.nombre);
        let encontrada = null;
        if (key in campos) {
            encontrada = key;
        } else {
            encontrada = claves.find((k) => k.endsWith(key) || k.includes(key));
        }

        if (!encontrada) continue;
        const fuente = fuentes[encontrada] || {};
        const numeros = Array.isArray(fuente.numeros) ? fuente.numeros : [campos[encontrada]];
        const indice = typeof config.indice === "number" ? config.indice : 0;
        const valor = numeros[indice];

        if (Number.isFinite(valor)) {
            return {
                valor,
                fuente: fuente.ruta || encontrada,
                candidato: config.nombre,
                numeros,
                rechazos
            };
        } else if (valor !== null && valor !== undefined) {
            rechazos.push(`${config.nombre}: no es número (${valor})`);
        }
    }

    return { valor: null, fuente: null, candidato: null, numeros: [], rechazos };
}

function validarTelemetria(telemetria) {
    const validaciones = { errores: [], advertencias: [] };

    if (telemetria.pitch !== null) {
        if (telemetria.pitch < -90 || telemetria.pitch > 90) {
            validaciones.errores.push(`pitch=${telemetria.pitch}° fuera de rango [-90, 90]`);
            telemetria.pitch = null;
        }
    }

    if (telemetria.yaw !== null) {
        if (telemetria.yaw < 0 || telemetria.yaw > 360) {
            if (telemetria.yaw < -360 || telemetria.yaw > 720) {
                validaciones.errores.push(`yaw=${telemetria.yaw}° fuera de rango [-360, 720]`);
                telemetria.yaw = null;
            } else {
                telemetria.yaw = telemetria.yaw % 360;
                if (telemetria.yaw < 0) telemetria.yaw += 360;
            }
        }
    }

    if (telemetria.alt !== null) {
        if (telemetria.alt < 0) {
            validaciones.errores.push(`altitud=${telemetria.alt}m negativa`);
            telemetria.alt = null;
        } else if (telemetria.alt > 10000) {
            validaciones.advertencias.push(`altitud=${telemetria.alt}m parece inusualmente alta`);
        }
    }

    if (telemetria.zoom !== null && telemetria.zoom < 1) {
        validaciones.errores.push(`zoom=${telemetria.zoom} < 1`);
        telemetria.zoom = 1;
    }

    return validaciones;
}

function extraerTelemetria(data) {
    const { campos, fuentes } = recolectarCamposNumericosDetallados(data);
    const zoomDetectado = resolverCandidatoTelemetria(campos, fuentes, [
        "DigitalZoomRatio", "ZoomRatio", "Zoom", "drone-dji:DigitalZoomRatio"
    ]);
    const pitchDetectado = resolverCandidatoTelemetria(campos, fuentes, [
        "GimbalPitchDegree", "drone-dji:GimbalPitchDegree", "CameraGimbalPitchDegree",
        "CameraPitchDegree", "CameraPitch", "GimbalPitch", "GimbalPitchAngle",
        { nombre: "GimbalDegree", indice: 1 },
        { nombre: "GimbalRollPitchYaw", indice: 1 },
        { nombre: "GimbalRollPitchYawDegree", indice: 1 },
        { nombre: "CameraGimbalRollPitchYaw", indice: 1 },
        { nombre: "CameraGimbalRollPitchYawDegree", indice: 1 },
        { nombre: "GimbalRPY", indice: 1 },
        "FlightPitchDegree",
        "Pitch"
    ]);
    const yawDetectado = resolverCandidatoTelemetria(campos, fuentes, [
        "FlightYawDegree", "drone-dji:FlightYawDegree", "DroneYawDegree", "GPSImgDirection", "Heading",
        "GimbalYawDegree", "drone-dji:GimbalYawDegree", "CameraGimbalYawDegree",
        "CameraYawDegree", "CameraYaw", "GimbalYaw", "GimbalYawAngle",
        { nombre: "GimbalRollPitchYaw", indice: 2 },
        { nombre: "GimbalRollPitchYawDegree", indice: 2 },
        { nombre: "GimbalRPY", indice: 2 },
        "Yaw"
    ]);
    const altDetectada = resolverCandidatoTelemetria(campos, fuentes, [
        "RelativeAltitude", "AbsoluteAltitude", "GPSAltitude", "Altitude", "DroneAltitude",
        "drone-dji:RelativeAltitude", "drone-dji:AbsoluteAltitude"
    ]);

    const zoomRaw = zoomDetectado.valor;
    const zoom = Number.isFinite(zoomRaw) && zoomRaw > 0 ? zoomRaw : 1;
    const focalEquiv = 24 / zoom;
    const hfov = 2 * Math.atan(18 / focalEquiv) * (180 / Math.PI);

    const resultado = {
        pitch: pitchDetectado.valor,
        yaw: yawDetectado.valor,
        alt: altDetectada.valor,
        zoom,
        hfov,
        fuentes: {
            pitch: pitchDetectado.fuente,
            yaw: yawDetectado.fuente,
            alt: altDetectada.fuente,
            zoom: zoomDetectado.fuente
        },
        candidatos: {
            pitch: pitchDetectado.candidato,
            yaw: yawDetectado.candidato,
            alt: altDetectada.candidato,
            zoom: zoomDetectado.candidato
        },
        rechazosResolucion: {
            pitch: pitchDetectado.rechazos || [],
            yaw: yawDetectado.rechazos || [],
            alt: altDetectada.rechazos || [],
            zoom: zoomDetectado.rechazos || []
        }
    };

    // Aplicar validación de rangos
    const validaciones = validarTelemetria(resultado);
    resultado.validaciones = validaciones;

    // Si pitch sigue siendo null después de extracción y validación, usar default
    if (resultado.pitch === null) {
        resultado.pitch = PITCH_GIMBAL_DEFAULT;
        resultado.fuentes.pitch = `valor por defecto (${PITCH_GIMBAL_DEFAULT}°)`;
        resultado.candidatos.pitch = "defaultPitch";
    }

    return resultado;
}

function formatearCoords(lat, lon) {
    return `${decimalADMS(lat, true)} | ${decimalADMS(lon, false)}`;
}

function crearIconoFlecha(grados, color = "#f59e0b", size = 24) {
    const anguloCss = normalizarGrados(grados - 90);
    return L.divIcon({
        className: "icono-flecha-direccion",
        html: `<div style="font-size:${size}px; line-height:1; color:${color}; transform: rotate(${anguloCss}deg); text-shadow: 0 1px 2px rgba(0,0,0,0.8);">➤</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
    });
}

function limpiarCapaOrientacionFoto() {
    if (!capaOrientacionFoto) return;
    map.removeLayer(capaOrientacionFoto);
    capaOrientacionFoto = null;
}

function limpiarVisionCalculada() {
    if (!capaVisionCalculada) return;
    map.removeLayer(capaVisionCalculada);
    capaVisionCalculada = null;
}

function obtenerLatLngPlano(valor) {
    if (Array.isArray(valor)) return { lat: Number(valor[0]), lng: Number(valor[1]) };
    return { lat: Number(valor.lat), lng: Number(valor.lng ?? valor.lon) };
}

function puntoMedioLatLng(a, b) {
    const puntoA = obtenerLatLngPlano(a);
    const puntoB = obtenerLatLngPlano(b);
    return [(puntoA.lat + puntoB.lat) / 2, (puntoA.lng + puntoB.lng) / 2];
}

function agregarPuntosMediosSiCuadrilatero(coords) {
    if (!Array.isArray(coords) || coords.length !== 4) return coords;
    const densificados = [];
    coords.forEach((actual, index) => {
        const siguiente = coords[(index + 1) % coords.length];
        densificados.push(actual);
        densificados.push(puntoMedioLatLng(actual, siguiente));
    });
    return densificados;
}

function formatearDistancia(distancia) {
    return distancia > 1000 ? `${(distancia / 1000).toFixed(2)}km` : `${distancia.toFixed(1)}m`;
}

function actualizarTooltipsVerticesPoligono(vertices) {
    if (!Array.isArray(vertices) || vertices.length < 2) return;
    vertices.forEach((marker, index) => {
        const actual = marker.getLatLng();
        const siguiente = vertices[(index + 1) % vertices.length].getLatLng();
        const distancia = map.distance(actual, siguiente);
        marker.bindTooltip(`Siguiente: ${formatearDistancia(distancia)}`, {
            direction: "top",
            className: "etiqueta-medicion"
        });
    });
}

function crearPoligonoEditable(coords, nombre, opciones = {}) {
    if (!Array.isArray(coords) || coords.length < 3) return null;
    const id = opciones.id || Date.now();
    const coordsEditables = agregarPuntosMediosSiCuadrilatero(coords);
    const poli = L.polygon(coordsEditables, {
        color: opciones.color || "#2ecc71",
        weight: typeof opciones.weight === "number" ? opciones.weight : 2,
        fillColor: opciones.fillColor || opciones.color || "#2ecc71",
        fillOpacity: typeof opciones.fillOpacity === "number" ? opciones.fillOpacity : 0.3
    }).addTo(map);

    const vertices = [];
    coordsEditables.forEach((ll, index) => {
        const esPuntoMedio = coords.length === 4 && index % 2 === 1;
        const className = esPuntoMedio ? "vertice-poligono vertice-poligono-medio" : "vertice-poligono";
        const v = L.marker(ll, { draggable: true, icon: L.divIcon({ className, iconSize: [10, 10] }) }).addTo(map);
        v.on("drag", () => {
            poli.setLatLngs(vertices.map((marker) => marker.getLatLng()));
            actualizarTooltipsVerticesPoligono(vertices);
            actualizarInfoPoligono(id);
            guardarEnLocal();
        });
        vertices.push(v);
    });

    const registro = {
        id,
        objeto: poli,
        marcadores: vertices,
        nombre: nombre || `Area ${historialPoligonos.length + 1}`,
        areaTxt: "",
        seleccionado: opciones.seleccionado !== false,
        esAutomatico: opciones.esAutomatico === true
    };
    historialPoligonos.push(registro);
    actualizarTooltipsVerticesPoligono(vertices);
    actualizarInfoPoligono(id);
    setVisibilidadPoligono(registro, registro.seleccionado !== false);
    if (opciones.guardar !== false) guardarEnLocal();
    return registro;
}

function mostrarOrientacionFoto(lat, lon, yaw) {
    limpiarCapaOrientacionFoto();
    if (!Number.isFinite(yaw)) return;
    const rumbo = normalizarGrados(yaw);
    const frente = proyectar(lat, lon, 120, rumbo);
    const linea = L.polyline(
        [
            [lat, lon],
            [frente.lat, frente.lon]
        ],
        { color: "#f59e0b", weight: 3, opacity: 0.95 }
    ).bindTooltip(`Rumbo foto: ${rumbo.toFixed(0)}°`, { direction: "top" });
    const flecha = L.marker([frente.lat, frente.lon], { icon: crearIconoFlecha(rumbo, "#f59e0b", 22) });
    capaOrientacionFoto = L.layerGroup([linea, flecha]).addTo(map);
    map.flyToBounds(
        [
            [lat, lon],
            [frente.lat, frente.lon]
        ],
        { padding: [70, 70], maxZoom: 19 }
    );
}

function bindInstalacionApp() {
    const toast = document.getElementById("install-toast");
    const btn = document.getElementById("btn-install-toast");
    if (!toast || !btn) return;

    function mostrarToast(ms = 2000) {
        toast.classList.add("show");
        window.setTimeout(() => toast.classList.remove("show"), ms);
    }

    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
        mostrarToast(2000);
    });

    window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        toast.classList.remove("show");
    });

    btn.onclick = async () => {
        if (!deferredInstallPrompt) {
            toast.classList.remove("show");
            return;
        }
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        toast.classList.remove("show");
    };
}

function addCompassControl() {
    const CompassControl = L.Control.extend({
        options: { position: "topright" },
        onAdd() {
            const container = L.DomUtil.create("div", "leaflet-bar gv-compass");
            container.innerHTML = "<span>N</span>";
            L.DomEvent.disableClickPropagation(container);
            return container;
        }
    });
    map.addControl(new CompassControl());
}

function mostrarLineaVision(origen, destino, rumbo) {
    limpiarVisionCalculada();
    const distancia = map.distance([origen.lat, origen.lon], [destino.lat, destino.lon]);
    const puntoFlecha = proyectar(origen.lat, origen.lon, distancia * 0.72, rumbo);

    const linea = L.polyline(
        [
            [origen.lat, origen.lon],
            [destino.lat, destino.lon]
        ],
        { color: "#db4a34", weight: 4, dashArray: "5,10", opacity: 1 }
    );
    const flecha = L.marker([puntoFlecha.lat, puntoFlecha.lon], { icon: crearIconoFlecha(rumbo, "#db4a34", 24) })
        .bindTooltip("Direccion de vision", { direction: "top" });

    capaVisionCalculada = L.layerGroup([linea, flecha]).addTo(map);
}

function generarTextoTooltipFoto(foto) {
    return `<b>${escapeHtml(foto.nombre)}</b><br>${formatearCoords(foto.lat, foto.lon)}`;
}

function generarMiniaturaDataURL(file, maxLado = 320, calidad = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
                const ancho = Math.max(1, Math.round(img.width * escala));
                const alto = Math.max(1, Math.round(img.height * escala));
                const canvas = document.createElement("canvas");
                canvas.width = ancho;
                canvas.height = alto;
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    reject(new Error("No se pudo crear contexto de imagen."));
                    return;
                }
                ctx.drawImage(img, 0, 0, ancho, alto);
                resolve(canvas.toDataURL("image/jpeg", calidad));
            };
            img.onerror = () => reject(new Error("No se pudo leer la imagen para miniatura."));
            img.src = String(reader.result || "");
        };
        reader.onerror = () => reject(new Error("No se pudo cargar el archivo."));
        reader.readAsDataURL(file);
    });
}

function construirPopupFotoHtml(foto, fotoURL) {
    const imagenPopup = fotoURL || foto.fotoPreviewURL || null;
    const nombreSeguro = escapeHtml(foto.nombre);
    const imagenSegura = imagenPopup ? escapeAttr(imagenPopup) : null;
    return imagenPopup
        ? `<div style="text-align:center; min-width: 300px;">
                <h3 style="margin: 0 0 10px 0; color: #3498db; font-size: 16px;">Captura de Vuelo</h3>
                <a href="${imagenSegura}" target="_blank" rel="noopener">
                    <img src="${imagenSegura}" alt="${nombreSeguro}" style="width: 100%; height: auto; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); cursor: zoom-in;">
                </a>
                <p style="font-size: 11px; color: #bdc3c7; margin-top: 8px;">Pulsa para ver imagen completa</p>
            </div>`
        : `<div style="text-align:center; min-width: 300px;">
                <h3 style="margin: 0 0 10px 0; color: #3498db; font-size: 16px;">Captura de Vuelo</h3>
                <div style="width:100%; min-height:170px; border-radius:10px; border:1px dashed #4b5563; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; background:#1f2937; color:#9ca3af;">
                    <div style="font-size:30px; line-height:1;">🖼️</div>
                    <div style="font-size:12px; padding:0 12px;">Foto sin miniatura guardada.</div>
                </div>
                <p style="font-size: 12px; color: #ecf0f1; margin:10px 0 0 0;">
                    ${nombreSeguro}<br>${formatearCoords(foto.lat, foto.lon)}
                </p>
            </div>`;
}

function seleccionarFotoParaCalculo(foto, enfocarMapa = true) {
    if (!foto) return;
    ultimasCoordsReales = { lat: foto.lat, lon: foto.lon };
    ultimaTelemetriaFoto = {
        zoom: Number.isFinite(foto.zoom) && foto.zoom > 0 ? foto.zoom : 1,
        hfov: Number.isFinite(foto.hfov) && foto.hfov > 0 ? foto.hfov : 73.74
    };
    if (typeof foto.pitch === "number") document.getElementById("gimbal-pitch").value = Math.abs(foto.pitch).toFixed(1);
    if (typeof foto.yaw === "number") document.getElementById("drone-heading").value = normalizarGrados(foto.yaw).toFixed(0);
    if (typeof foto.alt === "number") document.getElementById("manual-alt").value = Math.abs(foto.alt).toFixed(0);

    if (typeof foto.yaw === "number") {
        mostrarOrientacionFoto(foto.lat, foto.lon, foto.yaw);
    } else {
        if (enfocarMapa) map.flyTo([foto.lat, foto.lon], 19);
    }

    document.getElementById("resultado-mira").innerHTML = `Foto seleccionada: <strong>${escapeHtml(foto.nombre)}</strong>`;
    if (foto.marcador) foto.marcador.openPopup();
}

function calcularPoligonoMaleza(datos) {
    const { origenLat, origenLng, altitud, hfov, yaw, distanciaAlSuelo, anchoManual, modoCalculo } = datos;
    if (![origenLat, origenLng, altitud, hfov, yaw, distanciaAlSuelo].every(Number.isFinite)) return null;
    if (altitud <= 0 || hfov <= 0 || distanciaAlSuelo < 0) return null;

    const centroObjetivo = proyectar(origenLat, origenLng, distanciaAlSuelo, normalizarGrados(yaw));
    const anchoZoom = 2 * Math.sqrt((altitud ** 2) + (distanciaAlSuelo ** 2)) * Math.tan((hfov * Math.PI / 180) / 2);
    const anchoSuelo = modoCalculo === "zoom"
        ? Math.max(1, anchoZoom)
        : (Number.isFinite(anchoManual) && anchoManual > 0 ? anchoManual : 100);

    const mitadLado = anchoSuelo / 2;
    const distanciaEsquina = Math.sqrt((mitadLado ** 2) * 2);
    const rumbosEsquinas = [45, 135, 225, 315].map((offset) => normalizarGrados(yaw + offset));
    const vertices = rumbosEsquinas.map((rumbo) => proyectar(centroObjetivo.lat, centroObjetivo.lon, distanciaEsquina, rumbo));

    const totalAutomaticos = historialPoligonos.filter((p) => p.esAutomatico === true).length;
    const nombrePoligono = `Maleza Auto ${totalAutomaticos + 1}`;
    const poligono = crearPoligonoEditable(
        vertices.map((v) => [v.lat, v.lon]),
        nombrePoligono,
        { color: "#2ecc71", weight: 2, fillColor: "#2ecc71", fillOpacity: 0.18, guardar: false, seleccionado: true, esAutomatico: true }
    );
    if (!poligono) return null;
    const etiquetaModo = modoCalculo === "zoom" ? "zoom/HFOV" : "baldosa fija";
    poligono.objeto.bindTooltip(`Cobertura maleza: ${anchoSuelo.toFixed(1)} x ${anchoSuelo.toFixed(1)} m (${etiquetaModo}, editable)`, { direction: "top" });
    guardarEnLocal();

    console.log(`Generando cuadrado de ${anchoSuelo.toFixed(1)}x${anchoSuelo.toFixed(1)}m para maleza (${etiquetaModo}).`);
    return { centroObjetivo, anchoSuelo, modoCalculo: etiquetaModo };
}

function crearObjetivoHistorial(datos, opciones = {}) {
    if (!datos || !datos.obj || !datos.origen) return null;
    const id = opciones.id || Date.now();
    const destino = { lat: datos.obj.lat, lon: datos.obj.lon };
    const origen = { lat: datos.origen.lat, lon: datos.origen.lon };
    const distancia = Number.isFinite(datos.distH) ? datos.distH : map.distance([origen.lat, origen.lon], [destino.lat, destino.lon]);
    const rumbo = Number.isFinite(datos.rumbo) ? normalizarGrados(datos.rumbo) : 0;
    const nombre = opciones.nombre || `Objetivo ${historialObjetivos.length + 1}`;
    const puntoFlecha = proyectar(origen.lat, origen.lon, distancia * 0.72, rumbo);

    const marcador = L.marker([destino.lat, destino.lon], { icon: iconoMira })
        .bindPopup(
            `<div style="text-align:center;">
                <strong style="color:#2980b9;">${escapeHtml(nombre)}</strong><br>
                <small>${decimalADMS(destino.lat, true)}<br>${decimalADMS(destino.lon, false)}</small><br>
                <hr style="margin:5px 0;">
                <span>Distancia: <strong>${distancia.toFixed(1)} m</strong></span>
            </div>`
        );
    const linea = L.polyline(
        [
            [origen.lat, origen.lon],
            [destino.lat, destino.lon]
        ],
        { color: "#db4a34", weight: 4, dashArray: "5,10", opacity: 1 }
    );
    const flecha = L.marker([puntoFlecha.lat, puntoFlecha.lon], { icon: crearIconoFlecha(rumbo, "#db4a34", 24) })
        .bindTooltip("Direccion de vision", { direction: "top" });
    const grupo = L.layerGroup([linea, flecha, marcador]);

    const registro = {
        id,
        nombre,
        origen,
        destino,
        rumbo,
        distancia,
        objeto: grupo,
        marcador,
        seleccionado: opciones.seleccionado !== false
    };
    historialObjetivos.unshift(registro);
    setVisibilidadObjetivo(registro, registro.seleccionado !== false);
    actualizarListaObjetivos();
    if (opciones.guardar !== false) guardarEnLocal();
    if (opciones.abrirPopup !== false) marcador.openPopup();
    return registro;
}

function setVisibilidadObjetivo(objetivo, visible) {
    if (!objetivo || !objetivo.objeto) return;
    const objetivoVisible = visible !== false;
    objetivo.seleccionado = objetivoVisible;
    if (objetivoVisible) {
        if (!map.hasLayer(objetivo.objeto)) objetivo.objeto.addTo(map);
    } else if (map.hasLayer(objetivo.objeto)) {
        map.removeLayer(objetivo.objeto);
    }
}

function actualizarListaObjetivos() {
    const ui = document.getElementById("lista-objetivos");
    if (!ui) return;
    ui.innerHTML = "";
    historialObjetivos.forEach((objetivo) => {
        const li = document.createElement("li");
        li.style = "border-bottom:1px solid #444; padding:5px; display:flex; justify-content:space-between; align-items:center;";
        const cont = document.createElement("div");
        cont.style.cssText = "display:flex; flex-direction:column; min-width:0;";
        const filaTitulo = document.createElement("div");
        filaTitulo.style.cssText = "display:flex; align-items:center; gap:6px;";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = objetivo.seleccionado !== false;
        check.title = "Mostrar/Ocultar";
        check.addEventListener("change", () => {
            setVisibilidadObjetivo(objetivo, check.checked);
            guardarEnLocal();
        });
        const input = document.createElement("input");
        input.type = "text";
        input.value = objetivo.nombre;
        input.style.cssText = "background:none; border:1px solid #555; color:#f1c40f; width:105px; font-size:0.8em;";
        input.addEventListener("change", () => window.cambiarNombreObjetivo(objetivo.id, input.value));
        input.addEventListener("dblclick", () => {
            if (objetivo.seleccionado === false) setVisibilidadObjetivo(objetivo, true);
            map.flyTo([objetivo.destino.lat, objetivo.destino.lon], 19);
            objetivo.marcador.openPopup();
        });
        const meta = document.createElement("small");
        meta.style.color = "#aaa";
        meta.innerText = formatearDistancia(objetivo.distancia);
        filaTitulo.appendChild(check);
        filaTitulo.appendChild(input);
        cont.appendChild(filaTitulo);
        cont.appendChild(meta);

        const boton = document.createElement("button");
        boton.type = "button";
        boton.innerText = "🗑️";
        boton.style.cssText = "background:none; color:red; border:none; cursor:pointer;";
        boton.addEventListener("click", () => window.borrarObjetivo(objetivo.id));

        li.appendChild(cont);
        li.appendChild(boton);
        ui.appendChild(li);
    });
}

function crearMarcadorFoto(foto, fotoURL) {
    const marker = L.marker([foto.lat, foto.lon], { icon: droneIcon }).addTo(map);
    marker.bindTooltip(generarTextoTooltipFoto(foto), {
        direction: "top",
        className: "etiqueta-punto"
    });

    marker.bindPopup(construirPopupFotoHtml(foto, fotoURL), { maxWidth: 360, className: "popup-drone-grande" });
    return marker;
}

function refrescarPopupFoto(foto) {
    if (!foto || !foto.marcador) return;
    foto.marcador.setPopupContent(construirPopupFotoHtml(foto, foto.fotoURL || null));
}

function borrarFotoPorId(id) {
    const index = historialFotos.findIndex((f) => f.id === id);
    if (index === -1) return;
    const foto = historialFotos[index];
    if (foto.marcador) map.removeLayer(foto.marcador);
    if (foto.fotoURL && urlsTemporalesFotos.has(foto.fotoURL)) {
        URL.revokeObjectURL(foto.fotoURL);
        urlsTemporalesFotos.delete(foto.fotoURL);
    }
    idbDeleteFotoPreview(id);
    historialFotos.splice(index, 1);
    if (historialFotos.length > 0) {
        ultimasCoordsReales = { lat: historialFotos[0].lat, lon: historialFotos[0].lon };
    } else {
        ultimasCoordsReales = null;
        limpiarCapaOrientacionFoto();
    }
    actualizarListaFotos();
    guardarEnLocal();
}

function actualizarListaFotos() {
    const ui = document.getElementById("lista-fotos");
    if (!ui) return;
    ui.innerHTML = "";

    historialFotos.forEach((foto) => {
        const li = document.createElement("li");
        li.style.cssText = "border-bottom:1px solid #444; padding:6px 4px; color:#ecf0f1; font-size:0.8em; cursor:pointer;";
        li.title = formatearCoords(foto.lat, foto.lon);

        const nombre = document.createElement("div");
        nombre.style.cssText = "color:#f1c40f; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;";
        nombre.innerText = foto.nombre;

        const meta = document.createElement("small");
        meta.style.cssText = "display:block; color:#95a5a6;";
        meta.innerText = `Lat ${foto.lat.toFixed(6)} | Lon ${foto.lon.toFixed(6)}`;

        li.addEventListener("mouseenter", () => {
            if (foto.marcador) foto.marcador.openTooltip();
        });
        li.addEventListener("mouseleave", () => {
            if (foto.marcador) foto.marcador.closeTooltip();
        });
        li.addEventListener("click", () => {
            if (!foto.marcador) return;
            seleccionarFotoParaCalculo(foto, true);
        });

        const acciones = document.createElement("div");
        acciones.style.cssText = "display:flex; justify-content:space-between; gap:8px; align-items:center; margin-top:4px;";

        const btnBorrar = document.createElement("button");
        btnBorrar.type = "button";
        btnBorrar.innerText = "🗑️ Borrar";
        btnBorrar.style.cssText = "width:auto; margin:0; padding:3px 8px; font-size:0.72em; background:#7f1d1d; border-radius:6px;";
        btnBorrar.addEventListener("click", (ev) => {
            ev.stopPropagation();
            borrarFotoPorId(foto.id);
        });

        const btnUsar = document.createElement("button");
        btnUsar.type = "button";
        btnUsar.innerText = "🎯 Usar";
        btnUsar.style.cssText = "width:auto; margin:0; padding:3px 8px; font-size:0.72em; background:#1d4ed8; border-radius:6px;";
        btnUsar.addEventListener("click", (ev) => {
            ev.stopPropagation();
            seleccionarFotoParaCalculo(foto, true);
        });

        const accionesBotones = document.createElement("div");
        accionesBotones.style.cssText = "display:flex; gap:6px;";
        accionesBotones.appendChild(btnUsar);
        accionesBotones.appendChild(btnBorrar);

        acciones.appendChild(meta);
        acciones.appendChild(accionesBotones);

        li.appendChild(nombre);
        li.appendChild(acciones);
        ui.appendChild(li);
    });
}

function agregarFotoHistorial(fotoData, fotoURL) {
    const marker = crearMarcadorFoto(fotoData, fotoURL);
    const foto = {
        ...fotoData,
        fotoURL: fotoURL || null,
        marcador: marker
    };
    marker.on("click", () => seleccionarFotoParaCalculo(foto, false));
    historialFotos.unshift(foto);
    actualizarListaFotos();
    guardarEnLocal();
    return foto;
}

function limpiarFotos() {
    historialFotos.forEach((foto) => {
        if (foto.marcador) map.removeLayer(foto.marcador);
    });
    historialFotos = [];
    ultimasCoordsReales = null;
    limpiarCapaOrientacionFoto();
    urlsTemporalesFotos.forEach((url) => URL.revokeObjectURL(url));
    urlsTemporalesFotos.clear();
    idbClearFotoPreviews();
    actualizarListaFotos();
}

function actualizarDebugExif(data, telemetria, faltantes) {
    const ui = document.getElementById("debug-exif-contenido");
    if (!ui) return;

    const { campos } = recolectarCamposNumericosDetallados(data);
    const claves = Object.keys(campos).sort().slice(0, 30);
    const candidatosDebug = recolectarCamposDebug(data, ["gimbal", "pitch", "yaw", "camera", "flight", "drone"]);

    const lineas = [
        "═══ TELEMETRIA EXTRAIDA ═══",
        `pitch: ${telemetria.pitch !== null ? telemetria.pitch.toFixed(2) : "N/A"}°`,
        `  fuente: ${telemetria.fuentes && telemetria.fuentes.pitch ? telemetria.fuentes.pitch : "N/A"}`,
        `  candidato: ${telemetria.candidatos && telemetria.candidatos.pitch ? telemetria.candidatos.pitch : "N/A"}`,
        `heading: ${telemetria.yaw !== null ? telemetria.yaw.toFixed(2) : "N/A"}°`,
        `  fuente: ${telemetria.fuentes && telemetria.fuentes.yaw ? telemetria.fuentes.yaw : "N/A"}`,
        `  candidato: ${telemetria.candidatos && telemetria.candidatos.yaw ? telemetria.candidatos.yaw : "N/A"}`,
        `altitud: ${telemetria.alt !== null ? telemetria.alt.toFixed(1) : "N/A"}m`,
        `  fuente: ${telemetria.fuentes && telemetria.fuentes.alt ? telemetria.fuentes.alt : "N/A"}`,
        `  candidato: ${telemetria.candidatos && telemetria.candidatos.alt ? telemetria.candidatos.alt : "N/A"}`,
    ];

    // Mostrar rechazos si existen
    if (telemetria.rechazosResolucion) {
        const hayRechazos = Object.values(telemetria.rechazosResolucion).some(r => r && r.length > 0);
        if (hayRechazos) {
            lineas.push("", "═══ VALORES RECHAZADOS ═══");
            if (telemetria.rechazosResolucion.pitch && telemetria.rechazosResolucion.pitch.length) {
                lineas.push(`pitch: ${telemetria.rechazosResolucion.pitch.join("; ")}`);
            }
            if (telemetria.rechazosResolucion.yaw && telemetria.rechazosResolucion.yaw.length) {
                lineas.push(`heading: ${telemetria.rechazosResolucion.yaw.join("; ")}`);
            }
            if (telemetria.rechazosResolucion.alt && telemetria.rechazosResolucion.alt.length) {
                lineas.push(`altitud: ${telemetria.rechazosResolucion.alt.join("; ")}`);
            }
            if (telemetria.rechazosResolucion.zoom && telemetria.rechazosResolucion.zoom.length) {
                lineas.push(`zoom: ${telemetria.rechazosResolucion.zoom.join("; ")}`);
            }
        }
    }

    // Mostrar validaciones si fallaron
    if (telemetria.validaciones) {
        if (telemetria.validaciones.errores && telemetria.validaciones.errores.length) {
            lineas.push("", "═══ VALIDACION - ERRORES ═══");
            telemetria.validaciones.errores.forEach(e => lineas.push(`✗ ${e}`));
        }
        if (telemetria.validaciones.advertencias && telemetria.validaciones.advertencias.length) {
            lineas.push("", "═══ VALIDACION - ADVERTENCIAS ═══");
            telemetria.validaciones.advertencias.forEach(a => lineas.push(`⚠ ${a}`));
        }
    }

    lineas.push(
        "",
        "═══ CANDIDATOS DETECTADOS ═══",
        ...(candidatosDebug.length ? candidatosDebug.map((item) => `- ${item}`) : ["- ninguno"]),
        "",
        "═══ CAMPOS NUMERICOS (primeros 30) ═══",
        ...claves.map((k) => `- ${k}: ${campos[k]}`)
    );

    ui.textContent = lineas.join("\n");
}

function proyectar(lat, lon, dist, rumbo) {
    const R = 6371000;
    const r = (rumbo * Math.PI) / 180;
    const la = (lat * Math.PI) / 180;
    const lo = (lon * Math.PI) / 180;
    const d = dist / R;
    const nLa = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(r));
    const nLo = lo + Math.atan2(Math.sin(r) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(nLa));
    return { lat: (nLa * 180) / Math.PI, lon: (nLo * 180) / Math.PI };
}

function actualizarEstadoImportacion(tipo, detalle) {
    const estadoDiv = document.getElementById("estado-importacion");
    if (!estadoDiv) return;

    const estilos = {
        waiting: { bg: "#2c3e50", fg: "#ecf0f1", label: "Procesando..." },
        error: { bg: "#5c1f1f", fg: "#f8d7da", label: "Error" },
        ok: { bg: "#1f5d3a", fg: "#d4f5e2", label: "OK" }
    };
    const estilo = estilos[tipo] || estilos.waiting;

    estadoDiv.style.background = estilo.bg;
    estadoDiv.style.color = estilo.fg;
    estadoDiv.innerHTML = `Estado: <strong>${escapeHtml(estilo.label)}</strong>${detalle ? `<br><small>${escapeHtml(detalle)}</small>` : ""}`;
}

function limpiarMarcadoresTemporales() {
    marcadoresTemp.forEach((m) => map.removeLayer(m));
    marcadoresTemp = [];
}

// =========================================================
// 3. TELEMETRIA, CLIMA Y PROYECCION
// =========================================================
function bindFotoDrone() {
    const inputDrone = document.getElementById("input-drone");
    const btnSubir = document.getElementById("btn-subir-foto");
    const btnClimaVuelo = document.getElementById("btn-clima");

    if (!btnSubir || !inputDrone) return;
    btnSubir.onclick = () => inputDrone.click();

    inputDrone.onchange = async function onChange() {
        const file = this.files[0];
        if (!file) return;

        actualizarEstadoImportacion("waiting", `Analizando ${file.name}...`);

        try {
            const data = await exifr.parse(file, {
                gps: true,
                xmp: true,
                exif: true,
                tiff: true,
                ifd0: true,
                multiSegment: true
            });
            const telemetria = extraerTelemetria(data);
            const faltantes = [];
            if (telemetria.pitch === null) faltantes.push("pitch");
            if (telemetria.yaw === null) faltantes.push("heading");
            if (telemetria.alt === null) faltantes.push("altitud");
            actualizarDebugExif(data, telemetria, faltantes);

            if (!data || typeof data.latitude !== "number" || typeof data.longitude !== "number") {
                throw new Error("La foto no tiene coordenadas GPS.");
            }

            ultimasCoordsReales = { lat: data.latitude, lon: data.longitude };
            const fotoURL = URL.createObjectURL(file);
            urlsTemporalesFotos.add(fotoURL);
            const fotoPreviewURL = await generarMiniaturaDataURL(file);
            ultimaFotoFile = file;
            currentPreviewDataUrl = fotoPreviewURL;

            if (telemetria.pitch !== null) document.getElementById("gimbal-pitch").value = Math.abs(telemetria.pitch).toFixed(1);
            if (telemetria.yaw !== null) document.getElementById("drone-heading").value = normalizarGrados(telemetria.yaw).toFixed(0);
            if (telemetria.alt !== null) document.getElementById("manual-alt").value = Math.abs(telemetria.alt).toFixed(0);
            ultimaTelemetriaFoto = { zoom: telemetria.zoom, hfov: telemetria.hfov };

            document.getElementById("telemetria-drone").innerHTML = `<strong>Foto:</strong> ${escapeHtml(file.name)}<br>${decimalADMS(data.latitude, true)} | ${decimalADMS(data.longitude, false)}`;

            if (btnClimaVuelo) btnClimaVuelo.style.display = "block";

            const foto = agregarFotoHistorial(
                {
                    id: Date.now() + Math.floor(Math.random() * 1000),
                    nombre: file.name,
                    lat: data.latitude,
                    lon: data.longitude,
                    fecha: new Date().toISOString(),
                    pitch: telemetria.pitch,
                    yaw: telemetria.yaw,
                    alt: telemetria.alt,
                    zoom: telemetria.zoom,
                    hfov: telemetria.hfov,
                    fotoPreviewURL
                },
                fotoURL
            );
            if (fotoPreviewURL) await idbSetFotoPreview(foto.id, fotoPreviewURL);
            const imgPreview = document.getElementById("img-preview");
            if (imgPreview) {
                imgPreview.src = fotoURL;
                imgPreview.alt = file.name;
                imgPreview.style.display = "block";
            }
            const countResult = document.getElementById("resultado-conteo");
            if (countResult) {
                countResult.innerText = "";
            }
            foto.marcador.openPopup();
            if (telemetria.yaw !== null) {
                mostrarOrientacionFoto(data.latitude, data.longitude, telemetria.yaw);
            } else {
                limpiarCapaOrientacionFoto();
                map.flyTo([data.latitude, data.longitude], 19);
            }
            if (faltantes.length === 0) {
                actualizarEstadoImportacion("ok", `Telemetria cargada. Pitch: ${telemetria.fuentes.pitch || "sin fuente"}; heading: ${telemetria.fuentes.yaw || "sin fuente"}`);
            } else {
                actualizarEstadoImportacion("ok", `GPS cargado; no se encontro: ${faltantes.join(", ")}`);
            }
        } catch (err) {
            const msg = err && err.message ? err.message : "No se pudo leer metadatos de la foto.";
            actualizarEstadoImportacion("error", msg);
            alert(`Error al procesar la foto: ${msg}`);
        }
    };
}

function limpiarMarcadoresGanado() {
    marcadoresGanado.forEach((marcador) => {
        if (map.hasLayer(marcador)) map.removeLayer(marcador);
    });
    marcadoresGanado = [];
}

function obtenerTelemetriaParaGanado() {
    if (!ultimasCoordsReales) return null;
    const alt = Number(document.getElementById("manual-alt").value);
    const yaw = Number(document.getElementById("drone-heading").value);
    const pitch = -Math.abs(Number(document.getElementById("gimbal-pitch").value));
    if (!Number.isFinite(alt) || !Number.isFinite(yaw) || !Number.isFinite(pitch)) {
        return null;
    }
    return {
        lat: ultimasCoordsReales.lat,
        lng: ultimasCoordsReales.lon,
        alt,
        yaw: normalizarGrados(yaw),
        pitch
    };
}

function proyectarPixelAGPS(pixelX, pixelY, anchoImg, altoImg, origen, telemetria) {
    const hfov = Number.isFinite(ultimaTelemetriaFoto.hfov) ? ultimaTelemetriaFoto.hfov : 78; // Cambiado a 78° típico para DJI
    const vfov = (altoImg / anchoImg) * hfov;
    const pctX = (pixelX / anchoImg) - 0.5;
    const pctY = (pixelY / altoImg) - 0.5;
    const yawAnimal = normalizarGrados(telemetria.yaw + pctX * hfov);
    const pitchAnimal = Math.max(-89, telemetria.pitch + pctY * vfov); // Limitar para evitar infinito
    const distanciaHorizontal = L.GeometryUtil.calcularDistanciaHorizontal(telemetria.alt, pitchAnimal);
    return proyectar(origen.lat, origen.lng, distanciaHorizontal, yawAnimal);
}

async function contarGanado() {
    const statusEl = document.getElementById("resultado-conteo");
    if (!ultimaFotoFile) {
        alert("Carga primero una foto de drone.");
        return;
    }
    if (!ultimasCoordsReales) {
        alert("Primero selecciona una foto con telemetría válida.");
        return;
    }
    const telemetria = obtenerTelemetriaParaGanado();
    if (!telemetria) {
        alert("Completa altitud, rumbo y pitch antes de proyectar el ganado.");
        return;
    }
    if (statusEl) statusEl.innerText = "Preparando análisis...";

    const progresoEl = document.getElementById("progreso-modelo");
    const barra = document.getElementById("barra-progreso");
    const texto = document.getElementById("texto-progreso");
    if (progresoEl) progresoEl.style.display = "block";
    if (barra) barra.value = 0;
    if (texto) texto.innerText = "Iniciando inferencia...";

    let progreso = 0;
    const intervalo = setInterval(() => {
        progreso = Math.min(90, progreso + Math.random() * 12);
        if (barra) barra.value = progreso;
        if (texto) texto.innerText = `Cargando modelo: ${Math.round(progreso)}%`;
    }, 180);

    try {
        const canvasInferencia = await VISION_ENGINE.prepareImageForInference(ultimaFotoFile);
        const detector = await VISION_ENGINE.loadDetector();
        clearInterval(intervalo);
        if (barra) barra.value = 100;
        if (texto) texto.innerText = `Modelo listo (${detector.kind || "fallback"})`;

        const detecciones = await VISION_ENGINE.detectImage(canvasInferencia);
        const ganado = detecciones.filter((item) => item.id === "cow" || item.id === "sheep" || item.id.includes("cow") || item.id.includes("sheep"));
        if (ganado.length === 0) {
            if (statusEl) statusEl.innerText = "No se detectaron animales.";
            setTimeout(() => { if (progresoEl) progresoEl.style.display = "none"; }, 1200);
            return;
        }

        const imagen = document.getElementById("img-preview");
        const ancho = imagen?.naturalWidth || imagen?.width || 1;
        const alto = imagen?.naturalHeight || imagen?.height || 1;
        limpiarMarcadoresGanado();
        resetConteoLab();
        const deteccionesProyectadas = [];

        ganado.forEach((animal) => {
            const cx = animal.x + animal.w / 2;
            const cy = animal.y + animal.h / 2;
            const coord = proyectarPixelAGPS(cx, cy, ancho, alto, ultimasCoordsReales, telemetria);
            const marcador = L.marker([coord.lat, coord.lon], { icon: iconoVaca })
                .addTo(map)
                .bindPopup(`<strong>${escapeHtml(animal.id)}</strong><br>Confianza: ${Math.round((animal.confidence || 0) * 100)}%`);
            marcadoresGanado.push(marcador);
            deteccionesProyectadas.push({ ...animal, coord, width: ancho, height: alto });
        });

        renderDetectionsOnKonva(ganado);
        conteoTotal = ganado.length;
        conteoCorreccionesManual = 0;
        actualizarStatusConteo();
        registrarConteoGeo(ganado.length, conteoCorreccionesManual, ultimasCoordsReales);
        if (statusEl) statusEl.innerText = `Detectados ${ganado.length} animales. Toca un rectángulo para ajustar el conteo.`;
    } catch (error) {
        console.error(error);
        if (statusEl) statusEl.innerText = "Error en la detección de ganado.";
        alert(`Error al ejecutar detección: ${error.message || error}`);
    } finally {
        clearInterval(intervalo);
        setTimeout(() => {
            const progresoElFinal = document.getElementById("progreso-modelo");
            if (progresoElFinal) progresoElFinal.style.display = "none";
        }, 1200);
    }
}

function bindConteoGanado() {
    const btnConteo = document.getElementById("btn-contar-ganado");
    if (!btnConteo) return;
    btnConteo.onclick = () => {
        if (!ultimaFotoFile) {
            alert("Carga primero una foto de drone.");
            return;
        }
        const fotoUrl = URL.createObjectURL(ultimaFotoFile);
        entrarAlLaboratorio({ url: fotoUrl });
    };
}

function bindLaboratorioUI() {
    const btnCerrar = document.getElementById("btn-cerrar-lab");
    if (btnCerrar) btnCerrar.onclick = cerrarLaboratorio;
    const btnExport = document.getElementById("btn-export-mapa");
    if (btnExport) btnExport.onclick = exportarLaboratorioAlMapa;
}

function entrarAlLaboratorio(fotoData) {
    const lab = document.getElementById("laboratorio-conteo");
    const holder = document.getElementById("konva-holder");
    if (!lab || !holder) return;

    lab.classList.remove("hidden");
    if (laboratorioFotoURL && laboratorioFotoURL !== fotoData.url) {
        URL.revokeObjectURL(laboratorioFotoURL);
    }
    laboratorioFotoURL = fotoData.url;

    holder.innerHTML = "";
    laboratorioStage = new Konva.Stage({
        container: "konva-holder",
        width: holder.clientWidth,
        height: holder.clientHeight,
        draggable: true
    });
    laboratorioLayer = new Konva.Layer();
    laboratorioStage.add(laboratorioLayer);

    laboratorioImageObj = new Image();
    laboratorioImageObj.crossOrigin = "anonymous";
    laboratorioImageObj.onload = () => {
        const imgKonva = new Konva.Image({
            image: laboratorioImageObj,
            x: 0,
            y: 0,
            width: laboratorioStage.width(),
            height: laboratorioStage.height()
        });
        laboratorioLayer.add(imgKonva);
        laboratorioLayer.draw();
        setupKonvaZoom(laboratorioStage);
        document.getElementById("count-progress").innerText = "0%";
        document.getElementById("total-detected").innerText = "0";
        document.getElementById("btn-export-mapa").classList.add("hidden");
    };
    laboratorioImageObj.src = fotoData.url;

    const btnCerrar = document.getElementById("btn-cerrar-lab");
    if (btnCerrar) btnCerrar.onclick = cerrarLaboratorio;

    const btnRunIA = document.getElementById("btn-run-ia");
    if (btnRunIA) {
        btnRunIA.onclick = async () => {
            const status = document.getElementById("count-progress");
            const total = document.getElementById("total-detected");
            if (!laboratorioImageObj) return;
            try {
                const detecciones = await VISION_ENGINE.procesarImagenCompleta(laboratorioImageObj, (p) => {
                    if (status) status.innerText = p + "%";
                });
                if (total) total.innerText = detecciones.length;
                dibujarCuadros(detecciones, laboratorioLayer);
                document.getElementById("btn-export-mapa").classList.remove("hidden");
                window.ultimasDetecciones = detecciones;
            } catch (error) {
                alert(`Error al ejecutar el escaneo IA: ${error.message || error}`);
            }
        };
    }

    const btnExport = document.getElementById("btn-export-mapa");
    if (btnExport) btnExport.onclick = exportarLaboratorioAlMapa;
}

function cerrarLaboratorio() {
    const lab = document.getElementById("laboratorio-conteo");
    if (lab) lab.classList.add("hidden");
    if (laboratorioStage) {
        laboratorioStage.destroy();
        laboratorioStage = null;
        laboratorioLayer = null;
    }
    if (laboratorioFotoURL) {
        URL.revokeObjectURL(laboratorioFotoURL);
        laboratorioFotoURL = null;
    }
}

function setupKonvaZoom(stage) {
    stage.on("wheel", (e) => {
        e.evt.preventDefault();
        const oldScale = stage.scaleX();
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale
        };
        const direction = e.evt.deltaY > 0 ? -1 : 1;
        const factor = direction > 0 ? 1.05 : 0.95;
        const newScale = Math.max(0.25, Math.min(3, oldScale * factor));
        stage.scale({ x: newScale, y: newScale });
        const newPos = {
            x: pointer.x - mousePointTo.x * newScale,
            y: pointer.y - mousePointTo.y * newScale
        };
        stage.position(newPos);
        stage.batchDraw();
    });
    stage.on("mousedown touchstart", () => { stage.draggable(true); stage.container().style.cursor = "grabbing"; });
    stage.on("mouseup touchend", () => { stage.draggable(false); stage.container().style.cursor = "grab"; });
}

function dibujarCuadros(detecciones, layer) {
    if (!layer) return;
    detecciones.forEach((det) => {
        const rect = new Konva.Rect({
            x: det.x,
            y: det.y,
            width: det.w,
            height: det.h,
            stroke: "#8eeea6",
            strokeWidth: 3,
            cornerRadius: 6
        });
        layer.add(rect);
    });
    layer.draw();
}

function exportarLaboratorioAlMapa() {
    const detecciones = window.ultimasDetecciones || [];
    if (!detecciones.length) {
        alert("No hay detecciones para proyectar al mapa.");
        return;
    }
    if (!ultimasCoordsReales) {
        alert("No hay coordenadas GPS disponibles para la foto.");
        return;
    }
    const imagen = document.getElementById("img-preview");
    if (!imagen) {
        alert("Imagen de preview no disponible.");
        return;
    }
    const ancho = imagen.naturalWidth || imagen.width;
    const alto = imagen.naturalHeight || imagen.height;
    const telemetria = obtenerTelemetriaParaGanado();
    if (!telemetria) {
        alert("Completa altitud, rumbo y pitch antes de proyectar al mapa.");
        return;
    }

    limpiarMarcadoresGanado();
    const bounds = [];
    detecciones.forEach((det) => {
        const cx = det.x + det.w / 2;
        const cy = det.y + det.h / 2;
        const coord = proyectarPixelAGPS(cx, cy, ancho, alto, ultimasCoordsReales, telemetria);
        const marker = L.marker([coord.lat, coord.lon], { icon: iconoVaca })
            .addTo(map)
            .bindPopup(`Animal detectado<br>Confianza: ${Math.round((det.confidence || 0) * 100)}%`);
        marcadoresGanado.push(marker);
        bounds.push([coord.lat, coord.lon]);
    });
    if (bounds.length) {
        map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 19 });
    }
}

function resetConteoLab() {
    const labEl = document.getElementById("conteo-lab");
    if (!labEl) return;
    selectedDetectionGroup = null;
    if (konvaLayer) {
        konvaLayer.destroyChildren();
        konvaLayer.draw();
    }
    const splitMenu = document.getElementById("split-menu");
    if (splitMenu) splitMenu.style.display = "none";
}

function loadHtmlImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("No se pudo cargar la imagen de preview."));
        img.src = src;
    });
}

async function renderDetectionsOnKonva(detecciones) {
    activarConteoLab();
    const wrapper = document.getElementById("konva-wrapper");
    if (!wrapper || !window.Konva || !currentPreviewDataUrl) return;

    const img = await loadHtmlImage(currentPreviewDataUrl);
    const wrapperWidth = wrapper.clientWidth || 800;
    const wrapperHeight = wrapper.clientHeight || 520;
    const scale = Math.min(wrapperWidth / img.width, wrapperHeight / img.height, 1);
    const displayWidth = Math.round(img.width * scale);
    const displayHeight = Math.round(img.height * scale);
    wrapper.style.height = `${displayHeight}px`;

    if (!konvaStage) {
        konvaStage = new Konva.Stage({ container: "konva-wrapper", width: displayWidth, height: displayHeight });
        konvaLayer = new Konva.Layer();
        konvaStage.add(konvaLayer);
    } else {
        konvaStage.width(displayWidth);
        konvaStage.height(displayHeight);
    }

    konvaLayer.destroyChildren();
    konvaImage = new Konva.Image({ image: img, x: 0, y: 0, width: displayWidth, height: displayHeight });
    konvaLayer.add(konvaImage);

    konvaDetections = detecciones;
    const sourceWidth = VISION_ENGINE.lastInputWidth || img.width;
    const sourceHeight = VISION_ENGINE.lastInputHeight || img.height;
    const scaleX = displayWidth / sourceWidth;
    const scaleY = displayHeight / sourceHeight;

    detecciones.forEach((deteccion, index) => {
        const rectGroup = new Konva.Group({ x: deteccion.x * scaleX, y: deteccion.y * scaleY, draggable: false });
        rectGroup.detection = deteccion;
        rectGroup.id(`detection-${index}`);

        const rect = new Konva.Rect({
            width: Math.max(24, deteccion.w * scaleX),
            height: Math.max(24, deteccion.h * scaleY),
            stroke: "#22c55e",
            strokeWidth: 3,
            cornerRadius: 6,
            dash: [8, 6],
            fill: "rgba(34,197,94,0.12)"
        });
        const label = new Konva.Text({
            text: `${escapeHtml(deteccion.id)} ${Math.round(deteccion.confidence * 100)}%`,
            fontSize: 14,
            fontFamily: "Arial",
            fill: "#ffffff",
            padding: 6,
            visible: true
        });
        rectGroup.add(rect);
        rectGroup.add(label);
        label.y(4);
        label.x(4);

        rectGroup.on("click touchstart", (e) => {
            e.cancelBubble = true;
            selectedDetectionGroup = rectGroup;
            highlightSelectedGroup(rectGroup);
            splitInstance(rectGroup);
        });
        rectGroup.on("mouseover", () => { konvaStage.container().style.cursor = "pointer"; });
        rectGroup.on("mouseout", () => { konvaStage.container().style.cursor = "default"; });
        konvaLayer.add(rectGroup);
    });

    konvaLayer.draw();
    bindZoomLupa();
}

function highlightSelectedGroup(group) {
    if (!group || !konvaStage) return;
    konvaStage.find("Group").each((existing) => {
        const rect = existing.findOne("Rect");
        if (rect) rect.stroke("#22c55e");
    });
    const rect = group.findOne("Rect");
    if (rect) rect.stroke("#facc15");
    selectedDetectionGroup = group;
}

function splitInstance(group) {
    const splitMenu = document.getElementById("split-menu");
    if (!splitMenu || !konvaStage) return;
    const box = group.getClientRect({ relativeTo: konvaStage });
    const stageBox = konvaStage.container().getBoundingClientRect();
    splitMenu.innerHTML = "<strong>Ajustar conteo</strong>";
    [2, 3, 5].forEach((value) => {
        const button = document.createElement("button");
        button.type = "button";
        button.innerText = `x${value}`;
        button.addEventListener("click", () => aplicarSplit(group, value));
        splitMenu.appendChild(button);
    });
    const mas = document.createElement("button");
    mas.type = "button";
    mas.innerText = "Más...";
    mas.addEventListener("click", () => {
        const valor = Number(prompt("¿Cuántos animales quieres asignar?", "10"));
        if (Number.isFinite(valor) && valor > 1) {
            aplicarSplit(group, valor);
        }
    });
    splitMenu.appendChild(mas);

    splitMenu.style.left = `${stageBox.left + box.x + box.width + 12}px`;
    splitMenu.style.top = `${stageBox.top + box.y}px`;
    splitMenu.style.display = "block";
}

function aplicarSplit(group, multiplicador) {
    if (!group || !group.detection) return;
    const detection = group.detection;
    const previo = detection.multiplier || 1;
    detection.multiplier = multiplicador;
    conteoCorreccionesManual += Math.max(0, multiplicador - previo);
    const label = group.findOne("Text");
    if (label) {
        label.text(`${escapeHtml(detection.id)} x${multiplicador}`);
    }
    group.findOne("Rect").fill("rgba(59,130,246,0.18)");
    updateConteoTotal();
    actualizarStatusConteo();
    hideSplitMenu();
}

function hideSplitMenu() {
    const splitMenu = document.getElementById("split-menu");
    if (splitMenu) splitMenu.style.display = "none";
}

function updateConteoTotal() {
    if (!konvaStage) return;
    conteoTotal = 0;
    konvaStage.find("Group").each((group) => {
        const detection = group.detection;
        if (!detection) return;
        conteoTotal += Number.isFinite(detection.multiplier) ? detection.multiplier : 1;
    });
}

function actualizarStatusConteo() {
    const statusEl = document.getElementById("resultado-conteo");
    if (!statusEl) return;
    statusEl.innerText = `Conteo final actual: ${conteoTotal}. Correcciones manuales: ${conteoCorreccionesManual}.`;
}

function bindZoomLupa() {
    if (!konvaStage || !VISION_ENGINE.isMobileDevice()) return;
    const lupa = document.getElementById("zoom-lupa");
    if (!lupa) return;
    const container = konvaStage.container();
    container.addEventListener("touchmove", actualizarZoomLupa);
    container.addEventListener("mousemove", actualizarZoomLupa);
    container.addEventListener("touchend", () => { if (lupa) lupa.style.display = "none"; });
    container.addEventListener("mouseleave", () => { if (lupa) lupa.style.display = "none"; });
}

function actualizarZoomLupa(event) {
    const lupa = document.getElementById("zoom-lupa");
    if (!lupa || !konvaStage || !currentPreviewDataUrl) return;
    const rect = konvaStage.container().getBoundingClientRect();
    const clienteX = event.touches ? event.touches[0].clientX : event.clientX;
    const clienteY = event.touches ? event.touches[0].clientY : event.clientY;
    const x = clienteX - rect.left;
    const y = clienteY - rect.top;
    const posX = Math.max(0, Math.min(100, (x / konvaStage.width()) * 100));
    const posY = Math.max(0, Math.min(100, (y / konvaStage.height()) * 100));
    lupa.style.backgroundImage = `url(${currentPreviewDataUrl})`;
    lupa.style.backgroundPosition = `${posX}% ${posY}%`;
    lupa.style.left = `${clienteX}px`;
    lupa.style.top = `${clienteY - 50}px`;
    lupa.style.display = "block";
}

function handleDesktopShortcuts(event) {
    if (VISION_ENGINE.isMobileDevice()) return;
    if (!selectedDetectionGroup) return;
    if (event.key === "d" || event.key === "D") {
        splitInstance(selectedDetectionGroup);
    }
    if (event.key === "Delete") {
        const group = selectedDetectionGroup;
        if (!group) return;
        group.destroy();
        selectedDetectionGroup = null;
        konvaLayer.draw();
        updateConteoTotal();
        actualizarStatusConteo();
        hideSplitMenu();
    }
}

function registrarConteoGeo(conteoFinal, correccionesManual, ubicacionGPS) {
    if (!historialFotos.length || !ubicacionGPS) return;
    const foto = historialFotos[0];
    const alt = Number(document.getElementById("manual-alt").value) || 0;
    const hfov = Number(ultimaTelemetriaFoto.hfov) || 73.74;
    const aspect = document.getElementById("img-preview")?.naturalHeight / document.getElementById("img-preview")?.naturalWidth || 0.75;
    const ancho = 2 * alt * Math.tan((hfov / 2) * (Math.PI / 180));
    const alto = ancho * aspect;
    const area = Math.max(1, ancho * alto);
    const densidad = conteoFinal / area;
    foto.conteoGeo = {
        conteoFinal,
        correccionesManual,
        ubicacionGPS: { lat: ubicacionGPS.lat, lon: ubicacionGPS.lon },
        areaPlanoM2: area,
        densidadPorM2: densidad
    };
    guardarEnLocal();
}

window.addEventListener("keydown", handleDesktopShortcuts);


function bindProyeccion() {
    const btnProyectar = document.getElementById("btn-proyectar");
    const inputAltitud = document.getElementById("manual-alt");
    const inputPitch = document.getElementById("gimbal-pitch");
    const inputHeading = document.getElementById("drone-heading");
    const selectTamanoBaldosa = document.getElementById("tamano-baldosa-auto");
    const selectModoPoligono = document.getElementById("modo-poligono-auto");
    const resolverDatosObjetivo = () => {
        if (!ultimasCoordsReales) {
            alert("Primero debes subir una foto del drone.");
            return null;
        }

        const inputAlt = document.getElementById("manual-alt").value.trim();
        const inputPitch = document.getElementById("gimbal-pitch").value.trim();
        const inputHead = document.getElementById("drone-heading").value.trim();
        if (!inputAlt || !inputPitch || !inputHead) {
            alert("No se puede calcular: completa pitch del gimbal, rumbo y altitud.");
            return null;
        }

        const alt = parseFloat(inputAlt);
        const pitchOriginal = parseFloat(inputPitch);
        const head = parseFloat(inputHead);
        if (!Number.isFinite(alt) || !Number.isFinite(pitchOriginal) || !Number.isFinite(head)) {
            alert("No se puede calcular: los datos del gimbal, rumbo y altura deben ser numericos.");
            return null;
        }
        if (alt <= 0) {
            alert("No se puede calcular: la altitud debe ser mayor a 0.");
            return null;
        }

        const pitchAbs = Math.abs(pitchOriginal);
        let distH = 0;
        if (pitchAbs < 89.5) {
            const anguloVerticalRad = ((90 - pitchAbs) * Math.PI) / 180;
            distH = alt * Math.tan(anguloVerticalRad);
        }

        const rumbo = normalizarGrados(head);
        const obj = proyectar(ultimasCoordsReales.lat, ultimasCoordsReales.lon, distH, rumbo);
        return {
            alt,
            rumbo,
            distH,
            obj,
            origen: { lat: ultimasCoordsReales.lat, lon: ultimasCoordsReales.lon }
        };
    };

    const calcularObjetivo = () => {
        const datos = resolverDatosObjetivo();
        if (!datos) return;

        crearObjetivoHistorial(datos);
        document.getElementById("resultado-mira").innerHTML = `Objetivo a ${datos.distH.toFixed(1)} m | Zoom x${ultimaTelemetriaFoto.zoom.toFixed(2)}`;
        map.flyTo([datos.obj.lat, datos.obj.lon], 19);
    };

    const calcularSoloPoligonoAutomatico = () => {
        const datos = resolverDatosObjetivo();
        if (!datos) return;

        const bufferMaleza = calcularPoligonoMaleza({
            origenLat: datos.origen.lat,
            origenLng: datos.origen.lon,
            altitud: datos.alt,
            hfov: ultimaTelemetriaFoto.hfov,
            yaw: datos.rumbo,
            distanciaAlSuelo: datos.distH,
            anchoManual: Number.parseFloat(selectTamanoBaldosa?.value || "100"),
            modoCalculo: selectModoPoligono?.value || "baldosa"
        });

        document.getElementById("resultado-mira").innerHTML = bufferMaleza
            ? `Poligono automatico: ${bufferMaleza.anchoSuelo.toFixed(1)} x ${bufferMaleza.anchoSuelo.toFixed(1)} m | ${bufferMaleza.modoCalculo} | Distancia objetivo ${datos.distH.toFixed(1)} m`
            : "No se pudo generar el poligono automatico.";
        map.flyTo([datos.obj.lat, datos.obj.lon], 19);
    };

    btnProyectar.onclick = calcularObjetivo;
    window.generarPoligonoAutomatico = calcularSoloPoligonoAutomatico;

    [inputAltitud, inputPitch, inputHeading].forEach((input) => {
        if (!input) return;
        input.addEventListener("keydown", (ev) => {
            if (ev.key !== "Enter") return;
            ev.preventDefault();
            calcularObjetivo();
        });
    });
}

function renderClima(infoDiv, data, color) {
    if (!data || !data.main || !data.wind || !Array.isArray(data.weather) || data.weather.length === 0) return "";
    const temp = data.main.temp;
    const viento = data.wind.speed * 3.6;
    const humedad = data.main.humidity;
    const desc = escapeHtml(data.weather[0].description);
    const colorSeguro = /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#3498db";
    const climaHtml = `<div style="background: #1c2833; padding: 10px; border-radius: 5px; border-left: 4px solid ${colorSeguro}; margin-top:5px;">
        <span style="text-transform: capitalize; font-weight: bold; color:${colorSeguro};">${desc}</span><br>
        🌡️ <b>Temp:</b> ${temp.toFixed(1)}°C<br>
        💧 <b>Humedad:</b> ${humedad}%<br>
        💨 <b>Viento:</b> ${viento.toFixed(1)} km/h
    </div>`;
    if (infoDiv) infoDiv.innerHTML = climaHtml;
    return climaHtml;
}

function actualizarPanelUbicacion() {
    const infoDiv = document.getElementById("info-coords");
    if (!infoDiv) return;
    infoDiv.innerHTML = `${ultimoHtmlCoords}${ultimoHtmlClimaLocal ? `<div style="margin-top:8px;">${ultimoHtmlClimaLocal}</div>` : ""}`;
}

function bindClima() {
    document.getElementById("btn-clima-actual").onclick = () => {
        const infoDiv = document.getElementById("info-coords");
        if (infoDiv) infoDiv.innerText = "Obteniendo clima local...";
        navigator.geolocation.getCurrentPosition(async (p) => {
            try {
                const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${p.coords.latitude}&lon=${p.coords.longitude}&appid=${WEATHER_API_KEY}&units=metric&lang=es`);
                const data = await resp.json();
                if (!resp.ok || (data && Number(data.cod) >= 400)) {
                    throw new Error(data && data.message ? data.message : "Error de servicio");
                }
                ultimoHtmlClimaLocal = renderClima(null, data, "#2980b9");
                actualizarPanelUbicacion();
            } catch (e) {
                ultimoHtmlClimaLocal = `<small style="color:#fca5a5;">Error al obtener clima local: ${escapeHtml(e.message || "sin detalle")}.</small>`;
                actualizarPanelUbicacion();
            }
        }, () => {
            ultimoHtmlClimaLocal = "<small style=\"color:#fca5a5;\">No se pudo obtener GPS local.</small>";
            actualizarPanelUbicacion();
        });
    };

    const btnClimaVuelo = document.getElementById("btn-clima");
    if (!btnClimaVuelo) return;
    btnClimaVuelo.onclick = async () => {
        if (!ultimasCoordsReales) return;
        const infoDiv = document.getElementById("info-clima");
        infoDiv.innerText = "Consultando clima del vuelo...";
        try {
            const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${ultimasCoordsReales.lat}&lon=${ultimasCoordsReales.lon}&appid=${WEATHER_API_KEY}&units=metric&lang=es`);
            const data = await resp.json();
            if (!resp.ok || (data && Number(data.cod) >= 400)) {
                throw new Error(data && data.message ? data.message : "Error de servicio");
            }
            renderClima(infoDiv, data, "#3498db");
        } catch (e) {
            infoDiv.innerText = `Error al obtener clima del vuelo: ${e.message || "sin detalle"}.`;
        }
    };
}

function abrirMapaBienvenida() {
    const saludoCoords = [-26.886502660213303, -64.99791220297926];
    map.setView(saludoCoords, 15);
    L.marker(saludoCoords)
        .addTo(map)
        .bindPopup("<strong>Bienvenido a GeoVision</strong><br>Usa el botón de localizar cuando quieras.")
        .openPopup();
}

function localizarUsuario() {
    const infoDiv = document.getElementById("info-coords");
    if (!navigator.geolocation) {
        infoDiv.innerText = "Tu navegador no soporta geolocalizacion.";
        return;
    }
    if (infoDiv) infoDiv.innerText = "Buscando señal GPS...";
    navigator.geolocation.getCurrentPosition((p) => {
        const { latitude: lat, longitude: lon, accuracy: acc } = p.coords;
        map.flyTo([lat, lon], 18);
        if (window.marcadorUsuario) {
            window.marcadorUsuario.setLatLng([lat, lon]);
        } else {
            window.marcadorUsuario = L.circleMarker([lat, lon], {
                radius: 8,
                color: "#fff",
                fillColor: "#0078d4",
                fillOpacity: 0.8,
                weight: 2
            }).addTo(map);
        }
        ultimoHtmlCoords = `<strong>Mi Ubicacion:</strong><br>${decimalADMS(lat, true)}<br>${decimalADMS(lon, false)}<br><small>Precision +/- ${acc.toFixed(0)}m</small>`;
        actualizarPanelUbicacion();
    }, () => {
        if (infoDiv) infoDiv.innerText = "Error al obtener GPS. Verifica permisos.";
    }, { enableHighAccuracy: true });
}

// =========================================================
// 4. MEDICION Y PUNTOS
// =========================================================
function agregarPuntoManual(latlng, nombre) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const nombreFinal = nombre || `Punto ${historialPuntos.length + 1}`;
    const m = L.marker(latlng, { icon: droneIcon, draggable: true }).addTo(map);
    m.bindTooltip(escapeHtml(nombreFinal), { permanent: true, direction: "top", className: "etiqueta-punto" }).openTooltip();
    m.on("dragend", () => {
        const p = historialPuntos.find((x) => x.id === id);
        if (p) {
            const ll = m.getLatLng();
            p.lat = ll.lat;
            p.lng = ll.lng;
            guardarEnLocal();
        }
    });
    historialPuntos.push({ id, m, nombre: nombreFinal, lat: latlng.lat, lng: latlng.lng });
    actualizarListaPuntos();
    guardarEnLocal();
}

function actualizarTooltipsLinea(medicion) {
    if (!medicion || !Array.isArray(medicion.marcadores) || medicion.marcadores.length < 2) return;
    const distancia = map.distance(medicion.marcadores[0].getLatLng(), medicion.marcadores[1].getLatLng());
    const txt = formatearDistancia(distancia);
    medicion.distancia = distancia;
    medicion.marcadores.forEach((marker) => {
        marker.bindTooltip(`Distancia: ${txt}`, {
            direction: "top",
            className: "etiqueta-medicion"
        });
    });
    medicion.linea.bindTooltip(`<b>${escapeHtml(medicion.nombre)}</b><br>${txt}`, {
        permanent: true,
        direction: "center",
        className: "etiqueta-medicion"
    }).openTooltip();
}

function crearLineaEditable(coords, nombre, opciones = {}) {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const id = opciones.id || Date.now();
    const puntos = [coords[0], coords[1]];
    const linea = L.polyline(puntos, { color: "#3498db", weight: 3 }).addTo(map);
    const marcadores = puntos.map((ll) => L.marker(ll, {
        draggable: true,
        icon: L.divIcon({ className: "vertice-linea", iconSize: [10, 10] })
    }).addTo(map));

    const medicion = {
        id,
        linea,
        marcadores,
        distancia: Number(opciones.distancia) || map.distance(puntos[0], puntos[1]),
        nombre: nombre || `Medida ${historialMediciones.length + 1}`,
        seleccionado: opciones.seleccionado !== false
    };

    marcadores.forEach((marker) => {
        marker.on("drag", () => {
            linea.setLatLngs(marcadores.map((m) => m.getLatLng()));
            actualizarTooltipsLinea(medicion);
        });
        marker.on("dragend", () => {
            actualizarListaLineas();
            guardarEnLocal();
        });
    });

    historialMediciones.push(medicion);
    actualizarTooltipsLinea(medicion);
    setVisibilidadLinea(medicion, medicion.seleccionado !== false);
    if (opciones.actualizarLista !== false) actualizarListaLineas();
    if (opciones.guardar !== false) guardarEnLocal();
    return medicion;
}

function setVisibilidadLinea(medicion, visible) {
    if (!medicion) return;
    const objetivoVisible = visible !== false;
    medicion.seleccionado = objetivoVisible;
    const capas = [medicion.linea, ...(medicion.marcadores || [])];
    capas.forEach((capa) => {
        if (!capa) return;
        if (objetivoVisible) {
            if (!map.hasLayer(capa)) capa.addTo(map);
        } else if (map.hasLayer(capa)) {
            map.removeLayer(capa);
        }
    });
}

function actualizarListaPuntos() {
    const ui = document.getElementById("lista-puntos");
    ui.innerHTML = "";
    historialPuntos.forEach((p) => {
        const li = document.createElement("li");
        li.style = "border-bottom:1px solid #444; padding:5px; display:flex; justify-content:space-between; align-items:center;";
        const input = document.createElement("input");
        input.type = "text";
        input.value = p.nombre;
        input.style.cssText = "background:none; border:1px solid #555; color:#fff; width:110px; font-size:0.8em;";
        input.addEventListener("change", () => window.cambiarNombrePunto(p.id, input.value));

        const boton = document.createElement("button");
        boton.type = "button";
        boton.innerText = "🗑️";
        boton.style.cssText = "background:none; color:red; border:none; cursor:pointer;";
        boton.addEventListener("click", () => window.borrarPunto(p.id));

        li.appendChild(input);
        li.appendChild(boton);
        ui.appendChild(li);
    });
}

function actualizarListaLineas() {
    const ui = document.getElementById("lista-medidas");
    ui.innerHTML = "";
    historialMediciones.forEach((m) => {
        const distancia = Number(m.distancia) || 0;
        const txt = formatearDistancia(distancia);
        m.linea.bindTooltip(`<b>${escapeHtml(m.nombre)}</b><br>${txt}`, { permanent: true, direction: "center", className: "etiqueta-medicion" }).openTooltip();

        const li = document.createElement("li");
        li.style = "border-bottom:1px solid #444; padding:5px; display:flex; justify-content:space-between; align-items:center;";
        const cont = document.createElement("div");
        cont.style.cssText = "display:flex; flex-direction:column;";
        const filaTitulo = document.createElement("div");
        filaTitulo.style.cssText = "display:flex; align-items:center; gap:6px;";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = m.seleccionado !== false;
        check.title = "Mostrar/Ocultar";
        check.addEventListener("change", () => {
            setVisibilidadLinea(m, check.checked);
            guardarEnLocal();
        });
        const input = document.createElement("input");
        input.type = "text";
        input.value = m.nombre;
        input.style.cssText = "background:none; border:1px solid #555; color:#3498db; width:100px; font-size:0.8em;";
        input.addEventListener("change", () => window.cambiarNombreLinea(m.id, input.value));
        const meta = document.createElement("small");
        meta.style.color = "#aaa";
        meta.innerText = txt;
        filaTitulo.appendChild(check);
        filaTitulo.appendChild(input);
        cont.appendChild(filaTitulo);
        cont.appendChild(meta);

        const boton = document.createElement("button");
        boton.type = "button";
        boton.innerText = "🗑️";
        boton.style.cssText = "background:none; color:red; border:none; cursor:pointer;";
        boton.addEventListener("click", () => window.borrarLinea(m.id));

        li.appendChild(cont);
        li.appendChild(boton);
        ui.appendChild(li);
    });
}

function calcularAreaTexto(latLngs) {
    if (!L.GeometryUtil || !L.GeometryUtil.geodesicArea) return "---";
    const area = L.GeometryUtil.geodesicArea(latLngs);
    return area > 10000 ? `${(area / 10000).toFixed(2)} ha` : `${area.toFixed(1)} m²`;
}

function actualizarInfoPoligono(id) {
    const p = historialPoligonos.find((x) => x.id === id);
    if (!p) return;
    const ll = p.objeto.getLatLngs()[0];
    p.areaTxt = calcularAreaTexto(ll);
    p.objeto.bindTooltip(`<b>${escapeHtml(p.nombre)}</b><br>${escapeHtml(p.areaTxt)}`, {
        permanent: true,
        direction: "center",
        className: "etiqueta-area"
    }).openTooltip();
    actualizarListaPoligonos();
}

function enfocarPoligono(id) {
    const p = historialPoligonos.find((x) => x.id === id);
    if (!p || !p.objeto) return;
    const bounds = p.objeto.getBounds();
    if (!bounds || !bounds.isValid()) return;
    map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 19 });
}

function setVisibilidadPoligono(poligono, visible) {
    if (!poligono) return;
    const objetivoVisible = visible !== false;
    poligono.seleccionado = objetivoVisible;

    if (objetivoVisible) {
        if (!map.hasLayer(poligono.objeto)) poligono.objeto.addTo(map);
        poligono.marcadores.forEach((m) => {
            if (!map.hasLayer(m)) m.addTo(map);
        });
        return;
    }

    if (map.hasLayer(poligono.objeto)) map.removeLayer(poligono.objeto);
    poligono.marcadores.forEach((m) => {
        if (map.hasLayer(m)) map.removeLayer(m);
    });
}

function actualizarListaPoligonos() {
    const uiManuales = document.getElementById("lista-poligonos-manuales");
    const uiAutomaticos = document.getElementById("lista-poligonos-automaticos");
    if (!uiManuales || !uiAutomaticos) return;

    uiManuales.innerHTML = "";
    uiAutomaticos.innerHTML = "";

    function renderFilaPoligono(x, uiDestino) {
        const li = document.createElement("li");
        li.style = "border-bottom:1px solid #444; padding:5px; display:flex; justify-content:space-between; align-items:center;";
        const cont = document.createElement("div");
        cont.style.cssText = "display:flex; flex-direction:column;";
        const filaTitulo = document.createElement("div");
        filaTitulo.style.cssText = "display:flex; align-items:center; gap:6px;";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = x.seleccionado !== false;
        check.title = "Mostrar/Ocultar y seleccionar para exportar";
        check.addEventListener("change", () => {
            setVisibilidadPoligono(x, check.checked);
            if (check.checked) enfocarPoligono(x.id);
            guardarEnLocal();
        });
        const input = document.createElement("input");
        input.type = "text";
        input.value = x.nombre;
        input.style.cssText = "background:none; border:1px solid #555; color:#2ecc71; width:100px; font-size:0.8em;";
        input.addEventListener("change", () => window.cambiarNombrePoligono(x.id, input.value));
        input.title = "Doble click para centrar en el mapa";
        input.addEventListener("dblclick", () => enfocarPoligono(x.id));
        const meta = document.createElement("small");
        meta.style.color = "#aaa";
        meta.innerText = x.areaTxt || "---";
        filaTitulo.appendChild(check);
        filaTitulo.appendChild(input);
        cont.appendChild(filaTitulo);
        cont.appendChild(meta);

        const boton = document.createElement("button");
        boton.type = "button";
        boton.innerText = "🗑️";
        boton.style.cssText = "background:none; color:red; border:none; cursor:pointer;";
        boton.addEventListener("click", () => window.borrarPoligono(x.id));

        li.appendChild(cont);
        li.appendChild(boton);
        uiDestino.appendChild(li);
    }

    historialPoligonos.forEach((x) => {
        if (x.esAutomatico === true) {
            renderFilaPoligono(x, uiAutomaticos);
        } else {
            renderFilaPoligono(x, uiManuales);
        }
    });
}

function eliminarPoligonoPorId(id, opciones = {}) {
    const { actualizar = true, guardar = true } = opciones;
    const i = historialPoligonos.findIndex((x) => x.id === id);
    if (i === -1) return false;
    map.removeLayer(historialPoligonos[i].objeto);
    historialPoligonos[i].marcadores.forEach((m) => map.removeLayer(m));
    historialPoligonos.splice(i, 1);

    if (actualizar) actualizarListaPoligonos();
    if (guardar) guardarEnLocal();
    return true;
}

function bindHerramientas() {
    const btnRegla = document.getElementById("btn-regla");
    const btnPoligono = document.getElementById("btn-poligono");
    const btnPunto = document.getElementById("btn-modo-punto");

    function refrescarEstadoHerramientas() {
        btnRegla.classList.toggle("is-active", modoMedicion);
        btnPoligono.classList.toggle("is-active", modoPoligono);
        btnPunto.classList.toggle("is-active", modoMarcadoManual);
        btnPunto.innerText = modoMarcadoManual ? "📍 Marcador Manual: ACTIVO" : "📍 Marcador Manual: Desactivado";
    }

    document.getElementById("btn-regla").onclick = () => {
        modoMedicion = !modoMedicion;
        modoPoligono = false;
        modoMarcadoManual = false;
        puntosTemp = [];
        limpiarMarcadoresTemporales();
        refrescarEstadoHerramientas();
    };

    document.getElementById("btn-poligono").onclick = () => {
        modoPoligono = !modoPoligono;
        modoMedicion = false;
        modoMarcadoManual = false;
        puntosTemp = [];
        limpiarMarcadoresTemporales();
        refrescarEstadoHerramientas();
    };

    document.getElementById("btn-modo-punto").onclick = () => {
        modoMarcadoManual = !modoMarcadoManual;
        modoMedicion = false;
        modoPoligono = false;
        puntosTemp = [];
        limpiarMarcadoresTemporales();
        refrescarEstadoHerramientas();
    };

    map.on("click", (e) => {
        if (modoMarcadoManual) {
            agregarPuntoManual(e.latlng);
            return;
        }

        if (modoMedicion) {
            puntosTemp.push(e.latlng);
            marcadoresTemp.push(L.circleMarker(e.latlng, { radius: 4 }).addTo(map));
            if (puntosTemp.length === 2) {
                crearLineaEditable(puntosTemp, `Medida ${historialMediciones.length + 1}`);
                limpiarMarcadoresTemporales();
                puntosTemp = [];
                modoMedicion = false;
                refrescarEstadoHerramientas();
            }
            return;
        }

        if (modoPoligono) {
            puntosTemp.push(e.latlng);
            marcadoresTemp.push(L.circleMarker(e.latlng, { radius: 4, color: "#2ecc71" }).addTo(map));
        }
    });

    map.on("dblclick", () => {
        if (!modoPoligono || puntosTemp.length < 3) return;
        crearPoligonoEditable(puntosTemp, `Area ${historialPoligonos.length + 1}`, { guardar: false, seleccionado: true });
        guardarEnLocal();

        puntosTemp = [];
        limpiarMarcadoresTemporales();
        modoPoligono = false;
        refrescarEstadoHerramientas();
    });

    refrescarEstadoHerramientas();
}

function initMobileBottomSheet() {
    const sidebar = document.getElementById("sidebar");
    const btnControles = document.getElementById("btn-mobile-controles");
    if (!sidebar || !btnControles) return;

    const mq = window.matchMedia("(max-width: 768px)");
    let abierto = false;

    function aplicarEstado() {
        if (!mq.matches) {
            sidebar.classList.remove("mobile-open");
            btnControles.classList.remove("activo");
            btnControles.style.display = "none";
            return;
        }
        btnControles.style.display = "block";
        sidebar.classList.toggle("mobile-open", abierto);
        btnControles.classList.toggle("activo", abierto);
        btnControles.innerText = abierto ? "Cerrar controles" : "Controles";
    }

    btnControles.onclick = () => {
        abierto = !abierto;
        aplicarEstado();
    };

    map.on("click", () => {
        if (!mq.matches || !abierto) return;
        abierto = false;
        aplicarEstado();
    });

    if (mq.addEventListener) mq.addEventListener("change", aplicarEstado);
    else mq.addListener(aplicarEstado);

    aplicarEstado();
    requestAnimationFrame(refrescarTamanoMapa);
}

// =========================================================
// 5. FUNCIONES GLOBALES DE UI
// =========================================================
window.cambiarNombrePunto = (id, nombre) => {
    const p = historialPuntos.find((x) => x.id === id);
    if (!p) return;
    p.nombre = nombre || p.nombre;
    p.m.setTooltipContent(escapeHtml(p.nombre));
    guardarEnLocal();
};

window.cambiarNombreLinea = (id, nombre) => {
    const m = historialMediciones.find((x) => x.id === id);
    if (!m) return;
    m.nombre = nombre || m.nombre;
    actualizarListaLineas();
    guardarEnLocal();
};

window.cambiarNombrePoligono = (id, nombre) => {
    const p = historialPoligonos.find((x) => x.id === id);
    if (!p) return;
    p.nombre = nombre || p.nombre;
    actualizarInfoPoligono(id);
    guardarEnLocal();
};

window.cambiarNombreObjetivo = (id, nombre) => {
    const objetivo = historialObjetivos.find((x) => x.id === id);
    if (!objetivo) return;
    objetivo.nombre = nombre || objetivo.nombre;
    objetivo.marcador.setPopupContent(
        `<div style="text-align:center;">
            <strong style="color:#2980b9;">${escapeHtml(objetivo.nombre)}</strong><br>
            <small>${decimalADMS(objetivo.destino.lat, true)}<br>${decimalADMS(objetivo.destino.lon, false)}</small><br>
            <hr style="margin:5px 0;">
            <span>Distancia: <strong>${objetivo.distancia.toFixed(1)} m</strong></span>
        </div>`
    );
    actualizarListaObjetivos();
    guardarEnLocal();
};

window.borrarLinea = (id) => {
    const i = historialMediciones.findIndex((x) => x.id === id);
    if (i === -1) return;
    map.removeLayer(historialMediciones[i].linea);
    (historialMediciones[i].marcadores || []).forEach((m) => map.removeLayer(m));
    historialMediciones.splice(i, 1);
    actualizarListaLineas();
    guardarEnLocal();
};

window.borrarPoligono = (id) => {
    eliminarPoligonoPorId(id, { actualizar: true, guardar: true });
};

window.borrarPunto = (id) => {
    const i = historialPuntos.findIndex((x) => x.id === id);
    if (i === -1) return;
    map.removeLayer(historialPuntos[i].m);
    historialPuntos.splice(i, 1);
    actualizarListaPuntos();
    guardarEnLocal();
};

window.borrarObjetivo = (id) => {
    const i = historialObjetivos.findIndex((x) => x.id === id);
    if (i === -1) return;
    map.removeLayer(historialObjetivos[i].objeto);
    historialObjetivos.splice(i, 1);
    actualizarListaObjetivos();
    guardarEnLocal();
};

window.borrarTodoElMapa = () => {
    if (!confirm("¿Estas seguro de borrar mediciones, poligonos, puntos y fotos del mapa?")) return;
    historialMediciones.forEach((m) => {
        map.removeLayer(m.linea);
        (m.marcadores || []).forEach((v) => map.removeLayer(v));
    });
    historialPoligonos.forEach((p) => {
        map.removeLayer(p.objeto);
        p.marcadores.forEach((v) => map.removeLayer(v));
    });
    historialPuntos.forEach((p) => map.removeLayer(p.m));
    historialObjetivos.forEach((o) => map.removeLayer(o.objeto));
    limpiarMarcadoresTemporales();
    limpiarFotos();
    historialMediciones = [];
    historialPoligonos = [];
    historialPuntos = [];
    historialObjetivos = [];
    puntosTemp = [];
    actualizarListaLineas();
    actualizarListaPoligonos();
    actualizarListaPuntos();
    actualizarListaObjetivos();
    guardarEnLocal();
};

window.borrarFoto = (id) => {
    borrarFotoPorId(id);
};

// =========================================================
// 6. EXPORTACION
// =========================================================
const DJI_WPML_NAMESPACE = "http://www.dji.com/wpmz/1.0.2";
const DJI_ALTURA_MISION_M = 50;
const DJI_ALTURA_DESPEGUE_SEGURA_M = 20;
const DJI_VELOCIDAD_MISION_MS = 5;

function escaparXml(texto) {
    return String(texto)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function obtenerPoligonosSeleccionados() {
    return historialPoligonos.filter((p) => p.seleccionado !== false);
}

function seleccionarTodosLosPoligonos(estadoSeleccionado) {
    historialPoligonos.forEach((p) => {
        setVisibilidadPoligono(p, estadoSeleccionado);
    });
    actualizarListaPoligonos();
    guardarEnLocal();
}

function convertirPoligonosAKML(poligonos = historialPoligonos) {
    const placemarks = poligonos.map((p) => {
        const puntos = p.objeto.getLatLngs()[0] || [];
        const coordenadas = puntos.map((pt) => `${pt.lng},${pt.lat},0`);

        if (coordenadas.length > 0 && coordenadas[0] !== coordenadas[coordenadas.length - 1]) {
            coordenadas.push(coordenadas[0]);
        }

        return `<Placemark>
    <name>${escaparXml(p.nombre || "Poligono")}</name>
    <description>${escaparXml(p.areaTxt || "")}</description>
    <Polygon>
      <outerBoundaryIs>
        <LinearRing>
          <coordinates>
            ${coordenadas.join(" ")}
          </coordinates>
        </LinearRing>
      </outerBoundaryIs>
    </Polygon>
  </Placemark>`;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>GeoVision Poligonos</name>
    ${placemarks.join("\n")}
  </Document>
</kml>`;
}

function formatearCoordWPML(valor) {
    return Number(valor).toFixed(8);
}

function puntosSonIgualesWPML(a, b) {
    if (!a || !b) return false;
    return Math.abs(a.lat - b.lat) < 0.00000001 && Math.abs(a.lng - b.lng) < 0.00000001;
}

function normalizarPuntoWPML(punto) {
    const lat = Number(punto.lat);
    const lng = Number(punto.lng ?? punto.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
}

function obtenerWaypointsDJIDesdePoligonos(poligonos = historialPoligonos) {
    const waypoints = [];

    poligonos.forEach((poligono, poligonoIndex) => {
        const latLngs = poligono?.objeto?.getLatLngs?.()[0] || [];
        const vertices = latLngs
            .map(normalizarPuntoWPML)
            .filter(Boolean);

        if (vertices.length < 3) return;

        const puntosCerrados = vertices.slice();
        if (!puntosSonIgualesWPML(puntosCerrados[0], puntosCerrados[puntosCerrados.length - 1])) {
            puntosCerrados.push(puntosCerrados[0]);
        }

        puntosCerrados.forEach((punto, verticeIndex) => {
            const anterior = waypoints[waypoints.length - 1];
            if (puntosSonIgualesWPML(anterior, punto)) return;

            waypoints.push({
                ...punto,
                nombre: `${poligono?.nombre || `Poligono ${poligonoIndex + 1}`} - WP ${verticeIndex + 1}`
            });
        });
    });

    return waypoints;
}

function distanciaMetrosWPML(a, b) {
    const radioTierraM = 6371000;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const deltaLat = (b.lat - a.lat) * Math.PI / 180;
    const deltaLng = (b.lng - a.lng) * Math.PI / 180;
    const h = Math.sin(deltaLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    return 2 * radioTierraM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function distanciaTotalWaypointsWPML(waypoints) {
    return waypoints.reduce((total, punto, index) => {
        if (index === 0) return total;
        return total + distanciaMetrosWPML(waypoints[index - 1], punto);
    }, 0);
}

function crearMissionConfigWPML() {
    return `<wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
      <wpml:takeOffSecurityHeight>${DJI_ALTURA_DESPEGUE_SEGURA_M}</wpml:takeOffSecurityHeight>
      <wpml:globalTransitionalSpeed>${DJI_VELOCIDAD_MISION_MS}</wpml:globalTransitionalSpeed>
    </wpml:missionConfig>`;
}

function crearWaypointHeadingWPML() {
    return `<wpml:waypointHeadingParam>
        <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
        <wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>
        <wpml:waypointPoiPoint>0.000000,0.000000,0.000000</wpml:waypointPoiPoint>
        <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>
      </wpml:waypointHeadingParam>`;
}

function crearWaypointTurnWPML() {
    return `<wpml:waypointTurnParam>
        <wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>
        <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>
      </wpml:waypointTurnParam>`;
}

function crearPlacemarkTemplateWPML(punto, index) {
    const coordenadas = `${formatearCoordWPML(punto.lng)},${formatearCoordWPML(punto.lat)}`;
    return `<Placemark>
      <name>${escaparXml(punto.nombre || `Waypoint ${index + 1}`)}</name>
      <Point>
        <coordinates>${coordenadas}</coordinates>
      </Point>
      <wpml:index>${index}</wpml:index>
      <wpml:ellipsoidHeight>${DJI_ALTURA_MISION_M}</wpml:ellipsoidHeight>
      <wpml:height>${DJI_ALTURA_MISION_M}</wpml:height>
      <wpml:waypointSpeed>${DJI_VELOCIDAD_MISION_MS}</wpml:waypointSpeed>
      ${crearWaypointHeadingWPML()}
      ${crearWaypointTurnWPML()}
      <wpml:useStraightLine>1</wpml:useStraightLine>
    </Placemark>`;
}

function crearPlacemarkWaylineWPML(punto, index) {
    const coordenadas = `${formatearCoordWPML(punto.lng)},${formatearCoordWPML(punto.lat)}`;
    return `<Placemark>
      <Point>
        <coordinates>${coordenadas}</coordinates>
      </Point>
      <wpml:index>${index}</wpml:index>
      <wpml:executeHeight>${DJI_ALTURA_MISION_M}</wpml:executeHeight>
      <wpml:waypointSpeed>${DJI_VELOCIDAD_MISION_MS}</wpml:waypointSpeed>
      ${crearWaypointHeadingWPML()}
      ${crearWaypointTurnWPML()}
      <wpml:useStraightLine>1</wpml:useStraightLine>
    </Placemark>`;
}

function crearTemplateKMLWPML(waypoints, metadataMision = crearMetadataMision()) {
    const fechaMs = Number(new Date(metadataMision.fechaIso).getTime()) || Date.now();
    const nombre = escaparXml(metadataMision.nombre || "geovision-mision");
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="${DJI_WPML_NAMESPACE}">
  <Document>
    <name>${nombre}</name>
    <wpml:author>GeoVision</wpml:author>
    <wpml:createTime>${fechaMs}</wpml:createTime>
    <wpml:updateTime>${fechaMs}</wpml:updateTime>
    ${crearMissionConfigWPML()}
    <Folder>
      <wpml:templateId>0</wpml:templateId>
      <wpml:templateType>waypoint</wpml:templateType>
      <wpml:waylineCoordinateSysParam>
        <wpml:coordinateMode>WGS84</wpml:coordinateMode>
        <wpml:heightMode>relativeToStartPoint</wpml:heightMode>
      </wpml:waylineCoordinateSysParam>
      <wpml:autoFlightSpeed>${DJI_VELOCIDAD_MISION_MS}</wpml:autoFlightSpeed>
      <wpml:globalHeight>${DJI_ALTURA_MISION_M}</wpml:globalHeight>
      <wpml:gimbalPitchMode>manual</wpml:gimbalPitchMode>
      ${waypoints.map(crearPlacemarkTemplateWPML).join("\n      ")}
    </Folder>
  </Document>
</kml>`;
}

function crearWaylinesWPML(waypoints, metadataMision = crearMetadataMision()) {
    const nombre = escaparXml(metadataMision.nombre || "geovision-mision");
    const distancia = distanciaTotalWaypointsWPML(waypoints);
    const duracion = distancia / DJI_VELOCIDAD_MISION_MS;
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="${DJI_WPML_NAMESPACE}">
  <Document>
    <name>${nombre}</name>
    ${crearMissionConfigWPML()}
    <Folder>
      <wpml:templateId>0</wpml:templateId>
      <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>
      <wpml:waylineId>0</wpml:waylineId>
      <wpml:distance>${distancia.toFixed(2)}</wpml:distance>
      <wpml:duration>${duracion.toFixed(2)}</wpml:duration>
      <wpml:autoFlightSpeed>${DJI_VELOCIDAD_MISION_MS}</wpml:autoFlightSpeed>
      ${waypoints.map(crearPlacemarkWaylineWPML).join("\n      ")}
    </Folder>
  </Document>
</kml>`;
}

async function crearKMZDJIWPML(waypoints, metadataMision = crearMetadataMision()) {
    if (!window.JSZip) {
        throw new Error("JSZip no esta disponible para generar KMZ.");
    }
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
        throw new Error("La mision DJI necesita al menos 2 waypoints validos.");
    }

    const zip = new window.JSZip();
    zip.file("wpmz/template.kml", crearTemplateKMLWPML(waypoints, metadataMision));
    zip.file("wpmz/waylines.wpml", crearWaylinesWPML(waypoints, metadataMision));
    return zip.generateAsync({
        type: "blob",
        mimeType: "application/vnd.google-earth.kmz",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
    });
}

function exportarPoligonosKML() {
    const poligonosSeleccionados = obtenerPoligonosSeleccionados();
    if (poligonosSeleccionados.length === 0) {
        alert("No hay poligonos para exportar.");
        return;
    }

    const contenido = convertirPoligonosAKML(poligonosSeleccionados);
    const blob = new Blob([contenido], { type: "application/vnd.google-earth.kml+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fecha = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `geovision-poligonos-${fecha}.kml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function crearBlobMisionKMZ(poligonos = historialPoligonos, metadataMision = crearMetadataMision()) {
    const waypoints = obtenerWaypointsDJIDesdePoligonos(poligonos);
    return crearKMZDJIWPML(waypoints, metadataMision);
}

async function crearBlobPruebaDJI(metadataMision = crearMetadataMision("geovision-test-conexion")) {
    const base = { lat: -26.837, lng: -65.203 };
    const delta = 0.00012;
    const waypoints = [
        { lat: base.lat - delta, lng: base.lng - delta, nombre: "GeoVision Test - WP 1" },
        { lat: base.lat - delta, lng: base.lng + delta, nombre: "GeoVision Test - WP 2" },
        { lat: base.lat + delta, lng: base.lng + delta, nombre: "GeoVision Test - WP 3" },
        { lat: base.lat + delta, lng: base.lng - delta, nombre: "GeoVision Test - WP 4" },
        { lat: base.lat - delta, lng: base.lng - delta, nombre: "GeoVision Test - WP 5" }
    ];
    return crearKMZDJIWPML(waypoints, metadataMision);
}

function normalizarNombreMision(texto) {
    return String(texto || "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^\w\-]/g, "")
        .replace(/\-+/g, "-")
        .replace(/^\-+|\-+$/g, "");
}

function crearMetadataMision(nombrePersonalizado = "") {
    const ahora = new Date();
    const fechaIso = ahora.toISOString();
    const fechaCompacta = fechaIso.slice(0, 19).replace(/[:T]/g, "-");
    const nombreBase = normalizarNombreMision(nombrePersonalizado);
    return {
        nombre: nombreBase || `geovision-mision-${fechaCompacta}`,
        fechaIso
    };
}

async function enviarMisionADron(kmzBlob, metadataMision) {
    console.log("Despachando mision desde GeoVision...");

    try {
        const response = await fetch(URL_GATEWAY_DJI_FARM, {
            method: "POST",
            headers: {
                "Content-Type": "application/vnd.google-earth.kmz",
                [HEADER_MISSION_NAME]: String(metadataMision.nombre),
                [HEADER_MISSION_DATE]: String(metadataMision.fechaIso)
            },
            body: kmzBlob
        });

        if (!response.ok) {
            const detalle = await response.text();
            throw new Error(`Gateway respondio con estado ${response.status}: ${detalle}`);
        }

        let resultado;
        try {
            resultado = await response.json();
        } catch (_errorJson) {
            resultado = {};
        }

        if (resultado.success) {
            alert("🚀 Mision enviada al dron con exito!");
            console.log("Mision:", metadataMision);
            console.log("Respuesta DJI:", resultado);
            return;
        }

        alert("⚠️ El gateway respondio, pero no confirmo exito.");
        console.log("Respuesta DJI:", resultado);
    } catch (error) {
        console.error("Falla en el despacho:", error);
        alert("❌ Error al conectar con el Gateway de San Pablo");
    }
}

async function exportarDJIFarm() {
    const poligonosSeleccionados = obtenerPoligonosSeleccionados();
    if (poligonosSeleccionados.length === 0) {
        alert("No hay poligonos para enviar a DJI FARM.");
        return;
    }

    const nombreSugerido = crearMetadataMision().nombre;
    const nombreIngresado = window.prompt("Nombre de la mision:", nombreSugerido);
    if (nombreIngresado === null) return;

    const metadataMision = crearMetadataMision(nombreIngresado);
    const btnDJIFarm = document.getElementById("btn-dji-farm");
    if (btnDJIFarm) {
        btnDJIFarm.disabled = true;
        btnDJIFarm.textContent = "Enviando...";
    }

    try {
        const kmzBlob = await crearBlobMisionKMZ(poligonosSeleccionados, metadataMision);
        await enviarMisionADron(kmzBlob, metadataMision);
    } catch (error) {
        console.error("No se pudo generar/enviar la mision:", error);
        alert("❌ No se pudo preparar o enviar la mision KMZ.");
    } finally {
        if (btnDJIFarm) {
            btnDJIFarm.disabled = false;
            btnDJIFarm.textContent = "DJI FARM";
        }
    }
}

async function probarConexionDJI() {
    const btnTest = document.getElementById("btn-dji-test");
    if (btnTest) {
        btnTest.disabled = true;
        btnTest.textContent = "Probando...";
    }

    try {
        const metadataMision = crearMetadataMision("geovision-test-conexion");
        const kmzBlob = await crearBlobPruebaDJI(metadataMision);
        await enviarMisionADron(kmzBlob, metadataMision);
    } catch (error) {
        console.error("No se pudo ejecutar la prueba DJI:", error);
        alert("❌ Fallo la prueba de comunicacion con DJI.");
    } finally {
        if (btnTest) {
            btnTest.disabled = false;
            btnTest.textContent = "Probar conexión DJI";
        }
    }
}

// =========================================================
// 7. PERSISTENCIA
// =========================================================
function guardarEnLocal() {
    if (estaHidratando) return;
    const datos = {
        mediciones: historialMediciones.map((m) => ({
            id: m.id,
            nombre: m.nombre,
            distancia: m.distancia,
            coords: m.linea.getLatLngs(),
            seleccionado: m.seleccionado !== false
        })),
        poligonos: historialPoligonos.map((p) => ({
            id: p.id,
            nombre: p.nombre,
            coords: p.objeto.getLatLngs()[0],
            seleccionado: p.seleccionado !== false,
            esAutomatico: p.esAutomatico === true,
            tipo: p.esAutomatico === true ? "automatico" : "manual"
        })),
        puntos: historialPuntos.map((p) => ({
            id: p.id,
            nombre: p.nombre,
            lat: p.m.getLatLng().lat,
            lng: p.m.getLatLng().lng
        })),
        fotos: historialFotos.map((f) => ({
            id: f.id,
            nombre: f.nombre,
            lat: f.lat,
            lon: f.lon,
            fecha: f.fecha,
            pitch: f.pitch,
            yaw: f.yaw,
            alt: f.alt,
            zoom: f.zoom,
            hfov: f.hfov
        })),
        objetivos: historialObjetivos.map((o) => ({
            id: o.id,
            nombre: o.nombre,
            origen: o.origen,
            destino: o.destino,
            rumbo: o.rumbo,
            distancia: o.distancia,
            seleccionado: o.seleccionado !== false
        })),
        ultimasCoordsReales
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(datos));
    } catch (error) {
        // Evita romper la app si el storage del navegador esta lleno.
        console.warn("No se pudo guardar en localStorage:", error);
    }
    idbSetAppState(datos);
}

function hidratarDesdeDatos(datos) {
    if (!datos || typeof datos !== "object") return;
    if (datos.ultimasCoordsReales) {
        ultimasCoordsReales = datos.ultimasCoordsReales;
    }

    if (Array.isArray(datos.mediciones)) {
        datos.mediciones.forEach((m) => {
            if (!Array.isArray(m.coords) || m.coords.length < 2) return;
            crearLineaEditable(m.coords, m.nombre || "Medida", {
                id: m.id || Date.now(),
                distancia: Number(m.distancia) || map.distance(m.coords[0], m.coords[1]),
                seleccionado: m.seleccionado !== false,
                guardar: false,
                actualizarLista: false
            });
        });
    }

    if (Array.isArray(datos.poligonos)) {
        datos.poligonos.forEach((p) => {
            if (!Array.isArray(p.coords) || p.coords.length < 3) return;
            const registro = crearPoligonoEditable(p.coords, p.nombre || "Area", {
                id: p.id || Date.now(),
                guardar: false,
                seleccionado: p.seleccionado !== false,
                esAutomatico: p.esAutomatico === true || p.tipo === "automatico"
            });
            if (registro) setVisibilidadPoligono(registro, registro.seleccionado !== false);
        });
    }

    if (Array.isArray(datos.puntos)) {
        datos.puntos.forEach((p) => {
            if (typeof p.lat !== "number" || typeof p.lng !== "number") return;
            agregarPuntoManual({ lat: p.lat, lng: p.lng }, p.nombre || "Punto");
        });
    }

    if (Array.isArray(datos.fotos)) {
        datos.fotos.forEach((f) => {
            if (typeof f.lat !== "number" || typeof f.lon !== "number") return;
            const foto = agregarFotoHistorial({
                id: f.id || Date.now(),
                nombre: f.nombre || "Foto",
                lat: f.lat,
                lon: f.lon,
                fecha: f.fecha || new Date().toISOString(),
                pitch: typeof f.pitch === "number" ? f.pitch : null,
                yaw: typeof f.yaw === "number" ? f.yaw : null,
                alt: typeof f.alt === "number" ? f.alt : null,
                zoom: typeof f.zoom === "number" ? f.zoom : 1,
                hfov: typeof f.hfov === "number" ? f.hfov : 73.74
            });
            idbGetFotoPreview(foto.id).then((preview) => {
                if (!preview) return;
                foto.fotoPreviewURL = preview;
                refrescarPopupFoto(foto);
            });
        });
    }

    if (Array.isArray(datos.objetivos)) {
        datos.objetivos.forEach((o) => {
            if (!o.origen || !o.destino) return;
            if (typeof o.origen.lat !== "number" || typeof o.origen.lon !== "number") return;
            if (typeof o.destino.lat !== "number" || typeof o.destino.lon !== "number") return;
            crearObjetivoHistorial(
                {
                    origen: o.origen,
                    obj: o.destino,
                    rumbo: typeof o.rumbo === "number" ? o.rumbo : 0,
                    distH: typeof o.distancia === "number" ? o.distancia : map.distance([o.origen.lat, o.origen.lon], [o.destino.lat, o.destino.lon])
                },
                {
                    id: o.id || Date.now(),
                    nombre: o.nombre || "Objetivo",
                    seleccionado: o.seleccionado !== false,
                    guardar: false,
                    abrirPopup: false
                }
            );
        });
    }

    actualizarListaLineas();
    actualizarListaPoligonos();
    actualizarListaPuntos();
    actualizarListaFotos();
    actualizarListaObjetivos();
}

async function cargarDesdeLocal() {
    const datosIdb = await idbGetAppState();
    if (datosIdb) {
        estaHidratando = true;
        try {
            hidratarDesdeDatos(datosIdb);
        } finally {
            estaHidratando = false;
        }
        console.log("Carga de datos: IndexedDB");
        return;
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        console.log("Carga de datos: sin datos locales");
        return;
    }

    try {
        const datos = JSON.parse(raw);
        estaHidratando = true;
        try {
            hidratarDesdeDatos(datos);
        } finally {
            estaHidratando = false;
        }
        // Migra el estado legacy de localStorage para futuros inicios.
        idbSetAppState(datos);
        console.log("Carga de datos: localStorage (migrado a IndexedDB)");
    } catch (_e) {
        // Si localStorage esta corrupto, no bloquea la carga.
        console.warn("Carga de datos: localStorage corrupto, no se pudo hidratar");
    }
}

// =========================================================
// 8. INICIALIZACION
// =========================================================
window.onload = function onLoad() {
    solicitarAlmacenamientoPersistente();
    refrescarTamanoMapa();
    requestAnimationFrame(refrescarTamanoMapa);

    if (window.L && L.GeometryUtil) {
        console.log("Geometria cargada.");
    }
    document.getElementById("btn-localizar").onclick = localizarUsuario;
    document.getElementById("btn-borrar-todo").onclick = window.borrarTodoElMapa;
    document.getElementById("btn-exportar-kml").onclick = exportarPoligonosKML;
    const btnSeleccionarTodos = document.getElementById("btn-poligonos-seleccionar-todos");
    if (btnSeleccionarTodos) {
        btnSeleccionarTodos.onclick = () => seleccionarTodosLosPoligonos(true);
    }
    const btnSeleccionarNinguno = document.getElementById("btn-poligonos-seleccionar-ninguno");
    if (btnSeleccionarNinguno) {
        btnSeleccionarNinguno.onclick = () => seleccionarTodosLosPoligonos(false);
    }

    const btnDJIFarm = document.getElementById("btn-dji-farm");
    if (btnDJIFarm) {
        btnDJIFarm.onclick = exportarDJIFarm;
    }
    const btnDJITest = document.getElementById("btn-dji-test");
    if (btnDJITest) {
        btnDJITest.onclick = probarConexionDJI;
    }
    const btnPoligonoAuto = document.getElementById("btn-poligono-auto");
    if (btnPoligonoAuto) {
        btnPoligonoAuto.onclick = () => {
            if (typeof window.generarPoligonoAutomatico === "function") {
                window.generarPoligonoAutomatico();
                return;
            }
            alert("La herramienta de poligono automatico no esta lista todavia.");
        };
    }
    bindInstalacionApp();
    addCompassControl();
    bindFotoDrone();
    bindConteoGanado();
    bindProyeccion();
    bindLaboratorioUI();
    abrirMapaBienvenida();
    bindClima();
    bindHerramientas();
    initMobileBottomSheet();
    cargarDesdeLocal();
    initWelcomeScreen();
};

function initWelcomeScreen() {
    const welcomeStart = document.getElementById("btn-welcome-start");
    const welcomeScreen = document.getElementById("welcome-screen");
    if (!welcomeScreen || !welcomeStart) return;

    const close = () => {
        if (!welcomeScreen || welcomeScreen.classList.contains("hidden")) return;
        welcomeScreen.classList.add("hidden");
        setTimeout(() => {
            if (welcomeScreen.parentNode) {
                welcomeScreen.parentNode.removeChild(welcomeScreen);
            }
        }, 500);
    };

    welcomeStart.addEventListener("click", close);
    setTimeout(close, 2800);
}
