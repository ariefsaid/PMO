/**
 * AC-ENA-012, FR-ENA-041/043 — the money-idempotency outbox + atomic recovery (ADR-0058 §4).
 * Pure unit tests, mocked outbox/adapter deps (a lightweight in-memory fake outbox reproducing the
 * DB's guarded semantics — `claim_outbox_for_commit`'s conditional UPDATE + the `claim_generation`
 * fencing token — so the concurrency proofs are meaningful without a real DB; the equivalent proof
 * against the real DB is the 1.7 pgTAP band).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  dispatchExternallyOwnedWrite,
  dispatchMoneyWrite,
  redactErrorForOutbox,
  MONEY_COMMIT_CLAIM_BUDGET_MS,
  type DispatchMoneyOutboxDeps,
  type OutboxRow,
} from './dispatch.ts';
import { AdapterError, type AdapterCommand, type CommandResult } from './contract.ts';
import { AppError } from '../appError.ts';

const LEASE_MS = 60_000;
const WINDOW_MS = 5 * 60_000;

/** An in-memory fake reproducing `claim_outbox_for_commit`/`quarantine_committing`'s guarantees
 *  (0095): a conditional transition into `committing` that only one caller can win per id, the
 *  quarantine of a stale `committing` row (F1 — never a blind re-POST), plus the `claim_generation`
 *  fencing token guarding every subsequent write-back. */
function createFakeOutbox(opts: { reissueOnInconclusiveAbsence?: boolean } = {}) {
  const rows = new Map<string, OutboxRow & { updatedAt: number; claimedAt: number | null; reconcileAfter: number | null }>();
  const byTuple = new Map<string, string>();
  const probes = new Map<string, { externalRecordId: string }>();
  const refs: Array<{ pmoRecordId: string; externalTier: string; externalRecordId: string; domain: string }> = [];
  let seq = 0;
  const tupleKey = (domain: string, pmoRecordId: string, idempotencyKey: string) =>
    `${domain}::${pmoRecordId}::${idempotencyKey}`;

  const deps: DispatchMoneyOutboxDeps = {
    async readOutbox(domain, pmoRecordId, idempotencyKey) {
      const id = byTuple.get(tupleKey(domain, pmoRecordId, idempotencyKey));
      if (!id) return null;
      const { updatedAt: _u, claimedAt: _c, reconcileAfter: _r, ...row } = rows.get(id)!;
      return { ...row };
    },
    async insertOutboxPending(domain, pmoRecordId, idempotencyKey) {
      const k = tupleKey(domain, pmoRecordId, idempotencyKey);
      if (byTuple.has(k)) {
        const err = new Error('duplicate key value violates unique constraint "external_command_outbox_org_id_domain_pmo_record_id_idemp"') as Error & { code?: string };
        err.code = '23505';
        throw err;
      }
      const id = `outbox-${++seq}`;
      const row: OutboxRow & { updatedAt: number; claimedAt: number | null; reconcileAfter: number | null } = {
        id, domain, pmoRecordId, idempotencyKey,
        state: 'pending', externalRecordId: null, canonical: null, claimGeneration: 0, payloadDigest: null,
        updatedAt: Date.now(), claimedAt: null, reconcileAfter: null,
      };
      rows.set(id, row);
      byTuple.set(k, id);
      const { updatedAt: _u, claimedAt: _c, reconcileAfter: _r, ...result } = row;
      return { ...result };
    },
    async claimOutboxForCommit(id) {
      const row = rows.get(id);
      if (!row) return null;
      // F1: `committing` is NEVER reclaimed here (that is `quarantineCommitting`'s job). Claimable =
      // pending/failed, or a quarantined row whose visibility window (reconcile_after) has elapsed.
      const quarantineReady = row.state === 'quarantined' && row.reconcileAfter !== null && Date.now() >= row.reconcileAfter;
      if (row.state !== 'pending' && row.state !== 'failed' && !quarantineReady) return null;
      row.state = 'committing';
      row.claimGeneration += 1;
      row.claimedAt = Date.now();
      row.updatedAt = Date.now();
      const { updatedAt: _u, claimedAt: _c, reconcileAfter: _r, ...result } = row;
      return { ...result };
    },
    async quarantineCommitting(id) {
      const row = rows.get(id);
      if (!row) return null;
      // Only a STALE (past-lease) committing row is quarantinable; a fresh one has a live owner.
      if (!(row.state === 'committing' && Date.now() - row.updatedAt > LEASE_MS)) return null;
      row.state = 'quarantined';
      row.claimGeneration += 1;   // fence the stale claimant's late write-back (F4)
      row.reconcileAfter = (row.claimedAt ?? Date.now()) + WINDOW_MS;
      row.updatedAt = Date.now();
      const { updatedAt: _u, claimedAt: _c, reconcileAfter: _r, ...result } = row;
      return { ...result };
    },
    async markOutboxCommitted(id, externalRecordId, canonical, claimGeneration) {
      const row = rows.get(id);
      if (!row || row.claimGeneration !== claimGeneration) return 0;
      row.state = 'committed';
      row.externalRecordId = externalRecordId;
      row.canonical = canonical;   // F2: persist the adapter's real returned record
      row.updatedAt = Date.now();
      return 1;
    },
    // H-1: the fenced external_refs upsert (state stays committed). 0 rows when superseded/not committed.
    async recordOutboxRef(id, claimGeneration, mapping) {
      const row = rows.get(id);
      if (!row || row.claimGeneration !== claimGeneration || row.state !== 'committed') return 0;
      refs.push({ ...mapping });
      row.updatedAt = Date.now();
      return 1;
    },
    // H-1: the fenced committed→confirmed promotion (run LAST, after the mirror).
    async confirmOutbox(id, claimGeneration) {
      const row = rows.get(id);
      if (!row || row.claimGeneration !== claimGeneration || row.state !== 'committed') return 0;
      row.state = 'confirmed';
      row.updatedAt = Date.now();
      return 1;
    },
    // C-1: the fenced committing→held transition for a recovery-inconclusive PE.
    async markOutboxHeld(id, reason, claimGeneration) {
      const row = rows.get(id);
      if (!row || row.claimGeneration !== claimGeneration || row.state !== 'committing') return 0;
      row.state = 'held';
      row.updatedAt = Date.now();
      void reason;
      return 1;
    },
    reissueOnInconclusiveAbsence: opts.reissueOnInconclusiveAbsence ?? true,
    async markOutboxFailed(id, _lastError, claimGeneration) {
      const row = rows.get(id);
      if (!row || row.claimGeneration !== claimGeneration) return 0;
      row.state = 'failed';
      row.updatedAt = Date.now();
      return 1;
    },
    async probeByRemarksKey(domain, idempotencyKey) {
      return probes.get(`${domain}::${idempotencyKey}`) ?? null;
    },
    // A REAL (tiny) macrotask delay, not an instant microtask resolve — an all-microtask retry
    // loop can starve the event loop's macrotask queue (setTimeout-based test helpers included)
    // under tight concurrent polling, which is exactly what the reissue-race test exercises.
    backoff: vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 1))),
  };

  return {
    deps,
    rows,
    refs,
    setProbe: (domain: string, idempotencyKey: string, result: { externalRecordId: string }) =>
      probes.set(`${domain}::${idempotencyKey}`, result),
    backdate: (id: string, ms: number) => {
      const row = rows.get(id)!;
      row.updatedAt = Date.now() - ms;
    },
    /** Fast-forward past a quarantined row's visibility window so the reconciliation path may claim it. */
    elapseWindow: (id: string) => {
      const row = rows.get(id)!;
      row.reconcileAfter = Date.now() - 1;
    },
  };
}

