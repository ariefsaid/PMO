import { afterEach, describe, expect, it } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import {
  formatCalendarDayInTimeZone,
  formatDate,
  formatDateOnly,
  formatDateOnlyNumeric,
  formatClockTime,
  formatDateTime,
  formatDayMonth,
  formatDecisionDateNumeric,
  formatFullDate,
  formatInstantDate,
  formatInstantDateNumeric,
  formatMonthDay,
  formatMonthShort,
  formatMonthYear,
  formatUtcDayMonthYear,
  formatUtcMonthYear,
  formatUtcMonthYearFull,
  formatWeekday,
  formatWeekdayDay,
  formatWeekdayMonthDay,
  instantToZonedDatetimeLocal,
  zonedDatetimeLocalToInstant,
} from './format';

/**
 * Output pins for EVERY Intl.DateTimeFormat shape `format.ts` builds, frozen BEFORE the
 * formatter-cache consolidation (perf slice: first-render Intl.DateTimeFormat construction,
 * docs/perf-baseline.md "Next slices (2026-11-08)" slice 2). The consolidation reuses one
 * formatter where shapes differ only trivially; these pins are the contract that NO formatted
 * output changes — en + id locales, with and without timeZone, DST/offset edge dates.
 *
 * Local-zone shapes are pinned with LOCAL-constructed `Date`s (`new Date(2026, 5, 14)`), so the
 * expected string is identical on every machine; zoned/UTC shapes are pinned with absolute
 * instants, so the expected string is fixed by the explicit zone. `formatDayMonth` /
 * `formatUtcDayMonthYear` are en-GB PINNED shapes (the en-GB tag is a shape request, not a
 * locale choice — see format.ts) and must not follow the active locale at all.
 */

const EN = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

afterEach(() => resetActiveLocale());

// 2026-06-14 is a Sunday; 12:00Z is 19:00 in Asia/Jakarta (UTC+7, no DST) and 05:00 PDT the same day.
const SUN_NOON_Z = '2026-06-14T12:00:00Z';
// US DST edges: 2026-03-08 is the spring-forward day (10:30Z = 03:30 PDT, UTC-7);
// 2026-11-01 is the fall-back day (11:30Z = 03:30 PST, UTC-8).
const LA_SPRING_FORWARD = '2026-03-08T10:30:00Z';
const LA_FALL_BACK = '2026-11-01T11:30:00Z';
// Offset edges: 17:30Z is 00:30 NEXT DAY in Jakarta; 2026-01-01T02:00Z is 2025-12-31 18:00 in LA;
// 2026-02-28T23:59Z is 2026-03-01 06:59 in Jakarta but still Feb 28 in UTC and LA.
const JAKARTA_DAY_ROLLOVER = '2026-06-14T17:30:00Z';
const LA_PREV_YEAR = '2026-01-01T02:00:00Z';
const MONTH_BOUNDARY_Z = '2026-02-28T23:59:00Z';

describe('formatCalendarDayInTimeZone — YYYY-MM-DD in an explicit zone (isoDay shape)', () => {
  it('en/id: locale-independent (pinned en-US), day rolls over at the zone boundary', () => {
    setActiveLocale(ID);
    expect(formatCalendarDayInTimeZone(new Date(SUN_NOON_Z), 'Asia/Jakarta')).toBe('2026-06-14');
    expect(formatCalendarDayInTimeZone(new Date(JAKARTA_DAY_ROLLOVER), 'Asia/Jakarta')).toBe('2026-06-15');
    expect(formatCalendarDayInTimeZone(new Date(MONTH_BOUNDARY_Z), 'Asia/Jakarta')).toBe('2026-03-01');
    expect(formatCalendarDayInTimeZone(new Date(MONTH_BOUNDARY_Z), 'UTC')).toBe('2026-02-28');
    expect(formatCalendarDayInTimeZone(new Date(MONTH_BOUNDARY_Z), 'America/Los_Angeles')).toBe('2026-02-28');
    setActiveLocale(EN);
    expect(formatCalendarDayInTimeZone(new Date(JAKARTA_DAY_ROLLOVER), 'Asia/Jakarta')).toBe('2026-06-15');
  });
});

