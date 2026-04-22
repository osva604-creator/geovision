// =========================================================
// 1. VARIABLES GLOBALES Y MAPA
// =========================================================
let ultimasCoordsReales = { lat: 0, lon: 0 };
let modoMedicion = false;
let modoPoligono = false;
let modoMarcadoManual = false;
let puntosTemp = [];
let marcadoresTemp = [];
let historialMediciones = [];
let historialPoligonos = [];
let historialPuntos = [];

const WEATHER_API_KEY = "ee2057b73b750d1fae6127e3ce2d091d";
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
            const data = await exifr.parse(file, { gps: true, xmp: true, multiSegment: true });
            if (!data || typeof data.latitude !== "number" || typeof data.longitude !== "number") {
                throw new Error("La foto no tiene coordenadas GPS.");
            }

            ultimasCoordsReales = { lat: data.latitude, lon: data.longitude };
            const fotoURL = URL.createObjectURL(file);
            const pitch = data.GimbalPitchDegree ?? data.FlightPitchDegree ?? 0;
            const yaw = data.FlightYawDegree ?? data.GimbalYawDegree ?? 0;
            const alt = data.RelativeAltitude ?? data.AbsoluteAltitude ?? 0;

            document.getElementById("gimbal-pitch").value = Math.abs(pitch).toFixed(1);
            document.getElementById("drone-heading").value = normalizarGrados(yaw).toFixed(0);
            document.getElementById("manual-alt").value = Math.abs(alt).toFixed(0);

            document.getElementById("telemetria-drone").innerHTML = `<strong>Foto:</strong> ${file.name}<br>${decimalADMS(data.latitude, true)} | ${decimalADMS(data.longitude, false)}`;

            if (btnClimaVuelo) btnClimaVuelo.style.display = "block";

            L.marker([data.latitude, data.longitude], { icon: droneIcon })
                .addTo(map)
                .bindPopup(
                    `<div style="text-align:center; min-width: 300px;">
                        <h3 style="margin: 0 0 10px 0; color: #3498db; font-size: 16px;">Captura de Vuelo</h3>
                        <img src="${fotoURL}" style="width: 100%; height: auto; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); cursor: zoom-in;" onclick="window.open('${fotoURL}', '_blank')">
                        <p style="font-size: 11px; color: #bdc3c7; margin-top: 8px;">Pulsa para ver imagen completa</p>
                    </div>`,
                    { maxWidth: 360, className: "popup-drone-grande" }
                )
                .openPopup();

            map.flyTo([data.latitude, data.longitude], 19);
            actualizarEstadoImportacion("ok", "Telemetria de vuelo cargada");
        } catch (err) {
            const msg = err && err.message ? err.message : "No se pudo leer metadatos de la foto.";
            actualizarEstadoImportacion("error", msg);
            alert(`Error al procesar la foto: ${msg}`);
        }
    };
}

function bindProyeccion() {
    document.getElementById("btn-proyectar").onclick = () => {
        if (ultimasCoordsReales.lat === 0 && ultimasCoordsReales.lon === 0) {
            alert("Primero debes subir una foto del drone.");
            return;
        }

        const alt = parseFloat(document.getElementById("manual-alt").value);
        const pitchOriginal = parseFloat(document.getElementById("gimbal-pitch").value);
        const head = parseFloat(document.getElementById("drone-heading").value);
        if (Number.isNaN(alt) || Number.isNaN(pitchOriginal) || Number.isNaN(head)) {
            alert("Completa Altitud, Pitch y Heading con numeros validos.");
            return;
        }

        const pitchAbs = Math.abs(pitchOriginal);
        let distH = 0;
        if (pitchAbs < 89.5) {
            const anguloVerticalRad = ((90 - pitchAbs) * Math.PI) / 180;
            distH = alt * Math.tan(anguloVerticalRad);
        }

        const obj = proyectar(ultimasCoordsReales.lat, ultimasCoordsReales.lon, distH, head);

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

        L.polyline(
            [
                [ultimasCoordsReales.lat, ultimasCoordsReales.lon],
                [obj.lat, obj.lon]
            ],
            { color: "#db4a34", weight: 4, dashArray: "5,10", opacity: 1 }
        ).addTo(map);

        document.getElementById("resultado-mira").innerHTML = `Objetivo a ${distH.toFixed(1)} m`;
        map.flyTo([obj.lat, obj.lon], 19);
    };
}

