/**
 * Decoding and validation for a scanned pairing QR code. Kept separate from
 * QrScanScreen so it's testable without pulling in the camera library.
 */

import { PairingQrPayload } from '../api/types';

// Must match backend Settings.PAIRING_PROTOCOL_VERSION (docs/10_Security.md §5).
const SUPPORTED_PAIRING_PROTOCOL_VERSION = 1;

function isPairingQrPayload(value: unknown): value is PairingQrPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.desktop_ip === 'string' &&
    typeof payload.port === 'number' &&
    typeof payload.pairing_token === 'string' &&
    typeof payload.protocol_version === 'number' &&
    typeof payload.relay_version === 'string'
  );
}

/** Parses and validates a scanned QR code's raw text. Throws a user-facing Error on any problem. */
export function parsePairingQrPayload(raw: string): PairingQrPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('That QR code is not a Relay pairing code.');
  }

  if (!isPairingQrPayload(parsed)) {
    throw new Error('That QR code is not a Relay pairing code.');
  }

  if (parsed.protocol_version !== SUPPORTED_PAIRING_PROTOCOL_VERSION) {
    throw new Error(
      `This app supports pairing protocol ${SUPPORTED_PAIRING_PROTOCOL_VERSION}, but the desktop is using ${parsed.protocol_version}. Update the app or the desktop and try again.`,
    );
  }

  return parsed;
}

/** e.g. "http://192.168.1.23:8000/api/v1" — matches the backend's own API_V1_PREFIX convention. */
export function buildDesktopBaseUrl(payload: PairingQrPayload): string {
  return `http://${payload.desktop_ip}:${payload.port}/api/v1`;
}
