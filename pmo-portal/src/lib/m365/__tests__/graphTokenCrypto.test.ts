/**
 * Tests for the pure AES-256-GCM envelope-encryption helper (ADR-0060 §3, D1).
 * Offline: generates an ephemeral 32-byte test key with Web Crypto — no live secrets, no network,
 * no DB. Proves round-trip correctness and GCM tamper-detection (wrong key / flipped ciphertext /
 * wrong IV all throw rather than returning garbage plaintext).
 */
import { describe, it, expect } from 'vitest';
import {
  encryptToken,
  decryptToken,
  serializeEnvelope,
  deserializeEnvelope,
} from '../graphTokenCrypto';

function randomKey(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

describe('graphTokenCrypto', () => {
  it('AC-M365-030: round-trips a plaintext through encrypt then decrypt', async () => {
    const key = randomKey();
    const plaintext = 'a-super-secret-refresh-token-value';
    const { ciphertext, iv } = await encryptToken(plaintext, key);
    const decrypted = await decryptToken(ciphertext, iv, key);
    expect(decrypted).toBe(plaintext);
  });

  it('AC-M365-030: produces a DIFFERENT IV on each encrypt call of the same input (no static IV)', async () => {
    const key = randomKey();
    const plaintext = 'same-plaintext-every-time';
    const first = await encryptToken(plaintext, key);
    const second = await encryptToken(plaintext, key);
    expect(first.iv).not.toEqual(second.iv);
    // Different IVs also produce different ciphertext bytes for the same plaintext (GCM keystream).
    expect(first.ciphertext).not.toEqual(second.ciphertext);
  });

  it('AC-M365-030: decrypting with the WRONG key throws (never returns garbage plaintext)', async () => {
    const key = randomKey();
    const wrongKey = randomKey();
    const { ciphertext, iv } = await encryptToken('secret-value', key);
    await expect(decryptToken(ciphertext, iv, wrongKey)).rejects.toThrow();
  });

  it('AC-M365-030: decrypting a BIT-FLIPPED ciphertext throws (GCM tamper detection)', async () => {
    const key = randomKey();
    const { ciphertext, iv } = await encryptToken('secret-value', key);
    const tampered = new Uint8Array(ciphertext);
    tampered[0] = tampered[0] ^ 0xff; // flip a bit
    await expect(decryptToken(tampered, iv, key)).rejects.toThrow();
  });

  it('AC-M365-030: decrypting with the WRONG iv throws', async () => {
    const key = randomKey();
    const { ciphertext } = await encryptToken('secret-value', key);
    const wrongIv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    await expect(decryptToken(ciphertext, wrongIv, key)).rejects.toThrow();
  });

  it('AC-M365-030: rejects a key that is not 32 bytes (256-bit)', async () => {
    const shortKey = new Uint8Array(16);
    await expect(encryptToken('secret-value', shortKey)).rejects.toThrow();
  });

  it('AC-M365-030: serializeEnvelope/deserializeEnvelope round-trip the iv||ciphertext bytea layout', async () => {
    const key = randomKey();
    const { ciphertext, iv } = await encryptToken('serialize-me', key);
    const blob = serializeEnvelope(iv, ciphertext);
    // Layout: first 12 bytes are the IV, the remainder is the GCM ciphertext+tag.
    expect(blob.byteLength).toBe(iv.byteLength + ciphertext.byteLength);
    expect(blob.slice(0, 12)).toEqual(iv);
    const { iv: parsedIv, ciphertext: parsedCiphertext } = deserializeEnvelope(blob);
    expect(parsedIv).toEqual(iv);
    expect(parsedCiphertext).toEqual(ciphertext);
    const decrypted = await decryptToken(parsedCiphertext, parsedIv, key);
    expect(decrypted).toBe('serialize-me');
  });

  it('AC-M365-030: deserializeEnvelope rejects a blob shorter than the IV length', () => {
    expect(() => deserializeEnvelope(new Uint8Array(4))).toThrow();
  });

  it('AC-M365-030: deserializeEnvelope rejects a blob >= IV but shorter than IV + GCM tag (malformed)', () => {
    // 12 (IV) + 15 = 27 bytes: passes the old IV-only guard but cannot hold the 16-byte GCM tag.
    expect(() => deserializeEnvelope(new Uint8Array(27))).toThrow(/IV \+ GCM tag/);
    // The boundary — exactly IV + tag (28) — is accepted (empty-plaintext ciphertext is just the tag).
    expect(() => deserializeEnvelope(new Uint8Array(28))).not.toThrow();
  });
});
