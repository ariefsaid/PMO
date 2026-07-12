// AC-ENA-045 (outbox recovery) [Deno unit] — erpnext-sweep's `reconcileOrgOutbox` pass: the
// sweep-side of ADR-0057 §Consequences — the SAME recovery path as the retry flow, run as an explicit
// pass BEFORE the doctype sweep. For each employing org it selects every pending/failed/
// committing-past-lease/committed row via `outbox_reconcile_candidates(org)` and applies the ADR-0057
// §4 algorithm EXACTLY by delegating to the real `dispatchMoneyWrite` (one algorithm, shared with the
// retry path — ADR/plan describe ONE recovery path):
//   • committed  → finalize-only (idempotent read-model upsert + external_refs) → confirmed; NO ERP create.
//   • pending    → claim_outbox_for_commit FIRST; only the claim winner probes ERP by the stamped
//     remarks key → adopt or POST; the loser (null return) is skipped (NO POST).
// Proves an orphaned commit left `committed`/`pending` is reconciled to exactly one mirror row with
// NO duplicate ERP doc, and the pass runs once per candidate.
//
// Deno-native test (plain assertions). The outbox ops + adapter are injected mocks; the algorithm
// under test is the REAL `dispatchMoneyWrite` (so this proves the sweep WIRES the shared algorithm
// correctly — the algorithm's exhaustive per-state proof lives in dispatch.money.test.ts [Vitest]).
//
// Verify: cd supabase/functions/erpnext-sweep && deno test outboxRecovery.test.ts

