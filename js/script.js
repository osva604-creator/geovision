// =========================================================
// 1. VARIABLES GLOBALES Y MAPA
// =========================================================
let ultimasCoordsReales = { lat: 0, lon: 0 };
let modoMedicion = false, modoPoligono = false, modoMarcadoManual = false;
let puntosTemp = [], marcadoresTemp = [];
let historialMediciones = [], historialPoligonos = [], historialPuntos = [];
let contadorCalculos = 0; // Para el historial de proyecciones

const WEATHER_API_KEY = "ee2057b73b750d1fae6127e3ce2d091d";

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

window.onload = function () {
    if (window.L && L.GeometryUtil) {
        console.log("✅ LIBRERÍA DE GEOMETRÍA CARGADA");
    }
    // LANZAMOS LA CARGA DE DATOS GUARDADOS
    cargarDesdeLocal();
};
// =========================================================
// 2. FUNCIONES DE APOYO (LAS 9 FUNCIONES Y MÁS)
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

function actualizarEstadoImportacion(tipo, detalle) {
    const estadoDiv = document.getElementById('estado-importacion');
    if (!estadoDiv) return;
    const estilos = {
        waiting: { bg: '#2c3e50', fg: '#ecf0f1', label: 'Procesando...' },
        error: { bg: '#5c1f1f', fg: '#f8d7da', label: 'Error' },
        ok: { bg: '#1f5d3a', fg: '#d4f5e2', label: 'XMP OK' }
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
// 3. CARGA DE FOTO (ARREGLADO CON EXIFR)
// =========================================================

const inputDrone = document.getElementById('input-drone');
const btnSubir = document.getElementById('btn-subir-foto');

if (btnSubir && inputDrone) {
    btnSubir.onclick = () => inputDrone.click();

    inputDrone.onchange = async function () {
        const file = this.files[0];
        if (!file) return;

        actualizarEstadoImportacion('waiting', `Analizando ${file.name}...`);

        try {
            // Usamos exifr para leer los metadatos XMP de DJI
            const data = await exifr.parse(file, {
                gps: true,
                xmp: true,
                multiSegment: true
            });

            if (!data || !data.latitude) {
                throw new Error("La foto no tiene GPS");
            }

            ultimasCoordsReales = { lat: data.latitude, lon: data.longitude };

            // Extraer Telemetría
            const pitch = data.GimbalPitchDegree || data.FlightPitchDegree || 0;
            const yaw = data.FlightYawDegree || data.GimbalYawDegree || 0;
            const alt = data.RelativeAltitude || data.AbsoluteAltitude || 0;

            // Actualizar Interfaz
            document.getElementById('gimbal-pitch').value = Math.abs(pitch).toFixed(1);
            document.getElementById('drone-heading').value = normalizarGrados(yaw).toFixed(0);
            document.getElementById('manual-alt').value = Math.abs(alt).toFixed(0);

            document.getElementById('telemetria-drone').innerHTML = `
                <strong>Foto:</strong> ${file.name}<br>
                ${decimalADMS(data.latitude, true)} | ${decimalADMS(data.longitude, false)}
            `;

            const fotoURL = URL.createObjectURL(file);
            L.marker([data.latitude, data.longitude], { icon: droneIcon })
                .addTo(map)
                .bindPopup(`<img src="${fotoURL}" width="150">`)
                .openPopup();

            map.flyTo([data.latitude, data.longitude], 19);
            actualizarEstadoImportacion('ok', 'Telemetría cargada');

        } catch (err) {
            actualizarEstadoImportacion('error', err.message);
            alert("Error: " + err.message);
        }
    };
}

// =========================================================
// 4. CÁLCULO DE OBJETIVO E HISTORIAL (NUEVO)
// =========================================================

document.getElementById('btn-proyectar').onclick = () => {
    if (ultimasCoordsReales.lat === 0) return alert("Sube una foto primero");

    const alt = parseFloat(document.getElementById('manual-alt').value);
    const pitchAbs = Math.abs(parseFloat(document.getElementById('gimbal-pitch').value));
    const head = parseFloat(document.getElementById('drone-heading').value);

    // Trigonometría para distancia horizontal
    let distH = 0;
    if (pitchAbs < 89.5) {
        const anguloRadianes = (Math.abs(90 - pitchAbs) * Math.PI) / 180;
        distH = alt * Math.tan(anguloRadianes);
    }

    const obj = proyectar(ultimasCoordsReales.lat, ultimasCoordsReales.lon, distH, head);

    // Formato DMS
    const latDMS = decimalADMS(obj.lat, true);
    const lonDMS = decimalADMS(obj.lon, false);

    // Marcador en Mapa
    L.marker([obj.lat, obj.lon], { icon: iconoMira })
        .addTo(map)
        .bindPopup(`<strong>🎯 OBJETIVO</strong><br>${latDMS}<br>${lonDMS}`)
        .openPopup();

    // Agregar al Historial del Sidebar
    contadorCalculos++;
    const lista = document.getElementById('lista-puntos');
    const nuevoItem = document.createElement('li');
    nuevoItem.style = "background: #2c3e50; margin-bottom: 8px; padding: 10px; border-radius: 5px; border-left: 4px solid #3498db; list-style:none; color:white;";
    nuevoItem.innerHTML = `
        <div style="font-weight:bold; color:#3498db; margin-bottom:3px;">Cálculo #${contadorCalculos}</div>
        <div style="font-size:0.85em;">📍 ${latDMS}</div>
        <div style="font-size:0.85em;">📍 ${lonDMS}</div>
        <div style="font-size:0.8em; color:#bdc3c7; margin-top:3px;">📏 Dist: ${distH.toFixed(1)}m | 🧭 Rumbo: ${head}°</div>
    `;

    lista.insertBefore(nuevoItem, lista.firstChild);
    map.flyTo([obj.lat, obj.lon], 19);
};

// =========================================================
// 5. LOCALIZACIÓN Y CLIMA
// =========================================================

document.getElementById('btn-localizar').onclick = () => {
    navigator.geolocation.getCurrentPosition(p => {
        const { latitude: lat, longitude: lon } = p.coords;
        map.flyTo([lat, lon], 18);
        L.circleMarker([lat, lon], { radius: 8, color: '#fff', fillColor: '#0078d4', fillOpacity: 0.8 }).addTo(map);
    });
};

document.getElementById('btn-clima-actual').onclick = async () => {
    navigator.geolocation.getCurrentPosition(async (p) => {
        const infoDiv = document.getElementById('info-clima-actual');
        try {
            const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${p.coords.latitude}&lon=${p.coords.longitude}&appid=${WEATHER_API_KEY}&units=metric&lang=es`);
            const data = await resp.json();
            infoDiv.innerHTML = `<div style="background: #1c2833; padding: 10px; border-radius: 5px; border-left: 4px solid #2980b9; margin-top:5px;">🌡️ ${data.main.temp.toFixed(1)}°C | 💨 ${(data.wind.speed * 3.6).toFixed(1)} km/h</div>`;
        } catch (e) { infoDiv.innerText = "Error clima."; }
    });
};

// =========================================================
// 6. ACTUALIZACIÓN DE LISTAS Y ETIQUETAS
// =========================================================
function actualizarListaPuntos() {
    const ui = document.getElementById('lista-puntos'); ui.innerHTML = "";
    historialPuntos.forEach(p => {
        const li = document.createElement('li');
        li.style = "border-bottom:1px solid #444; padding:5px; display:flex; justify-content:space-between; align-items:center;";
        li.innerHTML = `<input type="text" value="${p.nombre}" onchange="cambiarNombrePunto(${p.id}, this.value)" style="background:none; border:1px solid #555; color:#fff; width:110px; font-size:0.8em;">
            <button onclick="borrarPunto(${p.id})" style="background:none; color:red; border:none; cursor:pointer;">🗑️</button>`;
        ui.appendChild(li);
        guardarEnLocal();
    });
}

function actualizarListaLineas() {
    const ui = document.getElementById('lista-medidas'); ui.innerHTML = "";
    historialMediciones.forEach(m => {
        const txt = m.dist > 1000 ? (m.dist / 1000).toFixed(2) + "km" : m.dist.toFixed(1) + "m";
        m.linea.bindTooltip(`<b>${m.nombre}</b><br>${txt}`, { permanent: true, direction: 'center' }).openTooltip();

        const li = document.createElement('li');
        li.style = "border-bottom:1px solid #444; padding:5px; display:flex; justify-content:space-between; align-items:center;";
        li.innerHTML = `<div style="display:flex; flex-direction:column;">
                <input type="text" value="${m.nombre}" onchange="cambiarNombreLinea(${m.id}, this.value)" style="background:none; border:1px solid #555; color:#3498db; width:100px; font-size:0.8em;">
                <small style="color:#aaa;">${txt}</small>
            </div>
            <button onclick="borrarLinea(${m.id})" style="background:none; color:red; border:none; cursor:pointer;">🗑️</button>`;
        ui.appendChild(li);
        guardarEnLocal();
    });
}

function actualizarInfoPoligono(id) {
    const p = historialPoligonos.find(x => x.id === id);
    if (!p) return;

    const ll = p.objeto.getLatLngs()[0];
    let areaTexto = "Calculando...";

    if (L.GeometryUtil && L.GeometryUtil.geodesicArea) {
        const a = L.GeometryUtil.geodesicArea(ll);
        areaTexto = a > 10000 ? (a / 10000).toFixed(2) + " ha" : a.toFixed(1) + " m²";
    }

    p.areaTxt = areaTexto;
    p.objeto.bindTooltip(`<b>${p.nombre}</b><br>${areaTexto}`, {
        permanent: true,
        direction: 'center',
        className: 'etiqueta-area'
    }).openTooltip();

    actualizarListaPoligonos();
}

function actualizarListaPoligonos() {
    const ui = document.getElementById('lista-poligonos');
    if (!ui) return;
    ui.innerHTML = "";
    guardarEnLocal();

    historialPoligonos.forEach(x => {
        ui.innerHTML += `
            <li style="border-bottom:1px solid #444; padding:5px; display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; flex-direction:column;">
                    <input type="text" value="${x.nombre}" onchange="cambiarNombrePoligono(${x.id}, this.value)" 
                           style="background:none; border:1px solid #555; color:#2ecc71; width:100px; font-size:0.8em;">
                    <small style="color:#aaa;">${x.areaTxt || "---"}</small>
                </div>
                <button onclick="borrarPoligono(${x.id})" style="background:none; color:red; border:none; cursor:pointer;">🗑️</button>
            </li>`;
    });
}

// =========================================================
// 7. FUNCIONES GLOBALES DE BORRADO Y NOMBRES
// =========================================================
window.cambiarNombrePunto = (id, n) => {
    const p = historialPuntos.find(x => x.id === id);
    if (p) {
        p.nombre = n;
        p.m.setTooltipContent(n);
        p.m.bindPopup(`<b>${n}</b>`);
    }
};
window.cambiarNombreLinea = (id, n) => {
    const m = historialMediciones.find(x => x.id === id);
    if (m) { m.nombre = n; actualizarListaLineas(); }
};
window.cambiarNombrePoligono = (id, n) => {
    const x = historialPoligonos.find(p => p.id === id);
    if (x) { x.nombre = n; actualizarInfoPoligono(id); }
};

window.borrarLinea = id => {
    const i = historialMediciones.findIndex(x => x.id === id);
    if (i !== -1) { map.removeLayer(historialMediciones[i].linea); historialMediciones.splice(i, 1); actualizarListaLineas(); }
};

window.borrarPoligono = id => {
    const i = historialPoligonos.findIndex(x => x.id === id);
    if (i !== -1) {
        map.removeLayer(historialPoligonos[i].objeto);
        historialPoligonos[i].marcadores.forEach(m => map.removeLayer(m));
        historialPoligonos.splice(i, 1);
        actualizarListaPoligonos();
    }
};

window.borrarPunto = id => {
    const i = historialPuntos.findIndex(x => x.id === id);
    if (i !== -1) { map.removeLayer(historialPuntos[i].m); historialPuntos.splice(i, 1); actualizarListaPuntos(); }
};

window.borrarTodoElMapa = () => {
    if (confirm("¿Estás seguro de que querés borrar todas las mediciones y puntos?")) {
        historialMediciones.forEach(m => map.removeLayer(m.linea));
        historialMediciones = [];
        actualizarListaLineas();

        historialPoligonos.forEach(p => {
            map.removeLayer(p.objeto);
            p.marcadores.forEach(m => map.removeLayer(m));
        });
        historialPoligonos = [];
        actualizarListaPoligonos();

        historialPuntos.forEach(p => map.removeLayer(p.m));
        historialPuntos = [];
        actualizarListaPuntos();

        puntosTemp = [];
        marcadoresTemp.forEach(m => map.removeLayer(m));
        marcadoresTemp = [];

        alert("Mapa limpio.");
    }
};

// =========================================================
// 8. CONEXIÓN FINAL DE EVENTOS
// =========================================================
document.getElementById('btn-borrar-todo').onclick = window.borrarTodoElMapa;
// =========================================================
// 9. FUNCIONES DE GUARDADO EN LOCAL (CORREGIDAS)
// =========================================================
function guardarEnLocal() {
    const datosGeo = {
        // Guardamos las coordenadas de las líneas y su distancia
        mediciones: historialMediciones.map(m => ({
            coords: m.linea.getLatLngs(),
            distancia: m.distancia
        })),
        // Guardamos los puntos de interés
        puntosInteres: historialPuntos.map(p => ({
            id: p.id,
            lat: p.m.getLatLng().lat,
            lng: p.m.getLatLng().lng,
            nota: p.nota
        })),
        // Guardamos los polígonos
        poligonos: historialPoligonos.map(p => ({
            coords: p.objeto.getLatLngs()[0],
            area: p.area,
            id: p.id
        }))
    };
    localStorage.setItem('geovision_data', JSON.stringify(datosGeo));
}
function cargarDesdeLocal() {
    const guardado = localStorage.getItem('geovision_data');
    if (!guardado) return;
    const datos = JSON.parse(guardado);

    // 1. Re-dibujar Líneas
    if (datos.mediciones) {
        datos.mediciones.forEach(m => {
            const linea = L.polyline(m.coords, { color: '#e74c3c', weight: 3 }).addTo(map);
            // Restauramos la etiqueta con coordenadas y distancia
            const latDest = m.coords[1].lat;
            const lonDest = m.coords[1].lng;
            linea.bindTooltip(
                `Distancia: ${m.distancia} m<br>Destino: ${latDest.toFixed(5)}, ${lonDest.toFixed(5)}`,
                { permanent: true, direction: "center", className: "etiqueta-punto" }
            ).openTooltip();
            historialMediciones.push({ linea: linea, distancia: m.distancia });
        });
    }

    // 2. Re-dibujar Puntos
    if (datos.puntosInteres) {
        datos.puntosInteres.forEach(p => {
            agregarMarcadorManual(p.lat, p.lng, p.nota);
        });
    }

    // 3. Re-dibujar Polígonos
    if (datos.poligonos) {
        datos.poligonos.forEach(p => {
            const poly = L.polygon(p.coords, { color: '#27ae60', fillColor: '#2ecc71', fillOpacity: 0.3 }).addTo(map);
            poly.bindTooltip(`Área: ${p.area} m²`, { permanent: true, direction: "center", className: "etiqueta-punto" });
            historialPoligonos.push({ objeto: poly, area: p.area, id: p.id, marcadores: [] });
        });
    }

    actualizarListaLineas();
    actualizarListaPuntos();
    actualizarListaPoligonos();
}