const {
  app,
  BrowserWindow,
  session,
  Menu,
  Tray,
  shell,
  ipcMain,
  Notification,
  screen,
  dialog,
} = require("electron");
const path = require("path");
const fs = require("fs");
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch (err) {
  // electron-updater no instalado (ej. en desarrollo sin "npm install" completo);
  // la app sigue funcionando normal, solo sin autoactualización.
}

let downloadsPath;
let overlayWin = null;
let dndCustomWin = null;
let dndUntil = null; // timestamp (ms) hasta cuándo dura el "No Molestar", o null si está apagado
let tray = null;
let isQuitting = false;
let refreshTrayMenu = () => {};

const AUTO_START_ARGS = ["--hidden"];

function isLaunchedHidden() {
  return process.argv.includes("--hidden");
}

// Qué categorías siguen mostrándose aunque "No Molestar" esté activo.
// true = "Mostrar" (no se bloquea aunque haya No Molestar), false = "No mostrar" (se silencia).
const dndCategorySettings = {
  notificaciones: true, // alertas de tareas/calificaciones/etc.
  correos: true, // mensajes/correos nuevos
  descargas: true, // descargas completadas/fallidas
};

// Ventanas de contenido (las que muestran idukay.net). No incluye el overlay,
// que no debe contar para la lógica de "app en foco" ni de "todas cerradas".
const contentWindows = new Set();

// Descargas en curso, para poder cancelarlas desde la notificación.
const activeDownloads = new Map();
let downloadIdCounter = 0;

// Headers de autenticación de idukay, capturados en vivo de las peticiones
// que la propia página ya hace a su API (no se leen de localStorage ni se
// mandan a ningún servidor externo; solo se reutilizan para preguntarle a
// idukay.net, con la sesión ya logueada, si hay correos nuevos).
const HEADERS_TO_CAPTURE = [
  "authorization",
  "profiletype",
  "selectedstudent",
  "workingprofile",
  "workingschool",
  "workingyear",
  "timezone",
  "clientversion",
  "accept",
];
const capturedApiHeaders = {};
let lastKnownUnreadTotal = 0;
let lastKnownUnreadAlertsCount = 0;

const MAIL_CHECK_INTERVAL_MS = 60 * 1000; // cada 60 segundos

// Detecta cualquier URL de descarga de attachments de idukay
// (con o sin subdominio, con o sin query string, http o https).
function isAttachmentDownloadUrl(url) {
  return /idukay\.net\/colegios\/api\/attachments\//i.test(url);
}

function ensureDownloadsFolder() {
  const basePath = app.isPackaged
    ? path.dirname(app.getPath("exe"))
    : __dirname;
  downloadsPath = path.join(basePath, "downloads");
  if (!fs.existsSync(downloadsPath)) {
    fs.mkdirSync(downloadsPath, { recursive: true });
  }
}

// Si ya existe un archivo con ese nombre en la carpeta, devuelve una ruta
// con "(1)", "(2)", etc. agregado antes de la extensión, como hace Windows.
function getUniqueSavePath(folder, fileName) {
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  let candidate = fileName;
  let counter = 1;

  while (fs.existsSync(path.join(folder, candidate))) {
    candidate = `${baseName} (${counter})${ext}`;
    counter++;
  }

  return path.join(folder, candidate);
}

function isAppFocused() {
  for (const win of contentWindows) {
    if (!win.isDestroyed() && win.isFocused()) return true;
  }
  return false;
}

function isDndActive() {
  return dndUntil != null && Date.now() < dndUntil;
}

function formatDndUntil(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
}

function setDnd(durationMs) {
  dndUntil = Date.now() + durationMs;
  createMenu(); // refresca la etiqueta del menú con la hora hasta la que dura
  refreshTrayMenu();
}

function clearDnd() {
  dndUntil = null;
  createMenu();
  refreshTrayMenu();
}

