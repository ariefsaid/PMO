import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Database } from '@/src/lib/supabase/database.types';

/**
 * Usage DAL (ops-admin-surface S5, FR-USE-002/003/004; agent cost dashboard AC-ACD-005/006/008).
 * Sources ONLY the `org_usage_summary`/`operator_usage_summary` + `org_agent_run_stats`/
 * `operator_agent_run_stats` aggregate RPCs — the privacy line (NFR-PRIV-001): no
 * agent_events/agent_runs/agent_threads read ever reaches this module (the run-stats RPCs group
 * `agent_usage` by run_id server-side). `margin_usd` is null when `CREDITS_PER_USD` is unset
 * server-side (FR-USE-006) — the UI hides the column then (AC-USE-003).
 */

export type UsageSummaryRow = Database['public']['Functions']['org_usage_summary']['Returns'][number];
export type OperatorUsageSummaryRow = Database['public']['Functions']['operator_usage_summary']['Returns'][number];
export type OperatorOrgRow = Database['public']['Functions']['operator_list_orgs']['Returns'][number];
export type RunStatsRow = Database['public']['Functions']['org_agent_run_stats']['Returns'][number];
export type OperatorRunStatsRow = Database['public']['Functions']['operator_agent_run_stats']['Returns'][number];

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

/** The caller's own-org per-run cost/latency stats (org-Admin path). Aggregates ONLY — NFR-PRIV-001. */
export async function getOrgAgentRunStats(): Promise<RunStatsRow[]> {
  const { data, error } = await supabase.rpc('org_agent_run_stats');
  if (error) throw new AppError(error.message, error.code);
  return data ?? [];
}

/** The Operator's per-run cost/latency stats — all orgs when orgId is omitted, one org when supplied. */
export async function getOperatorAgentRunStats(orgId?: string | null): Promise<OperatorRunStatsRow[]> {
  const { data, error } = await supabase.rpc('operator_agent_run_stats', { p_org_id: orgId ?? undefined });
  if (error) throw new AppError(error.message, error.code);
  return data ?? [];
}
