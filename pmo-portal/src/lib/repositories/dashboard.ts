/** Dashboard repository implementation. */
import {
  getExecutiveDashboard,
  getPMDashboardProjects,
  getWinRate,
  getSalesPipeline,
  getFinanceBudgetReview,
} from '@/src/lib/db/dashboard';
import { wrap } from './repositoryErrors';
import type { DashboardRepository } from './contracts/dashboard';

export const dashboardRepository: DashboardRepository = {
  executive: () => wrap(() => getExecutiveDashboard()),
  pmProjects: () => wrap(() => getPMDashboardProjects()),
  winRate: (from, to) => wrap(() => getWinRate(from, to)),
  salesPipeline: () => wrap(() => getSalesPipeline()),
  financeBudgetReview: () => wrap(() => getFinanceBudgetReview()),
};
