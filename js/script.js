// 1. Inicializamos el mapa centrado en el mundo (coordenadas 0,0)
const map = L.map('map').setView([0, 0], 2);

// 2. Cargamos las "piezas" del mapa (OpenStreetMap)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

// 3. Variable para el marcador (para poder moverlo luego)
let marcador;

const btnLocalizar = document.getElementById('btn-localizar');
const infoCoords = document.getElementById('info-coords');

btnLocalizar.addEventListener('click', () => {
    if (navigator.geolocation) {
        infoCoords.innerText = "Localizando...";

        navigator.geolocation.getCurrentPosition((posicion) => {
            const lat = posicion.coords.latitude;
            const lon = posicion.coords.longitude;

            // Actualizamos texto
            infoCoords.innerHTML = `<strong>Lat:</strong> ${lat.toFixed(4)} <br> <strong>Lon:</strong> ${lon.toFixed(4)}`;

            // 4. Movemos el mapa a nuestra ubicación con Zoom 15
            map.setView([lat, lon], 15);

            // 5. Si ya había un marcador, lo quitamos para poner el nuevo
            if (marcador) map.removeLayer(marcador);
            
            marcador = L.marker([lat, lon]).addTo(map)
                .bindPopup("¡Estás aquí!")
                .openPopup();

        });
    }
});