import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

type ProjectStatus = Tables<'projects'>['status'];
type ProcurementStatus = Tables<'procurements'>['status'];

export interface StatusCount<S> {
  status: S;
  count: number;
}

export interface TopProject {
  id: string;
  name: string;
  client_name: string | null;
  contract_value: number;
  budget: number;
  spent: number;
  status: ProjectStatus;
}

/**
 * Aggregates computed in SQL by get_executive_dashboard() (FR-SPD-001/002/003/004/005).
 * avg_gross_margin REMOVED (OBS-SPD-002 / FR-SPD-004); replaced by OD-MARGIN-1 dual-lens fields.
 * snake_case mirrors the RPC payload.
 */
export interface ExecutiveDashboard {
  active_projects: number;
  total_contract_value: number;
  /** OD-MARGIN-1 On-hand lens: Σ(contract_value)/Σ(on-hand), value-weighted (FR-SPD-001). */
  on_hand_value: number;
  on_hand_margin: number;
  /** OD-MARGIN-1 Pipeline lens: weighted value, total, projected margin (FR-SPD-002/003). */
  pipeline_total_value: number;
  pipeline_weighted_value: number;
  pipeline_projected_margin: number;
  projects_at_risk: number;
  projects_by_status: StatusCount<ProjectStatus>[];
  procurements_by_status: StatusCount<ProcurementStatus>[];
  top_projects: TopProject[];
}

/**
 * Dual win-rate payload from get_win_rate(p_from, p_to) (FR-SPD-006/007/008).
 * count- and value-weighted rates + raw counts for the period.
 */
export interface WinRate {
  wins_count: number;
  losses_count: number;
  wins_value: number;
  losses_value: number;
  win_rate_count: number;
  win_rate_value: number;
}

export interface PipelineStage {
  status: ProjectStatus;
  count: number;
  total_value: number;
  win_probability: number;
  weighted_value: number;
}

export interface PipelineProject {
  id: string;
  name: string;
  client_name: string | null;
  status: ProjectStatus;
  contract_value: number;
  win_probability: number;
  /**
   * ISO timestamp of the last update to this project row (projects.last_update).
   * AVAILABILITY: populated for BOTH open pipeline rows (get_sales_pipeline() projects
   * it per row — migration 0020, AC-IXD-PIPE-W5-C5) AND lost deals (useLostDeals, full
   * ProjectWithRefs row). Drives the "Last touch" column + aging / "Needs attention" filter.
   * Optional only for defensive typing; the RPC always supplies it for a real project.
   */
  last_update?: string;
  /**
   * The project manager's full name (profiles.full_name resolved via the pm join).
   * AVAILABILITY: same as last_update — supplied for open pipeline rows by get_sales_pipeline()
   * (migration 0020) and for lost deals by useLostDeals. NULL when the project has no PM.
   */
  pm_name?: string | null;
}

export interface SalesPipeline {
  stages: PipelineStage[];
  projects: PipelineProject[];
}

/**
 * Executive dashboard aggregates for the caller's org. Calls the `get_executive_dashboard` RPC
 * (security invoker) — org_id is NEVER sent; base-table RLS scopes every read (FR-DAL-DASH-001,
 * NFR-DASH-SEC-001). On RPC error it throws.
 */
export async function getExecutiveDashboard(): Promise<ExecutiveDashboard> {
  const { data, error } = await supabase.rpc('get_executive_dashboard');
  if (error) throw new Error(error.message);
  return data as unknown as ExecutiveDashboard;
}

/**
 * Dual win-rate over an optional decided_at date range (FR-SPD-006/007).
 * Dates are passed as ISO YYYY-MM-DD strings (per spec §3.7; the RPC handles end-of-day inclusion
 * via `< (p_to + 1)`). No org_id — RLS scopes to caller's org (NFR-SPD-SEC-001).
 * On RPC error throws.
 */
export async function getWinRate(from?: Date, to?: Date): Promise<WinRate> {
  const p_from = from ? from.toISOString().slice(0, 10) : null;
  const p_to = to ? to.toISOString().slice(0, 10) : null;
  const { data, error } = await supabase.rpc('get_win_rate', { p_from, p_to });
  if (error) throw new Error(error.message);
  return data as unknown as WinRate;
}

/**
 * Sales pipeline stages + project list for the caller's org (FR-SPD-010).
 * security invoker, no org_id argument — RLS scopes (NFR-SPD-SEC-001).
 * Each open-pipeline project row carries `last_update` + `pm_name` (owner) for the
 * attention signals (migration 0020, AC-IXD-PIPE-W5-C5). On RPC error throws.
 */
export async function getSalesPipeline(): Promise<SalesPipeline> {
  const { data, error } = await supabase.rpc('get_sales_pipeline');
  if (error) throw new Error(error.message);
  return data as unknown as SalesPipeline;
}

/**
 * One project row from get_finance_budget_review() (FR-FIN-DEBT-010). spent is the OD-BUDGET-2
 * COMMITTED basis (Σ PO total_value in Ordered..Paid), computed in SQL; variance = spent - budget.
 * Field names mirror TopProject so the FinanceDashboard budget columns reuse it directly.
 */
export interface BudgetReviewRow {
  id: string;
  name: string;
  client_name: string | null;
  budget: number;
  spent: number;
  variance: number;
}

/**
 * Portfolio-wide budget review for the caller's org (OD-E): ALL budget>0 projects ranked by
 * variance desc, committed-basis spent. Calls the get_finance_budget_review RPC (security invoker,
 * OD-ARCH-1 aggregation) — org_id is NEVER sent; base-table RLS scopes every read. On RPC error throws.
 */
export async function getFinanceBudgetReview(): Promise<BudgetReviewRow[]> {
  const { data, error } = await supabase.rpc('get_finance_budget_review');
  if (error) throw new Error(error.message);
  return (data as unknown as BudgetReviewRow[]) ?? [];
}
