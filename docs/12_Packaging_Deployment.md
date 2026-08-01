# Packaging & Deployment Specification

Version: 1.0

---

# 1. Purpose

This document defines how Relay Version 1 will be packaged, installed, and distributed.

The objective is to provide a simple installation experience for end users while keeping the development workflow straightforward.

---

# 2. Distribution Goals

Relay should:

* Be easy to install.
* Require minimal user configuration.
* Not require users to install Python.
* Not require users to install Node.js.
* Run as a normal desktop application.

---

# 3. Desktop Packaging

The Windows desktop application will be distributed as a packaged Electron application.

The FastAPI backend should be bundled with the desktop application.

The backend should start automatically when the desktop application launches.

Users should not need to manually start the backend.

---

# 4. Backend Packaging

The exact backend packaging tool (such as PyInstaller or an equivalent solution) will be selected during the packaging milestone after evaluating the available options.

Requirements:

* The backend must run without a system-wide Python installation.
* The packaged backend should include all required Python dependencies.
* Startup should be automatic.

---

# 5. Android Distribution

The Android client will be distributed as a standard Android application package (APK) during development.

Future releases may use Android App Bundles (AAB) for store distribution.

---

# 6. Startup Sequence

When the desktop application starts:

1. Launch the embedded backend.
2. Verify the backend is running.
3. Begin device discovery.
4. Display the user interface.
5. Accept incoming paired device connections.

The startup process should handle failures gracefully.

---

# 7. Shutdown Sequence

When the desktop application exits:

* Stop accepting new connections.
* Complete or safely cancel active operations.
* Shut down the backend cleanly.
* Release system resources.

Unexpected crashes should not leave orphaned backend processes running.

---

# 8. Configuration

Application configuration should be stored locally.

Examples include:

* Application settings
* Database location
* Download directory
* Shared files configuration
* Network settings

Sensitive information should not be hardcoded.

---

# 9. Updates

Automatic updates are outside the scope of Version 1.

Application updates will be performed manually.

The architecture should allow automatic updates to be added in a future version.

---

# 10. Logging

Application logs should be stored locally.

Logs should assist with debugging while avoiding sensitive information.

Future versions may provide an option to export logs for troubleshooting.

---

# 11. Release Builds

Development and production builds should remain separate.

Development builds may include:

* Debug logging
* Developer tools
* Additional diagnostics

Production builds should disable unnecessary debugging features.

---

# 12. Future Improvements

Future versions may introduce:

* Automatic updates
* Code signing
* Installer customization
* Cross-platform installers
* Portable editions

These enhancements are outside the scope of Version 1.

---

# 13. Packaging Rules

Claude Code should:

* Avoid requiring users to install development tools.
* Keep the startup process automatic.
* Explain packaging-related dependencies before introducing them.
* Prefer widely adopted packaging solutions over custom implementations.
* Design the project so development and production packaging remain clearly separated.

---

## Windows Data Storage

Relay should store user data inside the user's local application data directory.

Examples include:

- SQLite database
- Application configuration
- Logs
- Pairing information

Application binaries should remain separate from user-generated data.

The exact directory structure will be finalized during the Packaging milestone.
