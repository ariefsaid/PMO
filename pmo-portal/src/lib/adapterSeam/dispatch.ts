/**
 * Pure orchestration for externally-owned writes (FR-EAS-023/033/034/042).
 * Relative imports only so the edge-function can import this module directly.
 */
import { AppError } from '../appError.ts';
import { Adapter, AdapterCommand, AdapterError, CommandResult, PmoRecord } from './contract.ts';

export interface ExternalRefMapping {
  pmoRecordId: string;
  externalTier: string;
  externalRecordId: string;
  domain: string;
}

export interface DispatchExternallyOwnedWriteDeps {
  adapter: Pick<Adapter, 'tier' | 'capabilityMap' | 'commit'>;
  command: AdapterCommand;
  writeReadModel: (canonical: PmoRecord) => Promise<void>;
  recordExternalRef: (mapping: ExternalRefMapping) => Promise<void>;
  /**
   * Delete-aware dispatch (AC-CUA-038, FR-CUA-026, OD-CUA-2): tombstones the mirrored read-model
   * row instead of upserting a canonical record. Optional — omitted callers (P0) never take the
   * delete branch. Wired for `tasks` in the adapter-dispatch edge fn (`tombstoned_at = now()`).
   */
  tombstoneReadModel?: (pmoRecordId: string) => Promise<void>;
  /**
   * The money-idempotency outbox deps (ADR-0057). Present only when the caller may route an
   * `erpnext`-tier non-read-only command through the money path (wired at the served boundary,
   * task 6.4). Absent ⇒ P0/P1 behavior (and every non-erpnext tier) is completely untouched.
   */
  money?: DispatchMoneyOutboxDeps;
}

// ---------------------------------------------------------------------------
// Money idempotency (ADR-0057 §4) — the durable outbox + atomic recovery algorithm.
// ---------------------------------------------------------------------------

/** A row of `external_command_outbox` (0095) as seen by the pure dispatch layer (camelCase). */
export interface OutboxRow {
  id: string;
  domain: string;
  pmoRecordId: string;
  idempotencyKey: string;
  state: 'pending' | 'committing' | 'committed' | 'confirmed' | 'failed' | 'quarantined';
  externalRecordId: string | null;
  /** The adapter's REAL returned canonical record (F2), persisted at `markOutboxCommitted` so
   *  recovery/finalization mirrors the ERP-derived fields (totals, status, …) rather than a bare
   *  `{ id }` stub. `null` before commit or when the row was adopted without a full record. */
  canonical: PmoRecord | null;
  /** The fencing token (F4): bumped on every `claimOutboxForCommit` win; every post-claim
   *  write-back is guarded `WHERE claim_generation = <token>` so a lease-expired claimant's late
   *  write-back is discarded (affects 0 rows) once a reclaimer has superseded it. */
  claimGeneration: number;
}

/**
 * The outbox deps `dispatchMoneyWrite` needs (ADR-0057 §2/§4). Each `markOutbox*` is a GUARDED
 * write-back — its SQL is `… WHERE id = $1 AND claim_generation = $token` — and returns the
 * affected row count; `0` means a reclaimer superseded this caller (F4), and the caller MUST
 * discard its result rather than finalize.
 */
