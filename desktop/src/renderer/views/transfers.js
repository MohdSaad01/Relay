"use strict";

import { api } from "../api/client.js";
import { emptyState, escapeHtml, formatBytes, loadingState, pageHeader, renderError } from "../dom.js";
import { batchFolderName, groupTransfersByBatch } from "../transferGrouping.js";
import { applyHistoryReset, clearTransferHistory, getHistoryClearedAt, isHistoricalTransfer } from "../transferHistory.js";
import { transferIcon } from "../icons.js";
import { confirmDialog } from "../dialog.js";

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

  const actions = `<button id="clear-history" class="text-button"${hasHistoryToClear ? "" : " disabled"}>Clear History</button>`;

  // P28: a single ordinary empty state regardless of *why* the list is
  // empty (never had transfers vs. history cleared vs. nothing currently
  // visible) - see docs/15_QA_NOTEBOOK.md's P28 entry. The previous
  // "History cleared" variant exposed that internal distinction to the
  // user, which the milestone explicitly ruled out.
  container.innerHTML =
    pageHeader({
      title: "Transfers",
      subtitle: "Files sent to and received from your paired devices.",
      actions,
    }) +
    (visibleTransfers.length === 0
      ? emptyState({
          icon: transferIcon,
          title: "No history",
          message: "New transfers you send or receive will show up here.",
        })
      : renderTransfersTable(visibleTransfers));

  const clearHistoryButton = container.querySelector("#clear-history");
  clearHistoryButton.addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "Clear completed, failed, and cancelled transfers from this list?",
      message: "Active transfers stay visible, and nothing is deleted from your files.",
      confirmLabel: "Clear History",
      destructive: true,
    });
    if (!confirmed) return;
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
      <colgroup>
        <col class="col-w-150" />
        <col class="col-w-100" />
        <col />
        <col class="col-w-260" />
        <col class="col-w-160" />
        <col class="col-w-100" />
      </colgroup>
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

// Percentage of bytesTransferred/totalBytes, clamped to [0, 100]. A
// zero-byte transfer has no meaningful ratio (0/0) - it reads as 100% once
// the transfer has actually reached completed, 0% otherwise, so a
// zero-byte completed transfer still shows a full bar rather than an empty
// one that looks stuck.
function progressPercent(bytesTransferred, totalBytes, status) {
  if (totalBytes > 0) {
    return Math.min(100, Math.max(0, Math.round((bytesTransferred / totalBytes) * 100)));
  }
  return status === "completed" ? 100 : 0;
}

// A native <progress> element's fill is drawn from its value/max
// attributes, not from CSS - unlike a width-styled div, it is unaffected
// by the renderer's style-src CSP (see docs/15_QA_NOTEBOOK.md's P29.1/P33
// entries: any inline style="" attribute is silently dropped, which is why
// this replaced the old .progress-bar/.progress-fill div pair).
function progressBar(percent) {
  return `<progress class="transfer-progress" value="${percent}" max="100"></progress>`;
}

function renderTransferRow(transfer) {
  const progress = progressPercent(transfer.bytes_transferred, transfer.file_size, transfer.status);
  const canCancel = CANCELLABLE_STATUSES.has(transfer.status);
  return `
      <tr data-transfer-id="${transfer.id}">
        <td class="cell-truncate" title="${escapeHtml(transfer.device_name)}">${escapeHtml(transfer.device_name)}</td>
        <td>${escapeHtml(transfer.direction)}</td>
        <td class="cell-truncate" title="${escapeHtml(transfer.file_name)}">${escapeHtml(transfer.file_name)}</td>
        <td>
          ${progressBar(progress)}
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
  const status = children.some((t) => t.status === "failed")
    ? "failed"
    : children.some((t) => t.status === "in_progress")
      ? "in_progress"
      : "completed";
  const progress = progressPercent(transferredBytes, totalBytes, status);

  return `
      <tr>
        <td class="cell-truncate" title="${escapeHtml(children[0].device_name)}">${escapeHtml(children[0].device_name)}</td>
        <td>${escapeHtml(children[0].direction)}</td>
        <td class="cell-truncate" title="${escapeHtml(folderName)}">&#128193; ${escapeHtml(folderName)} (${completedCount}/${children.length})</td>
        <td>
          ${progressBar(progress)}
          ${progress}% (${formatBytes(transferredBytes)} / ${formatBytes(totalBytes)})
        </td>
        <td>${statusBadge(status)}</td>
        <td></td>
      </tr>`;
}
