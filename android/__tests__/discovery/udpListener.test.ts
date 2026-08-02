import type { EventEmitter } from 'events';
import dgram from 'react-native-udp';
import { startUdpListener } from '../../src/discovery/udpListener';

function latestSocket(): EventEmitter & { close: jest.Mock } {
  const mockCreateSocket = dgram.createSocket as jest.Mock;
  return mockCreateSocket.mock.results[mockCreateSocket.mock.results.length - 1].value;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('creates a udp4 socket and binds the given port', () => {
  startUdpListener(40890, jest.fn());

  expect(dgram.createSocket).toHaveBeenCalledWith({ type: 'udp4' });
});

test('invokes onMessage with the decoded payload and sender address', () => {
  const onMessage = jest.fn();
  startUdpListener(40890, onMessage);

  const socket = latestSocket();
  socket.emit('message', Buffer.from('hello'), { address: '192.168.1.5' });

  expect(onMessage).toHaveBeenCalledWith('hello', '192.168.1.5');
});

test('invokes onError when the socket reports an error', () => {
  const onError = jest.fn();
  startUdpListener(40890, jest.fn(), onError);

  const socket = latestSocket();
  const error = new Error('boom');
  socket.emit('error', error);

  expect(onError).toHaveBeenCalledWith(error);
});

test('stop() closes the socket', () => {
  const handle = startUdpListener(40890, jest.fn());
  const socket = latestSocket();
  jest.spyOn(socket, 'close');

  handle.stop();

  expect(socket.close).toHaveBeenCalled();
});
