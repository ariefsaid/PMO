/**
 * Task 6.4 (ADR-0058 §4) — the DB-backed `DispatchMoneyOutboxDeps` implementation. Tier-agnostic (no
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
import type { DispatchMoneyOutboxDeps, ExternalRefMapping, OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
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
  payload_digest: string | null;
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
    payloadDigest: row.payload_digest ?? null,
  };
}

/** M-3 (audit): a stable canonical digest of the command's material payload — used to bind the
 *  idempotency key to its payload so key-reuse with a different amount/party/refs is rejected, not
 *  silently reconciled to the original. Sorted-key canonical JSON of the record (idempotencyKey itself
 *  excluded — it is the key, not the payload) + operation + domain, SHA-256 hex. */
export async function canonicalCommandDigest(command: { domain: string; operation: string; record: Record<string, unknown> }): Promise<string> {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
      return Object.keys(v as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = canonical((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
    }
    return v;
  };
  const material = JSON.stringify({ domain: command.domain, operation: command.operation, record: canonical(command.record) });
  const bytes = new TextEncoder().encode(material);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
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

/** RPC helper for the int-returning fenced write-backs (`finalize_outbox`/`mark_outbox_held`): they
 *  return the affected row count (1 = this caller owned+applied; 0 = superseded/not-applicable). */
async function callCountRpc(client: OutboxServiceClient, fn: string, args: Record<string, unknown>): Promise<number> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new AppError(error.message, error.code);
  return typeof data === 'number' ? data : Number(data ?? 0);
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
  /** Tier-specific recovery probe (ERPNext's anchor-key / PE composite probe, ADR-0058 §3) — injected,
   *  not built here (this module is tier-agnostic). */
  probeByRemarksKey: DispatchMoneyOutboxDeps['probeByRemarksKey'];
  /** C-1 per-kind reissue policy (ADR-0058 §4): `false` for a MUTABLE-anchor money doc (Payment Entry)
   *  whose post-window recovery no-hit must be HELD not reissued; `true` (default) for every
   *  immutable-/no-anchor kind (reissue-capable). Set by the ERPNext factory from the doctype. */
  reissueOnInconclusiveAbsence?: boolean;
  /** C-1 composite-probe payload persisted at INSERT (party_type/party/paid_amount/reference names +
   *  the claim-window basis) so the SWEEP recovery path can run the same deterministic probe as the
   *  sync retry path. `undefined` (every non-PE / pre-C-1 caller) ⇒ no payload column written. */
  payload?: Record<string, unknown>;
  /** M-3 (audit): the canonical digest of THIS command's payload (`canonicalCommandDigest`) — persisted
   *  at insert + exposed on the deps so dispatch can reject key-reuse with a different payload. */
  payloadDigest?: string;
  /** Domain-specific `external_refs.external_record_id` encoder (e.g. the companies "<Doctype>:<name>"
   *  prefix, index.ts) applied INSIDE the fenced `finalize_outbox` write so the moved-in-RPC ref
   *  matches the pre-H-1 caller encoding. Default identity (the bare ERP name). */
  encodeExternalRecordId?: (mapping: ExternalRefMapping) => string;
  /** Production backoff delay before re-reading a fresh (live-owned) `committing` row. Defaults to a
   *  small real delay; tests inject an instant/fast one. */
  backoff?: () => Promise<void>;
}

/** Builds the DB-backed `DispatchMoneyOutboxDeps` for ONE request's org/tier/operation. */
export function createDbMoneyOutboxDeps(opts: DbMoneyOutboxDepsOpts): DispatchMoneyOutboxDeps {
  const { serviceClient, orgId, externalTier, operation } = opts;
  const encodeExternalRecordId = opts.encodeExternalRecordId ?? ((m: ExternalRefMapping) => m.externalRecordId);

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
          // C-1: persist the composite-probe inputs so the sweep recovery path can probe deterministically.
          ...(opts.payload ? { payload: opts.payload } : {}),
          // M-3: persist the payload digest so a later key-reuse with a different payload is rejected.
          ...(opts.payloadDigest ? { payload_digest: opts.payloadDigest } : {}),
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

    // H-1 (finalization TOCTOU fix): the fenced external_refs upsert (state stays committed). The
    // domain-specific external_record_id encoding (companies prefix) is applied here, BEFORE the RPC,
    // so the moved-in-RPC ref matches the pre-H-1 caller-side encoding.
    recordOutboxRef: (id, claimGeneration, mapping) =>
      callCountRpc(serviceClient, 'record_outbox_ref', {
        p_id: id,
        p_generation: claimGeneration,
        p_domain: mapping.domain,
        p_pmo_record_id: mapping.pmoRecordId,
        p_external_tier: mapping.externalTier,
        p_external_record_id: encodeExternalRecordId(mapping),
      }),

    // H-1: the fenced committed→confirmed promotion (run LAST, after the mirror).
    confirmOutbox: (id, claimGeneration) =>
      callCountRpc(serviceClient, 'confirm_outbox', { p_id: id, p_generation: claimGeneration }),

    // C-1 (PE mutable anchor): the fenced committing→held transition for a recovery-inconclusive PE.
    markOutboxHeld: (id, reason, claimGeneration) =>
      callCountRpc(serviceClient, 'mark_outbox_held', { p_id: id, p_generation: claimGeneration, p_reason: reason }),

    reissueOnInconclusiveAbsence: opts.reissueOnInconclusiveAbsence ?? true,

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
    payloadDigest: opts.payloadDigest,
  };
}
