// =========================================================
// 1. VARIABLES GLOBALES Y CONFIGURACIÓN
// =========================================================
// =========================================================
// 1. VARIABLES GLOBALES Y CONFIGURACIÓN (GOOGLE MAPS)
// =========================================================
let ultimasCoordsReales = { lat: 0, lon: 0, alt: 0 };

// Capa de Google Maps "Street" (Calles tradicionales)
const googleStreet = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    maxZoom: 21,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: '&copy; Google Maps'
});

// Capa de Google Maps "Satelital" (Solo imagen)
const googleSat = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    maxZoom: 10,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: '&copy; Google Maps'
});

// Capa de Google Maps "Híbrido" (Satélite + Calles)
const googleHybrid = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 21,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: '&copy; Google Maps'
});

const map = L.map('map', {
    center: [0, 0],
    zoom: 2,
    layers: [googleHybrid] // Arranca con el Híbrido por defecto
});

// Selector de capas
const mapasBase = {
    "Google Calles": googleStreet,
    "Google Satélite": googleSat,
    "Google Híbrido": googleHybrid
};
L.control.layers(mapasBase).addTo(map);

// Elementos del DOM
let marcador;
const btnLocalizar = document.getElementById('btn-localizar');
const infoCoords = document.getElementById('info-coords');
const lista = document.getElementById('lista-puntos');
const btnSubir = document.getElementById('btn-subir-foto');
const inputDrone = document.getElementById('input-drone');
const telemetria = document.getElementById('telemetria-drone');

// ICONOS PERSONALIZADOS
const droneIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/252/252025.png', // Cámara Pro
    iconSize: [45, 45],
    iconAnchor: [22, 22]
});

const iconoMira = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/252/252025.png', // Mira Pro
    iconSize: [40, 40],
    iconAnchor: [20, 20]
});

// =========================================================
// 2. FUNCIONES AYUDANTES
// =========================================================

function decimalADMS(decimal, esLatitud) {
    const absoluto = Math.abs(decimal);
    const grados = Math.floor(absoluto);
    const minutosDecimal = (absoluto - grados) * 60;
    const minutos = Math.floor(minutosDecimal);
    const segundos = ((minutosDecimal - minutos) * 60).toFixed(2);
    let direccion = esLatitud ? (decimal >= 0 ? "N" : "S") : (decimal >= 0 ? "E" : "W");
    return `${grados}° ${minutos}' ${segundos}" ${direccion}`;
}

function proyectarCoordenada(lat, lon, distanciaMetros, rumboGrados) {
    const R = 6371000;
    const rumboRad = (rumboGrados * Math.PI) / 180;
    const latRad = (lat * Math.PI) / 180;
    const lonRad = (lon * Math.PI) / 180;
    const distRelativa = distanciaMetros / R;

    const nuevaLatRad = Math.asin(
        Math.sin(latRad) * Math.cos(distRelativa) +
        Math.cos(latRad) * Math.sin(distRelativa) * Math.cos(rumboRad)
    );
    const nuevaLonRad = lonRad + Math.atan2(
        Math.sin(rumboRad) * Math.sin(distRelativa) * Math.cos(latRad),
        Math.cos(distRelativa) - Math.sin(latRad) * Math.sin(nuevaLatRad)
    );

    return {
        lat: (nuevaLatRad * 180) / Math.PI,
        lon: (nuevaLonRad * 180) / Math.PI
    };
}

// =========================================================
// 3. EVENTOS DE MAPA
// =========================================================
// Localización del usuario REFORZADA
btnLocalizar.addEventListener('click', () => {
    if (navigator.geolocation) {
        infoCoords.innerText = "Buscando señal GPS de alta precisión...";

        // Configuraciones para mejorar la puntería
        const opcionesGPS = {
            enableHighAccuracy: true, // Fuerza el uso de GPS real, no solo IP
            timeout: 10000,           // Espera hasta 10 segundos
            maximumAge: 0             // No uses una ubicación vieja guardada
        };

        navigator.geolocation.getCurrentPosition(
            (posicion) => {
                const lat = posicion.coords.latitude;
                const lon = posicion.coords.longitude;
                const precision = posicion.coords.accuracy; // Precisión en metros

                infoCoords.innerHTML = `
                    <strong>Mi Ubicación:</strong><br>
                    ${decimalADMS(lat, true)}<br>
                    ${decimalADMS(lon, false)}<br>
                    <small style="color: #3498db;">Precisión: +/- ${precision.toFixed(0)}m</small>
                `;

                map.setView([lat, lon], 18); // Zoom bien de cerca

                if (marcador) map.removeLayer(marcador);

                // Marcador azul distintivo para el usuario
                marcador = L.circleMarker([lat, lon], {
                    radius: 8,
                    fillColor: "#3498db",
                    color: "#fff",
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.8
                }).addTo(map).bindPopup("Estás aquí (Aprox.)").openPopup();
            },
            (error) => {
                console.error(error);
                alert("Error: Asegúrate de dar permisos de ubicación en el navegador y tener el GPS activo.");
            },
            opcionesGPS
        );
    } else {
        alert("Tu navegador no soporta geolocalización.");
    }
});

