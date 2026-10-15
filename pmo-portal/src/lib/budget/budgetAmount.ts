import { AdapterError } from '../adapterSeam/contract.ts';

/** Parse a signed decimal amount into exact integer cents; floating point is never involved. */
export function toCents(value: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) throw new AdapterError('commit-rejected', `invalid decimal budget amount: ${JSON.stringify(value)}`);
  const [, sign, whole, fraction = ''] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new AdapterError('commit-rejected', `budget amount out of range: ${JSON.stringify(value)}`);
  return sign === '-' ? -cents : cents;
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
