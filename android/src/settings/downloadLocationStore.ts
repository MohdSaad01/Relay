/**
 * Persists the user's chosen download destination as a small private JSON
 * file — the same technique files/folderIdentity.ts already established for
 * local app state with no natural home elsewhere (react-native-blob-util's
 * fs.readFile/writeFile, already a dependency). Unlike folderIdentity.ts's
 * registry, this setting has exactly one current value and exactly one
 * writer (the Settings screen), so no mutex is needed.
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import { DownloadLocation } from './types';

const STORE_PATH = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/relay-download-location.json`;

const DEFAULT_LOCATION: DownloadLocation = { mode: 'default' };

function isValidLocation(value: unknown): value is DownloadLocation {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.mode === 'default') {
    return true;
  }
  return (
    candidate.mode === 'custom' &&
    typeof candidate.treeUri === 'string' &&
    typeof candidate.displayName === 'string'
  );
}

/** Falls back to the default location for a missing, corrupted, or unrecognized stored value. */
export async function readDownloadLocation(): Promise<DownloadLocation> {
  try {
    const raw = await ReactNativeBlobUtil.fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isValidLocation(parsed) ? parsed : DEFAULT_LOCATION;
  } catch {
    return DEFAULT_LOCATION;
  }
}

export async function writeDownloadLocation(location: DownloadLocation): Promise<void> {
  await ReactNativeBlobUtil.fs.writeFile(STORE_PATH, JSON.stringify(location), 'utf8');
}
