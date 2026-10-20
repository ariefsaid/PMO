import { formatCompactCurrency, formatExactMoney } from './format';

/** Exact dashboard money formatting (zero fraction omitted, non-zero kept); null means no coverage. */
export function formatDashboardMoney(value: number | null, currency: string, locale: string): string | null {
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

/**
 * OD-MONEY-FMT: KPI cards show the short form, the exact amount rides in metadata. A number is a
 * display amount; a string is an exact decimal (kept exact in the title, `Number` only for the
 * short form). Unknown or malformed → "—" with `unavailableReason`.
 */
export function moneyFigure(
  amount: number | string | null,
  currency: string,
  locale: string,
  unavailableReason: string,
): MoneyFigure {
  const exact = typeof amount === 'string'
    ? formatExactMoney(amount, currency, locale, { trimZeroFraction: true })
    : formatDashboardMoney(amount, currency, locale);
  const numeric = typeof amount === 'string' ? Number(amount) : amount;
  if (exact === null || numeric === null || !Number.isFinite(numeric)) {
    return { value: '—', unavailableReason };
  }
  const short = formatCompactCurrency(numeric, currency);
  // A small amount is already exact: no redundant title / sr-only twin.
  return short === exact ? { value: short } : { value: short, exactValue: exact };
}

/** Short form for running text (a tile's `vs` line); unknown reads as the supplied prose. */
export function shortMoney(amount: number | null, currency: string, unavailable: string): string {
  return amount === null || !Number.isFinite(amount) ? unavailable : formatCompactCurrency(amount, currency);
}

/** Per-currency totals as ONE figure: each currency short + exact, joined, never summed across currencies. */
export function moneyTotalsFigure(
  totals: ReadonlyArray<{ currency: string; amount: number }>,
  emptyCurrency: string,
  locale: string,
  unavailableReason: string,
): MoneyFigure {
  const rows = totals.length === 0 ? [{ currency: emptyCurrency, amount: 0 }] : totals;
  const figures = rows.map((row) => moneyFigure(row.amount, row.currency, locale, unavailableReason));
  const value = figures.map((fig) => fig.value).join(' · ');
  const exactValue = figures.map((fig) => fig.exactValue ?? fig.value).join(' · ');
  const figureUnavailableReason = figures.find((fig) => fig.unavailableReason)?.unavailableReason;
  if (figureUnavailableReason) return { value, unavailableReason: figureUnavailableReason };
  return exactValue === value ? { value } : { value, exactValue };
}
