// Task 6.4 — the DB-backed DispatchMoneyOutboxDeps (ADR-0058 §4). Deno-native test (matches
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

/**
 * Project `row` down to exactly the columns named in `cols` (comma-separated) — mirrors PostgREST's
 * real `.select('a,b,c')` projection. `cols` undefined/empty/'*' means "everything" (both legitimate
 * `.select()` forms). Throws when a requested column is absent from the stub row, simulating
 * PostgREST's `42703 column does not exist` — a fake that "honours" the projection but never fails on
 * a wrong column list would be worthless (this is the whole point of the fake).
 */
function projectColumns<T>(row: T, cols: string | undefined): T {
  if (row == null || typeof row !== 'object') return row;
  const trimmed = (cols ?? '').trim();
  if (trimmed === '' || trimmed === '*') return row;
  const keys = trimmed.split(',').map((c) => c.trim()).filter(Boolean);
  const projected: Record<string, unknown> = {};
  for (const k of keys) {
    if (!(k in (row as Record<string, unknown>))) {
      throw new Error(
        `fake: column "${k}" requested by .select('${cols}') is not present on the stubbed row ` +
          `(simulates PostgREST 42703 — the column list and the fixture have drifted apart).`,
      );
    }
    projected[k] = (row as Record<string, unknown>)[k];
  }
  return projected as T;
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
  payload_digest?: string | null;
}

