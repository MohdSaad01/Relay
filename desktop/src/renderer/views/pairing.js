"use strict";

import { api, ApiError } from "../api/client.js";
import { escapeHtml, iconBadge, pageHeader, renderError, parseApiDateTime } from "../dom.js";
import { qrIcon, deviceIcon, checkIcon, xIcon, clockIcon } from "../icons.js";

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
    `<div class="card pairing-card">
      ${iconBadge({ icon: qrIcon, variant: "primary" })}
      <h2>Ready to pair a device</h2>
      <p>Start a pairing attempt, then scan the QR code from the Relay Android app.</p>
      <div class="button-row">
        <button class="primary" id="start-pairing">Start Pairing</button>
      </div>
    </div>`;
  controller.container
    .querySelector("#start-pairing")
    .addEventListener("click", () => startPairing(controller));
}

async function startPairing(controller) {
  const { container } = controller;
  container.innerHTML =
    pageHeader({ title: "Pairing" }) +
    `<div class="card pairing-card">
      ${iconBadge({ icon: qrIcon, variant: "neutral" })}
      <h2>Starting pairing attempt...</h2>
      <p>Generating a QR code for this device to pair with.</p>
    </div>`;
  try {
    const { data } = await api.post("/pairing/start");
    controller.token = data.qr.pairing_token;
    controller.expiresAt = data.expires_at;
    const qrDataUrl = await window.relay.generateQrCode(data.qr);
    renderWaiting(controller, qrDataUrl, data.expires_at);

    const timer = setInterval(() => pollPending(controller), POLL_INTERVAL_MS);
    controller.setPollTimer(timer);
    pollPending(controller);
  } catch (err) {
    renderError(container, err);
  }
}

function renderWaiting(controller, qrDataUrl, expiresAt) {
  const { container } = controller;
  container.innerHTML = `
    ${pageHeader({ title: "Pairing" })}
    <div class="pairing-flow">
      <div class="card pairing-card">
        <img class="qr-code" src="${qrDataUrl}" alt="Pairing QR code" />
        <p class="muted">Expires at ${parseApiDateTime(expiresAt).toLocaleTimeString()}</p>
        <div class="pairing-status">
          <span class="pairing-status-dot"></span>
          <span id="pairing-status">Waiting for a device to scan...</span>
        </div>
        <div class="button-row">
          <button class="text-button" id="cancel-pairing">Cancel</button>
        </div>
      </div>
      <div class="card pairing-instructions">
        <h2>How to pair</h2>
        <ol class="pairing-steps">
          <li><strong>Open Relay</strong> on your Android phone.</li>
          <li><strong>Tap Scan to Pair</strong> from the pairing screen.</li>
          <li><strong>Point your camera</strong> at the QR code shown here.</li>
        </ol>
      </div>
    </div>
  `;
  container.querySelector("#cancel-pairing").addEventListener("click", () => {
    controller.setPollTimer(null);
    controller.token = null;
    controller.expiresAt = null;
    renderIdle(controller);
  });
}

