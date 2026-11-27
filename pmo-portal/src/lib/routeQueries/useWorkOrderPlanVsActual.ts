
export const projectPlanVsActualQuery = (orgId: string | undefined, projectId: string, enabled = true) => ({
  queryKey: ['work-order-plan-vs-actual', orgId, projectId],
  queryFn: () => import('../repositories/workOrderFinance').then(({ workOrderFinanceRepository }) => workOrderFinanceRepository.projectPlanVsActual(projectId)),
  enabled: enabled && Boolean(orgId) && Boolean(projectId),
});
