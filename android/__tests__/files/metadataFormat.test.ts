import { AvailableFileResponse, AvailableFolderResponse } from '../../src/api/types';
import { fileMetaLine, folderMetaLine } from '../../src/files/metadataFormat';

const file: AvailableFileResponse = {
  id: 1,
  file_name: 'sample.txt',
  file_size: 22,
  mime_type: 'text/plain',
  shared_at: '2026-08-10T00:00:00',
};

const folder: AvailableFolderResponse = {
  id: 1,
  folder_name: 'p144',
  total_size: 2_791_728_742,
  file_count: 10,
  shared_at: '2026-08-10T00:00:00',
};

// P22 (New_Issues.txt §5): the raw MIME type is redundant with a file's own
// extension for a normal user — see this module's own doc comment.
test('fileMetaLine shows size only, never the raw MIME type', () => {
  expect(fileMetaLine(file)).toBe('22 B');
  expect(fileMetaLine(file)).not.toMatch(/text\/plain/);
});

test('folderMetaLine leads with a "Folder" label, then item count, then size', () => {
  expect(folderMetaLine(folder)).toBe(`Folder · 10 items · ${'2.6 GB'}`);
});

test('folderMetaLine uses singular "item" for a single-file folder', () => {
  expect(folderMetaLine({ ...folder, file_count: 1, total_size: 512 })).toBe('Folder · 1 item · 512 B');
});
