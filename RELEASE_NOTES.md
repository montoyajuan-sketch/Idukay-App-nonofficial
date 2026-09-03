## Novedades

- **Actualizaciones automáticas completas**: la app ahora detecta sola cuando hay una versión nueva en GitHub Releases (al abrir y cada 4 horas), la descarga en segundo plano mostrando una barra de progreso, y la instala:
  - Si instalaste con el Setup (.exe NSIS): descarga silenciosa + diálogo "Reiniciar ahora / Más tarde" (o notificación nativa de Windows si la app está en segundo plano).
  - Si usas la versión **portable**: la app descarga el nuevo `.exe` ella misma y genera un pequeño script temporal que espera a que cierres la app, reemplaza el archivo viejo por el nuevo, lo vuelve a abrir, y se borra solo.
  - Si usas la carpeta **unpacked** (sin instalar): se te avisa con un link directo a la página de descargas, ya que no se puede reemplazar sola.
- **Builds multiplataforma**: ahora se generan automáticamente ejecutables para **Windows** (Setup, Portable, y carpeta Unpacked comprimida), **macOS** (.dmg y .zip, sin firmar) y **Linux** (.AppImage).
- **Nombres de archivo consistentes**: todos los ejecutables siguen el patrón `IdukayApp-version-plataforma[-tipo]`, por ejemplo:
  - `IdukayApp-0.8.0-windows-setup.exe`
  - `IdukayApp-0.8.0-windows-portable.exe`
  - `IdukayApp-0.8.0-windows-unpacked.zip`
  - `IdukayApp-0.8.0-mac.dmg` / `.zip`
  - `IdukayApp-0.8.0-linux.AppImage`
- **Nueva categoría "Actualizaciones" en No Molestar**: se puede elegir si los avisos de nueva versión se muestran o se silencian mientras el No Molestar está activo, igual que correos/descargas/notificaciones.
- **"No Molestar" accesible desde la bandeja del sistema**: antes solo estaba en la barra de menú de arriba (inútil si la ventana estaba minimizada); ahora también está en el menú del ícono de la bandeja.
- **Notas de release personalizadas**: el pipeline de GitHub Actions ahora puede usar un archivo `RELEASE_NOTES.md` opcional con el detalle completo de cada versión, en vez de las notas generadas automáticamente por GitHub.

## Arreglos

- Se bloqueó la **File System Access API** (`showSaveFilePicker`) del sitio para forzar que las descargas de attachments pasen por nuestro sistema de progreso/notificaciones en vez de mostrar el diálogo nativo "Guardar como" del navegador.
- El ícono de la app (bandeja y ventanas) no se estaba incluyendo en el `.exe` empaquetado (faltaba en la lista `files` de `package.json`); ahora sí se empaqueta correctamente.
- Al cancelar una descarga justo cuando ya había terminado, podía tirar un error sin capturar; ahora se maneja con `try/catch`.
- La ventana de "No molestar personalizado" no respondía a ningún click (ni el input, ni el select, ni los botones) cuando se abría con la ventana principal minimizada en la bandeja — era un problema de ventanas modales de Windows atadas a una ventana padre oculta. Ahora la ventana principal se muestra primero automáticamente antes de abrir el modal.
- Se corrigieron permisos del workflow de GitHub Actions (`permissions: contents: write`), que impedían que se publicaran los releases automáticamente.
