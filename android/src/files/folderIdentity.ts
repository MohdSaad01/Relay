/**
 * Local, self-owned record of two things a shared folder's backend data
 * cannot tell Android by itself (P13.2):
 *
 * 1. `localRoot` (Issue 1) — which on-device root directory name a given
 *    shared folder (shared_folder_id) actually downloads into. The backend
 *    has no concept of this: a folder child's `folder_relative_path` always
 *    leads with the shared folder's raw `folder_name`
 *    (`backend/app/services/transfer_service.py`), unchanged and
 *    undisambiguated — two different shared folders that happen to carry
 *    the same display name both resolve to the same raw leading segment.
 *    Per-file conflict handling (`streaming/blobUtil.ts`'s
 *    `resolveAvailableMediaStoreName`) only ever renames a *file's* own
 *    basename on collision, never a folder's — so two such folders
 *    previously merged into one physical Downloads/Relay directory (see
 *    docs/15_QA_NOTEBOOK.md's Milestone P13.1 entry, which first surfaced
 *    this as an accepted, then out-of-scope, limitation). The first time a
 *    given shared_folder_id is ever downloaded, this module resolves a free
 *    root name on-device (the same "name (1)" pattern already used for
 *    files) and remembers the mapping permanently, so every later
 *    reference to that folder — later children of the same download, a
 *    re-download after the folder changes, the "Open" action, the
 *    completion notification — consistently lands on the same physical
 *    directory instead of re-resolving (and potentially re-renaming) it.
 *
 * 2. `reconciledChildren` (Issue 2) — the (relative_path -> file_size) shape
 *    this folder's shared contents had the last time this app confirmed its
 *    on-device copy actually matched them. Deliberately *not* derived from
 *    Transfer history (backend/app/models/transfer.py's own point-in-time
 *    file_size/folder_relative_path snapshots), even though that data can
 *    answer "does this one child's downloaded copy match what's currently
 *    shared" — an earlier version of this milestone's fix used exactly that
 *    and failed physical verification: a file *removed* from the share
 *    leaves an orphaned completed Transfer row behind forever (nothing ever
 *    re-downloads it to produce a newer Transfer that would supersede that
 *    entry), which permanently poisoned the "does the downloaded set have
 *    any extra members" check with no way to self-heal even after the user
 *    re-downloaded and every other child matched. `reconciledChildren` fixes
 *    this by being something this app itself overwrites wholesale — with
 *    exactly the current children, nothing more — every time a folder
 *    download actually finishes (FilesScreen.handleFolderDownload finding
 *    nothing left pending, or TransferStreamManager.notifyIfFolderComplete
 *    observing the last child finish), so a removal-only update clears
 *    itself the same way an addition or resize does.
 *
 * Deliberately not a general-purpose key/value store: this app has no
 * existing local persistence layer for arbitrary data (session/secureStorage.ts
 * is a single-entry Keychain blob for one credential, not a fit here — see
 * its own doc comment), and adding a dependency like AsyncStorage or MMKV
 * for this one small mapping would be a new technology this milestone's
 * scope doesn't call for (CLAUDE.md Rule 2). A single JSON file under this
 * app's own private storage, read/written via react-native-blob-util (already
 * a dependency, already used this way throughout streaming/blobUtil.ts),
 * is the smallest fit. Living in private storage (not the public Relay
 * folder itself) means a mapping is lost if the app is reinstalled while a
 * previously-downloaded folder survives on disk — an accepted, narrow edge
 * case: the next time that shared_folder_id is touched, it resolves as if
 * seen for the first time, which may mint a "(1)"-suffixed sibling next to
 * the orphaned original, and its row starts back at "Download" until
 * re-confirmed. Documented as a known limitation rather than solved here
 * (see docs/15_QA_NOTEBOOK.md's P13.2 entry).
 */

import ReactNativeBlobUtil from 'react-native-blob-util';
import { downloadedFileExists } from './downloadExistence';