describe('local calendar-day shapes (never zoned — the resolved timezone must not reach them)', () => {
  it('en: date-only ISO and local Dates render the same calendar day on every machine', () => {
    setActiveLocale({ ...EN, timezone: 'America/Los_Angeles' });
    expect(formatDate('2026-06-14')).toBe('Jun 14, 2026');
    expect(formatDateOnly('2026-06-14')).toBe('Jun 14, 2026');
    expect(formatDateOnlyNumeric('2026-06-14')).toBe('6/14/2026');
    expect(formatFullDate(new Date(2026, 5, 14))).toBe('Jun 14, 2026');
    expect(formatMonthDay(new Date(2026, 5, 14))).toBe('Jun 14');
    expect(formatMonthShort(new Date(2026, 5, 14))).toBe('Jun');
    expect(formatWeekday(new Date(2026, 5, 14))).toBe('Sun');
    expect(formatMonthYear(new Date(2026, 5, 14))).toBe('June 2026');
    expect(formatWeekdayMonthDay(new Date(2026, 5, 14))).toBe('Sun, Jun 14');
    expect(formatWeekdayDay(new Date(2026, 5, 14))).toBe('14 Sun');
  });

  it('id: day-before-month ordering and Indonesian month/weekday names', () => {
    setActiveLocale(ID);
    expect(formatDate('2026-06-14')).toBe('14 Jun 2026');
    expect(formatDateOnly('2026-06-14')).toBe('14 Jun 2026');
    expect(formatDateOnlyNumeric('2026-06-14')).toBe('14/6/2026');
    expect(formatFullDate(new Date(2026, 5, 14))).toBe('14 Jun 2026');
    expect(formatMonthDay(new Date(2026, 5, 14))).toBe('14 Jun');
    expect(formatMonthShort(new Date(2026, 5, 14))).toBe('Jun');
    expect(formatWeekday(new Date(2026, 5, 14))).toBe('Min');
    expect(formatMonthYear(new Date(2026, 5, 14))).toBe('Juni 2026');
    expect(formatWeekdayMonthDay(new Date(2026, 5, 14))).toBe('Min, 14 Jun');
    expect(formatWeekdayDay(new Date(2026, 5, 14))).toBe('Min, 14');
  });
});

