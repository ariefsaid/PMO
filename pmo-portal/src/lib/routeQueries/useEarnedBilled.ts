
export const workOrderEarnedBilledQuery = (orgId: string | undefined, projectId: string, enabled = true) => ({
  queryKey: ['earned-billed', orgId, projectId],
  queryFn: () => import('../repositories/earnedBilled').then(({ earnedBilledRepository }) => earnedBilledRepository.workOrders(projectId)),
  enabled: enabled && Boolean(orgId) && Boolean(projectId),
});
