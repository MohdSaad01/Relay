/**
 * Thin wrapper around react-native-blob-util for the two byte-streaming
 * endpoints (GET /transfers/{id}/download, POST /transfers/{id}/upload).
 * Not built on api/client.ts — that wrapper reads a JSON envelope into
 * memory, which is exactly what streaming a large file must avoid.
 *
 * Download writes the response directly to `destPath` as it arrives
 * (react-native-blob-util's `path` config), never buffering the whole file
 * in JS. Upload streams the source file's bytes as the raw request body via
 * `wrap()`, matching the backend's `request.stream()` contract — not
 * multipart `FormData`, which the upload route does not parse.
 */

import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { copyFile as safCopyFile, stat as safStat } from 'react-native-saf-x';
import { ApiError } from '../api/client';
import { downloadedFileExists } from '../files/downloadExistence';
import { DownloadLocationManager } from '../settings/DownloadLocationManager';
import { DownloadLocation } from '../settings/types';

export interface StreamTask {
  promise: Promise<void>;
  cancel: () => void;
}

const CANCEL_ERROR_NAME = 'ReactNativeBlobUtilCanceledFetch';
const PROGRESS_CONFIG = { interval: 250 };

// MediaStore.Downloads (used by publishDownload, below) was introduced in
// Android 10 (API 29); there is no equivalent public-storage API on older
// versions without a legacy WRITE_EXTERNAL_STORAGE permission this app does
// not request, so downloads below this SDK stay at their private staging
// path — see TransferStreamManager's downloadStagingPath. Only applies to
// the default location (P14.3) — a custom SAF location has no such floor.
const MEDIASTORE_MIN_SDK = 29;
const PUBLIC_DOWNLOAD_FOLDER = 'Relay';

export function isStreamCancelError(err: unknown): boolean {
  return err instanceof Error && err.name === CANCEL_ERROR_NAME;
}

/**
 * P13, empty-folder edge case: a shared folder with zero files has nothing
 * to stream, so nothing would otherwise ever run for it on Android — no
 * download call, no publishDownload. MediaStore fundamentally has no way to
 * represent an empty directory (it only ever tracks files via their
 * RELATIVE_PATH column), so there is no public-storage equivalent of this;
 * this creates the folder in the app's own private staging area only
 * (DocumentDir/Downloads/<folderName>), as a visible, best-effort
 * acknowledgement that the folder was "downloaded" even though it holds
 * nothing. Never throws — this is a courtesy action, not a correctness one.
 */
