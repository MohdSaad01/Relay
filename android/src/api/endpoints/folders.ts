/**
 * GET /folders and GET /folders/{id}/files are the only shared-folder
 * endpoints Android may call — every other route on this resource is
 * desktop-only (P13, mirrors api/endpoints/files.ts). A paired Android
 * device gets the sanitized AvailableFolderResponse/AvailableFolderFileResponse
 * views, never folder_path/file_path.
 */

import { apiClient } from '../client';
import { AvailableFolderFileResponse, AvailableFolderResponse } from '../types';

export function getSharedFolders(): Promise<AvailableFolderResponse[]> {
  return apiClient.get('/folders');
}

export function getFolderFiles(folderId: number): Promise<AvailableFolderFileResponse[]> {
  return apiClient.get(`/folders/${folderId}/files`);
}
