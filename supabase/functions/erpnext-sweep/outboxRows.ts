// The ONE outbox-row projection and mapper the sweep's recovery passes share (THEME-BACK-40): the keyed
// lookup used by the budget, timesheet and expense passes, and the reconcile-candidate listing.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

const OUTBOX_ROW_COLUMNS = 'id, domain, pmo_record_id, idempotency_key, state, external_record_id, canonical, claim_generation, payload_digest';

/** snake_case outbox record (table row or `outbox_reconcile_candidates` RPC row) -> `OutboxRow`. */
export function outboxRowOf(r: Record<string, unknown>): OutboxRow {
  return {
    id: String(r.id),
    domain: String(r.domain),
    pmoRecordId: String(r.pmo_record_id),
    idempotencyKey: String(r.idempotency_key),
    state: r.state as OutboxRow['state'],
    externalRecordId: (r.external_record_id as string | null) ?? null,
    canonical: (r.canonical as OutboxRow['canonical']) ?? null,
    claimGeneration: (r.claim_generation as number | undefined) ?? 0,
    payloadDigest: (r.payload_digest as string | null | undefined) ?? null,
  };
}

/** The EXISTING `external_command_outbox` row for a (domain, record, deterministic key), if any — shared by the
 *  budget, timesheet and expense passes, whose keys are re-derived identically every tick. */
export async function findOutboxRowByKey(
  serviceClient: SupabaseClient,
  orgId: string,
  domain: string,
  pmoRecordId: string,
  idempotencyKey: string,
): Promise<OutboxRow | null> {
  const { data, error } = await serviceClient
    .from('external_command_outbox')
    .select(OUTBOX_ROW_COLUMNS)
    .eq('org_id', orgId)
    .eq('domain', domain)
    .eq('pmo_record_id', pmoRecordId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  return data ? outboxRowOf(data as Record<string, unknown>) : null;
}
