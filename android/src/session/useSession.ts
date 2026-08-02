import { useSyncExternalStore } from 'react';
import { SessionManager } from './SessionManager';

/** Reactive view of SessionManager, for the one navigation decision that depends on it (see RootNavigator). */
export function useSession() {
  const session = useSyncExternalStore(SessionManager.subscribe, SessionManager.getSession);
  const isRestored = useSyncExternalStore(SessionManager.subscribe, SessionManager.isRestored);
  return { session, isRestored };
}
