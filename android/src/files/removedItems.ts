/**
 * P22 (New_Issues.txt §12): client-local dismissal for a shared file/folder
 * the user has chosen to "Remove" from the Files screen while it has no
 * downloaded content of its own — a not-yet-downloaded item, or one whose
 * download reached a terminal 'failed' state. There is nothing on the
 * backend for this to delete or unshare (the item is still, correctly,
 * shared by the desktop; Android has no ownership over that decision — see
 * CLAUDE.md's Backend ID Reuse / Desktop Files-Transfers Conventions
 * precedent for the same reasoning applied to Desktop's own "Clear
 * History"/received-file Delete), so "Remove" is purely "stop showing this
 * row on this install," mirroring transfers/historyReset.ts's marker
 * approach and desktop/src/renderer/receivedFiles.js's removed-item marker
 * for the identical shape of problem.
 *
 * Persistence mirrors folderIdentity.ts/fileIdentity.ts/historyReset.ts: a
 * small JSON file under this app's private storage via react-native-blob-util
 * (already a dependency) — not a new persistence technology for one small
 * marker (CLAUDE.md Rule 2).
 *
 * Entries store the owning item's `shared_at` (P17) alongside the dismissal,
 * exactly like folderIdentity.ts's RegistryEntry: a backend integer id is
 * only unique while its row exists, so a removed item's id can later be
 * reused by an unrelated file/folder the desktop shares afterward. Gating a
 * dismissal on `shared_at` means a reused id's fresh item is never
 * incorrectly hidden as if it were the old, already-gone one the user
 * actually removed.
 */

import ReactNativeBlobUtil from 'react-native-blob-util';

const REGISTRY_PATH = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/relay-removed-items.json`;

export type RemovedItemKind = 'file' | 'folder';

interface RemovedEntry {
  sharedAt: string;
}

type KindRegistry = Record<string, RemovedEntry>;
interface Registry {
  file: KindRegistry;
  folder: KindRegistry;
}

function emptyRegistry(): Registry {
  return { file: {}, folder: {} };
}

function normalizeKindRegistry(value: unknown): KindRegistry {
  const result: KindRegistry = {};
  if (value == null || typeof value !== 'object') {
    return result;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry != null && typeof entry === 'object' && typeof (entry as RemovedEntry).sharedAt === 'string') {
      result[key] = { sharedAt: (entry as RemovedEntry).sharedAt };
    }
  }
  return result;
}

async function readRegistry(): Promise<Registry> {
  try {
    const raw = await ReactNativeBlobUtil.fs.readFile(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Record<RemovedItemKind, unknown>> | null;
    if (parsed == null || typeof parsed !== 'object') {
      return emptyRegistry();
    }
    return {
      file: normalizeKindRegistry(parsed.file),
      folder: normalizeKindRegistry(parsed.folder),
    };
  } catch {
    // No marker file yet (nothing ever removed on this install) or a
    // corrupted one — either way, treated as "nothing removed", matching
    // every other registry in this pipeline's own unreadable-file handling.
    return emptyRegistry();
  }
}

async function writeRegistry(registry: Registry): Promise<void> {
  await ReactNativeBlobUtil.fs.writeFile(REGISTRY_PATH, JSON.stringify(registry), 'utf8');
}

// A single global mutex, matching folderIdentity.ts/fileIdentity.ts's own
// reasoning: every function below does its own read-modify-write of the one
// shared registry file.
let mutex: Promise<unknown> = Promise.resolve();

function withRegistryLock<T>(fn: (registry: Registry) => Promise<T>): Promise<T> {
  const run = mutex.then(async () => fn(await readRegistry()));
  mutex = run.catch(() => undefined);
  return run;
}

/** Marks `id` (of `kind`) as removed from the Files screen, as of its current `sharedAt`. */
export function markItemRemoved(kind: RemovedItemKind, id: number, sharedAt: string): Promise<void> {
  return withRegistryLock(async registry => {
    registry[kind][String(id)] = { sharedAt };
    await writeRegistry(registry);
  });
}

/** A live file/folder as currently listed by the backend — enough to tell whether a dismissal still applies (P17). */
export interface LiveItem {
  id: number;
  shared_at: string;
}

/**
 * The set of currently-live item ids (of `kind`) that should stay hidden —
 * i.e. removed, and the live item's own `shared_at` still matches what was
 * removed. A live item whose `shared_at` has moved on (the id was reused by
 * a different, later share) is not included, so it renders normally instead
 * of inheriting a dismissal that belonged to a different logical item.
 */
export function readRemovedIds(kind: RemovedItemKind, liveItems: LiveItem[]): Promise<Set<number>> {
  return withRegistryLock(async registry => {
    const kindRegistry = registry[kind];
    const result = new Set<number>();
    for (const item of liveItems) {
      const entry = kindRegistry[String(item.id)];
      if (entry && entry.sharedAt === item.shared_at) {
        result.add(item.id);
      }
    }
    return result;
  });
}
