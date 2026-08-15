/**
 * The full set of fields persisted for a paired device, per the approved
 * design's secure-storage scope: PairingResultResponse's credentials plus
 * the desktop's base URL captured at pairing time (the QR only identifies
 * the desktop once, at pairing — nothing re-derives it afterwards).
 */
export interface Session {
  device_id: number;
  device_identifier: string;
  device_secret: string;
  session_token: string;
  session_expires_at: string;
  desktop_base_url: string;
  /**
   * The human-readable display name this device is currently paired under.
   * Taken from `PairingResultResponse.device_name` (P43.1) — the backend's
   * authoritative final name, which may differ from what Android originally
   * submitted in `POST /pairing/request` if the desktop user resolved a name
   * collision with "Make it a new device" — see PairingWaitingScreen.tsx.
   * Kept in sync with the backend's `Device.device_name` afterward by
   * SessionManager.updateDeviceName after a successful
   * `PATCH /devices/{id}` (api/endpoints/devices.ts's renameDevice), not by
   * re-fetching it.
   */
  device_name: string;
}
