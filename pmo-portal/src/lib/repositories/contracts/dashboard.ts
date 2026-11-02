/** Dashboard read contract (FR-QRY-DASH-001): SQL-computed aggregates, RLS-scoped to the caller's org. */
import type {
  ExecutiveDashboard,
  PMDashboardProject,
  WinRate,
  LossBreakdown,
  SalesPipeline,
  BudgetReviewRow,
} from '@/src/lib/db/dashboard';

export interface DashboardRepository {
  executive(): Promise<ExecutiveDashboard>;
  pmProjects(): Promise<PMDashboardProject[]>;
  /** Win rate over an optional [from, to] period (FR-SPD-011). */
  winRate(from?: Date, to?: Date): Promise<WinRate>;
  /** Loss counts by reason and client over the same period (#1577). */
  lossBreakdown(from?: Date, to?: Date): Promise<LossBreakdown>;
  salesPipeline(): Promise<SalesPipeline>;
  financeBudgetReview(): Promise<BudgetReviewRow[]>;
}
