import { directionLabel, formatStatus } from '../../src/transfers/labels';

test('directionLabel flips the desktop-framed direction for Android display', () => {
  expect(directionLabel('send')).toBe('Download');
  expect(directionLabel('receive')).toBe('Upload');
});

test.each([
  ['pending', 'Pending'],
  ['accepted', 'Accepted'],
  ['rejected', 'Rejected'],
  ['in_progress', 'In progress'],
  ['completed', 'Completed'],
  ['failed', 'Failed'],
  ['cancelled', 'Cancelled'],
])('formatStatus(%s) === %s', (status, expected) => {
  expect(formatStatus(status)).toBe(expected);
});
