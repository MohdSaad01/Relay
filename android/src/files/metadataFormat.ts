import { AvailableFileResponse, AvailableFolderResponse } from '../api/types';
import { formatFileSize } from '../utils/formatFileSize';

/**
 * New_Issues.txt §5: a file's own name already carries its extension (e.g.
 * "sample.txt"), so repeating its raw MIME type ("text/plain") next to it is
 * redundant, technical detail a normal user doesn't need — size alone is the
 * useful fact the name doesn't already convey. A folder's name carries no
 * such type information, so its line leads with an explicit "Folder" label
 * instead, matching this file line's ordering once "Folder" is read as
 * filling the type slot a file's own name already fills silently: [type],
 * then size-relevant detail, size last.
 */
export function fileMetaLine(file: AvailableFileResponse): string {
  return formatFileSize(file.file_size);
}

export function folderMetaLine(folder: AvailableFolderResponse): string {
  const itemLabel = `${folder.file_count} item${folder.file_count === 1 ? '' : 's'}`;
  return `Folder · ${itemLabel} · ${formatFileSize(folder.total_size)}`;
}