describe('instant shapes in the resolved profile timezone', () => {
  it('en: Asia/Jakarta (UTC+7) — including the day rollover past midnight', () => {
    setActiveLocale({ ...EN, timezone: 'Asia/Jakarta' });
    expect(formatInstantDate(SUN_NOON_Z)).toBe('Jun 14, 2026');
    expect(formatInstantDateNumeric(SUN_NOON_Z)).toBe('6/14/2026');
    expect(formatInstantDate(JAKARTA_DAY_ROLLOVER)).toBe('Jun 15, 2026');
    expect(formatInstantDateNumeric(JAKARTA_DAY_ROLLOVER)).toBe('6/15/2026');
    expect(formatDateTime(new Date(SUN_NOON_Z))).toBe('Jun 14, 2026, 07:00 PM');
    expect(formatClockTime(new Date(SUN_NOON_Z))).toBe('07:00 PM');
  });

  it('id: Asia/Jakarta — day-first ordering, dot time separator, h23 clock', () => {
    setActiveLocale(ID);
    expect(formatInstantDate(SUN_NOON_Z)).toBe('14 Jun 2026');
    expect(formatInstantDateNumeric(SUN_NOON_Z)).toBe('14/6/2026');
    expect(formatInstantDate(JAKARTA_DAY_ROLLOVER)).toBe('15 Jun 2026');
    expect(formatInstantDateNumeric(JAKARTA_DAY_ROLLOVER)).toBe('15/6/2026');
    expect(formatDateTime(new Date(SUN_NOON_Z))).toBe('14 Jun 2026, 19.00');
    expect(formatClockTime(new Date(SUN_NOON_Z))).toBe('19.00');
  });

  it('en: US DST edges — spring-forward and fall-back read the correct wall clock', () => {
    setActiveLocale({ ...EN, timezone: 'America/Los_Angeles' });
    expect(formatInstantDate(LA_SPRING_FORWARD)).toBe('Mar 8, 2026');
    expect(formatInstantDateNumeric(LA_SPRING_FORWARD)).toBe('3/8/2026');
    expect(formatDateTime(new Date(LA_SPRING_FORWARD))).toBe('Mar 8, 2026, 03:30 AM');
    expect(formatClockTime(new Date(LA_SPRING_FORWARD))).toBe('03:30 AM');
    expect(formatInstantDate(LA_FALL_BACK)).toBe('Nov 1, 2026');
    expect(formatInstantDateNumeric(LA_FALL_BACK)).toBe('11/1/2026');
    expect(formatDateTime(new Date(LA_FALL_BACK))).toBe('Nov 1, 2026, 03:30 AM');
    expect(formatClockTime(new Date(LA_FALL_BACK))).toBe('03:30 AM');
  });

  it('id: US DST edges keep day-first ordering across the transitions', () => {
    setActiveLocale({ ...ID, timezone: 'America/Los_Angeles' });
    expect(formatInstantDate(LA_SPRING_FORWARD)).toBe('8 Mar 2026');
    expect(formatInstantDateNumeric(LA_SPRING_FORWARD)).toBe('8/3/2026');
    expect(formatInstantDate(LA_FALL_BACK)).toBe('1 Nov 2026');
    expect(formatInstantDateNumeric(LA_FALL_BACK)).toBe('1/11/2026');
  });

  it('en: offset edge — a UTC-next-year instant lands in the previous year in a behind-UTC zone', () => {
    setActiveLocale({ ...EN, timezone: 'America/Los_Angeles' });
    expect(formatInstantDate(LA_PREV_YEAR)).toBe('Dec 31, 2025');
    expect(formatInstantDateNumeric(LA_PREV_YEAR)).toBe('12/31/2025');
    setActiveLocale({ ...EN, timezone: 'UTC' });
    expect(formatInstantDate('2026-02-28T23:59:00Z')).toBe('Feb 28, 2026');
    expect(formatInstantDateNumeric('2026-02-28T23:59:00Z')).toBe('2/28/2026');
  });

  it('formatDecisionDateNumeric composes the numeric instant shape', () => {
    setActiveLocale({ ...EN, timezone: 'Asia/Jakarta' });
    expect(formatDecisionDateNumeric({ contract_date: '2026-06-14', decided_at: SUN_NOON_Z })).toBe('6/14/2026');
    expect(formatDecisionDateNumeric({ decided_at: JAKARTA_DAY_ROLLOVER })).toBe('6/15/2026');
  });
});

describe('UTC-pinned shapes (the UTC pin is load-bearing, not the profile timezone)', () => {
  it('en: month/year variants ignore the profile timezone', () => {
    setActiveLocale({ ...EN, timezone: 'Pacific/Honolulu' });
    expect(formatUtcMonthYear(new Date('2026-06-05T12:00:00Z'))).toBe('Jun 26');
    expect(formatUtcMonthYearFull(new Date('2026-06-05T12:00:00Z'))).toBe('Jun 2026');
    expect(formatUtcMonthYear(new Date('2026-12-31T23:59:00Z'))).toBe('Dec 26');
    expect(formatUtcMonthYearFull(new Date('2026-12-31T23:59:00Z'))).toBe('Dec 2026');
    expect(formatUtcDayMonthYear(new Date('2025-03-15T12:00:00Z'))).toBe("15 Mar '25");
    expect(formatUtcDayMonthYear(new Date('2026-12-31T12:00:00Z'))).toBe("31 Dec '26");
  });

  it('id: month names follow the locale, 2-digit year and hand-joined punctuation stay', () => {
    setActiveLocale(ID);
    expect(formatUtcMonthYear(new Date('2026-06-05T12:00:00Z'))).toBe('Jun 26');
    expect(formatUtcMonthYearFull(new Date('2026-06-05T12:00:00Z'))).toBe('Jun 2026');
    expect(formatUtcDayMonthYear(new Date('2025-03-15T12:00:00Z'))).toBe("15 Mar '25");
  });
});