export interface DispatchMoneyOutboxDeps {
  /** Read the existing outbox row for this command's unique 4-tuple, or `null` when none exists. */
  readOutbox: (domain: string, pmoRecordId: string, idempotencyKey: string) => Promise<OutboxRow | null>;
  /** INSERT a new `pending` row. A concurrent duplicate insert throws a Postgres `23505`
   *  (the unique 4-tuple, 0095) — the caller re-reads the winner's row and reconciles to it. */
  insertOutboxPending: (domain: string, pmoRecordId: string, idempotencyKey: string) => Promise<OutboxRow>;
  /** `public.claim_outbox_for_commit` — the ONLY gate into the ERP-POST critical section. Claims a
   *  `pending`/`failed` row, or a `quarantined` row whose reconcile-after visibility window has
   *  elapsed (F1). Returns the claimed row (with its bumped `claim_generation`, the caller's fencing
   *  token) or `null` when the row is not claimable now (a live owner, or a quarantine window that
   *  has not yet elapsed). A `committing` row is NEVER reclaimed here — see `quarantineCommitting`. */
  claimOutboxForCommit: (id: string) => Promise<OutboxRow | null>;
  /** `public.quarantine_committing` (F1 — the in-flight-POST-overlap fix). A stale (past-lease)
   *  `committing` row is NEVER auto-reissued (its ERP POST may be in flight and not yet probe-visible
   *  → a blind re-POST mints a duplicate money document). Instead this fenced write transitions it to
   *  `quarantined` (bumping `claim_generation` to invalidate the stale claimant), sets a visibility
   *  window (`reconcile_after`), and RETURNs the row. Returns `null` for a fresh `committing` row (a
   *  live owner within lease) or a non-`committing` row. Quarantined rows are resolved ONLY by the
   *  reconciliation path (claim after the window → probe by remarks key → adopt-or-reissue). */
  quarantineCommitting: (id: string) => Promise<OutboxRow | null>;
  /** Guarded write-back `committing`→`committed` (records the ERP-assigned id AND the adapter's real
   *  returned `canonical`, F2 — so a later finalize mirrors the ERP-derived record, not a stub). */
  markOutboxCommitted: (id: string, externalRecordId: string, canonical: PmoRecord, claimGeneration: number) => Promise<number>;
  /** F3 — a fenced ownership re-check run IMMEDIATELY before the (non-transactional) read-model +
   *  `external_refs` writes. Returns `true` iff this caller still holds the claim (its
   *  `claim_generation` matches the row's current value). A claimant superseded between `committed`
   *  and `confirmed` gets `false` and MUST write nothing — otherwise it would stamp a stale mirror/ref
   *  over the reclaimer's correct one. The DB impl is a guarded `SELECT`/`UPDATE` on `claim_generation`. */
  verifyClaimGeneration: (id: string, claimGeneration: number) => Promise<boolean>;
  /** Guarded write-back `committed`→`confirmed` (after the read-model/external_refs finalize). */
  markOutboxConfirmed: (id: string, claimGeneration: number) => Promise<number>;
  /** Guarded write-back →`failed` (a non-retryable `commit-rejected` classification). A retryable
   *  `external-unreachable` deliberately does NOT mark anything — the row stays `committing` and
   *  becomes reclaimable once its lease expires (the same claim path handles it). */
  markOutboxFailed: (id: string, lastError: string, claimGeneration: number) => Promise<number>;
  /** Recovery probe: does ERP already hold a doc stamped with this idempotency key (the `remarks`
   *  anchor, ADR-0057 §3)? Used by the claim winner to adopt an orphaned prior commit instead of
   *  blindly re-POSTing. */
  probeByRemarksKey: (domain: string, idempotencyKey: string) => Promise<{ externalRecordId: string; canonical?: PmoRecord } | null>;
  /** A short backoff before re-reading a fresh (non-reclaimable) `committing` row owned by another
   *  live caller. Injected so tests run instantly; production wires a small real delay. */
  backoff: () => Promise<void>;
}

export type DispatchMoneyWriteDeps = DispatchExternallyOwnedWriteDeps & { money: DispatchMoneyOutboxDeps };

/** Discriminates a retryable transport failure (never blindly re-POSTed, but the row is left
 *  reclaimable) from a non-retryable rejection (marked `failed` immediately). */
function isRetryableTransport(error: unknown): boolean {
  return error instanceof AdapterError && error.code === 'external-unreachable';
}

/** The read-model write + `external_refs` record shared by every terminal (adopt-or-create) path,
 *  then the guarded promote to `confirmed`. Returns the `markOutboxConfirmed` row count so a
 *  caller can detect a fencing-token loss even at this late stage (defensive; not expected in
 *  practice since only the claim winner reaches here). */
async function finalizeOutboxRow(
  row: OutboxRow,
  claimGeneration: number,
  deps: DispatchMoneyWriteDeps,
): Promise<number> {
  // F3 — generation-guard the WHOLE finalization: re-verify claim ownership IMMEDIATELY before the
  // (non-transactional) mirror + `external_refs` writes, so a claimant superseded between `committed`
  // and `confirmed` writes NOTHING (it must not stamp a stale mirror/ref over the reclaimer's correct
  // one). A `false` here means superseded → return 0 so the caller discards and reconciles off the
  // reclaimer's current state.
  const stillOwned = await deps.money.verifyClaimGeneration(row.id, claimGeneration);
  if (!stillOwned) return 0;
  // F2 — mirror the adapter's REAL returned record (persisted at commit), not a reconstructed stub, so
  // the read-model carries the ERP-derived fields (totals, status, outstanding, …). Fall back to the id
  // stub only for a row adopted without a full record (a later read-back/sweep reconciles its fields).
  const canonical: PmoRecord = row.canonical ?? { id: deps.command.record.id };
  await deps.writeReadModel(canonical);
  await deps.recordExternalRef({
    pmoRecordId: deps.command.record.id,
    externalTier: deps.adapter.tier,
    externalRecordId: row.externalRecordId!,
    domain: deps.command.domain,
  });
  return deps.money.markOutboxConfirmed(row.id, claimGeneration);
}

