"use strict";

import { api } from "../api/client.js";
import { emptyState, escapeHtml, formatBytes, pageHeader, renderError } from "../dom.js";

const POLL_INTERVAL_MS = 2000;
const CANCELLABLE_STATUSES = new Set(["in_progress"]);

export async function mount(container) {
  await refresh(container);
  const timer = setInterval(() => refresh(container), POLL_INTERVAL_MS);
  return () => clearInterval(timer);
}

async function refresh(container) {
  try {
    const { data: transfers } = await api.get("/transfers");
    render(container, transfers);
  } catch (err) {
    renderError(container, err);
  }
}

function render(container, transfers) {
  container.innerHTML =
    pageHeader({ title: "Transfers" }) +
    (transfers.length === 0
      ? emptyState({
          title: "No transfers yet",
          message: "Files you send or receive with a paired device will show up here.",
        })
      : renderTransfersTable(transfers));

  container.querySelectorAll("tr[data-transfer-id]").forEach((row) => {
    const transferId = Number(row.dataset.transferId);
    const cancelButton = row.querySelector(".cancel");
    if (cancelButton) {
      cancelButton.addEventListener("click", async () => {
        try {
          await api.post(`/transfers/${transferId}/cancel`);
          await refresh(container);
        } catch (err) {
          renderError(container, err);
        }
      });
    }
  });
}

/**
 * P13: every Transfer belonging to the same Android folder upload shares a
 * non-null upload_batch_id — group those into one aggregate item instead of
 * rendering N separate rows. An ordinary single-file transfer (the
 * overwhelming majority, upload_batch_id === null) is untouched: it stays
 * exactly the flat row it always was.
 */
function groupTransfers(transfers) {
  const batches = new Map();
  const items = [];
  for (const transfer of transfers) {
    if (!transfer.upload_batch_id) {
      items.push({ kind: "single", transfer });
      continue;
    }
    let group = batches.get(transfer.upload_batch_id);
    if (!group) {
      group = { kind: "batch", transfers: [] };
      batches.set(transfer.upload_batch_id, group);
      items.push(group);
    }
    group.transfers.push(transfer);
  }
  return items;
}

function renderTransfersTable(transfers) {
  const rows = groupTransfers(transfers)
    .map((item) => (item.kind === "batch" ? renderBatchRow(item.transfers) : renderTransferRow(item.transfer)))
    .join("");

  return `
    <table>
      <thead><tr><th>Device</th><th>Direction</th><th>File</th><th>Progress</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderTransferRow(transfer) {
  const progress = transfer.file_size > 0 ? Math.round((transfer.bytes_transferred / transfer.file_size) * 100) : 0;
  const canCancel = CANCELLABLE_STATUSES.has(transfer.status);
  return `
      <tr data-transfer-id="${transfer.id}">
        <td>${escapeHtml(transfer.device_name)}</td>
        <td>${escapeHtml(transfer.direction)}</td>
        <td>${escapeHtml(transfer.file_name)}</td>
        <td>
          <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
          ${progress}% (${formatBytes(transfer.bytes_transferred)} / ${formatBytes(transfer.file_size)})
        </td>
        <td>${escapeHtml(transfer.status)}${transfer.failure_reason ? `: ${escapeHtml(transfer.failure_reason)}` : ""}</td>
        <td>${canCancel ? '<button class="cancel danger">Cancel</button>' : ""}</td>
      </tr>`;
}

function renderBatchRow(children) {
  const folderName = children[0].folder_relative_path
    ? children[0].folder_relative_path.split("/")[0]
    : "folder";
  const completedCount = children.filter((t) => t.status === "completed").length;
  const totalBytes = children.reduce((sum, t) => sum + t.file_size, 0);
  const transferredBytes = children.reduce((sum, t) => sum + t.bytes_transferred, 0);
  const progress = totalBytes > 0 ? Math.round((transferredBytes / totalBytes) * 100) : 0;
  const status = children.some((t) => t.status === "failed")
    ? "failed"
    : children.some((t) => t.status === "in_progress")
      ? "in_progress"
      : "completed";

  return `
      <tr>
        <td>${escapeHtml(children[0].device_name)}</td>
        <td>${escapeHtml(children[0].direction)}</td>
        <td>&#128193; ${escapeHtml(folderName)} (${completedCount}/${children.length})</td>
        <td>
          <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
          ${progress}% (${formatBytes(transferredBytes)} / ${formatBytes(totalBytes)})
        </td>
        <td>${escapeHtml(status)}</td>
        <td></td>
      </tr>`;
}
