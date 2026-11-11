/**
 * erpnext/webhookSignature.ts (task 8.2, AC-ENA-070) — the Frappe `X-Frappe-Webhook-Signature`
 * verifier: the SOLE trust boundary on the public erpnext-webhook surface (STRIDE spoofing/tampering).
 * The signature is `base64(HMAC-SHA256(secret, raw_body))` (R9/intake §2.13). Pure + portable (Web
 * Crypto `crypto.subtle`; the comparison is the one shared `../constantTimeEquals.ts` helper):
 * a request is untrusted until the recomputed base64 HMAC matches the header, constant-time. No
 * signature ⇒ no side effect (the edge fn returns 401 before any apply, FR-ENA-082).
 *
 * The secret is taken as a PARAM — it never lives in this module (the edge fn reads it from the
 * per-org `webhook_secret_ref`-resolved env at the boundary only, NFR-ENA-SEC-002). Frappe vocabulary
 * (`X-Frappe-Webhook-Signature`, base64) is confined here + the erpnext-webhook fn (FR-ENA-013).
 */

import { constantTimeEquals } from '../constantTimeEquals.ts';

function bytesToBase64(bytes: Uint8Array): string {
  // `btoa` is available in both Deno and the browser; binary-string round-trip via chunked decode
  // avoids Unicode pitfalls (the HMAC bytes are arbitrary 0..255).
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Verify a Frappe `X-Frappe-Webhook-Signature` (base64 HMAC-SHA256 of `rawBody`, keyed by `secret`).
 * Returns `true` only for an exact, constant-time match; `false` for an absent/invalid/tampered
 * signature or a secret mismatch. Whitespace-trimmed on the header (a Frappe hook may emit trailing
 * whitespace); the secret is never empty-skipped — an empty secret is a misconfiguration that must
 * fail CLOSED (the edge fn gates on a non-empty employing-org secret before calling here).
 */
export async function verifyErpWebhookSignature(
  rawBody: string,
  header: string,
  secret: string,
): Promise<boolean> {
  if (!header || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const computed = bytesToBase64(new Uint8Array(sigBuf));
  return constantTimeEquals(computed, header.trim());
}