function erpnextAdapter(commit: (c: AdapterCommand) => Promise<CommandResult>) {
  return { tier: 'erpnext', capabilityMap: new Set(['procurement']), commit };
}

const baseCommand: AdapterCommand = {
  domain: 'procurement',
  operation: 'create',
  record: { id: 'pmo-1' },
  idempotencyKey: 'key-1',
};

describe('AC-ENA-012 server-side idempotency-key enforcement (FR-ENA-040)', () => {
  it('a non-read-only erpnext command with no idempotencyKey is rejected before any outbox/ERP call', async () => {
    const fake = createFakeOutbox();
    const commit = vi.fn();
    const readOutboxSpy = vi.spyOn(fake.deps, 'readOutbox');
    await expect(
      dispatchExternallyOwnedWrite({
        adapter: erpnextAdapter(commit),
        command: { ...baseCommand, idempotencyKey: undefined },
        writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
        money: fake.deps,
      }),
    ).rejects.toMatchObject({ code: 'commit-rejected', message: 'missing-idempotency-key' });
    expect(commit).not.toHaveBeenCalled();
    expect(readOutboxSpy).not.toHaveBeenCalled();
  });

  it('a P0/P1-tier command with no key still takes the non-money path (byte-for-byte)', async () => {
    const commit = vi.fn(async () => ({ externalRecordId: 'ext-1', canonical: { id: 'pmo-1' } }));
    const writeReadModel = vi.fn();
    const recordExternalRef = vi.fn();
    const result = await dispatchExternallyOwnedWrite({
      adapter: { tier: 'clickup', capabilityMap: new Set(['tasks']), commit },
      command: { domain: 'tasks', operation: 'create', record: { id: 'pmo-1' } },
      writeReadModel, recordExternalRef,
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(writeReadModel).toHaveBeenCalledWith({ id: 'pmo-1' });
    expect(result.externalRecordId).toBe('ext-1');
  });
});

describe('AC-ENA-012 fresh key: INSERT pending → claim → POST → committed → mirror+ref → confirmed', () => {
  it('commits end-to-end and leaves the outbox row confirmed', async () => {
    const fake = createFakeOutbox();
    const commit = vi.fn(async () => ({ externalRecordId: 'PI-0001', canonical: { id: 'pmo-1', total: '100.00' } }));
    const writeReadModel = vi.fn();
    const recordExternalRef = vi.fn();
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel, recordExternalRef,
      money: fake.deps,
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(writeReadModel).toHaveBeenCalledTimes(1);
    // H-1: external_refs is now written INSIDE the fenced record_outbox_ref RPC (not the caller's
    // recordExternalRef dep) — the money path no longer calls recordExternalRef directly.
    expect(recordExternalRef).not.toHaveBeenCalled();
    expect(fake.refs[0]).toEqual({
      pmoRecordId: 'pmo-1', externalTier: 'erpnext', externalRecordId: 'PI-0001', domain: 'procurement',
    });
    expect(result.externalRecordId).toBe('PI-0001');
    const row = [...fake.rows.values()][0];
    expect(row.state).toBe('confirmed');
    expect(row.claimGeneration).toBe(1);
  });
});

describe('AC-ENA-012 concurrent duplicate insert: the unique 4-tuple rejects atomically, then reconciles', () => {
  it('a 23505 on insert re-reads the winner row and reconciles to it (no second create)', async () => {
    const fake = createFakeOutbox();
    // Pre-seed the "winner" row as if another request already inserted it and confirmed.
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const claimed = await fake.deps.claimOutboxForCommit([...fake.rows.keys()][0]);
    await fake.deps.markOutboxCommitted(claimed!.id, 'PI-0001', { id: 'pmo-1' }, claimed!.claimGeneration);
    await fake.deps.recordOutboxRef(claimed!.id, claimed!.claimGeneration, { pmoRecordId: 'pmo-1', externalTier: 'erpnext', externalRecordId: 'PI-0001', domain: 'procurement' });
    await fake.deps.confirmOutbox(claimed!.id, claimed!.claimGeneration);

    const commit = vi.fn();
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
      money: fake.deps,
    });
    expect(commit).not.toHaveBeenCalled();
    expect(result.externalRecordId).toBe('PI-0001');
  });
});

