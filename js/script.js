// =========================================================
// 1. VARIABLES GLOBALES Y MAPA
// =========================================================
let ultimasCoordsReales = { lat: 0, lon: 0 };
let modoMedicion = false, modoPoligono = false, modoMarcadoManual = false;
let puntosTemp = [], marcadoresTemp = [];
let historialMediciones = [], historialPoligonos = [], historialPuntos = [];
const WEATHER_API_KEY = window.GEOVISION_WEATHER_API_KEY || "ee2057b73b750d1fae6127e3ce2d091d";

const googleHybrid = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 21, subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const map = L.map('map', {
    center: [-26.837, -65.203], zoom: 15, layers: [googleHybrid], doubleClickZoom: false
});

const droneIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/252/252025.png',
    iconSize: [45, 45], iconAnchor: [22, 22]
});

const iconoMira = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/252/252025.png',
    iconSize: [40, 40], iconAnchor: [20, 20]
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

function racionalANumero(v) {
    if (typeof v === "number") return v;
    if (v && typeof v === "object" && "numerator" in v && "denominator" in v) {
        const den = Number(v.denominator) || 1;
        return Number(v.numerator) / den;
    }
    return Number(v);
}

function dmsADecimal(dms, ref) {
    if (!Array.isArray(dms) || dms.length < 3) return null;
    const g = racionalANumero(dms[0]);
    const m = racionalANumero(dms[1]);
    const s = racionalANumero(dms[2]);
    if (![g, m, s].every(Number.isFinite)) return null;
    let decimal = g + m / 60 + s / 3600;
    if (ref === "S" || ref === "W") decimal *= -1;
    return decimal;
}

function normalizarGrados(grados) {
    if (!Number.isFinite(grados)) return null;
    return ((grados % 360) + 360) % 360;
}

function actualizarEstadoImportacion(tipo, detalle) {
    const estadoDiv = document.getElementById('estado-importacion');
    if (!estadoDiv) return;
    const estilos = {
        waiting: { bg: '#2c3e50', fg: '#ecf0f1', label: 'Esperando foto' },
        error: { bg: '#5c1f1f', fg: '#f8d7da', label: 'Error de importación' },
        gps: { bg: '#1f4b99', fg: '#d6e8ff', label: 'GPS detectado' },
        partial: { bg: '#6b4e16', fg: '#fce8b2', label: 'XMP parcial' },
        ok: { bg: '#1f5d3a', fg: '#d4f5e2', label: 'XMP completo' }
    };
    const estilo = estilos[tipo] || estilos.waiting;
    estadoDiv.style.background = estilo.bg;
    estadoDiv.style.color = estilo.fg;
    estadoDiv.innerHTML = `Estado: <strong>${estilo.label}</strong>${detalle ? `<br><small>${detalle}</small>` : ''}`;
}

function proyectar(lat, lon, dist, rumbo) {
    const R = 6371000, r = (rumbo * Math.PI) / 180, la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180, d = dist / R;
    const nLa = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(r));
    const nLo = lo + Math.atan2(Math.sin(r) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(nLa));
    return { lat: (nLa * 180) / Math.PI, lon: (nLo * 180) / Math.PI };
}

// =========================================================
// 3. TELEMETRÍA Y CARGA DE FOTO
// =========================================================

