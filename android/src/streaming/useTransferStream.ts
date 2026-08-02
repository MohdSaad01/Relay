import { useSyncExternalStore } from 'react';
import { TransferStreamManager } from './TransferStreamManager';

/** Reactive view of TransferStreamManager's current (or last) stream, for TransferProgressDetail. */
export function useTransferStream() {
  const state = useSyncExternalStore(TransferStreamManager.subscribe, TransferStreamManager.getState);
  return state;
}
