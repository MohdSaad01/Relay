# File Transfer Specification

Version: 1.0 — condensed. Section numbers are unchanged from the original
— heavily cross-referenced by number elsewhere (`backend/README.md`,
`CLAUDE.md`, `13_Database_Design.md`, `14_Testing_Plan.md`,
`15_QA_NOTEBOOK.md`).

---

# 1. Purpose

Defines the functional requirements for file transfers between paired
Windows and Android devices over a local network: fast, reliable, secure.

---

# 2. Goals

Fast, reliable, easy to use, memory efficient, recoverable from common
failures.

---

# 3. Supported Transfers

Supported: Windows ↔ Android, single and multiple file transfers. Not
supported: folder *synchronization*, incremental synchronization,
automatic backups, cloud storage. (Folder *sharing/transfer* — a distinct,
supported feature — is defined in §6.)

---

# 4. Transfer Model

Transfers are initiated explicitly by the user. Relay must never begin
transferring files without user action.

---

# 5. Shared Files

Only files explicitly selected by the user are available for transfer.
Relay must never expose the entire file system; files remain under the
user's control at all times. This is the only thing that grants a paired
device visibility into a file (`docs/13_Database_Design.md` §6).

---

# 6. File Selection

Users can select one file, multiple files, or a whole folder; remove a
file/folder from the shared list; refresh the shared list or a shared
folder's contents.

**Folder sharing (Milestone P13):** a shared folder appears as a single
item in the shared list, never as its individual contained files. Its
contents (directory hierarchy, filenames, relative paths) are captured by
walking the folder once at share time, the same point-in-time-snapshot
philosophy `13_Database_Design.md` §6 already applies to a single shared
file's size — not a live view. Downloading a shared folder recreates its
exact directory hierarchy, filenames, and extensions on the receiving
device; absolute filesystem paths are never preserved or transmitted.
This is folder *sharing/transfer*, not folder *synchronization* — see §3:
Relay does not watch a shared folder for changes or push updates
automatically. Refreshing a shared folder re-walks it, matching the
existing single-file refresh behavior.

**Download-side folder state (Milestone P13.3) is client-authoritative,
not server-derived.** The backend's `Transfer` history is immutable and
point-in-time — it can say a transfer once completed, never whether the
result is still present or still current. Whether a downloaded folder's
row offers "Download" or "Open" is decided entirely on the Android device,
from three device-local facts the backend has no view into: a live
filesystem existence check of the folder's resolved on-device directory, a
client-owned reconciliation record of the folder's contents as of the last
confirmed download (`android/src/files/folderIdentity.ts`), and which
on-device directory name a given shared folder actually resolved to
(needed because two shared folders may carry the same display name — see
the same module for the disambiguation algorithm). See
`docs/15_QA_NOTEBOOK.md`'s P13.3 entry for the full audit of this state
machine and the races it closed.

---

# 7. Transfer Process

A transfer: devices are paired → sender selects files → receiver requests
one or more files → backend validates the request → transfer begins →
progress is reported → transfer completes successfully or reports an
error. This is a two-phase lifecycle in the implementation: an Android
device *proposes* a transfer, the desktop accepts or rejects it, and only
an accepted proposal becomes a persisted `Transfer` row (`TransferService`,
M11).

---

# 8. Streaming

Files are streamed; large files are never fully loaded into memory before
being transferred. Streaming supports files significantly larger than
available system memory (`TransferStreamService`, M12).

---

# 9. Progress Reporting

Relay displays current file name, overall progress percentage, and bytes
transferred, updated in near real time. Reported via polling
(`GET /transfers/{id}`) — see `docs/05_API_Design.md` §10; there is no
WebSocket push in Version 1. Estimated transfer speed and remaining time
are future enhancements (§16).

---

# 10. Transfer Queue

Multiple selected files are processed in a predictable, sequential order
in Version 1 (a real in-memory FIFO — see `docs/15_QA_NOTEBOOK.md`'s P11
entry). A folder transfer is N ordinary single-file transfers through this
same queue, not a second streaming concept. Parallel transfers may be
considered in future versions.

---

# 11. Cancellation

Users can cancel an active transfer. Cancellation stops transferring
additional data, releases open resources, and leaves completed files
intact; partially transferred files are handled gracefully.

---

# 12. Duplicate Files

**Implemented strategy: automatic rename.** Both sides resolve a name
collision the same way — the incoming file is saved as `name (1).ext`,
`name (2).ext`, etc. (`app/utils/filesystem.resolve_available_path` on the
backend; `folderIdentity.ts`'s `findAvailableRootName` on Android),
picking the first suffix not already in use at the destination. This
applies to standalone file downloads/uploads (M12) and to a shared/
downloaded folder whose display name collides with an existing one
(P13.1). Neither "ask the user" nor "skip the file" is implemented.

---

# 13. Error Handling

Common failures: network interruption, device disconnect, insufficient
storage, permission denied, missing source file. Errors are reported
clearly without crashing the application.

---

# 14. Security

Only paired and authorized devices may request files; every transfer
request is validated before data is sent (`docs/10_Security.md` §8-9).

---

# 15. Logging

Transfer logs include start, completion, cancellation, and failure —
never file contents.

---

# 16. Future Enhancements

Folder transfers are implemented as of Milestone P13 (§6) — see
`docs/14_Testing_Plan.md`'s P13 entry and `docs/15_QA_NOTEBOOK.md`'s P13
entry for the protocol and its live verification. Retrying an interrupted
folder *upload* does not yet skip already-completed files (a folder
*download* does); see that Known Limitations section.

Still outside Version 1's scope: resume interrupted transfers, parallel
transfers, compression, end-to-end encryption, bandwidth limiting,
integrity verification (checksums).

---

# 17. File Transfer Rules

Claude Code should stream files instead of buffering them entirely,
separate transfer logic from API endpoints, keep transfer code independent
of the user interface, report meaningful progress information, and explain
significant implementation decisions before introducing complex transfer
mechanisms.
