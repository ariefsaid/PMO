import { formatCurrencyDecimal4, formatDecimalString, formatExactMoney } from '@/src/lib/format';

/** Exact decimal-string formatting: `Intl.NumberFormat` accepts a numeric string and keeps all digits (NFR-STK-007). */
export function formatQuantity(value: string, locale: string): string {
  return formatDecimalString(value, locale, 3);
}

/** Money for a stock value or average cost (up to 4 decimals for a cost); '' when the server omitted it (rank < 20). */
export function formatStockValue(value: string | null | undefined, currency: string, locale: string): string {
  if (value == null) return '';
  const exact = formatExactMoney(value.replace(/^(-?\d+\.\d{2})0+$/, '$1'), currency, locale);   // '5000.0000' -> the 2-decimal path
  if (exact !== null) return exact;
  // A true 4-decimal cost: same currency style, more digits (a string input keeps them exact).
  return formatCurrencyDecimal4(value, currency, locale);
}

export const isWholeQuantity = (value: string): boolean => /^-?\d+(\.0+)?$/.test(value);

/** A user-typed quantity in a decimal-comma locale becomes the dot form the RPC takes. */
export const normalizeDecimal = (raw: string): string => raw.trim().replace(',', '.');
export const isPositiveDecimal = (v: string): boolean => /^\d+(\.\d{1,3})?$/.test(v) && /[1-9]/.test(v);

const scaled = (v: string, places = 3): bigint => { const [i, f = ''] = v.trim().split('.'); const neg = i.startsWith('-'); const n = BigInt(i.replace('-', '') + f.padEnd(places, '0').slice(0, places)); return neg ? -n : n; };

/** a - b on decimal strings at the 3-decimal storage scale, via scaled BigInt (NFR-STK-007); trailing zeros dropped. */
export function subtractDecimal(a: string, b: string): string {
  const d = scaled(a) - scaled(b);
  const abs = (d < 0n ? -d : d).toString().padStart(4, '0');
  const frac = abs.slice(-3).replace(/0+$/, '');
  return `${d < 0n ? '-' : ''}${abs.slice(0, -3)}${frac ? `.${frac}` : ''}`;
}

/** n / d rounded half away from zero, as Postgres `round` does. */
const divRound = (n: bigint, d: bigint): bigint => { const neg = (n < 0n) !== (d < 0n); const [an, ad] = [n < 0n ? -n : n, d < 0n ? -d : d]; const q = (2n * an + ad) / (2n * ad); return neg ? -q : q; };

/** What a line will post, to the cent, the way the server values it (0416): a stated unit cost, else the moving average. */
export function stockValuePreview(qty: string, basis: { unitCost: string } | { valueOnHand: string; qtyOnHand: string }): string | undefined {
  let cents: bigint;
  if ('unitCost' in basis) cents = divRound(scaled(qty) * scaled(basis.unitCost, 4), 100_000n);   // milli x 1e-4 -> cents
  else {
    const q = scaled(basis.qtyOnHand);
    if (q <= 0n) return undefined;
    cents = divRound(scaled(qty) * scaled(basis.valueOnHand, 2), q);
  }
  const abs = (cents < 0n ? -cents : cents).toString().padStart(3, '0');
  return `${cents < 0n ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ym = (y: number, m0: number) => `${y}-${pad(m0 + 1)}`;

/** The org's current month and the three before it, as `YYYY-MM` (the native month input's value). `orgDay` is the
 *  org-timezone today: stock dates are org dates (D9), so the browser's own date could pick the wrong month. */
export function defaultMonthRange(orgDay: string): { fromMonth: string; toMonth: string } {
  const [y, m] = orgDay.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1 - 3, 1));
  return { fromMonth: ym(from.getUTCFullYear(), from.getUTCMonth()), toMonth: ym(y, m - 1) };
}
/** Whole months: first day of `fromMonth` .. last day of `toMonth`. */
export function monthRangeDates(fromMonth: string, toMonth: string): { from: string; to: string } {
  const [y, m] = toMonth.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${fromMonth}-01`, to: `${toMonth}-${pad(last)}` };
}
