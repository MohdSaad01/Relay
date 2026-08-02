/**
 * GET /files is the only shared-file endpoint Android may call — every other
 * route on this resource is desktop-only (backend/README.md "Shared Files
 * API"). Uses the configured session (api/config.ts): a paired Android
 * device gets the sanitized AvailableFileResponse view, never file_path.
 */

import { apiClient } from '../client';
import { AvailableFileResponse } from '../types';

export function getAvailableFiles(): Promise<AvailableFileResponse[]> {
  return apiClient.get('/files');
}
