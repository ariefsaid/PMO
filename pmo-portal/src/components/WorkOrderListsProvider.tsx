import React, { useMemo } from 'react';
import { WorkOrderListsContext, useWorkOrderListEntries, type WorkOrderLists } from '@/src/hooks/useWorkOrderLists';

const LoadedProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const areaQuery = useWorkOrderListEntries('area');
  const groupQuery = useWorkOrderListEntries('group');
  const value = useMemo<WorkOrderLists>(() => {
    const areas = areaQuery.data ?? [];
    const groups = groupQuery.data ?? [];
    const liveAreas = areas.filter((e) => !e.archived_at);
    const liveGroups = groups.filter((e) => !e.archived_at);
    return { areas, groups, liveAreas, liveGroups, hasLists: liveAreas.length > 0 || liveGroups.length > 0 };
  }, [areaQuery.data, groupQuery.data]);
  return <WorkOrderListsContext.Provider value={value}>{children}</WorkOrderListsContext.Provider>;
};

/**
 * #2668: loads the organisation's lists for everything below it. While the read runs it provides the empty value, so a
 * screen renders exactly as it did before the lists existed.
 */
export const WorkOrderListsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LoadedProvider>{children}</LoadedProvider>
);
