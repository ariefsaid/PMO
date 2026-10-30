/** Convert a validated, signed scale-two decimal to integer minor units. */
export function parseExactCents(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const amount = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -amount : amount;
}

export function formatExactCents(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

/** Number adapter retains negative zero and the existing safe-integer limit. */
export function parseSafeCents(value: string): number | 'invalid' | 'range' {
  const units = parseExactCents(value);
  if (units === null) return 'invalid';
  const result = Number(units);
  if (!Number.isSafeInteger(result)) return 'range';
  return result === 0 && value.startsWith('-') ? -0 : result;
}

export function formatNumberCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
