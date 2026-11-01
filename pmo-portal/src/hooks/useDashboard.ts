import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { useQuery } from '@tanstack/react-query';
import {
  repositories,
  type ExecutiveDashboard, type PMDashboardProject, type WinRate, type SalesPipeline,
  type PipelineProject, type BudgetReviewRow, type ProjectWithRefs, type ProjectStatus,
} from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { ON_HAND_STATUSES } from '@/src/lib/db/projectTransitions';

/** Org-scoped executive dashboard aggregates. queryKey includes org_id so cache is tenant-scoped
 * (FR-QRY-DASH-001). Aggregates are computed in SQL (RPC) and RLS-scoped to the caller's org. */
export function usePMDashboardProjects() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<PMDashboardProject[]>({
    queryKey: ['pm-dashboard-projects', orgId, currentUser?.id],
    queryFn: () => repositories.dashboard.pmProjects(),
    enabled: Boolean(orgId && currentUser?.id),
  });
}

export function useDashboard() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ExecutiveDashboard>({
    queryKey: ['dashboard', orgId],
    queryFn: () => repositories.dashboard.executive(),
    enabled: Boolean(orgId),
  });
}

/**
 * Range descriptor for useWinRate. `key` is a stable string that identifies the period so
 * the TanStack queryKey changes when the period changes (ADR-0014 DD-1: independent cache key).
 */
export interface WinRateRange {
  from?: Date;
  to?: Date;
  /** Stable string key distinguishing the period ('all' | 'ytd' | 'q' | 't12'). */
  key: string;
}

/**
 * Win-rate for the caller's org over the given period range (FR-SPD-011).
 * queryKey is ['win-rate', orgId, range.key] — changing the period only invalidates this query,
 * not the heavy dashboard query (ADR-0014 DD-1).
 */
export function useWinRate(range: WinRateRange) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<WinRate>({
    queryKey: ['win-rate', orgId, range.key],
    queryFn: () => repositories.dashboard.winRate(range.from, range.to),
    enabled: Boolean(orgId),
  });
}

/**
 * Sales pipeline stages + flat project list for the caller's org (FR-SPD-011).
 * queryKey includes org_id for cache isolation.
 */
export function useSalesPipeline(opts?: { enabled?: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<SalesPipeline>({
    queryKey: ['sales-pipeline', orgId],
    queryFn: () => repositories.dashboard.salesPipeline(),
    enabled: Boolean(orgId) && opts?.enabled !== false,
  });
}

/** Keep terminal rows aligned with the pipeline RPC projection when they come from the project DAL. */
function toPipelineProject(row: ProjectWithRefs, winProbability: number): PipelineProject {
  return {
    service_line: row.service_line,
    sector: row.sector,
    location: row.location,
    award_type: row.award_type,
    bidding_entity: row.bidding_entity,
    id: row.id,
    name: row.name,
    short_name: row.short_name,
    pmo_project_number: row.pmo_project_number,
    code: row.code,
    client_name: row.client ? companyDisplayName(row.client) : null,
    client_legal_name: row.client?.name ?? null,
    status: row.status,
    contract_value: row.contract_value,
    currency: row.currency,
    tax_treatment: row.tax_treatment,
    tax_rate: row.tax_rate,
    tax_base_numerator: row.tax_base_numerator,
    tax_base_denominator: row.tax_base_denominator,
    win_probability: winProbability,
    end_client_id: row.end_client_id,
    end_client_name: row.end_client ? companyDisplayName(row.end_client) : null,
    end_client_legal_name: row.end_client?.name ?? null,
    last_update: row.last_update,
    pm_name: row.pm?.full_name ?? null,
  };
}

/**
 * Portfolio-wide budget review (OD-E): ALL budget>0 projects ranked by variance desc on the
 * OD-BUDGET-2 committed-spent basis. Bypasses the `repositories` object for parity with
 * useDashboard/useSalesPipeline (the dashboard aggregation reads call the DAL directly — the
 * repository seam is for entity CRUD). queryKey includes org_id for cache isolation.
 * Consumed by the N17 Budget review card.
 */
export function useFinanceBudgetReview() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<BudgetReviewRow[]>({
    queryKey: ['finance-budget-review', orgId],
    queryFn: () => repositories.dashboard.financeBudgetReview(),
    enabled: Boolean(orgId),
  });
}

/**
 * Lost (Loss Tender) deals for the caller's org, projected to the `PipelineProject` shape so the
 * Sales Pipeline can show them in its terminal "Lost" column + behind the "Lost" table filter
 * (AC-IXD-PROJ-007, Model B). FE-only: `get_sales_pipeline()` returns ONLY the five open stages,
 * so lost deals are read via the existing `projects` RLS path (listProjects with the status
 * override) — no RPC contract change. A lost deal carries no live win probability (0).
 */
export function useLostDeals() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<PipelineProject[]>({
    queryKey: ['lost-deals', orgId],
    queryFn: async () => {
      // 'Declined' is a terminal pre-award outcome that lives in the same Lost column/scope (#774).
      const rows = [...(await repositories.project.list({ statuses: ['Loss Tender', 'Declined'] }))];
      rows.sort((a, b) => (b.last_update ?? '').localeCompare(a.last_update ?? '')); // most recent first
      return rows.map((row) => toPipelineProject(row, 0));
    },
    enabled: Boolean(orgId),
  });
}

/**
 * On-hand projects that represent won bids, read through the same RLS-backed project repository
 * used for the terminal Lost column. The win-rate RPC supplies aggregate outcomes; this read makes
 * the existing Won pipeline column actionable and links each card to its canonical project page.
 */
export function useWonDeals() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<PipelineProject[]>({
    queryKey: ['won-deals', orgId],
    queryFn: async () => {
      const rows = [
        ...(await repositories.project.list({
          statuses: [...ON_HAND_STATUSES] as ProjectStatus[],
        })),
      ];
      rows.sort((a, b) => (b.last_update ?? '').localeCompare(a.last_update ?? ''));
      return rows.map((row) => toPipelineProject(row, 1));
    },
    enabled: Boolean(orgId),
  });
}