export async function ensureEmptyFolderStaged(folderName: string): Promise<void> {
  const path = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/Downloads/${folderName}`;
  await ReactNativeBlobUtil.fs.mkdir(path).catch(() => undefined);
}

/** Status codes are documented in backend/README.md's "Transfer API" streaming table. */
function describeStreamError(status: number): string {
  switch (status) {
    case 400:
      return 'The file changed or is no longer available.';
    case 401:
      return 'Your session has expired.';
    case 404:
      return 'This transfer no longer exists.';
    case 409:
      return 'This transfer is not currently active.';
    default:
      return `The transfer failed (${status}).`;
  }
}

export function downloadFile(
  url: string,
  headers: Record<string, string>,
  destPath: string,
  expectedBytes: number,
  onProgress: (received: number, total: number) => void,
): StreamTask {
  const task = ReactNativeBlobUtil.config({ path: destPath, overwrite: true }).fetch('GET', url, headers);
  task.progress(PROGRESS_CONFIG, onProgress);

  const promise = (async () => {
    let response;
    try {
      response = await task;
    } catch (err) {
      if (await isActuallyComplete(err, destPath, expectedBytes)) {
        return;
      }
      throw err;
    }
    const status = response.info().status;
    if (status < 200 || status >= 300) {
      // The response body was already written to destPath regardless of
      // status (the library doesn't know it's an error until it's done) —
      // don't leave an error-body file behind masquerading as the download.
      const message = (await extractMessage(response)) ?? describeStreamError(status);
      await ReactNativeBlobUtil.fs.unlink(destPath).catch(() => undefined);
      throw new ApiError(message, status);
    }
  })();

  return { promise, cancel: () => task.cancel() };
}

/**
 * react-native-blob-util's native FileStorage completion check compares
 * bytes-written against the response's parsed Content-Length and rejects
 * with "Download interrupted" on any mismatch. On real (non-loopback)
 * connections that check has been observed to false-negative on larger,
 * multi-chunk downloads even though every byte already reached destPath —
 * see docs/15_QA_NOTEBOOK.md's Milestone P7 entry. Trust the file that's
 * actually on disk over that check: if it's already the declared size, the
 * download really did finish and this rejection is spurious. A genuine
 * cancellation is exempt — it must always propagate, never be masked by a
 * coincidentally-complete partial file.
 */
async function isActuallyComplete(err: unknown, destPath: string, expectedBytes: number): Promise<boolean> {
  if (isStreamCancelError(err)) {
    return false;
  }
  const stat = await ReactNativeBlobUtil.fs.stat(destPath).catch(() => null);
  return stat != null && Number(stat.size) === expectedBytes;
}

/**
 * Finds a display name under the current download destination (or, for a
 * folder download — P13 — <destination>/<folder path>) that isn't already
 * taken, resolving a conflict (if any) with the same "name (1).ext", "name
 * (2).ext" pattern the backend already uses for uploads (`backend/app/
 * utils/filesystem.resolve_available_path`). Downloads have no equivalent
 * on the Android side: neither `copyToMediaStore` (default location) nor
 * SAF's `copyFile` (custom location, P14.3) rename on conflict themselves,
 * and the same file name is a genuinely reachable case (re-downloading the
 * same shared file, or two different shared files that happen to share a
 * basename) — see docs/15_QA_NOTEBOOK.md's Milestone P3 entry.
 *
 * `relativePath` is the full path under the destination root (e.g.
 * "University Notes/Semester 1/DBMS.pdf" for a folder child, or just
 * "photo.jpg" for a standalone file) — only its own basename is ever
 * renamed; the directory portion is preserved as-is.
 *
 * Existence is checked via `downloadedFileExists` — the same mode-aware
 * check `files/downloadExistence.ts` uses for its own on-device existence
 * check — so unique-naming keeps working whether the current destination is
 * the default public Downloads/Relay or a user-picked custom folder.
 */
async function resolveAvailableDownloadName(relativePath: string): Promise<string> {
  if (!(await downloadedFileExists(relativePath))) {
    return relativePath;
  }

  const lastSlash = relativePath.lastIndexOf('/');
  const dirPrefix = lastSlash >= 0 ? relativePath.slice(0, lastSlash + 1) : '';
  const fileName = lastSlash >= 0 ? relativePath.slice(lastSlash + 1) : relativePath;
  const dotIndex = fileName.lastIndexOf('.');
  const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex > 0 ? fileName.slice(dotIndex) : '';
  for (let counter = 1; ; counter++) {
    const candidate = `${dirPrefix}${base} (${counter})${ext}`;
    if (!(await downloadedFileExists(candidate))) {
      return candidate;
    }
  }
}

/**
 * Copies a fully-downloaded file out of its private staging path
 * (app-internal storage, invisible to the Downloads app, any file manager,
 * or media/file search) into the currently configured download destination
 * (P14.3 — settings/DownloadLocationManager), then removes the staging
 * copy. Dispatches to whichever of the two publish strategies matches the
 * current destination; both share the same conflict-free naming
 * (`resolveAvailableDownloadName`) and the same "verify what's really on
 * disk, don't trust the library's return value" discipline (see each
 * strategy's own doc comment for why).
 *
 * Best-effort and never throws: the transfer has already fully received its
 * bytes by the time this runs (it's only ever called after a download's
 * StreamTask resolves), and V1 has no retry, so a failure here must not
 * turn an otherwise-successful transfer into a reported failure — it just
 * leaves the file at its private staging path instead.
 *
 * Returns the resulting `content://` URI on success, so a caller (the
 * download-complete notification) can offer to open the file directly — or
 * null when publishing didn't happen (pre-API 29 in default mode) or failed.
 */
