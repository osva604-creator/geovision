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
// 2. FUNCIONES AYUDANTES (Helper Functions)
// =========================================================

// Convierte decimal a Grados, Minutos y Segundos
function decimalADMS(decimal, esLatitud) {
    const absoluto = Math.abs(decimal);
    const grados = Math.floor(absoluto);
    const minutosDecimal = (absoluto - grados) * 60;
    const minutos = Math.floor(minutosDecimal);
    const segundos = ((minutosDecimal - minutos) * 60).toFixed(2);
    let direccion = esLatitud ? (decimal >= 0 ? "N" : "S") : (decimal >= 0 ? "E" : "W");
    return `${grados}° ${minutos}' ${segundos}" ${direccion}`;
}

// Proyecta una coordenada basada en distancia y rumbo
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
// 3. EVENTOS DE USUARIO Y MAPA
// =========================================================

// Localización del usuario
btnLocalizar.addEventListener('click', () => {
    if (navigator.geolocation) {
        infoCoords.innerText = "Localizando...";
        navigator.geolocation.getCurrentPosition((posicion) => {
            const lat = posicion.coords.latitude;
            const lon = posicion.coords.longitude;
            infoCoords.innerHTML = `<strong>Mi Ubicación:</strong><br>${decimalADMS(lat, true)}<br>${decimalADMS(lon, false)}`;
            map.setView([lat, lon], 15);
            if (marcador) map.removeLayer(marcador);
            marcador = L.marker([lat, lon]).addTo(map).bindPopup("¡Estás aquí!").openPopup();
        });
    }
});

// Clic manual en el mapa
map.on('click', function (e) {
    const clickLat = e.latlng.lat;
    const clickLon = e.latlng.lng;
    const dmsLat = decimalADMS(clickLat, true);
    const dmsLon = decimalADMS(clickLon, false);

    L.marker([clickLat, clickLon]).addTo(map)
        .bindPopup(`Punto marcado:<br>${dmsLat}<br>${dmsLon}`).openPopup();

    const nuevoElemento = document.createElement('li');
    nuevoElemento.innerHTML = `📍 ${dmsLat}, ${dmsLon}`;
    lista.appendChild(nuevoElemento);

    infoCoords.innerHTML = `<strong>Punto manual:</strong><br>${dmsLat}<br>${dmsLon}`;
});

// Botón disparador de archivos
if (btnSubir) {
    btnSubir.addEventListener('click', () => inputDrone.click());
}

// =========================================================
// 4. LÓGICA DE DRONE Y EXIF
// =========================================================
if (inputDrone) {
    inputDrone.addEventListener('change', function () {
        const file = this.files[0];
        if (file) {
            telemetria.innerHTML = `<em>Procesando: ${file.name}...</em>`;
            EXIF.getData(file, function () {
                const latData = EXIF.getTag(this, "GPSLatitude");
                const lonData = EXIF.getTag(this, "GPSLongitude");
                const latRef = EXIF.getTag(this, "GPSLatitudeRef");
                const lonRef = EXIF.getTag(this, "GPSLongitudeRef");
                let altRaw = EXIF.getTag(this, "GPSAltitude") || 0;

                if (latData && lonData) {
                    // Conversión a Decimal para el mapa
                    let realLat = latData[0] + (latData[1] / 60) + (latData[2] / 3600);
                    let realLon = lonData[0] + (lonData[1] / 60) + (lonData[2] / 3600);
                    if (latRef === 'S') realLat = -realLat;
                    if (lonRef === 'W') realLon = -realLon;

                    // Cálculo de altitud real
                    let altRelativa = EXIF.getTag(this, "RelativeAltitude");
                    let altGPS = EXIF.getTag(this, "GPSAltitude");

                    // Si existe la relativa (suele venir como "+100.5"), la limpiamos y usamos esa
                    let altFinal = 0;
                    if (altRelativa) {
                        altFinal = Math.abs(parseFloat(altRelativa));
                    } else if (altGPS) {
                        altFinal = typeof altGPS === 'object' ? (altGPS.numerator / altGPS.denominator) : altGPS;
                    }

                    // Actualizamos la variable global y el input
                    ultimasCoordsReales.alt = altFinal;
                    document.getElementById('manual-alt').value = altFinal.toFixed(1);

                    // !!! ACTUALIZACIÓN DE VARIABLE GLOBAL !!!
                    ultimasCoordsReales = { lat: realLat, lon: realLon, alt: altFinal };

                    // Mostrar en panel (DMS)
                    const textoLat = decimalADMS(realLat, true);
                    const textoLon = decimalADMS(realLon, false);

                    telemetria.innerHTML = `
                        <strong>Archivo:</strong> ${file.name}<br>
                        <strong>Lat:</strong> ${textoLat}<br>
                        <strong>Lon:</strong> ${textoLon}<br>
                        <strong>Altitud:</strong> ${altFinal.toFixed(1)}m<br>
                        <span style="color: #2ecc71;">✓ Datos Listos para Mira</span>
                    `;

                    const droneIcon = L.icon({
                        iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684662.png',
                        iconSize: [40, 40],
                        iconAnchor: [20, 20]
                    });

                    L.marker([realLat, realLon], { icon: droneIcon }).addTo(map)
                        .bindPopup(`<b>Drone en:</b><br>${textoLat}`).openPopup();

                    map.flyTo([realLat, realLon], 19);
                } else {
                    telemetria.innerHTML = `<span style="color: #e74c3c;">✗ No hay GPS en esta foto.</span>`;
                }
            });
        }
    });
}

