/**
 * graphTokenCrypto — pure app-layer AES-256-GCM envelope encryption for Microsoft Graph tokens
 * (ADR-0060 §3 "encrypted at rest", D1 — app-layer AES-256-GCM chosen over Supabase Vault).
 *
 * Pure + Deno-global-free, Web Crypto only (`globalThis.crypto.subtle`) — the SAME code runs
 * unmodified in a Deno edge function and in Vitest (mirrors `src/lib/auth/verifyCallerJwt.ts`:
 * pure logic lives here in `pmo-portal/src/lib/`, a future edge function imports it cross-tree via
 * a relative path, e.g. `../../../pmo-portal/src/lib/m365/graphTokenCrypto.ts`). Deliberately does
 * NOT use `node:crypto` (Deno edge runtime has no Node core module resolution for it).
 *
 * Custody boundary (ADR-0060 §3/§10): this module NEVER reads an env var or secret — the caller
 * (the Phase-1 exchange edge function) is responsible for fetching the KEK from Supabase
 * secrets / vault-AS and passing it in as `keyBytes`. This module never logs plaintext or key
 * material.
 *
 * Stored `bytea` layout (`ms_graph_connections.refresh_token_ciphertext` /
 * `access_token_ciphertext`, ADR-0060 migration 0096): a single concatenated blob,
 * `iv (12 bytes) || ciphertext-with-appended-16-byte-GCM-tag`. `serializeEnvelope`/
 * `deserializeEnvelope` convert between the `{ iv, ciphertext }` pair this module works with and
 * that one-column-`bytea` shape, so the edge function can store/read a single value per row.
 */

const AES_KEY_BYTES = 32; // 256-bit key
const GCM_IV_BYTES = 12; // 96-bit IV, the NIST-recommended size for AES-GCM
const GCM_TAG_BYTES = 16; // 128-bit GCM auth tag, appended to the ciphertext by Web Crypto

export interface TokenEnvelope {
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

async function importKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  if (keyBytes.byteLength !== AES_KEY_BYTES) {
    throw new Error(`graphTokenCrypto: key must be ${AES_KEY_BYTES} bytes (256-bit), got ${keyBytes.byteLength}`);
  }
  // `as BufferSource`: a param-typed `Uint8Array` is `Uint8Array<ArrayBufferLike>` (TS 5.8+), which
  // Deno 2.7's stricter Web-Crypto `BufferSource` rejects; the cast is a no-op in Node/tsc and makes
  // this module genuinely dual-runtime (its documented purpose) with ZERO runtime change.
  return globalThis.crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Encrypt `plaintext` under `keyBytes` with a fresh random 96-bit IV (AES-256-GCM). */
export async function encryptToken(plaintext: string, keyBytes: Uint8Array): Promise<TokenEnvelope> {
  const key = await importKey(keyBytes);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return { ciphertext: new Uint8Array(encrypted), iv };
}

/**
 * Decrypt `ciphertext`/`iv` under `keyBytes`. A wrong key, wrong IV, or any tampering with the
 * ciphertext (including the appended GCM auth tag) throws — GCM authentication failure never
 * yields garbage plaintext.
 */
export async function decryptToken(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  keyBytes: Uint8Array,
): Promise<string> {
  const key = await importKey(keyBytes);
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext as BufferSource);
  return new TextDecoder().decode(decrypted);
}

/** Pack `{ iv, ciphertext }` into the single `iv || ciphertext` blob stored in the `bytea` column. */
export function serializeEnvelope(iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const blob = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  blob.set(iv, 0);
  blob.set(ciphertext, iv.byteLength);
  return blob;
}

/** Inverse of `serializeEnvelope`: split a stored `bytea` blob back into `{ iv, ciphertext }`. */
export function deserializeEnvelope(blob: Uint8Array): TokenEnvelope {
  // A valid envelope is IV (12) + ciphertext that carries at least the 16-byte GCM tag. Anything
  // shorter is malformed — reject with a clear error rather than deferring to an opaque decrypt
  // OperationError (security-audit Minor 2, 2026-07-14).
  if (blob.byteLength < GCM_IV_BYTES + GCM_TAG_BYTES) {
    throw new Error('graphTokenCrypto: envelope blob shorter than IV + GCM tag (malformed)');
  }
  return {
    iv: blob.slice(0, GCM_IV_BYTES),
    ciphertext: blob.slice(GCM_IV_BYTES),
  };
}
