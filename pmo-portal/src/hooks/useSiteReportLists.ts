import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type { DsrListKind } from '@/src/lib/db/dailySiteReports';
import { dsrKeys } from './useDailySiteReports';

/** #2621: the Admin's view of the site report idle-reason and weather lists (archived items included). */
export function useSiteReportList(kind: DsrListKind) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: dsrKeys.lookups(orgId, 'admin-list', kind),
    queryFn: () => repositories.dailySiteReport.listListItems(kind),
    enabled: Boolean(orgId),
  });
}

export function useSiteReportListMutations(kind: DsrListKind) {
  const orgId = useAuth().currentUser?.org_id;
  const qc = useQueryClient();
  // The report pickers read the same tables: refresh the whole site report family.
  const onSuccess = () => qc.invalidateQueries({ queryKey: dsrKeys.root(orgId) });
  const repo = () => repositories.dailySiteReport;
  return {
    add: useMutation({ mutationFn: (label: string) => repo().addListItem(kind, label), onSuccess }),
    rename: useMutation({ mutationFn: (v: { id: string; label: string }) => repo().renameListItem(kind, v.id, v.label), onSuccess }),
    archive: useMutation({ mutationFn: (v: { id: string; archived: boolean }) => repo().setListItemArchived(kind, v.id, v.archived), onSuccess }),
  };
}
