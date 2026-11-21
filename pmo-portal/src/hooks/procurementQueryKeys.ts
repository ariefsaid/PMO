import type { QueryClient } from '@tanstack/react-query';

export const procurementKeys = {
  all: (orgId: string | undefined) => ['procurements', orgId] as const,
  byVendor: (orgId: string | undefined, vendorId: string | undefined) => ['procurements', orgId, 'by-vendor', vendorId] as const,
};

/** The detail-page query prefix (the read hook appends user + role). */
export const procurementDetailKey = (orgId: string | undefined, id: string | undefined) =>
  ['procurement', orgId, id] as const;

/** The project a cached detail currently shows, so a project change can refresh the old project too. */
export function cachedProcurementProjectId(qc: QueryClient, orgId: string | undefined, id: string): string | null {
  for (const [, data] of qc.getQueriesData<{ project_id?: string | null }>({ queryKey: procurementDetailKey(orgId, id) })) {
    if (data?.project_id) return data.project_id;
  }
  return null;
}

/**
 * One refresh for a case change made on the detail page: the detail, the Procurement list family and the
 * committed / reserved spend of every project the case touched (pass both old and new on a project change), and
 * the budget positions behind "Left after this purchase" (its recorded spending moves with a payment).
 */
export function invalidateProcurementCase(
  qc: QueryClient,
  orgId: string | undefined,
  id: string,
  projectIds: ReadonlyArray<string | null | undefined> = [],
) {
  qc.invalidateQueries({ queryKey: procurementDetailKey(orgId, id) });
  qc.invalidateQueries({ queryKey: procurementKeys.all(orgId) });
  const touched = new Set(projectIds.filter((p): p is string => Boolean(p)));
  for (const projectId of touched) {
    qc.invalidateQueries({ queryKey: ['project-committed-spend', orgId, projectId] });
    qc.invalidateQueries({ queryKey: ['project-reserved-spend', orgId, projectId] });
  }
  // Prefix: the key's last part is the sorted id list of whichever screen asked.
  if (touched.size > 0) qc.invalidateQueries({ queryKey: ['project-budget-positions', orgId] });
}
