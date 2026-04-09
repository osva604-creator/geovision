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