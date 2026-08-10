/**
 * PATCH /devices/{id} is the only devices endpoint Android may call, and
 * only for its own device_id — every other route on this resource is
 * desktop-only (backend/README.md "Devices API"). Uses the configured
 * session (api/config.ts) for the bearer token; the backend's
 * verify_device_owner dependency rejects a token that doesn't belong to
 * the targeted device_id.
 */

import { apiClient } from '../client';
import { DeviceRenameResponse, DeviceUpdateRequest } from '../types';

export function renameDevice(deviceId: number, deviceName: string): Promise<DeviceRenameResponse> {
  const body: DeviceUpdateRequest = { device_name: deviceName };
  return apiClient.patch(`/devices/${deviceId}`, body);
}
