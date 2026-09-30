import { isValidTimeZone } from './timezones';

export interface LocalePreferencesInput { locale?: string | null; numberLocale?: string | null; timezone?: string | null; }
export interface OrgLocaleDefaults { defaultLocale?: string | null; defaultNumberLocale?: string | null; defaultTimezone?: string | null; }
export interface ResolvedLocale { locale: string; numberLocale: string; timezone: string; }
export const FALLBACK_LOCALE = 'en';
export const FALLBACK_TIMEZONE = 'Asia/Jakarta';

// Validity per distinct stored value. Resolution runs on every provider render; the inputs are a
// handful of stored strings, so the cache stays tiny while sparing a repeated `Intl` lookup.
const usableLocaleCache = new Map<string, boolean>();
const usableTimeZoneCache = new Map<string, boolean>();

/**
 * True only for a BCP-47 tag this runtime's `Intl` can format numbers AND dates in. A malformed
 * tag (`en_US`, trailing whitespace) makes `Intl` throw; a well-formed but unknown one (`zz-ZZ`)
 * silently formats in some other locale. Either way it is not a usable display preference.
 */
export function isUsableLocaleTag(tag: string): boolean {
  const cached = usableLocaleCache.get(tag);
  if (cached !== undefined) return cached;
  let usable = false;
  if (tag && tag.trim() === tag) {
    try {
      usable = Intl.NumberFormat.supportedLocalesOf(tag).length > 0
        && Intl.DateTimeFormat.supportedLocalesOf(tag).length > 0;
    } catch {
      usable = false;
    }
  }
  usableLocaleCache.set(tag, usable);
  return usable;
}

/** `isValidTimeZone`, memoised for the per-render resolution path. */
export function isUsableTimeZone(zone: string): boolean {
  const cached = usableTimeZoneCache.get(zone);
  if (cached !== undefined) return cached;
  const usable = isValidTimeZone(zone);
  usableTimeZoneCache.set(zone, usable);
  return usable;
}

function usable(value: string | null | undefined, isUsable: (v: string) => boolean): string | null {
  return value != null && isUsable(value) ? value : null;
}

/**
 * The single pure locale resolution seam. NULL profile values inherit; NULL org number locale derives.
 * A stored value `Intl` cannot use is treated as UNSET at its tier and falls through to the next,
 * so one unusable profile or org value can never take down a date or money screen.
 */
export function resolveLocale(profile: LocalePreferencesInput, org: OrgLocaleDefaults): ResolvedLocale {
  const locale = usable(profile.locale, isUsableLocaleTag)
    ?? usable(org.defaultLocale, isUsableLocaleTag)
    ?? FALLBACK_LOCALE;
  return {
    locale,
    numberLocale: usable(profile.numberLocale, isUsableLocaleTag)
      ?? usable(org.defaultNumberLocale, isUsableLocaleTag)
      ?? locale,
    timezone: usable(profile.timezone, isUsableTimeZone)
      ?? usable(org.defaultTimezone, isUsableTimeZone)
      ?? FALLBACK_TIMEZONE,
  };
}
