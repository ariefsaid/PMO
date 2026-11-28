import { workOrderBillingQuery } from './useWorkOrderBilling';

export const projectPlanVsActualQuery = (orgId: string | undefined, projectId: string, enabled = true) => ({
  queryKey: ['work-order-plan-vs-actual', orgId, projectId],
  // The project's billing is the page's own billing read (one key), so a page that also shows it asks the database once.
  queryFn: ({ client }: { client: import('@tanstack/react-query').QueryClient }) => import('../repositories/workOrderFinance').then(({ workOrderFinanceRepository }) =>
    workOrderFinanceRepository.projectPlanVsActual(projectId, () => client.fetchQuery(workOrderBillingQuery(orgId, projectId)))),
  enabled: enabled && Boolean(orgId) && Boolean(projectId),
});
