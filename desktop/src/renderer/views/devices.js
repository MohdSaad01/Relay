"use strict";

import { api } from "../api/client.js";
import { emptyState, escapeHtml, formatDateTime, iconBadge, loadingState, pageHeader, renderError } from "../dom.js";
import { deviceIcon } from "../icons.js";

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
 * supported", confirmed live - unlike window.confirm(), which does work and
 * is still used for Remove below) so Rename previously threw an unhandled
 * error before the API call was ever made, making the button appear to do
 * nothing. Replaced with inline editing within the card instead of a native
 * prompt substitute - a full custom dialog system is P30's scope, not P29's.
 */
function wireDeviceCard(card, device, container) {
  const titleEl = card.querySelector(".device-card-title");
  const actionsEl = card.querySelector(".device-card-actions");
  const renameForm = card.querySelector(".device-card-rename");
  const renameInput = renameForm.querySelector(".rename-input");

  // Toggled via inline style rather than the `hidden` attribute: both
  // .device-card-title and .device-card-actions already set `display: flex`
  // in app.css, which (same specificity, author origin) wins the cascade
  // over the `[hidden]` UA rule and left them visibly showing through.
  function showRenameForm() {
    renameInput.value = device.device_name;
    titleEl.style.display = "none";
    actionsEl.style.display = "none";
    renameForm.style.display = "flex";
    renameInput.focus();
    renameInput.select();
  }

  function hideRenameForm() {
    renameForm.style.display = "none";
    titleEl.style.display = "";
    actionsEl.style.display = "";
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
    if (!window.confirm("Unpair this device? It will need to pair again to reconnect.")) return;
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
          <form class="device-card-rename field-row" style="display: none">
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
