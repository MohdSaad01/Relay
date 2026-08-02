"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * The only bridge between the sandboxed renderer and the main process.
 * Exposes solely OS-native/app-lifecycle actions — never Relay business data,
 * which the renderer fetches directly from the backend over HTTP.
 */
contextBridge.exposeInMainWorld("relay", {
  selectFiles: () => ipcRenderer.invoke("dialog:selectFiles"),
  selectDirectory: () => ipcRenderer.invoke("dialog:selectDirectory"),
  showInFolder: (filePath) => ipcRenderer.invoke("shell:showInFolder", filePath),

  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  getBackendBaseUrl: () => ipcRenderer.invoke("app:getBackendBaseUrl"),
  getBackendStatus: () => ipcRenderer.invoke("backend:getStatus"),

  minimizeToTray: () => ipcRenderer.invoke("window:minimizeToTray"),
  quit: () => ipcRenderer.invoke("app:quit"),

  generateQrCode: (payload) => ipcRenderer.invoke("pairing:generateQr", payload),

  onBackendStatusChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("backend:status-changed", listener);
    return () => ipcRenderer.removeListener("backend:status-changed", listener);
  },
});