describe('en-GB-pinned shapes (a SHAPE request, not a locale choice)', () => {
  it('day-before-month stays under BOTH en and id actives', () => {
    setActiveLocale(EN);
    expect(formatDayMonth(new Date(2026, 5, 14))).toBe('14 Jun');
    setActiveLocale(ID);
    expect(formatDayMonth(new Date(2026, 5, 14))).toBe('14 Jun');
  });
});

describe('datetime-local wall-clock helpers (wallTime / wallTimeSec shapes)', () => {
  it('en: wall time in an explicit zone, DST edges included', () => {
    expect(instantToZonedDatetimeLocal(new Date(SUN_NOON_Z), 'Asia/Jakarta')).toBe('2026-06-14T19:00');
    expect(instantToZonedDatetimeLocal(new Date(LA_SPRING_FORWARD), 'America/Los_Angeles')).toBe('2026-03-08T03:30');
    expect(instantToZonedDatetimeLocal(new Date(LA_FALL_BACK), 'America/Los_Angeles')).toBe('2026-11-01T03:30');
    expect(instantToZonedDatetimeLocal(new Date(JAKARTA_DAY_ROLLOVER), 'Asia/Jakarta')).toBe('2026-06-15T00:30');
    expect(zonedDatetimeLocalToInstant('2026-06-14T19:00', 'Asia/Jakarta')?.toISOString()).toBe('2026-06-14T12:00:00.000Z');
    expect(zonedDatetimeLocalToInstant('2026-03-08T03:30', 'America/Los_Angeles')?.toISOString()).toBe('2026-03-08T10:30:00.000Z');
    expect(zonedDatetimeLocalToInstant('2026-11-01T03:30', 'America/Los_Angeles')?.toISOString()).toBe('2026-11-01T11:30:00.000Z');
  });

  it('the same helpers through the profile-timezone default agree with the explicit-zone calls', () => {
    setActiveLocale({ ...EN, timezone: 'Asia/Jakarta' });
    expect(instantToZonedDatetimeLocal(new Date(SUN_NOON_Z))).toBe('2026-06-14T19:00');
    expect(zonedDatetimeLocalToInstant('2026-06-14T19:00')?.toISOString()).toBe('2026-06-14T12:00:00.000Z');
  });
});

describe('profile timezone == the runtime default zone — the outputs the formatter sharing must preserve', () => {
  // The consolidation merges a zoned shape with its local twin when the profile timezone equals
  // the runtime default (spec: formatting with timeZone = default zone == formatting without).
  // These pins hold that equivalence in BOTH directions on the machine running the test.
  const PROCESS_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

  it('zoned instant shapes render byte-identically to their local twins when the zones coincide', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: PROCESS_ZONE });
    // formatDate renders the parsed instant in the RUNTIME zone; the zoned twin must agree with it.
    expect(formatInstantDate(SUN_NOON_Z)).toBe(formatDate(SUN_NOON_Z));
    expect(formatInstantDate(LA_SPRING_FORWARD)).toBe(formatDate(LA_SPRING_FORWARD));
    expect(formatInstantDate(JAKARTA_DAY_ROLLOVER)).toBe(formatDate(JAKARTA_DAY_ROLLOVER));
    // The zoned numeric instant must equal the numeric rendering of the zoned wall date.
    expect(formatInstantDateNumeric(SUN_NOON_Z)).toBe(
      formatDateOnlyNumeric(instantToZonedDatetimeLocal(new Date(SUN_NOON_Z)).slice(0, 10)),
    );
  });

  it('wall-clock helpers through the process-zone default equal the explicit same-zone calls', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: PROCESS_ZONE });
    expect(instantToZonedDatetimeLocal(new Date(SUN_NOON_Z))).toBe(instantToZonedDatetimeLocal(new Date(SUN_NOON_Z), PROCESS_ZONE));
    // surveyPolicy.dayInZone's contract: the calendar day IS the first 10 chars of the wall value.
    expect(formatCalendarDayInTimeZone(new Date(JAKARTA_DAY_ROLLOVER), PROCESS_ZONE))
      .toBe(instantToZonedDatetimeLocal(new Date(JAKARTA_DAY_ROLLOVER), PROCESS_ZONE).slice(0, 10));
  });
});
