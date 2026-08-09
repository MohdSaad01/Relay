"use strict";

import { batchFolderName, groupTransfersByBatch } from "./transferGrouping.js";

/**
 * Surfaces files/folders received from Android in the Shared Files tab
 * (New_Issues.txt §8) and lets the user remove them from that view after
 * deleting the local copy (§9).
 *
 * Architecture: a received item has no `SharedFile`/`SharedFolder` row —
 * TransferStreamService.receive_upload only ever writes the bytes to disk
 * and updates the `Transfer` row (confirmed by reading that service); there
 * is no backend concept of "sharing" something the desktop received. Per
 * this milestone's own instruction not to invent new backend state just to
 * make the UI easier to render, a received item is derived entirely from
 * already-persisted data: completed RECEIVE transfers from `GET
 * /transfers`, combined with `app_settings.download_directory` (the only
 * other fact needed to know where the file landed).
 *
 * Only `status === 'completed'` transfers are considered — an in-progress
 * or queued receive is operational state that belongs in the Transfers tab
 * (see that view), not a file the user can act on yet; a failed/cancelled
 * one never produced a file at all. This mirrors transferHistory.js's own
 * "backend status is the only source of truth for state" rule.
 *
 * Deletion (§9) can't remove the backing `Transfer` row — it's permanent
 * history by design (see transferHistory.js's own doc comment) — so, like
 * Clear History, "removing the entry" is a local-only marker: once the
 * user deletes a received item's local copy, its key is recorded here and
 * filtered out of the Files list on every future render. This never
 * touches the Transfers tab, which continues to show the real history.
 */

const REMOVED_KEYS_STORAGE_KEY = "relay.files.removedReceivedKeys";

function readRemovedKeys() {
  try {
    const raw = localStorage.getItem(REMOVED_KEYS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeRemovedKeys(keys) {
  localStorage.setItem(REMOVED_KEYS_STORAGE_KEY, JSON.stringify([...keys]));
}

/** Records a received item as locally removed, so it no longer appears in the Files list. */
export function markReceivedItemRemoved(key) {
  const keys = readRemovedKeys();
  keys.add(key);
  writeRemovedKeys(keys);
}

/** A single received file's stable key (keyed by transfer id — the file's own identity). */
function fileKey(transfer) {
  return `t:${transfer.id}`;
}

/** A received folder batch's stable key (keyed by upload_batch_id, matching how it's grouped/displayed as one item). */
function folderKey(uploadBatchId) {
  return `b:${uploadBatchId}`;
}

/**
 * Builds the received-item rows for the Files view: completed RECEIVE
 * transfers, grouped into folders exactly like the Transfers view groups
 * them (transferGrouping.js), then filtered against the local removed-keys
 * marker. Each item carries enough to render a row and resolve its actual
 * on-disk path (see resolveReceivedItemPath below).
 */
export function buildReceivedItems(transfers) {
  const removedKeys = readRemovedKeys();
  const completedReceives = transfers.filter((t) => t.direction === "receive" && t.status === "completed");

  const items = [];
  for (const grouped of groupTransfersByBatch(completedReceives)) {
    if (grouped.kind === "single") {
      const transfer = grouped.transfer;
      const key = fileKey(transfer);
      if (removedKeys.has(key)) continue;
      items.push({
        kind: "received-file",
        key,
        transfer,
        name: transfer.file_name,
        size: transfer.file_size,
        receivedAt: transfer.completed_at ?? transfer.started_at,
      });
      continue;
    }

    const key = folderKey(grouped.upload_batch_id);
    if (removedKeys.has(key)) continue;
    const children = grouped.transfers;
    const totalSize = children.reduce((sum, t) => sum + t.file_size, 0);
    const receivedAt = children.reduce(
      (latest, t) => ((t.completed_at ?? t.started_at) > latest ? t.completed_at ?? t.started_at : latest),
      children[0].completed_at ?? children[0].started_at
    );
    items.push({
      kind: "received-folder",
      key,
      children,
      name: batchFolderName(children),
      size: totalSize,
      fileCount: children.length,
      receivedAt,
    });
  }
  return items;
}

/**
 * Resolves a received item's absolute on-disk path via the main process
 * (Node's `path.join`, not string concatenation here — the renderer has no
 * path module and Windows separators make naive joining unsafe).
 * `downloadDirectory` comes from the caller's own `GET /settings` call.
 */
export function resolveReceivedItemPath(downloadDirectory, item) {
  if (item.kind === "received-file") {
    return window.relay.resolveDownloadPath(downloadDirectory, [item.transfer.file_name]);
  }
  return window.relay.resolveDownloadPath(downloadDirectory, [item.name]);
}
