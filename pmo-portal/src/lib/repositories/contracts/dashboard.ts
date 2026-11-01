/** Dashboard read contract (FR-QRY-DASH-001): SQL-computed aggregates, RLS-scoped to the caller's org. */
import type {
  ExecutiveDashboard,
  PMDashboardProject,
  WinRate,
  SalesPipeline,
  BudgetReviewRow,
} from '@/src/lib/db/dashboard';

export interface DashboardRepository {
  executive(): Promise<ExecutiveDashboard>;
  pmProjects(): Promise<PMDashboardProject[]>;
  /** Win rate over an optional [from, to] period (FR-SPD-011). */
  winRate(from?: Date, to?: Date): Promise<WinRate>;
  salesPipeline(): Promise<SalesPipeline>;
  financeBudgetReview(): Promise<BudgetReviewRow[]>;
}
