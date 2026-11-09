import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { erpJournalLinesRepository } from '@/src/lib/repositories/erpJournalLines';
import type { ErpJournalAttachRow } from '@/src/lib/repositories/erpJournalLines';
import { procurementKeys } from './procurementQueryKeys';

/** FR-JEC-001 — a project's journal cost lines (ERP-purchase audience; the RPC returns none to other roles). */
export function useProjectJournalLines(projectId: string | null | undefined, opts?: { enabled?: boolean }) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['erp-journal-lines', orgId, projectId],
    queryFn: () => erpJournalLinesRepository.listProject(projectId as string),
    enabled: Boolean(orgId && projectId) && opts?.enabled !== false,
  });
}

/** FR-JEC-016 — the lines attached to one purchase (one RPC read of the purchase's project). */
export function usePurchaseJournalLines(procurementId: string | null | undefined, projectId: string | null | undefined, opts?: { enabled?: boolean }) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['erp-journal-lines', orgId, projectId, 'purchase', procurementId],
    queryFn: () => erpJournalLinesRepository.listForPurchase(procurementId as string, projectId as string),
    enabled: Boolean(orgId && procurementId && projectId) && opts?.enabled !== false,
  });
}

/** Attach / detach move the lists, the purchase's open commitment and the project's committed spend. */
function useInvalidateJournal() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  return () => Promise.all(
    ['erp-journal-lines', 'procurement', 'project-committed-spend']
      .map((root) => qc.invalidateQueries({ queryKey: [root, orgId] }))
      .concat(qc.invalidateQueries({ queryKey: procurementKeys.all(orgId) })),
  );
}

/** FR-JEC-013 — a dry run changes nothing, so it refreshes nothing. */
export function useAttachJournalLines() {
  const invalidate = useInvalidateJournal();
  return useMutation({
    mutationFn: (args: { rows: ErpJournalAttachRow[]; dryRun?: boolean }) => erpJournalLinesRepository.attach(args.rows, args.dryRun),
    onSuccess: (res) => { if (!res.dry_run) void invalidate(); },
  });
}

/** FR-JEC-014 — Admin/Finance; the RPC is the authority. */
export function useDetachJournalLine() {
  const invalidate = useInvalidateJournal();
  return useMutation({
    mutationFn: (linkId: string) => erpJournalLinesRepository.detach(linkId),
    onSuccess: () => { void invalidate(); },
  });
}
