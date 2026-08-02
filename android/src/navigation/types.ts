/**
 * Navigation param lists for every navigator in the app.
 */

import { Session } from '../session/types';

/** The outcome PairingWaitingScreen hands off once polling reaches a terminal state. */
export type PairingResultParams =
  | { outcome: 'success'; session: Session }
  | { outcome: 'failure'; message: string };

export type PairingStackParamList = {
  Discovery: undefined;
  QrScan: undefined;
  PairingWaiting: { desktopBaseUrl: string; pairingToken: string };
  PairingResult: PairingResultParams;
};

export type FilesStackParamList = {
  Files: undefined;
};

/**
 * A detail screen can be reached from either half of TransferListScreen's
 * two sections: a still-pending (or just-decided) request, or an already
 * persisted transfer. They're different backend resources (TransferManager's
 * in-memory request_id vs. the database's Transfer.id) with different
 * fields, so the param is a discriminated union rather than one shape that
 * papers over the difference.
 */
export type TransferDetailParams =
  | { kind: 'request'; requestId: string }
  | { kind: 'transfer'; transferId: number };

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
