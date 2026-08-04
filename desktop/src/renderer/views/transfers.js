"use strict";

import { api } from "../api/client.js";
import { escapeHtml, formatBytes, renderError } from "../dom.js";

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
  container.innerHTML = `
    <h2>Transfers</h2>
    ${transfers.length === 0 ? "<p>No transfers yet.</p>" : renderTransfersTable(transfers)}
  `;

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
  const rows = transfers
    .map((transfer) => {
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
    })
    .join("");

  return `
    <table>
      <thead><tr><th>Device</th><th>Direction</th><th>File</th><th>Progress</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}