export async function publishDownload(stagingPath: string, relativePath: string): Promise<string | null> {
  const location = DownloadLocationManager.getLocation();
  return location.mode === 'default'
    ? publishToDefaultLocation(stagingPath, relativePath)
    : publishToCustomLocation(location, stagingPath, relativePath);
}

/**
 * The default (unconfigured) destination — public MediaStore Downloads/Relay
 * on API 29+, or (below that SDK) a no-op that leaves the file at its
 * private staging path. Requires no storage permission — MediaStore.Downloads
 * is writable by any app on API 29+ without one.
 *
 * `relativePath` (P13) is the full path under Relay/ — e.g. "University
 * Notes/Semester 1/DBMS.pdf" for a folder child, or just "photo.jpg" for a
 * standalone file (the pre-P13 shape). Only the trailing segment is ever
 * renamed on conflict; MediaStore's RELATIVE_PATH column natively supports
 * nested subdirectories under Downloads/ on API 29+, so `parentFolder` here
 * carries the full directory portion, not just the fixed "Relay" constant.
 *
 * `copyToMediaStore` is not trusted at face value: on at least one real
 * device (RMX3997, Android 16/API 36 — see docs/15_QA_NOTEBOOK.md's
 * Milestone P8.1 entry), the underlying react-native-blob-util native call
 * resolves with a seemingly-valid content URI while the file it points to
 * never actually lands (or is immediately truncated) in the public folder —
 * no exception is thrown, so this function's own try/catch never saw it.
 * The publish is therefore verified by statting the real destination path
 * and comparing its size against the staged file's — only a byte-for-byte
 * match counts as success.
 */
async function publishToDefaultLocation(stagingPath: string, relativePath: string): Promise<string | null> {
  if (Number(Platform.Version) < MEDIASTORE_MIN_SDK) {
    return null;
  }
  try {
    const stagedSize = Number((await ReactNativeBlobUtil.fs.stat(stagingPath)).size);
    const targetRelativePath = await resolveAvailableDownloadName(relativePath);
    const lastSlash = targetRelativePath.lastIndexOf('/');
    const targetName = lastSlash >= 0 ? targetRelativePath.slice(lastSlash + 1) : targetRelativePath;
    const targetSubdir = lastSlash >= 0 ? targetRelativePath.slice(0, lastSlash) : '';
    const parentFolder = targetSubdir ? `${PUBLIC_DOWNLOAD_FOLDER}/${targetSubdir}` : PUBLIC_DOWNLOAD_FOLDER;
    const contentUri = await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
      { name: targetName, parentFolder, mimeType: 'application/octet-stream' },
      'Download',
      stagingPath,
    );
    if (!(await isPublishedAtDefaultLocation(targetRelativePath, stagedSize))) {
      console.warn(
        'copyToMediaStore reported success but the file is missing or incomplete at its public destination; leaving it in private storage.',
      );
      return null;
    }
    await ReactNativeBlobUtil.fs.unlink(stagingPath).catch(() => undefined);
    return contentUri;
  } catch (err) {
    console.warn('Could not publish download to public storage; file remains in private storage.', err);
    return null;
  }
}

