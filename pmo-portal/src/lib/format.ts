import { parseISO, formatDistanceToNow } from 'date-fns';
import { getActiveLocale, getDateFnsLocale, getDateLocale, getNumberLocale } from '@/src/lib/locale/activeLocale';

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
  const key = `d|${locale}|${shape}|${opts.timeZone ?? ''}`;
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
 * - applies the viewer's decimal/group separators and validates group widths; blank → `null`;
 * - strict `Number()` (so "12x" / "1.2.3" → `null`, unlike `parseFloat` which would yield 12 / 1.2);
 * - does NOT apply a min/sign rule — callers add `>= 0` (optional value) or `> 0` (required qty/rate/total).
 */
/**
 * The decimal and grouping symbols of a number locale (`id-ID` → `,` and `.`; `en-US` → `.` and
 * `,`). The one place money entry learns a convention, so the parser, the draft mask, and the
 * input's caret mapping can never disagree about which character is which.
 */
export function numberSymbols(locale = getNumberLocale()): { decimal: string; group: string | undefined } {
  const parts = numberFormatterFor('symbols', locale, undefined, {}).formatToParts(12_345.6);
  return {
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    group: parts.find((part) => part.type === 'group')?.value,
  };
}

interface ParsedMoneyDraft {
  value: number;
  normalized: string;
}

function parseMoneyDraft(raw: string, locale: string): ParsedMoneyDraft | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // Keep Number()'s existing machine-number forms: the original money parser deliberately
  // accepted exponent notation and hexadecimal. These contain no locale separators.
  if (/^0[xX][0-9a-fA-F]+$/.test(trimmed) || /^0[bB][01]+$/.test(trimmed) || /^0[oO][0-7]+$/.test(trimmed)) {
    const value = Number(trimmed);
    // Normalize to decimal so the scale check sees an integer rather than an unparseable token.
    return Number.isFinite(value) ? { value, normalized: String(value) } : null;
  }

  const { decimal, group } = numberSymbols(locale);

  const exponentMatch = trimmed.match(/([eE][+-]?\d+)$/);
  const exponent = exponentMatch?.[0] ?? '';
  const base = exponent ? trimmed.slice(0, -exponent.length) : trimmed;
  if (/[eE]/.test(base) || (exponent && !/^[eE][+-]?\d+$/.test(exponent))) return null;

  const sign = /^[+-]/.test(base) ? base[0] : '';
  const unsigned = sign ? base.slice(1) : base;
  const decimalParts = unsigned.split(decimal);
  if (decimalParts.length > 2) return null;
  const integerPart = decimalParts[0];
  const fractionPart = decimalParts.length === 2 ? decimalParts[1] : undefined;
  if (fractionPart !== undefined && !/^\d*$/.test(fractionPart)) return null;

  let integerDigits: string;
  if (group && integerPart.includes(group)) {
    const groups = integerPart.split(group);
    if (
      groups.length < 2
      || !/^\d{1,3}$/.test(groups[0])
      || groups.slice(1).some((chunk) => !/^\d{3}$/.test(chunk))
    ) return null;
    integerDigits = groups.join('');
  } else {
    if (!/^\d*$/.test(integerPart)) return null;
    integerDigits = integerPart;
  }

  if (integerDigits === '' && (fractionPart === undefined || fractionPart === '')) return null;
  const normalized = `${sign}${integerDigits || '0'}${fractionPart === undefined ? '' : `.${fractionPart}`}${exponent}`;
  const value = Number(normalized);
  return Number.isFinite(value) ? { value, normalized } : null;
}

/**
 * Parse a user-typed amount using the viewer's number convention. The form boundary passes the
 * same result through validation and persistence, so a masked draft cannot be validated as one
 * value and written as another. Blank stays null; sign/minimum rules belong to each caller.
 */
export function parseMoneyInput(raw: string, locale = getNumberLocale()): number | null {
  return parseMoneyDraft(raw, locale)?.value ?? null;
}

/**
 * Whether a normalized decimal can be represented at the requested fractional scale without
 * rounding. Trailing zeros do not consume scale (`1.2300` fits scale 2), and exponent notation is
 * interpreted exactly from its decimal digits (`1e-2` fits, `1e-3` does not).
 */
