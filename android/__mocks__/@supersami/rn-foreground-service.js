// Manual Jest mock for the foreground-service native module.
module.exports = {
  register: jest.fn(),
  start: jest.fn(() => Promise.resolve()),
  update: jest.fn(() => Promise.resolve()),
  stop: jest.fn(() => Promise.resolve()),
  stopAll: jest.fn(() => Promise.resolve()),
  is_running: jest.fn(() => false),
};
