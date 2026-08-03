"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const { app } = require("electron");

const HEALTH_CHECK_INTERVAL_MS = 300;
const HEALTH_CHECK_TIMEOUT_MS = 20_000;
const HEALTH_CHECK_REQUEST_TIMEOUT_MS = 1_000;
const SHUTDOWN_GRACE_MS = 5_000;
const MAX_RESTART_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves once `proc` exits, or after `timeoutMs` (returning false either way is up to the caller). */
function waitForExit(proc, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, timeoutMs);
    proc.once("exit", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(true);
      }
    });
  });
}

/**
 * Owns the lifecycle of the FastAPI backend: spawning it as a child process,
 * waiting for it to become healthy, detecting an unexpected exit, and
 * shutting it down cleanly. See docs/12_Packaging_Deployment.md §6-7 and
 * CLAUDE.md's Milestone 14 design (approved architecture: backend as a
 * child process owned by the Electron main process).
 */
class BackendManager {
  constructor({ port, logger }) {
    this.port = port;
    this.logger = logger;
    this.baseUrl = `http://127.0.0.1:${port}/api/v1`;
    this.process = null;
    this.state = "stopped"; // 'starting' | 'ready' | 'crashed' | 'stopped'
    this.externallyManaged = false;
    this.stopping = false;
    this.restartAttempts = 0;
    this.onStatusChange = null;
  }

  setState(state) {
    this.state = state;
    if (this.onStatusChange) {
      this.onStatusChange(state);
    }
  }

  async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_REQUEST_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the command used to launch the backend.
   *
   * Development: runs the backend from source inside its own virtualenv,
   * matching the manual steps in backend/README.md.
   *
   * Production: the exact packaging tool (PyInstaller or equivalent) is
   * still undecided (docs/12_Packaging_Deployment.md §4, left for the
   * Packaging milestone). This assumes a single packaged executable bundled
   * at resources/backend/relay-backend.exe alongside the Electron app —
   * only this one path needs to change once that milestone lands.
   *
   * The packaged backend is launched with RELAY_DATA_DIR set to this app's
   * own userData directory, so its SQLite database and logs land in the
   * local app data directory rather than inside the install directory
   * (docs/12_Packaging_Deployment.md, "Windows Data Storage") — the same
   * directory this process's own Logger already uses.
   */
  resolveCommand() {
    if (app.isPackaged) {
      const exe = path.join(process.resourcesPath, "backend", "relay-backend.exe");
      return {
        command: exe,
        args: ["--port", String(this.port)],
        cwd: path.dirname(exe),
        env: { ...process.env, RELAY_DATA_DIR: app.getPath("userData") },
      };
    }

    const backendDir = path.join(__dirname, "..", "..", "..", "backend");
    const python = path.join(backendDir, ".venv", "Scripts", "python.exe");
    return {
      command: python,
      args: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(this.port)],
      cwd: backendDir,
    };
  }

  async start() {
    this.setState("starting");

    const alreadyRunning = await this.healthCheck();
    if (alreadyRunning) {
      this.logger.info(
        `Backend already responding on port ${this.port}; assuming it is externally managed (dev mode) and not spawning a new instance.`
      );
      this.externallyManaged = true;
      this.setState("ready");
      return;
    }

    this.externallyManaged = false;
    this.spawnProcess();
    await this.waitUntilHealthy();
    this.setState("ready");
  }

  spawnProcess() {
    const { command, args, cwd, env } = this.resolveCommand();
    this.logger.info(`Starting backend: ${command} ${args.join(" ")} (cwd=${cwd})`);

    const proc = spawn(command, args, { cwd, env, windowsHide: true });
    this.process = proc;

    proc.stdout.on("data", (chunk) => this.logger.backend(chunk.toString().trimEnd()));
    proc.stderr.on("data", (chunk) => this.logger.backend(chunk.toString().trimEnd()));

    proc.on("error", (err) => {
      this.logger.error(`Failed to launch backend process: ${err.message}`);
    });

    proc.on("exit", (code, signal) => {
      const wasIntentional = this.stopping;
      this.process = null;
      if (wasIntentional) {
        this.setState("stopped");
        return;
      }
      this.logger.error(`Backend exited unexpectedly (code=${code}, signal=${signal}).`);
      this.setState("crashed");
      this.attemptRestart();
    });
  }

  attemptRestart() {
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      this.logger.error("Backend restart attempts exhausted; giving up.");
      return;
    }
    this.restartAttempts += 1;
    this.logger.info(`Attempting backend restart ${this.restartAttempts}/${MAX_RESTART_ATTEMPTS}...`);
    this.setState("starting");
    this.spawnProcess();
    this.waitUntilHealthy()
      .then(() => this.setState("ready"))
      .catch((err) => {
        this.logger.error(`Backend restart failed: ${err.message}`);
        this.setState("crashed");
      });
  }

  async waitUntilHealthy() {
    const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.healthCheck()) {
        return;
      }
      await sleep(HEALTH_CHECK_INTERVAL_MS);
    }
    throw new Error(`Backend did not become healthy within ${HEALTH_CHECK_TIMEOUT_MS}ms.`);
  }

  async stop() {
    if (this.externallyManaged || !this.process) {
      this.setState("stopped");
      return;
    }

    this.stopping = true;
    const proc = this.process;
    proc.kill();

    const exited = await waitForExit(proc, SHUTDOWN_GRACE_MS);
    if (!exited) {
      this.logger.error("Backend did not exit within the shutdown grace period; forcing termination.");
      proc.kill("SIGKILL");
      await waitForExit(proc, SHUTDOWN_GRACE_MS);
    }
    this.setState("stopped");
  }
}

module.exports = { BackendManager };
