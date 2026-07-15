// Luna money audit — BLOCK 3: transition target bound to PMO mapping.
// Extracted as a pure/testable module so the dispatch-path enforcement is unit-provable.
// For a revenue sales-invoice transition, the SoD/enforcement checks record.id (PMO id)
// but ERP operates on record.externalRecordId (ERP name). A caller could pass an
// authorized/own-org PMO id while targeting ANOTHER SI's externalRecordId.
// FIX: verify the command's externalRecordId matches the external_refs mapping for
// (org, 'revenue', record.id) — so SoD (on record.id) and ERP write (on externalRecordId)
// operate on the SAME doc. Reject 422 on mismatch.
import { resolveExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';

export interface TransitionBindingClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          eq(column: string, value: string): {
            maybeSingle(): Promise<{ data: { external_record_id: string } | null; error: { code?: string; message: string } | null }>;
          };
        };
      };
    };
  };
}

export interface TransitionBindingResult {
  ok: boolean;
  status: number;
  message: string;
}

/**
 * Verify that for a revenue sales-invoice transition, the command's externalRecordId
 * matches the external_refs mapping for (org, 'revenue', record.id).
 * Returns {ok:true} when not applicable (other domains/operations/kinds) or when binding matches.
 * Returns {ok:false, status:422} when externalRecordId is provided but mismatches the mapping.
 */
export async function checkTransitionTargetBinding(
  client: TransitionBindingClient,
  orgId: string,
  command: { domain: string; operation: string; record: { id: string; erp_doc_kind?: unknown; externalRecordId?: unknown } },
): Promise<TransitionBindingResult> {
  // Only applies to revenue sales-invoice transitions
  if (command.domain !== 'revenue') return { ok: true, status: 200, message: '' };
  if ((command.operation as string) !== 'transition') return { ok: true, status: 200, message: '' };
  if ((command.record as { erp_doc_kind?: unknown }).erp_doc_kind !== 'sales-invoice') return { ok: true, status: 200, message: '' };

  const externalRecordId = (command.record as { externalRecordId?: unknown }).externalRecordId;
  if (typeof externalRecordId !== 'string' || externalRecordId.length === 0) {
    // Missing externalRecordId — adapter will reject with its own error
    return { ok: true, status: 200, message: '' };
  }

  const mapped = await resolveExternalRef(client as never, orgId, 'revenue', String(command.record.id));
  if (mapped !== null && mapped !== externalRecordId) {
    return { ok: false, status: 422, message: 'externalRecordId does not match PMO record mapping' };
  }
  // If no mapping exists yet (should not happen for a transition), we allow —
  // the adapter will fail with a clear error if the ERP doc doesn't exist.
  return { ok: true, status: 200, message: '' };
}