describe("AC-ENA-012 the reissue race is closed: two concurrent retries of the SAME key never both POST", () => {
  it('only the claim winner POSTs; the loser re-reads and finalizes to the winner\'s result', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');

    let resolveCommit: (r: CommandResult) => void;
    const commit = vi.fn(() => new Promise<CommandResult>((resolve) => { resolveCommit = resolve; }));
    const writeReadModel = vi.fn();
    const recordExternalRef = vi.fn();

    // caller A starts (will win the claim — first to call claimOutboxForCommit).
    const callA = dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel, recordExternalRef,
      money: fake.deps,
    });
    // let A reach and win the claim before B starts.
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

    // caller B retries the same key concurrently — the row is now 'committing' (fresh, not stale)
    // so B's claim attempt must return null and B must NOT call adapter.commit.
    const callB = dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel, recordExternalRef,
      money: fake.deps,
    });

    // Let B observe the fresh-committing state and back off at least once before A finishes.
    await vi.waitFor(() => expect((fake.deps.backoff as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0));

    // Now let A's POST resolve.
    resolveCommit!({ externalRecordId: 'PI-0001', canonical: { id: 'pmo-1' } });

    const [resultA, resultB] = await Promise.all([callA, callB]);
    expect(commit).toHaveBeenCalledTimes(1); // the critical assertion: B never POSTed
    expect(resultA.externalRecordId).toBe('PI-0001');
    expect(resultB.externalRecordId).toBe('PI-0001');
    const row = [...fake.rows.values()][0];
    expect(row.state).toBe('confirmed');
  });
});

describe('AC-ENA-012 the fencing token closes the lease-expiry overlap (F4)', () => {
  it("a stale claimant's write-back with an outdated claim_generation affects 0 rows and is discarded", async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];

    // The original (stale) claimant wins claim gen=1, then goes quiet past the lease.
    const staleClaim = await fake.deps.claimOutboxForCommit(id);
    expect(staleClaim!.claimGeneration).toBe(1);
    fake.backdate(id, LEASE_MS + 1);

    // A reclaimer supersedes the stale committing row by QUARANTINING it (F1 — a committing row is
    // never reclaimed+re-POSTed) — gen bumps to 2 — then, past the window, claims (gen=3) and finishes.
    const quarantined = await fake.deps.quarantineCommitting(id);
    expect(quarantined!.claimGeneration).toBe(2);
    fake.elapseWindow(id);
    const reclaimed = await fake.deps.claimOutboxForCommit(id);
    expect(reclaimed!.claimGeneration).toBe(3);
    await fake.deps.markOutboxCommitted(id, 'PI-0001', { id: 'pmo-1' }, 3);
    await fake.deps.recordOutboxRef(id, 3, { pmoRecordId: 'pmo-1', externalTier: 'erpnext', externalRecordId: 'PI-0001', domain: 'procurement' });
    await fake.deps.confirmOutbox(id, 3);

    // The stale claimant's late write-back, still holding gen=1, must affect 0 rows.
    const staleCommittedCount = await fake.deps.markOutboxCommitted(id, 'PI-DUPLICATE', { id: 'pmo-1' }, 1);
    expect(staleCommittedCount).toBe(0);
    // ...and must NOT have clobbered the reclaimer's state.
    const row = [...fake.rows.values()][0];
    expect(row.state).toBe('confirmed');
    expect(row.externalRecordId).toBe('PI-0001');
  });

  it('dispatchMoneyWrite itself discards a superseded write-back (no finalize, no duplicate mirror)', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];

    // Simulate: this claimant already won gen=1 and its ERP POST is in flight...
    const claimed = await fake.deps.claimOutboxForCommit(id);
    expect(claimed!.claimGeneration).toBe(1);
    // ...but a reclaimer supersedes it before the write-back lands (bump the row to gen=2 directly,
    // simulating another process's successful claim+commit+confirm while this claimant was stalled).
    fake.rows.get(id)!.claimGeneration = 2;
    fake.rows.get(id)!.state = 'confirmed';
    fake.rows.get(id)!.externalRecordId = 'PI-RECLAIMED';

    const writeReadModel = vi.fn();
    const recordExternalRef = vi.fn();
    // Drive the stale claimant's post-claim write-back directly (the code path dispatchMoneyWrite
    // would take after adapter.commit() resolves for a claim it no longer owns).
    const staleCommittedCount = await fake.deps.markOutboxCommitted(id, 'PI-DUPLICATE', { id: 'pmo-1' }, claimed!.claimGeneration);
    expect(staleCommittedCount).toBe(0);
    // A superseded write-back must never call the finalize side-effects.
    expect(writeReadModel).not.toHaveBeenCalled();
    expect(recordExternalRef).not.toHaveBeenCalled();
  });

  it('H-1: finalization is DB-fenced — a claimant superseded before the fenced RPC writes NO mirror/ref', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    const claimed = await fake.deps.claimOutboxForCommit(id);
    // ERP committed under this claimant's token; the row is `committed`, finalize not yet run.
    await fake.deps.markOutboxCommitted(id, 'PI-0001', { id: 'pmo-1', erp_total: '5.00' }, claimed!.claimGeneration);

    // Simulate a reclaimer superseding this claimant at the fenced ref RPC: it returns 0 (0-row no-op
    // — the reclaimer has confirmed the row itself under a bumped generation). The superseded claimant
    // must then write NO read-model mirror (mirror is gated on this) and reconcile off the reclaimer.
    vi.spyOn(fake.deps, 'recordOutboxRef').mockImplementationOnce(async () => {
      const r = fake.rows.get(id)!;
      r.state = 'confirmed';
      r.claimGeneration += 1;
      r.externalRecordId = 'PI-RECLAIMED';
      r.canonical = { id: 'pmo-1', erp_total: '5.00', erp_status: 'Submitted' };
      return 0;
    });

    const writeReadModel = vi.fn();
    const recordExternalRef = vi.fn();
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(vi.fn()),
      command: baseCommand,
      writeReadModel, recordExternalRef,
      money: fake.deps,
    });
    // The superseded claimant's finalize wrote NOTHING; the recovery reconciled off the reclaimer's state.
    expect(writeReadModel).not.toHaveBeenCalled();
    expect(recordExternalRef).not.toHaveBeenCalled();
    expect(result.externalRecordId).toBe('PI-RECLAIMED');
    expect([...fake.rows.values()][0].state).toBe('confirmed');
  });
});

