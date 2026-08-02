"use strict";

import { api, ApiError } from "../api/client.js";
import { escapeHtml, renderError } from "../dom.js";

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
  controller.container.innerHTML = `
    <h2>Pair a Device</h2>
    <p>Start a pairing attempt, then scan the QR code from the Relay Android app.</p>
    <button id="start-pairing">Start Pairing</button>
  `;
  controller.container
    .querySelector("#start-pairing")
    .addEventListener("click", () => startPairing(controller));
}

async function startPairing(controller) {
  const { container } = controller;
  container.innerHTML = "<p>Starting pairing attempt...</p>";
  try {
    const { data } = await api.post("/pairing/start");
    controller.token = data.qr.pairing_token;
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
    <h2>Pair a Device</h2>
    <img class="qr-code" src="${qrDataUrl}" alt="Pairing QR code" />
    <p>Scan this code from the Relay Android app.</p>
    <p class="muted">Expires at ${new Date(expiresAt).toLocaleTimeString()}</p>
    <p id="pairing-status">Waiting for a device to scan...</p>
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
      // Nobody has submitted a request against this attempt yet; keep waiting.
      return;
    }
    controller.setPollTimer(null);
    renderError(controller.container, err);
  }
}

function renderReview(controller, pending) {
  const { container, token } = controller;
  container.innerHTML = `
    <h2>Pairing Request</h2>
    <p><strong>${escapeHtml(pending.device_name)}</strong> (${escapeHtml(pending.platform)}) wants to pair.</p>
    <p class="muted">Device ID: ${escapeHtml(pending.device_identifier)}</p>
    <button id="approve">Approve</button>
    <button id="reject" class="danger">Reject</button>
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
  controller.container.innerHTML = `
    <h2>Pairing Request</h2>
    <p>${escapeHtml(message)}</p>
    <button id="start-pairing">Start New Pairing</button>
  `;
  controller.container
    .querySelector("#start-pairing")
    .addEventListener("click", () => startPairing(controller));
}
