import type { ProjectClassification } from '../projectClassification';
import { supabase } from '@/src/lib/supabase/client';
import { toIso } from '@/src/lib/calendar/monthMatrix';
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
  contract_value: number | null;
  currency: string;
  budget: number | null;
  spent: number | null;
  actual_currency?: string | null;
  actual_complete?: boolean;
  budget_currency?: string | null;
  actual_coverage_count?: number | null;
  actual_coverage_total?: number | null;
  realized_margin?: number | null;
  status: ProjectStatus;
}

/**
 * Aggregates computed in SQL by get_executive_dashboard() (FR-SPD-001/002/003/004/005).
 * avg_gross_margin REMOVED (OBS-SPD-002 / FR-SPD-004); replaced by OD-MARGIN-1 dual-lens fields.
 * snake_case mirrors the RPC payload.
 */
export interface ExecutiveDashboard {
  active_projects: number;
  total_contract_value: number | null;
  total_contract_value_by_currency?: Record<string, number>;
  /** Contract value for active and closed delivery work; nullable for mixed currencies. */
  on_hand_value: number | null;
  on_hand_value_by_currency?: Array<{ currency: string; contract_value: number; actual_known: number | null; contract_remaining: number | null; actual_coverage_count: number | null; actual_coverage_total: number | null; realized_margin_known: number | null; unknown_projects: number }>;
  /** Contract remaining after known Actual, never profit. */
  on_hand_contract_remaining: number | null;
  /** Profit on billed work: billed-work revenue less Actual. */
  on_hand_realized_margin: number | null;
  on_hand_realized_margin_by_currency?: Array<{ currency: string; known_amount: number | null; unknown_projects: number }>;
  on_hand_actual_known: number | null;
  on_hand_actual_project_count: number;
  on_hand_actual_project_total: number;
  on_hand_actual_coverage_count: number;
  on_hand_actual_coverage_total: number;
  /** Contract-remaining ratio; only available for a single currency. */
  on_hand_margin: number | null;
  /** OD-MARGIN-1 Pipeline lens: weighted value, total, projected margin (FR-SPD-002/003). */
  pipeline_total_value: number | null;
  pipeline_total_value_by_currency?: Array<{ currency: string; total_value: number; weighted_value: number; forecast_margin: number | null; no_active_budget: number }>;
  pipeline_weighted_value: number | null;
  pipeline_projected_margin: number | null;
  projects_at_risk: number;
  projects_by_status: StatusCount<ProjectStatus>[];
  procurements_by_status: StatusCount<ProcurementStatus>[];
  top_projects: TopProject[];
}

/**
 * Dual win-rate payload from get_win_rate(p_from, p_to) (FR-SPD-006/007/008).
 * count- and value-weighted rates + raw counts for the period.
 */
export interface PMDashboardProject extends Omit<TopProject, 'client_name'> {
  client_name: string | null;
  contract_remaining: number | null;
  realized_margin_pct: number | null;
}

export async function getPMDashboardProjects(): Promise<PMDashboardProject[]> {
  const { data, error } = await supabase.rpc('get_pm_dashboard_projects');
  if (error) throw new Error(error.message);
  return (data as unknown as PMDashboardProject[]) ?? [];
}

export interface WinRate {
  wins_count: number;
  losses_count: number;
  /** #774: declined-to-bid deals in the period — NOT part of either win-rate denominator. */
  declined_count?: number;
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

export interface PipelineProject extends ProjectClassification {
  id: string;
  name: string;
  /** Independent PMO and organisation-owned identifiers, projected for search/display. */
  pmo_project_number?: string | null;
  code?: string | null;
  client_name: string | null;
  client_legal_name?: string | null;
  end_client_legal_name?: string | null;
  /**
   * The deal's END customer name (companies.end_client_id resolution, #758) — the company the
   * work is ultimately for, which may differ from the invoiced client. Populated for both open
   * pipeline rows (get_sales_pipeline() projects it) and lost deals (useLostDeals full row).
   */
  end_client_id?: string | null;
  end_client_name?: string | null;
  status: ProjectStatus;
  contract_value: number;
  /**
   * The deal's OWN ISO-4217 currency (projects.currency, 0187 stamp). Returned per row by
   * get_sales_pipeline() (migration 0201, FR-L10N-020) or carried from the full lost-project row
   * (useLostDeals). Row-backed money surfaces render THIS, never the org default.
   */
  currency: string;
  /**
   * The deal's OWN tax basis (projects.tax_treatment, 0197). Returned per row by
   * get_sales_pipeline() since migration 0208 (#578, OD-TAX-1 §2).
   *
   * ⛔ NULLABLE, and the null means something. 0197 permits a NULL basis only where
   * contract_value = 0 — there is no figure to qualify — so the surface renders NOTHING for it.
   * Never coalesce this to the org default (`default_tax_treatment`, 0207): that setting
   * pre-selects a form and is never read at display time, because re-deriving a stored figure's
   * basis from a current setting silently re-interprets every historical row.
   */
  tax_treatment: string | null;
  tax_rate?: number | null;
  tax_base_numerator?: number;
  tax_base_denominator?: number;
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
  // AC-W2-3-04: use LOCAL date formatter (not toISOString which converts to UTC first)
  // so the RPC boundary "2026-06-14" stays the calendar day the user sees, not UTC-shifted.
  const p_from = from ? toIso(from) : undefined;
  const p_to = to ? toIso(to) : undefined;
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
 * One eligible project row from get_finance_budget_review(). The SQL projection uses the same
 * Active-budget and Actual source rules as the rest of the dashboard. Amounts retain their source
 * currencies; variance is null unless Actual, budget, and project currencies are comparable.
 */
export interface BudgetReviewRow {
  id: string;
  name: string;
  client_name: string | null;
  status: string;
  currency: string;
  budget: number;
  budget_currency: string;
  spent: number | null;
  variance: number | null;
  actual_currency: string | null;
  actual_complete: boolean;
  actual_coverage_count: number;
  actual_coverage_total: number;
  actual_as_of: string | null;
}

/**
 * Portfolio-wide active-budget review for the caller's org. Calls the existing get_finance_budget_review
 * RPC (security invoker) — org_id is NEVER sent; base-table RLS scopes every read. On RPC error throws.
 */
export async function getFinanceBudgetReview(): Promise<BudgetReviewRow[]> {
  const { data, error } = await supabase.rpc('get_finance_budget_review');
  if (error) throw new Error(error.message);
  return (data as unknown as BudgetReviewRow[]) ?? [];
}
