// Task 6.4 — the DB-backed DispatchMoneyOutboxDeps (ADR-0057 §4). Deno-native test (matches
// readModelWriters.test.ts's plain-assert idiom) against a structural fake OutboxServiceClient.
// Verify: cd supabase/functions/adapter-dispatch && deno test moneyOutboxDeps.test.ts

import { createDbMoneyOutboxDeps, type OutboxServiceClient } from './moneyOutboxDeps.ts';

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

interface FakeRow {
  id: string;
  org_id: string;
  domain: string;
  pmo_record_id: string;
  idempotency_key: string;
  external_tier: string;
  operation: string;
  state: string;
  external_record_id: string | null;
  canonical: unknown;
  claim_generation: number;
  last_error: string | null;
}

function makeFakeClient(seed: FakeRow[] = []) {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]));
  let seq = rows.size;
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const client: OutboxServiceClient = {
    from(table: string) {
      assertEquals(table, 'external_command_outbox');
      return {
        select(_cols: string) {
          let filters: Record<string, string> = {};
          const chain = {
            eq(col: string, val: string) {
              filters = { ...filters, [col]: val };
              return chain;
            },
            async maybeSingle() {
              const match = [...rows.values()].find((r) =>
                Object.entries(filters).every(([k, v]) => String((r as unknown as Record<string, unknown>)[k]) === v),
              );
              return { data: match ?? null, error: null };
            },
            then(resolve: (v: { data: unknown; error: null }) => void) {
              resolve({ data: [...rows.values()], error: null });
            },
          };
          return chain as never;
        },
        insert(row: unknown) {
          const r = row as Partial<FakeRow>;
          const dup = [...rows.values()].some(
            (existing) =>
              existing.org_id === r.org_id &&
              existing.domain === r.domain &&
              existing.pmo_record_id === r.pmo_record_id &&
              existing.idempotency_key === r.idempotency_key,
          );
          return {
            select(_cols: string) {
              return {
                async single() {
                  if (dup) {
                    return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
                  }
                  const id = `outbox-${++seq}`;
                  const full: FakeRow = {
                    id,
                    org_id: r.org_id!,
                    domain: r.domain!,
                    pmo_record_id: r.pmo_record_id!,
                    idempotency_key: r.idempotency_key!,
                    external_tier: r.external_tier!,
                    operation: r.operation!,
                    state: 'pending',
                    external_record_id: null,
                    canonical: null,
                    claim_generation: 0,
                    last_error: null,
                  };
                  rows.set(id, full);
                  return { data: full, error: null };
                },
              };
            },
          };
        },
        update(patch: unknown) {
          let filters: Record<string, string> = {};
          const chain = {
            eq(col: string, val: string) {
              filters = { ...filters, [col]: val };
              return chain;
            },
            async select(_cols: string) {
              const matches = [...rows.values()].filter((r) =>
                Object.entries(filters).every(([k, v]) => String((r as unknown as Record<string, unknown>)[k]) === v),
              );
              for (const m of matches) Object.assign(m, patch);
              return { data: matches.map((m) => ({ id: m.id })), error: null };
            },
          };
          return chain as never;
        },
      };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      const id = args.p_id as string;
      const row = rows.get(id);
      if (fn === 'claim_outbox_for_commit') {
        if (!row || (row.state !== 'pending' && row.state !== 'failed' && row.state !== 'quarantined')) {
          return { data: null, error: null };
        }
        row.state = 'committing';
        row.claim_generation += 1;
        return { data: { ...row }, error: null };
      }
      if (fn === 'quarantine_committing') {
        if (!row || row.state !== 'committing') return { data: null, error: null };
        row.state = 'quarantined';
        row.claim_generation += 1;
        return { data: { ...row }, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
  return { client, rows, rpcCalls };
}

Deno.test('readOutbox: null when no row for the 4-tuple; maps a found row to camelCase OutboxRow', async () => {
  const { client } = makeFakeClient([
    {
      id: 'outbox-1', org_id: 'org-1', domain: 'procurement', pmo_record_id: 'pmo-1', idempotency_key: 'key-1',
      external_tier: 'erpnext', operation: 'create', state: 'pending', external_record_id: null, canonical: null,
      claim_generation: 0, last_error: null,
    },
  ]);
  const deps = createDbMoneyOutboxDeps({ serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create', probeByRemarksKey: async () => null });
  const found = await deps.readOutbox('procurement', 'pmo-1', 'key-1');
  assertEquals(found?.id, 'outbox-1');
  assertEquals(found?.pmoRecordId, 'pmo-1');
  assertEquals(found?.claimGeneration, 0);
  const notFound = await deps.readOutbox('procurement', 'pmo-1', 'key-nope');
  assertEquals(notFound, null);
});

Deno.test('insertOutboxPending: inserts a fresh pending row; a duplicate 4-tuple throws with .code=23505', async () => {
  const { client } = makeFakeClient();
  const deps = createDbMoneyOutboxDeps({ serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create', probeByRemarksKey: async () => null });
  const row = await deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
  assertEquals(row.state, 'pending');
  assertEquals(row.claimGeneration, 0);
  let threw = false;
  try {
    await deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
  } catch (err) {
    threw = true;
    assertEquals((err as { code?: string }).code, '23505');
  }
  assert(threw, 'expected the duplicate insert to throw');
});

Deno.test('claimOutboxForCommit: claims a pending row (bumps claim_generation), returns null when not claimable', async () => {
  const { client } = makeFakeClient([
    {
      id: 'outbox-1', org_id: 'org-1', domain: 'procurement', pmo_record_id: 'pmo-1', idempotency_key: 'key-1',
      external_tier: 'erpnext', operation: 'create', state: 'pending', external_record_id: null, canonical: null,
      claim_generation: 0, last_error: null,
    },
  ]);
  const deps = createDbMoneyOutboxDeps({ serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create', probeByRemarksKey: async () => null });
  const claimed = await deps.claimOutboxForCommit('outbox-1');
  assertEquals(claimed?.state, 'committing');
  assertEquals(claimed?.claimGeneration, 1);
  const second = await deps.claimOutboxForCommit('outbox-1');
  assertEquals(second, null, 'a second claim on an already-committing row must return null');
});

Deno.test('quarantineCommitting: transitions a committing row -> quarantined, bumps the fencing token', async () => {
  const { client, rows } = makeFakeClient([
    {
      id: 'outbox-1', org_id: 'org-1', domain: 'procurement', pmo_record_id: 'pmo-1', idempotency_key: 'key-1',
      external_tier: 'erpnext', operation: 'create', state: 'committing', external_record_id: null, canonical: null,
      claim_generation: 1, last_error: null,
    },
  ]);
  const deps = createDbMoneyOutboxDeps({ serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create', probeByRemarksKey: async () => null });
  const quarantined = await deps.quarantineCommitting('outbox-1');
  assertEquals(quarantined?.state, 'quarantined');
  assertEquals(quarantined?.claimGeneration, 2);
  assertEquals(rows.get('outbox-1')?.state, 'quarantined');
});

Deno.test('markOutboxCommitted/Confirmed/Failed: guarded write-backs affect 1 row when the token matches, 0 when stale', async () => {
  const { client, rows } = makeFakeClient([
    {
      id: 'outbox-1', org_id: 'org-1', domain: 'procurement', pmo_record_id: 'pmo-1', idempotency_key: 'key-1',
      external_tier: 'erpnext', operation: 'create', state: 'committing', external_record_id: null, canonical: null,
      claim_generation: 1, last_error: null,
    },
  ]);
  const deps = createDbMoneyOutboxDeps({ serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create', probeByRemarksKey: async () => null });

  const committedCount = await deps.markOutboxCommitted('outbox-1', 'PI-0001', { id: 'pmo-1', total: '5.00' }, 1);
  assertEquals(committedCount, 1);
  assertEquals(rows.get('outbox-1')?.state, 'committed');
  assertEquals(rows.get('outbox-1')?.canonical, { id: 'pmo-1', total: '5.00' });

  // A stale token (the row is now claim_generation=1, matches — but bump to simulate supersede).
  rows.get('outbox-1')!.claim_generation = 2;
  const staleCount = await deps.markOutboxCommitted('outbox-1', 'PI-DUP', { id: 'pmo-1' }, 1);
  assertEquals(staleCount, 0, 'a stale fencing token must affect 0 rows');

  const confirmedCount = await deps.markOutboxConfirmed('outbox-1', 2);
  assertEquals(confirmedCount, 1);
  assertEquals(rows.get('outbox-1')?.state, 'confirmed');

  const failedStaleCount = await deps.markOutboxFailed('outbox-1', 'boom', 1);
  assertEquals(failedStaleCount, 0);
});

Deno.test('verifyClaimGeneration: true iff the row current claim_generation matches; false when superseded or missing', async () => {
  const { client } = makeFakeClient([
    {
      id: 'outbox-1', org_id: 'org-1', domain: 'procurement', pmo_record_id: 'pmo-1', idempotency_key: 'key-1',
      external_tier: 'erpnext', operation: 'create', state: 'committed', external_record_id: 'PI-1', canonical: null,
      claim_generation: 2, last_error: null,
    },
  ]);
  const deps = createDbMoneyOutboxDeps({ serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create', probeByRemarksKey: async () => null });
  assertEquals(await deps.verifyClaimGeneration('outbox-1', 2), true);
  assertEquals(await deps.verifyClaimGeneration('outbox-1', 1), false, 'a stale token must not verify');
  assertEquals(await deps.verifyClaimGeneration('missing-id', 2), false);
});

Deno.test('probeByRemarksKey + backoff are passed through from the injected opts (tier-specific, not built here)', async () => {
  const { client } = makeFakeClient();
  let probeCalled = false;
  let backoffCalled = false;
  const deps = createDbMoneyOutboxDeps({
    serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create',
    probeByRemarksKey: async () => { probeCalled = true; return null; },
    backoff: async () => { backoffCalled = true; },
  });
  await deps.probeByRemarksKey('procurement', 'key-1');
  await deps.backoff();
  assert(probeCalled, 'expected the injected probe to be invoked');
  assert(backoffCalled, 'expected the injected backoff to be invoked');
});
