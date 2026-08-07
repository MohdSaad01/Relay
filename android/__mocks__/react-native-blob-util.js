// Manual Jest mock for the native streaming module (same reasoning as the
// other __mocks__ entries). Tests drive the returned task's outcome via the
// __resolve/__reject/__emitProgress/__emitUploadProgress test-only helpers
// below — not part of the real react-native-blob-util API.
function createTask() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  let progressCallback = null;
  let uploadProgressCallback = null;

  promise.progress = jest.fn((config, cb) => {
    progressCallback = typeof config === 'function' ? config : cb;
    return promise;
  });
  promise.uploadProgress = jest.fn((config, cb) => {
    uploadProgressCallback = typeof config === 'function' ? config : cb;
    return promise;
  });
  promise.cancel = jest.fn(() => {
    const err = new Error('cancelled');
    err.name = 'ReactNativeBlobUtilCanceledFetch';
    rejectPromise(err);
  });

  // Resolving with a distinct response object, not `promise` itself —
  // resolving a promise with itself throws "Chaining cycle detected".
  promise.__resolve = (status = 200, jsonBody = {}) => {
    resolvePromise({
      info: () => ({ status }),
      json: () => jsonBody,
    });
  };
  promise.__reject = err => rejectPromise(err);
  promise.__emitProgress = (received, total) => progressCallback && progressCallback(received, total);
  promise.__emitUploadProgress = (sent, total) => uploadProgressCallback && uploadProgressCallback(sent, total);

  return promise;
}

const fetchMock = jest.fn(() => createTask());

module.exports = {
  config: jest.fn(() => ({ fetch: fetchMock })),
  fetch: fetchMock,
  wrap: jest.fn(path => `wrapped:${path}`),
  fs: {
    dirs: {
      DocumentDir: '/mock/documents',
      DownloadDir: '/mock/downloads',
      LegacyDownloadDir: '/mock/downloads',
      CacheDir: '/mock/cache',
    },
    unlink: jest.fn(() => Promise.resolve()),
    exists: jest.fn(() => Promise.resolve(false)),
    stat: jest.fn(() => Promise.reject(new Error('ENOENT'))),
    mkdir: jest.fn(() => Promise.resolve()),
    // Default: no registry file written yet (folderIdentity.ts's own
    // "first ever download of this id" case) — individual tests override
    // via mockResolvedValueOnce/mockImplementationOnce to simulate an
    // already-persisted mapping.
    readFile: jest.fn(() => Promise.reject(new Error('ENOENT'))),
    writeFile: jest.fn(() => Promise.resolve()),
  },
  MediaCollection: {
    copyToMediaStore: jest.fn(() => Promise.resolve('content://media/downloads/1')),
  },
  android: {
    actionViewIntent: jest.fn(() => Promise.resolve(true)),
  },
};
