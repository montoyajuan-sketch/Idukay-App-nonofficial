# v0.8.2

## Arreglos

- **La app truena al abrirse por primera vez** después de instalar con el Setup, si se instaló en una carpeta protegida (ej. `C:\Program Files\...`) sin permisos de administrador. `ensureDownloadsFolder()` intentaba crear la carpeta de descargas junto al `.exe` sin manejar el error de permisos; ahora si eso falla, cae automáticamente a la carpeta de datos del usuario (siempre escribible, sin importar dónde se instaló la app).
- Se agregó un manejador global de errores no capturados: si algo revienta inesperadamente en el proceso principal, ahora se muestra un diálogo explicando el problema en vez de que la app se cierre en silencio sin ningún aviso.
