"use strict";

import { api } from "../api/client.js";
import { emptyState, escapeHtml, formatBytes, loadingState, pageHeader, renderError } from "../dom.js";
import { batchFolderName, groupTransfersByBatch } from "../transferGrouping.js";
import { applyHistoryReset, clearTransferHistory, getHistoryClearedAt, isHistoricalTransfer } from "../transferHistory.js";
import { transferIcon } from "../icons.js";

const POLL_INTERVAL_MS = 2000;
const CANCELLABLE_STATUSES = new Set(["in_progress"]);

const STATUS_LABELS = {
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_BADGE_VARIANTS = {
  in_progress: "badge-progress",
  completed: "badge-success",
  failed: "badge-danger",
  cancelled: "",
};

export async function mount(container) {
  // Only the very first load gets the loading placeholder - refresh() also
  // runs on a 2s poll timer below, and re-showing a loading state on every
  // poll tick would reset scroll position and flicker the whole table.
  container.innerHTML = loadingState("Loading transfers...");
  await refresh(container);
  const timer = setInterval(() => refresh(container), POLL_INTERVAL_MS);
  return () => clearInterval(timer);
}

async function refresh(container) {
  try {
    const { data: transfers } = await api.get("/transfers");
    render(container, transfers);
  } catch (err) {
    renderError(container, err, () => refresh(container));
  }
}

function render(container, transfers) {
  const clearedAt = getHistoryClearedAt();
  const visibleTransfers = applyHistoryReset(transfers, clearedAt);
  const hasHistoryToClear = visibleTransfers.some(isHistoricalTransfer);
  const historyWasCleared = clearedAt != null && transfers.length > 0 && visibleTransfers.length === 0;

  const actions = `<button id="clear-history" class="text-button"${hasHistoryToClear ? "" : " disabled"}>Clear History</button>`;

  container.innerHTML =
    pageHeader({
      title: "Transfers",
      subtitle: "Files sent to and received from your paired devices.",
      actions,
    }) +
    (visibleTransfers.length === 0
      ? emptyState(
          historyWasCleared
            ? {
                icon: transferIcon,
                variant: "neutral",
                title: "History cleared",
                message: "Your past transfers are hidden. New transfers you send or receive will show up here.",
              }
            : {
                icon: transferIcon,
                title: "No transfers yet",
                message: "Files you send or receive with a paired device will show up here.",
              }
        )
      : renderTransfersTable(visibleTransfers));

  const clearHistoryButton = container.querySelector("#clear-history");
  clearHistoryButton.addEventListener("click", () => {
    if (!window.confirm("Clear completed, failed, and cancelled transfers from this list? Active transfers stay visible, and nothing is deleted from your files.")) {
      return;
    }
    clearTransferHistory();
    render(container, transfers);
  });

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

function renderTransfersTable(transfers) {
  const rows = groupTransfersByBatch(transfers)
    .map((item) => (item.kind === "batch" ? renderBatchRow(item.transfers) : renderTransferRow(item.transfer)))
    .join("");

  return `
    <table>
      <thead><tr><th>Device</th><th>Direction</th><th>File</th><th>Progress</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function statusBadge(status, failureReason) {
  const label = STATUS_LABELS[status] ?? status;
  const variant = STATUS_BADGE_VARIANTS[status] ?? "";
  const badge = `<span class="badge ${variant}">${escapeHtml(label)}</span>`;
  return failureReason ? `${badge}<div class="status-detail">${escapeHtml(failureReason)}</div>` : badge;
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
        <td>${statusBadge(transfer.status, transfer.failure_reason)}</td>
        <td>${canCancel ? '<button class="cancel danger">Cancel</button>' : ""}</td>
      </tr>`;
}

function renderBatchRow(children) {
  const folderName = batchFolderName(children);
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
        <td>${statusBadge(status)}</td>
        <td></td>
      </tr>`;
}
