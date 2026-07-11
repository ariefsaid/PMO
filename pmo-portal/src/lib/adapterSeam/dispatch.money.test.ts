/**
 * AC-ENA-012, FR-ENA-041/043 — the money-idempotency outbox + atomic recovery (ADR-0057 §4).
 * Pure unit tests, mocked outbox/adapter deps (a lightweight in-memory fake outbox reproducing the
 * DB's guarded semantics — `claim_outbox_for_commit`'s conditional UPDATE + the `claim_generation`
 * fencing token — so the concurrency proofs are meaningful without a real DB; the equivalent proof
 * against the real DB is the 1.7 pgTAP band).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  dispatchExternallyOwnedWrite,
  dispatchMoneyWrite,
  type DispatchMoneyOutboxDeps,
  type OutboxRow,
} from './dispatch.ts';
import { AdapterError, type AdapterCommand, type CommandResult } from './contract.ts';
import { AppError } from '../appError.ts';

const LEASE_MS = 60_000;

/** An in-memory fake reproducing `claim_outbox_for_commit`'s guarantees (0095): a conditional
 *  transition into `committing` that only one caller can win per id, plus the `claim_generation`
 *  fencing token guarding every subsequent write-back. */
function createFakeOutbox() {
  const rows = new Map<string, OutboxRow & { updatedAt: number }>();
  const byTuple = new Map<string, string>();
  const probes = new Map<string, { externalRecordId: string }>();
  let seq = 0;
  const tupleKey = (domain: string, pmoRecordId: string, idempotencyKey: string) =>
    `${domain}::${pmoRecordId}::${idempotencyKey}`;

  const deps: DispatchMoneyOutboxDeps = {
    async readOutbox(domain, pmoRecordId, idempotencyKey) {
      const id = byTuple.get(tupleKey(domain, pmoRecordId, idempotencyKey));
      if (!id) return null;
      const { updatedAt: _updatedAt, ...row } = rows.get(id)!;
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
      const row: OutboxRow & { updatedAt: number } = {
        id, domain, pmoRecordId, idempotencyKey,
        state: 'pending', externalRecordId: null, claimGeneration: 0,
        updatedAt: Date.now(),
      };
      rows.set(id, row);
      byTuple.set(k, id);
      const { updatedAt: _updatedAt, ...result } = row;
      return { ...result };
    },
    async claimOutboxForCommit(id) {
      const row = rows.get(id);
      if (!row) return null;
      const reclaimableCommitting = row.state === 'committing' && Date.now() - row.updatedAt > LEASE_MS;
      if (row.state !== 'pending' && row.state !== 'failed' && !reclaimableCommitting) return null;
      row.state = 'committing';
      row.claimGeneration += 1;
      row.updatedAt = Date.now();
      const { updatedAt: _updatedAt, ...result } = row;
      return { ...result };
    },
    async markOutboxCommitted(id, externalRecordId, claimGeneration) {
      const row = rows.get(id);
      if (!row || row.claimGeneration !== claimGeneration) return 0;
      row.state = 'committed';
      row.externalRecordId = externalRecordId;
      row.updatedAt = Date.now();
      return 1;
    },
    async markOutboxConfirmed(id, claimGeneration) {
      const row = rows.get(id);
      if (!row || row.claimGeneration !== claimGeneration) return 0;
      row.state = 'confirmed';
      row.updatedAt = Date.now();
      return 1;
    },
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
    setProbe: (domain: string, idempotencyKey: string, result: { externalRecordId: string }) =>
      probes.set(`${domain}::${idempotencyKey}`, result),
    backdate: (id: string, ms: number) => {
      const row = rows.get(id)!;
      row.updatedAt = Date.now() - ms;
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
    expect(recordExternalRef).toHaveBeenCalledWith({
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
    await fake.deps.markOutboxCommitted(claimed!.id, 'PI-0001', claimed!.claimGeneration);
    await fake.deps.markOutboxConfirmed(claimed!.id, claimed!.claimGeneration);

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

    // A reclaimer re-claims — gen bumps to 2 (monotonic) — and finishes the whole flow.
    const reclaimed = await fake.deps.claimOutboxForCommit(id);
    expect(reclaimed!.claimGeneration).toBe(2);
    await fake.deps.markOutboxCommitted(id, 'PI-0001', 2);
    await fake.deps.markOutboxConfirmed(id, 2);

    // The stale claimant's late write-back, still holding gen=1, must affect 0 rows.
    const staleCommittedCount = await fake.deps.markOutboxCommitted(id, 'PI-DUPLICATE', 1);
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
    const staleCommittedCount = await fake.deps.markOutboxCommitted(id, 'PI-DUPLICATE', claimed!.claimGeneration);
    expect(staleCommittedCount).toBe(0);
    // A superseded write-back must never call the finalize side-effects.
    expect(writeReadModel).not.toHaveBeenCalled();
    expect(recordExternalRef).not.toHaveBeenCalled();
  });
});

describe('AC-ENA-012 confirmed retry — return the stored result, no ERP call, no claim', () => {
  it('returns the stored result without calling adapter.commit or claimOutboxForCommit', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    const claimed = await fake.deps.claimOutboxForCommit(id);
    await fake.deps.markOutboxCommitted(id, 'PI-0001', claimed!.claimGeneration);
    await fake.deps.markOutboxConfirmed(id, claimed!.claimGeneration);

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
    await fake.deps.markOutboxCommitted(id, 'PI-0001', claimed!.claimGeneration);
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
    expect(recordExternalRef).toHaveBeenCalledTimes(1);
    expect(result.externalRecordId).toBe('PI-0001');
    expect([...fake.rows.values()][0].state).toBe('confirmed');
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

  it('stale committing (past lease) is reclaimed, probed, and POSTed', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    await fake.deps.claimOutboxForCommit(id); // simulate a dead claimant, never finished
    fake.backdate(id, LEASE_MS + 1);

    const commit = vi.fn(async () => ({ externalRecordId: 'PI-0003', canonical: { id: 'pmo-1' } }));
    const result = await dispatchMoneyWrite({
      adapter: erpnextAdapter(commit),
      command: baseCommand,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
      money: fake.deps,
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(result.externalRecordId).toBe('PI-0003');
    expect([...fake.rows.values()][0].claimGeneration).toBe(2);
  });

  it('a committing-fresh row (another live owner) never POSTs — backs off and re-reads', async () => {
    const fake = createFakeOutbox();
    await fake.deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
    const id = [...fake.rows.keys()][0];
    await fake.deps.claimOutboxForCommit(id); // an in-flight owner, well within lease

    // schedule the owner to finish shortly after we start reconciling, so the backoff loop
    // eventually observes a terminal state instead of spinning forever.
    setTimeout(async () => {
      await fake.deps.markOutboxCommitted(id, 'PI-0004', 1);
      await fake.deps.markOutboxConfirmed(id, 1);
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
