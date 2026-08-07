import { generateUuidV4 } from '../../src/utils/uuid';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('generates a well-formed UUID v4', () => {
  expect(generateUuidV4()).toMatch(UUID_V4_PATTERN);
});

test('generates a distinct value on each call', () => {
  const values = new Set(Array.from({ length: 20 }, () => generateUuidV4()));
  expect(values.size).toBe(20);
});
