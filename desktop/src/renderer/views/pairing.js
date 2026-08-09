"use strict";

import { api, ApiError } from "../api/client.js";
import { emptyState, escapeHtml, pageHeader, renderError, parseApiDateTime } from "../dom.js";

const POLL_INTERVAL_MS = 1500;

export async function mount(container) {
  let pollTimer = null;
  const setPollTimer = (timer) => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = timer;
  };

  const controller = { container, setPollTimer };
  renderIdle(controller);

  return () => {
    if (pollTimer) clearInterval(pollTimer);
  };
}

function renderIdle(controller) {
  controller.container.innerHTML =
    pageHeader({ title: "Pairing", subtitle: "Connect a new Android device to this computer." }) +
    emptyState({
      title: "Ready to pair a device",
      message: "Start a pairing attempt, then scan the QR code from the Relay Android app.",
      actionHtml: '<button class="primary" id="start-pairing">Start Pairing</button>',
    });
  controller.container
    .querySelector("#start-pairing")
    .addEventListener("click", () => startPairing(controller));
}

async function startPairing(controller) {
  const { container } = controller;
  container.innerHTML = pageHeader({ title: "Pairing" }) + "<p>Starting pairing attempt...</p>";
  try {
    const { data } = await api.post("/pairing/start");
    controller.token = data.qr.pairing_token;
    controller.expiresAt = data.expires_at;
    const qrDataUrl = await window.relay.generateQrCode(data.qr);
    renderWaiting(container, qrDataUrl, data.expires_at);

    const timer = setInterval(() => pollPending(controller), POLL_INTERVAL_MS);
    controller.setPollTimer(timer);
    pollPending(controller);
  } catch (err) {
    renderError(container, err);
  }
}

function renderWaiting(container, qrDataUrl, expiresAt) {
  container.innerHTML = `
    ${pageHeader({ title: "Pairing" })}
    <div class="card pairing-card">
      <img class="qr-code" src="${qrDataUrl}" alt="Pairing QR code" />
      <p>Scan this code from the Relay Android app.</p>
      <p class="muted">Expires at ${parseApiDateTime(expiresAt).toLocaleTimeString()}</p>
      <p id="pairing-status" class="badge">Waiting for a device to scan...</p>
    </div>
  `;
}

async function pollPending(controller) {
  if (!controller.token) return;
  try {
    const { data: pending } = await api.get(`/pairing/pending/${controller.token}`);
    controller.setPollTimer(null);
    renderReview(controller, pending);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // The backend can't distinguish "nobody has submitted yet" from "this
      // attempt expired" (both 404, by design - see PairingService.get_pending_request).
      // The client knows expiresAt from the /pairing/start response, so it's
      // the one place that can tell the two apart and stop polling a dead QR code.
      if (controller.expiresAt && Date.now() >= parseApiDateTime(controller.expiresAt).getTime()) {
        controller.setPollTimer(null);
        renderExpired(controller);
        return;
      }
      return;
    }
    controller.setPollTimer(null);
    renderError(controller.container, err);
  }
}

function renderExpired(controller) {
  controller.token = null;
  controller.expiresAt = null;
  controller.container.innerHTML =
    pageHeader({ title: "Pairing" }) +
    emptyState({
      title: "Pairing attempt expired",
      message: "This pairing attempt expired before a device scanned it.",
      actionHtml: '<button class="primary" id="start-pairing">Start New Pairing</button>',
    });
  controller.container
    .querySelector("#start-pairing")
    .addEventListener("click", () => startPairing(controller));
}

function renderReview(controller, pending) {
  const { container, token } = controller;
  container.innerHTML = `
    ${pageHeader({ title: "Pairing Request" })}
    <div class="card pairing-card">
      <p><strong>${escapeHtml(pending.device_name)}</strong> (${escapeHtml(pending.platform)}) wants to pair.</p>
      <p class="muted">Device ID: ${escapeHtml(pending.device_identifier)}</p>
      <div class="button-row">
        <button class="primary" id="approve">Approve</button>
        <button id="reject" class="danger">Reject</button>
      </div>
    </div>
  `;

  container.querySelector("#approve").addEventListener("click", async () => {
    try {
      await api.post("/pairing/approve", { pairing_token: token });
      renderDecided(controller, "Device paired successfully.");
    } catch (err) {
      renderError(container, err);
    }
  });

  container.querySelector("#reject").addEventListener("click", async () => {
    try {
      await api.post("/pairing/reject", { pairing_token: token });
      renderDecided(controller, "Pairing request rejected.");
    } catch (err) {
      renderError(container, err);
    }
  });
}

function renderDecided(controller, message) {
  controller.token = null;
  controller.container.innerHTML =
    pageHeader({ title: "Pairing Request" }) +
    emptyState({
      title: message,
      message: "You can start another pairing attempt whenever you're ready.",
      actionHtml: '<button class="primary" id="start-pairing">Start New Pairing</button>',
    });
  controller.container
    .querySelector("#start-pairing")
    .addEventListener("click", () => startPairing(controller));
}
