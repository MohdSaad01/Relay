import { Platform } from 'react-native';

/**
 * Best-effort human-readable default name for this device, submitted once
 * at pairing time (`POST /pairing/request`'s `device_name`) and carried
 * forward into `Session.device_name` (session/types.ts). Editable
 * afterwards from the Settings screen (P23), which calls
 * `PATCH /devices/{id}` via api/endpoints/devices.ts's renameDevice — this
 * function only supplies the initial value, not a permanent one.
 *
 * `Platform.constants.Model` is part of React Native core on Android; no
 * extra device-info dependency is needed for it.
 */
export function getDefaultDeviceName(): string {
  const constants = Platform.constants as { Model?: string } | undefined;
  const model = constants?.Model?.trim();
  return model && model.length > 0 ? model : 'Android Device';
}
