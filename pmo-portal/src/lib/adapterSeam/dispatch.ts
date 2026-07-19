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
   * The money-idempotency outbox deps (ADR-0058). Present only when the caller may route an
   * `erpnext`-tier non-read-only command through the money path (wired at the served boundary,
   * task 6.4). Absent ⇒ P0/P1 behavior (and every non-erpnext tier) is completely untouched.
   */
  money?: DispatchMoneyOutboxDeps;
}

// ---------------------------------------------------------------------------
// Money idempotency (ADR-0058 §4) — the durable outbox + atomic recovery algorithm.
// ---------------------------------------------------------------------------

/** A row of `external_command_outbox` (0095) as seen by the pure dispatch layer (camelCase). */
export interface OutboxRow {
  id: string;
  domain: string;
  pmoRecordId: string;
  idempotencyKey: string;
  state: 'pending' | 'committing' | 'committed' | 'confirmed' | 'failed' | 'quarantined' | 'held';
  externalRecordId: string | null;
  /** The adapter's REAL returned canonical record (F2), persisted at `markOutboxCommitted` so
   *  recovery/finalization mirrors the ERP-derived fields (totals, status, …) rather than a bare
   *  `{ id }` stub. `null` before commit or when the row was adopted without a full record. */
  canonical: PmoRecord | null;
  /** The fencing token (F4): bumped on every `claimOutboxForCommit` win; every post-claim
   *  write-back is guarded `WHERE claim_generation = <token>` so a lease-expired claimant's late
   *  write-back is discarded (affects 0 rows) once a reclaimer has superseded it. */
  claimGeneration: number;
  /** M-3 (audit): the canonical digest of the command payload that OPENED this outbox row. A retry
   *  reusing the same idempotency key with a MATERIALLY DIFFERENT payload (different amount/party/refs)
   *  is rejected rather than silently reconciled to the original command. `null` for rows opened before
   *  the digest was introduced (the check is skipped when either side is absent). */
  payloadDigest: string | null;
}

/**
 * The outbox deps `dispatchMoneyWrite` needs (ADR-0058 §2/§4). Each `markOutbox*` is a GUARDED
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
  /** H-1 (finalization TOCTOU fix) — the DB-side FENCED external_refs upsert (`record_outbox_ref` RPC,
   *  0095), under a `SELECT … FOR UPDATE` row lock re-checking `claim_generation` + `state='committed'`.
   *  Only the current owner writes the mapping (0 = superseded → nothing written), closing the old
   *  verify-then-write TOCTOU where a reclaimer could overwrite the ref with a stale one. The state stays
   *  `committed` — the confirm is a SEPARATE fenced RPC so the per-domain mirror write sits BETWEEN them:
   *  a crash before the mirror leaves the row `committed` (not confirmed), so the retry re-runs the mirror
   *  (finalize-only, AC-ENA-010). Returns 1 when THIS owner wrote the ref, else 0. */
  recordOutboxRef: (id: string, claimGeneration: number, mapping: ExternalRefMapping) => Promise<number>;
  /** H-1 — the fenced `committed`→`confirmed` promotion (`confirm_outbox` RPC, 0095), guarded on
   *  `claim_generation` + `state='committed'`. The ONLY committed→confirmed path (markOutboxConfirmed
   *  retired). Run LAST (after the mirror) so a crash before it is recoverable. Returns 1 / 0 (superseded). */
  confirmOutbox: (id: string, claimGeneration: number) => Promise<number>;
  /** C-1 (PE mutable anchor → no conclusive absence) — the fenced `committing`→`held` transition
   *  (`mark_outbox_held` RPC, 0095). Called ONLY on a post-window recovery reissue for a doctype whose
   *  anchor is mutable (`reissueOnInconclusiveAbsence === false`, i.e. Payment Entry) when the probe
   *  finds no doc: a blind reissue could mint a second Payment Entry, so the row is HELD for ops
   *  resolution and NEVER auto-reissued. Guarded on `claim_generation` (F4). Returns 1 when held, else 0. */
  markOutboxHeld: (id: string, reason: string, claimGeneration: number) => Promise<number>;
  /** C-1 per-kind reissue policy (DIRECTOR RULING). `true` (default, reissue-capable) for an
   *  IMMUTABLE-anchor kind (Purchase Invoice `remarks`, and every anchor-less kind): a post-window
   *  recovery with no probe hit may safely reissue under the same idempotency key. `false` for a
   *  MUTABLE-anchor money doc (Payment Entry `reference_no`, which an accountant can edit ERP-side):
   *  conclusive absence cannot exist, so a post-window recovery with no hit is HELD, never reissued. */
  reissueOnInconclusiveAbsence: boolean;
  /** Guarded write-back →`failed` (a non-retryable `commit-rejected` classification). A retryable
   *  `external-unreachable` deliberately does NOT mark anything — the row stays `committing` and
   *  becomes reclaimable once its lease expires (the same claim path handles it). */
  markOutboxFailed: (id: string, lastError: string, claimGeneration: number) => Promise<number>;
  /** Recovery probe: does ERP already hold a doc stamped with this idempotency key (the `remarks`
   *  anchor, ADR-0058 §3)? Used by the claim winner to adopt an orphaned prior commit instead of
   *  blindly re-POSTing. */
  probeByRemarksKey: (domain: string, idempotencyKey: string) => Promise<{ externalRecordId: string; canonical?: PmoRecord } | null>;
  /** A short backoff before re-reading a fresh (non-reclaimable) `committing` row owned by another
   *  live caller. Injected so tests run instantly; production wires a small real delay. */
  backoff: () => Promise<void>;
  /** M-3 (audit): the canonical digest of THIS command's payload (computed by the caller), persisted at
   *  insert and compared against a re-read row's stored digest to reject idempotency-key reuse with a
   *  different payload. Absent ⇒ the binding check is skipped (P0/P1 and pre-M-3 callers). */
  payloadDigest?: string;
}

