import { useQuery } from '@tanstack/react-query';
import { projectRepository } from '@/src/lib/repositories/projects';
import { useAuth } from '@/src/auth/useAuth';

/**
 * VAT-editability read for the contract-value editor (AC-PPNC-013). AC-PERF-001 (plan Step 1a):
 * `enabled` defaults to true for compatibility, but the header passes its `valueEditing` flag so
 * the read fires only when the editor OPENS — never on mount. `refetch()` still ignores `enabled`,
 * so the begin-edit path (ProjectDetailHeader `beginValueEdit`) and the stale-save refresh are
 * unchanged.
 */
export function useProjectVatEditability(projectId: string, enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['project-vat-editability', orgId, projectId],
    queryFn: () => projectRepository.getVatEditability(projectId),
    enabled: enabled && Boolean(orgId && projectId),
  });
}
