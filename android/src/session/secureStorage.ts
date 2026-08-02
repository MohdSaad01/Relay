/**
 * Low-level persistence for the paired-device Session: react-native-keychain
 * backs onto Android Keystore, unlike AsyncStorage's plaintext file — required
 * for device_secret/session_token per docs/10_Security.md §7-8's treatment
 * of these as bearer credentials.
 *
 * The whole Session is stored as one JSON blob under a fixed generic-password
 * entry (there is only ever one paired desktop per device in V1, so there is
 * no need for the keyed/multi-entry Keychain APIs).
 */

import * as Keychain from 'react-native-keychain';
import { Session } from './types';

const SERVICE = 'com.relay.mobile.session';
const USERNAME = 'relay-session';

export async function saveSession(session: Session): Promise<void> {
  await Keychain.setGenericPassword(USERNAME, JSON.stringify(session), { service: SERVICE });
}

export async function loadSession(): Promise<Session | null> {
  const credentials = await Keychain.getGenericPassword({ service: SERVICE });
  if (!credentials) {
    return null;
  }
  try {
    return JSON.parse(credentials.password) as Session;
  } catch (err) {
    // A corrupted entry is treated the same as "no session" — the pairing
    // flow is a safe fallback either way — but it's logged, not swallowed.
    console.warn('Discarding unreadable stored session:', err);
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE });
}
