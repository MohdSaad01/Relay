import { describeStatus } from '../../../src/screens/files/FilesScreen';

/**
 * P14.1: pin test for the long-press menu's Details-action state text.
 * Mirrors downloadButtonLabel.test.ts's own convention for this file's other
 * exported pure label function.
 */
describe('describeStatus', () => {
  test('completed reads "Downloaded"', () => {
    expect(describeStatus('completed', false)).toBe('Downloaded');
  });

  test('in_progress reads "Downloading" when not queued, "Queued" when queued', () => {
    expect(describeStatus('in_progress', false)).toBe('Downloading');
    expect(describeStatus('in_progress', true)).toBe('Queued');
  });

  test('pending reads "Requested"', () => {
    expect(describeStatus('pending', false)).toBe('Requested');
  });

  test('failed reads "Failed"', () => {
    expect(describeStatus('failed', false)).toBe('Failed');
  });

  test('idle reads "Not downloaded"', () => {
    expect(describeStatus('idle', false)).toBe('Not downloaded');
  });
});
