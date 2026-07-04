/**
 * dispatcher.reliability.test.ts — per-automation error isolation, timeout-derived AbortSignal,
 * and the compound (created_at, id) watermark cursor (review-remediation items 2/3/4).
 * [REC-1]: logic lives in supabase/functions/agent-dispatch/*, tests live here.
 */
import { describe, it, expect, vi } from 'vitest';
import { runDispatchTick, selectTriggerMatches } from '../../../../../supabase/functions/agent-dispatch/dispatcher';
import type { AutomationRow } from '../../../../../supabase/functions/agent-dispatch/dispatcher';

function makeScheduleAutomation(overrides: Partial<AutomationRow> = {}): AutomationRow {
  return {
    id: 'auto-A',
    kind: 'schedule',
    owner_id: 'user-A',
    org_id: 'org-A',
    prompt: 'summarize my overdue tasks',
    schedule: '* * * * *', // matches every tick
    enabled: true,
    archived_at: null,
    timeout_s: 90,
    ...overrides,
  };
}

/** A serviceClient mock — schedule-selection resolves the given automations; last_fired_at/watermark are no-ops. */
function makeServiceClient(automations: AutomationRow[]) {
  const tablesTouched: string[] = [];
  const isMock = vi.fn().mockResolvedValue({ data: automations, error: null });
  const eq2Mock = vi.fn().mockReturnValue({ is: isMock });
  const eq1Mock = vi.fn().mockReturnValue({ eq: eq2Mock });
  const selectMock = vi.fn().mockReturnValue({ eq: eq1Mock });
  // AUDIT-M2: .update().eq() must be awaitable (trigger stampLastFired) AND chain
  // .or().select() (schedule claim — resolves one claimed row so schedules fire in tests).
  const updateOrSelectMock = vi.fn().mockResolvedValue({ data: [{ id: 'claimed' }], error: null });
  const updateEqMock = vi.fn().mockReturnValue(
    Object.assign(Promise.resolve({ data: null, error: null }), {
      or: vi.fn().mockReturnValue({ select: updateOrSelectMock }),
    }),
  );
  const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock });
  const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const wmEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
  const wmSelectMock = vi.fn().mockReturnValue({ eq: wmEqMock });

  const from = vi.fn((table: string) => {
    tablesTouched.push(table);
    if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock, upsert: upsertMock };
    return { select: selectMock, update: updateMock };
  });

  return { client: { from }, tablesTouched, updateMock, upsertMock };
}

/** A minted-client mock recording every .from() call, including a notifications insert path. */
function makeMintedClient() {
  const tablesTouched: string[] = [];
  const notifInsert = vi.fn().mockResolvedValue({ error: null });
  const singleThread = () => Promise.resolve({ data: { id: 'thread-1' }, error: null });
  const singleRun = () => Promise.resolve({ data: { id: 'run-1' }, error: null });
  const singleEvent = () => Promise.resolve({ data: { id: 'evt-1' }, error: null });
  const auditInsert = vi.fn((_row: unknown) => ({
    select: () => ({
      single: () => {
        const last = tablesTouched[tablesTouched.length - 1];
        if (last === 'agent_threads') return singleThread();
        if (last === 'agent_runs') return singleRun();
        return singleEvent();
      },
    }),
  }));
  const from = vi.fn((table: string) => {
    tablesTouched.push(table);
    if (table === 'notifications') return { insert: notifInsert };
    return { insert: auditInsert };
  });
  return { client: { from, __identity: 'minted' }, tablesTouched, notifInsert, auditInsert };
}

function makeMintDeps(mintedClientForOwner: (ownerId: string) => unknown) {
  const generateLink = vi.fn().mockImplementation(() =>
    Promise.resolve({ data: { properties: { access_token: 'MINTED' } }, error: null }),
  );
  const getUserById = vi.fn(async (id: string) => ({ data: { user: { email: id } }, error: null }));
  const authAdmin = { admin: { generateLink, getUserById } };
  const buildClient = vi.fn().mockImplementation(() => mintedClientForOwner('unused'));
  return { authAdmin, buildClient, generateLink };
}