map.on('click', function (e) {
    const clickLat = e.latlng.lat;
    const clickLon = e.latlng.lng;
    L.marker([clickLat, clickLon]).addTo(map)
        .bindPopup(`Punto marcado:<br>${decimalADMS(clickLat, true)}<br>${decimalADMS(clickLon, false)}`).openPopup();
});

if (btnSubir) {
    btnSubir.addEventListener('click', () => inputDrone.click());
}

// =========================================================
// 4. LÓGICA DE DRONE Y EXIF (CON MINIATURA Y AUTO-RELLENO)
// =========================================================
if (inputDrone) {
    inputDrone.addEventListener('change', function () {
        const file = this.files[0];
        if (!file) return;

        // Crear miniatura temporal
        const fotoURL = URL.createObjectURL(file);

        telemetria.innerHTML = `<em>Procesando: ${file.name}...</em>`;

        EXIF.getData(file, function () {
            const latData = EXIF.getTag(this, "GPSLatitude");
            const lonData = EXIF.getTag(this, "GPSLongitude");
            const latRef = EXIF.getTag(this, "GPSLatitudeRef");
            const lonRef = EXIF.getTag(this, "GPSLongitudeRef");

            if (!latData || !lonData) {
                telemetria.innerHTML = `<span style="color: #e74c3c;">✗ Sin GPS en metadatos.</span>`;
                return;
            }

            let realLat = latData[0] + (latData[1] / 60) + (latData[2] / 3600);
            let realLon = lonData[0] + (lonData[1] / 60) + (lonData[2] / 3600);
            if (latRef === 'S') realLat = -realLat;
            if (lonRef === 'W') realLon = -realLon;

            let altRelativa = EXIF.getTag(this, "RelativeAltitude");
            let altGPS = EXIF.getTag(this, "GPSAltitude");
            let altFinal = 0;

            if (altRelativa) {
                altFinal = Math.abs(parseFloat(altRelativa));
            } else if (altGPS) {
                let altBruta = typeof altGPS === 'object' ? (altGPS.numerator / altGPS.denominator) : altGPS;
                altFinal = altBruta > 300 ? altBruta - 480 : altBruta;
            }

            // Escaneo de Pitch y Heading
            const reader = new FileReader();
            reader.onload = function (e) {
                const text = e.target.result;
                const pitchMatch = text.match(/GimbalPitchDegree="([^"]+)"/);
                const yawMatch = text.match(/FlightYawDegree="([^"]+)"/);

                let pitchFinal = pitchMatch ? Math.abs(parseFloat(pitchMatch[1])) : 90;
                let headingFinal = yawMatch ? parseFloat(yawMatch[1]) : 0;
                if (headingFinal < 0) headingFinal += 360;

                // Actualizar UI
                document.getElementById('manual-alt').value = altFinal.toFixed(1);
                document.getElementById('gimbal-pitch').value = pitchFinal.toFixed(1);
                document.getElementById('drone-heading').value = headingFinal.toFixed(1);
                ultimasCoordsReales = { lat: realLat, lon: realLon, alt: altFinal };

                telemetria.innerHTML = `
                    <strong>Archivo:</strong> ${file.name}<br>
                    <strong>Altitud (AGL):</strong> ${altFinal.toFixed(1)}m<br>
                    <strong>Gimbal:</strong> ${pitchFinal.toFixed(1)}° | <strong>Rumbo:</strong> ${headingFinal.toFixed(1)}°
                `;

                L.marker([realLat, realLon], { icon: droneIcon }).addTo(map)
                    .bindPopup(`
                        <div style="text-align:center;">
                            <b>Cámara Drone</b><br>
                            <img src="${fotoURL}" style="width:160px; border-radius:8px; margin-top:5px;"><br>
                            <small>${decimalADMS(realLat, true)}</small>
                        </div>
                    `).openPopup();

                map.flyTo([realLat, realLon], 19);
            };
            reader.readAsText(file.slice(0, 60000));
        });
    });
}

