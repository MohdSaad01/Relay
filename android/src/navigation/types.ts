/**
 * Navigation param lists for every navigator in the app.
 */

import { Session } from '../session/types';
import { DiscoveredDesktop } from '../discovery/types';

/** The outcome PairingWaitingScreen hands off once polling reaches a terminal state. */
export type PairingResultParams =
  | { outcome: 'success'; session: Session }
  | { outcome: 'failure'; message: string };

export type PairingStackParamList = {
  Discovery: undefined;
  // `device` is only present when the scanner was opened by tapping a
  // specific discovered device (as opposed to the always-available "Scan QR
  // to Pair" button) — it lets QrScanScreen flag a scanned QR that belongs to
  // a different desktop than the one the user selected. See
  // qrPayload.ts's matchesSelectedDesktop for the (IP, port) comparison this
  // enables — the closest thing to a device-identity check the current QR
  // payload supports.
  QrScan: { device?: DiscoveredDesktop } | undefined;
  PairingWaiting: { desktopBaseUrl: string; pairingToken: string };
  PairingResult: PairingResultParams;
};

export type FilesStackParamList = {
  Files: undefined;
};

/**
 * A transfer proposal is auto-accepted the moment it's made
 * (backend/app/services/transfer_service.py), so a detail screen only ever
 * needs to show the persisted Transfer — there is no separate pending
 * "request" state left to view.
 */
export type TransferDetailParams = { transferId: number };

export type TransfersStackParamList = {
  TransferList: undefined;
  TransferDetail: TransferDetailParams;
};

export type SettingsStackParamList = {
  Settings: undefined;
};

export type MainTabParamList = {
  FilesTab: undefined;
  TransfersTab: undefined;
  SettingsTab: undefined;
};

export type RootStackParamList = {
  Pairing: undefined;
  Main: undefined;
};
