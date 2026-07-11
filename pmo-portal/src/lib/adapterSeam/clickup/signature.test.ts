/**
 * AC-CUA-040 (signature half) — the ClickUp webhook `X-Signature` HMAC-SHA256 verifier (FR-CUA-041,
 * NFR-CUA-SEC-002). The signature is the SOLE trust boundary on the public webhook surface, so a
 * valid signature verifies and an absent/invalid/tampered one does not (no side effect upstream).
 *
 * The pure verifier takes the secret as a PARAM — the secret lives only in the edge-fn env
 * (CLICKUP_WEBHOOK_SECRET), asserted structurally: this module has no env read.
 */
import { describe, it, expect } from 'vitest';
import { verifyClickUpSignature } from './signature.ts';

const SECRET = 'test-webhook-secret';

/** Compute a valid ClickUp X-Signature (HMAC-SHA256 hex of the raw body) for the test secret. */
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
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('AC-CUA-040 verifyClickUpSignature — HMAC-SHA256 over the raw body (sole trust boundary)', () => {
  it('verifies a valid X-Signature over the raw body', async () => {
    const raw = JSON.stringify({ event: 'taskUpdated', task_id: 'cu-1', date_updated: '1000' });
    const header = await sign(raw);
    await expect(verifyClickUpSignature(raw, header, SECRET)).resolves.toBe(true);
  });

  it('rejects an absent signature header (empty string)', async () => {
    const raw = JSON.stringify({ event: 'taskUpdated' });
    await expect(verifyClickUpSignature(raw, '', SECRET)).resolves.toBe(false);
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const raw = JSON.stringify({ event: 'taskUpdated' });
    const header = await sign(raw, 'wrong-secret');
    await expect(verifyClickUpSignature(raw, header, SECRET)).resolves.toBe(false);
  });

  it('rejects a tampered body (signature no longer matches)', async () => {
    const raw = JSON.stringify({ event: 'taskUpdated', task_id: 'cu-1' });
    const header = await sign(raw);
    const tampered = JSON.stringify({ event: 'taskUpdated', task_id: 'cu-9' });
    await expect(verifyClickUpSignature(tampered, header, SECRET)).resolves.toBe(false);
  });

  it('rejects a malformed signature header', async () => {
    const raw = JSON.stringify({ event: 'taskUpdated' });
    await expect(verifyClickUpSignature(raw, 'not-a-hex-digest', SECRET)).resolves.toBe(false);
  });

  it('is case-insensitive on the hex digest (ClickUp may emit upper/lowercase)', async () => {
    const raw = JSON.stringify({ event: 'taskUpdated' });
    const header = (await sign(raw)).toUpperCase();
    await expect(verifyClickUpSignature(raw, header, SECRET)).resolves.toBe(true);
  });
});
