import { parseISO, formatDistanceToNow } from 'date-fns';

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

// Single source of truth for human date display (CW-7 coherence sweep). Routing ALL date cells
// through this kills the "ISO next to human-formatted" drift the audit flagged. `en-US`, "Jun 14,
// 2026" — matches the prototype's prior `toLocaleDateString` look while staying deterministic.
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

/**
 * Format an ISO date string for display. Accepts ONLY ISO input: a date-only `YYYY-MM-DD`
 * (parsed at LOCAL midnight, so the calendar day never drifts across timezones) or a full ISO
 * timestamp with an offset/`Z` (parsed to that instant). Non-string / blank / non-ISO /
 * invalid-calendar-date input → an em-dash `—` (never a raw ISO string, "Invalid Date", or a
 * throw). Does NOT leniently parse non-ISO formats — `parseISO` is the single parser.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  // Belt-and-suspenders: the TS signature is `string | null | undefined`, but guard so a
  // non-string can never reach `parseISO` (which throws TypeError on non-string input) — keeps
  // the "never throws" guarantee true even for untyped/loose callers.
  if (typeof iso !== 'string') return '—';
  // date-fns `parseISO` reproduces the prior LOCAL-midnight semantics exactly: a date-only ISO
  // ('YYYY-MM-DD', no offset) parses as LOCAL midnight (so "2026-06-14" never renders as the 13th
  // in a behind-UTC zone), and a full timestamp with an offset/Z parses to the same instant as the
  // prior `new Date(iso)`. Unparseable input → Invalid Date → em-dash (no throw).
  const parsed = parseISO(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return dateFormatter.format(parsed);
}

/**
 * Human relative timestamp ("5 minutes ago") for the notifications inbox (FR-AAN-035).
 * Non-string / blank / unparseable input → an em-dash `—` (never a raw ISO string or
 * "Invalid Date" — same never-throws contract as `formatDate`).
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso || typeof iso !== 'string') return '—';
  const parsed = parseISO(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return formatDistanceToNow(parsed, { addSuffix: true });
}

/** Compact currency: $1.5M / $200.0K / $500 — for space-constrained surfaces.
 *  AC-W2-9-01: compact on magnitude (Math.abs) then re-apply sign so negatives
 *  compact too: -$2.5M not -$2,500,000.
 *  C4 boundary fix: values that would display as "$1000.0K" are rolled to "$1.0M"
 *  so the M tier begins at values that round to ≥ 1000 at 1-decimal-place K display. */
export function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) {
    const kDisplay = (abs / 1_000).toFixed(1);
    // If the K display would roll to "1000.0" or beyond, use the M tier instead
    if (parseFloat(kDisplay) >= 1_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
    return `${sign}$${kDisplay}K`;
  }
  return formatCurrency(value);
}

// ── #477 locale-drift sweep: named formatters for every display shape the app renders ──────
// Each export reproduces byte-identically what previously lived as a hardcoded/implicit-locale
// call at a call site. The locale seam (#468) will make these org/user-aware in ONE file.

// Money — cents-exact ERP amounts (numeric(14,2)): "$1,234.50".
const currencyCentsFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export function formatCurrencyCents(value: number): string {
  return currencyCentsFormatter.format(value);
}

// Money — default-fraction values (KPI tiles): "$1,234" / "$1,234.5" / "$1,234.56" (0–3 dp, no padding).
const numberDefaultFormatter = new Intl.NumberFormat('en-US');
export function formatCurrencyAuto(value: number): string {
  return `$${numberDefaultFormatter.format(value)}`;
}

// Money — fine-grained agent/provider costs (sub-$1): "$0.0123" (2–4 dp).
// Was duplicated verbatim in AdministrationUsage + AgentCostMetrics.
const currencyFineFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
export function formatCurrencyFine(value: number): string {
  return currencyFineFormatter.format(value);
}

// Plain grouped number (counts, tokens): "1,234,567". Replaces bare n.toLocaleString().
export function formatNumber(value: number): string {
  return numberDefaultFormatter.format(value);
}

// Number with at most 2 fraction digits (credits balance): "1,234.57".
const numberMax2Formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export function formatNumberMax2(value: number): string {
  return numberMax2Formatter.format(value);
}

// ── Date display variants (all Date-in; construction stays at call sites) ──────────────────

/** "Jun 14" — short month + day. */
const monthDayFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
export function formatMonthDay(d: Date): string {
  return monthDayFormatter.format(d);
}

/** "Sun" — short weekday (timesheet grid columns). */
const weekdayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
export function formatWeekday(d: Date): string {
  return weekdayFormatter.format(d);
}

/** "Jun 14, 2026" — Date-input twin of formatDate(iso) (same parts, local zone; shares its formatter). */
export function formatFullDate(d: Date): string {
  return dateFormatter.format(d);
}

/** "Jun 14, 2026, 03:45 PM" — last-sync style (hour '2-digit' is zero-padded). */
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
export function formatDateTime(d: Date): string {
  return dateTimeFormatter.format(d);
}

/** "6/14/2026" — numeric M/D/YYYY; byte-identical to bare toLocaleDateString() in en-US. */
const dateNumericFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'numeric',
  day: 'numeric',
  year: 'numeric',
});
export function formatDateNumeric(d: Date): string {
  return dateNumericFormatter.format(d);
}

/** "June 2026" — long month + year (calendar header). */
const monthYearFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
export function formatMonthYear(d: Date): string {
  return monthYearFormatter.format(d);
}

/** "Sun, Jun 14" — calendar agenda day heading. */
const weekdayMonthDayFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
export function formatWeekdayMonthDay(d: Date): string {
  return weekdayMonthDayFormatter.format(d);
}

/** UTC "Jun 14, 2026" — zone-stable business dates (a 23:00Z instant must not drift a day). */
const utcDateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
export function formatDateUtc(d: Date): string {
  return utcDateFormatter.format(d);
}

/** en-GB "14 Jun" — milestone target chips. */
const dayMonthFormatter = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });
export function formatDayMonth(d: Date): string {
  return dayMonthFormatter.format(d);
}

/** UTC "Jun 26" — monthly chart axis ticks. */
const utcMonthYearFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
export function formatUtcMonthYear(d: Date): string {
  return utcMonthYearFormatter.format(d);
}

/** UTC "15 Mar '25" — S-curve axis: en-GB day-month + quoted 2-digit year (AC-SC-AXIS-004/005).
 *  formatToParts + manual join so the apostrophe is explicit; stays Intl (not date-fns format)
 *  because date-fns is LOCAL-tz and would drift the day in behind-UTC zones. */
const utcDayMonthYearFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
export function formatUtcDayMonthYear(d: Date): string {
  const parts = utcDayMonthYearFormatter.formatToParts(d);
  const find = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${find('day')} ${find('month')} '${find('year')}`;
}
