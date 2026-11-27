import { repositories } from '../repositories';

export const workOrderAllocationsQuery = (orgId: string | undefined, id: string | undefined) => ({
  queryKey: ['work-order-lines', orgId, 'wo', id],
  queryFn: () => repositories.workOrderAcceptance.listLines(id as string),
  enabled: Boolean(orgId) && Boolean(id),
});

export const workOrderQuery = (orgId: string | undefined, id: string | undefined) => ({
  queryKey: ['work-order', orgId, id],
  queryFn: () => repositories.workOrder.get(id as string),
  enabled: Boolean(orgId) && Boolean(id),
});
