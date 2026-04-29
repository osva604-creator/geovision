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
const urlsTemporalesFotos = new Set();
let capaOrientacionFoto = null;
let capaVisionCalculada = null;
let deferredInstallPrompt = null;

const WEATHER_API_KEY = window.WEATHER_API_KEY || "ee2057b73b750d1fae6127e3ce2d091d";
const STORAGE_KEY = "geovision_data";

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

function parseNumero(valor) {
    if (typeof valor === "number" && Number.isFinite(valor)) return valor;
    if (Array.isArray(valor)) {
        for (const item of valor) {
            const n = parseNumero(item);
            if (n !== null) return n;
        }
        return null;
    }
    if (valor && typeof valor === "object") {
        if (typeof valor.numerator === "number" && typeof valor.denominator === "number" && valor.denominator !== 0) {
            return valor.numerator / valor.denominator;
        }
        if ("value" in valor) return parseNumero(valor.value);
        return null;
    }
    if (typeof valor !== "string") return null;
    const match = valor.replace(",", ".").match(/-?\d+(\.\d+)?/);
    if (!match) return null;
    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

function recolectarCamposNumericos(origen) {
    const out = {};
    if (!origen || typeof origen !== "object") return out;
    const stack = [origen];
    while (stack.length > 0) {
        const actual = stack.pop();
        if (!actual || typeof actual !== "object") continue;
        Object.entries(actual).forEach(([k, v]) => {
            const numero = parseNumero(v);
            if (numero !== null) {
                const key = normalizarClave(k);
                if (!(key in out)) out[key] = numero;
            }
            if (v && typeof v === "object") {
                stack.push(v);
                return;
            }
        });
    }
    return out;
}

function obtenerPrimerCampo(campos, candidatos) {
    const claves = Object.keys(campos);
    for (const candidato of candidatos) {
        const key = normalizarClave(candidato);
        if (key in campos) return campos[key];
        const encontrada = claves.find((k) => k.endsWith(key) || k.includes(key));
        if (encontrada) return campos[encontrada];
    }
    return null;
}

function extraerTelemetria(data) {
    const campos = recolectarCamposNumericos(data);
    return {
        pitch: obtenerPrimerCampo(campos, [
            "GimbalPitchDegree", "FlightPitchDegree", "CameraPitch", "GimbalPitch", "Pitch",
            "drone-dji:GimbalPitchDegree", "drone-dji:FlightPitchDegree", "GimbalDegree",
            "gimbalrollpitchyaw", "camera:gimbalpitchdegree"
        ]),
        yaw: obtenerPrimerCampo(campos, [
            "FlightYawDegree", "GimbalYawDegree", "DroneYawDegree", "GPSImgDirection", "Heading", "Yaw",
            "drone-dji:FlightYawDegree", "drone-dji:GimbalYawDegree"
        ]),
        alt: obtenerPrimerCampo(campos, [
            "RelativeAltitude", "AbsoluteAltitude", "GPSAltitude", "Altitude", "DroneAltitude",
            "drone-dji:RelativeAltitude", "drone-dji:AbsoluteAltitude"
        ])
    };
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
    return `<b>${foto.nombre}</b><br>${formatearCoords(foto.lat, foto.lon)}`;
}

function seleccionarFotoParaCalculo(foto, enfocarMapa = true) {
    if (!foto) return;
    ultimasCoordsReales = { lat: foto.lat, lon: foto.lon };
    if (typeof foto.pitch === "number") document.getElementById("gimbal-pitch").value = Math.abs(foto.pitch).toFixed(1);
    if (typeof foto.yaw === "number") document.getElementById("drone-heading").value = normalizarGrados(foto.yaw).toFixed(0);
    if (typeof foto.alt === "number") document.getElementById("manual-alt").value = Math.abs(foto.alt).toFixed(0);

    if (typeof foto.yaw === "number") {
        mostrarOrientacionFoto(foto.lat, foto.lon, foto.yaw);
    } else {
        if (enfocarMapa) map.flyTo([foto.lat, foto.lon], 19);
    }

    document.getElementById("resultado-mira").innerHTML = `Foto seleccionada: <strong>${foto.nombre}</strong>`;
    if (foto.marcador && enfocarMapa) foto.marcador.openPopup();
}

function crearMarcadorFoto(foto, fotoURL) {
    const marker = L.marker([foto.lat, foto.lon], { icon: droneIcon }).addTo(map);
    marker.bindTooltip(generarTextoTooltipFoto(foto), {
        direction: "top",
        className: "etiqueta-punto"
    });

    const htmlPopup = fotoURL
        ? `<div style="text-align:center; min-width: 300px;">
                <h3 style="margin: 0 0 10px 0; color: #3498db; font-size: 16px;">Captura de Vuelo</h3>
                <img src="${fotoURL}" style="width: 100%; height: auto; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); cursor: zoom-in;" onclick="window.open('${fotoURL}', '_blank')">
                <p style="font-size: 11px; color: #bdc3c7; margin-top: 8px;">Pulsa para ver imagen completa</p>
            </div>`
        : `<div style="text-align:center;">
                <h3 style="margin: 0 0 10px 0; color: #3498db; font-size: 16px;">Captura de Vuelo</h3>
                <p style="font-size: 12px; color: #ecf0f1; margin:0;">
                    ${foto.nombre}<br>${formatearCoords(foto.lat, foto.lon)}
                </p>
            </div>`;

    marker.bindPopup(htmlPopup, { maxWidth: 360, className: "popup-drone-grande" });
    return marker;
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
            map.flyTo([foto.lat, foto.lon], 19);
            foto.marcador.openPopup();
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
    actualizarListaFotos();
}

function actualizarDebugExif(data, telemetria, faltantes) {
    const ui = document.getElementById("debug-exif-contenido");
    if (!ui) return;

    const campos = recolectarCamposNumericos(data);
    const claves = Object.keys(campos).sort().slice(0, 30);
    const lineas = [
        `pitch: ${telemetria.pitch !== null ? telemetria.pitch : "N/A"}`,
        `heading: ${telemetria.yaw !== null ? telemetria.yaw : "N/A"}`,
        `altitud: ${telemetria.alt !== null ? telemetria.alt : "N/A"}`,
        `faltantes: ${faltantes.length ? faltantes.join(", ") : "ninguno"}`,
        "",
        "Campos numericos detectados (primeros 30):",
        ...claves.map((k) => `- ${k}: ${campos[k]}`)
    ];
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
    estadoDiv.innerHTML = `Estado: <strong>${estilo.label}</strong>${detalle ? `<br><small>${detalle}</small>` : ""}`;
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

            if (telemetria.pitch !== null) document.getElementById("gimbal-pitch").value = Math.abs(telemetria.pitch).toFixed(1);
            if (telemetria.yaw !== null) document.getElementById("drone-heading").value = normalizarGrados(telemetria.yaw).toFixed(0);
            if (telemetria.alt !== null) document.getElementById("manual-alt").value = Math.abs(telemetria.alt).toFixed(0);

            document.getElementById("telemetria-drone").innerHTML = `<strong>Foto:</strong> ${file.name}<br>${decimalADMS(data.latitude, true)} | ${decimalADMS(data.longitude, false)}`;

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
                    alt: telemetria.alt
                },
                fotoURL
            );
            foto.marcador.openPopup();
            if (telemetria.yaw !== null) {
                mostrarOrientacionFoto(data.latitude, data.longitude, telemetria.yaw);
            } else {
                limpiarCapaOrientacionFoto();
                map.flyTo([data.latitude, data.longitude], 19);
            }
            if (faltantes.length === 0) {
                actualizarEstadoImportacion("ok", "Telemetria de vuelo cargada");
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

function bindProyeccion() {
    const btnProyectar = document.getElementById("btn-proyectar");
    const inputAltitud = document.getElementById("manual-alt");
    const inputPitch = document.getElementById("gimbal-pitch");
    const inputHeading = document.getElementById("drone-heading");
    const calcularObjetivo = () => {
        if (!ultimasCoordsReales) {
            alert("Primero debes subir una foto del drone.");
            return;
        }

        const inputAlt = document.getElementById("manual-alt").value.trim();
        const inputPitch = document.getElementById("gimbal-pitch").value.trim();
        const inputHead = document.getElementById("drone-heading").value.trim();
        if (!inputAlt || !inputPitch || !inputHead) {
            alert("No se puede calcular: completa pitch del gimbal, rumbo y altitud.");
            return;
        }

        const alt = parseFloat(inputAlt);
        const pitchOriginal = parseFloat(inputPitch);
        const head = parseFloat(inputHead);
        if (!Number.isFinite(alt) || !Number.isFinite(pitchOriginal) || !Number.isFinite(head)) {
            alert("No se puede calcular: los datos del gimbal, rumbo y altura deben ser numericos.");
            return;
        }
        if (alt <= 0) {
            alert("No se puede calcular: la altitud debe ser mayor a 0.");
            return;
        }

        const pitchAbs = Math.abs(pitchOriginal);
        let distH = 0;
        if (pitchAbs < 89.5) {
            const anguloVerticalRad = ((90 - pitchAbs) * Math.PI) / 180;
            distH = alt * Math.tan(anguloVerticalRad);
        }

        const rumbo = normalizarGrados(head);
        const obj = proyectar(ultimasCoordsReales.lat, ultimasCoordsReales.lon, distH, rumbo);

        L.marker([obj.lat, obj.lon], { icon: iconoMira })
            .addTo(map)
            .bindPopup(
                `<div style="text-align:center;">
                    <strong style="color:#2980b9;">Objetivo calculado</strong><br>
                    <small>${decimalADMS(obj.lat, true)}<br>${decimalADMS(obj.lon, false)}</small><br>
                    <hr style="margin:5px 0;">
                    <span>Distancia: <strong>${distH.toFixed(1)} m</strong></span>
                </div>`
            )
            .openPopup();

        mostrarLineaVision(
            { lat: ultimasCoordsReales.lat, lon: ultimasCoordsReales.lon },
            { lat: obj.lat, lon: obj.lon },
            rumbo
        );

        document.getElementById("resultado-mira").innerHTML = `Objetivo a ${distH.toFixed(1)} m`;
        map.flyTo([obj.lat, obj.lon], 19);
    };

    btnProyectar.onclick = calcularObjetivo;

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
    if (!data || !data.main || !data.wind || !Array.isArray(data.weather) || data.weather.length === 0) {
        infoDiv.innerText = "No se pudo interpretar la respuesta del clima.";
        return;
    }
    const temp = data.main.temp;
    const viento = data.wind.speed * 3.6;
    const humedad = data.main.humidity;
    const desc = data.weather[0].description;
    infoDiv.innerHTML = `<div style="background: #1c2833; padding: 10px; border-radius: 5px; border-left: 4px solid ${color}; margin-top:5px;">
        <span style="text-transform: capitalize; font-weight: bold; color:${color};">${desc}</span><br>
        🌡️ <b>Temp:</b> ${temp.toFixed(1)}°C<br>
        💧 <b>Humedad:</b> ${humedad}%<br>
        💨 <b>Viento:</b> ${viento.toFixed(1)} km/h
    </div>`;
}

function bindClima() {
    document.getElementById("btn-clima-actual").onclick = () => {
        const infoDiv = document.getElementById("info-clima-actual");
        infoDiv.innerText = "Obteniendo clima local...";
        navigator.geolocation.getCurrentPosition(async (p) => {
            try {
                const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${p.coords.latitude}&lon=${p.coords.longitude}&appid=${WEATHER_API_KEY}&units=metric&lang=es`);
                const data = await resp.json();
                if (!resp.ok || (data && Number(data.cod) >= 400)) {
                    throw new Error(data && data.message ? data.message : "Error de servicio");
                }
                renderClima(infoDiv, data, "#2980b9");
            } catch (e) {
                infoDiv.innerText = `Error al obtener clima local: ${e.message || "sin detalle"}.`;
            }
        }, () => {
            infoDiv.innerText = "No se pudo obtener GPS local.";
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

function localizarUsuario() {
    const infoDiv = document.getElementById("info-coords");
    if (!navigator.geolocation) {
        infoDiv.innerText = "Tu navegador no soporta geolocalizacion.";
        return;
    }
    infoDiv.innerText = "Buscando señal GPS...";
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
        infoDiv.innerHTML = `<strong>Mi Ubicacion:</strong><br>${decimalADMS(lat, true)}<br>${decimalADMS(lon, false)}<br><small>Precision +/- ${acc.toFixed(0)}m</small>`;
    }, () => {
        infoDiv.innerText = "Error al obtener GPS. Verifica permisos.";
    }, { enableHighAccuracy: true });
}

// =========================================================
// 4. MEDICION Y PUNTOS
// =========================================================
function agregarPuntoManual(latlng, nombre) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const nombreFinal = nombre || `Punto ${historialPuntos.length + 1}`;
    const m = L.marker(latlng, { icon: droneIcon, draggable: true }).addTo(map);
    m.bindTooltip(nombreFinal, { permanent: true, direction: "top", className: "etiqueta-punto" }).openTooltip();
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
        const txt = distancia > 1000 ? `${(distancia / 1000).toFixed(2)}km` : `${distancia.toFixed(1)}m`;
        m.linea.bindTooltip(`<b>${m.nombre}</b><br>${txt}`, { permanent: true, direction: "center", className: "etiqueta-medicion" }).openTooltip();

        const li = document.createElement("li");
        li.style = "border-bottom:1px solid #444; padding:5px; display:flex; justify-content:space-between; align-items:center;";
        const cont = document.createElement("div");
        cont.style.cssText = "display:flex; flex-direction:column;";
        const input = document.createElement("input");
        input.type = "text";
        input.value = m.nombre;
        input.style.cssText = "background:none; border:1px solid #555; color:#3498db; width:100px; font-size:0.8em;";
        input.addEventListener("change", () => window.cambiarNombreLinea(m.id, input.value));
        const meta = document.createElement("small");
        meta.style.color = "#aaa";
        meta.innerText = txt;
        cont.appendChild(input);
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
    p.objeto.bindTooltip(`<b>${p.nombre}</b><br>${p.areaTxt}`, {
        permanent: true,
        direction: "center",
        className: "etiqueta-area"
    }).openTooltip();
    actualizarListaPoligonos();
}

function actualizarListaPoligonos() {
    const ui = document.getElementById("lista-poligonos");
    ui.innerHTML = "";
    historialPoligonos.forEach((x) => {
        const li = document.createElement("li");
        li.style = "border-bottom:1px solid #444; padding:5px; display:flex; justify-content:space-between; align-items:center;";
        const cont = document.createElement("div");
        cont.style.cssText = "display:flex; flex-direction:column;";
        const input = document.createElement("input");
        input.type = "text";
        input.value = x.nombre;
        input.style.cssText = "background:none; border:1px solid #555; color:#2ecc71; width:100px; font-size:0.8em;";
        input.addEventListener("change", () => window.cambiarNombrePoligono(x.id, input.value));
        const meta = document.createElement("small");
        meta.style.color = "#aaa";
        meta.innerText = x.areaTxt || "---";
        cont.appendChild(input);
        cont.appendChild(meta);

        const boton = document.createElement("button");
        boton.type = "button";
        boton.innerText = "🗑️";
        boton.style.cssText = "background:none; color:red; border:none; cursor:pointer;";
        boton.addEventListener("click", () => window.borrarPoligono(x.id));

        li.appendChild(cont);
        li.appendChild(boton);
        ui.appendChild(li);
    });
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
                const distancia = map.distance(puntosTemp[0], puntosTemp[1]);
                const id = Date.now();
                const linea = L.polyline(puntosTemp, { color: "#3498db", weight: 3 }).addTo(map);
                historialMediciones.push({ id, linea, distancia, nombre: `Medida ${historialMediciones.length + 1}` });
                actualizarListaLineas();
                guardarEnLocal();
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
        const id = Date.now();
        const poli = L.polygon(puntosTemp, { color: "#2ecc71", fillOpacity: 0.3 }).addTo(map);
        const vertices = [];

        puntosTemp.forEach((ll) => {
            const v = L.marker(ll, { draggable: true, icon: L.divIcon({ className: "vertice-poligono", iconSize: [10, 10] }) }).addTo(map);
            v.on("drag", () => {
                poli.setLatLngs(vertices.map((marker) => marker.getLatLng()));
                actualizarInfoPoligono(id);
                guardarEnLocal();
            });
            vertices.push(v);
        });

        historialPoligonos.push({
            id,
            objeto: poli,
            marcadores: vertices,
            nombre: `Area ${historialPoligonos.length + 1}`,
            areaTxt: ""
        });
        actualizarInfoPoligono(id);
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
            btnControles.style.display = "none";
            return;
        }
        btnControles.style.display = "block";
        sidebar.classList.toggle("mobile-open", abierto);
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
}

// =========================================================
// 5. FUNCIONES GLOBALES DE UI
// =========================================================
window.cambiarNombrePunto = (id, nombre) => {
    const p = historialPuntos.find((x) => x.id === id);
    if (!p) return;
    p.nombre = nombre || p.nombre;
    p.m.setTooltipContent(p.nombre);
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

window.borrarLinea = (id) => {
    const i = historialMediciones.findIndex((x) => x.id === id);
    if (i === -1) return;
    map.removeLayer(historialMediciones[i].linea);
    historialMediciones.splice(i, 1);
    actualizarListaLineas();
    guardarEnLocal();
};

window.borrarPoligono = (id) => {
    const i = historialPoligonos.findIndex((x) => x.id === id);
    if (i === -1) return;
    map.removeLayer(historialPoligonos[i].objeto);
    historialPoligonos[i].marcadores.forEach((m) => map.removeLayer(m));
    historialPoligonos.splice(i, 1);
    actualizarListaPoligonos();
    guardarEnLocal();
};

window.borrarPunto = (id) => {
    const i = historialPuntos.findIndex((x) => x.id === id);
    if (i === -1) return;
    map.removeLayer(historialPuntos[i].m);
    historialPuntos.splice(i, 1);
    actualizarListaPuntos();
    guardarEnLocal();
};

window.borrarTodoElMapa = () => {
    if (!confirm("¿Estas seguro de borrar todas las mediciones y puntos?")) return;
    historialMediciones.forEach((m) => map.removeLayer(m.linea));
    historialPoligonos.forEach((p) => {
        map.removeLayer(p.objeto);
        p.marcadores.forEach((v) => map.removeLayer(v));
    });
    historialPuntos.forEach((p) => map.removeLayer(p.m));
    limpiarMarcadoresTemporales();
    limpiarFotos();
    historialMediciones = [];
    historialPoligonos = [];
    historialPuntos = [];
    puntosTemp = [];
    actualizarListaLineas();
    actualizarListaPoligonos();
    actualizarListaPuntos();
    guardarEnLocal();
};

window.borrarFoto = (id) => {
    borrarFotoPorId(id);
};

// =========================================================
// 6. EXPORTACION
// =========================================================
function escaparXml(texto) {
    return String(texto)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function convertirPoligonosAKML() {
    const placemarks = historialPoligonos.map((p) => {
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

function exportarPoligonosKML() {
    if (historialPoligonos.length === 0) {
        alert("No hay poligonos para exportar.");
        return;
    }

    const contenido = convertirPoligonosAKML();
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

// =========================================================
// 7. PERSISTENCIA
// =========================================================
function guardarEnLocal() {
    const datos = {
        mediciones: historialMediciones.map((m) => ({
            id: m.id,
            nombre: m.nombre,
            distancia: m.distancia,
            coords: m.linea.getLatLngs()
        })),
        poligonos: historialPoligonos.map((p) => ({
            id: p.id,
            nombre: p.nombre,
            coords: p.objeto.getLatLngs()[0]
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
            alt: f.alt
        })),
        ultimasCoordsReales
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(datos));
}

function cargarDesdeLocal() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    let datos;
    try {
        datos = JSON.parse(raw);
    } catch (_e) {
        return;
    }

    if (datos.ultimasCoordsReales) {
        ultimasCoordsReales = datos.ultimasCoordsReales;
    }

    if (Array.isArray(datos.mediciones)) {
        datos.mediciones.forEach((m) => {
            if (!Array.isArray(m.coords) || m.coords.length < 2) return;
            const linea = L.polyline(m.coords, { color: "#3498db", weight: 3 }).addTo(map);
            historialMediciones.push({
                id: m.id || Date.now(),
                nombre: m.nombre || "Medida",
                distancia: Number(m.distancia) || map.distance(m.coords[0], m.coords[1]),
                linea
            });
        });
    }

    if (Array.isArray(datos.poligonos)) {
        datos.poligonos.forEach((p) => {
            if (!Array.isArray(p.coords) || p.coords.length < 3) return;
            const poli = L.polygon(p.coords, { color: "#2ecc71", fillOpacity: 0.3 }).addTo(map);
            const id = p.id || Date.now();
            const vertices = [];
            p.coords.forEach((ll) => {
                const v = L.marker(ll, { draggable: true, icon: L.divIcon({ className: "vertice-poligono", iconSize: [10, 10] }) }).addTo(map);
                v.on("drag", () => {
                    poli.setLatLngs(vertices.map((marker) => marker.getLatLng()));
                    actualizarInfoPoligono(id);
                    guardarEnLocal();
                });
                vertices.push(v);
            });
            historialPoligonos.push({ id, objeto: poli, marcadores: vertices, nombre: p.nombre || "Area", areaTxt: "" });
            actualizarInfoPoligono(id);
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
            agregarFotoHistorial({
                id: f.id || Date.now(),
                nombre: f.nombre || "Foto",
                lat: f.lat,
                lon: f.lon,
                fecha: f.fecha || new Date().toISOString(),
                pitch: typeof f.pitch === "number" ? f.pitch : null,
                yaw: typeof f.yaw === "number" ? f.yaw : null,
                alt: typeof f.alt === "number" ? f.alt : null
            });
        });
    }

    actualizarListaLineas();
    actualizarListaPoligonos();
    actualizarListaPuntos();
    actualizarListaFotos();
}

// =========================================================
// 8. INICIALIZACION
// =========================================================
window.onload = function onLoad() {
    if (window.L && L.GeometryUtil) {
        console.log("Geometria cargada.");
    }
    document.getElementById("btn-localizar").onclick = localizarUsuario;
    document.getElementById("btn-borrar-todo").onclick = window.borrarTodoElMapa;
    document.getElementById("btn-exportar-kml").onclick = exportarPoligonosKML;
    bindInstalacionApp();
    addCompassControl();
    bindFotoDrone();
    bindProyeccion();
    bindClima();
    bindHerramientas();
    initMobileBottomSheet();
    cargarDesdeLocal();
};