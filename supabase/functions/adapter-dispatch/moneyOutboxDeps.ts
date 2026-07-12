/**
 * Task 6.4 (ADR-0057 §4) — the DB-backed `DispatchMoneyOutboxDeps` implementation. Tier-agnostic (no
 * ERPNext vocabulary — the outbox itself, `external_command_outbox` 0095, is a generic money-dispatch
 * concern any future money tier could reuse), so this lives alongside `readModelWriters.ts`, not under
 * `erpnext/**`. Wraps the `external_command_outbox` table + its two SECURITY DEFINER RPCs
 * (`claim_outbox_for_commit`/`quarantine_committing`) behind the pure `DispatchMoneyOutboxDeps`
 * interface `dispatch.ts`'s `dispatchMoneyWrite` consumes — every write-back is the SAME guarded
 * `WHERE id = $1 AND claim_generation = $token` shape the fencing-token contract requires (F4).
 *
 * `probeByRemarksKey` and `backoff` are NOT built here — the probe is tier-specific (ERPNext's
 * `remarks` stamp; a future tier's own anchor) and the production backoff delay is a policy choice —
 * both are injected by the caller (`index.ts`) into the returned deps object.
 *
 * Integration-only (like `index.ts`/`readModelWriters.ts`): not unit-tested through Vitest, verified by
 * `deno check` + `deno test moneyOutboxDeps.test.ts` against a structural fake client.
 */
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { DispatchMoneyOutboxDeps, OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

/** Structural service-role client seam this module needs: `.from(t).{select,insert,update}` +
 *  `.rpc(fn,args)`. The real supabase-js client satisfies this at runtime but is not nominally
 *  assignable (thenable `PostgrestFilterBuilder`) — callers cast `as never` at the boundary, matching
 *  `index.ts`'s existing cast idiom. */
export interface OutboxServiceClient {
  from(table: string): OutboxTableClient;
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}
export interface OutboxTableClient {
  select(columns: string): OutboxSelectChain;
  insert(row: unknown): OutboxInsertChain;
  update(patch: unknown): OutboxUpdateChain;
}
export interface OutboxSelectChain extends PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  eq(column: string, value: string): OutboxSelectChain;
  maybeSingle(): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}
export interface OutboxInsertChain {
  select(columns: string): { single(): Promise<{ data: unknown; error: { message: string; code?: string } | null }> };
}
export interface OutboxUpdateChain {
  eq(column: string, value: string): OutboxUpdateChain;
  select(columns: string): Promise<{ data: unknown[] | null; error: { message: string; code?: string } | null }>;
}

interface OutboxDbRow {
  id: string;
  domain: string;
  pmo_record_id: string;
  idempotency_key: string;
  state: OutboxRow['state'];
  external_record_id: string | null;
  canonical: PmoRecord | null;
  claim_generation: number;
}

function mapRow(row: OutboxDbRow): OutboxRow {
  return {
    id: row.id,
    domain: row.domain,
    pmoRecordId: row.pmo_record_id,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    externalRecordId: row.external_record_id,
    canonical: row.canonical,
    claimGeneration: row.claim_generation,
  };
}

/** RPC helper: `claim_outbox_for_commit`/`quarantine_committing` both return a single composite row or
 *  `NULL` (not-claimable-now) — never a Postgrest error for the "not claimable" case. A real error
 *  (connectivity, bad grant) throws. */
async function callRowRpc(client: OutboxServiceClient, fn: string, id: string): Promise<OutboxRow | null> {
  const { data, error } = await client.rpc(fn, { p_id: id });
  if (error) throw new AppError(error.message, error.code);
  if (!data) return null;
  return mapRow(data as OutboxDbRow);
}

const defaultBackoff = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 250));

