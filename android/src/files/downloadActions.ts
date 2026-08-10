/**
 * "Open" action for a completed download. FilesScreen offers this whenever
 * deriveDownloadStatus reports 'completed' -- which already excludes a file
 * useDownloadExistence has explicitly confirmed missing (see downloadStatus.ts),
 * but doesn't wait on that check if it simply hasn't run yet, per Milestone
 * P6's requirement that a completed download never sits on a disabled,
 * dead-end button while its on-device existence check is still in flight.
 * The rare case where the file was deleted in that brief unchecked window
 * surfaces as an inline error on the failed open (see FilesScreen.handleOpen),
 * which also re-verifies existence so the row recovers to a re-downloadable
 * state instead of staying stuck.
 *
 * Uses react-native-blob-util's existing android.actionViewIntent (already
 * a dependency for the streaming code, see streaming/blobUtil.ts) rather
 * than adding a new native module: it fires a standard Android ACTION_VIEW
 * intent wrapped in a chooser, internally handling the content:// URI
 * conversion (FileProvider) a raw file:// path can no longer cross to
 * another app on modern Android.
 *
 * "Share" (P22, New_Issues.txt §12 — Android's ACTION_SEND, handing the file
 * to another app) is a different intent shape neither of the above covers:
 * investigated and confirmed unsupported by anything already in this
 * codebase — React Native's built-in Share module discards its `url` field
 * entirely on Android (node_modules/react-native/Libraries/Share/Share.js:
 * only `title`/`message` reach the native side), and react-native-blob-util
 * only exposes actionViewIntent (ACTION_VIEW, "open with," not "share to").
 * `react-native-share` was added for this one purpose (CLAUDE.md Rule 2 —
 * the alternative was writing and maintaining our own ACTION_SEND intent/
 * FileProvider code); its own native module resolves `file://` paths via its
 * bundled FileProvider and calls `startActivityForResult` against the actual
 * foreground `Activity` (`reactContext.getCurrentActivity()`), so it doesn't
 * need the `isNewTask` flag react-native-blob-util's actionViewIntent has to
 * work around above (that library calls `startActivity` on the bare
 * `ReactApplicationContext` instead — see this file's own actionViewIntent
 * doc comment for the crash that caused, and docs/15_QA_NOTEBOOK.md's
 * Milestone P9.1 entry).
 */

import ReactNativeBlobUtil from 'react-native-blob-util';
import Share from 'react-native-share';
import { downloadedFilePath, downloadedFolderContentUri } from './downloadExistence';

const DEFAULT_MIME_TYPE = 'application/octet-stream';
const DIRECTORY_MIME_TYPE = 'vnd.android.document/directory';

/**
 * Rejects if no installed app can handle the file's MIME type.
 *
 * `chooserTitle` is deliberately omitted (`undefined`), not a custom title:
 * passing a non-null title makes react-native-blob-util's native
 * `actionViewIntent` (`ReactNativeBlobUtilImpl.java`) wrap the
 * `ACTION_VIEW` intent in `Intent.createChooser(...)` before calling
 * `startActivity()` from this app's `ReactApplicationContext` (not an
 * `Activity`). `createChooser` returns a *new* wrapper intent that does
 * not inherit the `FLAG_ACTIVITY_NEW_TASK` flag set on the original — a
 * non-Activity context requires that flag on whatever intent is actually
 * started, so every call with a non-null title throws
 * `AndroidRuntimeException: Calling startActivity() from outside of an
 * Activity context requires the FLAG_ACTIVITY_NEW_TASK flag`, confirmed
 * live on device (docs/15_QA_NOTEBOOK.md's Milestone P9.1 entry). Omitting
 * it skips the `createChooser` wrapping entirely, so the original intent —
 * which does carry the flag — reaches `startActivity()` unwrapped; Android
 * still shows its own disambiguation picker when more than one app
 * matches, it just won't carry this custom title. This is a third-party bug
 * (`node_modules/react-native-blob-util`), avoided from this call site
 * rather than patched in place, matching this codebase's existing
 * `isActuallyComplete()` precedent (blobUtil.ts) for working around a
 * library defect without touching `node_modules`.
 */