function fitsMoneyScale(normalized: string, scale: number): boolean {
  if (!Number.isInteger(scale) || scale < 0) return false;
  const match = normalized.match(/^[+-]?(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!match) return false;

  const fraction = match[2] ?? '';
  const exponent = BigInt(match[3] ?? '0');
  const coefficient = `${match[1]}${fraction}`;
  const trailingZeros = coefficient.match(/0+$/)?.[0].length ?? 0;
  const effectiveScale = BigInt(fraction.length - trailingZeros) - exponent;
  return effectiveScale <= BigInt(scale);
}

/** Parse screen input using its viewer convention and reject values that require target rounding. */
export function parseMoneyInputAtScale(
  raw: string,
  scale = 2,
  locale = getNumberLocale(),
): number | null {
  const parsed = parseMoneyDraft(raw, locale);
  if (!parsed || !fitsMoneyScale(parsed.normalized, scale)) return null;
  return parsed.value;
}

/**
 * Why a money input string at `scale` failed to parse — a genuine SEPARATOR/GROUPING mistake
 * ('format', e.g. `1,234.56` typed under `id-ID`, or a pasted `1234567.89` whose grouping doesn't
 * match either convention) versus a value that parses correctly but carries more fractional
 * digits than the target column can store ('precision', e.g. `1.234` under `en-US` for a
 * numeric(14,2) field). `null` when the raw string is valid at `scale` (no error at all).
 *
 * Both failure modes previously shared one "no more than N decimal places" message, which is
 * simply WRONG for a format mistake — a user who typed the wrong convention's separators is not
 * told which separators this screen expects (#684, AC-PLC-010/FR-PLC-010).
 */
export type MoneyInputErrorKind = 'format' | 'precision';

export function moneyInputErrorKind(
  raw: string,
  scale = 2,
  locale = getNumberLocale(),
): MoneyInputErrorKind | null {
  if (!raw.trim()) return null;
  const parsed = parseMoneyDraft(raw, locale);
  if (!parsed) return 'format';
  return fitsMoneyScale(parsed.normalized, scale) ? null : 'precision';
}

/**
 * The import convention: dot decimal with optional correctly placed ASCII comma grouping. It is
 * the `en-US` grammar by definition, pinned here so a viewer's display preference can never change
 * how a spreadsheet/CSV cell is read.
 */
const NEUTRAL_NUMBER_LOCALE = 'en-US';

function parseNeutralMoneyDraft(raw: string): ParsedMoneyDraft | null {
  return parseMoneyDraft(raw, NEUTRAL_NUMBER_LOCALE);
}

/** Locale-independent decimal parser for neutral imports. */
export function parseNeutralMoneyInput(raw: string): number | null {
  return parseNeutralMoneyDraft(raw)?.value ?? null;
}

/**
 * DD-I18N-10 — binary float noise from a spreadsheet formula cell is not user precision.
 * `=1234.5+0.06` reaches the importer as `1234.5600000000002` (the double's shortest round-trip
 * string). A value within max(ABS, REL × |value|) of a value at the target scale snaps to it.
 * ABS covers small amounts generously; REL (≈2.25 machine epsilons, i.e. 2–4.5 ULPs) covers large
 * ones, where one formula's noise already exceeds any flat bound (`=10000000.1*3` is 3.7e-9 off).
 * At the numeric(14,2) ceiling (|value| < 1e12) REL × |value| < 5e-4, well under the ~0.001 a
 * genuine third decimal sits from its nearest cent — so `1234.567` is still rejected.
 */
const IMPORT_FLOAT_NOISE_ABS = 1e-9;
const IMPORT_FLOAT_NOISE_REL = 5e-16;

function snapImportFloatNoise(value: number, scale: number): number | null {
  if (!Number.isInteger(scale) || scale < 0) return null;
  const factor = 10 ** scale;
  const snapped = Math.round(value * factor) / factor;
  const tolerance = Math.max(IMPORT_FLOAT_NOISE_ABS, Math.abs(value) * IMPORT_FLOAT_NOISE_REL);
  if (!Number.isFinite(snapped) || Math.abs(value - snapped) > tolerance) return null;
  // `+ 0` folds a negative-zero snap (a tiny negative residue) to a clean 0.
  return snapped + 0;
}

/**
 * Locale-independent import parser with a target fractional-scale guard. A value that fits the
 * scale exactly is returned as parsed; otherwise only float noise (DD-I18N-10) is accepted,
 * normalised to the scale value. On-screen entry never gets this tolerance.
 */
export function parseNeutralMoneyInputAtScale(raw: string, scale = 2): number | null {
  const parsed = parseNeutralMoneyDraft(raw);
  if (!parsed) return null;
  if (fitsMoneyScale(parsed.normalized, scale)) return parsed.value;
  return snapImportFloatNoise(parsed.value, scale);
}

/**
 * Group a valid in-progress money draft without changing its decimal digits or interpreting an
 * unfinished decimal as a completed integer. Invalid drafts stay visible for validation to report.
 */
export function formatMoneyInputDraft(raw: string, locale = getNumberLocale()): string {
  if (!raw || raw.trim() !== raw || /[eE]/.test(raw)) return raw;
  const { decimal, group } = numberSymbols(locale);
  const partialDecimal = raw === decimal || raw === `+${decimal}` || raw === `-${decimal}`;
  if (partialDecimal) return raw;

  const parsed = parseMoneyDraft(raw, locale);
  if (!parsed || /^[-+]?0[xbo]/i.test(raw)) return raw;

  const sign = /^[+-]/.test(raw) ? raw[0] : '';
  const unsigned = sign ? raw.slice(1) : raw;
  const decimalParts = unsigned.split(decimal);
  if (decimalParts.length > 2) return raw;
  const integerPart = decimalParts[0];
  const fractionPart = decimalParts.length === 2 ? decimalParts[1] : undefined;
  const integerDigits = group ? integerPart.split(group).join('') : integerPart;
  if (!/^\d*$/.test(integerDigits) || (fractionPart !== undefined && !/^\d*$/.test(fractionPart))) return raw;

  const groupedInteger = group
    ? integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, group)
    : integerDigits;
  const leadingZero = groupedInteger === '' && fractionPart !== undefined ? '0' : groupedInteger;
  return `${sign}${leadingZero}${fractionPart === undefined ? '' : `${decimal}${fractionPart}`}`;
}

