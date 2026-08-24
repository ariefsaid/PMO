import { parseISO, formatDistanceToNow } from 'date-fns';
import { getDateFnsLocale, getDateLocale, getNumberLocale } from '@/src/lib/locale/activeLocale';

/**
 * The app's SINGLE display-formatting seam (#468/#477, FR-L10N-010/011). Every Intl formatter in
 * the app is constructed here and nowhere else — `eslint.config.js` enforces that.
 *
 * ⚑ Locale arrives OUT-OF-BAND, from `src/lib/locale/activeLocale.ts`, not as a parameter. The
 * formatter signatures below are unchanged by the locale slice on purpose: adding a `locale`
 * argument would rewrite ~460 call sites in the same diff that touches money formatting.
 * `currency` stays an argument because FR-L10N-021 makes the two independent — an id-ID user may
 * legitimately view a USD invoice, which is `('id-ID', 'USD')`, two inputs, not one.
 */

/** Platform AI billing is denominated in USD regardless of the org currency (FR-L10N-023).
 *  ⚑ This is a CURRENCY pin, NOT a locale pin — its digits still group per the viewer's number
 *  locale, so do not "stabilise" its call sites by pinning them to en-US. */
export const PLATFORM_CURRENCY = 'USD';

// ── The one formatter cache ────────────────────────────────────────────────────────────────
// ⛔ THE LOCALE IS PART OF THE KEY. Without it the FIRST locale rendered poisons every later
// render of the same shape+currency: a language switch then produces the old locale's output with
// no error and nothing thrown. `format.locale.test.ts` plants exactly that mutation.
const formatterCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function numberFormatterFor(
  shape: string,
  locale: string,
  currency: string | undefined,
  opts: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `n|${locale}|${shape}|${currency ?? ''}`;
  let formatter = formatterCache.get(key) as Intl.NumberFormat | undefined;
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, opts);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

function dateFormatterFor(
  shape: string,
  locale: string,
  opts: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `d|${locale}|${shape}`;
  let formatter = formatterCache.get(key) as Intl.DateTimeFormat | undefined;
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, opts);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** Money formatters: shape + record currency + the viewer's NUMBER locale (never the UI locale). */
function currencyFormatterFor(shape: string, currency: string, opts: Intl.NumberFormatOptions) {
  return numberFormatterFor(shape, getNumberLocale(), currency, {
    ...opts,
    style: 'currency',
    currency,
  });
}

export function formatCurrency(value: number, currency: string): string {
  return currencyFormatterFor('whole', currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
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
const DATE_OPTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};
// ⛔ No `timeZone` option, deliberately. `parseISO('2026-06-14')` yields LOCAL midnight, and
// formatting it in the LOCAL zone is what keeps a date-only ISO from rendering as the 13th. The
// resolved profile timezone must NEVER be threaded in here (see activeLocale.ts's closing note).
const dateFormatter = () => dateFormatterFor('date', getDateLocale(), DATE_OPTS);

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
  return dateFormatter().format(parsed);
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
  return formatDistanceToNow(parsed, { addSuffix: true, locale: getDateFnsLocale() });
}

/** Compact currency: "$1.5M" / "$200.0K" / "$500" — space-constrained surfaces (FR-L10N-022:
 *  no welded $, no hand-coded K/M tiers — Intl supplies the compact unit, so id-ID renders its
 *  own under the locale slice). Byte-identical to the old hand-tiered output for USD, incl. the
 *  C4 999_950→$1.0M roll and negative compaction (Intl places the sign: -$2.5M).
 *  AC-W2-9-01: compact on magnitude (Math.abs) — negatives compact too, and sub-1K values fall
 *  through to formatCurrency ("$500", not "$500.0"). */
