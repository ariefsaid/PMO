import { supabase } from '@/src/lib/supabase/client';
import { isTaxTreatment } from '@/src/lib/taxTreatment';
import type { TaxTreatment } from '@/src/lib/db/procurementLifecycle';

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

/**
 * The org's tax-treatment DEFAULT (`OD-TAX-1`, migration 0207) — `'inclusive' | 'exclusive'`,
 * seeded `'exclusive'` (the common Indonesian B2B quoting shape, "harga belum termasuk PPN").
 *
 * ⛔ THE ONE RULE. This value PRE-SELECTS a control in a form composing a NEW row and nothing
 * else. It is **never** read to interpret a stored figure: a row whose `tax_treatment` is NULL
 * means "no value to interpret", never "inherit the current default". Reading a *current* setting
 * onto an *old* row re-writes what that row meant every time an Admin flips the setting — the #478
 * ambiguity that cannot be recovered afterwards. Every rendered figure gets its basis from its OWN
 * row (`TaxBasisLabel`), never from here.
 *
 * `organizations` carries a SELECT policy scoped to the caller's own org, so this returns exactly
 * one row under RLS and `org_id` is NEVER sent (ADR-0017). Same shape as `getOrgDefaultCurrency`.
 */
export async function getOrgTaxDefault(): Promise<TaxTreatment | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select('default_tax_treatment')
    .limit(1);
  if (error) throw new Error(error.message);
  const value = data?.[0]?.default_tax_treatment;
  // ⚑ No fallback constant. A hardcoded 'exclusive' here would be a marker chosen by nobody that
  // survives every failure mode — an unreadable org row, a dropped column, a caller with no org —
  // and would pre-select it into a form as if an Admin had. Unknown stays unknown: the form's
  // select simply opens empty, exactly as it did before 0207.
  return isTaxTreatment(value) ? value : null;
}

/**
 * Set the org's tax-treatment default. **Admin-only**, enforced by RLS
 * (`organizations_update_tax_default`, 0207) plus a column-scoped `grant update
 * (default_tax_treatment)` — `authenticated` holds no table-wide UPDATE on `organizations`, so
 * this is the only column a client can move. The FE gate (`can('manage', 'orgAccounting')`) mirrors
 * that and is UX only; RLS is the authority (ADR-0016).
 *
 * ⚑ TWO STEPS ON PURPOSE. PostgREST needs a filter to target the row, and the id comes from an
 * RLS-scoped SELECT rather than from the client's JWT claim — the client never asserts which org
 * it is updating, it asks the database which org it can see and writes to that. A `.neq('id', …)`
 * style match-everything filter would work identically today and update every org the day a policy
 * regressed.
 */
export async function setOrgTaxDefault(value: TaxTreatment): Promise<void> {
  const { data, error } = await supabase.from('organizations').select('id').limit(1);
  if (error) throw new Error(error.message);
  const orgId = data?.[0]?.id;
  if (!orgId) throw new Error('No organization is readable for the current user');
  const { error: updateError } = await supabase
    .from('organizations')
    .update({ default_tax_treatment: value })
    .eq('id', orgId);
  if (updateError) throw new Error(updateError.message);
}
