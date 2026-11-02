import type { QueryClient } from '@tanstack/react-query';

export const projectKeys = {
  all: (orgId: string | undefined) => ['projects', orgId] as const,
  byClient: (orgId: string | undefined, clientId: string | undefined) => ['projects', orgId, 'by-client', clientId] as const,
  milestoneDates: (orgId: string | undefined, ids?: string[]) => ids ? ['milestone-dates', orgId, [...ids].sort()] as const : ['milestone-dates', orgId] as const,
};

export function invalidateProjectProjections(qc: QueryClient, orgId: string | undefined) {
  if (!orgId) return;
  void qc.invalidateQueries({ queryKey: projectKeys.all(orgId) });
  for (const root of ['project', 'opportunity', 'sales-pipeline', 'lost-deals', 'won-deals', 'win-rate', 'loss-breakdown', 'dashboard', 'pm-dashboard-projects', 'finance-budget-review', 'project-identity', 'project-stage-entries']) {
    void qc.invalidateQueries({ queryKey: [root, orgId] });
  }
}
