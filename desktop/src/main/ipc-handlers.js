"use strict";

const { ipcMain, dialog, shell, app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
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

  // New_Issues.txt §8: "Open" for a received file, launched with its
  // registered default app. shell.openPath resolves to an error string
  // (never throws) - surfaced to the caller instead of swallowed, since a
  // silent no-op would look like the button did nothing.
  ipcMain.handle("shell:openPath", async (_event, targetPath) => {
    const error = await shell.openPath(targetPath);
    return error || null;
  });

  // New_Issues.txt §9: Delete moves the local file/folder to the OS trash
  // (recoverable) rather than a permanent unlink - the safer default for a
  // destructive action the user triggers from a list view.
  //
  // P29: shell.trashItem throws ("Failed to parse path") when targetPath no
  // longer exists - e.g. a Shared Files source deleted outside Relay after
  // being shared. That's not a real failure from the user's point of view -
  // the thing they asked to delete is already gone - so treat it as a no-op
  // success instead of surfacing a crash, letting the caller's own
  // unshare/remove step proceed and clean up the now-stale entry.
  ipcMain.handle("shell:deleteItem", async (_event, targetPath) => {
    if (!fs.existsSync(targetPath)) {
      return;
    }
    await shell.trashItem(targetPath);
  });

  // Resolves a received item's on-disk path from its download directory and
  // path segments. Done here (Node's path.join) rather than string
  // concatenation in the sandboxed renderer, which has no path module and
  // where naive joining isn't safe across separator styles.
  ipcMain.handle("fs:resolveDownloadPath", (_event, downloadDirectory, segments) => {
    return path.join(downloadDirectory, ...segments);
  });

  // P44: lets the renderer detect a stale received file/folder entry (its
  // resolved path deleted or moved outside Relay) before invoking an
  // OS-level action (openPath/showInFolder) that's guaranteed to fail on a
  // missing path. Mirrors the existsSync check shell:deleteItem already uses.
  ipcMain.handle("fs:pathExists", (_event, targetPath) => {
    return fs.existsSync(targetPath);
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
