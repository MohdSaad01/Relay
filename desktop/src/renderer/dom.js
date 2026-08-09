"use strict";

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Backend datetime fields (app/utils/time.py's utc_now()) are UTC but
 * serialized without a timezone designator (e.g. "2026-08-03T03:18:07").
 * JS's Date parser treats a designator-less ISO string as local time, so
 * every such string from the API must be tagged UTC explicitly here before
 * use - otherwise displayed/derived times are wrong by the local UTC offset.
 */
export function parseApiDateTime(iso) {
  if (!iso) return null;
  const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(iso);
  return new Date(hasTimezone ? iso : `${iso}Z`);
}

export function formatDateTime(iso) {
  const date = parseApiDateTime(iso);
  return date ? date.toLocaleString() : "-";
}

export function renderError(container, err) {
  container.innerHTML = `<p class="error">${escapeHtml(err.message || String(err))}</p>`;
}

/**
 * Consistent page title + optional subtitle + optional right-aligned actions,
 * used at the top of every view instead of each one hand-rolling its own
 * heading markup.
 */
export function pageHeader({ title, subtitle, actions }) {
  return `
    <header class="page-header">
      <div class="page-header-text">
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      </div>
      ${actions ? `<div class="page-header-actions">${actions}</div>` : ""}
    </header>`;
}

/**
 * Consistent "nothing here yet" presentation, used instead of a lone
 * paragraph so empty views read as intentional screens rather than
 * placeholder text.
 */
export function emptyState({ title, message, actionHtml }) {
  return `
    <div class="empty-state">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      ${actionHtml ? `<div class="empty-state-actions">${actionHtml}</div>` : ""}
    </div>`;
}
