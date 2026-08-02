import { Platform } from 'react-native';

/**
 * Best-effort human-readable default name for this device, submitted once
 * at pairing time. Android has no way to rename it afterwards — renaming a
 * paired device is desktop-only (PATCH /devices/{id}, per backend/README.md's
 * "Shared Files API"/"Devices" precedent) — so this only needs to be a
 * reasonable default, not editable UI.
 *
 * `Platform.constants.Model` is part of React Native core on Android; no
 * extra device-info dependency is needed for it.
 */
export function getDefaultDeviceName(): string {
  const constants = Platform.constants as { Model?: string } | undefined;
  const model = constants?.Model?.trim();
  return model && model.length > 0 ? model : 'Android Device';
}
