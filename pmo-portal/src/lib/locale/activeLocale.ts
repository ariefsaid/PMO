import { enUS, id as idLocale, type Locale as DateFnsLocale } from 'date-fns/locale';
import { FALLBACK_LOCALE, FALLBACK_TIMEZONE, type ResolvedLocale } from './resolveLocale';

/**
 * The process-wide holder for the locale `src/lib/format.ts` formats in (FR-L10N-010/011).
 *
 * ⚑ WHY A MODULE HOLDER AND NOT A HOOK. `format.ts` exposes 23 formatters called from ~460 sites,
 * and two of its consumers are NOT React at all — `src/lib/taxTreatment.ts` and
 * `src/lib/import/projectDescriptor.ts` run on the tax and spreadsheet-import paths with no
 * provider above them. A `useLocale()` design has nothing to read there. Threading a `locale`
 * parameter through 23 signatures instead would rewrite every call site in the same diff that
 * touches money formatting — the unreviewable change DD-I18N-3 exists to prevent. So the locale
 * arrives out-of-band and the formatter signatures are untouched.
 *
 * `currency` stays an ARGUMENT and `locale` never becomes one: FR-L10N-021 makes them independent
 * (an id-ID user may legitimately view a USD invoice).
 */

/**
 * BCP-47 canonicalisation, decided ONCE here rather than at 15 formatter sites.
 *
 * `resolveLocale` yields LANGUAGE tags ('en', 'id') because `numberLocale` falls back to the
 * language tag (`resolveLocale.ts` — `?? locale`). `Intl.NumberFormat('en')` and `('en-US')` agree,
 * but `Intl.DateTimeFormat('en')` vs `('en-US')` do NOT agree on every option bag, and `'id'` vs
 * `'id-ID'` differ in currency display. Letting each formatter pass through whatever the resolver
 * handed it makes the rendered output depend on whether an org happened to set a region — so a bare
 * language tag is widened to its default region here, and an already-regioned tag passes through.
 */
const DEFAULT_REGION: Record<string, string> = { en: 'en-US', id: 'id-ID' };
export function canonicalizeLocale(tag: string): string {
  if (!tag) return DEFAULT_REGION[FALLBACK_LOCALE];
  return tag.includes('-') ? tag : (DEFAULT_REGION[tag] ?? tag);
}

/**
 * date-fns takes a locale OBJECT, not a BCP-47 tag — `formatRelativeTime` is English PROSE
 * ("5 minutes ago"), not an Intl format, so it needs its own map. date-fns@4.4.0 ships `locale/id`.
 */
const DATE_FNS_LOCALES: Record<string, DateFnsLocale> = { en: enUS, id: idLocale };

const FALLBACK: ResolvedLocale = {
  locale: FALLBACK_LOCALE,
  numberLocale: FALLBACK_LOCALE,
  timezone: FALLBACK_TIMEZONE,
};

let active: ResolvedLocale = FALLBACK;

/**
 * Point every formatter at a newly resolved locale. Called by `I18nProvider` once the profile and
 * org defaults land, and by tests/Storybook to pin a locale explicitly.
 *
 * There is no cache to invalidate: `format.ts` keys its formatter cache BY LOCALE, so a switch
 * simply misses into a new entry. (A cache keyed without the locale would let the first locale
 * rendered poison every later render — see the mutation guard in `format.locale.test.ts`.)
 */
export function setActiveLocale(resolved: ResolvedLocale): void {
  active = resolved;
}

/** Test/teardown helper — restore the boot default. */
export function resetActiveLocale(): void {
  active = FALLBACK;
}

export function getActiveLocale(): ResolvedLocale {
  return active;
}

/** The locale DATES render in — the UI language (FR-L10N-010). */
export function getDateLocale(): string {
  return canonicalizeLocale(active.locale);
}

/**
 * The locale NUMBERS and MONEY group in (FR-L10N-011) — independent of the UI language, because a
 * user may read the app in English and still want Indonesian separators.
 */
export function getNumberLocale(): string {
  return canonicalizeLocale(active.numberLocale);
}

/** The date-fns locale object for `formatRelativeTime`, keyed off the UI language. */
export function getDateFnsLocale(): DateFnsLocale {
  const base = active.locale.split('-')[0];
  return DATE_FNS_LOCALES[base] ?? enUS;
}

/**
 * ⛔ The resolved TIMEZONE is deliberately NOT exposed to the date formatters.
 *
 * `formatDate` has no `timeZone` option on purpose: `parseISO('2026-06-14')` yields LOCAL midnight,
 * and formatting it in the LOCAL zone is what stops a date-only value rendering as the 13th. Feeding
 * a profile timezone in would shift the calendar day for every date-only value whenever it differs
 * from the runtime zone (CI is UTC; the org default is Asia/Jakarta, +7). Read it from
 * `getActiveLocale().timezone` where a timezone is genuinely the subject; never inside `format.ts`.
 */
