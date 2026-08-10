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
   * `PairingResultResponse` doesn't return it (only the credentials), so it's
   * carried forward from the name Android itself submitted in
   * `POST /pairing/request` (P23) — see PairingWaitingScreen.tsx. Kept in
   * sync with the backend's `Device.device_name` by
   * SessionManager.updateDeviceName after a successful
   * `PATCH /devices/{id}` (api/endpoints/devices.ts's renameDevice), not by
   * re-fetching it.
   */
  device_name: string;
}
