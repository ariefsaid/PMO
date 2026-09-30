import { afterEach, describe, expect, it } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import {
  formatDateOnly,
  formatDateOnlyNumeric,
  formatDateTime,
  formatDecisionDateNumeric,
  formatInstantDate,
  formatInstantDateNumeric,
  formatRelativeTime,
  instantToZonedDatetimeLocal,
  zonedDatetimeLocalToInstant,
} from './format';

const EN = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };

afterEach(() => resetActiveLocale());

describe('profile-timezone date formatting', () => {
  it('AC-PLC-005: uses the profile timezone for instant-derived date, time, and numeric date shapes', () => {
    const instant = '2026-06-14T23:30:00.000Z';
    setActiveLocale(EN);
    expect(formatInstantDate(instant)).toBe('Jun 14, 2026');
    expect(formatInstantDateNumeric(instant)).toBe('6/14/2026');
    expect(formatDateTime(new Date(instant))).toMatch(/11:30\s*PM/);

    setActiveLocale({ ...EN, timezone: 'Asia/Jakarta' });
    expect(formatInstantDate(instant)).toBe('Jun 15, 2026');
    expect(formatInstantDateNumeric(instant)).toBe('6/15/2026');
    expect(formatDateTime(new Date(instant))).toMatch(/06:30\s*AM/);
  });

  it('keeps ISO date-only values on their calendar day across profile timezones', () => {
    setActiveLocale({ ...EN, timezone: 'UTC' });
    const date = formatDateOnly('2026-06-14');
    const numericDate = formatDateOnlyNumeric('2026-06-14');
    setActiveLocale({ ...EN, timezone: 'Pacific/Honolulu' });

    expect(formatDateOnly('2026-06-14')).toBe(date);
    expect(formatDateOnlyNumeric('2026-06-14')).toBe(numericDate);
    expect(date).toBe('Jun 14, 2026');
    expect(numericDate).toBe('6/14/2026');
  });

  describe('#700/#732 formatDecisionDateNumeric — contract_date on a win, the instant on a loss', () => {
    // UTC+7 / UTC-8 / UTC bracket the date line on both sides.
    const zones = ['Asia/Jakarta', 'Etc/GMT+8', 'America/Los_Angeles', 'UTC'];

    it.each(zones)('#732: a won row shows contract_date as-is for a %s viewer, whatever decided_at holds', (timezone) => {
      setActiveLocale({ ...EN, timezone });
      // decided_at as cast by a UTC+7 session (17:00Z the previous day), by a UTC session, and by a UTC-8 session.
      for (const decided_at of ['2026-08-31T17:00:00+00:00', '2026-09-01T00:00:00+00:00', '2026-09-01T08:00:00+00:00']) {
        expect(formatDecisionDateNumeric({ contract_date: '2026-09-01', decided_at })).toBe('9/1/2026');
      }
    });

    it.each(zones)('#700: the instant path is untouched — a loss instant still follows a %s viewer', (timezone) => {
      setActiveLocale({ ...EN, timezone });
      const expected = formatInstantDateNumeric('2026-06-14T23:30:00Z');
      expect(formatDecisionDateNumeric({ contract_date: null, decided_at: '2026-06-14T23:30:00Z' })).toBe(expected);
    });

    it('#732: with no contract_date, an instant at exactly midnight UTC is a real instant (no calendar-date heuristic)', () => {
      setActiveLocale({ ...EN, timezone: 'Etc/GMT+8' });
      expect(formatDecisionDateNumeric({ decided_at: '2026-09-01T00:00:00Z' })).toBe('8/31/2026');
    });

    it('#700: blank and invalid input render an em-dash', () => {
      expect(formatDecisionDateNumeric({ contract_date: null, decided_at: null })).toBe('—');
      expect(formatDecisionDateNumeric({ decided_at: 'nope' })).toBe('—');
    });
  });

  it('keeps elapsed relative time independent of timezone and rejects invalid date inputs', () => {
    const elapsed = new Date(Date.now() - 60_000).toISOString();
    setActiveLocale({ ...EN, timezone: 'UTC' });
    const relativeUtc = formatRelativeTime(elapsed);
    setActiveLocale({ ...EN, timezone: 'Asia/Jakarta' });

    expect(formatRelativeTime(elapsed)).toBe(relativeUtc);
    expect(formatDateOnly('not-a-date')).toBe('—');
    expect(formatInstantDate('not-a-date')).toBe('—');
    expect(formatInstantDateNumeric('')).toBe('—');
  });
});

