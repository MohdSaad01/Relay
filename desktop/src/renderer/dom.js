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

/**
 * Replaces a view's content with a request-failure state, in the same
 * bounded-card language as emptyState/loadingState instead of a bare red
 * paragraph. `onRetry`, if given, wires a "Try again" button that re-runs
 * the view's own refresh — omitted entirely (not just disabled) when no
 * retry path is available, so callers that don't pass it are unaffected.
 */
export function renderError(container, err, onRetry) {
  const message = escapeHtml(err.message || String(err));
  container.innerHTML = `
    <div class="error-state">
      <p class="error-state-message">${message}</p>
      ${onRetry ? '<button type="button" id="error-retry">Try again</button>' : ""}
    </div>`;
  if (onRetry) {
    container.querySelector("#error-retry").addEventListener("click", onRetry);
  }
}

/**
 * Replaces a view's content with an in-progress loading state (a small
 * spinner + message) instead of a bare paragraph, used while a view's
 * initial data fetch is in flight.
 */
export function loadingState(message = "Loading...") {
  return `
    <div class="loading-state">
      <span class="spinner" aria-hidden="true"></span>
      <p>${escapeHtml(message)}</p>
    </div>`;
}

/**
 * Human-readable file type from a file name's extension (e.g. ".pdf"),
 * shown to the user instead of a raw MIME type (New_Issues.txt §4) — a
 * normal user recognizes ".pdf"/".docx" but not "application/pdf". Falls
 * back to "File" for a name with no extension.
 */
export function formatFileType(fileName) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return "File";
  return fileName.slice(dotIndex).toLowerCase();
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
 * placeholder text. `icon` (see icons.js) is optional - when given, it's
 * shown as a leading iconBadge so the empty state reads as an intentional
 * screen instead of placeholder text (New_Issues.txt/P27 §3, §6).
 */
export function emptyState({ title, message, actionHtml, icon, variant = "primary" }) {
  return `
    <div class="empty-state">
      ${icon ? iconBadge({ icon, variant }) : ""}
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      ${actionHtml ? `<div class="empty-state-actions">${actionHtml}</div>` : ""}
    </div>`;
}

/**
 * A small circular icon badge (an inline SVG on a tinted background),
 * used to give a status card (pairing step, success/failure result) a
 * clear focal point instead of leading straight into a heading. `icon`
 * is a trusted, hand-written inline SVG string (see icons.js) - never
 * user-controlled input. `size: "sm"` (P27) renders a smaller, non-centered
 * badge meant to sit inline next to text (e.g. a device card's title row)
 * instead of leading a centered status card.
 */
export function iconBadge({ icon, variant = "primary", size }) {
  const sizeClass = size ? ` icon-badge-${size}` : "";
  return `<div class="icon-badge icon-badge-${variant}${sizeClass}">${icon}</div>`;
}
