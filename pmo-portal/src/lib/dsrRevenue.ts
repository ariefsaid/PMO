import { formatExactCents } from './exactDecimal';

/**
 * Daily site report revenue (#1522, FR-DSR-010). Exact decimal arithmetic on bigints, never floats
 * (NFR-DSR-003). Mirrors the database's `dsr_line_amount` (1005): each line is quantity x rate, rounded
 * half-up to cents ONCE per line; the report total is the sum of the rounded lines. A line with no rate
 * shows no amount, counts as unrated and adds nothing.
 */
export type DecimalInput = number | string;

export interface DsrRevenueLineInput {
  quantity: DecimalInput;
  /** The rate in force (live for a draft, frozen once validated); null = "no rate". */
  rate: DecimalInput | null;
}

export interface DsrRevenueLine {
  amountCents: bigint | null;
  amount: string | null;
  unrated: boolean;
}

export interface DsrRevenue {
  lines: DsrRevenueLine[];
  totalCents: bigint;
  total: string;
  unratedCount: number;
}

interface Scaled {
  units: bigint;
  scale: number;
}

/** A plain non-negative decimal ("12", "0.125") to integer units at its own scale; anything else is null. */
function parseDecimal(value: DecimalInput): Scaled | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? '';
  return { units: BigInt(match[1] + fraction), scale: fraction.length };
}

/** quantity x rate in cents, rounded half-up (both inputs are non-negative). */
export function dsrLineAmountCents(quantity: DecimalInput, rate: DecimalInput): bigint | null {
  const q = parseDecimal(quantity);
  const r = parseDecimal(rate);
  if (!q || !r) return null;
  const product = q.units * r.units;
  const scale = q.scale + r.scale;
  if (scale <= 2) return product * 10n ** BigInt(2 - scale);
  const divisor = 10n ** BigInt(scale - 2);
  return (product * 2n + divisor) / (divisor * 2n);
}

export function dsrReportRevenue(lines: DsrRevenueLineInput[]): DsrRevenue {
  let totalCents = 0n;
  let unratedCount = 0;
  const out = lines.map((line): DsrRevenueLine => {
    const cents = line.rate === null ? null : dsrLineAmountCents(line.quantity, line.rate);
    if (cents === null) {
      unratedCount += 1;
      return { amountCents: null, amount: null, unrated: true };
    }
    totalCents += cents;
    return { amountCents: cents, amount: formatExactCents(cents), unrated: false };
  });
  return { lines: out, totalCents, total: formatExactCents(totalCents), unratedCount };
}
