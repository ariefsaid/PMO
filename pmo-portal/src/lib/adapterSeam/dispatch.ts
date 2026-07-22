/**
 * Pure orchestration for externally-owned writes (FR-EAS-023/033/034/042).
 * Relative imports only so the edge-function can import this module directly.
 */
import { AppError } from '../appError.ts';
import { Adapter, AdapterCommand, AdapterError, CommandResult, PmoRecord, type SupersededDocumentMarker } from './contract.ts';
export type { SupersededDocumentMarker } from './contract.ts';

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
  /**
   * FIX 2 (round-9 cross-family SHOULD-FIX): re-assert the recorded actor's CURRENT authorization at a
   * post-window RECOVERY REISSUE — a `quarantined` immutable-anchor claim whose probe MISSES, about to
   * mint a NEW ERP money document. A reissue is a new money write, so it runs the SAME authz rule the
   * synchronous dispatch gate and the first-attempt (`pending`/`failed`) replay run, against the row's
   * recorded actor + the org's CURRENT role/active-membership/domain-ownership. `{ok:false}` HOLDS the
   * row for an operator (never drops it). Absent ⇒ NO re-check: the synchronous path already gated the
   * current caller fresh, and P0/P1/non-money tiers never reissue. It is consulted ONLY on the actual
   * reissue branch — an ADOPT (probe hit) or a mutable-anchor HOLD returns earlier and never calls it,
   * so neither is newly blocked (only the reissue needs the fresh check). */
  reauthorizeRecoveryReissue?: () => Promise<{ ok: boolean; message: string }>;
  /** Injectable monotonic-enough wall clock (ms) for the claim-budget gate below. Defaults to
   *  `Date.now`; tests inject a controllable clock so the budget can be proven against REAL elapsed
   *  time rather than a static relationship between two constants (audit BLOCK 1). */
  now?: () => number;
}

/**
 * The wall-clock budget, measured from the moment this process asks for the claim, within which a
 * claim winner may still ISSUE its ERP `POST` (money-safety audit BLOCK 1).
 *
 * ADR-0058 bounds a duplicate money document with a per-ATTEMPT request deadline, reasoned about as if
 * the POST started at the claim. It does not: the claim winner awaits the recovery PROBE first, and a
 * probe is a GET — so it retries with its own per-attempt deadline. A slow ERP therefore let a
 * claimant reach `adapter.commit` LONG after its row had been quarantined, reclaimed and reissued by
 * the reconciler ⇒ two ERP money documents. The `claim_generation` fence discards the stale
 * claimant's write-BACK; it cannot un-mint its DOCUMENT. Only refusing the POST can.
 *
 * The value must satisfy, against the ERPNext timings in `erpnext/client.ts`:
 *
 *     BUDGET + ERP_REQUEST_TIMEOUT_MS + settle-margin  ≤  ERP_QUARANTINE_WINDOW_MS
 *     60 s   + 120 s                  + 120 s          =  300 s
 *
 * i.e. a POST admitted at the very edge of the budget is still aborted a full 2 minutes before the
 * EARLIEST possible reissue, preserving exactly the settle margin ADR-0058 claimed (a client-side
 * abort does not guarantee an ERP rollback, so the margin — not the abort — carries the guarantee).
 * `client.test.ts` asserts that arithmetic so the two cannot drift apart. Kept here rather than
 * imported because this module is tier-agnostic (no ERPNext vocabulary).
 */
export const MONEY_COMMIT_CLAIM_BUDGET_MS = 60_000;

export type DispatchMoneyWriteDeps = DispatchExternallyOwnedWriteDeps & { money: DispatchMoneyOutboxDeps };

/** The injected clock, or the wall clock. One definition so every elapsed-time decision in this
 *  module reads the SAME source (audit BLOCK 1). */
function nowMs(money: DispatchMoneyOutboxDeps): number {
  return money.now?.() ?? Date.now();
}

/** Propagate the marker across an error conversion — dropping it silently downgrades a "your control is
 *  off" report back into "the push failed". */
function carrySupersededMarker(from: unknown, to: AppError): AppError {
  const id = (from as SupersededDocumentMarker | null | undefined)?.cancelledExternalRecordId;
  if (id) (to as AppError & SupersededDocumentMarker).cancelledExternalRecordId = id;
  return to;
}

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
  await convergeReadModel(canonical, deps, isReplay);
  return deps.money.confirmOutbox(row.id, claimGeneration);
}

