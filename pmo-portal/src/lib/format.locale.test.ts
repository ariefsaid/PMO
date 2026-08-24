import { describe, it, expect, afterEach } from 'vitest';
import { setActiveLocale, resetActiveLocale, canonicalizeLocale } from '@/src/lib/locale/activeLocale';
import {
  formatCurrency,
  formatCompactCurrency,
  formatNumber,
  formatDate,
  formatDateNumeric,
  formatDateUtc,
  formatDayMonth,
  formatUtcDayMonthYear,
  formatRelativeTime,
  currencySymbol,
  parseMoneyInput,
} from './format';

/** Intl inserts NBSP/narrow-NBSP between symbol and digits in several locales; assertions are
 *  about SEPARATORS and GLYPHS, not about which flavour of space Node's ICU chose. */
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

const EN = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

afterEach(() => resetActiveLocale());

describe('format.ts reads the resolved locale (FR-L10N-010/011)', () => {
  it('canonicalises a bare language tag once, in the holder', () => {
    // resolveLocale yields 'en'/'id'; Intl.DateTimeFormat('en') and ('en-US') do not agree on every
    // option bag, so the widening happens in one place rather than at 15 formatter sites.
    expect(canonicalizeLocale('en')).toBe('en-US');
    expect(canonicalizeLocale('id')).toBe('id-ID');
    expect(canonicalizeLocale('en-GB')).toBe('en-GB'); // already regioned — passes through
  });

  it('AC-L10N-020: grouping follows the NUMBER locale while the symbol follows the record currency', () => {
    setActiveLocale(EN);
    expect(norm(formatCurrency(1_234_567, 'USD'))).toBe('$1,234,567');
    setActiveLocale(ID);
    expect(norm(formatCurrency(1_234_567, 'IDR'))).toBe('Rp 1.234.567');
  });

  it('FR-L10N-021: an id-ID viewer reading a USD record gets id grouping AND the USD symbol', () => {
    // The two inputs are independent: locale is the viewer's, currency is the record's. A design
    // that derived one from the other would re-denominate a USD invoice into rupiah on a language
    // switch — the exact failure the currency seam exists to prevent.
    setActiveLocale(ID);
    expect(norm(formatCurrency(1_234_567, 'USD'))).toBe('US$1.234.567');
  });

  it('FR-L10N-011: the number locale is independent of the UI language', () => {
    // English UI, Indonesian digits — a legitimate combination the profile can express, and the
    // reason getNumberLocale() and getDateLocale() are two functions rather than one.
    setActiveLocale({ locale: 'en', numberLocale: 'id-ID', timezone: 'UTC' });
    expect(formatNumber(1_234_567)).toBe('1.234.567');
    expect(formatDate('2026-06-14')).toBe('Jun 14, 2026'); // date follows the UI language
  });

  it('FR-L10N-022: compact currency takes its tier unit from the locale, not a hand-coded K/M', () => {
    setActiveLocale(EN);
    expect(norm(formatCompactCurrency(1_500_000, 'USD'))).toBe('$1.5M');
    setActiveLocale(ID);
    expect(norm(formatCompactCurrency(1_500_000, 'IDR'))).toBe('Rp 1,5 jt');
  });

  it('dates follow the resolved locale', () => {
    setActiveLocale(ID);
    expect(formatDate('2026-06-14')).toBe('14 Jun 2026');
    expect(formatDateNumeric(new Date(2026, 5, 14))).toBe('14/6/2026');
  });

  it('currencySymbol is locale-sensitive: IDR shows the code in en, the glyph in id', () => {
    setActiveLocale(EN);
    expect(currencySymbol('IDR')).toBe('IDR');
    setActiveLocale(ID);
    expect(currencySymbol('IDR')).toBe('Rp');
  });

  it('FR-L10N-012: formatRelativeTime stops rendering English prose under an Indonesian UI', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    setActiveLocale(EN);
    expect(formatRelativeTime(oneHourAgo)).toMatch(/ago$/);
    setActiveLocale(ID);
    // date-fns 'id': "sekitar 1 jam yang lalu". Asserting the absence of 'ago' is the oracle that
    // actually binds — this function typechecks and passes every pre-existing test while shipping
    // English into an Indonesian notifications inbox.
    const idOutput = formatRelativeTime(oneHourAgo);
    expect(idOutput).not.toMatch(/ago/);
    expect(idOutput).toMatch(/lalu/);
  });
});

