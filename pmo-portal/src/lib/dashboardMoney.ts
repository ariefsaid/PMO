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
  return { value: formatCompactCurrency(numeric, currency), exactValue: exact };
}

/** Short form for running text (a tile's `vs` line); unknown reads as the supplied prose. */
export function shortMoney(amount: number | null, currency: string, unavailable: string): string {
  return amount === null || !Number.isFinite(amount) ? unavailable : formatCompactCurrency(amount, currency);
}
