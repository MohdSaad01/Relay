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
    const [{ data: files }, { data: folders }] = await Promise.all([
      api.get("/files"),
      api.get("/folders"),
    ]);
    render(container, files, folders);
  } catch (err) {
    renderError(container, err);
  }
}

function render(container, files, folders) {
  // Folders and standalone files share one list, sorted newest-shared-first,
  // each row still driven by its own resource (/files/{id} vs
  // /folders/{id}) — a folder is one item here regardless of how many files
  // it contains (11_File_Transfer.md: "must not display every contained
  // file individually").
  const items = [
    ...files.map((file) => ({ kind: "file", ...file })),
    ...folders.map((folder) => ({ kind: "folder", ...folder })),
  ].sort((a, b) => new Date(b.shared_at) - new Date(a.shared_at));

  const rows = items.map((item) => (item.kind === "folder" ? renderFolderRow(item) : renderFileRow(item))).join("");

  container.innerHTML = `
    <h2>Shared Files</h2>
    <button id="add-files">Add Files...</button>
    <button id="add-folders">Add Folder...</button>
    ${
      items.length === 0
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

  container.querySelector("#add-folders").addEventListener("click", async () => {
    const paths = await window.relay.selectFolders();
    if (!paths || paths.length === 0) return;
    try {
      for (const folderPath of paths) {
        await api.post("/folders", { folder_path: folderPath });
      }
      await refresh(container);
    } catch (err) {
      renderError(container, err);
    }
  });

  container.querySelectorAll("tr[data-id]").forEach((row) => {
    const id = Number(row.dataset.id);
    const path = row.dataset.path;
    const kind = row.dataset.kind;
    const resource = kind === "folder" ? "folders" : "files";

    row.querySelector(".show-in-folder").addEventListener("click", () => {
      window.relay.showInFolder(path);
    });

    row.querySelector(".refresh").addEventListener("click", async () => {
      try {
        await api.post(`/${resource}/${id}/refresh`);
        await refresh(container);
      } catch (err) {
        renderError(container, err);
      }
    });

    row.querySelector(".unshare").addEventListener("click", async () => {
      const confirmMessage =
        kind === "folder"
          ? "Stop sharing this folder? It will no longer be available to paired devices."
          : "Stop sharing this file? It will no longer be available to paired devices.";
      if (!window.confirm(confirmMessage)) return;
      try {
        await api.del(`/${resource}/${id}`);
        await refresh(container);
      } catch (err) {
        renderError(container, err);
      }
    });
  });
}

function renderFileRow(file) {
  return `
    <tr data-id="${file.id}" data-path="${escapeHtml(file.file_path)}" data-kind="file">
      <td>${escapeHtml(file.file_name)}</td>
      <td>${formatBytes(file.file_size)}</td>
      <td>${escapeHtml(file.mime_type ?? "-")}</td>
      <td>${formatDateTime(file.shared_at)}</td>
      <td>
        <button class="show-in-folder">Show in Folder</button>
        <button class="refresh">Refresh</button>
        <button class="unshare danger">Unshare</button>
      </td>
    </tr>`;
}

function renderFolderRow(folder) {
  const itemCount = `${folder.file_count} item${folder.file_count === 1 ? "" : "s"}`;
  return `
    <tr data-id="${folder.id}" data-path="${escapeHtml(folder.folder_path)}" data-kind="folder">
      <td>&#128193; ${escapeHtml(folder.folder_name)}</td>
      <td>${formatBytes(folder.total_size)}</td>
      <td>${itemCount}</td>
      <td>${formatDateTime(folder.shared_at)}</td>
      <td>
        <button class="show-in-folder">Show in Folder</button>
        <button class="refresh">Refresh</button>
        <button class="unshare danger">Unshare</button>
      </td>
    </tr>`;
}
