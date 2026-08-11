/**
 * P14.4: lets the user clear completed transfer history from the Transfers
 * screen without touching backend state or downloaded files.
 *
 * Architecture decision (see docs/13_Database_Design.md §7/§10 and
 * backend/app/repositories/transfer_repository.py's own doc comment):
 * `Transfer` rows are never deleted by normal backend operation — "they are
 * the transfer history" — and desktop's `GET /transfers` returns every
 * device's rows, not just this one's (`TransferService.list_transfers`,
 * `requesting_device is None` branch). A backend delete triggered from
 * Android would therefore reach into a history the desktop treats as its
 * own permanent record, with no architectural basis for Android to own that
 * action. "Clear History" is deliberately Android-local only: it never
 * calls the backend, and every other client (desktop, or Relay reinstalled
 * on this same phone) is unaffected.
 *
 * Persistence mirrors files/folderIdentity.ts's own precedent: a small JSON
 * file under this app's private storage, read/written via
 * react-native-blob-util (already a dependency). AsyncStorage/MMKV are not
 * already a dependency of this app (see folderIdentity.ts's own doc
 * comment), and one small marker doesn't justify adding one (CLAUDE.md
 * Rule 2).
 *
 * Eligibility: a transfer becomes historical the moment its backend status
 * leaves 'in_progress' (completed/failed/cancelled). 'in_progress' alone
 * covers both a transfer genuinely streaming right now and one merely
 * sitting in TransferStreamManager's local FIFO queue behind it — queueing
 * has no backend status of its own (see TransferStreamManager's own doc
 * comment) — so filtering on backend status is exactly "operational vs
 * terminal", not a hand-picked list of statuses, and can never hide a
 * transfer that is still genuinely active or queued.
 */

import ReactNativeBlobUtil from 'react-native-blob-util';
import { TransferResponse } from '../api/types';

const MARKER_PATH = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/relay-history-reset.json`;

interface HistoryResetMarker {
  clearedAt: string;
}

/** The last time the user cleared history on this install, or null if never. */
export async function getHistoryClearedAt(): Promise<string | null> {
  try {
    const raw = await ReactNativeBlobUtil.fs.readFile(MARKER_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<HistoryResetMarker> | null;
    return typeof parsed?.clearedAt === 'string' ? parsed.clearedAt : null;
  } catch {
    // No marker file yet (history never cleared on this install) or a
    // corrupted one — either way, treated as "never cleared", matching
    // folderIdentity.ts's own handling of an unreadable registry.
    return null;
  }
}

/** Records "now" as the clear point and returns it for immediate local use. */
export async function clearTransferHistory(): Promise<string> {
  const clearedAt = new Date().toISOString();
  await ReactNativeBlobUtil.fs.writeFile(MARKER_PATH, JSON.stringify({ clearedAt }), 'utf8');
  return clearedAt;
}

/** True once a transfer has reached a terminal backend status — see this module's own doc comment. */
export function isHistoricalTransfer(transfer: TransferResponse): boolean {
  return transfer.status !== 'in_progress';
}

/**
 * Backend timestamps (`Transfer.completed_at`/`started_at`) are serialized
 * as naive ISO strings with no 'Z'/offset — the underlying value is UTC
 * (backend/app/utils/time.py's `utc_now()`), but the string alone doesn't
 * say so. Confirmed live on RMX3997 (IST, UTC+5:30): `new Date(...)` on a
 * timezone-less ISO string parses it as *local* time, silently shifting it
 * by the device's UTC offset — a transfer that finished minutes after a
 * reset was incorrectly hidden because its `completed_at` parsed 5.5 hours
 * earlier than its true instant. Appending 'Z' when no timezone designator
 * is already present (this module's own `clearedAt`, an actual
 * `toISOString()` value, already has one) forces correct UTC parsing.
 */
function parseTimestamp(value: string): number {
  const hasTimezoneDesignator = /Z$|[+-]\d\d:?\d\d$/.test(value);
  return new Date(hasTimezoneDesignator ? value : `${value}Z`).getTime();
}

/**
 * Whether a single `transfer` would be hidden by a history reset at
 * `clearedAt` — the per-transfer predicate applyHistoryReset filters
 * `transfers` with below, factored out (P28) so a caller keying visibility
 * off some other collection derived from transfers (e.g. FilesScreen's
 * shared-item rows, which show a "Downloaded" file/folder rather than a
 * transfer itself) can reuse the exact same cutoff rule instead of
 * re-deriving it. A transfer still 'in_progress' is never hidden,
 * regardless of `clearedAt` — it is operational state, not history.
 */
export function isHiddenByHistoryReset(transfer: TransferResponse, clearedAt: string | null): boolean {
  if (clearedAt == null || !isHistoricalTransfer(transfer)) {
    return false;
  }
  const cutoff = parseTimestamp(clearedAt);
  const finishedAt = transfer.completed_at ?? transfer.started_at;
  return parseTimestamp(finishedAt) <= cutoff;
}

/**
 * Filters `transfers` down to what the Transfers screen should still show
 * after a history reset at `clearedAt`. A historical transfer is removed
 * only if it finished (completed_at, or started_at for the rare row that
 * predates that field being set) at or before the clear point, so a
 * transfer that finishes *after* the reset stays visible.
 */
export function applyHistoryReset(
  transfers: TransferResponse[],
  clearedAt: string | null,
): TransferResponse[] {
  if (clearedAt == null) {
    return transfers;
  }
  return transfers.filter(transfer => !isHiddenByHistoryReset(transfer, clearedAt));
}