function openCustomDndWindow() {
  if (dndCustomWin && !dndCustomWin.isDestroyed()) {
    dndCustomWin.focus();
    return;
  }

  const parentWin = [...contentWindows][0];

  // Un modal "hijo" de una ventana oculta (minimizada a la bandeja) no
  // registra bien los clics en Windows. Si la principal estaba oculta,
  // la mostramos primero para que el modal funcione normal.
  if (parentWin && !parentWin.isDestroyed() && !parentWin.isVisible()) {
    parentWin.show();
  }

  dndCustomWin = new BrowserWindow({
    width: 360,
    height: 440,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    parent: parentWin,
    modal: !!parentWin,
    title: "No molestar por...",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "dnd-custom-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dndCustomWin.setMenuBarVisibility(false);
  dndCustomWin.loadFile(path.join(__dirname, "dnd-custom.html"));

  dndCustomWin.on("closed", () => {
    dndCustomWin = null;
  });
}

// Borra las cookies y el almacenamiento local de idukay.net (cierre de
// sesión real), y reinicia el estado de correos/alertas que teníamos
// cacheado, para que la próxima persona que use la app tenga que loguearse.
async function clearIdukaySession() {
  const cookies = await session.defaultSession.cookies.get({ domain: "idukay.net" });
  await Promise.all(
    cookies.map((c) =>
      session.defaultSession.cookies
        .remove(`https://idukay.net${c.path || "/"}`, c.name)
        .catch(() => {})
    )
  );

  await session.defaultSession.clearStorageData({
    origin: "https://idukay.net",
    storages: ["localstorage", "cachestorage", "indexdb", "serviceworkers"],
  });

  for (const key of Object.keys(capturedApiHeaders)) delete capturedApiHeaders[key];
  lastKnownUnreadTotal = 0;
  lastKnownUnreadAlertsCount = 0;
}

async function confirmAndClearSession(mainWin) {
  const { response } = await dialog.showMessageBox(mainWin, {
    type: "warning",
    title: "Cerrar sesión",
    message: "¿Cerrar sesión y borrar las cookies de idukay?",
    detail: "Vas a tener que volver a iniciar sesión la próxima vez.",
    buttons: ["Cancelar", "Cerrar sesión"],
    defaultId: 0,
    cancelId: 0,
  });

  if (response !== 1) return;

  await clearIdukaySession();

  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.show();
    mainWin.focus();
    mainWin.loadURL("https://idukay.net/");
  }
}

function checkForAppUpdates(manual) {
  if (!autoUpdater) {
    if (manual) {
      dialog.showMessageBox({
        type: "info",
        title: "Actualizaciones",
        message: "El módulo de actualizaciones no está instalado en este build.",
      });
    }
    return;
  }

  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox({
        type: "info",
        title: "Actualizaciones",
        message: "Las actualizaciones automáticas solo funcionan en la versión empaquetada, no en desarrollo.",
      });
    }
    return;
  }

  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