// A previous version of this test hardcoded 'Asia/Jakarta' as the profile timezone. On a machine
// whose PROCESS timezone also resolves to Asia/Jakarta (this dev box, and possibly CI), a bug that
// falls back to the process zone instead of the resolved profile zone would still pass — the two
// zones agree by coincidence. Pick a profile zone that is proven, at test time, to differ from
// BOTH the process zone and UTC, so the assertion can only pass for the right reason everywhere.
const PROCESS_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const CANDIDATE_ZONES: Record<string, string> = {
  'Asia/Jakarta': '2026-08-25T21:15', // UTC+7, no DST
  'America/Los_Angeles': '2026-08-25T07:15', // PDT (UTC-7) in August
};
const [DISCRIMINATING_ZONE, EXPECTED_WALL_TIME] = (() => {
  const zone = Object.keys(CANDIDATE_ZONES).find((tz) => tz !== PROCESS_TIME_ZONE);
  if (!zone) throw new Error('no candidate profile zone differs from the process zone');
  return [zone, CANDIDATE_ZONES[zone]] as const;
})();

describe('instantToZonedDatetimeLocal (#684 FR-PLC-006)', () => {
  it('defaults to the resolved profile timezone, not the process/browser zone', () => {
    expect(DISCRIMINATING_ZONE).not.toBe(PROCESS_TIME_ZONE);
    expect(DISCRIMINATING_ZONE).not.toBe('UTC');
    setActiveLocale({ ...EN, timezone: DISCRIMINATING_ZONE });
    // 2026-08-25T14:15:00Z, converted to the DISCRIMINATING_ZONE wall time.
    expect(instantToZonedDatetimeLocal(new Date('2026-08-25T14:15:00Z'))).toBe(EXPECTED_WALL_TIME);
  });

  it('formats the same instant differently in an explicitly-passed zone (overrides the default)', () => {
    const instant = new Date('2026-08-25T14:15:00Z');
    expect(instantToZonedDatetimeLocal(instant, 'Asia/Jakarta')).toBe('2026-08-25T21:15');
    expect(instantToZonedDatetimeLocal(instant, 'America/Los_Angeles')).toBe('2026-08-25T07:15');
  });

  it('zero-pads month, day, hour and minute', () => {
    expect(instantToZonedDatetimeLocal(new Date('2026-01-03T04:07:00Z'), 'UTC')).toBe('2026-01-03T04:07');
  });
});

describe('zonedDatetimeLocalToInstant (#684 FR-PLC-006)', () => {
  it('interprets the wall-clock value as being IN the resolved profile timezone by default', () => {
    setActiveLocale({ ...EN, timezone: 'Asia/Jakarta' });
    // 21:15 wall time in Jakarta (UTC+7) is 14:15Z.
    expect(zonedDatetimeLocalToInstant('2026-08-25T21:15')?.toISOString()).toBe('2026-08-25T14:15:00.000Z');
  });

  it('round-trips through instantToZonedDatetimeLocal for an arbitrary explicit zone', () => {
    const original = new Date('2026-08-25T14:15:00Z');
    const wallValue = instantToZonedDatetimeLocal(original, 'Asia/Jakarta');
    expect(zonedDatetimeLocalToInstant(wallValue, 'Asia/Jakarta')?.toISOString()).toBe(original.toISOString());
  });

  it('is DST-safe across a US spring-forward transition (America/Los_Angeles, 2026-03-08)', () => {
    // 2026-03-08 02:00 America/Los_Angeles is the skipped hour (clocks jump 02:00 -> 03:00); pick
    // wall times either side of the transition and confirm each converts to the correct UTC offset.
    expect(zonedDatetimeLocalToInstant('2026-03-08T01:30', 'America/Los_Angeles')?.toISOString())
      .toBe('2026-03-08T09:30:00.000Z'); // 01:30 PST (UTC-8) -> 09:30Z
    expect(zonedDatetimeLocalToInstant('2026-03-08T03:30', 'America/Los_Angeles')?.toISOString())
      .toBe('2026-03-08T10:30:00.000Z'); // 03:30 PDT (UTC-7) -> 10:30Z
  });

  it('is DST-safe across a US fall-back transition (America/Los_Angeles, 2026-11-01)', () => {
    expect(zonedDatetimeLocalToInstant('2026-11-01T00:30', 'America/Los_Angeles')?.toISOString())
      .toBe('2026-11-01T07:30:00.000Z'); // 00:30 PDT (UTC-7, still daylight) -> 07:30Z
    expect(zonedDatetimeLocalToInstant('2026-11-01T03:30', 'America/Los_Angeles')?.toISOString())
      .toBe('2026-11-01T11:30:00.000Z'); // 03:30 PST (UTC-8, standard resumed) -> 11:30Z
  });

  it('returns null for a malformed value', () => {
    expect(zonedDatetimeLocalToInstant('not-a-date', 'UTC')).toBeNull();
    expect(zonedDatetimeLocalToInstant('', 'UTC')).toBeNull();
  });
});
