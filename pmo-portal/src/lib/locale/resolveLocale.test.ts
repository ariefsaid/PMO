import { describe, it, expect } from 'vitest';
import { resolveLocale, FALLBACK_LOCALE, FALLBACK_TIMEZONE } from './resolveLocale';
const org = (o: Partial<Parameters<typeof resolveLocale>[1]> = {}) => ({ defaultLocale: 'en', defaultNumberLocale: null, defaultTimezone: 'Asia/Jakarta', ...o });
describe('FR-L10N-003 resolveLocale', () => {
  it('AC-L10N-001 profile NULL inherits the org default', () => {
    expect(resolveLocale({ locale: null, numberLocale: null, timezone: null }, org({ defaultLocale: 'id' })).locale).toBe('id');
    expect(resolveLocale({ locale: null, numberLocale: null, timezone: null }, org({ defaultLocale: 'en' })).locale).toBe('en');
  });
  it('AC-L10N-002 explicit override survives an org change', () => {
    expect(resolveLocale({ locale: 'en', numberLocale: null, timezone: null }, org({ defaultLocale: 'id' })).locale).toBe('en');
  });
  it('AC-L10N-003 reset resolves as unset', () => {
    expect(resolveLocale({ locale: null, numberLocale: null, timezone: null }, org({ defaultLocale: 'id' }))).toEqual(resolveLocale({}, org({ defaultLocale: 'id' })));
  });
  it('resolves number locale profile, org, then locale', () => {
    expect(resolveLocale({}, org()).numberLocale).toBe('en');
    expect(resolveLocale({}, org({ defaultNumberLocale: 'id-ID' })).numberLocale).toBe('id-ID');
    expect(resolveLocale({ locale: 'id', numberLocale: null }, org()).numberLocale).toBe('id');
  });
  it('resolves timezone and fails closed', () => {
    expect(resolveLocale({ timezone: 'UTC' }, org()).timezone).toBe('UTC');
    expect(resolveLocale({}, {})).toEqual({ locale: FALLBACK_LOCALE, numberLocale: FALLBACK_LOCALE, timezone: FALLBACK_TIMEZONE });
  });
});

// A stored preference the platform cannot use (hand-edited row, legacy value, trailing whitespace)
// must never reach `Intl` — it throws RangeError and takes every date/money screen down with it.
// An unusable value is treated as UNSET at its tier, so resolution falls through to the next one.
describe('FR-L10N-003 resolveLocale falls back safely when a stored preference is unusable (#684)', () => {
  it.each(['Mars/Olympus', 'Asia/Jakarta ', ' UTC', 'not a zone'])(
    'an unusable profile timezone %j inherits the org default',
    (timezone) => {
      expect(resolveLocale({ timezone }, org({ defaultTimezone: 'UTC' })).timezone).toBe('UTC');
    },
  );

  it.each(['Mars/Olympus', 'Asia/Jakarta ', ''])(
    'an unusable org timezone %j resolves to FALLBACK_TIMEZONE for a user who inherits it',
    (defaultTimezone) => {
      expect(resolveLocale({ timezone: null }, org({ defaultTimezone })).timezone).toBe(FALLBACK_TIMEZONE);
    },
  );

  it('an unusable profile AND org timezone resolves to FALLBACK_TIMEZONE', () => {
    expect(resolveLocale({ timezone: 'Bad/Zone' }, org({ defaultTimezone: 'Also/Bad' })).timezone).toBe(FALLBACK_TIMEZONE);
  });

  it.each(['en_US', 'en-US ', 'zz-ZZ', 'not-a-locale-tag-at-all'])(
    'an unusable profile number locale %j inherits the org default',
    (numberLocale) => {
      expect(resolveLocale({ numberLocale }, org({ defaultNumberLocale: 'id-ID' })).numberLocale).toBe('id-ID');
    },
  );

  it.each(['en_US', 'id-ID ', 'zz-ZZ'])(
    'an unusable org number locale %j falls back to the resolved language for an inheriting user',
    (defaultNumberLocale) => {
      expect(resolveLocale({ numberLocale: null }, org({ defaultLocale: 'id', defaultNumberLocale })).numberLocale).toBe('id');
    },
  );

  it.each(['en ', 'en_US', 'zz'])(
    'an unusable language %j at either tier resolves to FALLBACK_LOCALE',
    (bad) => {
      expect(resolveLocale({ locale: bad }, org({ defaultLocale: 'id' })).locale).toBe('id');
      expect(resolveLocale({ locale: null }, org({ defaultLocale: bad })).locale).toBe(FALLBACK_LOCALE);
      // The number locale derives from the SANITISED language, never the unusable one.
      expect(resolveLocale({ locale: null }, org({ defaultLocale: bad })).numberLocale).toBe(FALLBACK_LOCALE);
    },
  );

  it('usable explicit values are returned unchanged', () => {
    expect(
      resolveLocale(
        { locale: 'id', numberLocale: 'en-US', timezone: 'America/New_York' },
        org({ defaultLocale: 'en', defaultNumberLocale: 'id-ID', defaultTimezone: 'UTC' }),
      ),
    ).toEqual({ locale: 'id', numberLocale: 'en-US', timezone: 'America/New_York' });
  });
});
