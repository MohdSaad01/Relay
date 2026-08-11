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

    card.querySelector(".rename").addEventListener("click", async () => {
      const name = window.prompt("Rename device", device.device_name);
      if (!name || name === device.device_name) return;
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
