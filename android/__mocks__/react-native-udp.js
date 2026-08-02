// Manual Jest mock for the native UDP module (same reasoning as
// __mocks__/react-native-keychain.js) — NativeModules.UdpSockets doesn't
// exist under Jest, and unit tests need a controllable socket to fire
// 'message'/'error' events on.
const { EventEmitter } = require('events');

class MockUdpSocket extends EventEmitter {
  bind(port, callback) {
    if (callback) {
      callback();
    }
  }
  setBroadcast() {}
  close(callback) {
    if (callback) {
      callback();
    }
  }
  address() {
    return { address: '0.0.0.0', port: 0, family: 'IPv4' };
  }
}

module.exports = {
  createSocket: jest.fn(() => new MockUdpSocket()),
  Socket: MockUdpSocket,
};
