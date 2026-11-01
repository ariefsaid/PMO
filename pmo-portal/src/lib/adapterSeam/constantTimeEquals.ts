/**
 * Constant-time equality of two strings of possibly-different length — the shared comparison for the
 * adapter webhook signature verifiers (`clickup/signature.ts`, `erpnext/webhookSignature.ts`). Both
 * sides are hashed to fixed 32-byte SHA-256 digests and XOR-accumulated: no length-based early exit,
 * no first-differing-byte short-circuit (mirrors `supabase/functions/_shared/constantTimeBearerEquals.ts`).
 *
 * Pure + portable (Vitest + Deno): Web Crypto `crypto.subtle` only, relative imports (the
 * Deno-importable adapterSeam convention).
 */
export async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const ua = new Uint8Array(ha);
  const ub = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < ua.length; i += 1) diff |= ua[i] ^ ub[i];
  return diff === 0;
}