export type DispatchMoneyWriteDeps = DispatchExternallyOwnedWriteDeps & { money: DispatchMoneyOutboxDeps };

/** Discriminates a retryable transport failure (never blindly re-POSTed, but the row is left
 *  reclaimable) from a non-retryable rejection (marked `failed` immediately). */
function isRetryableTransport(error: unknown): boolean {
  return error instanceof AdapterError && error.code === 'external-unreachable';
}

/** M-4 (audit): bound + scrub an error before it is PERSISTED to the outbox `last_error`. A raw ERP
 *  response body can carry secret_ref/env names, tokens, or a verbose traceback — never store it
 *  verbatim. Keeps the classified code + a short snippet with long token-shaped runs redacted. */
export function redactErrorForOutbox(error: unknown): string {
  const raw = error instanceof AdapterError
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
  const scrubbed = raw.replace(/[A-Za-z0-9_+/=-]{24,}/g, '[redacted]');
  return scrubbed.length > 240 ? `${scrubbed.slice(0, 240)}…` : scrubbed;
}

/** Postgres unique-violation — the mirror row for this PMO record id already exists. */
const PG_UNIQUE_VIOLATION = '23505';

/** Luna BLOCK 3: is this the "the mirror I am about to write is ALREADY there" signal? The per-domain
 *  mirror insert is keyed on the PMO record id (a FIXED primary key), so a unique violation on a
 *  REPLAYED finalize means the previous attempt's mirror landed — i.e. the converged state we want —
 *  rather than a failure. Matched on the Postgres code only (never a message), so it holds for every
 *  domain writer. */
function isAlreadyMirrored(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === PG_UNIQUE_VIOLATION;
}

/** The DB-side FENCED finalization (H-1), ordered `record_outbox_ref` → mirror → `confirm_outbox`:
 *  1. Fenced `external_refs` upsert — a superseded claimant writes NOTHING (returns 0) and the whole
 *     finalization is a no-op (no mirror, no confirm); this closes the old verify-then-write TOCTOU.
 *  2. The per-domain read-model MIRROR — issued ONLY when step 1 returned `1` (so the mirror is
 *     generation-conditional too, per the ruling: a superseded claimant never mirrors).
 *  3. Fenced `committed`→`confirmed` promotion, run LAST.
 *  Keeping confirm last means a crash between the ERP commit and the mirror leaves the row `committed`
 *  (not confirmed), so the retry re-runs the mirror (finalize-only, AC-ENA-010) — a confirm-first design
 *  would strand the row confirmed-but-unmirrored. Returns the confirm row count (1 = this owner
 *  finalized; 0 = superseded → caller discards and reconciles off the reclaimer's current state). */
