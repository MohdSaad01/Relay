# Packaging & Deployment Specification

Version: 1.0 — condensed. This is Version 1's **next planned milestone**
(see `CLAUDE.md`) — nothing below is implemented yet.

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

The Windows desktop application will be distributed as a packaged Electron
application, with the FastAPI backend bundled inside it. The backend
starts automatically when the desktop application launches — users never
manually start it.

---

# 4. Backend Packaging

The exact tool (PyInstaller or an equivalent) will be selected during the
packaging milestone after evaluating the options. Requirements: runs
without a system-wide Python install, includes all required Python
dependencies, starts automatically.

---

# 5. Android Distribution

Distributed as a standard APK during development; future releases may use
Android App Bundles (AAB) for store distribution.

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
application binaries stay separate from user-generated data. The exact
directory structure will be finalized during the Packaging milestone.

A related decision has already been made ahead of full packaging
(`docs/15_QA_NOTEBOOK.md` T8): a `RELAY_DATA_DIR` environment variable
(defaulting `DATABASE_URL`/`LOG_DIR` under it when set) prevents the
packaged backend from writing its database/logs inside its own,
potentially unwritable or upgrade-destroyed, install directory —
`backend-manager.js` sets it to Electron's `app.getPath("userData")` in a
packaged build.
