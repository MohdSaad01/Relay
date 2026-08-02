"use strict";

import { api } from "../api/client.js";
import { escapeHtml, renderError } from "../dom.js";

export async function mount(container) {
  await refresh(container);
  return () => {};
}

async function refresh(container) {
  container.innerHTML = "<p>Loading settings...</p>";
  try {
    const { data: settings } = await api.get("/settings");
    render(container, settings);
  } catch (err) {
    renderError(container, err);
  }
}

function render(container, settings) {
  container.innerHTML = `
    <h2>Settings</h2>
    <form id="settings-form">
      <label>
        Device display name
        <input type="text" name="device_display_name" value="${escapeHtml(settings.device_display_name)}" />
      </label>
      <label>
        Download directory
        <input type="text" name="download_directory" value="${escapeHtml(settings.download_directory)}" readonly />
        <button type="button" id="browse-directory">Browse...</button>
      </label>
      <label>
        <input type="checkbox" name="discovery_enabled" ${settings.discovery_enabled ? "checked" : ""} />
        Discoverable on the local network
      </label>
      <label>
        Session token lifetime (minutes)
        <input type="number" name="session_token_lifetime_minutes" min="1" value="${settings.session_token_lifetime_minutes}" />
      </label>
      <button type="submit">Save</button>
      <span id="save-status"></span>
    </form>
  `;

  const form = container.querySelector("#settings-form");

  container.querySelector("#browse-directory").addEventListener("click", async () => {
    const directory = await window.relay.selectDirectory();
    if (directory) {
      form.elements.download_directory.value = directory;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const statusEl = container.querySelector("#save-status");
    try {
      await api.patch("/settings", {
        device_display_name: form.elements.device_display_name.value,
        download_directory: form.elements.download_directory.value,
        discovery_enabled: form.elements.discovery_enabled.checked,
        session_token_lifetime_minutes: Number(form.elements.session_token_lifetime_minutes.value),
      });
      statusEl.textContent = "Saved.";
    } catch (err) {
      statusEl.textContent = "";
      renderError(container, err);
    }
  });
}