async function finalizeOutboxRow(
  row: OutboxRow,
  claimGeneration: number,
  deps: DispatchMoneyWriteDeps,
  isReplay = false,
): Promise<number> {
  const refWritten = await deps.money.recordOutboxRef(row.id, claimGeneration, {
    pmoRecordId: deps.command.record.id,
    externalTier: deps.adapter.tier,
    externalRecordId: row.externalRecordId!,
    domain: deps.command.domain,
  });
  if (refWritten === 0) return 0;
  // F2 — mirror the adapter's REAL returned record (persisted at commit), not a reconstructed stub, so
  // the read-model carries the ERP-derived fields (totals, status, outstanding, …). Fall back to the id
  // stub only for a row adopted without a full record (a later read-back/sweep reconciles its fields).
  const canonical: PmoRecord = row.canonical ?? { id: deps.command.record.id };
  try {
    await deps.writeReadModel(canonical);
  } catch (error) {
    // Luna BLOCK 3 — retry-idempotent finalization. On a REPLAY of a `committed` row (the previous
    // attempt crashed somewhere in ref → mirror → confirm), the mirror insert may already have landed.
    // Its fixed-PK collision is then the CONVERGED state, not a failure: swallowing it lets the replay
    // reach `confirm_outbox`, whereas rethrowing wedges a real ERP money document at `committed`
    // forever (every retry dies on the same duplicate insert → manual intervention).
    // Deliberately NOT tolerated on a first finalize (`isReplay === false`): there, a pre-existing
    // mirror for this PMO record id is a genuine anomaly (e.g. a reused caller-supplied record id) and
    // must surface rather than be confirmed away.
    if (!isReplay || !isAlreadyMirrored(error)) throw error;
    console.warn(
      `[money-outbox] finalize replay ${deps.command.domain}/${deps.command.record.id}: mirror already present — ` +
        'converging to confirmed (the prior attempt mirrored, then crashed before confirm)',
    );
  }
  return deps.money.confirmOutbox(row.id, claimGeneration);
}

/** The claim winner's critical section: probe-adopt-or-POST, then the guarded committed/finalize
 *  write-backs. A fencing-token loss at ANY write-back discards this claimant's result — no
 *  finalize, no duplicate mirror — and reconciles off the row's current (post-supersede) state.
 *
 *  `isRecoveryReissue` marks a POST-WINDOW recovery claim (the `quarantined` path) — the only place a
 *  reissue-after-inconclusive can occur. For a MUTABLE-anchor money doc (Payment Entry,
 *  `reissueOnInconclusiveAbsence === false`) such a reissue is BANNED (C-1): a no-probe-hit cannot prove
 *  the original POST didn't commit, so a blind reissue risks a second Payment Entry — the row is HELD
 *  instead. A fresh first-attempt claim (pending/failed, `isRecoveryReissue` false) always POSTs. */
