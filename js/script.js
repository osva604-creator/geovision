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
            // 6. Escuchar el clic en cualquier parte del mapa
            map.on('click', function (e) {
                // e.latlng contiene las coordenadas de donde hiciste clic
                const clickLat = e.latlng.lat;
                const clickLon = e.latlng.lng;
                const lista = document.getElementById('lista-puntos');
                const nuevoElemento = document.createElement('li');
                nuevoElemento.innerHTML = `📍 ${clickLat.toFixed(2)}, ${clickLon.toFixed(2)}`;
                lista.appendChild(nuevoElemento);

                // Creamos un marcador nuevo en ese lugar
                const nuevoMarcador = L.marker([clickLat, clickLon]).addTo(map);

                // Le agregamos un pequeño mensaje (Popup)
                nuevoMarcador.bindPopup(`Punto marcado en:<br> ${clickLat.toFixed(4)}, ${clickLon.toFixed(4)}`)
                    .openPopup();

                // Actualizamos el panel lateral para mostrar que interactuamos
                infoCoords.innerHTML = `<strong>Punto manual:</strong><br>Lat: ${clickLat.toFixed(4)}<br>Lon: ${clickLon.toFixed(4)}`;
            });
        });
    }
});