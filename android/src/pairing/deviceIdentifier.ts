/**
 * Generates a fresh device_identifier for a pairing attempt.
 *
 * Not a secret — it's sent in plaintext in POST /pairing/request and stored
 * server-side purely as a lookup key (backend/app/repositories/device_repository.py's
 * get_by_identifier) — so a non-cryptographic UUID v4 is sufficient; no
 * crypto/native dependency is needed for it.
 *
 * Deliberately generated fresh per pairing attempt rather than persisted
 * independently of the Session: once pairing succeeds it becomes part of
 * the Session (SessionManager owns it from that point on), per the earlier
 * milestone's rule that SessionManager is the only thing reading or writing
 * secure session data. A consequence: re-pairing with the same desktop after
 * an explicit "forget" registers as a new device server-side rather than
 * reclaiming the old row — backend/app/services/pairing_service.py's
 * submit_pairing_request rejects a still-registered identifier with 409, so
 * reusing one across a forget would require the desktop user to first
 * remove the stale entry anyway. Treating "forget" as a clean reset avoids
 * that extra coupling.
 */
export function generateDeviceIdentifier(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    // Bitwise ops are the standard, intentional way to write this
    // well-known UUID v4 template — not a typo'd logical operator.
    /* eslint-disable no-bitwise */
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    /* eslint-enable no-bitwise */
    return value.toString(16);
  });
}
