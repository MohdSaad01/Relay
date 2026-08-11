"use strict";

import { api } from "../api/client.js";
import {
  emptyState,
  escapeHtml,
  formatBytes,
  formatDateTime,
  formatFileType,
  loadingState,
  pageHeader,
  renderError,
} from "../dom.js";
import { buildReceivedItems, markReceivedItemRemoved, resolveReceivedItemPath } from "../receivedFiles.js";
import { applyHistoryReset, clearTransferHistory, getHistoryClearedAt } from "../transferHistory.js";
import { folderIcon } from "../icons.js";

export async function mount(container) {
  await refresh(container);
  return () => {};
}

async function refresh(container) {
  container.innerHTML = loadingState("Loading shared files...");
  try {
    const [{ data: files }, { data: folders }, { data: transfers }, { data: settings }] = await Promise.all([
      api.get("/files"),
      api.get("/folders"),
      api.get("/transfers"),
      api.get("/settings"),
    ]);
    render(container, files, folders, transfers, settings.download_directory);
  } catch (err) {
    renderError(container, err, () => refresh(container));
  }
}

function render(container, files, folders, transfers, downloadDirectory) {
  // Files/folders shared from this desktop, plus files/folders received
  // from Android (New_Issues.txt §8) - all in one list, sorted
  // newest-first, so the user manages both from the same place instead of
  // received items only ever showing up in Transfers.
  //
  // P28: received items are entirely derived from completed transfers
  // (see receivedFiles.js's own doc comment), so "Clear History" here
  // reuses the exact same clearedAt cutoff/marker as the Transfers tab's
  // own Clear History (transferHistory.js) rather than inventing a second
  // history concept - clearing from either screen hides the same
  // history-derived entries everywhere they're shown. This never touches
  // `files`/`folders` (currently shared source entries), which have no
  // relationship to transfer history and must survive a history clear.
  const clearedAt = getHistoryClearedAt();
  const visibleTransfers = applyHistoryReset(transfers, clearedAt);
  const receivedItems = buildReceivedItems(visibleTransfers);
  const items = [
    ...files.map((file) => ({ kind: "file", ...file })),
    ...folders.map((folder) => ({ kind: "folder", ...folder })),
    ...receivedItems,
  ].sort((a, b) => new Date(itemDate(b)) - new Date(itemDate(a)));

  const rows = items.map((item) => renderRow(item)).join("");

  const actions = `
    <button id="add-files">Add Files...</button>
    <button id="add-folders">Add Folder...</button>
    <button id="clear-history" class="text-button"${receivedItems.length > 0 ? "" : " disabled"}>Clear History</button>`;

  container.innerHTML =
    pageHeader({ title: "Shared Files", subtitle: "Files and folders available to your paired devices.", actions }) +
    (items.length === 0
      ? emptyState({
          icon: folderIcon,
          title: "Nothing shared yet",
          message: "Add a file or folder to make it available for your paired devices to download.",
        })
      : `<table>
      <thead><tr><th>Name</th><th>Size</th><th>Type</th><th>Source</th><th>Date</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`);

  container.querySelector("#clear-history").addEventListener("click", () => {
    if (
      !window.confirm(
        "Clear received-file history from this list? Currently shared files/folders stay listed, downloaded files stay on your computer, and any active transfer stays visible in Transfers."
      )
    ) {
      return;
    }
    clearTransferHistory();
    refresh(container);
  });

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

  wireSharedRowActions(container);
  wireReceivedRowActions(container, items, downloadDirectory);
}

function itemDate(item) {
  return item.kind === "received-file" || item.kind === "received-folder" ? item.receivedAt : item.shared_at;
}

function renderRow(item) {
  switch (item.kind) {
    case "file":
      return renderFileRow(item);
    case "folder":
      return renderFolderRow(item);
    case "received-file":
      return renderReceivedFileRow(item);
    case "received-folder":
      return renderReceivedFolderRow(item);
    default:
      return "";
  }
}

function renderFileRow(file) {
  return `
    <tr data-id="${file.id}" data-path="${escapeHtml(file.file_path)}" data-kind="file">
      <td>${escapeHtml(file.file_name)}</td>
      <td>${formatBytes(file.file_size)}</td>
      <td>${formatFileType(file.file_name)}</td>
      <td><span class="badge">Shared</span></td>
      <td>${formatDateTime(file.shared_at)}</td>
      <td>
        <div class="row-actions">
          <button class="show-in-folder">Show in Folder</button>
          <button class="refresh">Refresh</button>
          <button class="unshare">Unshare</button>
          <button class="delete danger">Delete</button>
        </div>
      </td>
    </tr>`;
}

