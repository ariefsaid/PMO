import { supabase } from '@/src/lib/supabase/client';
import { toAppError, assertWriteLanded } from '@/src/lib/appError';

/**
 * A user's own locale preferences (FR-L10N-002/004/006, migration `0198`).
 *
 * Every field is nullable and **NULL means "inherit the organization default"** — it is not "unset"
 * or "unknown". That is why FR-L10N-004's "reset to organization default" is `setMyLocalePreferences`
 * with nulls rather than a copy of the org's current values: copying would FREEZE today's org default
 * onto the user, so a later change to the org default would silently skip everyone who had ever
 * pressed reset.
 */
export interface MyLocalePreferences {
  locale: string | null;
  numberLocale: string | null;
  timezone: string | null;
}

const PREFERENCE_COLUMNS = 'locale,number_locale,timezone';

/**
 * Reads the caller's own three preference columns. `null` when the profile row is not visible.
 *
 * `org_id` is NEVER sent — RLS scopes the read (`profiles_select`, ADR-0016/0017). The `id` filter is
 * a row selector, not a tenancy substitute.
 */
export async function getMyLocalePreferences(userId: string): Promise<MyLocalePreferences | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PREFERENCE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!data) return null;
  return { locale: data.locale, numberLocale: data.number_locale, timezone: data.timezone };
}

/**
 * Writes the caller's own three preference columns. Pass nulls to reset to the org default.
 *
 * ⚑ The `id` filter is NOT the authorization. `profiles_locale_self_only` (`0198`) is a RESTRICTIVE
 * policy that lets these three columns change only when the writer IS the row owner — so passing
 * somebody else's id here is refused by the database, not by this function. Written down because the
 * `eq('id', …)` reads like a guard and is not one: 0179 lets an Admin edit other profiles, which is
 * exactly the hole the restrictive policy exists to close.
 */
export async function setMyLocalePreferences(
  userId: string,
  prefs: MyLocalePreferences,
): Promise<void> {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      locale: prefs.locale,
      number_locale: prefs.numberLocale,
      timezone: prefs.timezone,
    })
    .eq('id', userId)
    .select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'Profile not found or you do not have permission to update these preferences.');
}
