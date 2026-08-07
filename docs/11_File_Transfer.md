# File Transfer Specification

Version: 1.0

---

# 1. Purpose

This document defines the functional requirements for file transfers in Relay Version 1.

Relay should provide fast, reliable, and secure file transfers between paired Windows and Android devices over a local network.

---

# 2. Goals

The file transfer system should be:

* Fast
* Reliable
* Easy to use
* Memory efficient
* Recoverable from common failures

---

# 3. Supported Transfers

Version 1 supports:

* Windows → Android
* Android → Windows
* Single file transfers
* Multiple file transfers

Version 1 does not support:

* Folder synchronization
* Incremental synchronization
* Automatic backups
* Cloud storage

---

# 4. Transfer Model

Transfers are initiated explicitly by the user.

Relay must never begin transferring files without user action.

---

# 5. Shared Files

Only files explicitly selected by the user are available for transfer.

Relay must never expose the entire file system.

Files should remain under the user's control at all times.

---

# 6. File Selection

Users should be able to:

* Select one file.
* Select multiple files.
* Select a whole folder.
* Remove files (or folders) from the shared list.
* Refresh the shared list (or a shared folder's contents).

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

---

# 7. Transfer Process

A typical transfer consists of:

1. Devices are paired.
2. Sender selects files.
3. Receiver requests one or more files.
4. Backend validates the request.
5. File transfer begins.
6. Progress is reported.
7. Transfer completes successfully or reports an error.

---

# 8. Streaming

Files should be streamed.

Large files should not be fully loaded into memory before being transferred.

Streaming should support files significantly larger than available system memory.

---

# 9. Progress Reporting

Relay should display:

* Current file name
* Overall progress percentage
* Bytes transferred
* Estimated transfer speed (future enhancement)
* Estimated remaining time (future enhancement)

Progress updates should occur in near real time.

---

# 10. Transfer Queue

If multiple files are selected:

* Transfers should be processed in a predictable order.
* The implementation may process files sequentially in Version 1.

Parallel transfers may be considered in future versions.

---

# 11. Cancellation

Users should be able to cancel an active transfer.

Cancellation should:

* Stop transferring additional data.
* Release open resources.
* Leave completed files intact.

Partially transferred files should be handled gracefully.

---

# 12. Duplicate Files

When a file with the same name already exists, Relay should not overwrite it automatically.

The exact conflict resolution strategy will be implemented during the File Transfer milestone.

Possible options include:

* Rename automatically
* Ask the user
* Skip the file

---

# 13. Error Handling

Common failures include:

* Network interruption
* Device disconnect
* Insufficient storage
* Permission denied
* Missing source file

Errors should be reported clearly without crashing the application.

---

# 14. Security

Only paired and authorized devices may request files.

Every transfer request must be validated before data is sent.

---

# 15. Logging

Transfer logs should include:

* Transfer start
* Transfer completion
* Transfer cancellation
* Transfer failure

Logs should never contain file contents.

---

# 16. Future Enhancements

Folder transfers are implemented as of Milestone P13 (§6) — see
`docs/14_Testing_Plan.md`'s P13 entry and `docs/15_QA_NOTEBOOK.md`'s P13
entry for the protocol and its live verification. Retrying an interrupted
folder *upload* does not yet skip already-completed files (a folder
*download* does); see that Known Limitations section.

Future versions may still support:

* Resume interrupted transfers
* Parallel transfers
* Compression
* End-to-end encryption
* Bandwidth limiting
* Integrity verification (checksums)

These features remain outside the scope of Version 1.

---

# 17. File Transfer Rules

Claude Code should:

* Stream files instead of buffering entire files.
* Separate transfer logic from API endpoints.
* Keep transfer code independent of the user interface.
* Report meaningful progress information.
* Explain significant implementation decisions before introducing complex transfer mechanisms.
