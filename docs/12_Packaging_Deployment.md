# Packaging & Deployment Specification

Version: 1.0 — condensed. Packaging & Deployment is Version 1's final
milestone sequence (see `CLAUDE.md`); §3 (Desktop), §4 (Backend), and §5
(Android) are implemented as of P39/P40 — P41's full packaged
cross-platform validation is what remains.

---

# 1. Purpose

Defines how Relay Version 1 will be packaged, installed, and distributed:
a simple installation experience for end users, a straightforward
development workflow.

---

# 2. Distribution Goals

Relay should be easy to install, require minimal user configuration, not
require users to install Python or Node.js, and run as a normal desktop
application.

---

# 3. Desktop Packaging

**Decided and implemented (Milestone P39):** `electron-builder` (^26.15.3),
NSIS target, per-user install (`perMachine: false` — installs to
`%LOCALAPPDATA%\Programs\Relay`, no administrator rights required).
Configuration lives inline in `desktop/package.json`'s `"build"` field (no
separate `electron-builder.yml`). `npm run dist` (`electron-builder --win
--x64`) from `desktop/` produces `desktop/dist/Relay-Setup-<version>.exe`;
`npm run pack` (`--dir`, no installer) is available for faster iteration.
Windows x64 only, matching the project's supported dev/runtime environment
— no ia32/arm64 builds.

P38's backend bundle (`backend/dist/relay-backend/`) is wired in via
`extraResources` (`../backend/dist/relay-backend` → `backend`), landing at
`resources/backend/relay-backend.exe` inside the packaged app — the exact
path `desktop/src/main/backend-manager.js`'s packaged-mode branch already
expected, so it required no changes. This directory is placed outside
`app.asar` (`relay-backend.exe` must be directly `spawn()`able, and
asar-packed binaries aren't). The backend bundle must be rebuilt
(`pyinstaller relay-backend.spec` from `backend/`, clean venv) **before**
running `npm run dist` — electron-builder does not build it automatically.

The Windows application identity: `appId: "com.relay.desktop"`,
`productName: "Relay"` (set at both `package.json`'s root and inside
`build`, so Electron's own `app.getName()` — which drives
`app.getPath("userData")` — also resolves to "Relay", not the npm package
name "relay-desktop"). The installer, executable (`Relay.exe`), Desktop
and Start Menu shortcuts, and uninstall registry entry all consistently
identify the app as "Relay". The installer icon and `Relay.exe`'s embedded
icon are both `desktop/assets/icons/icon.ico` (P36 geometry) — no separate
installer-specific asset.

The backend starts automatically when the desktop application launches —
users never manually start it. See `docs/15_QA_NOTEBOOK.md`'s P39 entry
for full build/verification detail, including what was and wasn't
independently confirmed (no code signing, inconclusive firewall-prompt
behavior, no cross-machine build reproduction).

---

# 4. Backend Packaging

**Decided and implemented (Milestone P38):** PyInstaller, `--onedir` mode.
`backend/relay-backend.spec` builds `backend/run.py` (the production entry
point — `backend/app/main.py` itself is a pure ASGI module with no
`__main__` block) into `backend/dist/relay-backend/relay-backend.exe` plus
a supporting `_internal/` directory. Verified self-contained: runs with no
system-wide Python install, no pip, no virtualenv, and no Relay source
checkout present (see `docs/15_QA_NOTEBOOK.md`'s P38 entry for the full
verification). `desktop/src/main/backend-manager.js`'s packaged-mode
branch already expects exactly this output at
`resources/backend/relay-backend.exe` and needed no changes. Always build
from a clean virtual environment holding only `requirements.txt` +
`requirements-build.txt` — never the tracked development `.venv`.

---

# 5. Android Distribution

**Decided and implemented (Milestone P40):** a real release build now
exists. Release builds explicitly permit the plain-HTTP LAN traffic
Relay's networking model requires via `android/android/app/src/main/res/xml/network_security_config.xml`
(`<base-config cleartextTrafficPermitted="true" />`, wired through
`AndroidManifest.xml`'s `android:networkSecurityConfig`) — Android's
release-build default otherwise silently blocks all of it. Release signing
reads credentials from a gitignored `android/android/keystore.properties`
(template: `keystore.properties.example`) or equivalent environment
variables; if neither is supplied, `assembleRelease`/`bundleRelease` fails
fast with a clear error rather than falling back to the debug keystore.
`cd android/android && ./gradlew.bat :app:assembleRelease` produces
`android/android/app/build/outputs/apk/release/app-release.apk`. The
signing identity verified during P40 is an explicitly-labeled **local
verification keystore, not a final production signing identity** — a real
release keystore must be generated (see `keystore.properties.example`)
and kept secure outside the repository before any real distribution. See
`docs/15_QA_NOTEBOOK.md`'s P40 entry for full build/verification detail.

Distributed as a standard APK (sideloaded — no store listing exists);
future releases may use Android App Bundles (AAB) for store distribution.

---

# 6. Startup Sequence

1. Launch the embedded backend.
2. Verify the backend is running.
3. Begin device discovery.
4. Display the user interface.
5. Accept incoming paired device connections.

Failures during startup should be handled gracefully.

---

# 7. Shutdown Sequence

On exit: stop accepting new connections, complete or safely cancel active
operations, shut down the backend cleanly, release system resources. An
unexpected crash must not leave an orphaned backend process running.

---

# 8. Configuration

Application configuration (settings, database location, download
directory, shared files config, network settings) is stored locally.
Sensitive information is never hardcoded.

---

# 9. Updates

Automatic updates are outside Version 1's scope; updates are performed
manually. The architecture should allow automatic updates to be added
later.

---

# 10. Logging

Application logs are stored locally, to assist debugging while avoiding
sensitive information. A future version may support exporting logs for
troubleshooting.

---

# 11. Release Builds

Development and production builds stay separate. Development builds may
include debug logging, developer tools, and extra diagnostics; production
builds disable unnecessary debugging features.

---

# 12. Future Improvements

Outside Version 1's scope: automatic updates, code signing, installer
customization, cross-platform installers, portable editions.

---

# 13. Packaging Rules

Claude Code should avoid requiring users to install development tools,
keep the startup process automatic, explain packaging-related dependencies
before introducing them, prefer widely adopted packaging solutions over
custom implementations, and keep development/production packaging clearly
separated.

---

# 14. Windows Data Storage

Relay stores user data (SQLite database, application configuration, logs,
pairing information) inside the user's local application data directory —
application binaries stay separate from user-generated data. **Finalized
(Milestone P39):** application binaries install to
`%LOCALAPPDATA%\Programs\Relay` (per-user, no admin rights); user data
(`relay.db`, `logs/`) lives at `%APPDATA%\Relay`, Electron's own
`app.getPath("userData")` for the "Relay" product name. Verified live: an
NSIS upgrade-install over an existing install leaves `%APPDATA%\Relay`
untouched, and uninstalling removes only the binaries/shortcuts/registry
entry, never `%APPDATA%\Relay` — a reinstall after an uninstall silently
resurrects the prior database (paired devices, shared files, settings).

A related decision has already been made ahead of full packaging
(`docs/15_QA_NOTEBOOK.md` T8): a `RELAY_DATA_DIR` environment variable
(defaulting `DATABASE_URL`/`LOG_DIR` under it when set) prevents the
packaged backend from writing its database/logs inside its own,
potentially unwritable or upgrade-destroyed, install directory —
`backend-manager.js` sets it to Electron's `app.getPath("userData")` in a
packaged build.
