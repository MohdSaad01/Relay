"use strict";

const { Tray, Menu, nativeImage } = require("electron");

/** Creates the system tray icon. Left-click and "Open Relay" both show the main window; "Quit" is the only way to actually terminate the app (the window itself just hides on close — see main.js). */
function createTray({ iconPath, onShowWindow, onQuit }) {
  const icon = nativeImage.createFromPath(iconPath);
  const tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("Relay");

  const menu = Menu.buildFromTemplate([
    { label: "Open Relay", click: onShowWindow },
    { type: "separator" },
    { label: "Quit", click: onQuit },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", onShowWindow);

  return tray;
}

module.exports = { createTray };
