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

import ReactNativeBlobUtil from 'react-native-blob-util';
import { ApiError } from '../api/client';

export interface StreamTask {
  promise: Promise<void>;
  cancel: () => void;
}

const CANCEL_ERROR_NAME = 'ReactNativeBlobUtilCanceledFetch';
const PROGRESS_CONFIG = { interval: 250 };

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
      await ReactNativeBlobUtil.fs.unlink(destPath).catch(() => undefined);
      throw new ApiError(describeStreamError(status), status);
    }
  })();

  return { promise, cancel: () => task.cancel() };
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
      throw new ApiError(extractMessage(response) ?? describeStreamError(status), status);
    }
  })();

  return { promise, cancel: () => task.cancel() };
}

function extractMessage(response: { json: () => unknown }): string | null {
  try {
    const body = response.json() as { message?: unknown };
    return typeof body.message === 'string' ? body.message : null;
  } catch {
    return null;
  }
}
