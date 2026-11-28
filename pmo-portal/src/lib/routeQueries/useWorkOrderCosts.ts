
export const costDisciplinesQuery = (orgId: string | undefined, enabled = true) => ({
  queryKey: ['cost-disciplines', orgId],
  queryFn: () => import('../repositories/workOrderCosts').then(({ workOrderCostRepository }) => workOrderCostRepository.disciplines()),
  enabled: enabled && Boolean(orgId),
  staleTime: 5 * 60 * 1000,
});

export const workOrderCostLinesQuery = (orgId: string | undefined, workOrderId: string | null, enabled = true) => ({
  queryKey: ['work-order-cost-lines', orgId, workOrderId],
  queryFn: () => import('../repositories/workOrderCosts').then(({ workOrderCostRepository }) => workOrderCostRepository.costLinesBySource(workOrderId as string)),
  enabled: enabled && Boolean(orgId) && Boolean(workOrderId),
});
