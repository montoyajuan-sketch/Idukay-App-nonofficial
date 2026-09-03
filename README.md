<p align="center">
  <img src="./assets/logo.png" alt="IdukayApp" width="480">
</p>

<p align="center">
  App de escritorio <strong>no oficial</strong> para acceder a <a href="https://idukay.net">idukay.net</a> desde Windows, macOS y Linux.
</p>

<p align="center">
  <a href="https://github.com/montoyajuan-sketch/Idukay-App-nonofficial/releases/latest">
    <img alt="Última versión" src="https://img.shields.io/github/v/release/montoyajuan-sketch/Idukay-App-nonofficial">
  </a>
  <img alt="Plataformas" src="https://img.shields.io/badge/plataformas-Windows%20%7C%20macOS%20%7C%20Linux-blue">
</p>

---

## Descripción

**IdukayApp** envuelve el portal de Idukay en una app de escritorio propia, para no depender del navegador: descargas de archivos que van directo a una carpeta (sin ventanas emergentes ni diálogos raros), notificaciones nativas del sistema operativo cuando llegan correos, alertas o calificaciones nuevas, y actualizaciones automáticas de la propia app.

> ⚠️ **Aviso**: esta aplicación **no tiene afiliación, patrocinio ni respaldo** por parte de Idukay ni de los colegios que usan la plataforma. Es un proyecto independiente hecho por y para estudiantes/representantes que quieren una mejor experiencia de escritorio.

## Características

### 📥 Descargas inteligentes
- Los archivos adjuntos se descargan directo a una carpeta `downloads`, sin ventanas emergentes ni diálogos de "Guardar como".
- Barra de progreso en tiempo real: velocidad de descarga, tiempo restante, y tamaño transferido.
- Verificación automática del archivo al terminar, con reintento visual si algo falla.
- Si ya existe un archivo con el mismo nombre, se le agrega `(1)`, `(2)`, etc. automáticamente, sin sobreescribir nada.

### 🔔 Notificaciones
- Toasts internos con animación (estilo apilado) cuando la app está en foco.
- Notificaciones nativas de Windows/macOS/Linux cuando la app está en segundo plano.
- Chequeo automático de correos nuevos y alertas de tareas/calificaciones, con notificación combinada si llegan varias cosas a la vez.

### 🌙 No Molestar
- Presets rápidos (5, 10, 15, 30 min, 1h, 2h) o un tiempo personalizado (segundos, minutos, horas o días).
- Control fino por categoría: elige qué tipo de aviso (notificaciones, correos, descargas, actualizaciones) se sigue mostrando o se silencia durante el "No Molestar".
- Accesible tanto desde el menú superior como desde el ícono de la bandeja del sistema.

### 🗂️ Bandeja del sistema
- La app se minimiza a la bandeja en vez de cerrarse al darle a la ❌.
- Inicio automático con Windows (opcional, arranca minimizada).
- Cerrar sesión y limpiar cookies con un click, sin salir de la app.

### 🔄 Actualizaciones automáticas
- Detecta versiones nuevas solas (al abrir la app y cada 4 horas).
- **Instalada con el Setup:** se descarga y se instala sola en segundo plano.
- **Portable:** la propia app descarga el nuevo ejecutable y se reemplaza a sí misma.
- **Carpeta sin empaquetar:** te avisa con un link directo para bajarla a mano.

### 🖥️ Multiplataforma
Builds automáticos para:
- **Windows:** Instalador (Setup), Portable, y carpeta descomprimida (Unpacked).
- **macOS:** `.dmg` y `.zip`.
- **Linux:** `.AppImage`.

## Descargas

Las últimas versiones siempre están disponibles en la sección [**Releases**](https://github.com/montoyajuan-sketch/Idukay-App-nonofficial/releases/latest) de este repositorio.

| Plataforma | Archivo recomendado |
|---|---|
| Windows (con instalación) | `IdukayApp-x.x.x-windows-setup.exe` |
| Windows (sin instalar) | `IdukayApp-x.x.x-windows-portable.exe` |
| macOS | `IdukayApp-x.x.x-mac.dmg` |
| Linux | `IdukayApp-x.x.x-linux.AppImage` |

> En macOS, al no estar firmada ni notarizada (no hay cuenta de Apple Developer detrás de este proyecto), la primera vez que la abras vas a ver una advertencia de Gatekeeper — click derecho → **Abrir** para continuar.

## Desarrollo local

```bash
npm install
npm start
```

## Compilar

```bash
npm run build
```

Genera los ejecutables en la carpeta `dist/`. El repositorio también incluye un workflow de GitHub Actions (`.github/workflows/build.yml`) que compila automáticamente para las 3 plataformas en cada push, y publica un Release completo al subir un tag con formato `v*` (ej. `v0.8`).

## Tecnología

Construida con [Electron](https://www.electronjs.org/), [electron-builder](https://www.electron.build/) para empaquetar, y [electron-updater](https://www.electron.build/auto-update) para las actualizaciones automáticas.

---

<p align="center">
  Hecho por <strong>Juan Pablo Montoya Tomala</strong> — proyecto independiente, no oficial.
</p>
