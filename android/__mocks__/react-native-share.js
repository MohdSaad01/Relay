// Manual Jest mock for the native share module (same reasoning as the other
// __mocks__ entries — it's a TurboModule only registered in a real native
// binary). `open` is the only method this codebase calls (downloadActions.ts's
// shareDownloadedFile).
module.exports = {
  open: jest.fn(() => Promise.resolve({ success: true })),
};
