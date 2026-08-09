"use strict";

const path = require("node:path");
const { app, BrowserWindow, dialog } = require("electron");

const { Logger } = require("./logger");
const { BackendManager } = require("./backend-manager");
const { createTray } = require("./tray");
const { registerIpcHandlers } = require("./ipc-handlers");

const BACKEND_PORT = 8000;
const ICON_PATH = path.join(__dirname, "..", "..", "assets", "icons", "tray.png");
const PRELOAD_PATH = path.join(__dirname, "..", "preload", "preload.js");
const INDEX_HTML_PATH = path.join(__dirname, "..", "renderer", "index.html");

const logger = new Logger(path.join(app.getPath("userData"), "logs"));
const backendManager = new BackendManager({ port: BACKEND_PORT, logger });

let mainWindow = null;
let tray = null;
let quitting = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Another Relay instance already holds the lock (and therefore already
  // owns the backend process and the SQLite database) — this one must not
  // proceed at all, not even far enough to spawn a second backend.
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(startup);

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("window-all-closed", () => {
    // No-op: the main window hides to tray instead of closing (see
    // createMainWindow's 'close' handler below). The app only ever quits via
    // quitApp(), triggered from the tray's "Quit" item.
  });

  // Best-effort clean shutdown when running interactively (e.g. `npm start`
  // in a terminal, Ctrl+C). Ordinary end users quit via the tray instead.
  process.on("SIGINT", () => quitApp());
  process.on("SIGTERM", () => quitApp());

  process.on("uncaughtException", (err) => {
    logger.error(`Uncaught exception in main process: ${err.stack || err.message}`);
  });
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    backgroundColor: "#f6f7f9",
    icon: ICON_PATH,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadFile(INDEX_HTML_PATH);
  window.once("ready-to-show", () => window.show());

  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });

  return window;
}

async function startup() {
  backendManager.onStatusChange = (state) => {
    logger.info(`Backend state: ${state}`);
    if (mainWindow) {
      mainWindow.webContents.send("backend:status-changed", state);
    }
  };

  try {
    // Approved requirement: the renderer window must not be created until
    // the backend health endpoint actually responds.
    await backendManager.start();
  } catch (err) {
    logger.error(`Backend failed to start: ${err.message}`);
    dialog.showMessageBoxSync({
      type: "error",
      title: "Relay",
      message: "The Relay backend failed to start.",
      detail: `${err.message}\n\nCheck the log file for details:\n${logger.filePath}`,
      buttons: ["Quit"],
    });
    app.quit();
    return;
  }

  mainWindow = createMainWindow();

  tray = createTray({
    iconPath: ICON_PATH,
    onShowWindow: () => {
      mainWindow.show();
      mainWindow.focus();
    },
    onQuit: () => quitApp(),
  });

  registerIpcHandlers({
    backendManager,
    getMainWindow: () => mainWindow,
    quitApp,
  });
}

async function quitApp() {
  if (quitting) {
    return;
  }
  quitting = true;
  await backendManager.stop();
  app.quit();
}
