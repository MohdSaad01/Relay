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
