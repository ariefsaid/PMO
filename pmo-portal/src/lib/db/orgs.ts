import { supabase } from '@/src/lib/supabase/client';

/**
 * The org's single operating currency (OD-CR-5 / migration 0187): ISO-4217 alpha-3, stamped onto
 * every money row by the `stamp_currency` trigger. Read here ONLY for figures with no money row of
 * their own (RPC aggregates, pipeline stages, cross-record sums) — those figures are
 * org-denominated. organizations carries a SELECT policy scoped to the caller's own org, so this
 * returns exactly one row under RLS. org_id is NEVER sent (ADR-0017).
 */
export async function getOrgDefaultCurrency(): Promise<string> {
  const { data, error } = await supabase.from('organizations').select('default_currency').limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.default_currency ?? 'USD';
}

/**
 * The org's locale defaults (FR-L10N-002, migration `0198`) — the middle tier of the three-tier
 * resolution `profile → org → hardcoded fallback` that `resolveLocale` implements.
 *
 * ⚑ These are read LIVE and never copied onto a user. A profile column of NULL means "inherit the
 * org default", so an org that flips its default locale moves every inheriting user with it. A
 * design that copies today's org default down at insert time passes AC-L10N-001 and fails
 * AC-L10N-002. Same shape as `getOrgDefaultCurrency`: one row under RLS, `org_id` never sent
 * (ADR-0017).
 */
export interface OrgLocaleDefaultsRow {
  defaultLocale: string | null;
  defaultNumberLocale: string | null;
  defaultTimezone: string | null;
}

export async function getOrgLocaleDefaults(): Promise<OrgLocaleDefaultsRow> {
  const { data, error } = await supabase
    .from('organizations')
    .select('default_locale,default_number_locale,default_timezone')
    .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0];
  return {
    defaultLocale: row?.default_locale ?? null,
    defaultNumberLocale: row?.default_number_locale ?? null,
    defaultTimezone: row?.default_timezone ?? null,
  };
}
