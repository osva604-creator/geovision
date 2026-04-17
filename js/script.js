// =========================================================
// 1. INICIALIZACIÓN Y VARIABLES GLOBALES
// =========================================================
let ultimasCoordsReales = { lat: 0, lon: 0 };
let modoMedicion = false, modoPoligono = false, modoMarcadoManual = false;
let puntosTemp = [], marcadoresTemp = [];
let historialMediciones = [], historialPoligonos = [], historialPuntos = [];

// UNIFICAMOS EL ONLOAD (Solo uno para no pisar funciones)
window.onload = function () {
    if (window.L && L.GeometryUtil) {
        console.log("✅ LIBRERÍA DE GEOMETRÍA CARGADA");
    }
    cargarDesdeLocal(); // Restauramos tus datos guardados
};

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

function proyectar(lat, lon, dist, rumbo) {
    const R = 6371000, r = (rumbo * Math.PI) / 180, la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180, d = dist / R;
    const nLa = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(r));
    const nLo = lo + Math.atan2(Math.sin(r) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(nLa));
    return { lat: (nLa * 180) / Math.PI, lon: (nLo * 180) / Math.PI };
}

// =========================================================
// 3. TELEMETRÍA Y GPS
// =========================================================
document.getElementById('btn-localizar').onclick = () => {
    navigator.geolocation.getCurrentPosition(p => {
        const { latitude: lat, longitude: lon, accuracy: acc } = p.coords;
        map.flyTo([lat, lon], 18);
        document.getElementById('info-coords').innerHTML = `<strong>Mi Ubicación:</strong><br>${decimalADMS(lat, true)}<br>${decimalADMS(lon, false)}<br><small>Precisión: +/- ${acc.toFixed(0)}m</small>`;
        L.circleMarker([lat, lon], { radius: 8, color: '#fff', fillColor: '#0078d4', fillOpacity: 0.8 }).addTo(map);
    });
};

const inputDrone = document.getElementById('input-drone');
document.getElementById('btn-subir-foto').onclick = () => inputDrone.click();

inputDrone.onchange = function () {
    const file = this.files[0];
    if (!file) return;
    const fotoURL = URL.createObjectURL(file);

    EXIF.getData(file, function () {
        let lat = EXIF.getTag(this, "GPSLatitude"), lon = EXIF.getTag(this, "GPSLongitude");
        if (!lat) return alert("La foto no tiene GPS");

        let rLat = lat[0] + lat[1] / 60 + lat[2] / 3600;
        let rLon = lon[0] + lon[1] / 60 + lon[2] / 3600;
        if (EXIF.getTag(this, "GPSLatitudeRef") === "S") rLat = -rLat;
        if (EXIF.getTag(this, "GPSLongitudeRef") === "W") rLon = -rLon;

        ultimasCoordsReales = { lat: rLat, lon: rLon };

        const reader = new FileReader();
        reader.onload = function (e) {
            // Convertimos el buffer binario a una cadena de texto de forma segura
            const buffer = e.target.result;
            const view = new Uint8Array(buffer);
            let txt = "";
            for (let i = 0; i < view.length; i++) {
                txt += String.fromCharCode(view[i]);
            }

            // Función de búsqueda ultra-precisa
            const buscarDJI = (etiqueta) => {
                const regex = new RegExp(etiqueta + '="([^"]+)"', 'i');
                const match = txt.match(regex);
                return match ? match[1] : null;
            };

            const pitch = buscarDJI('GimbalPitchDegree') || buscarDJI('drone-dji:GimbalPitchDegree');
            const yaw = buscarDJI('FlightYawDegree') || buscarDJI('drone-dji:FlightYawDegree');
            const alt = buscarDJI('RelativeAltitude') || buscarDJI('drone-dji:RelativeAltitude');

            if (pitch) {
                document.getElementById('gimbal-pitch').value = Math.abs(parseFloat(pitch)).toFixed(0);
                console.log("🎯 Pitch encontrado:", pitch);
            }
            if (yaw) {
                let y = parseFloat(yaw);
                document.getElementById('drone-heading').value = (y < 0 ? y + 360 : y).toFixed(0);
            }
            if (alt) {
                document.getElementById('manual-alt').value = Math.abs(parseFloat(alt)).toFixed(0);
            }

            document.getElementById('telemetria-drone').innerHTML = `<strong>Foto:</strong> ${file.name}<br>${decimalADMS(rLat, true)} | ${decimalADMS(rLon, false)}`;
            if (document.getElementById('btn-clima')) document.getElementById('btn-clima').style.display = 'block';

            L.marker([rLat, rLon], { icon: droneIcon }).addTo(map).bindPopup(`<img src="${fotoURL}" width="150">`).openPopup();
            map.flyTo([rLat, rLon], 19);
        };

        // LEEMOS COMO ARRAY BUFFER (Datos binarios reales)
        // Leemos los primeros 300kb del archivo
        reader.readAsArrayBuffer(file.slice(0, 300000));
    });
};

