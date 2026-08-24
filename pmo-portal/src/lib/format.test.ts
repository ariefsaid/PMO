import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  PLATFORM_CURRENCY, currencySymbol, formatCompactCurrency, formatCurrency, parseMoneyInput, pct, formatDate, formatRelativeTime,
  formatCurrencyAuto, formatCurrencyCents, formatCurrencyFine, formatNumber, formatNumberMax2,
  formatDateNumeric, formatDateUtc, formatDateTime, formatDayMonth, formatFullDate, formatMonthDay,
  formatMonthYear, formatUtcDayMonthYear, formatUtcMonthYear, formatWeekday, formatWeekdayMonthDay,
} from './format';

describe('formatCurrency', () => {
  it('formats USD with no fraction digits (AC-410)', () => {
    expect(formatCurrency(5000000, 'USD')).toBe('$5,000,000');
  });
  it('rounds to whole dollars', () => {
    expect(formatCurrency(1234.56, 'USD')).toBe('$1,235');
  });
});

describe('parseMoneyInput — the single parse for validation AND persistence (Wave 3 input integrity)', () => {
  it('parses plain + comma-formatted numbers', () => {
    expect(parseMoneyInput('1500')).toBe(1500);
    expect(parseMoneyInput('4,820,000')).toBe(4820000);
    expect(parseMoneyInput(' 5 ')).toBe(5);
    expect(parseMoneyInput('0')).toBe(0);
    expect(parseMoneyInput('.5')).toBe(0.5);
    expect(parseMoneyInput('5.')).toBe(5);
    expect(parseMoneyInput('-5')).toBe(-5); // sign rule is the caller's, not the parser's
  });
  it('returns null for blank (caller decides if blank is allowed)', () => {
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('   ')).toBeNull();
  });
  it('returns null for non-numeric text — does NOT silently coerce like parseFloat', () => {
    expect(parseMoneyInput('abc')).toBeNull();
    expect(parseMoneyInput('12x')).toBeNull(); // parseFloat would yield 12
    expect(parseMoneyInput('1.2.3')).toBeNull(); // parseFloat would yield 1.2
    expect(parseMoneyInput('0x10')).toBe(16); // Number() reads hex consistently (validate==persist)
  });
  it('parses scientific notation the SAME for validate + persist (the divergence bug: strip-regex made "1e5"→15)', () => {
    expect(parseMoneyInput('1e5')).toBe(100000);
  });
});

describe('pct — nullable % formatter (added for delivery-milestones feature)', () => {
  it('null renders an em-dash', () => {
    expect(pct(null)).toBe('—');
  });
  it('rounds and appends % sign', () => {
    expect(pct(75)).toBe('75%');
    expect(pct(67.7)).toBe('68%');
    expect(pct(0)).toBe('0%');
    expect(pct(100)).toBe('100%');
  });
});

describe('formatDate — canonical human date formatter (CW-7 coherence: no raw ISO leaks)', () => {
  it('null / undefined / blank render an em-dash, never a raw value', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });
  it('formats a date-only ISO string (YYYY-MM-DD) without timezone drift', () => {
    // Parsed at local midnight so the calendar day is preserved regardless of TZ.
    expect(formatDate('2026-06-14')).toBe('Jun 14, 2026');
  });
  it('formats a full ISO timestamp to the same human date', () => {
    expect(formatDate('2026-06-14T09:30:00.000Z')).toBe('Jun 14, 2026');
  });
  it('returns the em-dash for an unparseable string rather than "Invalid Date" or raw ISO', () => {
    expect(formatDate('not-a-date')).toBe('—');
  });
});

describe('formatRelativeTime — human relative timestamps for the notifications inbox (FR-AAN-035)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats a moment seconds ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:05.000Z'));
    expect(formatRelativeTime('2026-07-03T12:00:00.000Z')).toBe('less than a minute ago');
  });

  it('formats minutes/hours/days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:30:00.000Z'));
    expect(formatRelativeTime('2026-07-03T12:00:00.000Z')).toBe('30 minutes ago');
    vi.setSystemTime(new Date('2026-07-04T12:00:00.000Z'));
    expect(formatRelativeTime('2026-07-03T12:00:00.000Z')).toBe('1 day ago');
  });

  it('null / undefined / unparseable input renders an em-dash, never "Invalid Date"', () => {
    expect(formatRelativeTime(null)).toBe('—');
    expect(formatRelativeTime(undefined)).toBe('—');
    expect(formatRelativeTime('not-a-date')).toBe('—');
  });
});

