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
import { ApiError } from '../api/client';

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
// path — see TransferStreamManager's downloadStagingPath.
const MEDIASTORE_MIN_SDK = 29;
const PUBLIC_DOWNLOAD_FOLDER = 'Relay';

export function isStreamCancelError(err: unknown): boolean {
  return err instanceof Error && err.name === CANCEL_ERROR_NAME;
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
  onProgress: (received: number, total: number) => void,
): StreamTask {
  const task = ReactNativeBlobUtil.config({ path: destPath, overwrite: true }).fetch('GET', url, headers);
  task.progress(PROGRESS_CONFIG, onProgress);

  const promise = (async () => {
    const response = await task;
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
 * Copies a fully-downloaded file out of its private staging path
 * (app-internal storage, invisible to the Downloads app, any file manager,
 * or media/file search) into the public Downloads/Relay folder via
 * MediaStore, then removes the staging copy. Requires no storage permission
 * — MediaStore.Downloads is writable by any app on API 29+ without one.
 *
 * Best-effort and never throws: the transfer has already fully received its
 * bytes by the time this runs (it's only ever called after a download's
 * StreamTask resolves), and V1 has no retry, so a failure here must not
 * turn an otherwise-successful transfer into a reported failure — it just
 * leaves the file at its private staging path instead.
 *
 * Returns the resulting `content://` MediaStore URI on success, so a caller
 * (the download-complete notification) can offer to open the file directly
 * — or null when publishing didn't happen (pre-API 29) or failed.
 */
export async function publishDownload(stagingPath: string, fileName: string): Promise<string | null> {
  if (Number(Platform.Version) < MEDIASTORE_MIN_SDK) {
    return null;
  }
  try {
    const contentUri = await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
      { name: fileName, parentFolder: PUBLIC_DOWNLOAD_FOLDER, mimeType: 'application/octet-stream' },
      'Download',
      stagingPath,
    );
    await ReactNativeBlobUtil.fs.unlink(stagingPath).catch(() => undefined);
    return contentUri;
  } catch (err) {
    console.warn('Could not publish download to public storage; file remains in private storage.', err);
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
