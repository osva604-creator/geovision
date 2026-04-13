// =========================================================
// TEST DE LIBRERÍA
window.onload = function () {
    if (window.L && L.GeometryUtil) {
        console.log("✅ LIBRERÍA DE GEOMETRÍA CARGADA Y LISTA");
    } else {
        console.error("❌ ERROR: La librería de Geometría NO CARGÓ. Revisar ruta del HTML.");
        alert("Atención: El cálculo de áreas no funcionará porque la librería no cargó.");
    }
};
// 1. VARIABLES GLOBALES Y MAPA
// =========================================================
let ultimasCoordsReales = { lat: 0, lon: 0 };
let modoMedicion = false, modoPoligono = false, modoMarcadoManual = false;
let puntosTemp = [], marcadoresTemp = [];
let historialMediciones = [], historialPoligonos = [], historialPuntos = [];

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
            const txt = e.target.result;
            const mP = txt.match(/GimbalPitchDegree="([^"]+)"/), mY = txt.match(/FlightYawDegree="([^"]+)"/), mA = txt.match(/RelativeAltitude="([^"]+)"/);

            if (mP) document.getElementById('gimbal-pitch').value = Math.abs(parseFloat(mP[1])).toFixed(0);
            if (mY) { let y = parseFloat(mY[1]); document.getElementById('drone-heading').value = (y < 0 ? y + 360 : y).toFixed(0); }
            if (mA) document.getElementById('manual-alt').value = Math.abs(parseFloat(mA[1])).toFixed(0);

            document.getElementById('telemetria-drone').innerHTML = `<strong>Foto:</strong> ${file.name}<br>${decimalADMS(rLat, true)} | ${decimalADMS(rLon, false)}`;
            L.marker([rLat, rLon], { icon: droneIcon }).addTo(map).bindPopup(`<img src="${fotoURL}" width="150">`).openPopup();
            map.flyTo([rLat, rLon], 19);
        };
        reader.readAsText(file.slice(0, 60000));
    });
};

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

// =========================================================
// 5. HERRAMIENTAS DE DIBUJO
// =========================================================
document.getElementById('btn-regla').onclick = () => {
    modoMedicion = !modoMedicion; modoPoligono = false; modoMarcadoManual = false;
    puntosTemp = []; document.getElementById('btn-regla').style.backgroundColor = modoMedicion ? "#e67e22" : "#3498db";
};
document.getElementById('btn-poligono').onclick = () => {
    modoPoligono = !modoPoligono; modoMedicion = false; modoMarcadoManual = false;
    puntosTemp = []; document.getElementById('btn-poligono').style.backgroundColor = modoPoligono ? "#e67e22" : "#27ae60";
};
document.getElementById('btn-modo-punto').onclick = () => {
    modoMarcadoManual = !modoMarcadoManual; modoMedicion = false; modoPoligono = false;
    document.getElementById('btn-modo-punto').innerText = modoMarcadoManual ? "📍 Modo Marcador: ACTIVO" : "📍 Modo Marcador: Desactivado";
};

map.on('click', e => {
    if (modoMarcadoManual) {
        const id = Date.now();
        const m = L.marker(e.latlng, { icon: droneIcon, draggable: true }).addTo(map);
        historialPuntos.push({ id, m, nombre: `Punto ${historialPuntos.length + 1}`, lat: e.latlng.lat, lon: e.latlng.lng });
        actualizarListaPuntos();
    } else if (modoMedicion) {
        puntosTemp.push(e.latlng);
        L.circleMarker(e.latlng, { radius: 4 }).addTo(map);
        if (puntosTemp.length === 2) {
            const id = Date.now(), d = puntosTemp[0].distanceTo(puntosTemp[1]);
            const l = L.polyline(puntosTemp, { color: '#3498db', weight: 3 }).addTo(map);
            historialMediciones.push({ id, linea: l, dist: d, nombre: `Medida ${historialMediciones.length + 1}` });
            actualizarListaLineas();
            puntosTemp = []; modoMedicion = false; document.getElementById('btn-regla').style.backgroundColor = "#3498db";
        }
    } else if (modoPoligono) {
        puntosTemp.push(e.latlng);
        marcadoresTemp.push(L.circleMarker(e.latlng, { radius: 4, color: '#2ecc71' }).addTo(map));
    }
});

map.on('dblclick', () => {
    if (!modoPoligono || puntosTemp.length < 3) return;
    const id = Date.now();
    const poli = L.polygon(puntosTemp, { color: '#2ecc71', fillOpacity: 0.3 }).addTo(map);

    const vertices = [];
    puntosTemp.forEach((ll) => {
        let v = L.marker(ll, { draggable: true, icon: L.divIcon({ className: 'vertice-poligono', iconSize: [10, 10] }) }).addTo(map);
        v.on('drag', () => {
            poli.setLatLngs(vertices.map(m => m.getLatLng()));
            actualizarInfoPoligono(id);
        });
        vertices.push(v);
    });

    historialPoligonos.push({ id, objeto: poli, marcadores: vertices, nombre: `Área ${historialPoligonos.length + 1}`, areaTxt: "" });
    actualizarInfoPoligono(id);
    puntosTemp = []; marcadoresTemp = []; modoPoligono = false; document.getElementById('btn-poligono').style.backgroundColor = "#27ae60";
});

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
    });
}

function actualizarInfoPoligono(id) {
    const p = historialPoligonos.find(x => x.id === id);
    if (!p) return;

    const ll = p.objeto.getLatLngs()[0];
    let areaTexto = "Calculando...";

    // Usamos la librería local que creamos recién
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
// 7. FUNCIONES GLOBALES
// =========================================================
window.cambiarNombrePunto = (id, n) => {
    const p = historialPuntos.find(x => x.id === id);
    if (p) { p.nombre = n; p.m.bindPopup(`<b>${n}</b><br>${decimalADMS(p.lat, true)}`); }
};
window.cambiarNombreLinea = (id, n) => {
    const m = historialMediciones.find(x => x.id === id);
    if (m) { m.nombre = n; actualizarListaLineas(); }
};
window.cambiarNombrePoligono = (id, n) => {
    const x = historialPoligonos.find(p => p.id === id);
    if (x) { x.nombre = n; actualizarInfoPoligono(id); }
};

window.borrarLinea = id => { const i = historialMediciones.findIndex(x => x.id === id); if (i !== -1) { map.removeLayer(historialMediciones[i].linea); historialMediciones.splice(i, 1); actualizarListaLineas(); } };
window.borrarPoligono = id => { const i = historialPoligonos.findIndex(x => x.id === id); if (i !== -1) { map.removeLayer(historialPoligonos[i].objeto); historialPoligonos[i].marcadores.forEach(m => map.removeLayer(m)); historialPoligonos.splice(i, 1); const ui = document.getElementById('lista-poligonos'); if (ui) ui.innerHTML = ""; historialPoligonos.forEach(x => actualizarInfoPoligono(x.id)); } };
window.borrarPunto = id => { const i = historialPuntos.findIndex(x => x.id === id); if (i !== -1) { map.removeLayer(historialPuntos[i].m); historialPuntos.splice(i, 1); actualizarListaPuntos(); } };