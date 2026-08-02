import { Platform } from 'react-native';
import { getDefaultDeviceName } from '../../src/pairing/deviceName';

// Platform.constants is a getter-only accessor (no setter), so it must be
// stubbed via spyOn(..., 'get'), not a plain assignment.
function mockConstants(constants: unknown): void {
  jest.spyOn(Platform, 'constants', 'get').mockReturnValue(constants as typeof Platform.constants);
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('uses Platform.constants.Model when available', () => {
  mockConstants({ Model: 'Pixel 7' });
  expect(getDefaultDeviceName()).toBe('Pixel 7');
});

test('falls back to a generic name when Model is missing', () => {
  mockConstants({});
  expect(getDefaultDeviceName()).toBe('Android Device');
});

test('falls back to a generic name when Model is blank', () => {
  mockConstants({ Model: '   ' });
  expect(getDefaultDeviceName()).toBe('Android Device');
});
