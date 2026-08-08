/**
 * Local, self-owned record of which on-device file name a given shared file
 * (shared_file_id) actually downloaded to (P16) — the standalone-file analog
 * of folderIdentity.ts's localRoot mapping (P13.2, Issue 1).
 *
 * The backend has no concept of this: a downloaded file's destination name
 * is always the shared file's raw file_name, undisambiguated — two
 * different shared files that happen to carry the same display name (e.g.
 * two desktop shares both named "report.txt") both start from the same raw
 * name. Write-side collision handling already exists
 * (streaming/blobUtil.ts's resolveAvailableDownloadName, Milestone P3) — it
 * renames the second download's physical file to "report (1).txt" before
 * ever writing it — but nothing previously remembered *which*
 * shared_file_id actually landed on which resolved name: every read-side
 * call (existence checks, Open) kept asking about the shared file's own raw
 * file_name, so two same-named files read and wrote through the exact same
 * on-device path regardless of which row was involved — deleting either
 * file's physical copy flipped *both* rows back to "Download", and tapping
 * "Open" on either row could open the other file's content. Confirmed live
 * on RMX3997 — see docs/15_QA_NOTEBOOK.md's Milestone P16 entry.
 *
 * Resolved once, before a standalone file's bytes start moving
 * (streaming/TransferStreamManager.ts's resolveDownloadRelativePath), and
 * permanently remembered — exactly like folderIdentity.ts's
 * resolveLocalFolderRoot — so every later reference to that shared_file_id
 * (a re-download after external deletion, an existence check, the Open
 * action) consistently resolves to the same physical file instead of
 * re-deriving (and potentially re-renaming) it.
 *
 * Deliberately a separate registry file from folderIdentity.ts's, not a
 * shared one: a file's identity has no reconciliation concept (a leaf file
 * either exists or it doesn't; there's no set of children to compare
 * against), so conflating the two would blur what are otherwise two
 * structurally distinct sources of truth, matching this codebase's existing
 * file/folder module split (downloadStatus.ts vs folderDownloadStatus.ts).
 * Same storage rationale as folderIdentity.ts: a small JSON file under this
 * app's own private storage via react-native-blob-util (already a
 * dependency), not a new persistence technology (CLAUDE.md Rule 2).
 */

import ReactNativeBlobUtil from 'react-native-blob-util';
import { downloadedFileExists } from './downloadExistence';

const REGISTRY_PATH = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/relay-file-registry.json`;

/** shared_file_id (as a string key) -> resolved on-device file name. */
type Registry = Record<string, string>;

async function readRegistry(): Promise<Registry> {
  try {
    const raw = await ReactNativeBlobUtil.fs.readFile(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== 'object') {
      return {};
    }
    const registry: Registry = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        registry[key] = value;
      }
    }
    return registry;
  } catch {
    // No registry file yet (first-ever standalone-file download on this
    // install) or a corrupted one — either way, treated as "no mappings
    // known", matching folderIdentity.ts's own readRegistry.
    return {};
  }
}

async function writeRegistry(registry: Registry): Promise<void> {
  await ReactNativeBlobUtil.fs.writeFile(REGISTRY_PATH, JSON.stringify(registry), 'utf8');
}

/**
 * Finds a file name under the current download destination (P14.3) that
 * isn't already occupied, resolving a conflict with the same "name
 * (1).ext" pattern blobUtil.ts's resolveAvailableDownloadName already uses
 * at write time.
 *
 * A name is "taken" if EITHER an on-device stat finds it OR some other
 * registry entry has already claimed it — mirrors folderIdentity.ts's
 * findAvailableRootName (P13.3): this name is reserved here, synchronously,
 * before any bytes actually land on disk, so two never-before-seen
 * same-named files resolved in quick succession must not both resolve to
 * the same still-nonexistent name.
 */
async function findAvailableFileName(registry: Registry, rawFileName: string): Promise<string> {
  const reservedNames = new Set(Object.values(registry));
  const isTaken = async (name: string): Promise<boolean> => {
    if (reservedNames.has(name)) {
      return true;
    }
    return downloadedFileExists(name);
  };

  if (!(await isTaken(rawFileName))) {
    return rawFileName;
  }
  const dotIndex = rawFileName.lastIndexOf('.');
  const base = dotIndex > 0 ? rawFileName.slice(0, dotIndex) : rawFileName;
  const ext = dotIndex > 0 ? rawFileName.slice(dotIndex) : '';
  for (let counter = 1; ; counter++) {
    const candidate = `${base} (${counter})${ext}`;
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }
}

// A single global mutex, matching folderIdentity.ts's own reasoning: every
// function below does its own read-modify-write of the one shared registry
// file, so two calls racing (e.g. two never-before-seen same-named files
// resolved back-to-back) could otherwise clobber each other's write.
let mutex: Promise<unknown> = Promise.resolve();

function withRegistryLock<T>(fn: (registry: Registry) => Promise<T>): Promise<T> {
  const run = mutex.then(async () => fn(await readRegistry()));
  mutex = run.catch(() => undefined);
  return run;
}

/**
 * Returns the on-device file name for `sharedFileId`, resolving and
 * permanently remembering one on first call for that id, or returning the
 * already-remembered one on every call after — the file-level mirror of
 * folderIdentity.ts's resolveLocalFolderRoot. Safe to call redundantly: a
 * re-download after external deletion resolves back to the exact same name
 * instead of drifting to a fresh "(2)".
 */
export function resolveLocalFileName(sharedFileId: number, rawFileName: string): Promise<string> {
  return withRegistryLock(async registry => {
    const key = String(sharedFileId);
    const existing = registry[key];
    if (existing) {
      return existing;
    }
    const localName = await findAvailableFileName(registry, rawFileName);
    registry[key] = localName;
    await writeRegistry(registry);
    return localName;
  });
}

/**
 * Every shared file's resolved on-device name in one read, keyed by
 * shared_file_id — lets FilesScreen check/open the actual physical file a
 * completed download landed on, instead of every row falling back to its
 * own possibly-colliding raw file_name. A file never downloaded (or whose
 * download never successfully published — see streaming/blobUtil.ts's
 * publishDownload doc comment on best-effort publishing) has no entry.
 */
export function readAllLocalFileNames(): Promise<Record<number, string>> {
  return withRegistryLock(async registry => {
    const result: Record<number, string> = {};
    for (const [key, value] of Object.entries(registry)) {
      result[Number(key)] = value;
    }
    return result;
  });
}
