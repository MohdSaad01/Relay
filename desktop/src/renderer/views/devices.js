"use strict";

import { api } from "../api/client.js";
import { escapeHtml, formatDateTime, renderError } from "../dom.js";

export async function mount(container) {
  await refresh(container);
  return () => {};
}

async function refresh(container) {
  container.innerHTML = "<p>Loading devices...</p>";
  try {
    const { data: devices } = await api.get("/devices");
    render(container, devices);
  } catch (err) {
    renderError(container, err);
  }
}

function render(container, devices) {
  if (devices.length === 0) {
    container.innerHTML = "<h2>Paired Devices</h2><p>No devices are paired yet. Use the Pairing tab to pair one.</p>";
    return;
  }

  const rows = devices
    .map(
      (device) => `
      <tr data-id="${device.id}">
        <td>${escapeHtml(device.device_name)}</td>
        <td>${escapeHtml(device.platform)}</td>
        <td>${formatDateTime(device.paired_at)}</td>
        <td>${formatDateTime(device.last_seen_at)}</td>
        <td>
          <button class="rename">Rename</button>
          <button class="remove danger">Remove</button>
        </td>
      </tr>`
    )
    .join("");

  container.innerHTML = `
    <h2>Paired Devices</h2>
    <table>
      <thead>
        <tr><th>Name</th><th>Platform</th><th>Paired</th><th>Last Seen</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  container.querySelectorAll("tr[data-id]").forEach((row) => {
    const id = Number(row.dataset.id);

    row.querySelector(".rename").addEventListener("click", async () => {
      const currentName = devices.find((d) => d.id === id)?.device_name ?? "";
      const name = window.prompt("Rename device", currentName);
      if (!name || name === currentName) return;
      try {
        await api.patch(`/devices/${id}`, { device_name: name });
        await refresh(container);
      } catch (err) {
        renderError(container, err);
      }
    });

    row.querySelector(".remove").addEventListener("click", async () => {
      if (!window.confirm("Unpair this device? It will need to pair again to reconnect.")) return;
      try {
        await api.del(`/devices/${id}`);
        await refresh(container);
      } catch (err) {
        renderError(container, err);
      }
    });
  });
}
