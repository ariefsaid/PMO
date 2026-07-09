/**
 * Constant-time bearer equality — the sole auth gate for the pg_cron-invoked functions
 * (agent-dispatch, telegram-notify), which run `verify_jwt = false`. Hashes both sides to fixed
 * 32-byte SHA-256 digests and XOR-accumulates: no length-based early exit, no first-differing-byte
 * short-circuit (security-audit L1). One audited implementation shared by both dispatchers.
 */
export async function constantTimeBearerEquals(presented: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(presented)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const ua = new Uint8Array(a);
  const ub = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}