// Stub Deno.serve so importing index.ts (top-level Deno.serve) does not bind a port under deno test.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { reconcileOrgOutbox } = await import('./index.ts');
import { dispatchMoneyWrite, type OutboxRow, type DispatchMoneyOutboxDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { Adapter, AdapterCommand, CommandResult, PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function row(state: OutboxRow['state'], overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 'outbox-1',
    domain: 'procurement',
    pmoRecordId: 'pmo-1',
    idempotencyKey: 'key-1',
    state,
    externalRecordId: overrides.externalRecordId ?? (state === 'confirmed' || state === 'committed' ? 'ACC-PINV-2026-00001' : null),
    canonical: overrides.canonical ?? { id: 'pmo-1' },
    claimGeneration: overrides.claimGeneration ?? 1,
    payloadDigest: overrides.payloadDigest ?? null,
    ...overrides,
  };
}

/** Builds a fully-mocked DispatchMoneyWriteDeps whose `money.readOutbox` returns the candidate row
 *  (simulating the re-read dispatchMoneyWrite does) and tracks every op. Overrides are WRAPPED so the
 *  call counters stay accurate (a raw override would shadow the tracker). */
function mockedDeps(candidate: OutboxRow, moneyOverrides: Partial<DispatchMoneyOutboxDeps> = {}) {
  const command: AdapterCommand = {
    domain: candidate.domain,
    operation: 'transition',
    record: { id: candidate.pmoRecordId } as PmoRecord,
    idempotencyKey: candidate.idempotencyKey,
  };
  const writes: PmoRecord[] = [];
  const refs: Array<{ pmoRecordId: string; externalRecordId: string }> = [];
  const calls = { commit: 0, claim: 0, probe: 0, markCommitted: 0, finalized: 0, held: 0, markFailed: 0 };
  const adapter: Pick<Adapter, 'tier' | 'capabilityMap' | 'commit'> = {
    tier: 'erpnext',
    capabilityMap: new Set(['procurement']),
    commit: async () => { calls.commit += 1; throw new Error('adapter.commit MUST NOT be called on the finalize-only / loser / adopt paths'); },
  };
  const writeReadModel = async (canonical: PmoRecord) => { writes.push(canonical); };
  const recordExternalRef = async (m: { pmoRecordId: string; externalTier: string; externalRecordId: string; domain: string }) => { refs.push(m); };
  // counter-keyed base trackers; overrides wrap these so the counters stay accurate.
  const baseClaim = async (_id: string): Promise<OutboxRow | null> => null; // default: the LOSER
  const baseProbe = async (_domain: string, _key: string): Promise<{ externalRecordId: string; canonical?: PmoRecord } | null> => null;
  const claimTracker = async (id: string): Promise<OutboxRow | null> => { calls.claim += 1; return baseClaimTracker(id); };
  const probeTracker = async (domain: string, key: string): Promise<{ externalRecordId: string; canonical?: PmoRecord } | null> => { calls.probe += 1; return baseProbeTracker(domain, key); };
  // the ACTUAL behavior (base or override) the tracker delegates to — set below from overrides.
  let baseClaimTracker = baseClaim;
  let baseProbeTracker = baseProbe;
  if (moneyOverrides.claimOutboxForCommit) baseClaimTracker = moneyOverrides.claimOutboxForCommit as typeof baseClaim;
  if (moneyOverrides.probeByRemarksKey) baseProbeTracker = moneyOverrides.probeByRemarksKey as typeof baseProbe;
  const money: DispatchMoneyOutboxDeps = {
    readOutbox: moneyOverrides.readOutbox ?? (async () => candidate),
    insertOutboxPending: async () => candidate,
    claimOutboxForCommit: claimTracker,
    quarantineCommitting: moneyOverrides.quarantineCommitting ?? (async () => null),
    markOutboxCommitted: async () => { calls.markCommitted += 1; return 1; },
    // H-1: the fenced ref RPC (external_refs upsert) then the fenced confirm — tracks the ref for the assertions.
    recordOutboxRef: moneyOverrides.recordOutboxRef ?? (async (_id, _gen, m) => { calls.finalized += 1; refs.push({ pmoRecordId: m.pmoRecordId, externalRecordId: m.externalRecordId }); return 1; }),
    confirmOutbox: moneyOverrides.confirmOutbox ?? (async () => 1),
    markOutboxHeld: moneyOverrides.markOutboxHeld ?? (async () => { calls.held += 1; return 1; }),
    reissueOnInconclusiveAbsence: moneyOverrides.reissueOnInconclusiveAbsence ?? true,
    markOutboxFailed: async () => { calls.markFailed += 1; return 1; },
    probeByRemarksKey: probeTracker,
    backoff: async () => {},
  };
  return {
    deps: { adapter, command, writeReadModel, recordExternalRef, money },
    spies: { writes, refs, calls },
  };
}

Deno.test('AC-ENA-045: committed candidate → finalize-only (read-model upsert + external_refs + confirmed) with NO ERP create', async () => {
  const committed = row('committed', { externalRecordId: 'ACC-PINV-2026-00001', canonical: { id: 'pmo-1', name: 'PI' } });
  const { deps, spies } = mockedDeps(committed);
  const listCandidates = async () => [committed];
  let driven = 0;
  const result = await reconcileOrgOutbox(listCandidates, 'org-1', () => { driven += 1; return deps; }, dispatchMoneyWrite);
  assert(driven === 1, `expected the sweep to drive dispatchMoneyWrite once per candidate, got ${driven}`);
  assert(result.reconciled === 1, `expected reconciled=1, got ${result.reconciled}`);
  // finalize-only: the adapter's REAL committed canonical was mirrored + ref-recorded + confirmed.
  assert(spies.writes.length === 1 && spies.writes[0].id === 'pmo-1', 'committed → writeReadModel with the persisted canonical exactly once');
  assert(spies.refs.length === 1 && spies.refs[0].externalRecordId === 'ACC-PINV-2026-00001', 'committed → external_refs upserted (inside the fenced finalize) exactly once');
  assert(spies.calls.finalized >= 1, 'committed → finalizeOutbox called (the fenced ref-upsert + confirm promote)');
  assert(spies.calls.commit === 0, 'committed → adapter.commit MUST NOT be called (no ERP create)');
  assert(spies.calls.claim === 0, 'committed → no claim (finalize-only, no POST critical section)');
});

Deno.test('AC-ENA-045: pending candidate → claim FIRST; the claim WINNER probes → adopts → finalizes (NO duplicate ERP doc)', async () => {
  const pending = row('pending');
  // The claim WINNER: claimOutboxForCommit returns the claimed row; the probe FINDS the orphaned doc → adopt.
  const adoptedCanonical: PmoRecord = { id: 'pmo-1', name: 'adopted-PI' };
  const { deps, spies } = mockedDeps(pending, {
    claimOutboxForCommit: async () => ({ ...pending, state: 'committing', claimGeneration: 2 }),
    probeByRemarksKey: async () => ({ externalRecordId: 'ACC-PINV-2026-00001', canonical: adoptedCanonical }),
  });
  // readOutbox returns the CURRENT state = pending (the default). The winner path claims → probes →
  // adopts → markCommitted → finalize; it does NOT re-read (no second readOutbox call).
  const listCandidates = async () => [pending];
  const result = await reconcileOrgOutbox(listCandidates, 'org-1', () => deps);
  assert(spies.calls.claim >= 1, 'pending → claimOutboxForCommit called FIRST (the claim gates the POST critical section)');
  assert(spies.calls.probe >= 1, 'pending winner → probeByRemarksKey called (adopt-or-POST)');
  assert(spies.calls.commit === 0, 'pending winner with a probe hit → ADOPT (NO ERP create — no duplicate doc)');
  assert(result.reconciled === 1, `expected reconciled=1, got ${result.reconciled}`);
});

Deno.test('AC-ENA-045: pending candidate → claim LOSER (null return) → NO POST (skipped, no duplicate)', async () => {
  const pending = row('pending');
  let readCount = 0;
  const { deps, spies } = mockedDeps(pending, {
    claimOutboxForCommit: async () => null, // the LOSER: another caller owns the claim
    readOutbox: async () => {
      // First read = the CURRENT pending state (so reconcile hits 'pending' → claims → loses); the
  //   loser re-reads expecting the winner to have advanced — second read = confirmed (terminal).
      readCount += 1;
      return readCount === 1 ? pending : { ...pending, state: 'confirmed', externalRecordId: 'ACC-PINV-2026-00001', canonical: { id: 'pmo-1' }, claimGeneration: 3 };
    },
  });
  const listCandidates = async () => [pending];
  await reconcileOrgOutbox(listCandidates, 'org-1', () => deps);
  assert(spies.calls.claim >= 1, 'pending → claim attempted');
  assert(spies.calls.commit === 0, 'pending LOSER → adapter.commit MUST NOT be called (never POSTs)');
  assert(spies.calls.probe === 0, 'pending LOSER → probe MUST NOT be called (only the winner probes)');
});

Deno.test('AC-ENA-045: no candidates ⇒ no reconcile calls (the pass is a no-op for a clean org)', async () => {
  let buildCalls = 0;
  const listCandidates = async () => [];
  const result = await reconcileOrgOutbox(listCandidates, 'org-1', () => { buildCalls += 1; return mockedDeps(row('pending')).deps; });
  assert(buildCalls === 0, 'buildDeps must NOT be called when there are no candidates');
  assert(result.reconciled === 0, `expected reconciled=0, got ${result.reconciled}`);
});

Deno.test('AC-ENA-045: every candidate is reconciled exactly once (the pass enumerates + drives each)', async () => {
  // Use committed candidates so each finalizes without a claim loop (a pending loser would re-read
  //  forever in a static mock — the loser path expects the winner to have advanced the state).
  const candidates = [row('committed', { id: 'a', externalRecordId: 'A' }), row('committed', { id: 'b', externalRecordId: 'B' })];
  const listCandidates = async () => candidates;
  const driven: string[] = [];
  await reconcileOrgOutbox(listCandidates, 'org-1', (r) => { driven.push(r.id); return mockedDeps(r).deps; });
  assert(driven.length === 2 && driven[0] === 'a' && driven[1] === 'b', `expected each candidate driven once in order, got ${JSON.stringify(driven)}`);
});

// satisfy the unused-import linter in deno check (CommandResult is part of the contract vocabulary
// the sweep reuses; referenced here for documentation fidelity).
void (null as unknown as CommandResult);
