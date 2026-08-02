"use strict";

import { api } from "../api/client.js";
import { escapeHtml, formatBytes, formatDateTime, renderError } from "../dom.js";

export async function mount(container) {
  await refresh(container);
  return () => {};
}

async function refresh(container) {
  container.innerHTML = "<p>Loading shared files...</p>";
  try {
    const { data: files } = await api.get("/files");
    render(container, files);
  } catch (err) {
    renderError(container, err);
  }
}

function render(container, files) {
  const rows = files
    .map(
      (file) => `
      <tr data-id="${file.id}" data-path="${escapeHtml(file.file_path)}">
        <td>${escapeHtml(file.file_name)}</td>
        <td>${formatBytes(file.file_size)}</td>
        <td>${escapeHtml(file.mime_type ?? "-")}</td>
        <td>${formatDateTime(file.shared_at)}</td>
        <td>
          <button class="show-in-folder">Show in Folder</button>
          <button class="refresh">Refresh</button>
          <button class="unshare danger">Unshare</button>
        </td>
      </tr>`
    )
    .join("");

  container.innerHTML = `
    <h2>Shared Files</h2>
    <button id="add-files">Add Files...</button>
    ${
      files.length === 0
        ? "<p>No files are shared yet.</p>"
        : `<table>
      <thead><tr><th>Name</th><th>Size</th><th>Type</th><th>Shared</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
    }
  `;

  container.querySelector("#add-files").addEventListener("click", async () => {
    const paths = await window.relay.selectFiles();
    if (!paths || paths.length === 0) return;
    try {
      for (const filePath of paths) {
        await api.post("/files", { file_path: filePath });
      }
      await refresh(container);
    } catch (err) {
      renderError(container, err);
    }
  });

  container.querySelectorAll("tr[data-id]").forEach((row) => {
    const id = Number(row.dataset.id);
    const filePath = row.dataset.path;

    row.querySelector(".show-in-folder").addEventListener("click", () => {
      window.relay.showInFolder(filePath);
    });

    row.querySelector(".refresh").addEventListener("click", async () => {
      try {
        await api.post(`/files/${id}/refresh`);
        await refresh(container);
      } catch (err) {
        renderError(container, err);
      }
    });

    row.querySelector(".unshare").addEventListener("click", async () => {
      if (!window.confirm("Stop sharing this file? It will no longer be available to paired devices.")) return;
      try {
        await api.del(`/files/${id}`);
        await refresh(container);
      } catch (err) {
        renderError(container, err);
      }
    });
  });
}
