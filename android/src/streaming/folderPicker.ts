/**
 * Lets the user pick a local folder to upload (P13, Android -> desktop
 * direction) and recursively enumerates its contents into a flat file
 * manifest — the shape TransferListScreen needs to propose one
 * POST /transfers/requests per file.
 *
 * Built on react-native-saf-x, not @react-native-documents/picker (already
 * used elsewhere in this app for single-file picking): that picker's
 * pickDirectory() only returns a SAF tree URI, with no API to list what's
 * inside it. react-native-saf-x's listFiles() is a small, purpose-built
 * library for exactly that gap — see the P13 architecture decision in the
 * project's milestone history for why a new dependency was chosen here over
 * hand-rolling a native DocumentsContract module.
 */

import { openDocumentTree, listFiles, copyFile } from 'react-native-saf-x';
import ReactNativeBlobUtil from 'react-native-blob-util';

export interface PickedFolderEntry {
  uri: string;
  /** POSIX-style (forward-slash), relative to the picked folder's own root — does NOT include the folder's own name, matching the backend's shared_files.relative_path convention. */
  relativePath: string;
  size: number;
  mimeType: string | null;
}

export interface PickedFolder {
  folderName: string;
  files: PickedFolderEntry[];
}

/**
 * Opens the SAF directory picker and walks the chosen tree. Returns null if
 * the user cancels.
 *
 * `persist: true` (P13, found live on a real device — realme C65 5G,
 * Android 16/API 36): without it, react-native-saf-x's own `listFiles()`
 * call on the returned root URI intermittently rejected with "Unsupported
 * Uri" on this device, even though the exact same call succeeds once the
 * grant is persisted. This app has no other use for standing access across
 * restarts (V1 has no resume support), so persisting is purely a
 * workaround for that native-side URI resolution issue, not a feature this
 * app actually needs — the permission grant is never explicitly released,
 * which will accumulate one persisted grant per folder picked; an accepted
 * V1 trade-off (Android caps persisted grants per app in the hundreds, well
 * above what a single user's folder-picking sessions would reach).
 */
export async function pickAndEnumerateFolder(): Promise<PickedFolder | null> {
  const root = await openDocumentTree(true);
  if (!root) {
    return null;
  }
  const files: PickedFolderEntry[] = [];
  await walk(root.uri, '', files);
  return { folderName: root.name, files };
}

async function walk(uri: string, relativePrefix: string, out: PickedFolderEntry[]): Promise<void> {
  const entries = await listFiles(uri);
  for (const entry of entries) {
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    if (entry.type === 'directory') {
      await walk(entry.uri, relativePath, out);
    } else {
      out.push({ uri: entry.uri, relativePath, size: entry.size, mimeType: entry.mime || null });
    }
  }
}

/**
 * Copies a SAF-picked file to a private local cache path and returns that
 * path, ready for react-native-blob-util's `wrap()` (used by
 * streaming/blobUtil.ts's uploadFile).
 *
 * Found live on a real device (P13): react-native-blob-util's `wrap()` —
 * already proven for @react-native-documents/picker's single-file `uri`s —
 * silently reads zero bytes from a react-native-saf-x tree-child URI (the
 * upload reaches the backend but fails with "ended before the declared
 * file size was reached"). react-native-saf-x's own `copyFile` (a native
 * SAF-to-plain-file copy, not a JS-bridged base64 round-trip) sidesteps
 * this entirely by giving `wrap()` an ordinary local path instead — exactly
 * the URI shape it already works with.
 *
 * The cache copy is not explicitly deleted after the upload completes —
 * an accepted V1 trade-off, matching the backend's own tolerance for
 * unswept temp files (app/services/transfer_stream_service.py's
 * `_UPLOAD_TEMP_FILE_PREFIX` orphans) — the OS reclaims app cache space
 * under storage pressure regardless.
 */
export async function materializeToLocalCache(sourceUri: string, fileName: string): Promise<string> {
  const destPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/relay-upload-${Date.now()}-${fileName}`;
  await copyFile(sourceUri, `file://${destPath}`, { replaceIfDestinationExists: true });
  return destPath;
}