export async function openDownloadedFile(fileName: string, mimeType: string | null): Promise<void> {
  const path = await downloadedFilePath(fileName);
  await ReactNativeBlobUtil.android.actionViewIntent(path, mimeType || DEFAULT_MIME_TYPE, undefined);
}

/**
 * "Open" action for a completed folder download (P13.1, Issue 2) — a
 * folder's row always shows this once every child file's downloaded, exactly
 * like FileRow's own canOpen/onOpen (see FilesScreen), rather than a
 * disabled receipt or a re-download button.
 *
 * Deliberately does not reuse openDownloadedFile: that function hands a
 * *file* path to actionViewIntent, which wraps it through this app's own
 * FileProvider — the right shape for "give another app these bytes to
 * read," but not for "browse this folder's contents," which only a real
 * DocumentsProvider intent (downloadedFolderContentUri) satisfies. Passing
 * that content:// URI straight through is safe here: actionViewIntent's own
 * native implementation only wraps a path via FileProvider when it does
 * *not* already start with "content://" (see
 * ReactNativeBlobUtilImpl.actionViewIntent), so this URI reaches
 * startActivity() unmodified, exactly as constructed.
 *
 * Only offered when downloadedFolderContentUri can actually resolve one
 * (see its own doc comment): API 29+ in the default location, unrestricted
 * in a custom SAF location (P14.3) unless its grant has been revoked.
 * Rejects when it can't so the caller (FilesScreen.handleOpenFolder)
 * surfaces the same kind of inline error a failed file Open already does,
 * rather than silently doing nothing. The message deliberately doesn't
 * name a specific cause (OS version vs. a revoked SAF grant) — callers show
 * their own generic, more actionable message already (see
 * FilesScreen.handleOpenFolder's catch block).
 */
export async function openDownloadedFolder(folderName: string): Promise<void> {
  const folderUri = await downloadedFolderContentUri(folderName);
  if (!folderUri) {
    throw new Error('This folder is not available to open.');
  }
  await ReactNativeBlobUtil.android.actionViewIntent(folderUri, DIRECTORY_MIME_TYPE, undefined);
}

/**
 * "Share" action (P22, New_Issues.txt §12) for a completed file download —
 * hands the file to another installed app (messaging, email, ...) via
 * Android's ACTION_SEND, offered only for files (not folders: there is no
 * single-file-shaped intent for "share a whole directory," and this
 * codebase already keeps file-only vs. folder-only actions intentionally
 * separate rather than forcing one to fit the other — see FilesScreen's own
 * per-kind menu-action lists).
 *
 * `downloadedFilePath` returns a bare filesystem path in the default
 * (MediaStore) download location, or a `content://` URI in a custom SAF
 * location (P14.3). Only the former is handed to Share.open here:
 * react-native-share's own URL handling (RNSharePathUtil.compatUriFromFile)
 * re-wraps a `file://` path through its bundled FileProvider correctly, but
 * mishandles an already-`content://` URL (it re-parses it as a bare file
 * path before rewrapping, silently losing the `content://` scheme) — a
 * confirmed library limitation, not something this codebase can fix without
 * patching node_modules. A custom-SAF-mode file's Share action reports that
 * plainly instead of invoking a broken share.
 */
export async function shareDownloadedFile(fileName: string, mimeType: string | null): Promise<void> {
  const path = await downloadedFilePath(fileName);
  if (path.startsWith('content://')) {
    throw new Error('This file is not available to share.');
  }
  await Share.open({
    url: `file://${path}`,
    type: mimeType || DEFAULT_MIME_TYPE,
    filename: fileName,
    failOnCancel: false,
  });
}
