import { parseSafeCents, formatNumberCents } from '../exactDecimal.ts';
import { AdapterError } from '../adapterSeam/contract.ts';

/** Parse a signed decimal amount into exact integer cents; floating point is never involved. */
export function toCents(value: string): number {
  const cents = parseSafeCents(String(value).trim());
  if (cents === 'invalid') throw new AdapterError('commit-rejected', `invalid decimal budget amount: ${JSON.stringify(value)}`);
  if (cents === 'range') throw new AdapterError('commit-rejected', `budget amount out of range: ${JSON.stringify(value)}`);
  return cents;
}

export function fromCents(cents: number): string {
  return formatNumberCents(cents);
}