describe('AC-ENA-012 confirmed retry — return the stored result, no ERP call, no claim', () => {
  it('returns the stored result without calling adapter.commit or claimOutboxForCommit', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    const claimed = await fake.deps.claimOutboxForCommit(id);
    await fake.deps.markOutboxCommitted(id, 'PI-0001', { id: 'pmo-1' }, claimed!.claimGeneration);
    await fake.deps.recordOutboxRef(id, claimed!.claimGeneration, { pmoRecordId: 'pmo-1', externalTier: 'erpnext', externalRecordId: 'PI-0001', domain: 'procurement' });
    await fake.deps.confirmOutbox(id, claimed!.claimGeneration);

    const commit = vi.fn();
    const claimSpy = vi.spyOn(fake.deps, 'claimOutboxForCommit');
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
      money: fake.deps,
    });
    expect(commit).not.toHaveBeenCalled();
    expect(claimSpy).not.toHaveBeenCalled();
    expect(result.externalRecordId).toBe('PI-0001');
  });
});

describe('AC-ENA-012 committed retry — finalize only, no second commit, no claim', () => {
  it('re-runs only the finalization (mirror + ref) and promotes to confirmed', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    const claimed = await fake.deps.claimOutboxForCommit(id);
    await fake.deps.markOutboxCommitted(id, 'PI-0001', { id: 'pmo-1' }, claimed!.claimGeneration);
    // NOTE: no markOutboxConfirmed — simulates the finalize step failing after the ERP commit.

    const commit = vi.fn();
    const claimSpy = vi.spyOn(fake.deps, 'claimOutboxForCommit');
    const writeReadModel = vi.fn();
    const recordExternalRef = vi.fn();
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel, recordExternalRef,
      money: fake.deps,
    });
    expect(commit).not.toHaveBeenCalled();
    expect(claimSpy).not.toHaveBeenCalled();
    expect(writeReadModel).toHaveBeenCalledTimes(1);
    // H-1: external_refs finalized inside the fenced RPC, not via the caller's recordExternalRef.
    expect(recordExternalRef).not.toHaveBeenCalled();
    expect(fake.refs).toHaveLength(1);
    expect(result.externalRecordId).toBe('PI-0001');
    expect([...fake.rows.values()][0].state).toBe('confirmed');
  });

  // Luna BLOCK 3 — finalization must be RETRY-IDEMPOTENT. The finalize order is
  // record_outbox_ref → mirror → confirm_outbox. A crash AFTER the mirror insert but BEFORE the
  // confirm leaves the row `committed`; the retry re-enters the SAME fixed-PK mirror INSERT, which
  // now collides (Postgres 23505). Without convergence the row can NEVER reach `confirmed`: the ERP
  // money document exists, but PMO retries forever — a stuck money row needing manual intervention.
  it('a committed replay whose mirror ALREADY exists (23505) converges to confirmed instead of erroring', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    const claimed = await fake.deps.claimOutboxForCommit(id);
    const erpCanonical = { id: 'pmo-1', erp_total: '250.00' };
    await fake.deps.markOutboxCommitted(id, 'PI-0001', erpCanonical, claimed!.claimGeneration);
    // the prior attempt got as far as the mirror insert, then crashed before confirm_outbox.
    const alreadyMirrored = vi.fn(async () => {
      throw new AppError('duplicate key value violates unique constraint "sales_invoices_pkey"', '23505');
    });

    const commit = vi.fn();
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel: alreadyMirrored, recordExternalRef: vi.fn(),
      money: fake.deps,
    });
    expect(commit).not.toHaveBeenCalled();          // never a second ERP create
    expect(alreadyMirrored).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ externalRecordId: 'PI-0001', canonical: erpCanonical });
    expect([...fake.rows.values()][0].state).toBe('confirmed');   // converged, not stuck
  });

  it('a committed replay whose mirror fails for ANY OTHER reason still surfaces the error and stays committed', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    const claimed = await fake.deps.claimOutboxForCommit(id);
    await fake.deps.markOutboxCommitted(id, 'PI-0001', { id: 'pmo-1' }, claimed!.claimGeneration);
    const mirrorDown = vi.fn(async () => {
      throw new AppError('null value in column "project_id" violates not-null constraint', '23502');
    });

    await expect(
      dispatchMoneyWrite({
        adapter: erpnextAdapter(vi.fn()),
        command: baseCommand,
        writeReadModel: mirrorDown, recordExternalRef: vi.fn(),
        money: fake.deps,
      }),
    ).rejects.toMatchObject({ code: '23502' });
    expect([...fake.rows.values()][0].state).toBe('committed');   // NOT confirmed — still needs a real finalize
  });

  it('a FIRST finalize (fresh claim + POST) does NOT tolerate a 23505 mirror — an unexpected pre-existing row is surfaced', async () => {
    const fake = createFakeOutbox();
    const commit = vi.fn(async () => ({ externalRecordId: 'PI-0001', canonical: { id: 'pmo-1' } }));
    // On the FIRST finalize the mirror cannot legitimately pre-exist (a crash after the mirror leaves
    // the row `committed`, which takes the replay branch above). A 23505 here means the PMO record id
    // already had a mirror row — a real anomaly that must NOT be silently confirmed.
    const collidingMirror = vi.fn(async () => {
      throw new AppError('duplicate key value violates unique constraint "sales_invoices_pkey"', '23505');
    });

    await expect(
      dispatchMoneyWrite({
        adapter: erpnextAdapter(commit),
        command: baseCommand,
        writeReadModel: collidingMirror, recordExternalRef: vi.fn(),
        money: fake.deps,
      }),
    ).rejects.toMatchObject({ code: '23505' });
    expect([...fake.rows.values()][0].state).toBe('committed');
  });
});

