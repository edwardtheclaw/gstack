/**
 * v20 cookie decryption for future Chromium versions
 * 
 * Chromium v20 format uses AES-256-GCM instead of v10's AES-128-CBC.
 * Structure:
 *   - First 3 bytes: "v20" (ASCII version prefix)
 *   - Next 12 bytes: nonce (random IV for GCM)
 *   - Remaining bytes: ciphertext + authentication tag (last 16 bytes = tag)
 * 
 * Decryption process:
 *   1. Verify version prefix is "v20"
 *   2. Extract nonce (bytes 3–14)
 *   3. Separate ciphertext (bytes 15..-17) and tag (last 16 bytes)
 *   4. Decrypt with AES-256-GCM using provided key (should be 32 bytes)
 *   5. Return plaintext as UTF-8 string
 * 
 * @param encryptedValue - Buffer containing encrypted cookie data with v20 header
 * @param key - Buffer containing the AES-256 key (32 bytes)
 * @returns Decrypted cookie value as string
 * @throws Error if format is invalid or decryption fails
 */

import * as crypto from 'crypto';

export function decryptCookieV20(encryptedValue: Buffer, key: Buffer): string {
  // Minimum length: 3 (prefix) + 12 (nonce) + 1 (ciphertext) + 16 (tag) = 32 bytes
  if (encryptedValue.length < 32) {
    throw new Error(
      `Encrypted value too short for v20 format: ${encryptedValue.length} bytes`
    );
  }

  // 1. Check version prefix
  const versionPrefix = encryptedValue.slice(0, 3).toString('utf-8');
  if (versionPrefix !== 'v20') {
    throw new Error(
      `Unsupported encryption version: ${versionPrefix}, expected v20`
    );
  }

  // 2. Extract nonce (12 bytes after prefix)
  const nonce = encryptedValue.slice(3, 15);
  if (nonce.length !== 12) {
    throw new Error(
      `Invalid nonce length: ${nonce.length} bytes, expected 12`
    );
  }

  // 3. Extract ciphertext and auth tag
  // Ciphertext is everything between nonce and tag
  const ciphertextWithTag = encryptedValue.slice(15);
  if (ciphertextWithTag.length < 16) {
    throw new Error(
      `Ciphertext+tag too short: ${ciphertextWithTag.length} bytes, need at least 16 for tag`
    );
  }

  const ciphertext = ciphertextWithTag.slice(0, -16);
  const authTag = ciphertextWithTag.slice(-16);

  // 4. Decrypt with AES-256-GCM
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    
    // 5. Return as UTF-8 string
    return plaintext.toString('utf-8');
  } catch (error) {
    // Provide more context in error message
    const err = error as Error;
    throw new Error(
      `Failed to decrypt v20 cookie: ${err.message}. ` +
      `Check that key is 32 bytes (key length: ${key.length})`
    );
  }
}