// ── #477 locale-drift sweep: byte-identical named variants for every swept call-site shape ──

describe('formatCurrencyCents — ERP money, always 2 dp (#477)', () => {
  it('pads to cents and groups: $1,234.50', () => {
    expect(formatCurrencyCents(1234.5, 'USD')).toBe('$1,234.50');
    expect(formatCurrencyCents(0, 'USD')).toBe('$0.00');
    expect(formatCurrencyCents(2500, 'USD')).toBe('$2,500.00');
  });
  it('byte-identical to the swept welded-$ min-2dp form on numeric(14,2) data', () => {
    expect(`$${(1234.5).toLocaleString('en-US', { minimumFractionDigits: 2 })}`).toBe(
      formatCurrencyCents(1234.5, 'USD'),
    );
  });
});

describe('formatCurrencyAuto — default-fraction KPI money (#477)', () => {
  it('renders 0–3 fraction digits with no padding: $1,234 / $1,234.5 / $1,234.56', () => {
    expect(formatCurrencyAuto(1234, 'USD')).toBe('$1,234');
    expect(formatCurrencyAuto(1234.5, 'USD')).toBe('$1,234.5');
    expect(formatCurrencyAuto(1234.56, 'USD')).toBe('$1,234.56');
    expect(formatCurrencyAuto(1234567.89, 'USD')).toBe('$1,234,567.89');
  });
});

describe('#477 review — money formatters agree on where a negative sign goes', () => {
  // Regression for the review finding: formatCurrencyAuto welded a `$` and rendered "$-1,234.5",
  // while its siblings used Intl currency style and rendered "-$1,234.50". Two money values on one
  // screen (RevenueByProject KPI tiles vs its table cells) disagreed. Negative money is reachable —
  // open AR goes negative on an overpayment/credit.
  it('all three put the minus BEFORE the symbol', () => {
    expect(formatCurrencyAuto(-1234.5, 'USD')).toBe('-$1,234.5');
    expect(formatCurrencyCents(-1234.5, 'USD')).toBe('-$1,234.50');
    expect(formatCurrencyFine(-0.0123, 'USD')).toBe('-$0.0123');
  });
  it('formatCurrencyAuto stays byte-identical to the welded form for POSITIVES', () => {
    for (const v of [0, 1234, 1234.5, 1234.56, 1234.567, 1234567.89]) {
      expect(formatCurrencyAuto(v, 'USD')).toBe(`$${v.toLocaleString('en-US')}`);
    }
  });
});

describe('formatCurrencyFine — sub-$1 agent/provider costs (#477)', () => {
  it('keeps 2–4 fraction digits: $0.50 / $0.0123 / $12.3456', () => {
    expect(formatCurrencyFine(0.5, 'USD')).toBe('$0.50');
    expect(formatCurrencyFine(0.0123, 'USD')).toBe('$0.0123');
    expect(formatCurrencyFine(12.3456, 'USD')).toBe('$12.3456');
  });
});

describe('formatNumber — plain grouped counts (#477)', () => {
  it('groups thousands like bare toLocaleString in en-US', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(42)).toBe('42');
  });
});

describe('formatNumberMax2 — credits balance (#477)', () => {
  it('shows at most 2 fraction digits: 1,234 / 1,234.5 / 1,234.57', () => {
    expect(formatNumberMax2(1234)).toBe('1,234');
    expect(formatNumberMax2(1234.5)).toBe('1,234.5');
    expect(formatNumberMax2(1234.567)).toBe('1,234.57');
  });
});

