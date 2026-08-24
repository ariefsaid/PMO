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