describe('AC-ENA-012 F2 finalization mirrors the adapter\'s REAL canonical, not a {id} stub', () => {
  it('a fresh commit persists the adapter canonical → the mirror + returned record carry the ERP-derived fields', async () => {
    const fake = createFakeOutbox();
    const erpCanonical = { id: 'pmo-1', erp_total: '100.00', erp_status: 'Submitted', outstanding: '100.00' };
    const commit = vi.fn(async () => ({ externalRecordId: 'PI-0001', canonical: erpCanonical }));
    const writeReadModel = vi.fn();
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel, recordExternalRef: vi.fn(),
      money: fake.deps,
    });
    // The read-model mirror is written with the adapter's real record (ERP-derived fields), not a stub.
    expect(writeReadModel).toHaveBeenCalledWith(erpCanonical);
    expect(result.canonical).toEqual(erpCanonical);
    // ...and the outbox row persisted it, so a later recovery can replay the same record.
    expect([...fake.rows.values()][0].canonical).toEqual(erpCanonical);
  });

  it('a recovered (committed→finalize) command mirrors the PERSISTED canonical, not a reconstructed {id} stub', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    const claimed = await fake.deps.claimOutboxForCommit(id);
    const erpCanonical = { id: 'pmo-1', erp_total: '250.00', erp_status: 'Submitted' };
    // ERP committed with its real record, but the finalize (mirror/ref) failed → row stuck `committed`.
    await fake.deps.markOutboxCommitted(id, 'PI-0001', erpCanonical, claimed!.claimGeneration);

    const commit = vi.fn();
    const writeReadModel = vi.fn();
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel, recordExternalRef: vi.fn(),
      money: fake.deps,
    });
    expect(commit).not.toHaveBeenCalled();
    // The recovery mirrors the REAL persisted canonical — a `{ id: 'pmo-1' }` stub would drop erp_total/status.
    expect(writeReadModel).toHaveBeenCalledWith(erpCanonical);
    expect(result.canonical).toEqual(erpCanonical);
  });

  it('a confirmed retry returns the PERSISTED canonical (no ERP call)', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    const claimed = await fake.deps.claimOutboxForCommit(id);
    const erpCanonical = { id: 'pmo-1', erp_total: '9.99', erp_status: 'Paid' };
    await fake.deps.markOutboxCommitted(id, 'PI-0001', erpCanonical, claimed!.claimGeneration);
    await fake.deps.recordOutboxRef(id, claimed!.claimGeneration, { pmoRecordId: 'pmo-1', externalTier: 'erpnext', externalRecordId: 'PI-0001', domain: 'procurement' });
    await fake.deps.confirmOutbox(id, claimed!.claimGeneration);

    const commit = vi.fn();
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
      money: fake.deps,
    });
    expect(commit).not.toHaveBeenCalled();
    expect(result.canonical).toEqual(erpCanonical);
  });
});