describe('runDispatchTick — item 2: per-automation error isolation (fire loop)', () => {
  it('automation #1 throwing does not prevent automation #2 from firing', async () => {
    const a1 = makeScheduleAutomation({ id: 'auto-1', owner_id: 'user-1' });
    const a2 = makeScheduleAutomation({ id: 'auto-2', owner_id: 'user-2' });
    const svc = makeServiceClient([a1, a2]);

    const minted1 = makeMintedClient();
    const minted2 = makeMintedClient();
    const clientsByCallOrder = [minted1.client, minted2.client];
    let mintCall = 0;
    const mintDeps = makeMintDeps(() => clientsByCallOrder[mintCall++]);

    const handler = vi.fn(async function* (
      _req: { runId?: string },
      deps: { userId: string },
    ) {
      if (deps.userId === 'user-1') {
        throw new Error('boom from automation 1');
      }
      yield { runId: 'run-2', type: 'status', payload: { status: 'completed' } };
    });

    let runIdCounter = 0;
    await runDispatchTick({
      serviceClient: svc.client as never,
      authAdmin: mintDeps.authAdmin as never,
      buildClient: mintDeps.buildClient,
      handler: handler as never,
      modelClient: { create: vi.fn() } as never,
      model: 'anthropic/claude',
      conditionModel: { create: vi.fn() } as never,
      conditionModelId: 'cheap',
      now: () => new Date('2026-07-06T08:00:00Z'),
      newRunId: () => `run-${++runIdCounter}`,
      newMintedAt: () => '2026-07-06T08:00:00.000Z',
    });

    // Both automations were attempted — automation #2 still fired despite #1's throw.
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('a per-unit throw does not crash the whole tick (runDispatchTick resolves, not rejects)', async () => {
    const a1 = makeScheduleAutomation({ id: 'auto-1', owner_id: 'user-1' });
    const svc = makeServiceClient([a1]);
    const minted = makeMintedClient();
    const mintDeps = makeMintDeps(() => minted.client);

    const handler = vi.fn(async function* (): AsyncGenerator<{ runId: string; type: string; payload?: unknown }> {
      if (true as boolean) throw new Error('boom');
      yield { runId: 'r', type: 'status', payload: { status: 'completed' } };
    });

    await expect(
      runDispatchTick({
        serviceClient: svc.client as never,
        authAdmin: mintDeps.authAdmin as never,
        buildClient: mintDeps.buildClient,
        handler: handler as never,
        modelClient: { create: vi.fn() } as never,
        model: 'm',
        conditionModel: { create: vi.fn() } as never,
        conditionModelId: 'cheap',
        now: () => new Date('2026-07-06T08:00:00Z'),
        newRunId: () => 'run-1',
        newMintedAt: () => '2026-07-06T08:00:00.000Z',
      }),
    ).resolves.toBeUndefined();
  });

  it("a trigger automation's throw still advances the watermark for the event it was attempted against (no double-fire next tick)", async () => {
    const trigger = makeScheduleAutomation({
      id: 'trig-1',
      kind: 'trigger',
      schedule: null,
      owner_id: 'user-1',
      trigger_on: { source: 'procurement_status_events', event: 'Ordered' },
    });

    let automationSelectCall = 0;
    const scheduleIs = vi.fn().mockResolvedValue({ data: [], error: null });
    const triggerIs = vi.fn().mockResolvedValue({ data: [trigger], error: null });
    const makeSelectChain = (isMock: ReturnType<typeof vi.fn>) => ({ eq: () => ({ eq: () => ({ is: isMock }) }) });
    // SEC-HIGH-2: the trigger event comes from the select_trigger_events RPC, not a raw table read.
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'evt-1', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-A' }],
      error: null,
    });
    const wmMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const wmSelect = vi.fn().mockReturnValue({ eq: () => ({ maybeSingle: wmMaybeSingle }) });
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null });

    const from = vi.fn((table: string) => {
      if (table === 'agent_automations') {
        automationSelectCall += 1;
        return {
          select: () => makeSelectChain(automationSelectCall === 1 ? scheduleIs : triggerIs),
          update: () => ({
            eq: vi.fn().mockReturnValue(
              Object.assign(Promise.resolve({ error: null }), {
                or: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: 'claimed' }], error: null }) }),
              }),
            ),
          }),
        };
      }
      if (table === 'agent_dispatch_watermarks') return { select: wmSelect, upsert: upsertMock };
      throw new Error(`service_role must never .from() business data; got: ${table}`);
    });
    const svcClient = { from, rpc };

    const minted = makeMintedClient();
    const mintDeps = makeMintDeps(() => minted.client);

    const handler = vi.fn(async function* (): AsyncGenerator<{ runId: string; type: string; payload?: unknown }> {
      if (true as boolean) throw new Error('automation blew up mid-fire');
      yield { runId: 'run-1', type: 'status', payload: { status: 'completed' } };
    });

    await runDispatchTick({
      serviceClient: svcClient as never,
      authAdmin: mintDeps.authAdmin as never,
      buildClient: mintDeps.buildClient,
      handler: handler as never,
      modelClient: { create: vi.fn() } as never,
      model: 'm',
      conditionModel: { create: vi.fn() } as never,
      conditionModelId: 'cheap',
      now: () => new Date('2026-07-06T08:00:00Z'),
      newRunId: () => 'run-1',
      newMintedAt: () => '2026-07-06T08:00:00.000Z',
    });

    // Attempted (thrown mid-fire) ⇒ the watermark still advances over evt-1 — a re-throwing
    // automation must not rewind/block the watermark for events it was already attempted against
    // (otherwise the same event re-matches and double-fires next tick).
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'procurement_status_events', last_seen_id: 'evt-1' }),
    );
  });
});

