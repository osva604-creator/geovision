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

if (inputDrone) {
    inputDrone.addEventListener('change', function () {
        const file = this.files[0];
        if (file) {
            // Simulamos datos que vendrían en el EXIF de la foto
            const droneLat = -26.8400;
            const droneLon = -65.1600;
            const alturaVuelo = 120;

            telemetria.innerHTML = `
                <strong>Archivo:</strong> ${file.name}<br>
                <strong>Altitud:</strong> ${alturaVuelo}m<br>
                <span style="color: #2ecc71;">✓ Georeferencia detectada</span>
            `;

            // Icono personalizado para el drone
            const droneIcon = L.icon({
                iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684662.png',
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            });

            // Ponemos el marcador del drone en el mapa
            L.marker([droneLat, droneLon], { icon: droneIcon })
                .addTo(map)
                .bindPopup(`<b>Inspección Drone</b><br>Foto: ${file.name}`)
                .openPopup();

            // Hacemos zoom a la zona de la foto
            map.flyTo([droneLat, droneLon], 18);
        }
    });
}