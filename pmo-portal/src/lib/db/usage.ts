import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Database } from '@/src/lib/supabase/database.types';

/**
 * Usage DAL (ops-admin-surface S5, FR-USE-002/003/004). Sources ONLY the `org_usage_summary`/
 * `operator_usage_summary` aggregate RPCs — the privacy line (NFR-PRIV-001): no
 * agent_events/agent_runs/agent_threads read ever reaches this module. `margin_usd` is null
 * when `CREDITS_PER_USD` is unset server-side (FR-USE-006) — the UI hides the column then
 * (AC-USE-003).
 */

export type UsageSummaryRow = Database['public']['Functions']['org_usage_summary']['Returns'][number];
export type OperatorUsageSummaryRow = Database['public']['Functions']['operator_usage_summary']['Returns'][number];
export type OperatorOrgRow = Database['public']['Functions']['operator_list_orgs']['Returns'][number];

/** The caller's own-org usage aggregate (org-Admin path). */
export async function getOrgUsageSummary(): Promise<UsageSummaryRow[]> {
  const { data, error } = await supabase.rpc('org_usage_summary');
  if (error) throw new AppError(error.message, error.code);
  return data ?? [];
}

/** The Operator's usage aggregate — all orgs when orgId is omitted, one org when supplied. */
export async function getOperatorUsageSummary(orgId?: string | null): Promise<OperatorUsageSummaryRow[]> {
  const { data, error } = await supabase.rpc('operator_usage_summary', { p_org_id: orgId ?? undefined });
  if (error) throw new AppError(error.message, error.code);
  return data ?? [];
}

/** Directory columns ONLY (FR-OPR-004) — the Operator org-switcher source. */
export async function listOperatorOrgs(): Promise<OperatorOrgRow[]> {
  const { data, error } = await supabase.rpc('operator_list_orgs');
  if (error) throw new AppError(error.message, error.code);
  return data ?? [];
}