describe('AC-ENA-012 pending/failed/stale-committing retry: claim first, then adopt-or-POST', () => {
  it('pending + probe finds an orphaned doc → adopts it (no POST)', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    fake.setProbe('procurement', 'key-1', { externalRecordId: 'PI-ORPHAN' });

    const commit = vi.fn();
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
      money: fake.deps,
    });
    expect(commit).not.toHaveBeenCalled();
    expect(result.externalRecordId).toBe('PI-ORPHAN');
    expect([...fake.rows.values()][0].state).toBe('confirmed');
  });

  it('failed + probe empty → claims and POSTs (reissue is safe once claimed)', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    const claimed = await fake.deps.claimOutboxForCommit(id);
    await fake.deps.markOutboxFailed(id, 'external-unreachable', claimed!.claimGeneration);

    const commit = vi.fn(async () => ({ externalRecordId: 'PI-0002', canonical: { id: 'pmo-1' } }));
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
      money: fake.deps,
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(result.externalRecordId).toBe('PI-0002');
  });

  it('stale committing → quarantined (never reclaimed+re-POSTed); after the window with NO ERP hit, reissues under the same key', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    await fake.deps.claimOutboxForCommit(id); // simulate a dead claimant, never finished
    fake.backdate(id, LEASE_MS + 1);

    const commit = vi.fn(async () => ({ externalRecordId: 'PI-0003', canonical: { id: 'pmo-1' } }));
    // First retry: the stale committing row is QUARANTINED (no POST — its ERP write could be in
    // flight) and the caller gets a retryable "reconciling" (the window has not yet elapsed).
    await expect(
      dispatchMoneyWrite({
        adapter: erpnextAdapter(commit),
        command: baseCommand,
        writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
        money: fake.deps,
      }),
    ).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(commit).not.toHaveBeenCalled();
    expect([...fake.rows.values()][0].state).toBe('quarantined');
    expect([...fake.rows.values()][0].claimGeneration).toBe(2); // quarantine fenced the stale claimant

    // The visibility window elapses and NO ERP doc was ever created (probe empty) → the reconciliation
    // path reissues under the SAME idempotency key.
    fake.elapseWindow(id);
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
      money: fake.deps,
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(result.externalRecordId).toBe('PI-0003');
    expect([...fake.rows.values()][0].state).toBe('confirmed');
  });

  it('F1 in-flight-POST overlap: a slow claimant POST lands after reclaim → reconciliation ADOPTS it via the remarks key → NO second POST, exactly one money doc', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    // Claimant A wins the claim (gen=1) and its ERP POST is IN FLIGHT — not yet probe-visible.
    const aClaim = await fake.deps.claimOutboxForCommit(id);
    expect(aClaim!.claimGeneration).toBe(1);
    // A's lease expires while its POST is still travelling to ERP.
    fake.backdate(id, LEASE_MS + 1);

    // The reclaimer (sync retry / sweep) reconciles the stale committing row. It MUST NOT re-POST —
    // it quarantines the row and surfaces a retryable (window not yet elapsed).
    const reclaimerCommit = vi.fn();
    await expect(
      dispatchMoneyWrite({
        adapter: erpnextAdapter(reclaimerCommit),
        command: baseCommand,
        writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
        money: fake.deps,
      }),
    ).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(reclaimerCommit).not.toHaveBeenCalled();
    expect([...fake.rows.values()][0].state).toBe('quarantined');

    // Now A's slow POST lands — the money doc becomes visible via its stamped remarks key.
    fake.setProbe('procurement', 'key-1', { externalRecordId: 'PI-INFLIGHT' });
    // The visibility window elapses; the reconciliation path resolves the quarantined row.
    fake.elapseWindow(id);
    const writeReadModel = vi.fn();
    const recordExternalRef = vi.fn();
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(reclaimerCommit),
      command: baseCommand,
      writeReadModel, recordExternalRef,
      money: fake.deps,
    });
    // The reclaimer ADOPTS A's doc via the probe — it never POSTs a second doc.
    expect(reclaimerCommit).not.toHaveBeenCalled();
    expect(result.externalRecordId).toBe('PI-INFLIGHT');
    expect([...fake.rows.values()][0].state).toBe('confirmed');
  });

  it('a committing-fresh row (another live owner) never POSTs — backs off and re-reads', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    await fake.deps.claimOutboxForCommit(id); // an in-flight owner, well within lease

    // schedule the owner to finish shortly after we start reconciling, so the backoff loop
    // eventually observes a terminal state instead of spinning forever.
    setTimeout(async () => {
      await fake.deps.markOutboxCommitted(id, 'PI-0004', { id: 'pmo-1' }, 1);
      await fake.deps.recordOutboxRef(id, 1, { pmoRecordId: 'pmo-1', externalTier: 'erpnext', externalRecordId: 'PI-0004', domain: 'procurement' });
    await fake.deps.confirmOutbox(id, 1);
    }, 5);

    const commit = vi.fn();
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
      money: { ...fake.deps, backoff: async () => new Promise((r) => setTimeout(r, 10)) },
    });
    expect(commit).not.toHaveBeenCalled();
    expect(result.externalRecordId).toBe('PI-0004');
  });
});

describe('M-4: an ERP error is redacted + bounded before it is persisted to the outbox last_error', () => {
  it('scrubs long token-shaped runs (secret_ref/keys) and caps the length', () => {
    const secretish = 'ERPNEXT_SITE_A_API_SECRET_abcdef0123456789abcdef0123456789';
    const out = redactErrorForOutbox(new AdapterError('commit-rejected', `auth failed for ${secretish}`));
    expect(out).not.toContain(secretish);
    expect(out).toContain('[redacted]');
    expect(out.startsWith('commit-rejected:')).toBe(true);
  });

  it('truncates a verbose traceback to a bounded length', () => {
    const out = redactErrorForOutbox(new Error('x'.repeat(1000)));
    expect(out.length).toBeLessThanOrEqual(241);
  });

  it('the failed-mark path persists the REDACTED message (not the raw ERP body)', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const failedSpy = vi.spyOn(fake.deps, 'markOutboxFailed');
    const commit = vi.fn(async () => { throw new AdapterError('commit-rejected', 'ValidationError token=abcdef0123456789abcdef0123456789'); });
    await expect(
      dispatchMoneyWrite({ adapter: erpnextAdapter(commit), command: baseCommand, writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money: fake.deps }),
    ).rejects.toBeInstanceOf(AppError);
    const persisted = failedSpy.mock.calls[0][1];
    expect(persisted).not.toContain('abcdef0123456789abcdef0123456789');
    expect(persisted).toContain('[redacted]');
  });
});

describe('M-3: the idempotency key is bound to the payload — reuse with a different payload is rejected', () => {
  it('a retry reusing the key with a DIFFERENT payload digest is rejected (never reconciled to the original)', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    fake.rows.get(id)!.payloadDigest = 'digest-of-the-ORIGINAL-amount';

    const commit = vi.fn();
    await expect(
      dispatchMoneyWrite({
        adapter: erpnextAdapter(commit),
        command: baseCommand,
        writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
        // The incoming command carries a DIFFERENT digest (e.g. a tampered/changed amount).
        money: { ...fake.deps, payloadDigest: 'digest-of-a-DIFFERENT-amount' },
      }),
    ).rejects.toMatchObject({ code: 'commit-rejected', message: 'idempotency-key-payload-mismatch' });
    expect(commit).not.toHaveBeenCalled();
  });

  it('a retry with the SAME payload digest proceeds normally (no false positive)', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    fake.rows.get(id)!.payloadDigest = 'same-digest';
    fake.setProbe('procurement', 'key-1', { externalRecordId: 'PI-ADOPT' });

    const commit = vi.fn();
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
      money: { ...fake.deps, payloadDigest: 'same-digest' },
    });
    expect(result.externalRecordId).toBe('PI-ADOPT');
  });
});

