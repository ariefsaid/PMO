// crypto.ts — app-layer AES-256-GCM envelope (re-export of Phase-0 graphTokenCrypto) + the
// m365-token-custody-localized KEK resolver. Pure + Deno-global-free.
//
// graphTokenCrypto is Phase-0 + security-audited. It carries Director-approved, behavior-neutral
// `as BufferSource` casts on its importKey/encrypt/decrypt call sites (graphTokenCrypto.ts:39,66)
// — a zero-runtime-change typing accommodation so the SAME module compiles under both Node/tsc and
// Deno 2.7's stricter Web-Crypto `BufferSource` (its documented dual-runtime purpose). No other
// change; the module is imported cross-tree (ADR-0060 §3 D1). The KEK resolver here reads the
// resolved `M365Env` string (NEVER Deno.env) so it stays Node-testable.

export {
  encryptToken,
  decryptToken,
  serializeEnvelope,
  deserializeEnvelope,
  type TokenEnvelope,
} from '../../../pmo-portal/src/lib/m365/graphTokenCrypto.ts';

import type { M365Env } from './types.ts';

/** Decode a base64url string (no padding) to a Uint8Array. */
export function base64UrlDecode(str: string): Uint8Array {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Resolve the KEK bytes for a stored key_id from the resolved env. Phase 1: a single KEK,
 * `kek-v1` (env.m365TokenKek, base64url). Rotation coexistence (a key map) is a later phase.
 * Throws on an unknown key_id so a row stamped with a future/foreign key never decrypts silently.
 */
export function resolveKek(env: M365Env, keyId: string): Uint8Array {
  if (keyId !== 'kek-v1') throw new Error(`m365: unknown key_id: ${keyId}`);
  return base64UrlDecode(env.m365TokenKek);
}