export interface DbMoneyOutboxDepsOpts {
  serviceClient: OutboxServiceClient;
  orgId: string;
  externalTier: string;
  /** The command's operation ('create'|'update'|'transition') — the outbox row's `operation` column
   *  (0095 NOT NULL) is fixed for the lifetime of one command's outbox row, so it is closed over here
   *  rather than threaded through every `DispatchMoneyOutboxDeps` method signature. */
  operation: 'create' | 'update' | 'transition';
  /** Tier-specific recovery probe (ERPNext's `remarks`-key anchor, ADR-0057 §3) — injected, not built
   *  here (this module is tier-agnostic). */
  probeByRemarksKey: DispatchMoneyOutboxDeps['probeByRemarksKey'];
  /** Production backoff delay before re-reading a fresh (live-owned) `committing` row. Defaults to a
   *  small real delay; tests inject an instant/fast one. */
  backoff?: () => Promise<void>;
}

/** Builds the DB-backed `DispatchMoneyOutboxDeps` for ONE request's org/tier/operation. */
export function createDbMoneyOutboxDeps(opts: DbMoneyOutboxDepsOpts): DispatchMoneyOutboxDeps {
  const { serviceClient, orgId, externalTier, operation } = opts;

  return {
    async readOutbox(domain, pmoRecordId, idempotencyKey) {
      const { data, error } = await serviceClient
        .from('external_command_outbox')
        .select('*')
        .eq('org_id', orgId)
        .eq('domain', domain)
        .eq('pmo_record_id', pmoRecordId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (error) throw new AppError(error.message, error.code);
      return data ? mapRow(data as OutboxDbRow) : null;
    },

    async insertOutboxPending(domain, pmoRecordId, idempotencyKey) {
      const { data, error } = await serviceClient
        .from('external_command_outbox')
        .insert({
          org_id: orgId,
          domain,
          pmo_record_id: pmoRecordId,
          idempotency_key: idempotencyKey,
          external_tier: externalTier,
          operation,
          state: 'pending',
        })
        .select('*')
        .single();
      if (error) {
        // Preserve the raw pg error code (23505 = the unique 4-tuple race) — dispatch.ts's
        // dispatchMoneyWrite branches on `(error as { code?: string }).code`.
        const err = new Error(error.message) as Error & { code?: string };
        err.code = error.code;
        throw err;
      }
      return mapRow(data as OutboxDbRow);
    },

    claimOutboxForCommit: (id) => callRowRpc(serviceClient, 'claim_outbox_for_commit', id),
    quarantineCommitting: (id) => callRowRpc(serviceClient, 'quarantine_committing', id),

    async markOutboxCommitted(id, externalRecordId, canonical, claimGeneration) {
      const { data, error } = await serviceClient
        .from('external_command_outbox')
        .update({ state: 'committed', external_record_id: externalRecordId, canonical })
        .eq('id', id)
        .eq('claim_generation', String(claimGeneration))
        .select('id');
      if (error) throw new AppError(error.message, error.code);
      return data?.length ?? 0;
    },

    async verifyClaimGeneration(id, claimGeneration) {
      const { data, error } = await serviceClient
        .from('external_command_outbox')
        .select('claim_generation')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new AppError(error.message, error.code);
      if (!data) return false;
      return (data as { claim_generation: number }).claim_generation === claimGeneration;
    },

    async markOutboxConfirmed(id, claimGeneration) {
      const { data, error } = await serviceClient
        .from('external_command_outbox')
        .update({ state: 'confirmed' })
        .eq('id', id)
        .eq('claim_generation', String(claimGeneration))
        .select('id');
      if (error) throw new AppError(error.message, error.code);
      return data?.length ?? 0;
    },

    async markOutboxFailed(id, lastError, claimGeneration) {
      const { data, error } = await serviceClient
        .from('external_command_outbox')
        .update({ state: 'failed', last_error: lastError })
        .eq('id', id)
        .eq('claim_generation', String(claimGeneration))
        .select('id');
      if (error) throw new AppError(error.message, error.code);
      return data?.length ?? 0;
    },

    probeByRemarksKey: opts.probeByRemarksKey,
    backoff: opts.backoff ?? defaultBackoff,
  };
}