async function pollPending(controller) {
  if (!controller.token) return;
  try {
    const { data: pending } = await api.get(`/pairing/pending/${controller.token}`);
    controller.setPollTimer(null);
    if (pending.name_conflict) {
      renderNameCollision(controller, pending);
    } else {
      renderReview(controller, pending);
    }
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
    `<div class="card pairing-card">
      ${iconBadge({ icon: clockIcon, variant: "neutral" })}
      <h2>Pairing attempt expired</h2>
      <p>This pairing attempt expired before a device scanned it.</p>
      <div class="button-row">
        <button class="primary" id="start-pairing">Start New Pairing</button>
      </div>
    </div>`;
  controller.container
    .querySelector("#start-pairing")
    .addEventListener("click", () => startPairing(controller));
}

function renderReview(controller, pending) {
  const { container, token } = controller;
  container.innerHTML = `
    ${pageHeader({ title: "Pairing Request" })}
    <div class="card pairing-card">
      ${iconBadge({ icon: deviceIcon, variant: "primary" })}
      <h2>${escapeHtml(pending.device_name)}</h2>
      <p><span class="badge">${escapeHtml(pending.platform)}</span></p>
      <p class="muted">Device ID: ${escapeHtml(pending.device_identifier)}</p>
      <p>Allow this device to pair with Relay?</p>
      <div class="button-row">
        <button class="primary" id="approve">Approve</button>
        <button id="reject" class="danger">Reject</button>
      </div>
    </div>
  `;

  container.querySelector("#approve").addEventListener("click", () => approveWithDecision(controller));

  container.querySelector("#reject").addEventListener("click", async () => {
    try {
      await api.post("/pairing/reject", { pairing_token: token });
      renderDecided(controller, {
        icon: xIcon,
        variant: "danger",
        title: "Pairing request rejected.",
        message: "You can start another pairing attempt whenever you're ready.",
      });
    } catch (err) {
      renderError(container, err);
    }
  });
}

/**
 * P43.1: a genuinely new device_identifier whose device_name collides with an
 * already-paired device (a stale row from that same phone's previous install,
 * still on Desktop's Devices list). Replaces the two-button Approve/Reject
 * screen with a decision between Replace and Make it a new device -
 * per the milestone brief, deliberately just these two, no third
 * "Cancel pairing" option (the "Cancel" control on the QR-waiting screen
 * remains the way to abandon a pairing attempt entirely).
 */
function renderNameCollision(controller, pending) {
  const { container } = controller;
  const conflict = pending.name_conflict;
  container.innerHTML = `
    ${pageHeader({ title: "Pairing Request" })}
    <div class="card pairing-card">
      ${iconBadge({ icon: deviceIcon, variant: "primary" })}
      <h2>There is a device with the same name as this.</h2>
      <p>What would you like to do?</p>
      <p class="muted">Existing device: ${escapeHtml(conflict.existing_device_name)}</p>
      <p class="muted">New device: ${escapeHtml(pending.device_name)}</p>
      <div class="button-row">
        <button class="primary" id="replace-device">Replace the current device</button>
        <button id="make-new-device">Make it a new device</button>
      </div>
    </div>
  `;

  container
    .querySelector("#replace-device")
    .addEventListener("click", () => approveWithDecision(controller, "replace"));
  container
    .querySelector("#make-new-device")
    .addEventListener("click", () => approveWithDecision(controller, "make_new"));
}

/**
 * Shared Approve action for both the plain review screen and the P43.1
 * collision screen. `nameConflictAction` is omitted for a plain approval.
 *
 * A 409 here means the backend re-checked live state at commit time
 * (PairingService.approve_pairing) and found a collision the Desktop's last
 * poll didn't know about yet - e.g. it appeared, or the decision no longer
 * applies to the current state. Rather than a dead-end error card, this
 * re-fetches the pending review and re-renders whichever screen the fresh
 * state calls for, so the user can just try again.
 */
async function approveWithDecision(controller, nameConflictAction) {
  const { container, token } = controller;
  try {
    const { data: device } = await api.post("/pairing/approve", {
      pairing_token: token,
      ...(nameConflictAction ? { name_conflict_action: nameConflictAction } : {}),
    });
    renderDecided(controller, {
      icon: checkIcon,
      variant: "success",
      title: "Device paired successfully.",
      message: `${device.device_name} can now share and receive files with this computer.`,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      try {
        const { data: freshPending } = await api.get(`/pairing/pending/${token}`);
        if (freshPending.name_conflict) {
          renderNameCollision(controller, freshPending);
        } else {
          renderReview(controller, freshPending);
        }
        return;
      } catch (refreshErr) {
        renderError(container, refreshErr);
        return;
      }
    }
    renderError(container, err);
  }
}

function renderDecided(controller, { icon, variant, title, message }) {
  controller.token = null;
  controller.container.innerHTML =
    pageHeader({ title: "Pairing Request" }) +
    `<div class="card pairing-card">
      ${iconBadge({ icon, variant })}
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <div class="button-row">
        <button class="primary" id="start-pairing">Start New Pairing</button>
      </div>
    </div>`;
  controller.container
    .querySelector("#start-pairing")
    .addEventListener("click", () => startPairing(controller));
}
