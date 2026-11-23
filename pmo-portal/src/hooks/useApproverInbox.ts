import { useMutation, useQueryClient } from '@tanstack/react-query';
import { materialRequestRepository as repo } from '@/src/lib/repositories/materialRequests';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import { MATERIAL_REQUEST_QUERY_ROOT } from '@/src/hooks/useMaterialRequests';

/**
 * #2685 FR-MRI-001/009: the organisation's "material request approvals appear in the approvals inbox" setting.
 * `enabled` gates the read so a screen that cannot use the feature never asks (default-off: no extra request).
 */
export function useApproverInboxSetting(enabled = true) {
  return useOrgQuery([MATERIAL_REQUEST_QUERY_ROOT, 'approver-inbox'], () => repo.approverInbox(), { enabled });
}

export function useSetApproverInbox() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (on: boolean) => repo.setApproverInbox(on),
    onSuccess: () => qc.invalidateQueries({ queryKey: [MATERIAL_REQUEST_QUERY_ROOT, orgId] }),
  });
}
