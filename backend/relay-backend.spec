# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the packaged Relay backend (Milestone P38).

Builds a --onedir bundle producing relay-backend.exe, the exact path
desktop/src/main/backend-manager.js's packaged-mode branch already expects
at resources/backend/relay-backend.exe (docs/15_QA_NOTEBOOK.md, Milestone
P37's "Recommended architecture"). Build with:

    pyinstaller relay-backend.spec

from a Python environment holding only requirements.txt +
requirements-build.txt (never the full dev `.venv`, which also carries
unrelated packages that must not end up in a production bundle — see
this milestone's dependency audit in docs/15_QA_NOTEBOOK.md).

Entry point is backend/run.py, not app/main.py directly: the ASGI module
has no __main__ block of its own (see run.py's own docstring for why).

console=True is required, not cosmetic: PyInstaller's windowed/GUI
subsystem leaves sys.stdout/sys.stderr as None, which breaks this app's
own logging.StreamHandler() console handler. A console window never
actually appears because Electron always spawns this executable with
windowsHide: true (desktop/src/main/backend-manager.js).
"""

from PyInstaller.utils.hooks import collect_submodules

# SQLAlchemy resolves its sqlite dialect via a runtime string import
# (sqlalchemy.dialects.registry), which PyInstaller's static bytecode
# analysis cannot follow, so it must be collected explicitly. uvicorn's and
# pydantic's own, equally dynamic module resolution is already covered by
# pyinstaller-hooks-contrib's bundled hook-uvicorn.py/hook-pydantic.py,
# which apply automatically -- no --additional-hooks-dir needed.
hidden_imports = collect_submodules("sqlalchemy.dialects.sqlite")

a = Analysis(
    ["run.py"],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="relay-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="relay-backend",
)
