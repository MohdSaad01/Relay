/**
 * Generates a non-cryptographic UUID v4 string. Extracted from
 * pairing/deviceIdentifier.ts (P13) so a second, unrelated caller — the
 * folder-upload batch id in streaming/folderPicker.ts — doesn't duplicate
 * the same template-replace logic. Neither use case needs cryptographic
 * randomness: a device_identifier is a plaintext lookup key, and an
 * upload_batch_id is just an opaque client-side correlation tag the backend
 * stores verbatim (see backend/app/models/transfer.py's upload_batch_id).
 */
export function generateUuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    // Bitwise ops are the standard, intentional way to write this
    // well-known UUID v4 template — not a typo'd logical operator.
    /* eslint-disable no-bitwise */
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    /* eslint-enable no-bitwise */
    return value.toString(16);
  });
}