window.onload = function () {
    console.log("🚀 GeoVision Iniciado");
    if (typeof cargarDesdeLocal === "function") {
        cargarDesdeLocal();
    }

    const inputDrone = document.getElementById('input-drone');
    const btnSubir = document.getElementById('btn-subir-foto');

    if (btnSubir && inputDrone) {
        btnSubir.onclick = () => inputDrone.click();

        inputDrone.onchange = function () {
            const file = this.files[0];
            if (!file) return;
            const fotoURL = URL.createObjectURL(file);
            actualizarEstadoImportacion('waiting', `Procesando ${file.name}...`);

            EXIF.getData(file, function () {
                let lat = EXIF.getTag(this, "GPSLatitude"), lon = EXIF.getTag(this, "GPSLongitude");
                if (!lat || !lon) {
                    actualizarEstadoImportacion('error', 'La foto no tiene coordenadas GPS completas');
                    URL.revokeObjectURL(fotoURL);
                    return alert("La foto no tiene coordenadas GPS completas");
                }

                const rLat = dmsADecimal(lat, EXIF.getTag(this, "GPSLatitudeRef"));
                const rLon = dmsADecimal(lon, EXIF.getTag(this, "GPSLongitudeRef"));
                if (!Number.isFinite(rLat) || !Number.isFinite(rLon)) {
                    actualizarEstadoImportacion('error', 'No se pudieron convertir coordenadas GPS');
                    URL.revokeObjectURL(fotoURL);
                    return alert("No se pudieron convertir las coordenadas GPS de la foto");
                }

                ultimasCoordsReales = { lat: rLat, lon: rLon };
                actualizarEstadoImportacion('gps', 'GPS EXIF leído correctamente');

                const reader = new FileReader();
                reader.onload = function (e) {
                    const buffer = e.target.result;
                    // Decodificador universal
                    const decoder = new TextDecoder("utf-8");
                    const txt = decoder.decode(new Uint8Array(buffer));

                    // --- BUSCADOR ATÓMICO MEJORADO ---
                    const buscar = (prop) => {
                        // Esta regex busca la propiedad y captura el número ignorando comillas, etiquetas o espacios
                        const r = new RegExp(prop + '[\\s"=:> ]+([+-]?\\d+\\.?\\d*)', 'i');
                        const m = txt.match(r);
                        if (m) {
                            console.log("📍 " + prop + " detectado:", m[1]);
                            return m[1];
                        }
                        return null;
                    };

                    const pitchRaw = buscar('GimbalPitchDegree') || buscar('drone-dji:GimbalPitchDegree');
                    const yawRaw = buscar('FlightYawDegree') || buscar('GimbalYawDegree') || buscar('drone-dji:FlightYawDegree') || buscar('drone-dji:GimbalYawDegree');
                    const altRaw = buscar('RelativeAltitude') || buscar('AbsoluteAltitude') || buscar('drone-dji:RelativeAltitude') || buscar('drone-dji:AbsoluteAltitude');

                    const pitch = parseFloat(pitchRaw);
                    const yaw = parseFloat(yawRaw);
                    const alt = parseFloat(altRaw);
                    const camposDetectados = [pitch, yaw, alt].filter(Number.isFinite).length;

                    if (Number.isFinite(pitch)) document.getElementById('gimbal-pitch').value = Math.abs(pitch).toFixed(0);
                    if (Number.isFinite(yaw)) {
                        const heading = normalizarGrados(yaw);
                        document.getElementById('drone-heading').value = heading.toFixed(0);
                    }
                    if (Number.isFinite(alt)) document.getElementById('manual-alt').value = Math.abs(alt).toFixed(0);

                    document.getElementById('telemetria-drone').innerHTML = `
                        <strong>Foto:</strong> ${file.name}<br>
                        ${decimalADMS(rLat, true)} | ${decimalADMS(rLon, false)}<br>
                        <small>Pitch: ${Number.isFinite(pitch) ? Math.abs(pitch).toFixed(1) + "°" : "N/D"} | 
                        Yaw: ${Number.isFinite(yaw) ? normalizarGrados(yaw).toFixed(1) + "°" : "N/D"} | 
                        Alt: ${Number.isFinite(alt) ? Math.abs(alt).toFixed(1) + " m" : "N/D"}</small>
                    `;
                    if (camposDetectados === 3) {
                        actualizarEstadoImportacion('ok', 'Se detectaron Pitch, Yaw y Altitud');
                    } else if (camposDetectados > 0) {
                        actualizarEstadoImportacion('partial', `Campos detectados: ${camposDetectados}/3`);
                    } else {
                        actualizarEstadoImportacion('gps', 'No se encontró XMP de gimbal en esta imagen');
                    }
                    if (document.getElementById('btn-clima')) document.getElementById('btn-clima').style.display = 'block';

                    L.marker([rLat, rLon], { icon: droneIcon }).addTo(map).bindPopup(`<img src="${fotoURL}" width="150">`).openPopup();
                    map.flyTo([rLat, rLon], 19);
                    setTimeout(() => URL.revokeObjectURL(fotoURL), 10000);
                };
                // Leemos 1 MB para cubrir todo el encabezado posible
                reader.readAsArrayBuffer(file.slice(0, 1000000));
            });
        };
    }
};

