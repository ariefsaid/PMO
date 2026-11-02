type Amount = number | string;
function cents(value: Amount): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  const n = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -n : n;
}
function decimal(n: bigint): string {
  const sign = n < 0n ? '-' : '';
  const abs = n < 0n ? -n : n;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
export function moneyHeader(move: { amount_total?: Amount; amount_residual?: Amount }, lines: readonly { balance?: Amount }[] | null): { gross: string; vat: string; withheld: string; outstanding: string } | null {
  if (move.amount_total == null || move.amount_residual == null || !lines) return null;
  const gross = cents(move.amount_total), outstanding = cents(move.amount_residual);
  if (gross === null || outstanding === null) return null;
  let vat = 0n, withheld = 0n;
  for (const line of lines) {
    if (line.balance == null) return null;
    const value = cents(line.balance);
    if (value === null) return null;
    if (value < 0n) withheld -= value; else vat += value;
  }
  return { gross: decimal(gross + withheld), vat: decimal(vat), withheld: decimal(withheld), outstanding: decimal(outstanding) };
}
export function compareSent(sent: Amount, observed: Amount): 'match' | 'mismatch' {
  const a = cents(sent), b = cents(observed);
  return a !== null && b !== null && a - b <= 1n && b - a <= 1n ? 'match' : 'mismatch';
}
