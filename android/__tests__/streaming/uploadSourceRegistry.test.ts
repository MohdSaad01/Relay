import {
  clearUploadSource,
  getUploadSource,
  registerUploadSource,
} from '../../src/streaming/uploadSourceRegistry';

const file = { uri: 'content://picked/a.txt', name: 'a.txt', size: 100 };

test('a registered source is retrievable by transfer id', () => {
  registerUploadSource(42, file);

  expect(getUploadSource(42)).toEqual(file);
});

test('an unregistered transfer id returns undefined', () => {
  expect(getUploadSource(99)).toBeUndefined();
});

test('clearUploadSource removes it', () => {
  registerUploadSource(7, file);

  clearUploadSource(7);

  expect(getUploadSource(7)).toBeUndefined();
});
