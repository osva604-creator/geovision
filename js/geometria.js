/* Leaflet GeometryUtil - Versión Ampliada para GeoVision */
(function (factory) {
    if (typeof define === 'function' && define.amd) { define(['leaflet'], factory); } 
    else if (typeof module !== 'undefined') { module.exports = factory(require('leaflet')); } 
    else { if (typeof window.L === 'undefined') { throw new Error('Leaflet must be loaded first'); } factory(window.L); }
}(function (L) {
    L.GeometryUtil = L.extend(L.GeometryUtil || {}, {
        
        // 1. FUNCIÓN QUE YA TENÍAS: Cálculo de áreas
        geodesicArea: function (latLngs) {
            var pointsCount = latLngs.length, area = 0.0, d2r = Math.PI / 180, p1, p2;
            if (pointsCount > 2) {
                for (var i = 0; i < pointsCount; i++) {
                    p1 = latLngs[i]; p2 = latLngs[(i + 1) % pointsCount];
                    area += ((p2.lng - p1.lng) * d2r) * (2 + Math.sin(p1.lat * d2r) + Math.sin(p2.lat * d2r));
                }
                area = area * 6378137.0 * 6378137.0 / 2.0;
            }
            return Math.abs(area);
        },

        // 2. NUEVA FUNCIÓN: Distancia horizontal (Trigonometría Drone)
        // DJI: 0° es horizonte, -90° es mirando abajo (Nadir)
        calcularDistanciaHorizontal: function (altitud, pitch) {
            const pitchAbs = Math.abs(pitch);
            // Si el drone mira directo abajo, la distancia es 0
            if (pitchAbs >= 89.9) return 0; 
            // Convertimos el ángulo para obtener el cateto adyacente
            const anguloRadianes = (Math.abs(90 - pitchAbs) * Math.PI) / 180;
            return altitud * Math.tan(anguloRadianes);
        },

        // 3. NUEVA FUNCIÓN: Proyectar punto (Haversine)
        proyectarPunto: function (lat, lon, dist, rumbo) {
            const R = 6371000; // Radio de la Tierra
            const r = (rumbo * Math.PI) / 180;
            const la = (lat * Math.PI) / 180;
            const lo = (lon * Math.PI) / 180;
            const d = dist / R;

            const nLa = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(r));
            const nLo = lo + Math.atan2(Math.sin(r) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(nLa));
            
            return { lat: (nLa * 180) / Math.PI, lon: (nLo * 180) / Math.PI };
        }
    });
    return L.GeometryUtil;
}));