// --- FUNCIÓN DEL CLIMA ---
if (document.getElementById('btn-clima')) {
    document.getElementById('btn-clima').onclick = async () => {
        if (!ultimasCoordsReales.lat) return;
        const apiKey = "ee2057b73b750d1fae6127e3ce2d091d";
        const lat = ultimasCoordsReales.lat;
        const lon = ultimasCoordsReales.lon;
        const infoDiv = document.getElementById('info-clima');
        infoDiv.innerText = "Consultando satélite meteorológico...";
        try {
            const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=es`);
            const data = await resp.json();
            infoDiv.innerHTML = `
                <div style="background: #2c3e50; padding: 10px; border-radius: 5px; border-left: 4px solid #3498db; margin-top:10px;">
                    <span style="text-transform: capitalize; font-weight: bold; color: #3498db;">${data.weather[0].description}</span><br>
                    🌡️ <b>Temp:</b> ${data.main.temp.toFixed(1)}°C<br>
                    💧 <b>Hum:</b> ${data.main.humidity}% | 💨 <b>Viento:</b> ${(data.wind.speed * 3.6).toFixed(1)} km/h
                </div>
            `;
        } catch (err) { infoDiv.innerText = "Error al obtener clima."; }
    };
}

// =========================================================
// 4. CALCULADOR DE MIRA
// =========================================================
document.getElementById('btn-proyectar').onclick = () => {
    if (ultimasCoordsReales.lat === 0) return alert("Sube una foto primero");
    const alt = parseFloat(document.getElementById('manual-alt').value);
    const pitch = Math.abs(parseFloat(document.getElementById('gimbal-pitch').value));
    const head = parseFloat(document.getElementById('drone-heading').value);
    const distH = alt * Math.tan(((90 - pitch) * Math.PI) / 180);
    const obj = proyectar(ultimasCoordsReales.lat, ultimasCoordsReales.lon, distH, head);

    L.marker([obj.lat, obj.lon], { icon: iconoMira }).addTo(map).bindPopup(`<b>Objetivo</b><br>${distH.toFixed(1)}m`).openPopup();
    L.polyline([[ultimasCoordsReales.lat, ultimasCoordsReales.lon], [obj.lat, obj.lon]], { color: 'red', dashArray: '5,10' }).addTo(map);
    document.getElementById('resultado-mira').innerHTML = `🎯 Objetivo a ${distH.toFixed(1)}m`;
};

// --- CLIMA UBICACIÓN ACTUAL ---
if (document.getElementById('btn-clima-actual')) {
    document.getElementById('btn-clima-actual').onclick = () => {
        navigator.geolocation.getCurrentPosition(async (p) => {
            const lat = p.coords.latitude;
            const lon = p.coords.longitude;
            const apiKey = "ee2057b73b750d1fae6127e3ce2d091d";
            const infoDiv = document.getElementById('info-clima-actual');
            infoDiv.innerText = "Cargando...";
            try {
                const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=es`);
                const data = await resp.json();
                infoDiv.innerHTML = `<div style="background: #1c2833; padding: 10px; border-radius: 5px; border-left: 4px solid #2980b9;">${data.main.temp.toFixed(1)}°C | ${(data.wind.speed * 3.6).toFixed(1)} km/h</div>`;
            } catch (e) { infoDiv.innerText = "Error clima."; }
        });
    };
}

// =========================================================
// 5. HERRAMIENTAS DE DIBUJO Y BORRADO
// =========================================================
document.getElementById('btn-regla').onclick = () => { modoMedicion = !modoMedicion; modoPoligono = false; modoMarcadoManual = false; puntosTemp = []; };
document.getElementById('btn-poligono').onclick = () => { modoPoligono = !modoPoligono; modoMedicion = false; modoMarcadoManual = false; puntosTemp = []; };
document.getElementById('btn-modo-punto').onclick = () => { modoMarcadoManual = !modoMarcadoManual; modoMedicion = false; modoPoligono = false; };
document.getElementById('btn-borrar-todo').onclick = window.borrarTodoElMapa;

map.on('click', e => {
    if (modoMarcadoManual) {
        const id = Date.now();
        const m = L.marker(e.latlng, { icon: droneIcon, draggable: true }).addTo(map);
        m.bindTooltip("Punto " + (historialPuntos.length + 1), { permanent: true, direction: 'top', className: 'etiqueta-punto' }).openTooltip();
        historialPuntos.push({ id, m, nombre: "Punto " + (historialPuntos.length + 1) });
        actualizarListaPuntos();
    } else if (modoMedicion) {
        puntosTemp.push(e.latlng);
        L.circleMarker(e.latlng, { radius: 4 }).addTo(map);
        if (puntosTemp.length === 2) {
            const l = L.polyline(puntosTemp, { color: '#3498db', weight: 3 }).addTo(map);
            historialMediciones.push({ id: Date.now(), linea: l, dist: puntosTemp[0].distanceTo(puntosTemp[1]), nombre: "Medida " + (historialMediciones.length + 1) });
            actualizarListaLineas(); puntosTemp = []; modoMedicion = false;
        }
    } else if (modoPoligono) {
        puntosTemp.push(e.latlng);
        marcadoresTemp.push(L.circleMarker(e.latlng, { radius: 4, color: '#2ecc71' }).addTo(map));
    }
});

