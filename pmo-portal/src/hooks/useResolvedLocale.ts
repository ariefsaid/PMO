import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { repositories, type OrgLocaleDefaultsRow } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { resolveLocale, resolveOrgBusinessTimezone, type ResolvedLocale } from '@/src/lib/locale/resolveLocale';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';
import { usePreSessionLocale } from '@/src/lib/locale/preSessionLocale';

const NO_ORG_DEFAULTS: OrgLocaleDefaultsRow = {
  defaultLocale: null,
  defaultNumberLocale: null,
  defaultTimezone: null,
};

/**
 * The caller's organization locale defaults (#684) — the values a `NULL` profile preference
 * inherits. Follows the `useOrgCurrency` pattern exactly — react-query, `staleTime: Infinity`, a
 * safe placeholder — because org locale defaults change only by operator action. Shared by
 * `useResolvedLocale` and Profile & preferences, which names what "Organization default" would
 * give the user; both read the SAME cached query.
 */
function useOrgLocaleDefaultsQuery() {
  const { currentUser, session } = useAuth();
  const readDefaults = () => repositories.orgDefaults.getLocaleDefaults();
  // Warm the shared `organizations` read as soon as the session is known so it runs in parallel
  // with `profiles` instead of waiting for `currentUser`. `readOrgSettings()` deduplicates calls
  // within 5 s, so the query below adopts the already in-flight read under the same org_id key.
  useEffect(() => {
    if (session?.user && !currentUser) {
      void readDefaults().catch(() => undefined);
    }
  }, [session?.user, currentUser]);
  return useQuery<OrgLocaleDefaultsRow>({
    queryKey: ['org-locale-defaults', currentUser?.org_id],
    queryFn: readDefaults,
    enabled: Boolean(currentUser),
    ...SESSION_QUERY_OPTIONS,
    placeholderData: NO_ORG_DEFAULTS,
  });
}

export function useOrgLocaleDefaults(): OrgLocaleDefaultsRow {
  return useOrgLocaleDefaultsQuery().data ?? NO_ORG_DEFAULTS;
}

/**
 * True once the signed-in person's organisation defaults have resolved (or failed, which falls back to UTC).
 * The signed-in shell waits for it so no screen mounts a day-defaulting form before the organisation's timezone is known (#2914).
 */
export function useOrgDefaultsReady(): boolean {
  const { currentUser } = useAuth();
  const { isPlaceholderData, isError } = useOrgLocaleDefaultsQuery();
  return !currentUser || !isPlaceholderData || isError;
}

/**
 * True once the user's effective UI language is known (FR-L10N-003):
 * - while auth is still resolving (`loading === true`), returns false so no catalogue is requested
 *   before we know whether a session exists and what language the profile wants;
 * - signed-out pages (`!loading && !currentUser`) return true immediately (preserves signed-out behaviour);
 * - signed-in users with an explicit `profile.locale` return true as soon as the profile resolves;
 * - signed-in users inheriting the organisation default (`currentUser.locale == null`) wait for `orgDefaultsReady`.
 */
export function useLocaleReady(): boolean {
  const { loading, currentUser } = useAuth();
  const orgDefaultsReady = useOrgDefaultsReady();
  if (loading) return false;
  if (!currentUser) return true;
  return Boolean(currentUser.locale) || orgDefaultsReady;
}

/** True when a signed-in user is active so boot preloads the authenticated shell's namespaces. */
export function useHasSignedInShell(): boolean {
  const { currentUser } = useAuth();
  return Boolean(currentUser);
}

/** The organization's own date boundary, used when a client date must match a server guard. */
export function useOrgBusinessTimezone(): string {
  return resolveOrgBusinessTimezone(useOrgLocaleDefaults());
}

/**
 * The caller's effective locale, language and number locale and timezone (FR-L10N-003). Until the
 * profile and org row resolve this yields the hardcoded fallback, which is why `resolveLocale`'s own
 * defaults and not a second set of literals live behind it.
 *
 * ⛔ This hook is the ONLY place the three inputs meet. No call site may reach for
 * `profile.locale ?? org.default_locale` on its own — FR-L10N-003 makes `resolveLocale` the single
 * resolution, and a second one is how two surfaces end up disagreeing about the user's language.
 */
export function useResolvedLocale(): ResolvedLocale {
  const { currentUser } = useAuth();
  const orgDefaults = useOrgLocaleDefaults();
  // Before any session no organisation is known: the sign-in pages follow the browser language, or the choice made on them.
  const preSession = usePreSessionLocale();

  return resolveLocale(
    {
      locale: currentUser ? (currentUser.locale ?? null) : preSession,
      numberLocale: currentUser?.number_locale ?? null,
      timezone: currentUser?.timezone ?? null,
    },
    orgDefaults,
  );
}