/**
 * Write the read-model mirror for an outcome ERP has already committed.
 *
 * Luna BLOCK 3 — retry-idempotent finalization. On a REPLAY (a `committed` row whose previous attempt
 * crashed somewhere in ref → mirror → confirm, or a `confirmed` row an operator is retrying), the
 * mirror insert may already have landed. Its fixed-PK collision is then the CONVERGED state, not a
 * failure: swallowing it lets the replay reach `confirm_outbox`, whereas rethrowing wedges a real ERP
 * money document at `committed` forever (every retry dies on the same duplicate insert → manual
 * intervention).
 *
 * Deliberately NOT tolerated on a FIRST finalize (`isReplay === false`): there, a pre-existing mirror
 * for this PMO record id is a genuine anomaly (e.g. a reused caller-supplied record id) and must
 * surface rather than be confirmed away. Anything that is not a duplicate-key collision always
 * surfaces — a retry that cannot converge must never report success.
 */
async function convergeReadModel(canonical: PmoRecord, deps: DispatchMoneyWriteDeps, isReplay: boolean): Promise<void> {
  try {
    await deps.writeReadModel(canonical);
  } catch (error) {
    if (!isReplay || !isAlreadyMirrored(error)) throw error;
    console.warn(
      `[money-outbox] finalize replay ${deps.command.domain}/${deps.command.record.id}: mirror already present — ` +
        'converging to confirmed (the prior attempt mirrored, then crashed before confirm)',
    );
  }
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
  opts: { claimStartedAtMs: number; isRecoveryReissue?: boolean },
): Promise<CommandResult> {
  const { command, money, adapter } = deps;
  const isRecoveryReissue = opts.isRecoveryReissue ?? false;
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
    // The human's route out is the Admin-only, audited `release_outbox_hold` RPC (migration 0137 §4):
    // it moves the row `held` → `failed`, which is outside `external_command_outbox_one_inflight_per_
    // record` and inside the reconcile/backstop queues, so the ordinary bounded recovery re-runs every
    // gate from scratch. (Audit round 5, HIGH-2: a plain Retry cannot clear a hold — it derives the same
    // key and lands right back here, and a NEW key for this record 409s on that index forever.)
    console.error(
      `[money-outbox] HELD ${command.domain}/${command.record.id} (idempotencyKey=${command.idempotencyKey}) — ` +
        'post-window recovery found no ERP doc but the anchor is mutable; not auto-reissued, awaiting operator ' +
        'resolution (Admin: release_outbox_hold)',
    );
    // A DISTINCT non-retryable code (an AppError passes through toDispatchError unchanged) — never the
    // generic transient 'external-unreachable' (retrying will not help; an operator must resolve it).
    throw new AppError('payment command held for operator resolution — not auto-reissued (mutable anchor)', 'command-held');
  } else {
    // FIX 2 (round-9 SHOULD-FIX): a post-window RECOVERY REISSUE mints a NEW ERP money document, so it
    // must re-assert the recorded actor's CURRENT authorization — the SAME rule the synchronous gate +
    // the first-attempt (`pending`/`failed`) replay run. Those first-attempt POSTs
    // (`isRecoveryReissue === false`) are already gated upstream (`checkOutboxReplayAuthorization` in
    // the sweep's buildReconcileDeps), and the synchronous path leaves this dep undefined (its gate ran
    // fresh for the current caller). The ONE gap this closes is the `quarantined`→reissue transition,
    // which that pre-dispatch check deliberately skips so it does NOT also block an ADOPT of a real ERP
    // doc (the `probed` branch above) or a mutable-anchor HOLD (the branch above) — only the actual
    // reissue reaches here. A demoted / deactivated actor's reissue is HELD for an operator (fenced on
    // the token), surfaced non-silently, and NEVER auto-reissued or dropped.
    if (isRecoveryReissue && money.reauthorizeRecoveryReissue) {
      const auth = await money.reauthorizeRecoveryReissue();
      if (!auth.ok) {
        const heldCount = await money.markOutboxHeld(claimed.id, `recovery-reissue-unauthorized: ${auth.message}`, token);
        if (heldCount === 0) {
          // Fencing loss: another claimant superseded this token before the hold landed — surface the
          // row's CURRENT (possibly confirmed) state, not this claimant's stale hold.
          const fresh = await money.readOutbox(command.domain, command.record.id, command.idempotencyKey!);
          return reconcileOutbox(fresh!, deps);
        }
        console.error(
          `[money-outbox] HELD ${command.domain}/${command.record.id} (idempotencyKey=${command.idempotencyKey}) — ` +
            `recovery reissue blocked: the recorded actor is no longer authorized (${auth.message}); awaiting operator resolution`,
        );
        throw new AppError('money command held for operator resolution — recovery reissue blocked: actor no longer authorized', 'command-held');
      }
    }
    // Audit BLOCK 1 — the CLAIM BUDGET, enforced at the POST SITE against real elapsed time (never
    // inferred from the relationship between two constants). Everything above this point is
    // read-only or a fenced write-back, both of which a supersede makes harmless; `adapter.commit` is
    // the one irreversible act, so it is the one that must be time-gated. If the budget has run out,
    // this claim can already have been quarantined + superseded and the reconciler can already have
    // reissued — POSTing now would mint a SECOND money document (on the shared Purchase-Invoice /
    // Pay-PE path, a second SUBMITTED doc with posted GL/AP, cancel-only and permanent).
    //
    // Bail RETRYABLY and mark NOTHING: the row stays `committing`, becomes reclaimable at lease
    // expiry, and the quarantine/reconcile path owns it from here — exactly as for any other
    // `external-unreachable`.
    const elapsedMs = nowMs(money) - opts.claimStartedAtMs;
    if (elapsedMs >= MONEY_COMMIT_CLAIM_BUDGET_MS) {
      console.error(
        `[money-outbox] REFUSED POST ${command.domain}/${command.record.id} (idempotencyKey=${command.idempotencyKey}) — ` +
          `${elapsedMs}ms elapsed since the claim exceeds the ${MONEY_COMMIT_CLAIM_BUDGET_MS}ms commit budget; ` +
          'this claim may already be superseded and the reconciler owns the row',
      );
      throw toDispatchError(new AdapterError('external-unreachable', 'commit-claim-budget-exhausted'));
    }
    let result: CommandResult;
    try {
      // BLOCK 10 — the check above bounds the ENTRY into commit; it cannot bound a commit that issues
      // SEVERAL external calls (an ERPNext amend is `cancel` PUT → `create` POST, so the money-minting
      // POST is the third call and a slow cancel can carry it past this claim's window). So ARM the
      // command with the absolute deadline this claim was admitted for and let the adapter's transport
      // refuse the non-idempotent write at the POST site. Per-attempt metadata only — the command's
      // identity (domain/operation/record/idempotencyKey, and therefore its payload digest) is unchanged.
      result = await adapter.commit({ ...command, commitDeadlineAtMs: opts.claimStartedAtMs + MONEY_COMMIT_CLAIM_BUDGET_MS });
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
    case 'confirmed': {
      // ⚑ NEW-4(b) (audit round 4, 2026-07-22) — CONVERGE the read-model to the confirmed outcome.
      //
      // A retry that lands here is by definition a REPLAY: a prior attempt already committed to ERP and
      // confirmed the row. Returning the stored result alone left the operator's own recovery affordance
      // inert and, worse, LYING. The user-visible reproduction: the budget push's gate rejects before the
      // outbox (an unmapped category), the mirror is parked `failed`/`held`, the Admin maps the category
      // and clicks "Retry the push" — which re-derives the SAME deterministic key (`budgetPushKey`), so
      // it reads THIS confirmed row, reported success ("Budget pushed to ERPNext"), and never touched the
      // mirror the banner is rendered from. The banner stayed forever, and the sweep backstop excludes
      // `held`, so nothing else would ever clear it either.
      //
      // Convergence is the same act `case 'committed'` has always performed, at the same 23505 tolerance
      // (this IS the replay path). A pre-existing mirror on a FIRST finalize keeps its meaning: still a
      // genuine anomaly, still surfaced.
      //
      // ⛔ NOT via `finalizeOutboxRow`: `recordOutboxRef` is fenced on `state = 'committed'`, so a
      // confirmed row returns 0, the caller reads that as F3 "superseded", re-reads and re-enters
      // `reconcileOutbox` on the same confirmed row — an unbounded recursion. The ref + the confirm are
      // already durably done; the mirror is the ONLY part that can still be behind.
      const canonical: PmoRecord = row.canonical ?? { id: command.record.id };
      await convergeReadModel(canonical, deps, true);
      return { externalRecordId: row.externalRecordId!, canonical };
    }
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
      // BLOCK 1: the budget clock starts BEFORE the claim RPC, so it is never shorter than the real
      // time this process has held the critical section (the DB's own `claimed_at` is stamped inside
      // that RPC, i.e. no earlier than this instant).
      const claimStartedAtMs = nowMs(money);
      const claimed = await money.claimOutboxForCommit(row.id);
      if (claimed) return claimAndCommit(claimed, deps, { claimStartedAtMs, isRecoveryReissue: true });
      throw toDispatchError(new AdapterError('external-unreachable', 'command-quarantined-reconciling'));
    }
    case 'held':
      // C-1: a mutable-anchor money doc held for operator resolution (recovery-inconclusive). A retry
      // must NOT re-drive it — surface the non-retryable held signal until an operator clears it with
      // the Admin-only, audited `release_outbox_hold` RPC (0137 §4, held → failed). That RPC is the ONLY
      // way out: this branch makes a same-key retry inert, and 0134's one-in-flight index makes a
      // NEW-key command for the same PMO record 409 (audit round 5, HIGH-2).
      throw new AppError('payment command held for operator resolution — not auto-reissued (mutable anchor)', 'command-held');
    case 'pending':
    case 'failed': {
      const claimStartedAtMs = nowMs(money);   // BLOCK 1 — see the quarantined branch above.
      const claimed = await money.claimOutboxForCommit(row.id);
      if (claimed) return claimAndCommit(claimed, deps, { claimStartedAtMs });
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

/**
 * WIRE 4 — the 0116 partial unique index `external_command_outbox_one_inflight_per_record` (at most ONE
 * non-terminal outbox row per (org, domain, pmo_record_id)) is the barrier against two concurrent
 * creates minting two ERP documents for one PMO record. Its violation carries a DIFFERENT idempotency
 * key than the row already in flight, so the read-the-winner branch above finds nothing and the raw
 * Postgres error would escape verbatim — a 500 naming an internal index, which tells the caller neither
 * what happened nor what to do. Classified here into a distinct, actionable conflict code (mapped to
 * HTTP 409 by adapter-dispatch).
 *
 * Detected on the pg CODE **and** the constraint name: the code alone covers every unique index on the
 * table (and the mirror tables), and the name alone would match any message that merely mentions it.
 */
const OUTBOX_IN_FLIGHT_INDEX = 'external_command_outbox_one_inflight_per_record';
export const COMMAND_IN_FLIGHT_FOR_RECORD = 'command-in-flight-for-record';

function isOutboxInFlightConflict(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; details?: unknown } | null | undefined;
  if (e?.code !== '23505') return false;
  const text = `${typeof e.message === 'string' ? e.message : ''} ${typeof e.details === 'string' ? e.details : ''}`;
  return text.includes(OUTBOX_IN_FLIGHT_INDEX);
}

/** A structurally-present string `code`, or undefined. Mirrors `appError.ts`'s private `readCode`. */
function readThrownCode(error: unknown): string | undefined {
  const candidate = (error as { code?: unknown } | null | undefined)?.code;
  return typeof candidate === 'string' ? candidate : undefined;
}

/** Exported (LOW-1, audit round 5) so the served `adapter-dispatch` fn's ADAPTER-SELECT exit classifies
 *  a thrown value with the SAME rule as its dispatch exit — a hand-rolled `new AppError(err.message)`
 *  there dropped the `.code` of a plain-`Error` subclass (`BudgetCategoryUnmappedError`, thrown from
 *  `resolveBudgetRefs`'s pre-flight) and turned a precise 422 into a bare, code-less 400. */
export function toDispatchError(error: unknown): AppError {
  if (isOutboxInFlightConflict(error)) {
    return new AppError(
      'another command for this record is already in flight — wait for it to settle (or resolve it) before dispatching again',
      COMMAND_IN_FLIGHT_FOR_RECORD,
    );
  }
  if (error instanceof AppError) return error;
  if (error instanceof AdapterError) {
    // ⚑ HIGH-1 (audit round 5) — an ABANDONED-AMEND failure carries a PMO-authored message that states
    // what the external system NOW HOLDS ("the superseded ERPNext Budget "X" is already CANCELLED and its
    // replacement did not land … ERPNext is therefore enforcing NO budget for this grain right now").
    // That sentence is the whole point of the finding: "external system unreachable — try again" does not
    // tell an operator their overspend control is currently OFF. The generic text exists so a raw ERP
    // body never reaches a client; this message is ours, so it is kept verbatim and the marker travels
    // with it (`recordBudgetPushFailure` records the money statement off it).
    const superseded = (error as AdapterError & SupersededDocumentMarker).cancelledExternalRecordId;
    if (error.code === 'external-unreachable' && !superseded) {
      return new AppError('external system unreachable — try again', error.code);
    }
    return carrySupersededMarker(error, new AppError(error.message, error.code));
  }
  // ⚑ Preserve a structurally-present string `.code` — the SAME rule `appError.ts:toAppError` applies.
  // Dropping it turned every non-AppError/AdapterError class that carries one (P3c's
  // `BudgetCategoryUnmappedError` is a plain `Error` subclass with
  // `code = 'budget-category-unmapped'`) into a code-less AppError, which then missed the edge fn's
  // status mapping and became a bare 500 — an opaque, retryable-looking server error in place of a
  // precise NON-RETRYABLE refusal an operator must act on (no amount of retrying creates a map row).
  if (error instanceof Error) return new AppError(error.message, readThrownCode(error));
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
