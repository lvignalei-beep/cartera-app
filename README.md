# Mi cartera (app)

PWA instalable que muestra la cartera de Ian. Contiene el código y los datos **cifrados** (`datos.enc`, AES-256-GCM). La clave de datos está envuelta en `llave.json` con la clave de ingreso de Ian (PBKDF2-SHA256, 600.000 iteraciones). Sin la clave de ingreso no se puede leer nada. La publicación diaria la hace la tarea programada con `cartera-datos/scripts/cifrar.py`.

- `index.html`, `styles.css`, `app.js`: la app (JavaScript puro, sin compilación).
- `sw.js`: service worker; permite abrirla sin conexión con la última copia.
- `manifest.webmanifest` e `icons/`: instalación en pantalla de inicio.

Publicada con GitHub Pages desde la rama `main`.
