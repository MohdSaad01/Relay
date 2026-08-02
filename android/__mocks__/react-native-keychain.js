// Manual Jest mock for the native module — automatically applied to every
// test (per Jest's node_modules mock convention), not just session tests,
// since App.tsx transitively calls into this at startup via SessionManager.
module.exports = {
  setGenericPassword: jest.fn(() => Promise.resolve(false)),
  getGenericPassword: jest.fn(() => Promise.resolve(false)),
  resetGenericPassword: jest.fn(() => Promise.resolve(true)),
};
