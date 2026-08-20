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
