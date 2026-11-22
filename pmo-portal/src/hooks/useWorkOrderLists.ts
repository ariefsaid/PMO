import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { workOrderListRepository, type WorkOrderListEntry, type WorkOrderListKind } from '@/src/lib/repositories/workOrderLists';

export const WORK_ORDER_LISTS_KEY = 'work-order-lists';

/** The organisation's area or group entries (live and archived), #2668. */
export function useWorkOrderListEntries(kind: WorkOrderListKind, enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: [WORK_ORDER_LISTS_KEY, orgId, kind],
    queryFn: () => workOrderListRepository.list(kind),
    enabled: enabled && Boolean(orgId),
    staleTime: 5 * 60 * 1000,
  });
}

export interface WorkOrderLists {
  areas: WorkOrderListEntry[];
  groups: WorkOrderListEntry[];
  liveAreas: WorkOrderListEntry[];
  liveGroups: WorkOrderListEntry[];
  /** FR-WAG-005..007: at least one live area or group. While false every area/group surface stays out of the way. */
  hasLists: boolean;
}

export const EMPTY_WORK_ORDER_LISTS: WorkOrderLists = { areas: [], groups: [], liveAreas: [], liveGroups: [], hasLists: false };
export const WorkOrderListsContext = createContext<WorkOrderLists>(EMPTY_WORK_ORDER_LISTS);

/** Reads the lists the nearest provider loaded; empty (no lists) outside one or while loading. */
export const useWorkOrderLists = (): WorkOrderLists => useContext(WorkOrderListsContext);

