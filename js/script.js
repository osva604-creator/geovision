// =========================================================
// 1. VARIABLES GLOBALES Y CONFIGURACIÓN
// =========================================================
let ultimasCoordsReales = { lat: 0, lon: 0, alt: 0 };

const capaCalles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19
});

const capaSatelite = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    attribution: '© Google Satellite',
    maxZoom: 21
});

const map = L.map('map', {
    center: [0, 0],
    zoom: 2,
    layers: [capaSatelite]
});

const mapasBase = {
    "Mapa de Calles": capaCalles,
    "Vista Satelital": capaSatelite
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

btnLocalizar.addEventListener('click', () => {
    if (navigator.geolocation) {
        infoCoords.innerText = "Localizando...";
        navigator.geolocation.getCurrentPosition((posicion) => {
            const lat = posicion.coords.latitude;
            const lon = posicion.coords.longitude;
            infoCoords.innerHTML = `<strong>Ubicación:</strong><br>${decimalADMS(lat, true)}<br>${decimalADMS(lon, false)}`;
            map.setView([lat, lon], 17);
            if (marcador) map.removeLayer(marcador);
            marcador = L.marker([lat, lon]).addTo(map).bindPopup("¡Estás aquí!").openPopup();
        });
    }
});

map.on('click', function (e) {
    const clickLat = e.latlng.lat;
    const clickLon = e.latlng.lng;
    L.marker([clickLat, clickLon]).addTo(map)
        .bindPopup(`Punto:<br>${decimalADMS(clickLat, true)}`).openPopup();
});

if (btnSubir) {
    btnSubir.addEventListener('click', () => inputDrone.click());
}

// =========================================================
// 4. LÓGICA DE DRONE Y EXIF (RECONSTRUIDA)
// =========================================================
if (inputDrone) {
    inputDrone.addEventListener('change', function () {
        const file = this.files[0];
        if (!file) return;

        telemetria.innerHTML = `<em>Procesando: ${file.name}...</em>`;

        EXIF.getData(file, function () {
            // A. Coordenadas
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

            // B. Altura (Prioridad Relativa)
            let altRelativa = EXIF.getTag(this, "RelativeAltitude");
            let altGPS = EXIF.getTag(this, "GPSAltitude");
            let altFinal = 0;

            if (altRelativa) {
                altFinal = Math.abs(parseFloat(altRelativa));
            } else if (altGPS) {
                let altBruta = typeof altGPS === 'object' ? (altGPS.numerator / altGPS.denominator) : altGPS;
                altFinal = altBruta > 300 ? altBruta - 480 : altBruta; 
            }

            // C. Escaneo de Pitch y Heading (XMP de DJI)
            const reader = new FileReader();
            reader.onload = function (e) {
                const text = e.target.result;
                const pitchMatch = text.match(/GimbalPitchDegree="([^"]+)"/);
                const yawMatch = text.match(/FlightYawDegree="([^"]+)"/);

                let pitchFinal = pitchMatch ? Math.abs(parseFloat(pitchMatch[1])) : 90;
                let headingFinal = yawMatch ? parseFloat(yawMatch[1]) : 0;
                if (headingFinal < 0) headingFinal += 360;

                // D. Rellenado de UI y Variable Global
                document.getElementById('manual-alt').value = altFinal.toFixed(1);
                document.getElementById('gimbal-pitch').value = pitchFinal.toFixed(1);
                document.getElementById('drone-heading').value = headingFinal.toFixed(1);
                ultimasCoordsReales = { lat: realLat, lon: realLon, alt: altFinal };

                // E. Interfaz y Mapa
                telemetria.innerHTML = `
                    <strong>Archivo:</strong> ${file.name}<br>
                    <strong>Altitud (AGL):</strong> ${altFinal.toFixed(1)}m<br>
                    <strong>Gimbal:</strong> ${pitchFinal.toFixed(1)}° | <strong>Rumbo:</strong> ${headingFinal.toFixed(1)}°
                `;

                const droneIcon = L.icon({
                    iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684662.png',
                    iconSize: [40, 40],
                    iconAnchor: [20, 20]
                });

                L.marker([realLat, realLon], { icon: droneIcon }).addTo(map)
                    .bindPopup(`<b>Drone</b><br>${decimalADMS(realLat, true)}`).openPopup();

                map.flyTo([realLat, realLon], 19);
            };
            reader.readAsText(file.slice(0, 60000));
        });
    });
}

// =========================================================
// 5. CÁLCULO DE MIRA
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

    const iconoMira = L.icon({
        iconUrl: 'https://cdn-icons-png.flaticon.com/512/1665/1665578.png',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    L.marker([objetivo.lat, objetivo.lon], { icon: iconoMira }).addTo(map)
        .bindPopup(`<b>Objetivo</b><br>Distancia: ${distanciaHorizontal.toFixed(1)}m`)
        .openPopup();

    L.polyline([[latDrone, lonDrone], [objetivo.lat, objetivo.lon]], {
        color: 'red', dashArray: '5, 10', weight: 2
    }).addTo(map);

    document.getElementById('resultado-mira').innerHTML = `🎯 Objetivo a ${distanciaHorizontal.toFixed(1)}m`;
});