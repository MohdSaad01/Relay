"""Production entry point for the packaged Relay backend (Milestone P38).

`backend/app/main.py` is a pure ASGI module with no `__main__` block — in
development it is only ever started by invoking Uvicorn externally
(`python -m uvicorn app.main:app --host 0.0.0.0 --port <port>`, from
`desktop/src/main/backend-manager.js`'s dev-mode branch). A PyInstaller
executable needs an actual Python entry point to run, so this module
performs that same invocation itself and is the script PyInstaller builds
from (see `backend/relay-backend.spec`).

`--host` defaults to `Settings.HOST` rather than being required: Electron's
packaged-mode launch command (`backend-manager.js`'s `resolveCommand()`)
only ever passes `--port`, never `--host`, so the packaged executable must
resolve its own bind address the same way `Settings.HOST` already does
("0.0.0.0", matching dev's effective bind address today).
"""

import argparse

import uvicorn

from app.core.config import get_settings
from app.main import app


def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Run the Relay backend.")
    parser.add_argument("--host", default=settings.HOST)
    parser.add_argument("--port", type=int, default=settings.PORT)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