describe('C-1 DIRECTOR RULING: a mutable-anchor money doc (Payment Entry) is HELD on inconclusive recovery, never reissued', () => {
  it('a truly-orphaned PE (no composite-probe hit past the window) goes to held and NEVER re-POSTs', async () => {
    // reissueOnInconclusiveAbsence:false marks this command a Payment Entry (mutable reference_no anchor).
    const fake = createFakeOutbox({ reissueOnInconclusiveAbsence: false });
    await fake.deps.insertOutboxPending('procurement', 'pmo-pe-1', 'key-pe');
    const id = [...fake.rows.keys()][0];
    await fake.deps.claimOutboxForCommit(id); // a dead claimant that never finished (POST outcome unknown)
    fake.backdate(id, LEASE_MS + 1);

    const commit = vi.fn(async () => ({ externalRecordId: 'PE-DUP', canonical: { id: 'pmo-pe-1' } }));
    const peCommand: AdapterCommand = { domain: 'procurement', operation: 'create', record: { id: 'pmo-pe-1' }, idempotencyKey: 'key-pe' };

    // First retry: the stale committing row is QUARANTINED (window not yet elapsed) — retryable, no POST.
    await expect(
      dispatchMoneyWrite({ adapter: erpnextAdapter(commit), command: peCommand, writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money: fake.deps }),
    ).rejects.toMatchObject({ code: 'external-unreachable' });
    expect([...fake.rows.values()][0].state).toBe('quarantined');

    // The window elapses and the composite probe finds NO doc (mutable anchor ⇒ absence NOT conclusive):
    // the row must be HELD — never a second Payment Entry POST.
    fake.elapseWindow(id);
    await expect(
      dispatchMoneyWrite({ adapter: erpnextAdapter(commit), command: peCommand, writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money: fake.deps }),
    ).rejects.toMatchObject({ code: 'command-held' });
    expect(commit).not.toHaveBeenCalled(); // the critical assertion: NO reissue, no double-pay
    expect([...fake.rows.values()][0].state).toBe('held');
  });

  it('a mutable-anchor PE whose landed POST IS found by the composite probe is ADOPTED (no second POST)', async () => {
    const fake = createFakeOutbox({ reissueOnInconclusiveAbsence: false });
    await fake.deps.insertOutboxPending('procurement', 'pmo-pe-2', 'key-pe2');
    const id = [...fake.rows.keys()][0];
    await fake.deps.claimOutboxForCommit(id);
    fake.backdate(id, LEASE_MS + 1);
    const commit = vi.fn();
    const peCommand: AdapterCommand = { domain: 'procurement', operation: 'create', record: { id: 'pmo-pe-2' }, idempotencyKey: 'key-pe2' };
    await expect(
      dispatchMoneyWrite({ adapter: erpnextAdapter(commit), command: peCommand, writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money: fake.deps }),
    ).rejects.toMatchObject({ code: 'external-unreachable' });

    // The composite probe (reference_no OR party/amount/PI-ref conjunction) resolves the landed PE.
    fake.setProbe('procurement', 'key-pe2', { externalRecordId: 'PE-LANDED' });
    fake.elapseWindow(id);
    const result = await dispatchMoneyWrite({ adapter: erpnextAdapter(commit), command: peCommand, writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money: fake.deps });
    expect(commit).not.toHaveBeenCalled(); // adopted, not re-POSTed
    expect(result.externalRecordId).toBe('PE-LANDED');
    expect([...fake.rows.values()][0].state).toBe('confirmed');
  });
});

/**
 * Money-safety audit BLOCK 1 — the CLAIM BUDGET.
 *
 * ADR-0058's per-attempt request deadline was reasoned about as if the POST began at the instant of
 * the claim. It does not: `claimAndCommit` awaits the recovery PROBE first, and the probe is a GET, so
 * it retries (`maxRetries` default 3) with a per-ATTEMPT deadline — a worst case of ~483 s, LONGER
 * than the whole 300 s quarantine window. A claimant could therefore still reach `adapter.commit`
 * AFTER its row had been quarantined, reclaimed and REISSUED by the reconciler ⇒ two ERP money
 * documents (two SUBMITTED docs with posted GL/AP on the shared Purchase-Invoice / Pay-PE path). The
 * fencing token discards the stale claimant's WRITE-BACK; it cannot un-mint its DOCUMENT.
 *
 * The invariant is enforced at the POST SITE against real elapsed time — never inferred from the
 * relationship between two constants (a static assertion of the flawed model is exactly what missed
 * this). These tests drive an injected clock through `money.now`.
 */
