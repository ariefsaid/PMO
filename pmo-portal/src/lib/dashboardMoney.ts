import { formatExactMoney, formatNumberWhole, formatPercent, formatShortAmount, formatShortMoney } from './format';
import { getNumberLocale } from './locale/activeLocale';

/** Whole-unit dashboard money formatting; null means no coverage. */
export function formatDashboardMoney(value: number | null, currency: string, locale: string = getNumberLocale()): string | null {
  return value === null || !Number.isFinite(value)
    ? null
    : formatExactMoney(String(value), currency, locale, { wholeUnits: true });
}

/** Margin as a share of billed revenue from the same known-margin project set. */
export function formatDashboardPercent(
  numerator: number | null,
  denominator: number | null,
  locale: string = getNumberLocale(),
): string | null {
  if (numerator === null || denominator === null || denominator <= 0
    || !Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  return formatPercent(numerator / denominator, locale);
}

/** The KPITile / StatTiles contract: visible short form, full whole-unit amount as metadata. */
export interface MoneyFigure {
  /** Short locale form; empty when unknown so the reason can take its place. */
  value: string;
  /** Full whole-unit amount for the tile's `title` and screen-reader text. */
  exactValue?: string;
  /** Why the figure is unknown; render this once as plain text, never as a dash or zero. */
  unavailableReason?: string;
}

/** `code`: name the currency by ISO code ("USD 3.4M") for a figure outside the org currency. */
export interface ShortMoneyOptions { code?: boolean }

/**
 * Owner ruling #1437: whole units on read-only surfaces; KPI cards use the short form and retain a
 * whole-unit amount with its currency in metadata. A string remains exact through rounding and a
 * number uses the same viewer number locale. Unknown or malformed values leave the figure empty
 * and carry one plain-language reason for the surrounding block.
 *
 * `labelHasCurrency` (#1437: the currency is said ONCE, in the block heading): when the tile's
 * label already names the currency ("Recognised to date · IDR"), the visible figure renders bare
 * ("1.2B") instead of repeating it; the exact `title`/screen-reader amount keeps the code.
 */
export function moneyFigure(
  amount: number | string | null,
  currency: string,
  unavailableReason: string,
  opts: ShortMoneyOptions & { labelHasCurrency?: boolean } = {},
): MoneyFigure {
  const exact = typeof amount === 'string'
    ? formatExactMoney(amount, currency, getNumberLocale(), { wholeUnits: true })
    : formatDashboardMoney(amount, currency);
  const numeric = typeof amount === 'string' ? Number(amount) : amount;
  if (exact === null || numeric === null || !Number.isFinite(numeric)) {
    return { value: '', unavailableReason };
  }
  if (opts.labelHasCurrency === true) {
    const short = Math.abs(numeric) < 1_000 ? formatNumberWhole(numeric) : formatShortAmount(numeric);
    return { value: short, exactValue: exact };
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
