import {
  clearUploadSource,
  getUploadSource,
  promoteUploadSource,
  registerUploadSource,
} from '../../src/streaming/uploadSourceRegistry';

const file = { uri: 'content://picked/a.txt', name: 'a.txt', size: 100 };

test('a promoted source is retrievable by transfer id', () => {
  registerUploadSource('req-1', file);
  promoteUploadSource('req-1', 42);

  expect(getUploadSource(42)).toEqual(file);
});

test('promoting an unknown request id is a safe no-op', () => {
  expect(() => promoteUploadSource('unknown-req', 99)).not.toThrow();
  expect(getUploadSource(99)).toBeUndefined();
});

test('clearUploadSource removes it', () => {
  registerUploadSource('req-2', file);
  promoteUploadSource('req-2', 7);

  clearUploadSource(7);

  expect(getUploadSource(7)).toBeUndefined();
});

test('promoting is one-shot: a second promotion of the same request id finds nothing left', () => {
  registerUploadSource('req-3', file);
  promoteUploadSource('req-3', 1);
  promoteUploadSource('req-3', 2);

  expect(getUploadSource(1)).toEqual(file);
  expect(getUploadSource(2)).toBeUndefined();
});
