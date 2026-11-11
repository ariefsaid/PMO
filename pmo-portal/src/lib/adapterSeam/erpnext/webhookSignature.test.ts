/**
 * AC-ENA-070 (signature half) — the Frappe `X-Frappe-Webhook-Signature` base64 HMAC-SHA256 verifier
 * (the SOLE trust boundary on the public erpnext-webhook surface). A valid signature verifies and an
 * absent/invalid/tampered one does not, so a request without a matching signature can have no side
 * effect upstream (FR-ENA-082). The verifier is pure: the secret is a PARAM and an empty secret fails
 * CLOSED (never an empty-secret match).
 */
import { describe, it, expect } from 'vitest';
import { verifyErpWebhookSignature } from './webhookSignature.ts';

const SECRET = 'test-webhook-secret';

/** Compute a valid Frappe signature (base64 of HMAC-SHA256 over the raw body) for the test secret. */
async function sign(rawBody: string, secret: string = SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  let bin = '';
  for (let i = 0; i < sig.byteLength; i += 1) bin += String.fromCharCode(new Uint8Array(sig)[i]);
  return btoa(bin);
}

describe('AC-ENA-070 verifyErpWebhookSignature — base64 HMAC-SHA256 over the raw body (sole trust boundary)', () => {
  it('verifies a valid X-Frappe-Webhook-Signature over the raw body', async () => {
    const raw = JSON.stringify({ event: 'on_update', name: 'ACC-PINV-2026-00001' });
    const header = await sign(raw);
    await expect(verifyErpWebhookSignature(raw, header, SECRET)).resolves.toBe(true);
  });

  it('rejects an absent signature header (empty string)', async () => {
    const raw = JSON.stringify({ event: 'on_update' });
    await expect(verifyErpWebhookSignature(raw, '', SECRET)).resolves.toBe(false);
  });

  it('fails closed on an empty secret', async () => {
    const raw = JSON.stringify({ event: 'on_update' });
    const header = await sign(raw);
    await expect(verifyErpWebhookSignature(raw, header, '')).resolves.toBe(false);
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const raw = JSON.stringify({ event: 'on_update' });
    const header = await sign(raw, 'wrong-secret');
    await expect(verifyErpWebhookSignature(raw, header, SECRET)).resolves.toBe(false);
  });

  it('rejects a tampered body (signature no longer matches)', async () => {
    const raw = JSON.stringify({ event: 'on_update', name: 'ACC-PINV-2026-00001' });
    const header = await sign(raw);
    const tampered = JSON.stringify({ event: 'on_update', name: 'ACC-PINV-2026-00009' });
    await expect(verifyErpWebhookSignature(tampered, header, SECRET)).resolves.toBe(false);
  });

  it('rejects a malformed signature header', async () => {
    const raw = JSON.stringify({ event: 'on_update' });
    await expect(verifyErpWebhookSignature(raw, 'not-base64!!', SECRET)).resolves.toBe(false);
  });

  it('verifies a header with trailing whitespace (a Frappe hook may emit it)', async () => {
    const raw = JSON.stringify({ event: 'on_update' });
    const header = `${await sign(raw)}\n`;
    await expect(verifyErpWebhookSignature(raw, header, SECRET)).resolves.toBe(true);
  });
});