function setupAutoUpdates() {
  if (!autoUpdater || !app.isPackaged) return;

  autoUpdater.autoDownload = true;

  autoUpdater.on("update-downloaded", () => {
    dialog
      .showMessageBox({
        type: "info",
        title: "Actualización disponible",
        message: "Se descargó una nueva versión de IdukayApp.",
        detail: "Se instalará al reiniciar la app.",
        buttons: ["Reiniciar ahora", "Más tarde"],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.on("error", (err) => {
    console.error("Error buscando actualizaciones:", err);
  });

  checkForAppUpdates(false);
  // Reintenta cada 4 horas mientras la app siga abierta.
  setInterval(() => checkForAppUpdates(false), 4 * 60 * 60 * 1000);
}

function createTray(mainWin) {
  const trayInstance = new Tray(path.join(__dirname, "build", "icon.ico"));
  trayInstance.setToolTip("IdukayApp");

  const rebuildTrayMenu = () => {
    const openAtLogin = app.getLoginItemSettings().openAtLogin;

    const menu = Menu.buildFromTemplate([
      {
        label: "Abrir IdukayApp",
        click: () => {
          mainWin.show();
          mainWin.focus();
        },
      },
      { type: "separator" },
      {
        label: "Iniciar con Windows (minimizado)",
        type: "checkbox",
        checked: openAtLogin,
        click: (menuItem) => {
          app.setLoginItemSettings({
            openAtLogin: menuItem.checked,
            args: AUTO_START_ARGS,
          });
        },
      },
      { type: "separator" },
      {
        label: "No Molestar por",
        submenu: [
          { label: "5 minutos", click: () => setDnd(5 * 60 * 1000) },
          { label: "10 minutos", click: () => setDnd(10 * 60 * 1000) },
          { label: "15 minutos", click: () => setDnd(15 * 60 * 1000) },
          { label: "30 minutos", click: () => setDnd(30 * 60 * 1000) },
          { label: "1 hora", click: () => setDnd(60 * 60 * 1000) },
          { label: "2 horas", click: () => setDnd(2 * 60 * 60 * 1000) },
          { type: "separator" },
          { label: "Personalizado...", click: () => openCustomDndWindow() },
        ],
      },
      {
        label: isDndActive()
          ? `No Molestar activo hasta las ${formatDndUntil(dndUntil)} (click para desactivar)`
          : "No Molestar: desactivado",
        enabled: isDndActive(),
        click: () => clearDnd(),
      },
      { type: "separator" },
      {
        label: "Cerrar sesión (limpiar cookies)",
        click: () => confirmAndClearSession(mainWin),
      },
      { type: "separator" },
      {
        label: "Buscar actualizaciones",
        click: () => checkForAppUpdates(true),
      },
      { type: "separator" },
      {
        label: "Salir",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);

    trayInstance.setContextMenu(menu);
  };

  rebuildTrayMenu();
  refreshTrayMenu = rebuildTrayMenu;

  trayInstance.on("click", () => {
    if (mainWin.isVisible()) {
      mainWin.hide();
      if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide();
    } else {
      mainWin.show();
      mainWin.focus();
    }
  });

  return trayInstance;
}

function sendOverlayEvent(payload) {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send("download-event", payload);
  }
}

function showNativeCompletedNotification(fileName) {
  if (!Notification.isSupported()) return;
  if (isDndActive() && !dndCategorySettings.descargas) return;
  const notif = new Notification({
    title: "Descarga completada",
    body: `«${fileName}» se descargó en la carpeta Downloads`,
  });
  notif.on("click", () => {
    const win = [...contentWindows][0];
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
    shell.openPath(downloadsPath);
  });
  notif.show();
}

function showNativeFailedNotification(fileName) {
  if (!Notification.isSupported()) return;
  if (isDndActive() && !dndCategorySettings.descargas) return;
  const notif = new Notification({
    title: "Descarga fallida",
    body: `No se pudo completar la descarga de «${fileName}»`,
  });
  notif.show();
}

function showNativeNewMailNotification(count) {
  if (!Notification.isSupported()) return;
  if (isDndActive() && !dndCategorySettings.correos) return;
  const notif = new Notification({
    title: "IdukayApp",
    body: `Tienes ${count} correo${count === 1 ? "" : "s"} nuevo${count === 1 ? "" : "s"}`,
  });
  notif.on("click", () => {
    const win = [...contentWindows][0];
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  notif.show();
}

function showNativeNewAlertsNotification(count, latestTitle) {
  if (!Notification.isSupported()) return;
  if (isDndActive() && !dndCategorySettings.notificaciones) return;
  const notif = new Notification({
    title: "IdukayApp",
    body:
      count === 1 && latestTitle
        ? latestTitle
        : `Tienes ${count} alerta${count === 1 ? "" : "s"} nueva${count === 1 ? "" : "s"}`,
  });
  notif.on("click", () => {
    const win = [...contentWindows][0];
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  notif.show();
}

// Cuando en el mismo ciclo llegaron correos Y alertas nuevas a la vez, se
// combinan en una sola notificación... salvo que una de las dos categorías
// esté silenciada en "No Molestar", en cuyo caso se manda solo la que sí
// está permitida (o ninguna si ambas están bloqueadas).
function showCombinedNotification(mailCount, alertsCount, latestAlertTitle) {
  if (!Notification.isSupported()) return;

  const mailBlocked = isDndActive() && !dndCategorySettings.correos;
  const alertsBlocked = isDndActive() && !dndCategorySettings.notificaciones;

  if (mailBlocked && alertsBlocked) return;
  if (mailBlocked) {
    showNativeNewAlertsNotification(alertsCount, latestAlertTitle);
    return;
  }
  if (alertsBlocked) {
    showNativeNewMailNotification(mailCount);
    return;
  }

  const mailPart = `${mailCount} correo${mailCount === 1 ? "" : "s"} nuevo${mailCount === 1 ? "" : "s"}`;
  const alertsPart = `${alertsCount} alerta${alertsCount === 1 ? "" : "s"} nueva${alertsCount === 1 ? "" : "s"}`;

  const notif = new Notification({
    title: "IdukayApp",
    body: `Tienes ${mailPart} y ${alertsPart}`,
  });
  notif.on("click", () => {
    const win = [...contentWindows][0];
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  notif.show();
}

// Construye los headers + cookies necesarios para llamar a la API de idukay
// reutilizando la sesión ya logueada dentro de la propia app.
async function buildIdukayRequestHeaders() {
  const cookies = await session.defaultSession.cookies.get({ url: "https://idukay.net" });
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  return {
    accept: capturedApiHeaders.accept || "application/json, text/plain, */*",
    authorization: capturedApiHeaders.authorization,
    clientversion: capturedApiHeaders.clientversion || "",
    profiletype: capturedApiHeaders.profiletype || "",
    selectedstudent: capturedApiHeaders.selectedstudent || "",
    timezone: capturedApiHeaders.timezone || "",
    workingprofile: capturedApiHeaders.workingprofile || "",
    workingschool: capturedApiHeaders.workingschool || "",
    workingyear: capturedApiHeaders.workingyear || "",
    cookie: cookieHeader,
  };
}

// Consulta el total de correos/notificaciones nuevas. Devuelve el número
// total, o null si no se pudo consultar (sin lanzar notificación por sí sola).
async function fetchMailTotal() {
  try {
    const headers = await buildIdukayRequestHeaders();
    const response = await fetch(
      `https://idukay.net/colegios/api/new_notifications?t=${Date.now()}`,
      { method: "GET", headers }
    );
    if (!response.ok) return null;

    const data = await response.json();
    const counts = data && data.response ? data.response : null;
    if (!counts) return null;

    return Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
  } catch (err) {
    return null;
  }
}

// Consulta las últimas alertas y cuenta cuántas están sin leer. Devuelve
// { unreadCount, latestTitle } o null si no se pudo consultar.
async function fetchAlertsInfo() {
  try {
    const headers = await buildIdukayRequestHeaders();
    const query =
      "__page=1&__per_page=5&__sort=" +
      encodeURIComponent(JSON.stringify({ date: "desc", _id: "desc" })) +
      "&select=title+read+date+type+reference+student";

    const response = await fetch(`https://idukay.net/colegios/api/alerts?${query}`, {
      method: "GET",
      headers,
    });
    if (!response.ok) return null;

    const data = await response.json();
    const alerts = Array.isArray(data?.response) ? data.response : null;
    if (!alerts) return null;

    const unread = alerts.filter((a) => a.read === false);
    return { unreadCount: unread.length, latestTitle: unread[0]?.title };
  } catch (err) {
    return null;
  }
}

// Revisa correos y alertas nuevas en el mismo ciclo. Si ambos subieron a la
// vez, manda una sola notificación combinada; si solo uno subió, manda la
// suya normal.
async function checkForNewStuff() {
  if (!capturedApiHeaders.authorization) return; // aún no hemos visto ninguna llamada autenticada

  const [mailTotal, alertsInfo] = await Promise.all([fetchMailTotal(), fetchAlertsInfo()]);

  const mailIncreased = mailTotal != null && mailTotal > lastKnownUnreadTotal && mailTotal > 0;
  const alertsIncreased = alertsInfo != null && alertsInfo.unreadCount > lastKnownUnreadAlertsCount;

  if (!isAppFocused()) {
    if (mailIncreased && alertsIncreased) {
      showCombinedNotification(mailTotal, alertsInfo.unreadCount, alertsInfo.latestTitle);
    } else if (mailIncreased) {
      showNativeNewMailNotification(mailTotal);
    } else if (alertsIncreased) {
      showNativeNewAlertsNotification(alertsInfo.unreadCount, alertsInfo.latestTitle);
    }
  }

  if (mailTotal != null) lastKnownUnreadTotal = mailTotal;
  if (alertsInfo != null) lastKnownUnreadAlertsCount = alertsInfo.unreadCount;
}

function positionOverlayWindow(overlay) {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workArea;
  const bounds = overlay.getBounds();
  overlay.setBounds({
    x: display.workArea.x + width - bounds.width - 12,
    y: display.workArea.y + height - bounds.height - 12,
    width: bounds.width,
    height: bounds.height,
  });
}

function createOverlayWindow(parentWin) {
  const overlay = new BrowserWindow({
    width: 360,
    height: 640,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000", // clave para que Windows no pinte un fondo blanco/negro sólido
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    show: false,
    parent: parentWin, // la ata a la ventana principal: no cuenta como ventana aparte en Alt+Tab/taskbar
    webPreferences: {
      preload: path.join(__dirname, "notifications-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.loadFile(path.join(__dirname, "notifications.html"));
  positionOverlayWindow(overlay);

  overlay.once("ready-to-show", () => {
    overlay.showInactive(); // se muestra sin robar el foco de la ventana principal
  });

  // Si cambia la resolución/monitor, reubicar el overlay.
  screen.on("display-metrics-changed", () => positionOverlayWindow(overlay));

  return overlay;
}

function createWindow(url = "https://idukay.net/", { startHidden = false, isMainWindow = false } = {}) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: !startHidden,
    icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  contentWindows.add(win);

  if (isMainWindow) {
    // La ventana principal, en vez de cerrarse de verdad, se minimiza a la
    // bandeja del sistema. Solo se cierra de verdad si isQuitting está en
    // true (se pone en true desde el menú de la bandeja o al cerrar la app).
    win.on("close", (event) => {
      if (!isQuitting) {
        event.preventDefault();
        win.hide();
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.hide();
        }
      }
    });

    win.on("show", () => {
      if (overlayWin && !overlayWin.isDestroyed()) {
        positionOverlayWindow(overlayWin);
        overlayWin.showInactive();
      }
    });
  }

  win.on("closed", () => {
    contentWindows.delete(win);
    // El overlay no cuenta como ventana "real": si ya no queda ninguna
    // ventana de contenido, se cierra la app igual que si no hubiera overlay.
    if (contentWindows.size === 0 && process.platform !== "darwin") {
      app.quit();
    }
  });

  // Cada pestaña nueva (target="_blank", window.open, etc.) se abre
  // como una ventana nueva independiente, en vez de una pestaña.
  // EXCEPCIÓN: los links de descarga de attachments no deben abrir
  // ninguna ventana (ni siquiera about:blank); solo deben disparar la
  // descarga directamente en la ventana actual.
  win.webContents.setWindowOpenHandler(({ url: newUrl }) => {
    if (isAttachmentDownloadUrl(newUrl)) {
      win.webContents.downloadURL(newUrl);
      return { action: "deny" };
    }
    createWindow(newUrl);
    return { action: "deny" }; // evita que Electron intente abrir su propia ventana hija
  });

  // Si la propia ventana intenta navegar hacia un link de attachments
  // (sin pasar por window.open), tampoco debe navegar ni quedarse en
  // blanco: se descarga directamente y se mantiene la página actual.
  win.webContents.on("will-navigate", (event, newUrl) => {
    if (isAttachmentDownloadUrl(newUrl)) {
      event.preventDefault();
      win.webContents.downloadURL(newUrl);
    }
  });

  // Algunos sitios (idukay incluido, aparentemente) usan la File System
  // Access API del navegador (window.showSaveFilePicker) para pedir el
  // diálogo "Guardar como" directo al sistema operativo, sin pasar por el
  // gestor de descargas de Chromium. Eso hace que nuestro "will-download"
  // nunca se entere de nada. La desactivamos en cuanto carga la página para
  // forzar a que el sitio use su alternativa clásica (<a download>), que sí
  // interceptamos arriba.
  win.webContents.on("dom-ready", () => {
    win.webContents
      .executeJavaScript(
        `
        (function () {
          try {
            if ("showSaveFilePicker" in window) {
              delete window.showSaveFilePicker;
            }
            if ("chooseFileSystemEntries" in window) {
              delete window.chooseFileSystemEntries;
            }
          } catch (e) {
            // Si el navegador no permite borrar la propiedad, la anulamos igual.
            try {
              window.showSaveFilePicker = undefined;
              window.chooseFileSystemEntries = undefined;
            } catch (e2) {}
          }
        })();
        `
      )
      .catch(() => {});
  });

  win.loadURL(url);

  return win;
}

function createMenu() {
  const template = [
    {
      label: "Archivo",
      submenu: [
        {
          label: "Abrir carpeta de descargas",
          click: () => {
            shell.openPath(downloadsPath);
          },
        },
        { type: "separator" },
        {
          label: "Nueva ventana",
          click: () => {
            createWindow();
          },
        },
        { type: "separator" },
        {
          label: "Cerrar sesión (limpiar cookies)",
          click: () => confirmAndClearSession(BrowserWindow.getFocusedWindow() || [...contentWindows][0]),
        },
        { type: "separator" },
        { role: "quit", label: "Salir" },
      ],
    },
    {
      label: "Ver",
      submenu: [
        { role: "reload", label: "Recargar" },
        { role: "toggleDevTools", label: "Herramientas de desarrollo" },
        { type: "separator" },
        { role: "resetZoom", label: "Zoom normal" },
        { role: "zoomIn", label: "Acercar" },
        { role: "zoomOut", label: "Alejar" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Pantalla completa" },
      ],
    },
    {
      label: "Notificaciones",
      submenu: [
        {
          label: "No Molestar por",
          submenu: [
            { label: "5 minutos", click: () => setDnd(5 * 60 * 1000) },
            { label: "10 minutos", click: () => setDnd(10 * 60 * 1000) },
            { label: "15 minutos", click: () => setDnd(15 * 60 * 1000) },
            { label: "30 minutos", click: () => setDnd(30 * 60 * 1000) },
            { label: "1 hora", click: () => setDnd(60 * 60 * 1000) },
            { label: "2 horas", click: () => setDnd(2 * 60 * 60 * 1000) },
            { type: "separator" },
            { label: "Personalizado...", click: () => openCustomDndWindow() },
          ],
        },
        {
          label: isDndActive()
            ? `No Molestar activo hasta las ${formatDndUntil(dndUntil)} (click para desactivar)`
            : "No Molestar: desactivado",
          enabled: isDndActive(),
          click: () => clearDnd(),
        },
      ],
    },
    {
      label: "Ayuda",
      submenu: [
        {
          label: "Acerca de IdukayApp",
          click: () => {
            const focusedWin = BrowserWindow.getFocusedWindow();
            dialog.showMessageBox(focusedWin || undefined, {
              type: "info",
              title: "Acerca de IdukayApp",
              message: "IdukayApp",
              detail:
                "Aplicación de escritorio NO OFICIAL para acceder a idukay.net.\n\n" +
                "No tiene afiliación, patrocinio ni respaldo por parte de Idukay " +
                "ni de los colegios que utilizan la plataforma.\n\n" +
                `Desarrollado por Juan Pablo Montoya Tomala.\n` +
                `Versión ${app.getVersion()}`,
              buttons: ["Cerrar"],
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  ensureDownloadsFolder();

  createMenu();
  const mainWin = createWindow(undefined, {
    startHidden: isLaunchedHidden(),
    isMainWindow: true,
  });
  overlayWin = createOverlayWindow(mainWin);
  tray = createTray(mainWin);
  setupAutoUpdates();

  // Capturar en vivo los headers de autenticación que la propia página manda
  // en sus llamadas a la API de idukay, para poder reutilizarlos nosotros.
  session.defaultSession.webRequest.onSendHeaders(
    { urls: ["https://idukay.net/colegios/api/*"] },
    (details) => {
      const headers = details.requestHeaders || {};
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (HEADERS_TO_CAPTURE.includes(lower)) {
          capturedApiHeaders[lower] = headers[key];
        }
      }
    }
  );

  setInterval(checkForNewStuff, MAIL_CHECK_INTERVAL_MS);

  // Configurar que todas las descargas vayan a la subcarpeta "downloads",
  // con seguimiento de progreso en tiempo real y verificación al terminar.
  session.defaultSession.on("will-download", (event, item) => {
    const originalFileName = item.getFilename();
    const savePath = getUniqueSavePath(downloadsPath, originalFileName);
    const fileName = path.basename(savePath); // puede llevar "(1)", "(2)", etc.
    item.setSavePath(savePath);

    const id = `dl-${++downloadIdCounter}`;
    activeDownloads.set(id, item);

    const totalBytes = item.getTotalBytes(); // puede ser 0 si el servidor no lo informa
    let lastBytes = 0;
    let lastTime = Date.now();

    sendOverlayEvent({ type: "started", id, fileName, totalBytes });

    item.on("updated", (event, state) => {
      if (state !== "progressing") return;

      const receivedBytes = item.getReceivedBytes();
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      const speed = dt > 0 ? Math.max(0, (receivedBytes - lastBytes) / dt) : 0;
      lastBytes = receivedBytes;
      lastTime = now;

      const remaining = totalBytes > 0 ? totalBytes - receivedBytes : 0;
      const etaSeconds = speed > 0 && totalBytes > 0 ? remaining / speed : null;
      const percent = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : null;

      sendOverlayEvent({
        type: "progress",
        id,
        fileName,
        receivedBytes,
        totalBytes,
        speed,
        etaSeconds,
        percent,
      });
    });

    item.once("done", (event, state) => {
      activeDownloads.delete(id);

      if (state === "cancelled") {
        sendOverlayEvent({ type: "cancelled", id, fileName });
        return;
      }

      if (state !== "completed") {
        // interrumpida por error de red, etc.
        if (isAppFocused()) {
          sendOverlayEvent({ type: "failed", id, fileName });
        } else {
          showNativeFailedNotification(fileName);
        }
        return;
      }

      // Verificación real de que el archivo quedó en disco.
      const exists = fs.existsSync(savePath);

      if (isAppFocused()) {
        sendOverlayEvent({ type: exists ? "completed" : "failed", id, fileName });
      } else if (exists) {
        showNativeCompletedNotification(fileName);
      } else {
        showNativeFailedNotification(fileName);
      }
    });
  });

  ipcMain.on("open-downloads-folder", () => {
    shell.openPath(downloadsPath);
  });

  ipcMain.on("cancel-download", (event, id) => {
    const item = activeDownloads.get(id);
    if (!item) return;
    try {
      item.cancel();
    } catch (err) {
      // La descarga ya pudo haber terminado justo antes de que llegara el cancel.
    }
  });

  ipcMain.on("overlay-has-content", (event, hasContent) => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.setIgnoreMouseEvents(!hasContent, { forward: true });
    }
  });

  ipcMain.on("dnd-custom-confirm", (event, { value, unit }) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;

    const multipliers = {
      segundos: 1000,
      minutos: 60 * 1000,
      horas: 60 * 60 * 1000,
      dias: 24 * 60 * 60 * 1000,
    };

    setDnd(n * (multipliers[unit] || multipliers.minutos));

    if (dndCustomWin && !dndCustomWin.isDestroyed()) {
      dndCustomWin.close();
    }
  });

  ipcMain.on("dnd-custom-cancel", () => {
    if (dndCustomWin && !dndCustomWin.isDestroyed()) {
      dndCustomWin.close();
    }
  });

  ipcMain.handle("dnd-get-category-settings", () => dndCategorySettings);

  ipcMain.handle("dnd-toggle-category", (event, key) => {
    if (Object.prototype.hasOwnProperty.call(dndCategorySettings, key)) {
      dndCategorySettings[key] = !dndCategorySettings[key];
    }
    return dndCategorySettings;
  });

  app.on("activate", () => {
    if (contentWindows.size === 0) {
      createWindow(undefined, { isMainWindow: true });
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // Fallback por si el overlay llegara a cerrarse también (no debería en uso normal).
  if (contentWindows.size > 0) return;
  if (process.platform !== "darwin") {
    app.quit();
  }
});
