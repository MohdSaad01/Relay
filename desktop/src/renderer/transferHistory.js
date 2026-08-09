"use strict";

/**
 * Desktop "Clear History" (New_Issues.txt §2), mirrored on the same
 * architecture decision already made for Android
 * (android/src/transfers/historyReset.ts): `Transfer` rows are permanent
 * history (TransferRepository has no delete method, per
 * docs/13_Database_Design.md §7/§10) and `GET /transfers` returns every
 * device's rows, not just one caller's — there is no backend "delete
 * transfer history" operation for either client to call, by design.
 * Clearing history is therefore local-only: a "cleared at" marker persisted
 * in this renderer's own localStorage, used to filter what the Transfers
 * table displays. It never touches backend state, downloaded files, or any
 * other client (Android, or Relay on another desktop install).
 *
 * Eligibility mirrors Android's own rule exactly: a transfer becomes
 * historical the moment its status leaves 'in_progress' (completed/failed/
 * cancelled) — 'in_progress' alone covers both a transfer genuinely
 * streaming right now and one still queued client-side, so filtering on
 * backend status can never hide something still active.
 */

const HISTORY_CLEARED_AT_KEY = "relay.transfers.historyClearedAt";

/** The last time the user cleared history in this browser profile, or null if never. */
export function getHistoryClearedAt() {
  return localStorage.getItem(HISTORY_CLEARED_AT_KEY);
}

/** Records "now" as the clear point and returns it for immediate local use. */
export function clearTransferHistory() {
  const clearedAt = new Date().toISOString();
  localStorage.setItem(HISTORY_CLEARED_AT_KEY, clearedAt);
  return clearedAt;
}

/** True once a transfer has reached a terminal backend status. */
export function isHistoricalTransfer(transfer) {
  return transfer.status !== "in_progress";
}

/**
 * Backend timestamps are serialized as naive ISO strings with no 'Z' (the
 * underlying value is UTC — app/utils/time.py's utc_now()) — see dom.js's
 * parseApiDateTime for the same fix applied to display formatting. Without
 * this, a transfer finishing shortly after a reset could be parsed as
 * having finished hours earlier than clearedAt (an actual `toISOString()`
 * value, which already has a 'Z') and be incorrectly hidden.
 */
function parseTimestamp(value) {
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasTimezone ? value : `${value}Z`).getTime();
}

/**
 * Filters `transfers` down to what the Transfers table should still show
 * after a history reset at `clearedAt`. An 'in_progress' transfer is never
 * removed, regardless of `clearedAt`. A historical transfer is removed only
 * if it finished at or before the clear point, so a transfer that finishes
 * *after* the reset stays visible.
 */
export function applyHistoryReset(transfers, clearedAt) {
  if (clearedAt == null) return transfers;
  const cutoff = parseTimestamp(clearedAt);
  return transfers.filter((transfer) => {
    if (!isHistoricalTransfer(transfer)) return true;
    const finishedAt = transfer.completed_at ?? transfer.started_at;
    return parseTimestamp(finishedAt) > cutoff;
  });
}
