export interface LocalePreferencesInput { locale?: string | null; numberLocale?: string | null; timezone?: string | null; }
export interface OrgLocaleDefaults { defaultLocale?: string | null; defaultNumberLocale?: string | null; defaultTimezone?: string | null; }
export interface ResolvedLocale { locale: string; numberLocale: string; timezone: string; }
export const FALLBACK_LOCALE = 'en';
export const FALLBACK_TIMEZONE = 'Asia/Jakarta';
/** The single pure locale resolution seam. NULL profile values inherit; NULL org number locale derives. */
export function resolveLocale(profile: LocalePreferencesInput, org: OrgLocaleDefaults): ResolvedLocale {
  const locale = profile.locale ?? org.defaultLocale ?? FALLBACK_LOCALE;
  return { locale, numberLocale: profile.numberLocale ?? org.defaultNumberLocale ?? locale, timezone: profile.timezone ?? org.defaultTimezone ?? FALLBACK_TIMEZONE };
}
