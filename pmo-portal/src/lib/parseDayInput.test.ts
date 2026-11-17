import { afterEach, describe, expect, it } from 'vitest';
import { formatIsoDay } from './format';
import { resetActiveLocale, setActiveLocale } from './locale/activeLocale';
import { parseDayInput } from './parseDayInput';

describe('parseDayInput', () => {
  it.each([
    ['16 Nov 2026', '2026-11-16'],
    ['16 November 2026', '2026-11-16'],
    ['16 nov 2026', '2026-11-16'],
    ['6 Nov 2026', '2026-11-06'],
    ['16/11/2026', '2026-11-16'],
    ['16-11-2026', '2026-11-16'],
    ['6/1/2026', '2026-01-06'],
    ['2026-11-16', '2026-11-16'],
    ['  16 Nov 2026 ', '2026-11-16'],
  ])('reads %s as %s', (typed, iso) => {
    expect(parseDayInput(typed)).toBe(iso);
  });

  it.each([
    ['17 Agu 2026', '2026-08-17'],
    ['17 Agustus 2026', '2026-08-17'],
    ['3 Mei 2026', '2026-05-03'],
    ['25 Des 2026', '2026-12-25'],
    ['9 Okt 2026', '2026-10-09'],
  ])('reads the Bahasa Indonesia form %s as %s', (typed, iso) => {
    expect(parseDayInput(typed)).toBe(iso);
  });

  it.each(['', 'tomorrow', '31/02/2026', '2026-02-30', '16 Foo 2026', '16 Nov 26', '16 Nov', '16/11', '2026-13-01', '0/1/2026'])(
    'refuses %j',
    (typed) => {
      expect(parseDayInput(typed)).toBeNull();
    },
  );
});

// Run this file under TZ=UTC, TZ=Asia/Jakarta and TZ=America/Los_Angeles: an ISO day must come back as
// the same calendar day in every zone, including across DST changes, month ends and a leap day.
const DAYS = [
  '2026-11-16', '2026-11-04', '2026-11-03', '2026-01-01', '2026-12-31', '2024-02-29', '2026-02-28',
  '2026-03-08', '2026-03-09', '2026-03-29', '2026-10-25', '2026-11-01', '2026-11-02', '2026-04-05', '2026-09-27',
];

describe('an ISO day round-trips as the same calendar day', () => {
  afterEach(() => resetActiveLocale());

  it.each(['en', 'id'])('formats and reads %s back to the same ISO day', (locale) => {
    setActiveLocale({ locale, numberLocale: locale === 'id' ? 'id-ID' : 'en-US', timezone: 'UTC' });
    for (const iso of DAYS) expect(parseDayInput(formatIsoDay(iso))).toBe(iso);
  });

  it('shows the stored day, not the day before or after, whatever the zone', () => {
    expect(formatIsoDay('2026-11-04')).toBe('4 Nov 2026');
    expect(formatIsoDay('2026-11-01')).toBe('1 Nov 2026');
    expect(formatIsoDay('2026-03-08')).toBe('8 Mar 2026');
  });

  it('is not moved when the process zone changes after the first format', () => {
    const previous = process.env.TZ;
    try {
      for (const zone of ['UTC', 'Asia/Jakarta', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
        process.env.TZ = zone;
        expect(formatIsoDay('2026-11-04')).toBe('4 Nov 2026');
        expect(parseDayInput(formatIsoDay('2026-11-04'))).toBe('2026-11-04');
      }
    } finally {
      if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
  });

  it('refuses a stored value that is not a real day', () => {
    expect(formatIsoDay('2026-02-30')).toBe('—');
    expect(formatIsoDay('16 Nov 2026')).toBe('—');
  });
});
