// Issue 2255 — per-organization dispatch cursors + the shared per-tick event budget.
//
// Several organizations live on one project (ADR-0101). The dispatcher's poll cursor was one row per
// event source, so a second organization depended on the first one's progress: an organization whose
// assistant feature was briefly unreadable had its event window walked over by another organization's
// cursor, and a burst from a busy organization delayed every other organization's events by up to
// MAX_TRIGGER_EVENTS_PER_TICK per tick of backlog. With one cursor per (source, organization) each
// organization keeps its own place in the event log and the tick budget is shared fairly:
//   • an organization filtered out by the entitlement gate reads, claims and advances nothing;
//     its events are still there when it becomes eligible again;
//   • organizations with pending events split the tick budget evenly (minimum one event each), and
//     an organization that cannot use its share leaves it to the others;
//   • an organization with no cursor row yet starts from the earliest created_at among its OWN
//     enabled trigger automations for the source, never from the beginning of history;
//   • a claim outage for one organization's event stops only that organization's cursor;
//   • a single organization alone sees the same events, in the same order, with the same cursor
//     advance as the shared-cursor design.
//
// [REC-1] The tests import the SHIPPED dispatcher; the fake service client mirrors the real
// select_trigger_events contract (SEC-HIGH-2, migration 0054): org-scoped (org_id, to_status)
// filters, the compound (created_at, id) cursor applied strictly-after, rows ordered by
// (created_at, id). The source business table is never reachable through .from().
//
// Verify: cd supabase/functions/agent-dispatch && deno test --allow-all

import { assertEquals } from 'jsr:@std/assert@1';
import { runDispatchTick, selectTriggerMatches, MAX_TRIGGER_EVENTS_PER_TICK } from './dispatcher.ts';
import type { AutomationRow, ServiceClientLike, StatusEventRow } from './dispatcher.ts';

const SOURCE = 'procurement_status_events';

interface FakeEvent {
  id: string;
  created_at: string;
  to_status: string;
  org_id: string;
}

function trigger(id: string, orgId: string, ownerId: string, createdAt: string): AutomationRow {
  return {
    id,
    kind: 'trigger',
    owner_id: ownerId,
    org_id: orgId,
    prompt: `notify me when ordered (${id})`,
    trigger_on: { source: SOURCE, event: 'Ordered' },
    enabled: true,
    archived_at: null,
    created_at: createdAt,
  };
}

function event(id: string, orgId: string, toStatus: string, createdAt: string): FakeEvent {
  return { id, created_at: createdAt, to_status: toStatus, org_id: orgId };
}

/** The minted owner client: audit inserts (thread/run/event) + notification inserts all succeed. */
function makeMintedClient(): unknown {
  const from = (table: string) => {
    const insert = (_row: unknown) => {
      const base = Promise.resolve({ data: null, error: null }) as Promise<{ data: unknown; error: unknown }> & {
        select: () => { single: () => Promise<{ data: { id: string } | null; error: unknown }>; };
      };
      return Object.assign(base, {
        select: () => ({ single: async () => ({ data: { id: `${table}-1` }, error: null }) }),
      });
    };
    return { insert };
  };
  return { from };
}

/**
 * A service_client fake whose select_trigger_events behaves like the shipped SECURITY DEFINER RPC:
 * each call carries ONE organization's (org_id, event) filters (mixed-org filters throw — the
 * per-org selection contract), the compound (created_at, id) cursor is applied strictly-after, and
 * rows come back ordered by (created_at, id). Watermarks are stored per `source:org_id`.
 */