async function claimAndCommit(
  claimed: OutboxRow,
  deps: DispatchMoneyWriteDeps,
  isRecoveryReissue = false,
): Promise<CommandResult> {
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
  } else if (isRecoveryReissue && !money.reissueOnInconclusiveAbsence) {
    // C-1 DIRECTOR RULING: a post-window recovery for a MUTABLE-anchor money doc (Payment Entry) found
    // NO doc — but the mutable anchor means absence is NOT conclusive (the original POST may have
    // committed and had its `reference_no` edited ERP-side). Reissuing would risk a double-pay. HOLD the
    // row for ops resolution (fenced on the token), surface it non-silently, and NEVER auto-reissue.
    const heldCount = await money.markOutboxHeld(claimed.id, 'recovery-inconclusive-absence: mutable anchor cannot prove non-commit', token);
    if (heldCount === 0) {
      // Fencing loss: another claimant superseded this token before the hold landed — the row's
      // CURRENT state (possibly confirmed) is the truth; reporting command-held here would hand the
      // client a stale outcome (Luna review 2026-07-14, SHOULD-FIX 4).
      const fresh = await money.readOutbox(command.domain, command.record.id, command.idempotencyKey!);
      return reconcileOutbox(fresh!, deps);
    }
    // Intentional ops signal (non-silent, per the C-1 ruling): a held money command needs a human.
    console.error(
      `[money-outbox] HELD ${command.domain}/${command.record.id} (idempotencyKey=${command.idempotencyKey}) — ` +
        'post-window recovery found no ERP doc but the anchor is mutable; not auto-reissued, awaiting operator resolution',
    );
    // A DISTINCT non-retryable code (an AppError passes through toDispatchError unchanged) — never the
    // generic transient 'external-unreachable' (retrying will not help; an operator must resolve it).
    throw new AppError('payment command held for operator resolution — not auto-reissued (mutable anchor)', 'command-held');
  } else {
    let result: CommandResult;
    try {
      result = await adapter.commit(command);
    } catch (error) {
      if (!isRetryableTransport(error)) {
        // a non-retryable (commit-rejected) failure — mark failed under the current fencing token.
        // M-4: the persisted last_error is REDACTED (bounded + token-scrubbed), never the raw ERP body.
        const failedCount = await money.markOutboxFailed(claimed.id, redactErrorForOutbox(error), token);
        if (failedCount === 0) {
          // Fencing loss: superseded before the failure landed — a parallel claimant owns the row's
          // outcome now (possibly a confirmed success). Surface THAT, not this claimant's stale
          // failure (Luna review 2026-07-14, SHOULD-FIX 4).
          const fresh = await money.readOutbox(command.domain, command.record.id, command.idempotencyKey!);
          return reconcileOutbox(fresh!, deps);
        }
      }
      // a retryable (external-unreachable) failure intentionally marks nothing — the row stays
      // `committing` and becomes reclaimable once its lease expires (ADR-0058 §4).
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

/** The reconcile-by-state algorithm (ADR-0058 §4 table) — never a blind second create. */
/** In-request budget for waiting on a live `committing` owner before surfacing the retryable
 * in-flight signal. A LIVE owner normally finishes well within this; a DEAD one (crashed mid-lease)
 * can only be resolved by lease expiry + the sweep, so waiting longer just hangs the request. */
const COMMITTING_WAIT_BUDGET_MS = 3_000;

async function reconcileOutbox(row: OutboxRow, deps: DispatchMoneyWriteDeps, committingSince?: number): Promise<CommandResult> {
  const { command, money } = deps;
  switch (row.state) {
    case 'confirmed':
      return { externalRecordId: row.externalRecordId!, canonical: row.canonical ?? { id: command.record.id } };
    case 'committed': {
      // A `committed` row means ERP already committed and a PRIOR attempt's finalization did not
      // complete — this is the REPLAY path, so an already-present mirror converges (Luna BLOCK 3).
      const finalized = await finalizeOutboxRow(row, row.claimGeneration, deps, true);
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
      // and re-read ONCE. If it is STILL committing after the back-off, the owner is either alive
      // (let it finish) or dead-within-lease (only lease expiry + the sweep can resolve it) — either
      // way, spinning in-request helps nobody: keep re-reading only within a small wait budget,
      // then surface the retryable in-flight signal — mirroring the quarantined branch's no-spin
      // stance. (Found live: a same-key retry 750ms after an unknown-outcome POST failure spun here
      // for the full 60s lease and timed out the request.)
      const quarantined = await money.quarantineCommitting(row.id);
      if (quarantined) return reconcileOutbox(quarantined, deps);
      const since = committingSince ?? Date.now();
      if (Date.now() - since > COMMITTING_WAIT_BUDGET_MS) {
        throw toDispatchError(new AdapterError('external-unreachable', 'command-committing-in-flight'));
      }
      await money.backoff();
      const fresh = await money.readOutbox(command.domain, command.record.id, command.idempotencyKey!);
      return reconcileOutbox(fresh!, deps, since);
    }
    case 'quarantined': {
      // Resolved ONLY via a fenced claim gated (in the RPC) on the reconcile-after visibility window.
      // Window elapsed → the claim wins → probe the anchor key → adopt the original (in-flight) POST,
      // or, with no ERP hit, reissue under the SAME idempotency key — EXCEPT for a mutable-anchor money
      // doc (Payment Entry), where a no-hit is HELD not reissued (C-1, enforced by the recovery-reissue
      // flag). Window NOT elapsed (or another caller owns the reconcile) → surface a retryable
      // "reconciling"; the sweep finalizes it once the window passes. We deliberately do NOT spin here.
      const claimed = await money.claimOutboxForCommit(row.id);
      if (claimed) return claimAndCommit(claimed, deps, true);
      throw toDispatchError(new AdapterError('external-unreachable', 'command-quarantined-reconciling'));
    }
    case 'held':
      // C-1: a mutable-anchor money doc held for operator resolution (recovery-inconclusive). A retry
      // must NOT re-drive it — surface the non-retryable held signal until an operator clears it.
      throw new AppError('payment command held for operator resolution — not auto-reissued (mutable anchor)', 'command-held');
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
 * The money-idempotency dispatch path (ADR-0058). Enforces the server-side idempotency-key
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
  // M-3 (audit): bind the idempotency key to the payload. A retry that reuses the key with a materially
  // different payload (a DIFFERENT amount/party/references digest) must be REJECTED, never silently
  // reconciled to the original command (which could hide a wrong-amount money doc). Skipped when either
  // digest is absent (P0/P1 / pre-M-3 rows).
  if (row.payloadDigest && money.payloadDigest && row.payloadDigest !== money.payloadDigest) {
    throw toDispatchError(new AdapterError('commit-rejected', 'idempotency-key-payload-mismatch'));
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
  // ADR-0058: an `erpnext`-tier non-read-only command always takes the money-idempotency path
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
