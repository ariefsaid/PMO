import { formatExactMoney, formatShortMoney } from './format';
import { getNumberLocale } from './locale/activeLocale';

/** Exact dashboard money formatting (zero fraction omitted, non-zero kept); null means no coverage. */
export function formatDashboardMoney(value: number | null, currency: string, locale: string = getNumberLocale()): string | null {
  return value === null || !Number.isFinite(value)
    ? null
    : formatExactMoney(String(value), currency, locale, { trimZeroFraction: true });
}

/** The KPITile / StatTiles figure contract: visible short form, exact amount as metadata. */
export interface MoneyFigure {
  /** Short locale form; "—" when unknown. */
  value: string;
  /** Exact amount for the tile's `title` and screen-reader text. */
  exactValue?: string;
  /** Why the figure is unknown; the figure stays "—" (never 0, never prose). */
  unavailableReason?: string;
}

/** `code`: name the currency by ISO code — for a figure outside the org currency ("USD 3.4M"). */
export interface ShortMoneyOptions { code?: boolean }

/**
 * OD-MONEY-FMT: KPI cards show the short form, the exact amount rides in metadata. A number is a
 * display amount; a string is an exact decimal (kept exact in the title, `Number` only for the
 * short form). Money follows the viewer's NUMBER locale (format.ts seam). Unknown or malformed →
 * "—" with `unavailableReason`. Below 1,000 the exact form is shown as-is (nothing to shorten).
 */
export function moneyFigure(
  amount: number | string | null,
  currency: string,
  unavailableReason: string,
  opts: ShortMoneyOptions = {},
): MoneyFigure {
  const exact = typeof amount === 'string'
    ? formatExactMoney(amount, currency, getNumberLocale(), { trimZeroFraction: true })
    : formatDashboardMoney(amount, currency);
  const numeric = typeof amount === 'string' ? Number(amount) : amount;
  if (exact === null || numeric === null || !Number.isFinite(numeric)) {
    return { value: '—', unavailableReason };
  }
  const short = Math.abs(numeric) < 1_000 ? exact : formatShortMoney(numeric, currency, opts);
  // The short form is never longer than the exact one; a figure already exact has no twin.
  return short.length >= exact.length ? { value: exact } : { value: short, exactValue: exact };
}

/** Short form for running text (a tile's `vs` line); unknown reads as the supplied prose. */
export function shortMoney(amount: number | null, currency: string, unavailable: string, opts: ShortMoneyOptions = {}): string {
  return amount === null || !Number.isFinite(amount) ? unavailable : moneyFigure(amount, currency, unavailable, opts).value;
}

/** Per-currency totals as ONE figure: each currency short + exact, joined, never summed across currencies. */
export function moneyTotalsFigure(
  totals: ReadonlyArray<{ currency: string; amount: number }>,
  emptyCurrency: string,
  unavailableReason: string,
): MoneyFigure {
  const rows = totals.length === 0 ? [{ currency: emptyCurrency, amount: 0 }] : totals;
  const figures = rows.map((row) => moneyFigure(row.amount, row.currency, unavailableReason));
  const value = figures.map((fig) => fig.value).join(' · ');
  const exactValue = figures.map((fig) => fig.exactValue ?? fig.value).join(' · ');
  const figureUnavailableReason = figures.find((fig) => fig.unavailableReason)?.unavailableReason;
  if (figureUnavailableReason) return { value, unavailableReason: figureUnavailableReason };
  return exactValue === value ? { value } : { value, exactValue };
}
