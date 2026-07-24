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

// ── The bytea wire seam (HIGH-A1, live security audit 2026-07-24) ────────────────────────────
// A `Uint8Array` MUST NOT be handed to supabase-js as a `bytea` RPC argument. supabase-js
// JSON-encodes RPC args, and `JSON.stringify(new Uint8Array([1,2]))` yields `{"0":1,"1":2}`;
// PostgREST casts that text straight into `bytea`, so Postgres stores the LITERAL ASCII of the
// JSON object. The live connection was written that way: a ~1.5 KB envelope became 14,709 bytes
// that are 100% printable ASCII beginning `{"0"`. The AES-GCM output inside was genuine — the
// encryption was never the problem — but `deserializeEnvelope` reads bytes 0..11 as the IV and
// got `{"0":123,"1` instead, so the row could NEVER be decrypted. Consequences: the best-effort
// Microsoft revoke inside `disconnect` throws and is swallowed by its `catch`, so a disconnect
// deletes the local row and writes an `m365.connection.revoked` audit row while the refresh token
// stays LIVE at Microsoft for ~90 days, unrevokable — we destroyed the only copy. Refresh/proxy
// are inert for the same reason.
//
// Four adversarial review rounds, 1,600 pgTAP and 5,400 unit tests all missed it because the mock
// (`m365MockDeps.ts`) holds writes as in-memory JS objects and never crosses the JS↔Postgres
// boundary. The regression proof for this fix therefore runs against a REAL Postgres, not the mock.
//
// Encode explicitly in both directions. Postgres `bytea` hex format is `\x` + lowercase hex, and
// PostgREST returns bytea columns in exactly that form.

/** Encode envelope bytes for a `bytea` RPC parameter (Postgres hex format: `\x…`). */
export function toByteaParam(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return `\\x${hex}`;
}

/**
 * Decode a `bytea` column value read back through PostgREST into envelope bytes.
 * Accepts the `\x…` hex string PostgREST returns; passes a `Uint8Array` through unchanged so a
 * direct/driver read still works. Anything else throws — a silent mis-marshal is what caused
 * HIGH-A1, so this seam must fail LOUD rather than hand garbage to `deserializeEnvelope`.
 */
export function fromByteaValue(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') {
    if (!value.startsWith('\\x')) {
      throw new Error('m365 bytea: expected Postgres hex format (\\x…) — refusing to guess');
    }
    const hex = value.slice(2);
    if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
      throw new Error('m365 bytea: malformed hex payload');
    }
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  throw new Error(`m365 bytea: unsupported value type ${typeof value}`);
}
