// Single source of truth for currency formatting (F-6). USD, no fraction digits —
// preserves the prototype's prior output. Multi-currency deferred (NFR-I18N-001, OD-1).
const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

/**
 * Parse a user-typed money / numeric-field string to a number, or `null` when it is not a valid
 * number. **The single parse used for BOTH validation and persistence** (Wave 3 input integrity):
 * if validation and the persisted value parse the same string differently, a value that "passes"
 * the form can still be silently saved wrong (e.g. a strip-then-parse path turning "1e5" into 15).
 * Routing both through this helper guarantees the value the user is told is valid is the value saved.
 *
 * - strips thousands separators, trims; blank → `null` (caller decides if blank is allowed);
 * - strict `Number()` (so "12x" / "1.2.3" → `null`, unlike `parseFloat` which would yield 12 / 1.2);
 * - does NOT apply a min/sign rule — callers add `>= 0` (optional value) or `> 0` (required qty/rate/total).
 */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Format a nullable % value: null → '—'; numeric → '{rounded}%'. */
export function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v)}%`;
}

/** Compact currency: $1.5M / $200.0K / $500 — for space-constrained surfaces. */
export function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return formatCurrency(value);
}