// =========================================================
// 5. CÁLCULO DE MIRA (POPUP PRO CON DMS)
// =========================================================
document.getElementById('btn-proyectar').addEventListener('click', () => {
    const latDrone = ultimasCoordsReales.lat;
    const lonDrone = ultimasCoordsReales.lon;
    const altDrone = parseFloat(document.getElementById('manual-alt').value);
    const pitchInput = Math.abs(document.getElementById('gimbal-pitch').value);
    const heading = parseFloat(document.getElementById('drone-heading').value);

    if (latDrone === 0) {
        alert("Sube una foto primero.");
        return;
    }

    const anguloIncidenciaRad = ((90 - pitchInput) * Math.PI) / 180;
    const distanciaHorizontal = altDrone * Math.tan(anguloIncidenciaRad);
    const objetivo = proyectarCoordenada(latDrone, lonDrone, distanciaHorizontal, heading);

    const latDMS = decimalADMS(objetivo.lat, true);
    const lonDMS = decimalADMS(objetivo.lon, false);

    L.marker([objetivo.lat, objetivo.lon], { icon: iconoMira }).addTo(map)
        .bindPopup(`
            <div style="text-align: center; font-family: sans-serif;">
                <b style="color: #e74c3c; font-size: 1.1em;">🎯 OBJETIVO DETECTADO</b><br>
                <hr style="margin: 5px 0;">
                <table style="width: 100%; font-size: 0.9em; text-align: left;">
                    <tr><td><b>LAT:</b></td><td>${latDMS}</td></tr>
                    <tr><td><b>LON:</b></td><td>${lonDMS}</td></tr>
                    <tr><td><b>DIST:</b></td><td>${distanciaHorizontal.toFixed(1)}m al drone</td></tr>
                </table>
            </div>
        `).openPopup();

    L.polyline([[latDrone, lonDrone], [objetivo.lat, objetivo.lon]], {
        color: 'red', dashArray: '5, 10', weight: 3
    }).addTo(map);

    document.getElementById('resultado-mira').innerHTML = `🎯 Mira fijada a ${distanciaHorizontal.toFixed(1)}m`;
});
// =========================================================
// 6. HERRAMIENTA DE MEDICIÓN (REGLA)
// =========================================================
let modoMedicion = false;
let puntosMedicion = [];
let lineaMedicion = null;
let marcadorMedicion1 = null;
let marcadorMedicion2 = null;

const btnRegla = document.getElementById('btn-regla');
const resRegla = document.getElementById('resultado-regla');

btnRegla.addEventListener('click', () => {
    modoMedicion = !modoMedicion; // Toggle On/Off

    if (modoMedicion) {
        // Activado
        btnRegla.style.backgroundColor = "#e67e22"; // Color naranja de alerta
        btnRegla.innerText = "Modo Medición Activo (Clic en mapa)";
        map.getContainer().style.cursor = 'crosshair'; // Cambiamos el puntero

        // Limpiamos medidas previas
        if (lineaMedicion) map.removeLayer(lineaMedicion);
        if (marcadorMedicion1) map.removeLayer(marcadorMedicion1);
        if (marcadorMedicion2) map.removeLayer(marcadorMedicion2);
        puntosMedicion = [];
        resRegla.innerText = "";
    } else {
        // Desactivado
        btnRegla.style.backgroundColor = "#3498db";
        btnRegla.innerText = "Activar Regla (Medir Distancia)";
        map.getContainer().style.cursor = '';
    }
});

// Modificamos el evento de clic del mapa existente o añadimos esta lógica
map.on('click', function (e) {
    if (!modoMedicion) return; // Si la regla no está activa, ignoramos el resto

    puntosMedicion.push(e.latlng);

    // Ponemos un puntito visual donde hizo clic
    const dot = L.circleMarker(e.latlng, { radius: 5, color: '#3498db' }).addTo(map);

    if (puntosMedicion.length === 1) {
        marcadorMedicion1 = dot;
        resRegla.innerText = "Selecciona el segundo punto...";
    }

    if (puntosMedicion.length === 2) {
        marcadorMedicion2 = dot;

        // Calculamos distancia real
        const d = puntosMedicion[0].distanceTo(puntosMedicion[1]);

        // Trazamos la línea
        lineaMedicion = L.polyline(puntosMedicion, {
            color: '#3498db',
            weight: 3,
            dashArray: '5, 10'
        }).addTo(map);

        // Mostramos resultado
        const textoDistancia = d > 1000 ? (d / 1000).toFixed(2) + " km" : d.toFixed(1) + " m";
        resRegla.innerHTML = `📏 Distancia: ${textoDistancia}`;

        // Popup informativo en el centro de la línea
        L.popup()
            .setLatLng(lineaMedicion.getBounds().getCenter())
            .setContent(`<b>Distancia:</b> ${textoDistancia}`)
            .openOn(map);

        // Reseteamos para una nueva medición pero mantenemos el modo activo
        puntosMedicion = [];
        // Desactivamos el modo automáticamente para evitar clics accidentales
        setTimeout(() => btnRegla.click(), 2000);
    }
});