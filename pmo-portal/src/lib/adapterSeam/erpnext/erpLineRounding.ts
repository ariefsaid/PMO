/**
 * #1820 — progress-claim invoice lines keep the SIGNED amount. ERPNext recomputes `amount` from qty × rate at the
 * site's own precision (qty at System Settings float precision, amount at currency precision), so a line whose
 * recomputed amount differs from the signed one is sent as 1 × the signed amount, the original arithmetic in the
 * description (same shape as the time-and-materials fix, #1801). Decimals are exact (BigInt), never float.
 * Also holds the Currency Precision rule shared with purchase capture (#2323), and the refusal when that precision is unknown.
 */
import { AdapterError } from '../contract.ts';
import { getDoc, type ErpClientDeps } from './client.ts';
import { STATEMENT_FORMAT_PRECISION } from './statementMetadata.ts';
import { formatTimeMaterialsDescription } from './dispatchRevenueFormatting.ts';

export interface ErpPrecision { float: number; currency: number }

/** Why the Currency Precision rule gives no scale; the strings are capture's refusal codes (shared, so they keep the 'source_' prefix). Capture adds its own 'source_precision_exceeds_mirror' on top. */
export type CurrencyPrecisionRefusal = 'source_precision_unknown' | 'source_settings_unreadable' | 'source_precision_per_currency';
export type CurrencyPrecision = { ok: true; scale: number } | { ok: false; reason: CurrencyPrecisionRefusal };

export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A System Settings Check field: true / false, or null when the value is absent or not a check value. */
function checkValue(value: unknown): boolean | null {
  if (value === 1 || value === '1' || value === true) return true;
  if (value === 0 || value === '0' || value === false) return false;
  return null;
}

/**
 * The shared rule: the decimals ERPNext gives a Currency field, from System Settings, the way Frappe's get_field_precision
 * decides it on the binding's major version (the revenue reader and the purchase-capture reader both call it):
 * - an explicit positive Currency Precision wins on both;
 * - an explicit 0 is a real scale on version 16 and later (get_currency_precision returns None only for None or ''), and
 *   behaves as blank on version 15;
 * - blank on version 16 and later with "use number format from currency" on takes each document currency's own format:
 *   source_precision_per_currency, for the caller to resolve or refuse;
 * - otherwise blank takes the System Settings number format's decimals; a format PMO does not know is unknown.
 * A major that is not known is source_settings_unreadable. Nothing defaults here: each caller picks its own default or refusal.
 */
export function currencyPrecisionFromSettings(settings: Record<string, unknown>, versionMajor: number | null | undefined): CurrencyPrecision {
  if (typeof versionMajor !== 'number' || !Number.isInteger(versionMajor) || versionMajor < 15) return { ok: false, reason: 'source_settings_unreadable' };
  const v16 = versionMajor >= 16;
  const raw = settings.currency_precision;
  let explicit: number | null = null;
  if (raw !== undefined && raw !== null && raw !== '') {
    if (!((typeof raw === 'number' || typeof raw === 'string') && /^\d+$/.test(String(raw)) && Number.isSafeInteger(Number(raw)))) {
      return { ok: false, reason: 'source_precision_unknown' };
    }
    explicit = Number(raw);
  }
  if (explicit !== null && (explicit > 0 || v16)) return { ok: true, scale: explicit };
  if (v16) {
    const perCurrency = checkValue(settings.use_number_format_from_currency);
    if (perCurrency === null) return { ok: false, reason: 'source_precision_unknown' };
    if (perCurrency) return { ok: false, reason: 'source_precision_per_currency' };
  }
  const scale = numberFormatPrecision(settings.number_format);
  return scale === null ? { ok: false, reason: 'source_precision_unknown' } : { ok: true, scale };
}

/**
 * System Settings precision for the progress-claim reader, on the binding's stored ERP major. Null means unknown (System
 * Settings or the Currency unreadable, or a major that is not known); `reshapeProgressLines` then sends only whole-number
 * lines and refuses a line that needs decimals. This reader's own choices over the shared rule: a number format
 * PMO does not know takes 2 decimals, and "use number format from currency" resolves to the claim currency's own format
 * (Frappe get_precision_from_currency_format: the Currency's number_format when set, else System Settings'), unreadable → null.
 */
export async function readErpPrecision(client: ErpClientDeps, versionMajor: number | null | undefined, currency?: string): Promise<ErpPrecision | null> {
  try {
    const doc = await getDoc(client, 'System Settings', 'System Settings');
    if (!isRecord(doc)) return null;
    const settings = doc;
    // Frappe (model/meta.py get_field_precision) reads cint(...) so '0' and blank both mean unset: float falls back to 3.
    const float = Number(settings.float_precision) || 3;
    const rule = currencyPrecisionFromSettings(settings, versionMajor);
    let currencyScale: number;
    if (rule.ok) {
      currencyScale = rule.scale;
    } else if (rule.reason === 'source_precision_unknown') {
      // The number format decides when the switch field is absent or malformed (as before #2323); a format PMO does not know takes 2.
      currencyScale = numberFormatPrecision(settings.number_format) ?? 2;
    } else if (rule.reason === 'source_precision_per_currency' && currency) {
      const own = (await getDoc(client, 'Currency', currency)) as Record<string, unknown> | null;
      currencyScale = numberFormatPrecision(own?.number_format) ?? numberFormatPrecision(settings.number_format) ?? 2;
    } else {
      return null;
    }
    return Number.isInteger(float) && Number.isInteger(currencyScale) && float >= 0 && currencyScale >= 0 ? { float, currency: currencyScale } : null;
  } catch {
    return null;
  }
}

/**
 * The decimals Frappe gives a Currency field when System Settings Currency Precision is blank (or 0 on version 15; on
 * version 16 and later 0 is a real setting): the System Settings number format's (frappe/model/meta.py
 * get_field_precision → frappe/utils/data.py get_number_format_info). Null when the format is not one the shared
 * table knows; each caller decides what an unknown format means.
 */
export function numberFormatPrecision(numberFormat: unknown): number | null {
  return typeof numberFormat === 'string' && Object.prototype.hasOwnProperty.call(STATEMENT_FORMAT_PRECISION, numberFormat)
    ? STATEMENT_FORMAT_PRECISION[numberFormat] : null;
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

/** What the user reads when a claim line needs decimals and the ERP's decimals cannot be read (English, then Indonesian: the adapter has no user locale). */
const PRECISION_UNKNOWN_REFUSAL =
  "A claim line has decimals, but PMO cannot read how many decimals the ERP keeps, so nothing was sent. The ERP connection's user needs read access to the ERP's System Settings. Give it that access, then raise the invoice again. / "
  + 'Ada baris klaim dengan desimal, tetapi PMO tidak dapat membaca jumlah desimal yang disimpan ERP, jadi tidak ada yang dikirim. Pengguna koneksi ERP perlu akses baca ke System Settings ERP. Berikan akses itu, lalu buat invoice lagi.';

function booksSignedAmount(quantity: string | number, rate: string | number, amount: string | number, p: ErpPrecision | null): boolean {
  const q = parse(quantity); const r = parse(rate); const a = parse(amount);
  if (!q || !r || !a) return false;
  if (p === null) {
    // Unknown precision (#2323): a signed amount with decimals may be rounded away by the site, so fail closed.
    if (a.s > 0) throw new AdapterError('commit-rejected', PRECISION_UNKNOWN_REFUSAL);
    // Only a whole rate times a qty of at most 2 decimals (the lowest float precision) that is exactly a
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