// =========================================================
// 5. CÁLCULO DE MIRA / PROYECCIÓN
// =========================================================// =========================================================
// 5. CÁLCULO DE MIRA / PROYECCIÓN (ACTUALIZADO AGL)
// =========================================================
document.getElementById('btn-proyectar').addEventListener('click', () => {
    const latDrone = ultimasCoordsReales.lat;
    const lonDrone = ultimasCoordsReales.lon;
    
    // 1. IMPORTANTE: Usamos la altura del INPUT (que ahora es AGL/Relativa)
    const altDrone = parseFloat(document.getElementById('manual-alt').value);

    // 2. Leemos Pitch y Heading
    const pitchInput = Math.abs(document.getElementById('gimbal-pitch').value);
    const heading = parseFloat(document.getElementById('drone-heading').value);

    // Validación de seguridad
    if (latDrone === 0) {
        alert("Primero sube una foto con GPS para obtener la posición de origen.");
        return;
    }

    if (pitchInput < 10) {
        alert("Ángulo muy bajo. La mira caería demasiado lejos para ser precisa.");
        return;
    }

    // 3. TRIGONOMETRÍA REAL (Altura al suelo)
    // El ángulo de incidencia es el complemento del pitch
    const anguloIncidenciaRad = ((90 - pitchInput) * Math.PI) / 180;
    const distanciaHorizontal = altDrone * Math.tan(anguloIncidenciaRad);

    // 4. PROYECCIÓN DE LA COORDENADA
    const objetivo = proyectarCoordenada(latDrone, lonDrone, distanciaHorizontal, heading);

    // 5. DIBUJAR EN MAPA
    const iconoMira = L.icon({
        iconUrl: 'https://cdn-icons-png.flaticon.com/512/1665/1665578.png',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    L.marker([objetivo.lat, objetivo.lon], { icon: iconoMira }).addTo(map)
        .bindPopup(`<b>Objetivo AGL</b><br>Distancia: ${distanciaHorizontal.toFixed(1)}m<br>Lat: ${decimalADMS(objetivo.lat, true)}`)
        .openPopup();

    L.polyline([[latDrone, lonDrone], [objetivo.lat, objetivo.lon]], { 
        color: 'red', 
        dashArray: '5, 10',
        weight: 2 
    }).addTo(map);

    document.getElementById('resultado-mira').innerHTML = `🎯 Objetivo a ${distanciaHorizontal.toFixed(1)}m (Calculado sobre H:${altDrone}m)`;
});