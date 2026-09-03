const { contextBridge, ipcRenderer } = require("electron");

// Puente seguro entre el proceso principal y la ventana overlay de notificaciones.
// No se expone ipcRenderer completo, solo funciones puntuales.
contextBridge.exposeInMainWorld("overlayAPI", {
  onDownloadEvent: (callback) => {
    ipcRenderer.on("download-event", (_event, payload) => callback(payload));
  },
  openDownloadsFolder: () => ipcRenderer.send("open-downloads-folder"),
  cancelDownload: (id) => ipcRenderer.send("cancel-download", id),
  reportHasContent: (hasContent) => ipcRenderer.send("overlay-has-content", hasContent),
  restartAndInstall: () => ipcRenderer.send("restart-and-install"),
});
