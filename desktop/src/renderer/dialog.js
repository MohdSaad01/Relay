"use strict";

import { escapeHtml } from "./dom.js";

/**
 * Relay's one Desktop confirmation-dialog primitive (P30), replacing
 * `window.confirm()` — which produces the OS's own unstyled prompt, entirely
 * outside app.css's design language, and only ever offers "OK"/"Cancel".
 * Renders a backdrop + card appended directly to `document.body` (not
 * `#view-container`, which `renderer.js`'s `showView()` wipes on every nav
 * click — a dialog must survive being opened from any view without special
 * casing) so it sits above the whole app regardless of which view is active.
 *
 * Uses the existing `.card`/button/badge tokens from app.css rather than new
 * one-off styling. Per index.html's CSP (`style-src 'self'`, no
 * `unsafe-inline` — see P29.1), visibility/animation must go through CSS
 * classes, never inline `style=`.
 *
 * Resolves `true` on the confirm action, `false` on Cancel, Escape, or a
 * backdrop click — mirroring `window.confirm()`'s own Cancel/Escape-cancels
 * behavior, so no call site's control flow needs to change beyond awaiting
 * this instead of reading a synchronous return value.
 */
export function confirmDialog({ title, message, confirmLabel, cancelLabel = "Cancel", destructive = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-message">
        <h2 id="dialog-title">${escapeHtml(title)}</h2>
        <p id="dialog-message">${escapeHtml(message)}</p>
        <div class="button-row dialog-actions">
          <button type="button" class="text-button dialog-cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="${destructive ? "danger" : "primary"} dialog-confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;

    function close(result) {
      document.removeEventListener("keydown", onKeydown);
      backdrop.remove();
      resolve(result);
    }

    function onKeydown(event) {
      if (event.key === "Escape") close(false);
    }

    // A click that lands on the backdrop itself (not bubbled up from the
    // card) dismisses, matching window.confirm()'s own "clicking outside
    // cancels" behavior. The card has no separate click handler to stop
    // propagation - a click inside it never reaches the backdrop element as
    // the event *target*, since currentTarget-vs-target is checked below
    // rather than relying on stopPropagation().
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close(false);
    });
    backdrop.querySelector(".dialog-cancel").addEventListener("click", () => close(false));
    backdrop.querySelector(".dialog-confirm").addEventListener("click", () => close(true));
    document.addEventListener("keydown", onKeydown);

    document.body.appendChild(backdrop);
    // Cancel takes default focus, not the (possibly destructive) confirm
    // action, so an accidental Enter press after the dialog opens can never
    // trigger Unpair/Delete/Clear History by itself (P30 §6's "no accidental
    // dismissal of destructive confirmations").
    backdrop.querySelector(".dialog-cancel").focus();
  });
}
