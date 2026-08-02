import { generateDeviceIdentifier } from '../../src/pairing/deviceIdentifier';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('generates a well-formed UUID v4', () => {
  expect(generateDeviceIdentifier()).toMatch(UUID_V4_PATTERN);
});

test('generates a different value on each call', () => {
  const a = generateDeviceIdentifier();
  const b = generateDeviceIdentifier();
  expect(a).not.toBe(b);
});