/** The claim winner's critical section: probe-adopt-or-POST, then the guarded committed/finalize
 *  write-backs. A fencing-token loss at ANY write-back discards this claimant's result — no
 *  finalize, no duplicate mirror — and reconciles off the row's current (post-supersede) state. */
async function claimAndCommit(claimed: OutboxRow, deps: DispatchMoneyWriteDeps): Promise<CommandResult> {
  const { command, money, adapter } = deps;
  const token = claimed.claimGeneration;

  const probed = await money.probeByRemarksKey(command.domain, command.idempotencyKey!);
  let externalRecordId: string;
  let canonical: PmoRecord;
  if (probed) {
    externalRecordId = probed.externalRecordId;
    // Adopting an orphaned/in-flight doc found only by its remarks key: the probe carries the ERP
    // record when it can, else we fall back to the id stub (a later sweep/read-back reconciles fields).
    canonical = probed.canonical ?? { id: command.record.id };
  } else {
    let result: CommandResult;
    try {
      result = await adapter.commit(command);
    } catch (error) {
      if (!isRetryableTransport(error)) {
        // a non-retryable (commit-rejected) failure — mark failed under the current fencing token.
        await money.markOutboxFailed(claimed.id, error instanceof Error ? error.message : String(error), token);
      }
      // a retryable (external-unreachable) failure intentionally marks nothing — the row stays
      // `committing` and becomes reclaimable once its lease expires (ADR-0057 §4).
      throw toDispatchError(error);
    }
    externalRecordId = result.externalRecordId;
    canonical = result.canonical;
  }

  const committedCount = await money.markOutboxCommitted(claimed.id, externalRecordId, canonical, token);
  if (committedCount === 0) {
    // F4 — superseded before we could finalize: discard (no finalize, no duplicate mirror) and
    // reconcile off whatever state the reclaimer left behind.
    const fresh = await money.readOutbox(command.domain, command.record.id, command.idempotencyKey!);
    return reconcileOutbox(fresh!, deps);
  }

  const finalized = await finalizeOutboxRow({ ...claimed, state: 'committed', externalRecordId, canonical }, token, deps);
  if (finalized === 0) {
    // F3 — superseded between `committed` and the mirror/ref writes: discard and reconcile off current state.
    const fresh = await money.readOutbox(command.domain, command.record.id, command.idempotencyKey!);
    return reconcileOutbox(fresh!, deps);
  }
  return { externalRecordId, canonical };
}

