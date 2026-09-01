const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dndAPI", {
  confirm: (value, unit) => ipcRenderer.send("dnd-custom-confirm", { value, unit }),
  cancel: () => ipcRenderer.send("dnd-custom-cancel"),
  getCategorySettings: () => ipcRenderer.invoke("dnd-get-category-settings"),
  toggleCategory: (key) => ipcRenderer.invoke("dnd-toggle-category", key),
});
