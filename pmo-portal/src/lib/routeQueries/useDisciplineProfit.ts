
export const disciplineRevenueQuery = (orgId: string | undefined, projectId: string, enabled = true) => ({
  queryKey: ['discipline-revenue', orgId, projectId],
  queryFn: () => import('../repositories/disciplineProfit').then(({ disciplineProfitRepository }) => disciplineProfitRepository.revenue(projectId)),
  enabled: enabled && Boolean(orgId) && Boolean(projectId),
});
