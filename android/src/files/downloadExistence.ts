/**
 * Verifies whether a download the backend reports as 'completed' is still
 * actually present on the device — the Transfer row's status only reflects
 * that the stream finished, and never changes again afterward, so it can't
 * by itself tell FilesScreen the file was since deleted, the Downloads
 * folder was cleared, or the app was reinstalled.
 *
 * This module is the pipeline's sole source of truth for "where do
 * downloads actually live" (P14.3): every function below resolves against
 * whichever destination settings/DownloadLocationManager currently reports,
 * rather than every call site hard-coding MediaStore Downloads/Relay
 * itself. Default mode's behavior is unchanged from pre-P14.3 Relay; custom
 * mode resolves the same relative path against the user-picked SAF tree via
 * react-native-saf-x (already a dependency — see streaming/folderPicker.ts
 * for its first use in this codebase).
 */

import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { exists as safExists, stat as safStat, unlink as safUnlink } from 'react-native-saf-x';
import { DownloadLocationManager } from '../settings/DownloadLocationManager';

/**
 * Exported (P13.1) for downloadActions.ts's "Open" action on a completed
 * folder and streaming/TransferStreamManager.ts's folder-download-complete
 * notification — both need to know whether a folder download actually
 * landed under public storage (this threshold) before offering to browse
 * it, matching the same gate blobUtil.ts's publishDownload already applies
 * to individual files. Only applies to the default (MediaStore) location —
 * a custom SAF location (P14.3) has no such floor, since Storage Access
 * Framework itself works on much older Android versions.
 */
export const MEDIASTORE_MIN_SDK = 29;
const PUBLIC_DOWNLOAD_FOLDER = 'Relay';
const EXTERNAL_STORAGE_DOCUMENTS_AUTHORITY = 'com.android.externalstorage.documents';
const PRIMARY_VOLUME_DOWNLOADS_ROOT = 'primary:Download';

/**
 * `relativePath` (P13) is the same shape streaming/blobUtil.ts's
 * publishDownload/TransferStreamManager's downloadStagingPath use — the
 * full path under Relay/ for a folder child (e.g. "University
 * Notes/Semester 1/DBMS.pdf"), or just a bare file name for a standalone
 * file (the pre-P13 shape, unchanged).
 */
function defaultFilePath(relativePath: string): string {
  const { LegacyDownloadDir, DocumentDir } = ReactNativeBlobUtil.fs.dirs;
  return Number(Platform.Version) >= MEDIASTORE_MIN_SDK
    ? `${LegacyDownloadDir}/${PUBLIC_DOWNLOAD_FOLDER}/${relativePath}`
    : `${DocumentDir}/Downloads/${relativePath}`;
}

/**
 * Exported for downloadActions.ts's "Open" action, which needs the actual
 * on-device identifier to hand to react-native-blob-util's
 * actionViewIntent — a raw filesystem path in default mode, or the
 * resolved SAF `content://` document URI in custom mode (P14.3).
 * actionViewIntent already passes a `content://` string through unmodified
 * rather than wrapping it via FileProvider (see downloadActions.ts's own
 * doc comment), so custom mode needs no change at that call site beyond
 * awaiting this now-async function.
 */
export async function downloadedFilePath(relativePath: string): Promise<string> {
  const location = DownloadLocationManager.getLocation();
  if (location.mode === 'default') {
    return defaultFilePath(relativePath);
  }
  const stat = await safStat(`${location.treeUri}/${relativePath}`);
  return stat.uri;
}

/** Best-effort: any failure to check (e.g. an unreadable path, a revoked SAF grant) is treated as "not there". */
export async function downloadedFileExists(relativePath: string): Promise<boolean> {
  const location = DownloadLocationManager.getLocation();
  try {
    if (location.mode === 'default') {
      return await ReactNativeBlobUtil.fs.exists(defaultFilePath(relativePath));
    }
    return await safExists(`${location.treeUri}/${relativePath}`);
  } catch {
    return false;
  }
}

/**
 * Best-effort delete of a downloaded file at `relativePath` under the
 * current download location (P14.3) — used by FilesScreen when replacing a
 * stale folder child before re-downloading an updated one. Never throws:
 * matches every other cleanup call in this pipeline (e.g. publishDownload's
 * own staging-file unlink), since a failed delete here must not block the
 * fresh download it's clearing the way for.
 */
