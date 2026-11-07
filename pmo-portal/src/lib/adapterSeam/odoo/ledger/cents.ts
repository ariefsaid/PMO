/** Exact decimal helpers for ledger money: strings in, bigint cents out, no float (NFR-ODA-001). */
const DECIMAL = /^([+-]?)(\d+)(?:\.(\d*))?$/;

/** A decimal string or number as a nano (1e-9) bigint; null when malformed. */
export function toNano(v: unknown): bigint | null {
  const text = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : typeof v === 'string' ? v.trim() : '';
  const m = DECIMAL.exec(text);
  if (!m) return null;
  const fraction = (m[3] ?? '').padEnd(9, '0');
  if (fraction.length > 9 && /[1-9]/.test(fraction.slice(9))) return null;
  const n = BigInt(m[2] + fraction.slice(0, 9));
  return m[1] === '-' ? -n : n;
}

/** Divide with half-away-from-zero rounding. */
export function divRound(num: bigint, den: bigint): bigint {
  const abs = num < 0n ? -num : num;
  const q = (abs * 2n + den) / (2n * den);
  return num < 0n ? -q : q;
}

export const nanoToCents = (nano: bigint): bigint => divRound(nano, 10_000_000n);

export function formatCents(cents: bigint): string {
  const abs = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
