import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { buildManagementPack, type ManagementPack } from '@/src/lib/reports/managementPack';
import type { ManagementPackFacts, ManagementPackRange, ProjectProgressInput } from '@/src/lib/db/managementPack';

/** #765: the management pack for a window (org-scoped cache key; never threads org_id to the server). */
export function useManagementPack(range: ManagementPackRange) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ManagementPackFacts, Error, ManagementPack>({
    queryKey: ['managementPack', orgId, range.from ?? 'default', range.to ?? 'default'],
    queryFn: () => repositories.reports.managementPack(range),
    select: buildManagementPack,
    enabled: Boolean(orgId),
  });
}

/** #765: record a month-end percent complete; every cached pack window is refreshed on success. */
export function useRecordProjectProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectProgressInput) => repositories.reports.recordProgress(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['managementPack'] }),
  });
}
