import { formatFileSize } from '../../src/utils/formatFileSize';

test.each([
  [0, '0 B'],
  [512, '512 B'],
  [1023, '1023 B'],
  [1024, '1.0 KB'],
  [1536, '1.5 KB'],
  [1024 * 1024, '1.0 MB'],
  [1024 * 1024 * 1024, '1.0 GB'],
  [1024 * 1024 * 1024 * 1024, '1.0 TB'],
  [1024 * 1024 * 1024 * 1024 * 1024, '1024.0 TB'],
])('formatFileSize(%i) === %s', (bytes, expected) => {
  expect(formatFileSize(bytes)).toBe(expected);
});
