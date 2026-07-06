/**
 * historicalImportResolve.mjs — reference-resolution (FR-HIST-012) + provenance
 * event-builder (FR-HIST-013) pure helpers. findFn/createFn are injected so this stays
 * DB-free and unit-testable; import-historical.mjs supplies the real Supabase-service-role
 * implementations.
 */

export async function resolveOrCreateStub(name, { findFn, createFn }) {
  const existing = await findFn(name);
  if (existing) return { id: existing.id, action: 'found' };
  const created = await createFn(name);
  return { id: created.id, action: 'created' };
}

/**
 * Builds the single, honest provenance row (FR-HIST-013, --mark-provenance opt-in).
 * org_id is ALWAYS the explicit target org — never the procurement_status_events column's
 * demo-org default (migration 0038: default '00000000-0000-0000-0000-000000000001').
 */
export function buildProvenanceEvent({ procurementId, orgId, terminalStatus, importBatchId, importDate }) {
  return {
    procurement_id: procurementId,
    org_id: orgId,
    from_status: null,
    to_status: terminalStatus,
    actor_id: null,
    notes: `Historical import: terminal status ${terminalStatus} (batch ${importBatchId}, ${importDate})`,
  };
}