map.on('dblclick', () => {
    if (!modoPoligono || puntosTemp.length < 3) return;
    const poli = L.polygon(puntosTemp, { color: '#2ecc71', fillOpacity: 0.3 }).addTo(map);
    historialPoligonos.push({ id: Date.now(), objeto: poli, marcadores: [], nombre: "Área " + (historialPoligonos.length + 1) });
    actualizarInfoPoligono(historialPoligonos[historialPoligonos.length - 1].id);
    puntosTemp = []; marcadoresTemp.forEach(m => map.removeLayer(m)); marcadoresTemp = []; modoPoligono = false;
});

// =========================================================
// 6. GESTIÓN DE DATOS (LOCALSTORAGE)
// =========================================================
function guardarEnLocal() {
    const datos = {
        puntos: historialPuntos.map(p => ({ lat: p.m.getLatLng().lat, lng: p.m.getLatLng().lng, nombre: p.nombre })),
        medidas: historialMediciones.map(m => ({ coords: m.linea.getLatLngs(), dist: m.dist, nombre: m.nombre })),
        poligonos: historialPoligonos.map(p => ({ coords: p.objeto.getLatLngs()[0], nombre: p.nombre }))
    };
    localStorage.setItem('geovision_data', JSON.stringify(datos));
}

function cargarDesdeLocal() {
    const raw = localStorage.getItem('geovision_data');
    if (!raw) return;
    const datos = JSON.parse(raw);
    datos.puntos?.forEach(p => {
        const m = L.marker([p.lat, p.lng], { icon: droneIcon }).addTo(map);
        m.bindTooltip(p.nombre, { permanent: true, className: 'etiqueta-punto' });
        historialPuntos.push({ id: Date.now() + Math.random(), m, nombre: p.nombre });
    });
    actualizarListaPuntos();
}

// =========================================================
// 7. ACTUALIZACIÓN DE LISTAS Y BORRADO
// =========================================================
function actualizarListaPuntos() {
    const ui = document.getElementById('lista-puntos'); if (!ui) return; ui.innerHTML = "";
    historialPuntos.forEach(p => {
        ui.innerHTML += `<li style="display:flex; justify-content:space-between; padding:5px; border-bottom:1px solid #444;">
            <span>${p.nombre}</span>
            <button onclick="borrarPunto(${p.id})" style="color:red; background:none; border:none;">🗑️</button>
        </li>`;
    });
    guardarEnLocal();
}

function actualizarListaLineas() {
    const ui = document.getElementById('lista-medidas'); if (!ui) return; ui.innerHTML = "";
    historialMediciones.forEach(m => {
        ui.innerHTML += `<li style="padding:5px; border-bottom:1px solid #444;">${m.nombre}: ${m.dist.toFixed(1)}m</li>`;
    });
    guardarEnLocal();
}

function actualizarListaPoligonos() {
    const ui = document.getElementById('lista-poligonos'); if (!ui) return; ui.innerHTML = "";
    historialPoligonos.forEach(p => {
        ui.innerHTML += `<li style="padding:5px; border-bottom:1px solid #444;">${p.nombre}</li>`;
    });
    guardarEnLocal();
}

function actualizarInfoPoligono(id) {
    const p = historialPoligonos.find(x => x.id === id);
    if (p && L.GeometryUtil) {
        const a = L.GeometryUtil.geodesicArea(p.objeto.getLatLngs()[0]);
        const txt = a > 10000 ? (a / 10000).toFixed(2) + " ha" : a.toFixed(1) + " m²";
        p.objeto.bindTooltip(`${p.nombre}<br>${txt}`, { permanent: true, direction: 'center' }).openTooltip();
        actualizarListaPoligonos();
    }
}

window.borrarPunto = (id) => {
    const i = historialPuntos.findIndex(p => p.id === id);
    if (i !== -1) { map.removeLayer(historialPuntos[i].m); historialPuntos.splice(i, 1); actualizarListaPuntos(); }
};

window.borrarTodoElMapa = () => {
    if (confirm("¿Borrar todo?")) {
        historialMediciones.forEach(m => map.removeLayer(m.linea)); historialMediciones = [];
        historialPoligonos.forEach(p => { map.removeLayer(p.objeto); p.marcadores.forEach(v => map.removeLayer(v)); }); historialPoligonos = [];
        historialPuntos.forEach(p => map.removeLayer(p.m)); historialPuntos = [];
        actualizarListaLineas(); actualizarListaPoligonos(); actualizarListaPuntos();
        localStorage.removeItem('geovision_data');
    }
};

document.getElementById('btn-borrar-todo').onclick = window.borrarTodoElMapa;