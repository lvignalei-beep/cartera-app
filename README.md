# Mi cartera (app)

PWA instalable que muestra la cartera de Ian. Solo contiene código: los datos viven en el repo privado `cartera-datos` y la app los lee con un token de GitHub de solo lectura que se guarda únicamente en el celular.

- `index.html`, `styles.css`, `app.js`: la app (JavaScript puro, sin compilación).
- `sw.js`: service worker; permite abrirla sin conexión con la última copia.
- `manifest.webmanifest` e `icons/`: instalación en pantalla de inicio.

Publicada con GitHub Pages desde la rama `main`.