function makeFakeClient(seed: FakeRow[] = []) {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]));
  let seq = rows.size;
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const externalRefs: Array<Record<string, unknown>> = [];
  /** The RAW row objects handed to `.insert()` — so a test can assert exactly which columns the
   *  writer sends (an omitted column is distinguishable from an explicit null). */
  const inserted: unknown[] = [];

  const client: OutboxServiceClient = {
    from(table: string) {
      assertEquals(table, 'external_command_outbox');
      return {
        select(cols: string) {
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
              return { data: match ? projectColumns(match, cols) : null, error: null };
            },
            then(resolve: (v: { data: unknown; error: null }) => void) {
              resolve({ data: [...rows.values()].map((r) => projectColumns(r, cols)), error: null });
            },
          };
          return chain as never;
        },
        insert(row: unknown) {
          const r = row as Partial<FakeRow>;
          inserted.push(row);
          const dup = [...rows.values()].some(
            (existing) =>
              existing.org_id === r.org_id &&
              existing.domain === r.domain &&
              existing.pmo_record_id === r.pmo_record_id &&
              existing.idempotency_key === r.idempotency_key,
          );
          return {
            select(cols: string) {
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
                    payload_digest: (r.payload_digest as string | null | undefined) ?? null,
                  };
                  rows.set(id, full);
                  return { data: projectColumns(full, cols), error: null };
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
            async select(cols: string) {
              const matches = [...rows.values()].filter((r) =>
                Object.entries(filters).every(([k, v]) => String((r as unknown as Record<string, unknown>)[k]) === v),
              );
              for (const m of matches) Object.assign(m, patch);
              return { data: matches.map((m) => projectColumns({ id: m.id }, cols)), error: null };
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
      // H-1: record_outbox_ref — fenced external_refs upsert (state stays committed) (int row count).
      if (fn === 'record_outbox_ref') {
        const gen = args.p_generation as number;
        if (!row || row.claim_generation !== gen || row.state !== 'committed') return { data: 0, error: null };
        externalRefs.push({
          domain: args.p_domain, pmo_record_id: args.p_pmo_record_id,
          external_tier: args.p_external_tier, external_record_id: args.p_external_record_id,
        });
        return { data: 1, error: null };
      }
      // H-1: confirm_outbox — fenced committed→confirmed (int row count).
      if (fn === 'confirm_outbox') {
        const gen = args.p_generation as number;
        if (!row || row.claim_generation !== gen || row.state !== 'committed') return { data: 0, error: null };
        row.state = 'confirmed';
        return { data: 1, error: null };
      }
      // C-1: mark_outbox_held — fenced committing→held (int row count).
      if (fn === 'mark_outbox_held') {
        const gen = args.p_generation as number;
        if (!row || row.claim_generation !== gen || row.state !== 'committing') return { data: 0, error: null };
        row.state = 'held';
        row.last_error = args.p_reason as string;
        return { data: 1, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
  return { client, rows, rpcCalls, externalRefs, inserted };
}

Deno.test('readOutbox: null when no row for the 4-tuple; maps a found row to camelCase OutboxRow', async () => {
  const { client } = makeFakeClient([
    {
      id: 'outbox-1', org_id: 'org-1', domain: 'procurement', pmo_record_id: 'pmo-1', idempotency_key: 'key-1',
      external_tier: 'erpnext', operation: 'create', state: 'pending', external_record_id: null, canonical: null,
      claim_generation: 0, last_error: null, payload_digest: null,
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

// ============================================================================
// Luna re-audit BLOCK 7 — persist the dispatching actor on the outbox row.
// The caller's user id was threaded ONLY from the live request JWT (index.ts -> the read-model
// writer's callerUserId), never persisted. So when the SWEEP later finalizes a committed-but-
// unmirrored SI there is no request JWT and the author is unrecoverable: `author_user_id` lands NULL
// and the approver≠author SoD then passes for everyone (B6 is the fail-closed backstop; this is the
// root-cause fix). `actor_user_id` is stamped at INSERT from the VERIFIED JWT (index.ts's
// `verified.sub`), never from anything the client can supply.
// ============================================================================

Deno.test('Luna B7 — insertOutboxPending persists actor_user_id (the verified caller) so a later sweep finalize can attribute the author', async () => {
  const { client, inserted } = makeFakeClient();
  const deps = createDbMoneyOutboxDeps({
    serviceClient: client,
    orgId: 'org-1',
    externalTier: 'erpnext',
    operation: 'create',
    probeByRemarksKey: async () => null,
    actorUserId: 'user-author-1',
  });
  await deps.insertOutboxPending('revenue', 'pmo-si-1', 'key-b7-1');
  assertEquals(
    (inserted[0] as Record<string, unknown>).actor_user_id,
    'user-author-1',
    'the outbox row must carry the dispatching actor so the sweep can recover the author',
  );
});

Deno.test('Luna B7 — insertOutboxPending omits actor_user_id when no actor is known (nullable: the machine/sweep-originated path stays valid)', async () => {
  const { client, inserted } = makeFakeClient();
  const deps = createDbMoneyOutboxDeps({ serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create', probeByRemarksKey: async () => null });
  await deps.insertOutboxPending('revenue', 'pmo-si-2', 'key-b7-2');
  assert(
    !('actor_user_id' in (inserted[0] as Record<string, unknown>)),
    'an actor-less caller must not write the column at all (never a bogus/empty actor)',
  );
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

Deno.test('callRowRpc consumers: a PostgREST NULL-composite (row of all-null fields) means not-claimable → null, never a state:null row', async () => {
  // PostgREST serializes a plpgsql `RETURN NULL` composite as `{id:null, state:null, …}`, NOT JSON
  // null (found live: the F1 same-key-retry back-off path 500'd with "unreachable outbox state:
  // null"). The deps must detect not-claimable by the never-null PK.
  const nullComposite = {
    id: null, org_id: null, domain: null, pmo_record_id: null, idempotency_key: null,
    external_tier: null, operation: null, state: null, external_record_id: null, canonical: null,
    claim_generation: null, last_error: null,
  };
  const client = {
    from() { throw new Error('unused'); },
    async rpc() { return { data: nullComposite, error: null }; },
  } as unknown as OutboxServiceClient;
  const deps = createDbMoneyOutboxDeps({ serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create', probeByRemarksKey: async () => null });
  assertEquals(await deps.claimOutboxForCommit('outbox-1'), null, 'claim: all-null composite → null');
  assertEquals(await deps.quarantineCommitting('outbox-1'), null, 'quarantine: all-null composite → null');
});

Deno.test('markOutboxCommitted/Failed: guarded write-backs affect 1 row when the token matches, 0 when stale', async () => {
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

  const failedStaleCount = await deps.markOutboxFailed('outbox-1', 'boom', 2);
  assertEquals(failedStaleCount, 1, 'the current token marks failed');
});

Deno.test('H-1 recordOutboxRef + confirmOutbox: fenced ref upsert then confirm, only for the current token (0 when superseded)', async () => {
  const { client, rows, externalRefs } = makeFakeClient([
    {
      id: 'outbox-1', org_id: 'org-1', domain: 'procurement', pmo_record_id: 'pmo-1', idempotency_key: 'key-1',
      external_tier: 'erpnext', operation: 'create', state: 'committed', external_record_id: 'PI-1', canonical: null,
      claim_generation: 2, last_error: null,
    },
  ]);
  const deps = createDbMoneyOutboxDeps({ serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create', probeByRemarksKey: async () => null });
  const mapping = { pmoRecordId: 'pmo-1', externalTier: 'erpnext', externalRecordId: 'PI-1', domain: 'procurement' };
  // A superseded (stale) token: the ref RPC is a 0-row no-op — no ref, row stays committed.
  assertEquals(await deps.recordOutboxRef('outbox-1', 1, mapping), 0, 'a superseded ref write must affect 0 rows');
  assertEquals(externalRefs.length, 0, 'a superseded ref write persists NO external_refs');
  assertEquals(await deps.confirmOutbox('outbox-1', 1), 0, 'a superseded confirm must affect 0 rows');
  assertEquals(rows.get('outbox-1')?.state, 'committed');
  // The current token: ref written (state stays committed), then confirm promotes committed→confirmed.
  assertEquals(await deps.recordOutboxRef('outbox-1', 2, mapping), 1);
  assertEquals(rows.get('outbox-1')?.state, 'committed', 'ref write leaves the row committed (confirm is separate)');
  assertEquals(externalRefs[0]?.external_record_id, 'PI-1');
  assertEquals(await deps.confirmOutbox('outbox-1', 2), 1);
  assertEquals(rows.get('outbox-1')?.state, 'confirmed');
});

Deno.test('H-1 recordOutboxRef applies the injected encodeExternalRecordId (companies "<Doctype>:<name>" prefix)', async () => {
  const { client, externalRefs } = makeFakeClient([
    {
      id: 'outbox-1', org_id: 'org-1', domain: 'companies', pmo_record_id: 'pmo-sup', idempotency_key: 'key-1',
      external_tier: 'erpnext', operation: 'create', state: 'committed', external_record_id: 'ACME', canonical: null,
      claim_generation: 1, last_error: null,
    },
  ]);
  const deps = createDbMoneyOutboxDeps({
    serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create', probeByRemarksKey: async () => null,
    encodeExternalRecordId: (m) => `Supplier:${m.externalRecordId}`,
  });
  await deps.recordOutboxRef('outbox-1', 1, { pmoRecordId: 'pmo-sup', externalTier: 'erpnext', externalRecordId: 'ACME', domain: 'companies' });
  assertEquals(externalRefs[0]?.external_record_id, 'Supplier:ACME', 'the encoder is applied inside the fenced write');
});

Deno.test('C-1 markOutboxHeld: fenced committing→held for the current token (0 when superseded or non-committing); reissueOnInconclusiveAbsence defaults true, PE=false', async () => {
  const { client, rows } = makeFakeClient([
    {
      id: 'outbox-1', org_id: 'org-1', domain: 'procurement', pmo_record_id: 'pmo-pe', idempotency_key: 'key-1',
      external_tier: 'erpnext', operation: 'create', state: 'committing', external_record_id: null, canonical: null,
      claim_generation: 3, last_error: null,
    },
  ]);
  const deps = createDbMoneyOutboxDeps({ serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create', probeByRemarksKey: async () => null });
  assertEquals(deps.reissueOnInconclusiveAbsence, true, 'defaults reissue-capable');
  const stale = await deps.markOutboxHeld('outbox-1', 'pe-inconclusive', 2);
  assertEquals(stale, 0, 'a stale token cannot hold the row');
  assertEquals(rows.get('outbox-1')?.state, 'committing');
  const held = await deps.markOutboxHeld('outbox-1', 'pe-inconclusive', 3);
  assertEquals(held, 1);
  assertEquals(rows.get('outbox-1')?.state, 'held');
  assertEquals(rows.get('outbox-1')?.last_error, 'pe-inconclusive');

  const peDeps = createDbMoneyOutboxDeps({ serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create', probeByRemarksKey: async () => null, reissueOnInconclusiveAbsence: false });
  assertEquals(peDeps.reissueOnInconclusiveAbsence, false, 'PE is held-on-inconclusive');
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

Deno.test('FIX 2: reauthorizeRecoveryReissue is passed through when supplied (sweep path) and UNDEFINED when omitted (sync path is byte-for-byte)', async () => {
  const { client } = makeFakeClient();

  // Sync path: no reauth supplied ⇒ the dep is undefined, so dispatch.ts never re-checks a reissue
  // (the synchronous gate already ran fresh for the current caller).
  const syncDeps = createDbMoneyOutboxDeps({
    serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create',
    probeByRemarksKey: async () => null,
  });
  assert(syncDeps.reauthorizeRecoveryReissue === undefined, 'the sync path must not carry a reissue re-check');

  // Sweep path: the recovery pass supplies it, and it is invoked verbatim on the reissue branch.
  let reauthCalled = false;
  const sweepDeps = createDbMoneyOutboxDeps({
    serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create',
    probeByRemarksKey: async () => null,
    reauthorizeRecoveryReissue: async () => { reauthCalled = true; return { ok: false, message: 'actor demoted' }; },
  });
  assert(typeof sweepDeps.reauthorizeRecoveryReissue === 'function', 'the sweep path must carry the reissue re-check');
  const result = await sweepDeps.reauthorizeRecoveryReissue!();
  assert(reauthCalled, 'expected the injected reissue re-check to be invoked');
  assertEquals(result, { ok: false, message: 'actor demoted' }, 'the re-check result is passed through unchanged');
});

// ============================================================================
// Slice A (migration 0151) — the timesheets push INSERT is serialized against a concurrent re-open
// and re-verifies status='Approved' server-side via insert_timesheet_outbox_pending (AC-TSC-R2). The
// dep branches on domain === 'timesheets': that domain routes through the RPC (the FENCE-2 push-side
// guard); every other domain takes the byte-for-byte generic insert. A sync push that raced a re-open
// (the sheet flipped to Draft between the gate read and the insert) must raise BEFORE any ERP POST —
// no orphan row, no wedge, no reconcile loop.
// ============================================================================

Deno.test('AC-TSC-R2 — insertOutboxPending for the timesheets domain routes through insert_timesheet_outbox_pending (re-verifies Approved server-side), NOT the generic insert', async () => {
  let rpcCalled: { fn: string; args: Record<string, unknown> } | null = null;
  let genericInsertCalled = false;
  const insertedRow: FakeRow = {
    id: 'outbox-ts-1', org_id: 'org-1', domain: 'timesheets', pmo_record_id: 'ts-1',
    idempotency_key: 'ts:ts-1:t1', external_tier: 'erpnext', operation: 'create', state: 'pending',
    external_record_id: null, canonical: null, claim_generation: 0, last_error: null, payload_digest: null,
  };
  const client: OutboxServiceClient = {
    from() {
      // The timesheets domain must NOT reach the generic .insert() path.
      genericInsertCalled = true;
      return {
        insert() { return { select() { return { async single() { return { data: insertedRow, error: null }; } }; } }; },
      } as never;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalled = { fn, args };
      return { data: { ...insertedRow }, error: null };
    },
  } as unknown as OutboxServiceClient;
  const deps = createDbMoneyOutboxDeps({
    serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create',
    probeByRemarksKey: async () => null,
    payload: { week: '2026-30' }, payloadDigest: 'digest-abc', actorUserId: 'user-approver-1',
  });
  const row = await deps.insertOutboxPending('timesheets', 'ts-1', 'ts:ts-1:t1');

  assert(rpcCalled !== null, 'timesheets insert MUST route through insert_timesheet_outbox_pending (re-verifies Approved server-side)');
  assertEquals(rpcCalled!.fn, 'insert_timesheet_outbox_pending', 'the RPC name is the named guard');
  assertEquals(rpcCalled!.args, {
    p_org: 'org-1',
    p_domain: 'timesheets',
    p_record_id: 'ts-1',
    p_key: 'ts:ts-1:t1',
    p_tier: 'erpnext',
    p_operation: 'create',
    p_payload: { week: '2026-30' },
    p_digest: 'digest-abc',
    p_actor: 'user-approver-1',
  }, 'the RPC is called with the dep\'s closed-over org/tier/operation + the command\'s key/payload/digest/actor');
  assert(!genericInsertCalled, 'the timesheets domain must NOT take the generic .insert() path');
  assertEquals(row.id, 'outbox-ts-1');
  assertEquals(row.state, 'pending');
  assertEquals(row.pmoRecordId, 'ts-1');
});

Deno.test('AC-TSC-R2 — a timesheets insert whose RPC raises (e.g. timesheet-no-longer-approved) preserves error.code, same shape as the generic 23505', async () => {
  const client: OutboxServiceClient = {
    from() { throw new Error('timesheets insert must not reach the generic path'); },
    async rpc() {
      return { data: null, error: { message: 'timesheet-no-longer-approved', code: 'P0001' } };
    },
  } as unknown as OutboxServiceClient;
  const deps = createDbMoneyOutboxDeps({
    serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create',
    probeByRemarksKey: async () => null,
  });
  let threw = false;
  try {
    await deps.insertOutboxPending('timesheets', 'ts-1', 'ts:ts-1:t1');
  } catch (err) {
    threw = true;
    assertEquals((err as { code?: string }).code, 'P0001', 'the pg error code is preserved so dispatch.ts can branch on it');
    assertEquals((err as Error).message, 'timesheet-no-longer-approved', 'the server message is preserved');
  }
  assert(threw, 'a raising RPC must throw (not silently return)');
});

Deno.test('AC-TSC-R2 — non-timesheets domains take the generic insert path byte-for-byte (no RPC routing)', async () => {
  const { client, inserted } = makeFakeClient();
  let rpcCalled = false;
  // Wrap only rpc (to detect wrong routing); reuse makeFakeClient's bound from() for the generic path.
  const wrapped: OutboxServiceClient = {
    from: (...a: unknown[]) => (client.from as (...b: unknown[]) => unknown)(...a) as never,
    rpc: async () => { rpcCalled = true; return { data: null, error: null }; },
  } as unknown as OutboxServiceClient;
  const deps = createDbMoneyOutboxDeps({ serviceClient: wrapped, orgId: 'org-1', externalTier: 'erpnext', operation: 'create', probeByRemarksKey: async () => null });
  const row = await deps.insertOutboxPending('procurement', 'pmo-1', 'key-1');
  assert(!rpcCalled, 'a non-timesheets domain must NOT call the timesheets RPC');
  assertEquals(row.state, 'pending');
  assertEquals(inserted.length, 1, 'the generic .insert() path ran once');
});
