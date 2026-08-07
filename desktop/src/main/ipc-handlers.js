"use strict";

const { ipcMain, dialog, shell, app } = require("electron");
const QRCode = require("qrcode");

/**
 * Registers every ipcMain.handle channel used by the renderer (via
 * preload.js's window.relay bridge). Per the approved M14 architecture, IPC
 * is limited to OS-native functionality and app/backend lifecycle queries —
 * all Relay business data (devices, files, transfers, pairing) is fetched by
 * the renderer directly from the backend over HTTP, not through IPC.
 */
function registerIpcHandlers({ backendManager, getMainWindow, quitApp }) {
  ipcMain.handle("dialog:selectFiles", async () => {
    const window = getMainWindow();
    const result = await dialog.showOpenDialog(window, {
      title: "Select files to share",
      properties: ["openFile", "multiSelections"],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("dialog:selectDirectory", async () => {
    const window = getMainWindow();
    const result = await dialog.showOpenDialog(window, {
      title: "Select download folder",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // P13: sharing a whole folder (as opposed to dialog:selectDirectory above,
  // which picks the single destination folder for downloads). Distinct
  // channel rather than reusing selectDirectory since this one supports
  // picking multiple folders at once, matching selectFiles's own
  // multiSelections behavior for individual files.
  ipcMain.handle("dialog:selectFolders", async () => {
    const window = getMainWindow();
    const result = await dialog.showOpenDialog(window, {
      title: "Select folders to share",
      properties: ["openDirectory", "multiSelections"],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("shell:showInFolder", (_event, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle("app:getVersion", () => app.getVersion());

  ipcMain.handle("app:getBackendBaseUrl", () => backendManager.baseUrl);

  ipcMain.handle("backend:getStatus", () => backendManager.state);

  ipcMain.handle("window:minimizeToTray", () => {
    const window = getMainWindow();
    if (window) {
      window.hide();
    }
  });

  ipcMain.handle("app:quit", () => {
    quitApp();
  });

  // QR generation runs in the main process because the `qrcode` package is a
  // Node module with no browser build in this project's dependency tree, and
  // the sandboxed renderer has no bundler to resolve a bare `require`. The
  // renderer only ever receives the rendered image, never the library itself.
  ipcMain.handle("pairing:generateQr", async (_event, payload) => {
    return QRCode.toDataURL(JSON.stringify(payload), { margin: 1, width: 256 });
  });
}

module.exports = { registerIpcHandlers };