const REGISTRY_PATH = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/relay-folder-registry.json`;

interface RegistryEntry {
  localRoot: string;
  /**
   * The owning SharedFolder's `shared_at` (P17) at the moment this entry was
   * resolved — a proxy for "which logical folder this shared_folder_id
   * actually pointed to", since the id itself is only unique while that
   * row exists: SQLite's plain `INTEGER PRIMARY KEY` (no AUTOINCREMENT,
   * confirmed against backend/relay.db's schema — no sqlite_sequence table)
   * reuses a rowid once the table empties, so a folder deleted and later
   * replaced by an unrelated one can resolve to the exact same
   * shared_folder_id. `shared_at` is set once at row creation
   * (SharedFolderService.share_folder) and never touched by a refresh of
   * the same still-shared path, so two different logical folders that ever
   * share an id are guaranteed to carry different `sharedAt` values, while
   * re-sharing the same live folder keeps the same one. Absent on an entry
   * written before this field existed (legacy/cold-start — see
   * resolveLocalFolderRoot) or one TransferStreamManager created without a
   * live folder object on hand; such an entry is trusted at face value
   * rather than invalidated, since there is nothing to compare it against.
   */
  sharedAt?: string;
  reconciledChildren?: Record<string, number>;
}

type Registry = Record<string, RegistryEntry>;

/**
 * Normalizes one raw registry value into the current RegistryEntry shape.
 * Pre-P13.2-Issue-2 builds stored this registry's values as bare strings
 * (the local root name only) rather than `{ localRoot, reconciledChildren }`
 * — reading one of those back with today's shape would silently resolve
 * `existing.localRoot` to `undefined` (a string has no such property) rather
 * than throwing, so a stale on-device registry from before this record
 * gained its second field would quietly corrupt every path built from it.
 * A bare string is therefore treated as a legacy `localRoot` with no
 * reconciliation record yet, which is exactly what it was.
 */
function normalizeEntry(value: unknown): RegistryEntry | undefined {
  if (typeof value === 'string') {
    return { localRoot: value };
  }
  if (value != null && typeof value === 'object' && typeof (value as RegistryEntry).localRoot === 'string') {
    return value as RegistryEntry;
  }
  return undefined;
}

async function readRegistry(): Promise<Registry> {
  try {
    const raw = await ReactNativeBlobUtil.fs.readFile(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== 'object') {
      return {};
    }
    const registry: Registry = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = normalizeEntry(value);
      if (entry) {
        registry[key] = entry;
      }
    }
    return registry;
  } catch {
    // No registry file yet (first-ever folder download on this install) or a
    // corrupted one — either way, treated as "no mappings known", exactly
    // like secureStorage.ts's own handling of an unreadable stored session.
    return {};
  }
}

async function writeRegistry(registry: Registry): Promise<void> {
  await ReactNativeBlobUtil.fs.writeFile(REGISTRY_PATH, JSON.stringify(registry), 'utf8');
}

/**
 * Finds a directory name under the current download destination (P14.3 —
 * settings/DownloadLocationManager; default Downloads/Relay, the private
 * staging equivalent below MEDIASTORE_MIN_SDK, or a custom SAF folder) that
 * isn't already occupied, resolving a conflict with the same "name (1)",
 * "name (2)", ... pattern blobUtil.ts's resolveAvailableDownloadName
 * already uses for an individual file.
 *
 * P13.3: a name is "taken" if EITHER an on-device stat finds it OR some
 * other registry entry has already claimed it as its `localRoot`. The
 * on-device check alone is not enough: `resolveLocalFolderRoot` reserves a
 * name here, synchronously, well before any bytes actually land on disk —
 * the physical directory isn't created until TransferStreamManager streams
 * its first child (or, for an empty folder, ensureEmptyFolderStaged runs),
 * which can be arbitrarily later (queued behind another transfer, a large
 * first file, etc.). Two different shared folders that happen to share a
 * display name and are both downloaded in quick succession could therefore
 * both resolve to the same on-device-still-nonexistent name and collide the
 * moment they actually materialize — exactly the "test / test(1) / test"
 * inconsistency this was meant to fix in the first place. Consulting the
 * registry (already fully serialized by withRegistryLock below, so it
 * reflects every reservation made so far, materialized or not) closes that
 * window; the on-device stat remains as a second check for a name occupied
 * by something this registry doesn't know about (a manual copy, a folder
 * from before this registry existed, etc).
 */
async function findAvailableRootName(registry: Registry, rawFolderName: string): Promise<string> {
  const reservedNames = new Set(Object.values(registry).map(entry => entry.localRoot).filter(Boolean));
  const isTaken = async (name: string): Promise<boolean> => {
    if (reservedNames.has(name)) {
      return true;
    }
    return downloadedFileExists(name);
  };

  if (!(await isTaken(rawFolderName))) {
    return rawFolderName;
  }
  for (let counter = 1; ; counter++) {
    const candidate = `${rawFolderName} (${counter})`;
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }
}

// A single global mutex, not one keyed per shared_folder_id: every function
// below does its own read-modify-write of the one shared registry file, so
// any two calls racing (e.g. root resolution for a never-before-seen folder
// racing a reconciliation write for a different one — the empty-folder path
// isn't otherwise serialized by TransferStreamManager's one-active-stream
// invariant) could otherwise clobber each other's write. Chaining every call
// through one promise fully serializes all registry access regardless of
// which shared_folder_id or call site it came from.
let mutex: Promise<unknown> = Promise.resolve();

function withRegistryLock<T>(fn: (registry: Registry) => Promise<T>): Promise<T> {
  const run = mutex.then(async () => fn(await readRegistry()));
  // Chain the mutex forward regardless of outcome — a failed call must not
  // permanently wedge every later one behind a rejected promise.
  mutex = run.catch(() => undefined);
  return run;
}

/**
 * Returns the on-device root directory name for `sharedFolderId`, resolving
 * and permanently remembering one on first call for that id, or returning
 * the already-remembered one on every call after. Safe to call from every
 * folder-download call site (TransferStreamManager, FilesScreen's
 * empty-folder and Open-folder paths) without any of them needing to
 * coordinate a single "resolve once" moment themselves — whichever call
 * actually runs first for a given id wins and every later call (for that
 * same id, immediately or across app restarts) just reads its answer back.
 *
 * `sharedAt` (P17) is the owning SharedFolder's current `shared_at`, when
 * the caller has it — FilesScreen's handleFolderDownload/handleOpenFolder
 * always do, since both hold the live `AvailableFolderResponse`. When an
 * existing entry's own recorded `sharedAt` is present and disagrees with
 * it, `sharedFolderId` has been reused for a different logical folder (see
 * RegistryEntry's own doc comment) — the stale entry (localRoot *and*
 * reconciledChildren) is discarded before resolving a fresh root, so the
 * new folder never inherits the old one's physical directory or
 * reconciliation snapshot. TransferStreamManager's own two call sites omit
 * `sharedAt` (a Transfer response carries no such field) and so never
 * invalidate — safe because they only ever run after the same download's
 * FilesScreen call already resolved (and, if necessary, invalidated) this
 * exact id moments earlier in the same flow; see TransferStreamManager's
 * own doc comment on that ordering.
 */
export function resolveLocalFolderRoot(
  sharedFolderId: number,
  rawFolderName: string,
  sharedAt?: string,
): Promise<string> {
  return withRegistryLock(async registry => {
    const key = String(sharedFolderId);
    const existing = registry[key];
    const isStale = existing != null && sharedAt != null && existing.sharedAt != null && existing.sharedAt !== sharedAt;
    if (existing && !isStale) {
      if (sharedAt != null && existing.sharedAt == null) {
        // Backfill a legacy/cold-start entry now that its identity is known,
        // rather than leaving it permanently unverifiable.
        registry[key] = { ...existing, sharedAt };
        await writeRegistry(registry);
      }
      return existing.localRoot;
    }
    // No entry yet, or a stale one (reused id — P17): drop any stale entry
    // first so its old localRoot doesn't count as "reserved" against the
    // fresh name below, only an on-device stat can still block reusing it.
    delete registry[key];
    const localRoot = await findAvailableRootName(registry, rawFolderName);
    registry[key] = { localRoot, sharedAt };
    await writeRegistry(registry);
    return localRoot;
  });
}

/**
 * The (relative_path -> file_size) shape this folder held the last time its
 * on-device copy was confirmed to match — null if never reconciled (a
 * folder that's never finished a download, or whose reconciliation record
 * predates this app feature/install). See this module's own doc comment for
 * why this, not Transfer history, is what folderDownloadStatus.ts compares
 * a folder's current children against to decide 'completed' vs stale.
 */
export function getReconciledChildren(sharedFolderId: number): Promise<Record<string, number> | null> {
  return withRegistryLock(async registry => registry[String(sharedFolderId)]?.reconciledChildren ?? null);
}

/**
 * Records that `children` — exactly these paths, at exactly these sizes,
 * nothing more and nothing less — is what this folder's on-device copy now
 * matches. Called once a folder download has actually finished (every
 * pending child streamed successfully — TransferStreamManager's
 * notifyIfFolderComplete) *or* found nothing left to stream in the first
 * place (FilesScreen.handleFolderDownload, covering a removal-only update:
 * nothing needs downloading, but the stale, now-too-large previous record
 * still needs overwriting). Always a full overwrite of this folder's entry,
 * never a merge — that's what lets a removed file's entry actually
 * disappear instead of lingering forever the way its Transfer history
 * necessarily does.
 */
export async function markFolderReconciled(
  sharedFolderId: number,
  children: { relative_path: string; file_size: number }[],
): Promise<void> {
  await withRegistryLock(async registry => {
    const reconciledChildren: Record<string, number> = {};
    for (const child of children) {
      reconciledChildren[child.relative_path] = child.file_size;
    }
    const key = String(sharedFolderId);
    registry[key] = { ...registry[key], localRoot: registry[key]?.localRoot ?? '', reconciledChildren };
    await writeRegistry(registry);
  });
}

/** A shared folder as currently listed by the backend — enough to tell whether a registry entry still belongs to it (P17). */
export interface LiveFolder {
  id: number;
  shared_at: string;
}

/**
 * True when `entry` can be trusted as still describing `liveSharedAt` — P17.
 * An entry with no recorded `sharedAt` (legacy/cold-start, see
 * RegistryEntry's own doc comment) is trusted, same as
 * resolveLocalFolderRoot's own handling; one whose recorded `sharedAt`
 * actively disagrees with the folder currently holding this id belongs to a
 * different, already-gone logical folder and must not be surfaced.
 */
function matchesLiveFolder(entry: RegistryEntry, liveSharedAt: string | undefined): boolean {
  return entry.sharedAt == null || liveSharedAt == null || entry.sharedAt === liveSharedAt;
}

/**
 * Every shared folder's reconciled-children record in one read, keyed by
 * shared_folder_id — for useFolderReconciliation.ts to load in bulk on
 * FilesScreen's existing poll tick, rather than one file read per folder.
 * Folders with no reconciliation record yet (never downloaded) are simply
 * absent from the result.
 *
 * `liveFolders` (P17) is the currently-shared folder list, each with the
 * `shared_at` its id was created with. A registry entry whose own recorded
 * `sharedAt` disagrees with the live folder now holding that id is a
 * leftover from a different, already-unshared folder that happened to reuse
 * the id (RegistryEntry's own doc comment) — omitted here so a freshly
 * created folder can never read back as already-reconciled just because an
 * unrelated, deleted folder once occupied the same id. This is what closes
 * the gap resolveLocalFolderRoot's own write-time invalidation only closes
 * from the *next* download onward: this filter protects every read in
 * between, including the very first render of a reused id before the user
 * has tapped anything.
 */
export function readAllReconciledChildren(liveFolders: LiveFolder[]): Promise<Record<number, Record<string, number>>> {
  return withRegistryLock(async registry => {
    const liveSharedAtById = new Map(liveFolders.map(f => [f.id, f.shared_at]));
    const result: Record<number, Record<string, number>> = {};
    for (const [key, entry] of Object.entries(registry)) {
      const id = Number(key);
      if (entry.reconciledChildren && matchesLiveFolder(entry, liveSharedAtById.get(id))) {
        result[id] = entry.reconciledChildren;
      }
    }
    return result;
  });
}

/**
 * Every shared folder's resolved on-device root directory name in one read,
 * keyed by shared_folder_id (P13.3) — lets FilesScreen re-verify a
 * "completed" folder still actually exists on disk (see useDownloadExistence
 * for the file-level equivalent this mirrors), without each row resolving
 * its own root name individually. A folder that's never been downloaded, or
 * whose root has been resolved but not yet reconciled, is still included as
 * long as `localRoot` is set — that's exactly the identifier needed to check
 * existence, independent of reconciliation state.
 *
 * `liveFolders` (P17): see readAllReconciledChildren's own doc comment —
 * same filtering, so a reused id's stale localRoot (pointing at a different,
 * already-deleted folder's physical directory) is never handed back as if
 * it belonged to the folder currently holding that id.
 */
export function readAllLocalRoots(liveFolders: LiveFolder[]): Promise<Record<number, string>> {
  return withRegistryLock(async registry => {
    const liveSharedAtById = new Map(liveFolders.map(f => [f.id, f.shared_at]));
    const result: Record<number, string> = {};
    for (const [key, entry] of Object.entries(registry)) {
      const id = Number(key);
      if (entry.localRoot && matchesLiveFolder(entry, liveSharedAtById.get(id))) {
        result[id] = entry.localRoot;
      }
    }
    return result;
  });
}
