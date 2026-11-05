import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';

/** One typed row read from outbox_reconcile_candidates and shared by this tick's Odoo recovery passes. */
export interface OdooOutboxRecoveryCandidate {
  row: OutboxRow;
  externalTier: string;
  operation: string;
  payload: Record<string, unknown> | null;
  updatedAt: string;
}

export function parseOdooOutboxRecoveryCandidates(data: unknown): OdooOutboxRecoveryCandidate[] {
  return ((data as Array<Record<string, unknown>> | null) ?? []).map((raw) => ({
    row: {
      id: String(raw.id), domain: String(raw.domain), pmoRecordId: String(raw.pmo_record_id), idempotencyKey: String(raw.idempotency_key),
      state: raw.state as OutboxRow['state'], externalRecordId: (raw.external_record_id as string | null) ?? null,
      canonical: (raw.canonical as PmoRecord | null) ?? null, claimGeneration: Number(raw.claim_generation ?? 0),
      payloadDigest: (raw.payload_digest as string | null) ?? null,
    },
    externalTier: String(raw.external_tier), operation: String(raw.operation),
    payload: (raw.payload as Record<string, unknown> | null) ?? null, updatedAt: String(raw.updated_at ?? ''),
  }));
}
