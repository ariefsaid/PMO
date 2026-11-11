/**
 * ClickUp webhook `X-Signature` verifier (FR-CUA-041, NFR-CUA-SEC-002, AC-CUA-040). The signature is
 * the SOLE trust boundary on the public webhook surface (STRIDE spoofing/tampering): a request is
 * untrusted until the HMAC-SHA256 of its raw body — keyed by the per-org webhook secret — matches the
 * `X-Signature` header. No signature ⇒ no side effect (the edge fn returns 401 before any apply).
 *
 * Pure + portable (Vitest + Deno): uses the Web Crypto `crypto.subtle` available in both runtimes.
 * The comparison is the one shared `../constantTimeEquals.ts` helper. The secret is taken as a
 * PARAM — it never lives in this module (it is read from `CLICKUP_WEBHOOK_SECRET` by the edge fn
 * only). ClickUp vocabulary (`X-Signature`) is confined here + the clickup-webhook fn (FR-CUA-012).
 */

import { constantTimeEquals } from '../constantTimeEquals.ts';

/**
 * Verify a ClickUp webhook `X-Signature` (HMAC-SHA256 hex of `rawBody`, keyed by `secret`).
 * Returns `true` only for an exact, constant-time match; `false` for an absent/invalid/tampered
 * signature or a secret mismatch. Case-insensitive on the hex digest (ClickUp may emit either case).
 */
export async function verifyClickUpSignature(
  rawBody: string,
  header: string,
  secret: string,
): Promise<boolean> {
  if (!header) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  // Compare lowercased so an uppercase hex digest from ClickUp still matches.
  return constantTimeEquals(computed, header.toLowerCase());
}
