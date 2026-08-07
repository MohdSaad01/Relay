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

const MEDIASTORE_MIN_SDK = 29;
const PUBLIC_DOWNLOAD_FOLDER = 'Relay';

/**
 * Exported for downloadActions.ts's "Open" action, which needs the actual
 * on-device path to hand to react-native-blob-util's actionViewIntent, not
 * just a yes/no existence check.
 */
export function downloadedFilePath(fileName: string): string {
  const { LegacyDownloadDir, DocumentDir } = ReactNativeBlobUtil.fs.dirs;
  return Number(Platform.Version) >= MEDIASTORE_MIN_SDK
    ? `${LegacyDownloadDir}/${PUBLIC_DOWNLOAD_FOLDER}/${fileName}`
    : `${DocumentDir}/Downloads/${fileName}`;
}

/** Best-effort: any failure to check (e.g. an unreadable path) is treated as "not there". */
export async function downloadedFileExists(fileName: string): Promise<boolean> {
  try {
    return await ReactNativeBlobUtil.fs.exists(downloadedFilePath(fileName));
  } catch {
    return false;
  }
}