// Botón Localizar
document.getElementById('btn-localizar').onclick = () => {
    navigator.geolocation.getCurrentPosition(p => {
        const { latitude: lat, longitude: lon, accuracy: acc } = p.coords;
        map.flyTo([lat, lon], 18);
        document.getElementById('info-coords').innerHTML = `<strong>Mi Ubicación:</strong><br>${decimalADMS(lat, true)}<br>${decimalADMS(lon, false)}<br><small>Precisión: +/- ${acc.toFixed(0)}m</small>`;
        L.circleMarker([lat, lon], { radius: 8, color: '#fff', fillColor: '#0078d4', fillOpacity: 0.8 }).addTo(map);
    });
};

// =========================================================
// 4. CLIMA Y CÁLCULOS
// =========================================================

if (document.getElementById('btn-clima')) {
    document.getElementById('btn-clima').onclick = async () => {
        if (!ultimasCoordsReales.lat) return;
        const infoDiv = document.getElementById('info-clima');
        infoDiv.innerText = "Consultando...";
        try {
            const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${ultimasCoordsReales.lat}&lon=${ultimasCoordsReales.lon}&appid=${WEATHER_API_KEY}&units=metric&lang=es`);
            const data = await resp.json();
            infoDiv.innerHTML = `<div style="background: #2c3e50; padding: 10px; border-radius: 5px; border-left: 4px solid #3498db; margin-top:10px;">🌡️ ${data.main.temp.toFixed(1)}°C | 💨 ${(data.wind.speed * 3.6).toFixed(1)} km/h</div>`;
        } catch (err) { infoDiv.innerText = "Error clima."; }
    };
}

if (document.getElementById('btn-clima-actual')) {
    document.getElementById('btn-clima-actual').onclick = () => {
        navigator.geolocation.getCurrentPosition(async (p) => {
            const infoDiv = document.getElementById('info-clima-actual');
            try {
                const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${p.coords.latitude}&lon=${p.coords.longitude}&appid=${WEATHER_API_KEY}&units=metric&lang=es`);
                const data = await resp.json();
                infoDiv.innerHTML = `<div style="background: #1c2833; padding: 10px; border-radius: 5px; border-left: 4px solid #2980b9;">${data.main.temp.toFixed(1)}°C | ${(data.wind.speed * 3.6).toFixed(1)} km/h</div>`;
            } catch (e) { infoDiv.innerText = "Error clima."; }
        });
    };
}

document.getElementById('btn-proyectar').onclick = () => {
    if (ultimasCoordsReales.lat === 0) return alert("Sube una foto primero");
    const alt = parseFloat(document.getElementById('manual-alt').value);
    const pitch = Math.abs(parseFloat(document.getElementById('gimbal-pitch').value));
    const head = parseFloat(document.getElementById('drone-heading').value);
    if (![alt, pitch, head].every(Number.isFinite)) {
        return alert("Revisa Altitud, Pitch y Heading: deben ser números válidos");
    }
    if (alt <= 0) return alert("La altitud debe ser mayor a 0");
    if (pitch <= 0 || pitch >= 90) return alert("El pitch debe estar entre 1° y 89°");
    const distH = alt * Math.tan(((90 - pitch) * Math.PI) / 180);
    const obj = proyectar(ultimasCoordsReales.lat, ultimasCoordsReales.lon, distH, head);

    L.marker([obj.lat, obj.lon], { icon: iconoMira })
        .addTo(map)
        .bindPopup("Objetivo proyectado")
        .openPopup();
    map.flyTo([obj.lat, obj.lon], 19);
};