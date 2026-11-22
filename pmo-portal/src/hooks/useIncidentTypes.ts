import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';

const key = (orgId: string | undefined) => ['incident-types', orgId] as const;

/** The organisation's issue types (archived included; callers filter). Tenant-scoped cache key (ADR-0017). */
export function useIncidentTypes() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: key(orgId),
    queryFn: () => repositories.incidentType.list(),
    enabled: Boolean(orgId),
  });
}

export function useIncidentTypeMutations() {
  const orgId = useAuth().currentUser?.org_id;
  const qc = useQueryClient();
  // A rename carries to issues and department groups in the database: refresh the register and the report too.
  const onSuccess = () => Promise.all([
    qc.invalidateQueries({ queryKey: key(orgId) }),
    qc.invalidateQueries({ queryKey: ['incidents'] }),
    qc.invalidateQueries({ queryKey: ['issue-closing-time-report'] }),
    qc.invalidateQueries({ queryKey: ['issue-department-groups'] }),
  ]);
  return {
    add: useMutation({ mutationFn: (label: string) => repositories.incidentType.add(label), onSuccess }),
    rename: useMutation({ mutationFn: (v: { id: string; label: string }) => repositories.incidentType.rename(v.id, v.label), onSuccess }),
    archive: useMutation({ mutationFn: (v: { id: string; archived: boolean }) => repositories.incidentType.setArchived(v.id, v.archived), onSuccess }),
  };
}