/** The reconcile-by-state algorithm (ADR-0057 §4 table) — never a blind second create. */
async function reconcileOutbox(row: OutboxRow, deps: DispatchMoneyWriteDeps): Promise<CommandResult> {
  const { command, money } = deps;
  switch (row.state) {
    case 'confirmed':
      return { externalRecordId: row.externalRecordId!, canonical: row.canonical ?? { id: command.record.id } };
    case 'committed': {
      const finalized = await finalizeOutboxRow(row, row.claimGeneration, deps);
      if (finalized === 0) {
        // F3 — superseded before the finalize writes landed; reconcile off the current state.
        const fresh = await money.readOutbox(command.domain, command.record.id, command.idempotencyKey!);
        return reconcileOutbox(fresh!, deps);
      }
      return { externalRecordId: row.externalRecordId!, canonical: row.canonical ?? { id: command.record.id } };
    }
    case 'committing': {
      // F1 (the in-flight-POST-overlap fix): a `committing` row is NEVER reclaimed and re-POSTed —
      // its ERP write may be in flight and not yet probe-visible, so a blind re-POST mints a duplicate
      // money document. A STALE (past-lease) committing row is QUARANTINED (fenced) and resolved only
      // by the reconciliation path after a visibility window; a FRESH one has a live owner — back off
      // and re-read.
      const quarantined = await money.quarantineCommitting(row.id);
      if (quarantined) return reconcileOutbox(quarantined, deps);
      await money.backoff();
      const fresh = await money.readOutbox(command.domain, command.record.id, command.idempotencyKey!);
      return reconcileOutbox(fresh!, deps);
    }
    case 'quarantined': {
      // Resolved ONLY via a fenced claim gated (in the RPC) on the reconcile-after visibility window.
      // Window elapsed → the claim wins → probe the remarks key → adopt the original (in-flight) POST,
      // or, with no ERP hit, reissue under the SAME idempotency key. Window NOT elapsed (or another
      // caller owns the reconcile) → surface a retryable "reconciling"; the sweep finalizes it once the
      // window passes. We deliberately do NOT spin here — a 5-minute window must never block a request.
      const claimed = await money.claimOutboxForCommit(row.id);
      if (claimed) return claimAndCommit(claimed, deps);
      throw toDispatchError(new AdapterError('external-unreachable', 'command-quarantined-reconciling'));
    }
    case 'pending':
    case 'failed': {
      const claimed = await money.claimOutboxForCommit(row.id);
      if (claimed) return claimAndCommit(claimed, deps);
      // lost the race for this row — another caller claimed it first; re-read and reconcile
      // (never POST).
      const fresh = await money.readOutbox(command.domain, command.record.id, command.idempotencyKey!);
      return reconcileOutbox(fresh!, deps);
    }
    /* c8 ignore next 2 -- exhaustive over the 0095 state CHECK constraint */
    default:
      throw new Error(`unreachable outbox state: ${(row as OutboxRow).state}`);
  }
}

/**
 * The money-idempotency dispatch path (ADR-0057). Enforces the server-side idempotency-key
 * requirement (FR-ENA-040) BEFORE touching the outbox, then INSERTs-or-reads the outbox row for
 * this command's unique 4-tuple and reconciles it to a terminal `CommandResult` — never a blind
 * second create (FR-ENA-041/043). Pure, Deno-importable.
 */
export async function dispatchMoneyWrite(deps: DispatchMoneyWriteDeps): Promise<CommandResult> {
  const { command, money } = deps;
  if (!command.idempotencyKey) {
    throw toDispatchError(new AdapterError('commit-rejected', 'missing-idempotency-key'));
  }
  let row = await money.readOutbox(command.domain, command.record.id, command.idempotencyKey);
  if (!row) {
    try {
      row = await money.insertOutboxPending(command.domain, command.record.id, command.idempotencyKey);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code !== '23505') throw toDispatchError(error);
      row = await money.readOutbox(command.domain, command.record.id, command.idempotencyKey);
      if (!row) throw toDispatchError(error);
    }
  }
  return reconcileOutbox(row, deps);
}

function toDispatchError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof AdapterError) {
    if (error.code === 'external-unreachable') {
      return new AppError('external system unreachable — try again', error.code);
    }
    return new AppError(error.message, error.code);
  }
  if (error instanceof Error) return new AppError(error.message);
  return new AppError('An unexpected error occurred');
}

export async function dispatchExternallyOwnedWrite(
  deps: DispatchExternallyOwnedWriteDeps,
): Promise<CommandResult> {
  // ADR-0057: an `erpnext`-tier non-read-only command always takes the money-idempotency path
  // (which itself enforces the required idempotencyKey). Every other tier — P0 `reference`, P1
  // `clickup`, and any future non-money tier — is completely unaffected (byte-for-byte).
  if (deps.adapter.tier === 'erpnext' && (deps.command.operation as string) !== 'read') {
    if (!deps.money) {
      throw toDispatchError(new Error('erpnext money command dispatched without outbox deps'));
    }
    return dispatchMoneyWrite(deps as DispatchMoneyWriteDeps);
  }
  try {
    const result = await deps.adapter.commit(deps.command);
    if (deps.command.operation === 'delete') {
      // Delete-aware (AC-CUA-038): tombstone the mirror, skip the upsert; the external_refs
      // mapping is kept as-is (not deleted) — never re-recorded on a delete.
      await deps.tombstoneReadModel?.(deps.command.record.id);
      return result;
    }
    await deps.writeReadModel(result.canonical);
    await deps.recordExternalRef({
      pmoRecordId: deps.command.record.id,
      externalTier: deps.adapter.tier,
      externalRecordId: result.externalRecordId,
      domain: deps.command.domain,
    });
    return result;
  } catch (error) {
    throw toDispatchError(error);
  }
}
