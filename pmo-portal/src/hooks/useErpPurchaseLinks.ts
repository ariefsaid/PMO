import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type { ErpLinkRow } from '@/src/lib/repositories/erpPurchases';

/** FR-PFE-032 — the ERPNext documents linked to one purchase. */
export function useLinkedErpDocuments(procurementId: string | null | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['linked-erp-documents', orgId, procurementId],
    queryFn: () => repositories.erpPurchases.listLinked(procurementId as string),
    enabled: Boolean(orgId && procurementId),
  });
}

/** Link / unlink move orphans, purchases (status is derived from linked documents), committed spend and linked lists. */
function useInvalidateLinks() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  return () => Promise.all(
    ['erp-purchases', 'erp-purchases-any', 'linked-erp-documents', 'procurements', 'procurement', 'project-committed-spend']
      .map((root) => qc.invalidateQueries({ queryKey: [root, orgId] })),
  );
}

/** FR-PFE-020/030 — a dry run changes nothing, so it refreshes nothing. */
export function useLinkErpDocuments() {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: (args: { rows: ErpLinkRow[]; dryRun?: boolean }) => repositories.erpPurchases.link(args.rows, args.dryRun),
    onSuccess: (res) => { if (!res.dry_run) void invalidate(); },
  });
}

/** FR-PFE-031 — Admin/Finance; the RPC is the authority. */
export function useUnlinkErpDocument() {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: (linkId: string) => repositories.erpPurchases.unlink(linkId),
    onSuccess: () => { void invalidate(); },
  });
}
