"use strict";

import { api } from "../api/client.js";
import { emptyState, escapeHtml, formatDateTime, iconBadge, loadingState, pageHeader, renderError } from "../dom.js";
import { deviceIcon } from "../icons.js";
import { confirmDialog } from "../dialog.js";

export async function mount(container) {
  await refresh(container);
  return () => {};
}

async function refresh(container) {
  container.innerHTML = loadingState("Loading devices...");
  try {
    const { data: devices } = await api.get("/devices");
    render(container, devices);
  } catch (err) {
    renderError(container, err);
  }
}

function render(container, devices) {
  container.innerHTML = pageHeader({
    title: "Devices",
    subtitle: "Android devices paired with this computer.",
  });

  if (devices.length === 0) {
    container.insertAdjacentHTML(
      "beforeend",
      emptyState({
        icon: deviceIcon,
        title: "No devices paired yet",
        message: "Pair your Android phone with Relay to start sending and receiving files over your local network.",
        actionHtml: '<button class="primary" id="go-to-pairing">Go to Pairing</button>',
      })
    );
    container.querySelector("#go-to-pairing").addEventListener("click", () => {
      document.querySelector('#nav button[data-view="pairing"]').click();
    });
    return;
  }

  const cards = devices.map((device) => renderDeviceCard(device)).join("");
  container.insertAdjacentHTML("beforeend", cards);

  devices.forEach((device) => {
    const card = container.querySelector(`[data-id="${device.id}"]`);
    wireDeviceCard(card, device, container);
  });
}

/**
 * Electron does not implement window.prompt() (it throws "prompt() is not
 * supported", confirmed live) so Rename previously threw an unhandled error
 * before the API call was ever made, making the button appear to do
 * nothing. Replaced with inline editing within the card instead of a native
 * prompt substitute (P29) - still correct under P30's dialog system, since
 * Rename isn't a confirmation prompt. Remove's confirmation now goes through
 * dialog.js's confirmDialog() instead of window.confirm() (P30).
 */
function wireDeviceCard(card, device, container) {
  const renameForm = card.querySelector(".device-card-rename");
  const renameInput = renameForm.querySelector(".rename-input");

  // Toggled via the `is-renaming` class (P29.1) rather than inline
  // style.display: index.html's CSP (`style-src 'self'`, no
  // `unsafe-inline`) silently blocks all inline style application, so a
  // direct style.display mutation has no visual effect in this app - see
  // app.css's `.device-card.is-renaming` rules for the actual show/hide.
  function showRenameForm() {
    renameInput.value = device.device_name;
    card.classList.add("is-renaming");
    renameInput.focus();
    renameInput.select();
  }

  function hideRenameForm() {
    card.classList.remove("is-renaming");
  }

  card.querySelector(".rename").addEventListener("click", showRenameForm);
  renameForm.querySelector(".rename-cancel").addEventListener("click", hideRenameForm);
  renameForm.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideRenameForm();
  });

  renameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = renameInput.value.trim();
    if (!name || name === device.device_name) {
      hideRenameForm();
      return;
    }
    try {
      await api.patch(`/devices/${device.id}`, { device_name: name });
      await refresh(container);
    } catch (err) {
      renderError(container, err);
    }
  });

  card.querySelector(".remove").addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "Unpair this device?",
      message: "It will need to pair again to reconnect.",
      confirmLabel: "Unpair",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await api.del(`/devices/${device.id}`);
      await refresh(container);
    } catch (err) {
      renderError(container, err);
    }
  });
}

function renderDeviceCard(device) {
  return `
    <div class="card device-card" data-id="${device.id}">
      <div class="device-card-main">
        ${iconBadge({ icon: deviceIcon, variant: "primary", size: "sm" })}
        <div class="device-card-info">
          <div class="device-card-title">
            <span class="device-name">${escapeHtml(device.device_name)}</span>
            <span class="badge badge-success">Paired</span>
          </div>
          <form class="device-card-rename field-row">
            <input type="text" class="rename-input" value="${escapeHtml(device.device_name)}" maxlength="100" />
            <button type="submit" class="primary">Save</button>
            <button type="button" class="text-button rename-cancel">Cancel</button>
          </form>
          <div class="device-card-meta">
            <span class="badge">${escapeHtml(device.platform)}</span>
            <span class="muted">Paired ${formatDateTime(device.paired_at)}</span>
            <span class="muted">Last seen ${formatDateTime(device.last_seen_at)}</span>
          </div>
        </div>
      </div>
      <div class="device-card-actions">
        <button class="rename">Rename</button>
        <button class="remove danger">Remove</button>
      </div>
    </div>`;
}
