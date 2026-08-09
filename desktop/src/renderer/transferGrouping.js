"use strict";

/**
 * P13: every Transfer belonging to the same Android folder upload/download
 * shares a non-null upload_batch_id — group those into one aggregate item
 * instead of rendering N separate rows. An ordinary single-file transfer
 * (the overwhelming majority, upload_batch_id === null) is untouched: it
 * stays exactly the flat row it always was.
 *
 * Shared between the Transfers view (every transfer) and the Shared Files
 * view (completed RECEIVE transfers only, §8) rather than duplicated —
 * both need the exact same "one row per folder batch" grouping.
 */
export function groupTransfersByBatch(transfers) {
  const batches = new Map();
  const items = [];
  for (const transfer of transfers) {
    if (!transfer.upload_batch_id) {
      items.push({ kind: "single", transfer });
      continue;
    }
    let group = batches.get(transfer.upload_batch_id);
    if (!group) {
      group = { kind: "batch", upload_batch_id: transfer.upload_batch_id, transfers: [] };
      batches.set(transfer.upload_batch_id, group);
      items.push(group);
    }
    group.transfers.push(transfer);
  }
  return items;
}

/** The batch's top-level folder name, derived from any child's root-inclusive folder_relative_path. */
export function batchFolderName(children) {
  return children[0].folder_relative_path ? children[0].folder_relative_path.split("/")[0] : "folder";
}