function makeFakeDeps(opts: {
  automations: AutomationRow[];
  events: FakeEvent[];
  featureEnabled: Record<string, boolean>;
  claim?: (automationId: string, eventId: string) => 'ok' | 'error';
}) {
  const watermarkReads: string[] = [];
  const watermarkUpserts: Array<Record<string, unknown>> = [];
  const watermarks = new Map<string, { last_seen_id: string | null; last_seen_at: string | null }>();
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const firedOwners: string[] = [];

  const serviceFrom = (table: string): unknown => {
    if (table === 'agent_automations') {
      return {
        select: (_cols: string) => ({
          eq: (_c: string, _v: unknown) => ({
            eq: (_c2: string, _v2: unknown) => ({
              is: async (_c3: string, _v3: null) => ({
                data: opts.automations.map((a) => ({ ...a })),
                error: null,
              }),
            }),
          }),
        }),
        update: (_patch: Record<string, unknown>) => ({
          eq: async () => ({ data: null, error: null }),
        }),
      };
    }
    if (table === 'agent_dispatch_watermarks') {
      return {
        select: (_cols: string) => {
          let source: string | undefined;
          let orgId: string | undefined;
          const eq = (col: string, val: string) => {
            if (col === 'source') source = val;
            if (col === 'org_id') orgId = val;
            return { eq };
          };
          return {
            eq: (col: string, val: string) => {
              const chain = eq(col, val);
              return {
                eq: (col2: string, val2: string) => {
                  eq(col2, val2);
                  return {
                    maybeSingle: async () => {
                      watermarkReads.push(`${source}:${orgId}`);
                      const row = watermarks.get(`${source}:${orgId}`);
                      return { data: row ? { ...row } : null, error: null };
                    },
                  };
                },
              };
            },
          };
        },
        upsert: async (row: Record<string, unknown>) => {
          watermarkUpserts.push({ ...row });
          watermarks.set(`${row.source}:${row.org_id}`, {
            last_seen_id: row.last_seen_id as string | null,
            last_seen_at: row.last_seen_at as string | null,
          });
          return { data: null, error: null };
        },
      };
    }
    if (table === 'agent_automation_fires') {
      return {
        insert: (row: Record<string, unknown>) => ({
          select: async (_cols: string) => {
            const verdict = opts.claim?.(String(row.automation_id), String(row.event_id)) ?? 'ok';
            if (verdict !== 'ok') {
              return { data: null, error: { code: 'XX000', message: 'claim outage' } };
            }
            return { data: [{ automation_id: row.automation_id }], error: null };
          },
        }),
        update: (_patch: Record<string, unknown>) => ({
          eq: () => ({ eq: async () => ({ data: null, error: null }) }),
        }),
      };
    }
    throw new Error(`service_role must never .from() unexpected table: ${table}`);
  };

  const rpc = async (name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => {
    rpcCalls.push({ name, args });
    if (name === 'service_feature_enabled') {
      return { data: opts.featureEnabled[String(args.p_org_id)] === true, error: null };
    }
    if (name === 'select_trigger_events') {
      const filters = (args.p_filters as Array<{ org_id: string; event: string }>) ?? [];
      const orgId = filters[0]?.org_id ?? null;
      if (filters.some((f) => f.org_id !== orgId)) {
        throw new Error('fake: a select_trigger_events call must carry ONE organization\'s filters');
      }
      const lastSeenAt = args.p_last_seen_at as string | null;
      const lastSeenId = args.p_last_seen_id as string | null;
      const rows = opts.events
        .filter((e) => e.org_id === orgId && filters.some((f) => f.event === e.to_status))
        .filter((e) =>
          lastSeenAt === null ||
          e.created_at > lastSeenAt ||
          (e.created_at === lastSeenAt && lastSeenId !== null && e.id > lastSeenId)
        )
        .sort((a, b) => (`${a.created_at}:${a.id}`).localeCompare(`${b.created_at}:${b.id}`))
        .map((e) => ({ id: e.id, created_at: e.created_at, to_status: e.to_status, org_id: e.org_id }));
      return { data: rows, error: null };
    }
    return { data: null, error: null };
  };

  const serviceClient = { from: serviceFrom, rpc } as unknown as ServiceClientLike;

  const handler = (_req: { runId?: string }, deps: { userId: string }) =>
    (async function* () {
      firedOwners.push(deps.userId);
      yield { runId: _req.runId ?? 'run', type: 'status', payload: { status: 'completed' } };
    })();

  const deps = () => ({
    serviceClient,
    authAdmin: {
      admin: {
        generateLink: async () => ({ data: { properties: { hashed_token: 'HASH' } }, error: null }),
        getUserById: async (id: string) => ({ data: { user: { email: `${id}@example.com` } }, error: null }),
      },
    },
    verifyOtp: async () => ({ data: { session: { access_token: 'MINTED' } }, error: null }),
    buildClient: () => makeMintedClient(),
    handler,
    modelClient: { create: async () => ({}) },
    model: 'test-model',
    conditionModel: { create: async () => { throw new Error('no condition calls expected in these tests'); } },
    conditionModelId: 'cheap',
    now: () => new Date('2026-07-06T09:00:00Z'),
    newRunId: (() => {
      let n = 0;
      return () => `run-${++n}`;
    })(),
    newMintedAt: () => '2026-07-06T09:00:00.000Z',
  });

  return {
    serviceClient, deps, featureEnabled: opts.featureEnabled,
    watermarks, watermarkReads, watermarkUpserts, rpcCalls, firedOwners,
  };
}

function wmKey(orgId: string): string {
  return `${SOURCE}:${orgId}`;
}

// ── (1) An organization whose assistant feature is off keeps its own place in the log ──────────

Deno.test('per-org cursor — an organization with its feature switch off is not walked over: the other organization advances, its own cursor does not, and its event fires once the switch is readable again', async () => {
  const createdAt = '2026-07-06T07:00:00Z';
  const f = makeFakeDeps({
    automations: [
      trigger('trig-A', 'org-A', 'user-A', createdAt),
      trigger('trig-B', 'org-B', 'user-B', createdAt),
    ],
    events: [
      event('evt-A', 'org-A', 'Ordered', '2026-07-06T08:00:01Z'),
      event('evt-B', 'org-B', 'Ordered', '2026-07-06T08:00:02Z'),
    ],
    featureEnabled: { 'org-A': true, 'org-B': false },
  });
  const feature = f.featureEnabled;

  await runDispatchTick(f.deps() as never);

  // Org A ran normally: its cursor sits on its own attempted event.
  assertEquals(f.watermarks.get(wmKey('org-A'))?.last_seen_id, 'evt-A');
  // Org B was filtered out by the entitlement gate: no cursor read, no claim, no advance.
  assertEquals(f.watermarkReads.includes(wmKey('org-B')), false);
  assertEquals(f.watermarks.has(wmKey('org-B')), false);
  assertEquals(f.firedOwners, ['user-A']);
  // Every event-selection call carried org A's filters only.
  const selectCalls = f.rpcCalls.filter((c) => c.name === 'select_trigger_events');
  assertEquals(selectCalls.length, 1);
  assertEquals((selectCalls[0].args.p_filters as Array<{ org_id: string }>)[0].org_id, 'org-A');

  // Next tick: org B's switch is readable again — its event from the switched-off window fires.
  feature['org-B'] = true;
  await runDispatchTick(f.deps() as never);

  assertEquals(f.watermarks.get(wmKey('org-B'))?.last_seen_id, 'evt-B');
  assertEquals(f.firedOwners, ['user-A', 'user-B']);
  assertEquals(f.watermarks.get(wmKey('org-A'))?.last_seen_id, 'evt-A');
});

// ── (2) A burst from one organization does not delay another ───────────────────────────────────

Deno.test('per-org budget — an organization with a 500-event backlog does not stop another organization\'s single event: both are attempted in the first tick, within the tick budget', async () => {
  const createdAt = '2026-07-06T07:00:00Z';
  const automations = [
    trigger('trig-A', 'org-A', 'user-A', createdAt),
    trigger('trig-B', 'org-B', 'user-B', createdAt),
  ];
  const burst: FakeEvent[] = [];
  for (let i = 0; i < 500; i++) {
    burst.push(event(`evt-a-${String(i).padStart(3, '0')}`, 'org-A', 'Ordered', new Date(Date.parse('2026-07-06T08:00:00Z') + i).toISOString()));
  }
  // Org B's event is chronologically LAST — fairness is the budget split, not arrival order luck.
  const f = makeFakeDeps({
    automations,
    events: [...burst, event('evt-b', 'org-B', 'Ordered', '2026-07-06T08:00:01Z')],
    featureEnabled: { 'org-A': true, 'org-B': true },
  });

  const matches = await selectTriggerMatches(f.serviceClient, new Date('2026-07-06T09:00:00Z'), automations);

  assertEquals(matches.length, MAX_TRIGGER_EVENTS_PER_TICK);
  // Org B's event was attempted in the FIRST tick (no head-of-line delay), and the total stays
  // inside the tick budget.
  assertEquals(matches.filter((m) => m.event.org_id === 'org-B').length, 1);
  assertEquals(matches.filter((m) => m.event.org_id === 'org-A').length, MAX_TRIGGER_EVENTS_PER_TICK - 1);
});

// ── (3) One organization alone behaves exactly as before ───────────────────────────────────────

Deno.test('per-org cursor — one organization alone: the same events, in the same order, with the cursor advanced to the last attempted event', async () => {
  const createdAt = '2026-07-06T07:00:00Z';
  const f = makeFakeDeps({
    automations: [trigger('trig-A', 'org-A', 'user-A', createdAt)],
    events: [
      event('evt-1', 'org-A', 'Ordered', '2026-07-06T08:00:01Z'),
      event('evt-2', 'org-A', 'Ordered', '2026-07-06T08:00:02Z'),
      event('evt-3', 'org-A', 'Ordered', '2026-07-06T08:00:03Z'),
    ],
    featureEnabled: { 'org-A': true },
  });

  const matches = await selectTriggerMatches(
    f.serviceClient,
    new Date('2026-07-06T09:00:00Z'),
    [trigger('trig-A', 'org-A', 'user-A', createdAt)],
  );
  assertEquals(matches.map((m) => m.event.id), ['evt-1', 'evt-2', 'evt-3']);

  await runDispatchTick(f.deps() as never);

  assertEquals(f.firedOwners, ['user-A', 'user-A', 'user-A']);
  assertEquals(f.watermarks.get(wmKey('org-A'))?.last_seen_id, 'evt-3');
  assertEquals(f.watermarkUpserts.length, 1);
});

// ── (4) An organization with no cursor row starts from its own earliest automation ─────────────

Deno.test('per-org cursor — no cursor row yet: selection starts at the earliest created_at among the organization\'s own enabled trigger automations, never at the beginning of history', async () => {
  const createdAt = '2026-07-06T08:00:00Z';
  const f = makeFakeDeps({
    automations: [trigger('trig-C', 'org-C', 'user-C', createdAt)],
    events: [
      event('evt-before', 'org-C', 'Ordered', '2026-07-06T07:59:59Z'),
      event('evt-after', 'org-C', 'Ordered', '2026-07-06T08:00:01Z'),
    ],
    featureEnabled: { 'org-C': true },
  });

  const matches = await selectTriggerMatches(
    f.serviceClient,
    new Date('2026-07-06T09:00:00Z'),
    [trigger('trig-C', 'org-C', 'user-C', createdAt)],
  );

  // The event created before the automation exists is not selected; the later one is.
  assertEquals(matches.map((m) => m.event.id), ['evt-after']);
  const selectCall = f.rpcCalls.find((c) => c.name === 'select_trigger_events');
  assertEquals(selectCall?.args.p_last_seen_at, createdAt);
  assertEquals(selectCall?.args.p_last_seen_id, null);
});

// ── (5) A claim outage stops only the affected organization's cursor ───────────────────────────

Deno.test('per-org cursor — a claim outage for one organization\'s event stops only that organization\'s cursor; the other organization keeps advancing', async () => {
  const createdAt = '2026-07-06T07:00:00Z';
  const f = makeFakeDeps({
    automations: [
      trigger('trig-A', 'org-A', 'user-A', createdAt),
      trigger('trig-B', 'org-B', 'user-B', createdAt),
    ],
    events: [
      event('evt-A', 'org-A', 'Ordered', '2026-07-06T08:00:01Z'),
      event('evt-B', 'org-B', 'Ordered', '2026-07-06T08:00:02Z'),
    ],
    featureEnabled: { 'org-A': true, 'org-B': true },
    claim: (_automationId, eventId) => (eventId === 'evt-B' ? 'error' : 'ok'),
  });

  await runDispatchTick(f.deps() as never);

  // Org A's event was claimed and fired: its cursor advanced past it.
  assertEquals(f.watermarks.get(wmKey('org-A'))?.last_seen_id, 'evt-A');
  // Org B's claim failed: nothing fired, nothing was attempted, its cursor did not move.
  assertEquals(f.firedOwners, ['user-A']);
  assertEquals(f.watermarks.has(wmKey('org-B')), false);
});
