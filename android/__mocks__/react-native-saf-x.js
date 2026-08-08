// Manual Jest mock for react-native-saf-x (same reasoning as the other
// __mocks__ entries — a native module with no JS behavior to preserve in
// tests). Individual tests override return values via
// mockResolvedValueOnce/mockImplementationOnce as needed.
module.exports = {
  openDocumentTree: jest.fn(() => Promise.resolve(null)),
  openDocument: jest.fn(() => Promise.resolve(null)),
  createDocument: jest.fn(() => Promise.resolve(null)),
  hasPermission: jest.fn(() => Promise.resolve(true)),
  exists: jest.fn(() => Promise.resolve(false)),
  readFile: jest.fn(() => Promise.resolve('')),
  writeFile: jest.fn(() => Promise.resolve()),
  createFile: jest.fn(() => Promise.resolve({ uri: 'content://mock/created' })),
  unlink: jest.fn(() => Promise.resolve(true)),
  mkdir: jest.fn(() => Promise.resolve({ uri: 'content://mock/dir' })),
  rename: jest.fn(() => Promise.resolve({ uri: 'content://mock/renamed' })),
  getPersistedUriPermissions: jest.fn(() => Promise.resolve([])),
  releasePersistableUriPermission: jest.fn(() => Promise.resolve()),
  listFiles: jest.fn(() => Promise.resolve([])),
  stat: jest.fn(() => Promise.reject(new Error('ENOENT'))),
  copyFile: jest.fn(() => Promise.resolve({ uri: 'content://mock/copied' })),
  moveFile: jest.fn(() => Promise.resolve({ uri: 'content://mock/moved' })),
};
