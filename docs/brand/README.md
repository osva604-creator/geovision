# Identidad visual de GeoVision

Los seis diseños se extrajeron individualmente de la lámina entregada por el usuario, conservada en `source/geovision-brand-sheet.jfif`. Los títulos y marcos de la lámina no forman parte de los archivos de uso. No se redibujaron los logotipos.

Los archivos están en el repositorio y en su copia local, dentro de `assets/brand/`. `npm.cmd run build` los copia a `dist/assets/brand/`. La lámina original y esta documentación no se publican en el build.

| Archivo relativo a `assets/brand/` | Tamaño | Uso |
| --- | --- | --- |
| `logos/geovision-logo.png` | 745 × 484 | Acceso y encabezado de la aplicación |
| `icons/geovision-icon-512.png` | 512 × 512 | Ícono principal de instalación PWA |
| `icons/geovision-icon-maskable-512.png` | 512 × 512 | Instalación con recorte adaptable del sistema |
| `icons/geovision-icon-192.png` | 192 × 192 | Instalación PWA en tamaño reducido |
| `icons/geovision-icon-48.png` | 48 × 48 | Marcadores de mapa, aviso de instalación e ícono del navegador |
| `icons/favicon.png` | 32 × 32 | Pestaña del navegador |
| `icons/apple-touch-icon.png` | 180 × 180 | Acceso directo en iOS, derivado del panel de 192 |

Cada versión procede de su panel rotulado, incluso los íconos pequeños. Se mantiene la proporción del dibujo sobre fondo blanco. La variante adaptable conserva su insignia blanca y extiende el verde exterior a un lienzo cuadrado; la insignia ocupa el 70 % del ancho, dentro de la zona segura central. Los PNG provienen de una imagen JPEG: no son originales vectoriales y conservan las limitaciones de esa fuente.

## Paleta

Las variables están centralizadas al inicio de `css/style.css`:

- Verde de marca: `#189958`.
- Azul oscuro de marca: `#152b3b`.
- Verde de botones: `#117744`, más oscuro para el contraste del texto claro.
- Fondo: `#0b1923`; texto principal: `#eef6f2`.
- Acentos: `#79d9aa` y `#a4e8c6`.

Se mantienen rojo para acciones destructivas, ámbar para avisos y azul/verde para distinguir mediciones en el mapa. La bienvenida usa un fondo de la nueva paleta en lugar de la imagen anterior.

## Volver a extraer los archivos

En Windows, con PowerShell y System.Drawing disponibles:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/extract-brand-assets.ps1
npm.cmd run build
```

El script tiene coordenadas específicas para esta lámina. Otra composición requiere revisar los recortes. `sw.js` incluye los siete PNG en la caché pública `v11` para actualizar también las instalaciones existentes.
