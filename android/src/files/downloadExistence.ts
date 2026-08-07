/**
 * Verifies whether a download the backend reports as 'completed' is still
 * actually present on the device — the Transfer row's status only reflects
 * that the stream finished, and never changes again afterward, so it can't
 * by itself tell FilesScreen the file was since deleted, the Downloads
 * folder was cleared, or the app was reinstalled.
 *
 * Deliberately duplicates (does not import) the destination-path logic from
 * streaming/blobUtil.ts's publishDownload — android/src/streaming/** is out
 * of scope for this Files-screen milestone (see docs/15_QA_NOTEBOOK.md's
 * Milestone P2 entry), so this mirrors it instead of editing that module to
 * export it. Keep this in sync if that destination ever changes: MediaStore
 * Downloads/Relay on API 29+ (where publishDownload actually runs), or the
 * private staging path on older devices (where it's a no-op, per
 * MEDIASTORE_MIN_SDK, and the file simply stays where it landed).
 */

import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

/**
 * Exported (P13.1) for downloadActions.ts's "Open" action on a completed
 * folder and streaming/TransferStreamManager.ts's folder-download-complete
 * notification — both need to know whether a folder download actually
 * landed under public storage (this threshold) before offering to browse
 * it, matching the same gate blobUtil.ts's publishDownload already applies
 * to individual files.
 */
export const MEDIASTORE_MIN_SDK = 29;
const PUBLIC_DOWNLOAD_FOLDER = 'Relay';
const EXTERNAL_STORAGE_DOCUMENTS_AUTHORITY = 'com.android.externalstorage.documents';
const PRIMARY_VOLUME_DOWNLOADS_ROOT = 'primary:Download';

/**
 * Exported for downloadActions.ts's "Open" action, which needs the actual
 * on-device path to hand to react-native-blob-util's actionViewIntent, not
 * just a yes/no existence check.
 *
 * `relativePath` (P13) is the same shape streaming/blobUtil.ts's
 * publishDownload/TransferStreamManager's downloadStagingPath use — the
 * full path under Relay/ for a folder child (e.g. "University
 * Notes/Semester 1/DBMS.pdf"), or just a bare file name for a standalone
 * file (the pre-P13 shape, unchanged).
 */
export function downloadedFilePath(relativePath: string): string {
  const { LegacyDownloadDir, DocumentDir } = ReactNativeBlobUtil.fs.dirs;
  return Number(Platform.Version) >= MEDIASTORE_MIN_SDK
    ? `${LegacyDownloadDir}/${PUBLIC_DOWNLOAD_FOLDER}/${relativePath}`
    : `${DocumentDir}/Downloads/${relativePath}`;
}

/** Best-effort: any failure to check (e.g. an unreadable path) is treated as "not there". */
export async function downloadedFileExists(relativePath: string): Promise<boolean> {
  try {
    return await ReactNativeBlobUtil.fs.exists(downloadedFilePath(relativePath));
  } catch {
    return false;
  }
}

/**
 * A downloaded folder's `content://` document URI under the external-storage
 * SAF provider (P13.1) — the one Android intent shape recognized by
 * DocumentsUI and most third-party file managers as "browse this folder"
 * when handed to `ACTION_VIEW` with the directory MIME type
 * (`vnd.android.document/directory`, applied by callers alongside this).
 * `downloadedFilePath`'s FileProvider-wrapped path is *not* substitutable
 * here: `FileProvider` only ever hands a consumer a single file's bytes, it
 * is not a `DocumentsProvider` a file manager can list contents through.
 *
 * The encoding matches `com.android.externalstorage.documents`'s own
 * documentId scheme, confirmed live against a real device's own emitted URI
 * for the same authority (docs/15_QA_NOTEBOOK.md's Milestone P13 Defect 2
 * entry: `.../tree/primary%3ADownload%2FTripPhotos`) — `:` and `/` both
 * percent-encoded into one opaque path segment, which is exactly what
 * `encodeURIComponent` does to this function's own `documentId` string.
 *
 * Only meaningful when `Platform.Version >= MEDIASTORE_MIN_SDK` — below
 * that, a downloaded folder's files stay in this app's private staging
 * directory (see `ensureEmptyFolderStaged`/`downloadStagingPath`), which
 * this public-storage authority cannot see at all. Callers must gate on
 * that threshold themselves before using this.
 */
export function downloadedFolderContentUri(folderName: string): string {
  const documentId = `${PRIMARY_VOLUME_DOWNLOADS_ROOT}/${PUBLIC_DOWNLOAD_FOLDER}/${folderName}`;
  return `content://${EXTERNAL_STORAGE_DOCUMENTS_AUTHORITY}/document/${encodeURIComponent(documentId)}`;
}
