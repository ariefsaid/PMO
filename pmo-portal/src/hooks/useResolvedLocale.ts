import { useQuery } from '@tanstack/react-query';
import { getOrgLocaleDefaults, type OrgLocaleDefaultsRow } from '@/src/lib/db/orgs';
import { useAuth } from '@/src/auth/useAuth';
import { resolveLocale, type ResolvedLocale } from '@/src/lib/locale/resolveLocale';

const NO_ORG_DEFAULTS: OrgLocaleDefaultsRow = {
  defaultLocale: null,
  defaultNumberLocale: null,
  defaultTimezone: null,
};

/**
 * The caller's effective locale, language and number locale and timezone (FR-L10N-003).
 *
 * Follows the `useOrgCurrency` pattern exactly — react-query, `staleTime: Infinity`, a safe
 * placeholder — because org locale defaults change only by operator action. Until the profile and
 * org row resolve this yields the hardcoded fallback, which is why `resolveLocale`'s own defaults
 * and not a second set of literals live behind it.
 *
 * ⛔ This hook is the ONLY place the three inputs meet. No call site may reach for
 * `profile.locale ?? org.default_locale` on its own — FR-L10N-003 makes `resolveLocale` the single
 * resolution, and a second one is how two surfaces end up disagreeing about the user's language.
 */
export function useResolvedLocale(): ResolvedLocale {
  const { currentUser } = useAuth();
  const { data: orgDefaults } = useQuery<OrgLocaleDefaultsRow>({
    queryKey: ['org-locale-defaults', currentUser?.org_id],
    queryFn: () => getOrgLocaleDefaults(),
    enabled: Boolean(currentUser),
    staleTime: Infinity,
    placeholderData: NO_ORG_DEFAULTS,
  });

  return resolveLocale(
    {
      locale: currentUser?.locale ?? null,
      numberLocale: currentUser?.number_locale ?? null,
      timezone: currentUser?.timezone ?? null,
    },
    orgDefaults ?? NO_ORG_DEFAULTS,
  );
}