/**
 * Statted via `LegacyDownloadDir` (`Environment.getExternalStoragePublicDirectory`),
 * not `DownloadDir` (`Context.getExternalFilesDir`, the app's own private
 * scoped-storage directory) — despite the name, `LegacyDownloadDir` is the
 * one that actually resolves to the true public Downloads folder
 * `copyToMediaStore` publishes into on every API level, `DownloadDir` does
 * not. Confirmed live on device (RMX3997, API 36, docs/15_QA_NOTEBOOK.md's
 * Milestone P9.1 entry): using `DownloadDir` here made this check stat a
 * directory that doesn't even exist, so it failed unconditionally — even for
 * a `copyToMediaStore` call that had genuinely and correctly published the
 * file to `LegacyDownloadDir`/Relay.
 */
async function isPublishedAtDefaultLocation(relativePath: string, expectedBytes: number): Promise<boolean> {
  const dir = `${ReactNativeBlobUtil.fs.dirs.LegacyDownloadDir}/${PUBLIC_DOWNLOAD_FOLDER}`;
  const stat = await ReactNativeBlobUtil.fs.stat(`${dir}/${relativePath}`).catch(() => null);
  return stat != null && Number(stat.size) === expectedBytes;
}

/**
 * A user-picked SAF folder (P14.3 — settings/DownloadLocationManager).
 * `react-native-saf-x`'s `copyFile` resolves a destination shaped
 * `<tree-uri>/<relative/path>` by walking/creating each path segment from
 * the persisted tree root (confirmed by reading its native
 * `EfficientDocumentHelper.transferFile`/`createFile` implementation),
 * auto-creating any missing nested directories — the same "just works for a
 * folder child's nested path" property `copyToMediaStore`'s
 * `parentFolder` already has in default mode, so no separate `mkdir` calls
 * are needed here.
 *
 * Mirrors `publishToDefaultLocation`'s own "don't trust the library's
 * return value" discipline (P8.1): the publish is verified by statting the
 * real destination and comparing its size against the staged file's.
 */
async function publishToCustomLocation(
  location: Extract<DownloadLocation, { mode: 'custom' }>,
  stagingPath: string,
  relativePath: string,
): Promise<string | null> {
  try {
    const stagedSize = Number((await ReactNativeBlobUtil.fs.stat(stagingPath)).size);
    const targetRelativePath = await resolveAvailableDownloadName(relativePath);
    const destUri = `${location.treeUri}/${targetRelativePath}`;
    await safCopyFile(`file://${stagingPath}`, destUri);
    const publishedStat = await safStat(destUri).catch(() => null);
    if (!publishedStat || Number(publishedStat.size) !== stagedSize) {
      console.warn(
        'copyFile reported success but the file is missing or incomplete at its destination; leaving it in private storage.',
      );
      return null;
    }
    await ReactNativeBlobUtil.fs.unlink(stagingPath).catch(() => undefined);
    return publishedStat.uri;
  } catch (err) {
    console.warn('Could not publish download to the selected folder; file remains in private storage.', err);
    return null;
  }
}

export function uploadFile(
  url: string,
  headers: Record<string, string>,
  fileUri: string,
  onProgress: (sent: number, total: number) => void,
): StreamTask {
  const body = ReactNativeBlobUtil.wrap(fileUri);
  const task = ReactNativeBlobUtil.fetch(
    'POST',
    url,
    { ...headers, 'Content-Type': 'application/octet-stream' },
    body,
  );
  task.uploadProgress(PROGRESS_CONFIG, onProgress);

  const promise = (async () => {
    const response = await task;
    const status = response.info().status;
    if (status < 200 || status >= 300) {
      throw new ApiError((await extractMessage(response)) ?? describeStreamError(status), status);
    }
  })();

  return { promise, cancel: () => task.cancel() };
}

// response.json() is synchronous for the upload path's default response type,
// but returns a Promise for the download path's 'path' response type (it reads
// destPath off disk to parse it) — awaiting a non-Promise value is a no-op, so
// this handles both without the caller needing to know which mode it's in.
async function extractMessage(response: { json: () => unknown }): Promise<string | null> {
  try {
    const body = (await response.json()) as { message?: unknown };
    return typeof body.message === 'string' ? body.message : null;
  } catch {
    return null;
  }
}