describe('the cache key carries the locale (the poisoning guard)', () => {
  it('⛔ MUTATION ORACLE: rendering en first must not poison the later id render', () => {
    // Drop `locale` from the cache key in format.ts's numberFormatterFor/dateFormatterFor and this
    // is the ONLY assertion that goes red: the first locale rendered for a given shape+currency is
    // reused forever, so a language switch silently keeps producing en-US output. No test that
    // renders a single locale per file can observe it, which is why the order below matters.
    setActiveLocale(EN);
    expect(norm(formatCurrency(1_000_000, 'IDR'))).toBe('IDR 1,000,000');
    expect(formatDate('2026-06-14')).toBe('Jun 14, 2026');

    setActiveLocale(ID);
    expect(norm(formatCurrency(1_000_000, 'IDR'))).toBe('Rp 1.000.000');
    expect(formatDate('2026-06-14')).toBe('14 Jun 2026');

    // …and back again, so a cache that merely returns the LAST locale also fails.
    setActiveLocale(EN);
    expect(norm(formatCurrency(1_000_000, 'IDR'))).toBe('IDR 1,000,000');
    expect(formatDate('2026-06-14')).toBe('Jun 14, 2026');
  });
});

describe('what the locale must NOT reach', () => {
  it('⛔ the resolved timezone never reaches the date formatters', () => {
    // formatDate has no timeZone option on purpose: a date-only ISO parses at LOCAL midnight, and
    // formatting it locally is what stops "2026-06-14" rendering as the 13th. Threading the
    // profile timezone in (Asia/Jakarta, +7) would shift the calendar day for every date-only
    // value. Same output under both timezones is the proof.
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
    const jakarta = formatDate('2026-06-14');
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Pacific/Honolulu' });
    expect(formatDate('2026-06-14')).toBe(jakarta);
    expect(jakarta).toBe('Jun 14, 2026');
  });

  it('⛔ the UTC pin survives a locale switch (a 23:00Z instant must not drift a day)', () => {
    const lateUtc = new Date(Date.UTC(2026, 5, 14, 23, 30));
    setActiveLocale(EN);
    expect(formatDateUtc(lateUtc)).toBe('Jun 14, 2026');
    setActiveLocale(ID);
    expect(formatDateUtc(lateUtc)).toBe('14 Jun 2026'); // locale swapped, day did not
  });

  it('the two day-month formatters stay pinned: en-GB is a SHAPE here, not a locale', () => {
    // Deliberate. Under en-US these options render "Jun 14" / "Mar 15 '25" and the milestone chip
    // and S-curve axis change shape for English readers — a regression, not localisation
    // (AC-SC-AXIS-004/005). Whether they should follow the viewer is an unmade design decision.
    for (const l of [EN, ID]) {
      setActiveLocale(l);
      expect(formatDayMonth(new Date(2026, 5, 14))).toBe('14 Jun');
      expect(formatUtcDayMonthYear(new Date(Date.UTC(2025, 2, 15)))).toBe("15 Mar '25");
    }
  });

  it('⛔ parseMoneyInput is untouched by the locale (DD-I18N-3 binds it to the mask commit)', () => {
    // Display went locale-aware in this change; the PARSE deliberately did not. Leaving it
    // comma-only for one issue is a known, bounded inconsistency. Making it locale-aware HERE,
    // while the masked input still strips to [0-9.], is how "5.000.000" becomes 5.
    setActiveLocale(ID);
    expect(parseMoneyInput('1,234')).toBe(1234);
    expect(parseMoneyInput('1.234')).toBe(1.234);
    expect(parseMoneyInput('1e5')).toBe(100000);
    expect(parseMoneyInput('1.2.3')).toBeNull();
  });
});