export function formatCompactCurrency(value: number, currency: string): string {
  if (Math.abs(value) < 1_000) return formatCurrency(value, currency);
  return currencyFormatterFor('compact', currency, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/** The currency's display glyph for input adornments (FR-L10N-020 — a hardcoded `$` prefix is
 *  the same weld formatCurrency had). Codes without a native symbol (IDR) honestly show the code. */
export function currencySymbol(currency: string): string {
  const parts = currencyFormatterFor('symbol', currency, {}).formatToParts(1);
  const literal = parts.find((p) => p.type === 'currency')?.value ?? currency;
  return literal.trim() || currency;
}

// ── #477 locale-drift sweep: named formatters for every display shape the app renders ──────
// Each export reproduces byte-identically what previously lived as a hardcoded/implicit-locale
// call at a call site. The locale seam (#468) will make these org/user-aware in ONE file.

// Money — cents-exact ERP amounts (numeric(14,2)): "$1,234.50" (FR-L10N-020: record currency).
export function formatCurrencyCents(value: number, currency: string): string {
  return currencyFormatterFor('cents', currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

// Money — default-fraction values (KPI tiles): "$1,234" / "$1,234.5" / "$1,234.56" (0–3 dp, no padding).
// Uses `style: 'currency'` rather than welding a `$`, so a negative renders "-$1,234.5" exactly like
// formatCurrencyCents/Fine. The welded form put the sign INSIDE the symbol ("$-1,234.5"), which left two
// money values on one screen disagreeing about where the minus goes (#477 review). Positives are
// byte-identical to the welded form — min 0 / max 3 reproduces the plain NumberFormat default range.
export function formatCurrencyAuto(value: number, currency: string): string {
  return currencyFormatterFor('auto', currency, { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(value);
}

// Money — fine-grained agent/provider costs (sub-$1): "$0.0123" (2–4 dp, record currency).
// Was duplicated verbatim in AdministrationUsage + AgentCostMetrics.
export function formatCurrencyFine(value: number, currency: string): string {
  return currencyFormatterFor('fine', currency, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

// Plain grouped number (counts, tokens): "1,234,567". Replaces bare n.toLocaleString().
export function formatNumber(value: number): string {
  return numberFormatterFor('plain', getNumberLocale(), undefined, {}).format(value);
}

// Number with at most 2 fraction digits (credits balance): "1,234.57".
export function formatNumberMax2(value: number): string {
  return numberFormatterFor('max2', getNumberLocale(), undefined, {
    maximumFractionDigits: 2,
  }).format(value);
}

// ── Date display variants (all Date-in; construction stays at call sites) ──────────────────

/** "Jun 14" — short month + day. */
export function formatMonthDay(d: Date): string {
  return dateFormatterFor('monthDay', getDateLocale(), { month: 'short', day: 'numeric' }).format(d);
}

/** "Sun" — short weekday (timesheet grid columns). */
export function formatWeekday(d: Date): string {
  return dateFormatterFor('weekday', getDateLocale(), { weekday: 'short' }).format(d);
}

/** "Jun 14, 2026" — Date-input twin of formatDate(iso) (same parts, local zone; shares its formatter). */
export function formatFullDate(d: Date): string {
  return dateFormatter().format(d);
}

/** "Jun 14, 2026, 03:45 PM" — last-sync style (hour '2-digit' is zero-padded). */
export function formatDateTime(d: Date): string {
  return dateFormatterFor('dateTime', getDateLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** "6/14/2026" — numeric M/D/YYYY; byte-identical to bare toLocaleDateString() in en-US. */
export function formatDateNumeric(d: Date): string {
  return dateFormatterFor('dateNumeric', getDateLocale(), {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/** "June 2026" — long month + year (calendar header). */
export function formatMonthYear(d: Date): string {
  return dateFormatterFor('monthYear', getDateLocale(), {
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/** "Sun, Jun 14" — calendar agenda day heading. */
export function formatWeekdayMonthDay(d: Date): string {
  return dateFormatterFor('weekdayMonthDay', getDateLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/** UTC "Jun 14, 2026" — zone-stable business dates (a 23:00Z instant must not drift a day). */
export function formatDateUtc(d: Date): string {
  // ⛔ `timeZone: 'UTC'` is load-bearing and is NOT the resolved profile timezone: this formatter
  // exists so a 23:00Z business date does not drift a day. Swap the LOCALE, keep the UTC pin.
  return dateFormatterFor('dateUtc', getDateLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/**
 * "14 Jun" — milestone target chips.
 *
 * ⚑ DELIBERATELY still pinned to en-GB while every other formatter went locale-aware. The en-GB tag
 * here is not a locale choice, it is how this surface asks for DAY-BEFORE-MONTH: under en-US the
 * same options render "Jun 14" and the chip changes shape for English readers, which is a
 * regression, not localisation (pinned by `format.test.ts` — `formatDayMonth: en-GB "14 Jun"`).
 * Whether the chip should follow the viewer's locale is a design decision that has not been made;
 * it is not made by a locale sweep. Routed through the shared cache so there is still exactly one
 * construction site.
 */
const DAY_MONTH_SHAPE_LOCALE = 'en-GB';
export function formatDayMonth(d: Date): string {
  return dateFormatterFor('dayMonth', DAY_MONTH_SHAPE_LOCALE, {
    day: '2-digit',
    month: 'short',
  }).format(d);
}

/** UTC "Jun 26" — monthly chart axis ticks. */
export function formatUtcMonthYear(d: Date): string {
  // `timeZone: 'UTC'` load-bearing (see formatDateUtc); locale follows the viewer.
  return dateFormatterFor('utcMonthYear', getDateLocale(), {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(d);
}

/** UTC "15 Mar '25" — S-curve axis: en-GB day-month + quoted 2-digit year (AC-SC-AXIS-004/005).
 *  formatToParts + manual join so the apostrophe is explicit; stays Intl (not date-fns format)
 *  because date-fns is LOCAL-tz and would drift the day in behind-UTC zones. */
// ⚑ Pinned to en-GB for the same reason as formatDayMonth, and one more: the output is HAND-JOINED
// below with a literal space and apostrophe (:`15 Mar '25`). That punctuation is an en/GB
// typographic convention baked into this function — a locale swap does not translate it, it just
// yields a grammatically wrong string that still renders and fails nothing. AC-SC-AXIS-004/005 pin
// the shape. Localising the S-curve axis is its own change, with its own re-baselined snapshots.
export function formatUtcDayMonthYear(d: Date): string {
  const parts = dateFormatterFor('utcDayMonthYear', DAY_MONTH_SHAPE_LOCALE, {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).formatToParts(d);
  const find = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${find('day')} ${find('month')} '${find('year')}`;
}
