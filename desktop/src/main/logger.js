"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** Minimal file + console logger for the Electron main process. */
class Logger {
  constructor(logDir) {
    fs.mkdirSync(logDir, { recursive: true });
    this.filePath = path.join(logDir, "desktop.log");
    this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
  }

  write(level, message) {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    if (level === "ERROR") {
      console.error(line);
    } else {
      console.log(line);
    }
    this.stream.write(line + "\n");
  }

  info(message) {
    this.write("INFO", message);
  }

  error(message) {
    this.write("ERROR", message);
  }

  /** Backend stdout/stderr is logged at its own level so it's visually distinct from Electron's own messages. */
  backend(message) {
    this.write("BACKEND", message);
  }
}

module.exports = { Logger };
