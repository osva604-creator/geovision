// 1. DEFINICIÓN DE CAPAS (Sin inicializar el mapa todavía)
const capaCalles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
});

const capaSatelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{y}/{x}/{z}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri'
});

// 2. INICIALIZAMOS EL MAPA (Una sola vez)
const map = L.map('map', {
    center: [0, 0],
    zoom: 2,
    layers: [capaCalles] // Arranca con calles
});

// 3. CONTROL DE CAPAS
const mapasBase = {
    "Mapa de Calles": capaCalles,
    "Vista Satelital": capaSatelite
};
L.control.layers(mapasBase).addTo(map);

// 4. VARIABLES Y ELEMENTOS
let marcador;
const btnLocalizar = document.getElementById('btn-localizar');
const infoCoords = document.getElementById('info-coords');
const lista = document.getElementById('lista-puntos');

// 5. EVENTO PARA MI UBICACIÓN
btnLocalizar.addEventListener('click', () => {
    if (navigator.geolocation) {
        infoCoords.innerText = "Localizando...";

        navigator.geolocation.getCurrentPosition((posicion) => {
            const lat = posicion.coords.latitude;
            const lon = posicion.coords.longitude;

            infoCoords.innerHTML = `<strong>Lat:</strong> ${lat.toFixed(4)} <br> <strong>Lon:</strong> ${lon.toFixed(4)}`;
            map.setView([lat, lon], 15);

            if (marcador) map.removeLayer(marcador);

            marcador = L.marker([lat, lon]).addTo(map)
                .bindPopup("¡Estás aquí!")
                .openPopup();
        });
    }
});

// 6. EVENTO DE CLIC EN EL MAPA (Fuera del botón, para que funcione siempre)
map.on('click', function (e) {
    const clickLat = e.latlng.lat;
    const clickLon = e.latlng.lng;

    // Crear marcador
    const nuevoMarcador = L.marker([clickLat, clickLon]).addTo(map);
    nuevoMarcador.bindPopup(`Punto marcado en:<br> ${clickLat.toFixed(4)}, ${clickLon.toFixed(4)}`).openPopup();

    // Agregar a la lista del historial
    const nuevoElemento = document.createElement('li');
    nuevoElemento.innerHTML = `📍 ${clickLat.toFixed(2)}, ${clickLon.toFixed(2)}`;
    lista.appendChild(nuevoElemento);

    // Actualizar info
    infoCoords.innerHTML = `<strong>Punto manual:</strong><br>Lat: ${clickLat.toFixed(4)}<br>Lon: ${clickLon.toFixed(4)}`;
});
// --- SECCIÓN DE DRONE ---
const btnSubir = document.getElementById('btn-subir-foto');
const inputDrone = document.getElementById('input-drone');
const telemetria = document.getElementById('telemetria-drone');

// Al hacer clic en el botón naranja, activamos el selector de archivos oculto
if (btnSubir) {
    btnSubir.addEventListener('click', () => inputDrone.click());
}