export async function deleteDownloadedPath(relativePath: string): Promise<void> {
  const location = DownloadLocationManager.getLocation();
  if (location.mode === 'default') {
    await ReactNativeBlobUtil.fs.unlink(defaultFilePath(relativePath)).catch(() => undefined);
    return;
  }
  await safUnlink(`${location.treeUri}/${relativePath}`).catch(() => undefined);
}

/**
 * A downloaded folder's `content://` document URI (P13.1) — the one
 * Android intent shape recognized by DocumentsUI and most third-party file
 * managers as "browse this folder" when handed to `ACTION_VIEW` with the
 * directory MIME type (`vnd.android.document/directory`, applied by
 * callers alongside this).
 *
 * Resolves to `null` when a folder can't be browsed in the current
 * mode/OS combination: below MEDIASTORE_MIN_SDK in default mode (a
 * downloaded folder's files stay in this app's private staging directory,
 * which this public-storage authority cannot see at all), or if the
 * current custom SAF location can't resolve the folder (e.g. a revoked
 * grant). Callers (downloadActions.ts's openDownloadedFolder,
 * TransferStreamManager's folder-complete notification) treat `null` as
 * "nothing to open" rather than each re-deriving this same gate
 * themselves — this used to be duplicated at both call sites.
 */
export async function downloadedFolderContentUri(folderName: string): Promise<string | null> {
  const location = DownloadLocationManager.getLocation();
  if (location.mode === 'default') {
    if (Number(Platform.Version) < MEDIASTORE_MIN_SDK) {
      return null;
    }
    // The encoding matches com.android.externalstorage.documents's own
    // documentId scheme, confirmed live against a real device's own emitted
    // URI for the same authority (docs/15_QA_NOTEBOOK.md's Milestone P13
    // Defect 2 entry) — ':' and '/' both percent-encoded into one opaque
    // path segment, exactly what encodeURIComponent does here.
    const documentId = `${PRIMARY_VOLUME_DOWNLOADS_ROOT}/${PUBLIC_DOWNLOAD_FOLDER}/${folderName}`;
    return `content://${EXTERNAL_STORAGE_DOCUMENTS_AUTHORITY}/document/${encodeURIComponent(documentId)}`;
  }
  return buildCustomTreeDocumentUri(location.treeUri, folderName);
}

/**
 * Builds a genuine tree-scoped document URI
 * (`content://<authority>/tree/<treeDocId>/document/<childDocId>`) for
 * `folderName` under the user-picked SAF tree — **not** what
 * `react-native-saf-x`'s own `stat()`/`exists()` return for a path shaped
 * `<treeUri>/<name>`.
 *
 * Found live on device (RMX3997): handing `stat()`'s returned `uri`
 * straight to `actionViewIntent` with the directory MIME type opened
 * DocumentsUI, but landed on its generic "Download" root instead of the
 * picked folder, logging `Invalid root Uri`. Reading
 * `DocumentStat.getWritableMap()` (react-native-saf-x's own native source)
 * explains why: for a child whose document id contains the tree's own
 * document id as a substring — true for any ordinary nested child — it
 * deliberately returns a *tree*-shaped URI
 * (`DocumentsContract.buildTreeDocumentUri`) rather than a document URI
 * scoped to the originally granted tree. That shape round-trips fine
 * through the library's own calls (which re-resolve it via persisted-
 * permission matching, see downloadedFileExists/downloadedFilePath above),
 * but Android's own DocumentsUI only recognizes a tree URI as a browsable
 * "root" if it's the exact URI it originally granted — a synthesized one
 * fails that check. The fix is the same shape default mode's own
 * `documentId` construction above already uses successfully: build the
 * child's document id by appending to the *tree's* document id (parsed out
 * of the persisted `treeUri` itself) and nest it under that tree via
 * `/tree/<treeDocId>/document/<childDocId>` — matching what
 * `DocumentsContract.buildDocumentUriUsingTree` produces natively.
 */
function buildCustomTreeDocumentUri(treeUri: string, folderName: string): string | null {
  const match = treeUri.match(/^content:\/\/([^/]+)\/tree\/([^/]+)$/);
  if (!match) {
    return null;
  }
  const [, authority, encodedTreeDocId] = match;
  const treeDocId = decodeURIComponent(encodedTreeDocId);
  const childDocId = `${treeDocId}/${folderName}`;
  return `content://${authority}/tree/${encodeURIComponent(treeDocId)}/document/${encodeURIComponent(childDocId)}`;
}
