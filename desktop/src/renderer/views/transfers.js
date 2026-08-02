"use strict";

import { api } from "../api/client.js";
import { escapeHtml, formatBytes, formatDateTime, renderError } from "../dom.js";

const POLL_INTERVAL_MS = 2000;
const CANCELLABLE_STATUSES = new Set(["in_progress"]);

export async function mount(container) {
  await refresh(container);
  const timer = setInterval(() => refresh(container), POLL_INTERVAL_MS);
  return () => clearInterval(timer);
}

async function refresh(container) {
  try {
    const [{ data: requests }, { data: transfers }] = await Promise.all([
      api.get("/transfers/requests"),
      api.get("/transfers"),
    ]);
    render(container, requests, transfers);
  } catch (err) {
    renderError(container, err);
  }
}

function render(container, requests, transfers) {
  const pending = requests.filter((r) => r.status === "pending");

  container.innerHTML = `
    <h2>Incoming Transfer Requests</h2>
    ${pending.length === 0 ? "<p>No pending requests.</p>" : renderRequestsTable(pending)}

    <h2>Transfers</h2>
    ${transfers.length === 0 ? "<p>No transfers yet.</p>" : renderTransfersTable(transfers)}
  `;

  container.querySelectorAll("tr[data-request-id]").forEach((row) => {
    const requestId = row.dataset.requestId;

    row.querySelector(".accept").addEventListener("click", async () => {
      try {
        await api.post(`/transfers/requests/${requestId}/accept`);
        await refresh(container);
      } catch (err) {
        renderError(container, err);
      }
    });

    row.querySelector(".reject").addEventListener("click", async () => {
      try {
        await api.post(`/transfers/requests/${requestId}/reject`);
        await refresh(container);
      } catch (err) {
        renderError(container, err);
      }
    });
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

function renderRequestsTable(pending) {
  const rows = pending
    .map(
      (request) => `
      <tr data-request-id="${request.request_id}">
        <td>${escapeHtml(request.device_name)}</td>
        <td>${escapeHtml(request.direction)}</td>
        <td>${escapeHtml(request.file_name)}</td>
        <td>${formatBytes(request.file_size)}</td>
        <td>${formatDateTime(request.expires_at)}</td>
        <td>
          <button class="accept">Accept</button>
          <button class="reject danger">Reject</button>
        </td>
      </tr>`
    )
    .join("");

  return `
    <table>
      <thead><tr><th>Device</th><th>Direction</th><th>File</th><th>Size</th><th>Expires</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
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