describe('runDispatchTick — item 3: timeout_s wired to an AbortController signal', () => {
  it('passes an AbortSignal derived from the automation timeout_s into fireAutomation/handler', async () => {
    const automation = makeScheduleAutomation({ timeout_s: 42 });
    const svc = makeServiceClient([automation]);
    const minted = makeMintedClient();
    const mintDeps = makeMintDeps(() => minted.client);

    let seenSignal: AbortSignal | undefined;
    const handler = vi.fn(async function* (_req: unknown, deps: { signal?: AbortSignal }) {
      seenSignal = deps.signal;
      yield { runId: 'run-1', type: 'status', payload: { status: 'completed' } };
    });

    await runDispatchTick({
      serviceClient: svc.client as never,
      authAdmin: mintDeps.authAdmin as never,
      buildClient: mintDeps.buildClient,
      handler: handler as never,
      modelClient: { create: vi.fn() } as never,
      model: 'm',
      conditionModel: { create: vi.fn() } as never,
      conditionModelId: 'cheap',
      now: () => new Date('2026-07-06T08:00:00Z'),
      newRunId: () => 'run-1',
      newMintedAt: () => '2026-07-06T08:00:00.000Z',
    });

    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal?.aborted).toBe(false);
  });

  it('each automation gets its OWN AbortController (a second automation firing does not abort the first)', async () => {
    const a1 = makeScheduleAutomation({ id: 'auto-1', owner_id: 'user-1', timeout_s: 10 });
    const a2 = makeScheduleAutomation({ id: 'auto-2', owner_id: 'user-2', timeout_s: 20 });
    const svc = makeServiceClient([a1, a2]);
    const minted1 = makeMintedClient();
    const minted2 = makeMintedClient();
    const clientsByCallOrder = [minted1.client, minted2.client];
    let mintCall = 0;
    const mintDeps = makeMintDeps(() => clientsByCallOrder[mintCall++]);

    const signals: AbortSignal[] = [];
    const handler = vi.fn(async function* (_req: unknown, deps: { signal?: AbortSignal }) {
      if (deps.signal) signals.push(deps.signal);
      yield { runId: 'r', type: 'status', payload: { status: 'completed' } };
    });

    await runDispatchTick({
      serviceClient: svc.client as never,
      authAdmin: mintDeps.authAdmin as never,
      buildClient: mintDeps.buildClient,
      handler: handler as never,
      modelClient: { create: vi.fn() } as never,
      model: 'm',
      conditionModel: { create: vi.fn() } as never,
      conditionModelId: 'cheap',
      now: () => new Date('2026-07-06T08:00:00Z'),
      newRunId: () => 'run-x',
      newMintedAt: () => '2026-07-06T08:00:00.000Z',
    });

    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });
});

describe('selectTriggerMatches — item 4: compound (created_at, id) watermark cursor', () => {
  it('forwards the compound (created_at, id) cursor to select_trigger_events, and matches its result (no missed event)', async () => {
    // SEC-HIGH-2: the compound-cursor filtering itself now lives in the RPC (pgTAP 0104 AC-STE-003).
    // This test owns the JS contract: the dispatcher reads the watermark and forwards it as the
    // (p_last_seen_at, p_last_seen_id) cursor, then matches whatever the RPC returns. The scenario:
    // watermark advanced past eventA (same created_at as eventB, lower id) — the RPC returns only the
    // not-yet-seen eventB (as the real SQL cursor does), which must still be matched (no missed event).
    const automation: AutomationRow = {
      id: 'trig-1',
      kind: 'trigger',
      owner_id: 'u1',
      org_id: 'org-A',
      prompt: 'notify me when ordered',
      trigger_on: { source: 'procurement_status_events', event: 'Ordered' },
      enabled: true,
      archived_at: null,
    };
    const sameTs = '2026-07-06T08:00:00Z';
    const eventA = { id: 'aaaa0000-0000-0000-0000-000000000001', created_at: sameTs, to_status: 'Ordered', org_id: 'org-A' };
    const eventB = { id: 'bbbb0000-0000-0000-0000-000000000002', created_at: sameTs, to_status: 'Ordered', org_id: 'org-A' };

    // Watermark already advanced past eventA (by id), same created_at as eventB.
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { source: 'procurement_status_events', last_seen_id: eventA.id, last_seen_at: sameTs },
      error: null,
    });
    const wmEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const wmSelectMock = vi.fn().mockReturnValue({ eq: wmEqMock });

    // The RPC applies the compound cursor in SQL and returns only the not-yet-seen eventB.
    const rpc = vi.fn().mockResolvedValue({ data: [eventB], error: null });

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock };
      throw new Error(`service_role must never .from() business data; got: ${table}`);
    });
    const sb = { from: fromMock, rpc };

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:00:05Z'), [automation]);

    // The compound (created_at, id) cursor was forwarded to the RPC (the SQL side excludes eventA).
    expect(rpc).toHaveBeenCalledWith(
      'select_trigger_events',
      expect.objectContaining({ p_last_seen_at: sameTs, p_last_seen_id: eventA.id }),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].event.id).toBe(eventB.id);
  });
});