describe('#477 date variants — all deterministic, TZ-stable (local or UTC-pinned construction)', () => {
  it('formatMonthDay: "Jun 14" / "Jul 4" (no padding)', () => {
    expect(formatMonthDay(new Date(2026, 5, 14))).toBe('Jun 14');
    expect(formatMonthDay(new Date(2026, 6, 4))).toBe('Jul 4');
  });
  it('formatWeekday: "Sun" (2026-06-14 is a Sunday)', () => {
    expect(formatWeekday(new Date(2026, 5, 14))).toBe('Sun');
  });
  it('formatFullDate: "Jun 14, 2026" — same parts as formatDate(iso)', () => {
    expect(formatFullDate(new Date(2026, 5, 14))).toBe('Jun 14, 2026');
  });
  it('formatDateTime: "Jun 14, 2026, 03:45 PM" / midnight "12:00 AM" (hour is 2-digit)', () => {
    expect(formatDateTime(new Date(2026, 5, 14, 15, 45))).toBe('Jun 14, 2026, 03:45 PM');
    expect(formatDateTime(new Date(2026, 5, 14, 0, 0))).toBe('Jun 14, 2026, 12:00 AM');
  });
  it('formatDateNumeric: "6/14/2026" / "7/4/2026" — byte-identical to bare toLocaleDateString in en-US', () => {
    expect(formatDateNumeric(new Date(2026, 5, 14))).toBe('6/14/2026');
    expect(formatDateNumeric(new Date(2026, 6, 4))).toBe('7/4/2026');
  });
  it('formatMonthYear: "June 2026"', () => {
    expect(formatMonthYear(new Date(2026, 5, 1))).toBe('June 2026');
  });
  it('formatWeekdayMonthDay: "Sun, Jun 14"', () => {
    expect(formatWeekdayMonthDay(new Date(2026, 5, 14))).toBe('Sun, Jun 14');
  });
  it('formatDateUtc: zone-stable — a 23:00Z instant is Jun 14 in UTC even where local says Jun 15', () => {
    expect(formatDateUtc(new Date(Date.UTC(2026, 5, 14, 23, 0)))).toBe('Jun 14, 2026');
  });
  it('formatDayMonth: en-GB "14 Jun"', () => {
    expect(formatDayMonth(new Date(2026, 5, 14))).toBe('14 Jun');
  });
  it('formatUtcMonthYear: "Jun 26"', () => {
    expect(formatUtcMonthYear(new Date(Date.UTC(2026, 5, 14)))).toBe('Jun 26');
  });
  it("formatUtcDayMonthYear: \"15 Mar '25\" / \"31 Dec '26\" (quoted 2-digit year, UTC-stable)", () => {
    expect(formatUtcDayMonthYear(new Date(Date.UTC(2025, 2, 15)))).toBe("15 Mar '25");
    expect(formatUtcDayMonthYear(new Date(Date.UTC(2026, 11, 31)))).toBe("31 Dec '26");
  });
});

// ── FR-L10N-020..023: currency-aware money formatters (currency seam consumer) ────────────

describe('FR-L10N-020..023: currency-aware money formatters', () => {
  it('AC-L10N-020: formatCurrency keys the symbol off the record currency — IDR renders "IDR\u00A01,234"', () => {
    // Intl en-US separates a code-symbol currency from the amount with U+00A0 (NBSP), not a plain space.
    expect(formatCurrency(1234, 'IDR')).toBe('IDR\u00A01,234');
  });
  it('AC-L10N-020: USD output is byte-identical to the pre-seam renderer', () => {
    expect(formatCurrency(5000000, 'USD')).toBe('$5,000,000');
    expect(formatCurrency(1234.56, 'USD')).toBe('$1,235');
  });
  it('AC-L10N-020: formatCurrencyCents/Auto/Fine take the record currency', () => {
    expect(formatCurrencyCents(1234.5, 'EUR')).toBe('€1,234.50');
    expect(formatCurrencyAuto(1234.5, 'EUR')).toBe('€1,234.5');
    expect(formatCurrencyFine(0.0123, 'IDR')).toBe('IDR\u00A00.0123');
  });
  it('AC-L10N-022: formatCompactCurrency has no welded $ or K/M — currency + Intl compact unit', () => {
    expect(formatCompactCurrency(2500000, 'IDR')).toBe('IDR\u00A02.5M'); // en-US locale ⇒ "M" tier; the $ is gone and the symbol follows the record
    expect(formatCompactCurrency(1500, 'EUR')).toBe('€1.5K');
  });
  it('AC-L10N-021 (format layer): PLATFORM_CURRENCY is exported and is USD', () => {
    expect(PLATFORM_CURRENCY).toBe('USD');
  });
  it("FR-L10N-020 (input adornment): currencySymbol returns the currency's display glyph", () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('EUR')).toBe('€');
    expect(currencySymbol('IDR')).toBe('IDR'); // no native symbol — the code is the honest glyph
  });
});