function renderFolderRow(folder) {
  return `
    <tr data-id="${folder.id}" data-path="${escapeHtml(folder.folder_path)}" data-kind="folder">
      <td>&#128193; ${escapeHtml(folder.folder_name)}</td>
      <td>${formatBytes(folder.total_size)}</td>
      <td>${formatFolderType(folder.file_count)}</td>
      <td><span class="badge">Shared</span></td>
      <td>${formatDateTime(folder.shared_at)}</td>
      <td>
        <div class="row-actions">
          <button class="show-in-folder">Show in Folder</button>
          <button class="refresh">Refresh</button>
          <button class="unshare">Unshare</button>
          <button class="delete danger">Delete</button>
        </div>
      </td>
    </tr>`;
}

function renderReceivedFileRow(item) {
  return `
    <tr data-received-key="${escapeHtml(item.key)}" data-received-kind="file">
      <td>${escapeHtml(item.name)}</td>
      <td>${formatBytes(item.size)}</td>
      <td>${formatFileType(item.name)}</td>
      <td><span class="badge">Received</span></td>
      <td>${formatDateTime(item.receivedAt)}</td>
      <td>
        <div class="row-actions">
          <button class="open">Open</button>
          <button class="show-in-folder">Show in Folder</button>
          <button class="delete danger">Delete</button>
        </div>
      </td>
    </tr>`;
}

function renderReceivedFolderRow(item) {
  return `
    <tr data-received-key="${escapeHtml(item.key)}" data-received-kind="folder">
      <td>&#128193; ${escapeHtml(item.name)}</td>
      <td>${formatBytes(item.size)}</td>
      <td>${formatFolderType(item.fileCount)}</td>
      <td><span class="badge">Received</span></td>
      <td>${formatDateTime(item.receivedAt)}</td>
      <td>
        <div class="row-actions">
          <button class="show-in-folder">Show in Folder</button>
          <button class="delete danger">Delete</button>
        </div>
      </td>
    </tr>`;
}

/** "Folder (10 items)" instead of a bare item count (New_Issues.txt §4). */
function formatFolderType(fileCount) {
  return `Folder (${fileCount} item${fileCount === 1 ? "" : "s"})`;
}

function wireSharedRowActions(container) {
  container.querySelectorAll("tr[data-id]").forEach((row) => {
    const id = Number(row.dataset.id);
    const filePath = row.dataset.path;
    const kind = row.dataset.kind;
    const resource = kind === "folder" ? "folders" : "files";
    const noun = kind === "folder" ? "folder" : "file";

    row.querySelector(".show-in-folder").addEventListener("click", () => {
      window.relay.showInFolder(filePath);
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
      if (!window.confirm(`Stop sharing this ${noun}? It will no longer be available to paired devices.`)) return;
      try {
        await api.del(`/${resource}/${id}`);
        await refresh(container);
      } catch (err) {
        renderError(container, err);
      }
    });

    row.querySelector(".delete").addEventListener("click", async () => {
      if (
        !window.confirm(
          `Delete this ${noun} from your computer? This moves it to the Recycle Bin and removes it from Shared Files.`
        )
      )
        return;
      try {
        await window.relay.deleteItem(filePath);
        await api.del(`/${resource}/${id}`);
        await refresh(container);
      } catch (err) {
        renderError(container, err);
      }
    });
  });
}

function wireReceivedRowActions(container, items, downloadDirectory) {
  const receivedByKey = new Map(
    items.filter((item) => item.kind.startsWith("received-")).map((item) => [item.key, item])
  );

  container.querySelectorAll("tr[data-received-key]").forEach((row) => {
    const item = receivedByKey.get(row.dataset.receivedKey);
    if (!item) return;
    const noun = item.kind === "received-folder" ? "folder" : "file";

    const openButton = row.querySelector(".open");
    if (openButton) {
      openButton.addEventListener("click", async () => {
        try {
          const path = await resolveReceivedItemPath(downloadDirectory, item);
          const error = await window.relay.openPath(path);
          if (error) throw new Error(error);
        } catch (err) {
          renderError(container, err);
        }
      });
    }

    row.querySelector(".show-in-folder").addEventListener("click", async () => {
      const path = await resolveReceivedItemPath(downloadDirectory, item);
      window.relay.showInFolder(path);
    });

    row.querySelector(".delete").addEventListener("click", async () => {
      if (
        !window.confirm(
          `Delete this received ${noun} from your computer? This moves it to the Recycle Bin and removes it from Shared Files. The original on the Android device is not affected.`
        )
      )
        return;
      try {
        const path = await resolveReceivedItemPath(downloadDirectory, item);
        await window.relay.deleteItem(path);
        markReceivedItemRemoved(item.key);
        await refresh(container);
      } catch (err) {
        renderError(container, err);
      }
    });
  });
}
