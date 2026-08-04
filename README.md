# Relay

Relay is a local-first file transfer application for Windows and Android.

It lets you send files directly between a Windows desktop and an Android
phone over the same Wi-Fi network or a mobile hotspot — no cloud storage,
no internet server, no account. The desktop hosts the backend; the phone
discovers it, pairs with it once, and transfers files directly to and from
it from then on.

This repository contains Version 1 of Relay.

## Status

Version 1 is **feature-complete**: the backend API, the Electron desktop
app, and the React Native Android app all implement the full pairing →
discovery → share → transfer → stream flow described in `docs/`. What
remains before a real release is **packaging and distribution**
(`docs/12_Packaging_Deployment.md`) — there is no installer or signed APK
build yet — plus the enhancements listed under
[Known Limitations](#known-limitations) below.

## Features

* **Local-first, peer-to-peer transfer** — files move directly between the
  desktop and the phone over LAN/hotspot; no cloud storage, account, or
  internet server is ever involved.
* **Automatic discovery** — Android finds the desktop on the network via UDP
  broadcast, or pairs instantly by scanning a QR code.
* **One-time pairing handshake** — Android submits a pairing request, the
  desktop approves or rejects it, and Android receives a session token used
  for every request afterward.
* **Desktop-managed sharing** — the desktop chooses which local files are
  shared; Android sees a sanitized list (no local paths) and can request a
  download or propose an upload.
* **Explicit approval on every transfer** — the desktop accepts or rejects
  each transfer proposal before any bytes move; nothing transfers silently.
* **Chunked HTTP streaming** in both directions, with cooperative
  cancellation and automatic filename-conflict resolution on upload.
* **Android foreground service** keeps in-progress transfers alive with a
  live progress notification, plus a separate "download complete"
  notification (via Notifee) with tap-to-open support on Android 10+.
* **Desktop system tray integration** for background operation.

## Architecture

Three components, one local network, no server in between:

```text
┌─────────────────────────────┐         Wi-Fi / hotspot         ┌───────────────────────┐
│   Windows Desktop (Electron)│◄────────────────────────────────►│  Android (React Native) │
│                              │      UDP discovery + REST API   │                         │
│  ┌────────────────────────┐  │                                  └───────────────────────┘
│  │ FastAPI backend         │  │
│  │ (embedded, auto-started)│  │
│  └────────────────────────┘  │
└─────────────────────────────┘
```

* The **desktop app** (`desktop/`) is the host: it starts the FastAPI
  backend as a child process, broadcasts its presence on the LAN, and
  provides the UI for pairing, sharing files, and approving transfers.
* The **backend** (`backend/`) is a layered FastAPI service —
  `API → Service → Repository → SQLAlchemy` — that owns all business logic,
  persistence (SQLite), pairing, authentication, and byte streaming. See
  `backend/README.md` for full internal documentation.
* The **Android app** (`android/`) discovers the desktop, pairs with it via
  QR code, browses its shared files, and proposes/streams transfers.

Layering rule, enforced throughout the backend: API routes call services
only, services call repositories only, repositories are the only code that
touches SQLAlchemy. See `docs/02_Architecture.md`.

## Tech Stack

Finalized for Version 1 (`docs/03_Tech_Stack.md`); Claude Code must not
replace any of these without developer approval.

* **Desktop:** Electron, HTML, CSS, JavaScript
* **Backend:** Python 3.13+, FastAPI, SQLAlchemy, SQLite, Pydantic, Uvicorn
* **Android:** React Native (TypeScript)
* **Development:** Git, Ruff, Pytest

## Project Structure

```text
Relay/
├── backend/          FastAPI application (API, services, repositories, models)
│   ├── app/
│   └── tests/
├── desktop/           Electron shell: embeds the backend, hosts the desktop UI
│   ├── src/main/       Main process — backend lifecycle, tray, IPC
│   ├── src/preload/    Preload bridge
│   ├── src/renderer/   Renderer UI (devices, files, pairing, settings, transfers)
│   └── styles/
├── android/           React Native client (TypeScript)
│   └── src/            api, discovery, pairing, session, files, transfers, streaming, screens, navigation
├── docs/               Project specification — source of truth for Version 1
├── scripts/            Development utilities (e.g. tray icon generation)
├── requirements.txt        Backend runtime dependencies
├── requirements-dev.txt    Backend dev/test/lint dependencies
├── CLAUDE.md           Instructions for Claude Code working in this repo
└── README.md           This file
```

## Requirements

* **Windows 10/11** — the desktop app (Electron + embedded backend) targets
  Windows; the Android client connects to it over the same Wi-Fi network or
  a phone hotspot.
* **Python 3.13+** for the backend.
* **Node.js >= 22.11.0** and npm for the desktop app and Android tooling.
* **For Android builds:** Android Studio with the Android SDK, JDK 17,
  CMake 4.1.2 (installed via the SDK Manager), Windows Long Paths enabled,
  and an Android device or emulator — see "Windows: native build
  requirements" in `android/README.md`.
* **Git**

## Setup

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r ../requirements-dev.txt
copy .env.example .env
uvicorn app.main:app --reload
```

The API is served at `http://localhost:8000/api/v1`, with interactive docs
at `/docs` (Swagger) and `/redoc`. Full setup, endpoint reference, and
architecture notes: `backend/README.md`.

Run tests: `python -m pytest` (from `backend/`). Lint: `ruff check app tests`.

### Desktop (Electron)

```bash
cd desktop
npm install
npm start
```

The desktop app launches the backend automatically (`src/main/backend-manager.js`)
— there is no separate step to start it. Closing the desktop app shuts the
backend down with it.

### Android (React Native)

```bash
cd android
npm install
npm run android
```

Requires a configured React Native environment (Android SDK, an emulator or
device) — see the React Native docs linked in `android/README.md`. The app
must be on the same Wi-Fi network or hotspot as the desktop to discover and
pair with it.

**Building on Windows:** also requires JDK 17, Windows Long Paths enabled,
and CMake 4.1.2 installed via the Android SDK Manager — see
"Windows: native build requirements" in `android/README.md` for why, and
for the native-build root cause these address.

Run tests: `npm test` (from `android/`). Lint: `npm run lint`. Type-check: `npm run typecheck`.

## API Overview

All backend routes are versioned under `/api/v1`. Full endpoint reference,
request/response shapes, and auth rules: `backend/README.md`.

| Resource | Prefix | Auth |
|---|---|---|
| Health | `/health` | none |
| Settings | `/settings` | none (desktop-only, loopback) |
| Devices | `/devices` | none (desktop-only, loopback) |
| Pairing | `/pairing` | none (handshake issues the session token) |
| Discovery | `/discovery` | none (desktop-only, loopback) |
| Shared Files | `/files` | dual-audience: loopback desktop, or `DeviceSession` token |
| Transfers | `/transfers`, `/transfers/requests` | dual-audience or token-only, per route |

Paired Android devices authenticate with a `DeviceSession` bearer token
issued at the end of the pairing handshake (`docs/10_Security.md`).

## Core Flow

1. Desktop starts; the backend comes up embedded inside it and begins
   broadcasting its presence over UDP (`docs/09_Networking.md` §4).
2. Android discovers the desktop on the LAN, or the user scans a pairing QR
   code shown by the desktop.
3. Android submits a pairing request; the desktop approves or rejects it.
   On approval, Android receives a one-time device secret and session token.
4. The desktop shares files from its local disk. Android lists what's shared
   (sanitized — no local paths) and proposes a download, or proposes an
   upload of its own.
5. The desktop accepts or rejects the proposal. An accepted proposal becomes
   a persisted transfer.
6. Android streams the file's bytes to or from the desktop over HTTP, with
   either side polling transfer status until it reaches a terminal state.

## Screenshots

_Coming soon — screenshots of the desktop UI and Android app will be added
here before release._

## Milestones

| # | Milestone | Status |
|---|---|---|
| — | Specification (`docs/`) | Done |
| — | Backend scaffold (config, logging, DB session) | Done |
| M3 | Database models | Done |
| M4 | Repository layer | Done |
| M5 | Service layer | Done |
| M6 | API layer | Done |
| M7 | Pairing infrastructure | Done |
| M8 | Pairing API | Done |
| M9 | Authentication infrastructure | Done |
| M10 | Shared file management | Done |
| M11 | Transfer API & orchestration | Done |
| M12 | Streaming engine | Done |
| M13 | Device discovery (UDP broadcast) | Done |
| M14 | Electron desktop application | Done |
| — | Android client (React Native) | Done |
| — | Packaging & distribution (installer, signed APK) | Not started |

See `CLAUDE.md` for the detailed, per-milestone implementation notes.

## Known Limitations

Deliberately out of scope for Version 1 (`docs/11_File_Transfer.md` §16,
`docs/12_Packaging_Deployment.md`):

* No resume/`Range` support, checksum verification, compression, or
  end-to-end encryption on transfers.
* No bandwidth limiting.
* No WebSockets/real-time push — transfer progress is polled
  (`GET /transfers/{id}`).
* No packaged installer for the desktop app and no signed release APK for
  Android — both currently run from source only.
* Whether the always-unauthenticated routes (`/devices`, `/settings`,
  `/pairing`, `/discovery`) should also require a paired-device session was
  raised during M9 and left open; in practice they're only ever called by
  the desktop's own UI over loopback.

## Documentation

`docs/` is the source of truth for Version 1's design:

* `00_Project_Charter.md`, `01_Project_Overview.md` — goals and scope
* `02_Architecture.md`, `03_Tech_Stack.md`, `04_Project_Structure.md`
* `05_API_Design.md`, `06_Coding_Standards.md`, `07_Development_Workflow.md`
* `08_Architecture_Decisions.md`
* `09_Networking.md`, `10_Security.md`, `11_File_Transfer.md`
* `12_Packaging_Deployment.md`, `13_Database_Design.md`, `14_Testing_Plan.md`
* `15_QA_NOTEBOOK.md` — manual QA notes and verification steps

`backend/README.md` documents the backend's internals in depth (services,
API layer, dependency injection, request flow). `CLAUDE.md` documents
project rules and per-milestone history for Claude Code.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.