describe('BLOCK 1: no POST may be issued once the claim budget is exhausted (the claim is superseded by then)', () => {
  /** Wires an injected clock into the fake and makes the probe consume `probeCostMs` of it. */
  function withClock(fake: ReturnType<typeof createFakeOutbox>, probeCostMs: number) {
    const clock = { ms: 1_000_000 };
    fake.deps.now = () => clock.ms;
    const probe = fake.deps.probeByRemarksKey.bind(fake.deps);
    fake.deps.probeByRemarksKey = async (domain, key) => {
      clock.ms += probeCostMs;
      return probe(domain, key);
    };
    return clock;
  }

  it('a probe that outlives the budget makes the POST refused — no ERP document, row left committing', async () => {
    const fake = createFakeOutbox();
    // The audited worst case: 4 × 120 s attempts + backoff, longer than the entire 300 s quarantine
    // window — by now a reconciler has claimed, missed the probe and already reissued this command.
    withClock(fake, 483_000);
    const commit = vi.fn(async () => ({ externalRecordId: 'PI-DUPLICATE', canonical: { id: 'pmo-1' } }));

    await expect(
      dispatchMoneyWrite({
        adapter: erpnextAdapter(commit),
        command: baseCommand,
        writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
        money: fake.deps,
      }),
    ).rejects.toMatchObject({ code: 'external-unreachable' });

    expect(commit).not.toHaveBeenCalled(); // the critical assertion: no second money document
    const row = [...fake.rows.values()][0];
    // Retryable ⇒ nothing is marked: the row stays claimable-after-lease and the reconciler owns it.
    expect(row.state).toBe('committing');
    expect(row.externalRecordId).toBeNull();
  });

  it('the normal fast path (a probe answering well inside the budget) still POSTs and confirms', async () => {
    const fake = createFakeOutbox();
    withClock(fake, 1_500);
    const commit = vi.fn(async () => ({ externalRecordId: 'PI-0001', canonical: { id: 'pmo-1' } }));

    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
      money: fake.deps,
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(result.externalRecordId).toBe('PI-0001');
    expect([...fake.rows.values()][0].state).toBe('confirmed');
  });

  it('the boundary is exact: 1 ms inside the budget POSTs, the budget itself does not', async () => {
    const inside = createFakeOutbox();
    withClock(inside, MONEY_COMMIT_CLAIM_BUDGET_MS - 1);
    const insideCommit = vi.fn(async () => ({ externalRecordId: 'PI-0002', canonical: { id: 'pmo-1' } }));
    await dispatchMoneyWrite({
      adapter: erpnextAdapter(insideCommit), command: baseCommand,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money: inside.deps,
    });
    expect(insideCommit).toHaveBeenCalledTimes(1);

    const atBudget = createFakeOutbox();
    withClock(atBudget, MONEY_COMMIT_CLAIM_BUDGET_MS);
    const atBudgetCommit = vi.fn();
    await expect(
      dispatchMoneyWrite({
        adapter: erpnextAdapter(atBudgetCommit), command: baseCommand,
        writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money: atBudget.deps,
      }),
    ).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(atBudgetCommit).not.toHaveBeenCalled();
  });

  it('the budget never turns an ADOPTION into a refusal — a probe hit past the budget still finalizes', async () => {
    const fake = createFakeOutbox();
    withClock(fake, 483_000);
    fake.setProbe('procurement', 'key-1', { externalRecordId: 'PI-LANDED' });
    const commit = vi.fn();

    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
      money: fake.deps,
    });

    // Adoption issues no ERP write at all, and the fenced write-backs already guard a stale claimant's
    // result — so the budget must not block it.
    expect(commit).not.toHaveBeenCalled();
    expect(result.externalRecordId).toBe('PI-LANDED');
  });

  it('C-1 is preserved: a budget-exhausted mutable-anchor PE is still HELD, never reissued', async () => {
    const fake = createFakeOutbox({ reissueOnInconclusiveAbsence: false });
    await fake.deps.insertOutboxPending('procurement', 'pmo-pe-3', 'key-pe3');
    const id = [...fake.rows.keys()][0];
    await fake.deps.claimOutboxForCommit(id);
    fake.backdate(id, LEASE_MS + 1);
    const commit = vi.fn(async () => ({ externalRecordId: 'PE-DUP', canonical: { id: 'pmo-pe-3' } }));
    const peCommand: AdapterCommand = { domain: 'procurement', operation: 'create', record: { id: 'pmo-pe-3' }, idempotencyKey: 'key-pe3' };

    await expect(
      dispatchMoneyWrite({ adapter: erpnextAdapter(commit), command: peCommand, writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money: fake.deps }),
    ).rejects.toMatchObject({ code: 'external-unreachable' });

    withClock(fake, 483_000);
    fake.elapseWindow(id);
    await expect(
      dispatchMoneyWrite({ adapter: erpnextAdapter(commit), command: peCommand, writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money: fake.deps }),
    ).rejects.toMatchObject({ code: 'command-held' });
    expect(commit).not.toHaveBeenCalled();
    expect([...fake.rows.values()][0].state).toBe('held');
  });

  it('the post-window RECOVERY reissue is bounded by the same budget (the exploit path)', async () => {
    // An immutable-anchor (reissue-capable) kind whose recovery claim probes past the budget must NOT
    // reissue either — by then ITS OWN claim can have been superseded in turn.
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    await fake.deps.claimOutboxForCommit(id);
    fake.backdate(id, LEASE_MS + 1);
    const commit = vi.fn(async () => ({ externalRecordId: 'PI-DUPLICATE', canonical: { id: 'pmo-1' } }));

    await expect(
      dispatchMoneyWrite({ adapter: erpnextAdapter(commit), command: baseCommand, writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money: fake.deps }),
    ).rejects.toMatchObject({ code: 'external-unreachable' });

    withClock(fake, 483_000);
    fake.elapseWindow(id);
    await expect(
      dispatchMoneyWrite({ adapter: erpnextAdapter(commit), command: baseCommand, writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money: fake.deps }),
    ).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(commit).not.toHaveBeenCalled();
  });

  it('falls back to the wall clock when no `now` is injected (production wiring needs no extra dep)', async () => {
    const fake = createFakeOutbox();
    expect(fake.deps.now).toBeUndefined();
    const commit = vi.fn(async () => ({ externalRecordId: 'PI-0003', canonical: { id: 'pmo-1' } }));
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit), command: baseCommand,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money: fake.deps,
    });
    expect(result.externalRecordId).toBe('PI-0003');
  });
});

describe('AC-ENA-012 classified failures: commit-rejected marks failed; external-unreachable stays reclaimable', () => {
  it('commit-rejected marks the row failed and rethrows', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    const commit = vi.fn(async () => { throw new AdapterError('commit-rejected', 'MandatoryError: supplier'); });
    await expect(
      dispatchMoneyWrite({
        adapter: erpnextAdapter(commit),
        command: baseCommand,
        writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
        money: fake.deps,
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect([...fake.rows.values()][0].state).toBe('failed');
    expect(id).toBeTruthy();
  });

  it('external-unreachable rethrows and leaves the row committing (reclaimable after the lease)', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const commit = vi.fn(async () => { throw new AdapterError('external-unreachable', 'timeout'); });
    await expect(
      dispatchMoneyWrite({
        adapter: erpnextAdapter(commit),
        command: baseCommand,
        writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
        money: fake.deps,
      }),
    ).rejects.toMatchObject({ code: 'external-unreachable' });
    expect([...fake.rows.values()][0].state).toBe('committing');
  });
});
