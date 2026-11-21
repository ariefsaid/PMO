import { useContext } from 'react';
import { QueryClientContext, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { materialRequestRepository as repo } from '@/src/lib/repositories/materialRequests';
import { useOrgId } from '@/src/hooks/useOrgId';
import { MATERIAL_REQUEST_QUERY_ROOT, useWaitingForMe } from '@/src/hooks/useMaterialRequests';
import type { WaitingStep } from '@/src/lib/repositories/materialRequests';

/**
 * #2685 FR-MRI-001/009: the organisation's "material request approvals appear in the approvals inbox" setting.
 * `enabled` gates the read so a screen that cannot use the feature never asks (default-off: no extra request).
 */
export function useApproverInboxSetting(enabled = true) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: [MATERIAL_REQUEST_QUERY_ROOT, orgId, 'approver-inbox'],
    queryFn: () => repo.approverInbox(),
    enabled: enabled && Boolean(orgId),
  });
}

export function useSetApproverInbox() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (on: boolean) => repo.setApproverInbox(on),
    onSuccess: () => qc.invalidateQueries({ queryKey: [MATERIAL_REQUEST_QUERY_ROOT, orgId] }),
  });
}

export interface MaterialInbox {
  /** The organisation's setting reads true. False while unknown, failed, or when there is no query client. */
  on: boolean;
  data: WaitingStep[] | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}
const INBOX_OFF: MaterialInbox = { on: false, data: undefined, isPending: false, isError: false, refetch: () => undefined };

function useLiveMaterialInbox(): MaterialInbox {
  const on = useApproverInboxSetting().data === true;
  const q = useWaitingForMe(on);
  return on ? { on, data: q.data, isPending: q.isPending, isError: q.isError, refetch: q.refetch } : INBOX_OFF;
}

/**
 * #2685: the setting plus the viewer's waiting steps for /approvals. Without a query client (a bare render) it is OFF and
 * requests nothing, so the page is exactly as before. The client's presence never changes within a mount, so the hook order is stable.
 */
export function useMaterialInbox(): MaterialInbox {
  const client = useContext(QueryClientContext);
  // eslint-disable-next-line react-hooks/rules-of-hooks -- the client is fixed for the life of the tree
  return client ? useLiveMaterialInbox() : INBOX_OFF;
}