function renderClima(infoDiv, data, color) {
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
                renderClima(infoDiv, data, "#2980b9");
            } catch (_e) {
                infoDiv.innerText = "Error al obtener clima local.";
            }
        }, () => {
            infoDiv.innerText = "No se pudo obtener GPS local.";
        });
    };

    const btnClimaVuelo = document.getElementById("btn-clima");
    if (!btnClimaVuelo) return;
    btnClimaVuelo.onclick = async () => {
        if (!ultimasCoordsReales.lat && !ultimasCoordsReales.lon) return;
        const infoDiv = document.getElementById("info-clima");
        infoDiv.innerText = "Consultando clima del vuelo...";
        try {
            const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${ultimasCoordsReales.lat}&lon=${ultimasCoordsReales.lon}&appid=${WEATHER_API_KEY}&units=metric&lang=es`);
            const data = await resp.json();
            renderClima(infoDiv, data, "#3498db");
        } catch (_e) {
            infoDiv.innerText = "Error al obtener clima del vuelo.";
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
        li.innerHTML = `<input type="text" value="${p.nombre}" onchange="cambiarNombrePunto(${p.id}, this.value)" style="background:none; border:1px solid #555; color:#fff; width:110px; font-size:0.8em;">
            <button onclick="borrarPunto(${p.id})" style="background:none; color:red; border:none; cursor:pointer;">🗑️</button>`;
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
        li.innerHTML = `<div style="display:flex; flex-direction:column;">
                <input type="text" value="${m.nombre}" onchange="cambiarNombreLinea(${m.id}, this.value)" style="background:none; border:1px solid #555; color:#3498db; width:100px; font-size:0.8em;">
                <small style="color:#aaa;">${txt}</small>
            </div>
            <button onclick="borrarLinea(${m.id})" style="background:none; color:red; border:none; cursor:pointer;">🗑️</button>`;
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
        li.innerHTML = `<div style="display:flex; flex-direction:column;">
                <input type="text" value="${x.nombre}" onchange="cambiarNombrePoligono(${x.id}, this.value)" style="background:none; border:1px solid #555; color:#2ecc71; width:100px; font-size:0.8em;">
                <small style="color:#aaa;">${x.areaTxt || "---"}</small>
            </div>
            <button onclick="borrarPoligono(${x.id})" style="background:none; color:red; border:none; cursor:pointer;">🗑️</button>`;
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
        refrescarEstadoHerramientas();
    };

    document.getElementById("btn-poligono").onclick = () => {
        modoPoligono = !modoPoligono;
        modoMedicion = false;
        modoMarcadoManual = false;
        puntosTemp = [];
        marcadoresTemp.forEach((m) => map.removeLayer(m));
        marcadoresTemp = [];
        refrescarEstadoHerramientas();
    };

    document.getElementById("btn-modo-punto").onclick = () => {
        modoMarcadoManual = !modoMarcadoManual;
        modoMedicion = false;
        modoPoligono = false;
        puntosTemp = [];
        refrescarEstadoHerramientas();
    };

    map.on("click", (e) => {
        if (modoMarcadoManual) {
            agregarPuntoManual(e.latlng);
            return;
        }

        if (modoMedicion) {
            puntosTemp.push(e.latlng);
            L.circleMarker(e.latlng, { radius: 4 }).addTo(map);
            if (puntosTemp.length === 2) {
                const distancia = map.distance(puntosTemp[0], puntosTemp[1]);
                const id = Date.now();
                const linea = L.polyline(puntosTemp, { color: "#3498db", weight: 3 }).addTo(map);
                historialMediciones.push({ id, linea, distancia, nombre: `Medida ${historialMediciones.length + 1}` });
                actualizarListaLineas();
                guardarEnLocal();
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
        marcadoresTemp.forEach((m) => map.removeLayer(m));
        marcadoresTemp = [];
        modoPoligono = false;
        refrescarEstadoHerramientas();
    });

    refrescarEstadoHerramientas();
}

function initMobileBottomSheet() {
    const sidebar = document.getElementById("sidebar");
    const handle = document.getElementById("sidebar-handle");
    if (!sidebar || !handle) return;

    const mq = window.matchMedia("(max-width: 768px)");
    const states = ["sheet-collapsed", "sheet-half", "sheet-full"];
    let stateIndex = 0;

    function aplicarEstado(indice) {
        stateIndex = Math.max(0, Math.min(indice, states.length - 1));
        states.forEach((s) => sidebar.classList.remove(s));
        sidebar.classList.add(states[stateIndex]);
    }

    function resetDesktop() {
        states.forEach((s) => sidebar.classList.remove(s));
        sidebar.classList.remove("sheet-dragging");
        sidebar.style.transform = "";
    }

    function activarMobile() {
        aplicarEstado(1);
    }

    function aplicarModoActual() {
        if (mq.matches) activarMobile();
        else resetDesktop();
    }

    handle.onclick = () => {
        if (!mq.matches) return;
        aplicarEstado((stateIndex + 1) % states.length);
    };

    let startY = 0;
    let currentY = 0;
    let dragging = false;

    function onTouchStart(e) {
        if (!mq.matches) return;
        dragging = true;
        startY = e.touches[0].clientY;
        currentY = startY;
        sidebar.classList.add("sheet-dragging");
    }

    function onTouchMove(e) {
        if (!dragging || !mq.matches) return;
        currentY = e.touches[0].clientY;
    }

    function onTouchEnd() {
        if (!dragging || !mq.matches) return;
        dragging = false;
        sidebar.classList.remove("sheet-dragging");
        const deltaY = currentY - startY;
        if (deltaY < -40) {
            aplicarEstado(stateIndex + 1);
        } else if (deltaY > 40) {
            aplicarEstado(stateIndex - 1);
        } else {
            aplicarEstado(stateIndex);
        }
    }

    handle.addEventListener("touchstart", onTouchStart, { passive: true });
    handle.addEventListener("touchmove", onTouchMove, { passive: true });
    handle.addEventListener("touchend", onTouchEnd, { passive: true });

    if (mq.addEventListener) mq.addEventListener("change", aplicarModoActual);
    else mq.addListener(aplicarModoActual);

    aplicarModoActual();
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
    marcadoresTemp.forEach((m) => map.removeLayer(m));
    historialMediciones = [];
    historialPoligonos = [];
    historialPuntos = [];
    marcadoresTemp = [];
    puntosTemp = [];
    actualizarListaLineas();
    actualizarListaPoligonos();
    actualizarListaPuntos();
    guardarEnLocal();
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

    actualizarListaLineas();
    actualizarListaPoligonos();
    actualizarListaPuntos();
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
    bindFotoDrone();
    bindProyeccion();
    bindClima();
    bindHerramientas();
    initMobileBottomSheet();
    cargarDesdeLocal();
};