/**
 * Seed an edit draft from a stored number in the viewer's convention, so re-saving an untouched
 * value reads back the same number (`1234.5` → `1.234,5` under `id-ID`). The number's shortest
 * round-trip decimal form is the source, never `Intl` fraction rounding; exponent forms (far
 * outside money magnitudes) stay machine-readable as-is.
 */
export function formatMoneyInputValue(value: number, locale = getNumberLocale()): string {
  const neutral = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(neutral)) return neutral;
  return formatMoneyInputDraft(neutral.replace('.', numberSymbols(locale).decimal), locale);
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

function parseDateOnly(iso: string | null | undefined): Date | null {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const parsed = parseISO(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseInstant(iso: string | null | undefined): Date | null {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(iso)) return null;
  const parsed = parseISO(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Calendar date stored as `YYYY-MM-DD`; personal timezone never shifts the value. */
export function formatDateOnly(iso: string | null | undefined): string {
  const parsed = parseDateOnly(iso);
  return parsed ? dateFormatter().format(parsed) : '—';
}

/** Numeric calendar date stored as `YYYY-MM-DD`; personal timezone never shifts the value. */
export function formatDateOnlyNumeric(iso: string | null | undefined): string {
  const parsed = parseDateOnly(iso);
  if (!parsed) return '—';
  return dateFormatterFor('dateOnlyNumeric', getDateLocale(), {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

/** Calendar date derived from an ISO instant, interpreted in the viewer's resolved timezone. */
export function formatInstantDate(iso: string | null | undefined): string {
  const parsed = parseInstant(iso);
  if (!parsed) return '—';
  const timezone = getActiveLocale().timezone;
  return dateFormatterFor('instantDate', getDateLocale(), { ...DATE_OPTS, timeZone: timezone }).format(parsed);
}

/**
 * Numeric display of a project's decision date (#700, #732).
 *
 * A win records the customer contract date in `contract_date` (a DATE) and copies it into
 * `decided_at` as `contract_date::timestamptz`. That copy is midnight UTC only while the database
 * session zone is UTC, so it is NOT a reliable calendar date. Both columns are written together by
 * the win RPC, and `contract_date` is only ever set by a win: when present it is the decision date
 * and is shown as a calendar day, never shifted by the viewer's timezone. Without it (a loss stamps
 * `decided_at = now()`) the decision is a real instant and follows the viewer's profile timezone.
 */
export function formatDecisionDateNumeric(decision: {
  contract_date?: string | null;
  decided_at?: string | null;
}): string {
  if (decision.contract_date) return formatDateOnlyNumeric(decision.contract_date);
  return formatInstantDateNumeric(decision.decided_at);
}

/** Numeric calendar date derived from an ISO instant in the viewer's resolved timezone. */
export function formatInstantDateNumeric(iso: string | null | undefined): string {
  const parsed = parseInstant(iso);
  if (!parsed) return '—';
  const timezone = getActiveLocale().timezone;
  return dateFormatterFor('instantDateNumeric', getDateLocale(), {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    timeZone: timezone,
  }).format(parsed);
}

// ── Wall-clock <-> instant, for `<input type="datetime-local">` (#684, FR-PLC-006, AC-PLC-005) ──
//
// ⛔ Before #684 a meeting's edit form formatted its `occurred_at` with the PROCESS/BROWSER
// timezone (`toDatetimeLocalValue(new Date(iso))`) while the header displayed it in the resolved
// PROFILE timezone above — a user whose profile zone differs from their device's OS zone saw one
// wall time in the header and a different one in the edit field, and saving an "unedited" value
// silently shifted the meeting's instant. Both directions below default to the SAME
// `getActiveLocale().timezone` the instant formatters above read, so prefill, "now", and submit
// all agree; a caller may still pass an explicit zone (tests; a future non-active-locale use).
//
// No timezone-database dependency: `Intl.DateTimeFormat` already carries the IANA tz database.
// Instant -> wall time is a direct `formatToParts` read; wall time -> instant uses the standard
// two-pass UTC-offset lookup (the same technique `date-fns-tz`/`luxon` use) so it converges
// correctly across a DST transition.

interface WallTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function readWallTimeParts(instant: Date, timeZone: string, withSeconds: boolean): WallTimeParts {
  const parts = dateFormatterFor(withSeconds ? 'wallTimeSec' : 'wallTime', 'en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' as const } : {}),
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) if (part.type !== 'literal') map[part.type] = part.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: withSeconds ? Number(map.second) : 0,
  };
}

/** The UTC offset (ms) in effect for `instant` in `timeZone`; positive when the zone is ahead of UTC. */
function wallTimeOffsetMs(instant: Date, timeZone: string): number {
  const p = readWallTimeParts(instant, timeZone, true);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

/** Format an instant as the wall-clock value a `datetime-local` input shows, in `timeZone`. */
export function instantToZonedDatetimeLocal(instant: Date, timeZone = getActiveLocale().timezone): string {
  const p = readWallTimeParts(instant, timeZone, false);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const DATETIME_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parse a `datetime-local` value as wall-clock time IN `timeZone`, returning the instant it names.
 * `null` for a malformed value. Two offset lookups converge on the correct instant either side of
 * a DST transition (the literal skipped/repeated hour is inherently ambiguous for any converter).
 */
export function zonedDatetimeLocalToInstant(value: string, timeZone = getActiveLocale().timezone): Date | null {
  const match = DATETIME_LOCAL_RE.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const guessMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? '0'));
  const firstOffset = wallTimeOffsetMs(new Date(guessMs), timeZone);
  const secondOffset = wallTimeOffsetMs(new Date(guessMs - firstOffset), timeZone);
  return new Date(guessMs - secondOffset);
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
  return currencyFormatterFor('compact', currency, { notation: 'compact', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
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

/**
 * A number with every meaningful fraction digit its shortest round-trip form carries, grouped in
 * the viewer's convention (credits balance: `737.123456` stays `737.123456`, not `737.12`).
 */
export function formatNumberExact(value: number): string {
  const fraction = /\.(\d+)$/.exec(String(value))?.[1].length ?? 0;
  return numberFormatterFor(`exact${fraction}`, getNumberLocale(), undefined, {
    maximumFractionDigits: Math.min(fraction, 20),
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
  const timezone = getActiveLocale().timezone;
  return dateFormatterFor('dateTime', getDateLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
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
