// 1. Seleccionamos los elementos de la interfaz que queremos usar
const btnLocalizar = document.getElementById('btn-localizar');
const infoCoords = document.getElementById('info-coords');

// 2. Creamos la función que se ejecutará al hacer clic
btnLocalizar.addEventListener('click', () => {
    
    // Verificamos si el navegador soporta geolocalización
    if (navigator.geolocation) {
        infoCoords.innerText = "Buscando satélites...";

        // Pedimos la ubicación actual
        navigator.geolocation.getCurrentPosition((posicion) => {
            const lat = posicion.coords.latitude;
            const lon = posicion.coords.longitude;

            // Mostramos los datos en el panel lateral
            infoCoords.innerHTML = `
                <strong>Latitud:</strong> ${lat.toFixed(4)} <br>
                <strong>Longitud:</strong> ${lon.toFixed(4)}
            `;
            
            console.log("Ubicación encontrada:", lat, lon);
        }, (error) => {
            infoCoords.innerText = "Error: No se pudo obtener la ubicación.";
            console.error(error);
        });

    } else {
        alert("Tu navegador no soporta geolocalización.");
    }
});