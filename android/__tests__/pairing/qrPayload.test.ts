import { buildDesktopBaseUrl, matchesSelectedDesktop, parsePairingQrPayload } from '../../src/pairing/qrPayload';
import { DiscoveredDesktop } from '../../src/discovery/types';

const validPayload = {
  desktop_ip: '192.168.1.23',
  port: 8000,
  pairing_token: 'abc123',
  protocol_version: 1,
  relay_version: '0.1.0',
};

test('parses a valid pairing QR payload', () => {
  expect(parsePairingQrPayload(JSON.stringify(validPayload))).toEqual(validPayload);
});

test('rejects text that is not JSON', () => {
  expect(() => parsePairingQrPayload('not json')).toThrow('not a Relay pairing code');
});

test('rejects JSON missing required fields', () => {
  expect(() => parsePairingQrPayload(JSON.stringify({ desktop_ip: '1.2.3.4' }))).toThrow(
    'not a Relay pairing code',
  );
});

test('rejects an unsupported protocol version', () => {
  const payload = { ...validPayload, protocol_version: 99 };
  expect(() => parsePairingQrPayload(JSON.stringify(payload))).toThrow('pairing protocol');
});

test('buildDesktopBaseUrl matches the backend API_V1_PREFIX convention', () => {
  expect(buildDesktopBaseUrl(validPayload)).toBe('http://192.168.1.23:8000/api/v1');
});

const selectedDevice: DiscoveredDesktop = {
  instanceId: 'instance-1',
  displayName: 'Thomas',
  desktopIp: validPayload.desktop_ip,
  port: validPayload.port,
  protocolVersion: 1,
  relayVersion: '0.1.0',
  lastSeenAt: Date.now(),
};

test('matchesSelectedDesktop accepts a QR whose (ip, port) matches the selected device', () => {
  expect(matchesSelectedDesktop(validPayload, selectedDevice)).toBe(true);
});

test('matchesSelectedDesktop rejects a QR for a different desktop IP', () => {
  const otherDevice = { ...selectedDevice, desktopIp: '192.168.1.99' };
  expect(matchesSelectedDesktop(validPayload, otherDevice)).toBe(false);
});

test('matchesSelectedDesktop rejects a QR for a different port', () => {
  const otherDevice = { ...selectedDevice, port: 9999 };
  expect(matchesSelectedDesktop(validPayload, otherDevice)).toBe(false);
});
