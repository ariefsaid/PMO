import { useProjectWorkOrders } from './useWorkOrders';

/** A work order is open for new cost until it is closed or cancelled. */
export const isOpenWorkOrder = (status: string): boolean => status !== 'Cancelled' && status !== 'Closed';

/**
 * The project's only open work order, or null when there is none or several. A cost form starts on it, so cost lands
 * on the work order a person means without a pick; with several the person chooses. The choice stays theirs to change.
 */
export function useSoleWorkOrder(projectId: string | null | undefined): string | null {
  const q = useProjectWorkOrders(projectId ?? '');
  const open = (q.data ?? []).filter((wo) => isOpenWorkOrder(wo.status));
  return open.length === 1 ? open[0].id : null;
}
