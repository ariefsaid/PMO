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
  state: 'pending' | 'committing' | 'committed' | 'confirmed' | 'failed';
  externalRecordId: string | null;
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
  /** `public.claim_outbox_for_commit` — the ONLY gate into the ERP-POST critical section. Returns
   *  the claimed row (with its bumped `claim_generation`, the caller's fencing token) or `null`
   *  when another caller already owns it (a fresh `committing` row). */
  claimOutboxForCommit: (id: string) => Promise<OutboxRow | null>;
  /** Guarded write-back `committing`→`committed` (records the ERP-assigned id). */
  markOutboxCommitted: (id: string, externalRecordId: string, claimGeneration: number) => Promise<number>;
  /** Guarded write-back `committed`→`confirmed` (after the read-model/external_refs finalize). */
  markOutboxConfirmed: (id: string, claimGeneration: number) => Promise<number>;
  /** Guarded write-back →`failed` (a non-retryable `commit-rejected` classification). A retryable
   *  `external-unreachable` deliberately does NOT mark anything — the row stays `committing` and
   *  becomes reclaimable once its lease expires (the same claim path handles it). */
  markOutboxFailed: (id: string, lastError: string, claimGeneration: number) => Promise<number>;
  /** Recovery probe: does ERP already hold a doc stamped with this idempotency key (the `remarks`
   *  anchor, ADR-0057 §3)? Used by the claim winner to adopt an orphaned prior commit instead of
   *  blindly re-POSTing. */
  probeByRemarksKey: (domain: string, idempotencyKey: string) => Promise<{ externalRecordId: string } | null>;
  /** A short backoff before re-reading a fresh (non-reclaimable) `committing` row owned by another
   *  live caller. Injected so tests run instantly; production wires a small real delay. */
  backoff: () => Promise<void>;
}

type DispatchMoneyWriteDeps = DispatchExternallyOwnedWriteDeps & { money: DispatchMoneyOutboxDeps };

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
  const canonical: PmoRecord = { id: deps.command.record.id };
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
  if (probed) {
    externalRecordId = probed.externalRecordId;
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
  }

  const committedCount = await money.markOutboxCommitted(claimed.id, externalRecordId, token);
  if (committedCount === 0) {
    // F4 — superseded before we could finalize: discard (no finalize, no duplicate mirror) and
    // reconcile off whatever state the reclaimer left behind.
    const fresh = await money.readOutbox(command.domain, command.record.id, command.idempotencyKey!);
    return reconcileOutbox(fresh!, deps);
  }

  await finalizeOutboxRow({ ...claimed, state: 'committed', externalRecordId }, token, deps);
  return { externalRecordId, canonical: { id: command.record.id } };
}

/** The reconcile-by-state algorithm (ADR-0057 §4 table) — never a blind second create. */
async function reconcileOutbox(row: OutboxRow, deps: DispatchMoneyWriteDeps): Promise<CommandResult> {
  const { command, money } = deps;
  switch (row.state) {
    case 'confirmed':
      return { externalRecordId: row.externalRecordId!, canonical: { id: command.record.id } };
    case 'committed':
      await finalizeOutboxRow(row, row.claimGeneration, deps);
      return { externalRecordId: row.externalRecordId!, canonical: { id: command.record.id } };
    case 'committing': {
      const claimed = await money.claimOutboxForCommit(row.id);
      if (claimed) return claimAndCommit(claimed, deps);
      // a FRESH committing row (another live owner) — never POST; back off and re-read.
      await money.backoff();
      const fresh = await money.readOutbox(command.domain, command.record.id, command.idempotencyKey!);
      return reconcileOutbox(fresh!, deps);
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