// --- SECCIÓN DE DRONE CON CONVERSIÓN DMS ---
if (inputDrone) {
    inputDrone.addEventListener('change', function () {
        const file = this.files[0];
        if (file) {
            telemetria.innerHTML = `<em>Procesando: ${file.name}...</em>`;

            EXIF.getData(file, function () {
                // 1. Extraemos los datos crudos (en fracciones/arrays)
                const latData = EXIF.getTag(this, "GPSLatitude");
                const lonData = EXIF.getTag(this, "GPSLongitude");
                const latRef = EXIF.getTag(this, "GPSLatitudeRef");
                const lonRef = EXIF.getTag(this, "GPSLongitudeRef");
                let alt = EXIF.getTag(this, "GPSAltitude") || 0;

                if (latData && lonData) {
                    // 2. FORMATEO PARA HUMANOS (DMS: Grados, Minutos, Segundos)
                    // latData[0] son Grados, latData[1] son Minutos, latData[2] son Segundos
                    const textoLat = `${latData[0]}° ${latData[1]}' ${latData[2].toFixed(2)}" ${latRef}`;
                    const textoLon = `${lonData[0]}° ${lonData[1]}' ${lonData[2].toFixed(2)}" ${lonRef}`;

                    // 3. MATEMÁTICA PARA EL MAPA (Decimal)
                    let realLat = latData[0] + (latData[1] / 60) + (latData[2] / 3600);
                    let realLon = lonData[0] + (lonData[1] / 60) + (lonData[2] / 3600);
                    if (latRef === 'S') realLat = -realLat;
                    if (lonRef === 'W') realLon = -realLon;

                    // 4. ACTUALIZAR EL PANEL LATERAL
                    telemetria.innerHTML = `
                        <strong>Archivo:</strong> ${file.name}<br>
                        <strong>Lat:</strong> ${textoLat}<br>
                        <strong>Lon:</strong> ${textoLon}<br>
                        <strong>Altitud:</strong> ${typeof alt === 'object' ? (alt.numerator / alt.denominator).toFixed(1) : alt}m<br>
                        <span style="color: #2ecc71;">✓ EXIF Original Leído</span>
                    `;

                    // 5. MARCADOR Y VUELO
                    const droneIcon = L.icon({
                        iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684662.png',
                        iconSize: [40, 40],
                        iconAnchor: [20, 20]
                    });

                    L.marker([realLat, realLon], { icon: droneIcon })
                        .addTo(map)
                        .bindPopup(`<b>Drone en:</b><br>${textoLat}<br>${textoLon}`)
                        .openPopup();

                    map.flyTo([realLat, realLon], 19);

                } else {
                    telemetria.innerHTML = `<span style="color: #e74c3c;">✗ No hay GPS en esta foto.</span>`;
                }
            });
        }
    });
}
// Función para proyectar una coordenada (Destino a partir de origen, distancia y rumbo)
function proyectarCoordenada(lat, lon, distanciaMetros, rumboGrados) {
    const R = 6371000; // Radio de la Tierra en metros
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

// Evento del botón "Calcular Punto Objetivo"
document.getElementById('btn-proyectar').addEventListener('click', () => {
    // 1. Obtenemos datos del drone (de la última foto o inputs)
    // Para este ejemplo, usaremos las últimas coordenadas reales detectadas
    const latDrone = ultimasCoordsReales.lat;
    const lonDrone = ultimasCoordsReales.lon;
    const altDrone = ultimasCoordsReales.alt;

    const pitch = Math.abs(document.getElementById('gimbal-pitch').value);
    const heading = document.getElementById('drone-heading').value;

    if (!latDrone) {
        alert("Primero sube una foto con GPS");
        return;
    }

    // 2. Trigonometría: Calculamos distancia horizontal al suelo
    // Si pitch es 90 (mirando abajo), distancia es 0.
    // Usamos radianes para Math.tan
    const anguloRad = ((90 - pitch) * Math.PI) / 180;
    const distanciaHorizontal = altDrone * Math.tan(anguloRad);

    // 3. Proyectamos el punto
    const objetivo = proyectarCoordenada(latDrone, lonDrone, distanciaHorizontal, heading);

    // 4. Dibujamos la "Mira" en el mapa
    const iconoMira = L.icon({
        iconUrl: 'https://cdn-icons-png.flaticon.com/512/1665/1665578.png', // Icono de mira
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    L.marker([objetivo.lat, objetivo.lon], { icon: iconoMira })
        .addTo(map)
        .bindPopup(`<b>Objetivo Identificado</b><br>Distancia: ${distanciaHorizontal.toFixed(1)}m`)
        .openPopup();

    // Dibujamos una línea del drone al objetivo para visualizar el "disparo"
    L.polyline([[latDrone, lonDrone], [objetivo.lat, objetivo.lon]], { color: 'red', dashArray: '5, 10' }).addTo(map);

    document.getElementById('resultado-mira').innerHTML = `🎯 Objetivo a ${distanciaHorizontal.toFixed(1)}m de distancia.`;
});