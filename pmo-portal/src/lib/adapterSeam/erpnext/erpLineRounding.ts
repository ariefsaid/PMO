/**
 * #1820 — progress-claim invoice lines keep the SIGNED amount. ERPNext recomputes `amount` from qty × rate at the
 * site's own precision (qty at System Settings float precision, amount at currency precision), so a line whose
 * recomputed amount differs from the signed one is sent as 1 × the signed amount, the original arithmetic in the
 * description (same shape as the time-and-materials fix, #1801). Decimals are exact (BigInt), never float.
 */
import { getDoc, type ErpClientDeps } from './client.ts';
import { STATEMENT_FORMAT_PRECISION } from './statementMetadata.ts';
import { formatTimeMaterialsDescription } from './dispatchRevenueFormatting.ts';

export interface ErpPrecision { float: number; currency: number }

/** System Settings precision; null when unreadable (the caller then reshapes unless a line is trivially exact). */
export async function readErpPrecision(client: ErpClientDeps): Promise<ErpPrecision | null> {
  try {
    const doc = (await getDoc(client, 'System Settings', 'System Settings')) as Record<string, unknown> | null;
    const digits = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));
    const float = digits(doc?.float_precision) ?? 3;
    const currency = digits(doc?.currency_precision)
      ?? STATEMENT_FORMAT_PRECISION[String(doc?.number_format ?? '#,###.##')] ?? 2;
    return Number.isInteger(float) && Number.isInteger(currency) && float >= 0 && currency >= 0 ? { float, currency } : null;
  } catch {
    return null;
  }
}

interface Dec { n: bigint; s: number }
function parse(value: string | number): Dec | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!m) return null;
  const frac = (m[3] ?? '').replace(/0+$/, '');
  const n = BigInt(m[2] + frac);
  return { n: m[1] ? -n : n, s: frac.length };
}
const pow10 = (e: number) => 10n ** BigInt(e);

/** Both tie rules ERPNext may apply (half away from zero, half to even); a non-tie rounds the same in each. */
function roundTo(d: Dec, target: number): bigint[] {
  if (d.s <= target) return [d.n * pow10(target - d.s)];
  const div = pow10(d.s - target);
  const abs = d.n < 0n ? -d.n : d.n;
  const sign = d.n < 0n ? -1n : 1n;
  const q = abs / div;
  const r = abs % div;
  if (r * 2n < div) return [sign * q];
  if (r * 2n > div) return [sign * (q + 1n)];
  return [...new Set([sign * (q + 1n), sign * (q % 2n === 0n ? q : q + 1n)])];
}

function booksSignedAmount(quantity: string | number, rate: string | number, amount: string | number, p: ErpPrecision | null): boolean {
  const q = parse(quantity); const r = parse(rate); const a = parse(amount);
  if (!q || !r || !a) return false;
  if (p === null) { // ponytail: unknown precision — unchanged only if qty and rate are ≤2dp and the product is exactly the signed amount
    return q.s <= 2 && r.s <= 2 && q.n * r.n * pow10(a.s) === a.n * pow10(q.s + r.s);
  }
  if (r.s > p.currency) return false;
  const signed = roundTo(a, p.currency);
  return roundTo(q, p.float).every((rq) => {
    const prod: Dec = { n: rq * r.n, s: p.float + r.s };
    return roundTo(prod, p.currency).every((booked) => signed.length === 1 && booked === signed[0]);
  });
}

export interface ProgressLineInput {
  item: string; label: string; unit: string;
  quantity: string | number; rate: string | number; amount: string | number;
}

export function reshapeProgressLines(
  lines: readonly ProgressLineInput[],
  precision: ErpPrecision | null,
  currency: string | undefined,
): Array<Record<string, unknown>> {
  return lines.map((line) => {
    const base = { item_code: line.item };
    if (booksSignedAmount(line.quantity, line.rate, line.amount, precision)) {
      return { ...base, qty: Number(line.quantity), rate: Number(line.rate), ...(line.label ? { description: `${line.label} (${line.unit})` } : {}) };
    }
    return {
      ...base, qty: 1, rate: Number(line.amount),
      ...(line.label ? { description: formatTimeMaterialsDescription(line.label, line.unit, Number(line.quantity), Number(line.rate), line.amount, currency) } : {}),
    };
  });
}
