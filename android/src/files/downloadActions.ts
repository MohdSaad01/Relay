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
 * Deliberately not implemented: a true "Share" action (Android's
 * ACTION_SEND, e.g. handing the file to a messaging app). Investigated and
 * found unsupported by anything already in this codebase -- React Native's
 * built-in Share module discards its `url` field entirely on Android (see
 * node_modules/react-native/Libraries/Share/Share.js: only `title`/
 * `message` are passed to the native side), and react-native-blob-util only
 * exposes actionViewIntent (ACTION_VIEW, "open with", not "share to").
 * Adding real sharing would mean a new native dependency, which is outside
 * this UX-polish milestone's scope (CLAUDE.md Rule 2).
 */

import ReactNativeBlobUtil from 'react-native-blob-util';
import { downloadedFilePath } from './downloadExistence';

const DEFAULT_MIME_TYPE = 'application/octet-stream';

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
  await ReactNativeBlobUtil.android.actionViewIntent(downloadedFilePath(fileName), mimeType || DEFAULT_MIME_TYPE, undefined);
}
