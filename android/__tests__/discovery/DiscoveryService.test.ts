jest.mock('../../src/discovery/udpListener');

import { startUdpListener } from '../../src/discovery/udpListener';
import { DiscoveryService } from '../../src/discovery/DiscoveryService';

const mockStartUdpListener = startUdpListener as jest.Mock;

function getOnMessage(): (data: string, address: string) => void {
  const lastCall = mockStartUdpListener.mock.calls[mockStartUdpListener.mock.calls.length - 1];
  return lastCall[1];
}

const validPayload = JSON.stringify({
  type: 'relay_discovery_announce',
  protocol_version: 1,
  relay_version: '0.1.0',
  instance_id: 'abc-123',
  device_display_name: "Saad's Desktop",
  desktop_ip: '192.168.1.10',
  port: 8000,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockStartUdpListener.mockReturnValue({ stop: jest.fn() });
  DiscoveryService.stop();
});

afterEach(() => {
  // Without this, a test that calls start() but not stop() leaks its
  // eviction setInterval past the end of the suite.
  DiscoveryService.stop();
  jest.useRealTimers();
});

test('start() begins listening with an empty discovered list', () => {
  DiscoveryService.start();

  expect(DiscoveryService.isListening()).toBe(true);
  expect(DiscoveryService.getDiscoveredDesktops()).toEqual([]);
});

test('start() is a no-op if already listening', () => {
  DiscoveryService.start();
  DiscoveryService.start();

  expect(mockStartUdpListener).toHaveBeenCalledTimes(1);
});

test('a valid announcement is added to the discovered list', () => {
  DiscoveryService.start();
  getOnMessage()(validPayload, '192.168.1.10');

  const desktops = DiscoveryService.getDiscoveredDesktops();
  expect(desktops).toHaveLength(1);
  expect(desktops[0]).toMatchObject({
    instanceId: 'abc-123',
    displayName: "Saad's Desktop",
    desktopIp: '192.168.1.10',
    port: 8000,
    protocolVersion: 1,
    relayVersion: '0.1.0',
  });
});

test('malformed JSON is ignored, not thrown', () => {
  DiscoveryService.start();

  expect(() => getOnMessage()('not json', '192.168.1.10')).not.toThrow();
  expect(DiscoveryService.getDiscoveredDesktops()).toEqual([]);
});

test('a payload with the wrong type or a missing field is ignored', () => {
  DiscoveryService.start();

  getOnMessage()(JSON.stringify({ type: 'something_else' }), '192.168.1.10');
  getOnMessage()(JSON.stringify({ type: 'relay_discovery_announce' }), '192.168.1.10');

  expect(DiscoveryService.getDiscoveredDesktops()).toEqual([]);
});

test('a second announcement from the same instance_id updates rather than duplicates', () => {
  DiscoveryService.start();

  getOnMessage()(validPayload, '192.168.1.10');
  getOnMessage()(validPayload, '192.168.1.10');

  expect(DiscoveryService.getDiscoveredDesktops()).toHaveLength(1);
});

test('stop() clears the discovered list and listener', () => {
  DiscoveryService.start();
  getOnMessage()(validPayload, '192.168.1.10');

  DiscoveryService.stop();

  expect(DiscoveryService.getDiscoveredDesktops()).toEqual([]);
  expect(DiscoveryService.isListening()).toBe(false);
});

test('an entry is evicted after no announcements are heard for a while', () => {
  jest.useFakeTimers();
  // Advanced explicitly alongside the fake timer clock, rather than relying
  // on the fake-timer implementation to fake Date.now() on its own.
  const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

  DiscoveryService.start();
  getOnMessage()(validPayload, '192.168.1.10');
  expect(DiscoveryService.getDiscoveredDesktops()).toHaveLength(1);

  dateNowSpy.mockReturnValue(1_000_000 + 9_000);
  jest.advanceTimersByTime(9_000);

  expect(DiscoveryService.getDiscoveredDesktops()).toEqual([]);
  dateNowSpy.mockRestore();
});

test('subscribe() notifies listeners when the discovered list changes, not after unsubscribing', () => {
  DiscoveryService.start();
  const listener = jest.fn();
  const unsubscribe = DiscoveryService.subscribe(listener);

  getOnMessage()(validPayload, '192.168.1.10');
  expect(listener).toHaveBeenCalledTimes(1);

  unsubscribe();
  getOnMessage()(validPayload, '192.168.1.11');
  expect(listener).toHaveBeenCalledTimes(1);
});
