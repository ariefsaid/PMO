/**
 * #1820 — progress-claim invoice lines keep the SIGNED amount. ERPNext recomputes `amount` from qty × rate at the
 * site's own precision (qty at System Settings float precision, amount at currency precision), so a line whose
 * recomputed amount differs from the signed one is sent as 1 × the signed amount, the original arithmetic in the
 * description (same shape as the time-and-materials fix, #1801). Decimals are exact (BigInt), never float.
 */
import { AdapterError } from '../contract.ts';
import { getDoc, type ErpClientDeps } from './client.ts';
import { STATEMENT_FORMAT_PRECISION } from './statementMetadata.ts';
import { formatTimeMaterialsDescription } from './dispatchRevenueFormatting.ts';

export interface ErpPrecision { float: number; currency: number }

/**
 * System Settings precision. System Settings is System-Manager-only, which the API user is not, so null (unknown) is the
 * normal case and every line is then judged precision-free. No other non-admin source exists: the Currency doctype's
 * number_format / fraction_units do not feed field precision (get_field_precision reads only System Settings).
 */
export async function readErpPrecision(client: ErpClientDeps): Promise<ErpPrecision | null> {
  try {
    const doc = (await getDoc(client, 'System Settings', 'System Settings')) as Record<string, unknown> | null;
    // Frappe (model/meta.py get_field_precision) reads cint(...) so '0' and blank both mean unset: float falls back to 3,
    // currency to the System Settings number format's decimals.
    const digits = (v: unknown) => Number(v) || null;
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
  if (p === null) {
    // Unknown precision: only a whole rate times a qty of at most 2 decimals (the lowest float precision) that is exactly a
    // whole signed amount books identically at any site precision.
    return r.s === 0 && a.s === 0 && q.s <= 2 && q.n * r.n === a.n * pow10(q.s);
  }
  if (a.s > p.currency) {
    throw new AdapterError('commit-rejected', `A progress claim line amount has more decimals than ERPNext holds for this currency (${p.currency}); correct the claim line before raising the invoice`);
  }
  if (r.s > p.currency) return false;
  const signed = a.n * pow10(p.currency - a.s);
  return roundTo(q, p.float).every((rq) => {
    const prod: Dec = { n: rq * r.n, s: p.float + r.s };
    return roundTo(prod, p.currency).every((booked) => booked === signed);
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
