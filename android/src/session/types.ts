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
}
