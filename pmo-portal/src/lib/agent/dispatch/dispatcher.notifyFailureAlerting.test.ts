/**
 * I5 (2026-07-28 review) — a `notifyOwner` failure was previously visible ONLY in the edge-function
 * console log (`logStructuredError`, which never reaches the owner). Both fail-quiet-but-visible
 * warning paths (condition-unevaluable, over-credit) now feed a `notifyOwner` failure into
 * `recordErrorEvent`, which lands in `error_events` — the SAME table `telegram-notify` drains, so a
 * failed owner notification now actually reaches the owner via the alert path it was always
 * supposed to.
 */
import { describe, it, expect, vi } from 'vitest';
import { runDispatchTick } from '../../../../../supabase/functions/agent-dispatch/dispatcher';
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

/** A serviceClient mock that ALSO records error_events inserts (recordErrorEvent's write target). */
function makeServiceClient(automations: AutomationRow[]) {
  const errorEventsInsert = vi.fn().mockResolvedValue({ error: null });
  const isMock = vi.fn().mockResolvedValue({ data: automations, error: null });
  const eq2Mock = vi.fn().mockReturnValue({ is: isMock });
  const eq1Mock = vi.fn().mockReturnValue({ eq: eq2Mock });
  const selectMock = vi.fn().mockReturnValue({ eq: eq1Mock });
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
    if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock, upsert: upsertMock };
    if (table === 'error_events') return { insert: errorEventsInsert };
    return { select: selectMock, update: updateMock };
  });

  return { client: { from }, errorEventsInsert };
}

/** A minted-client mock whose notifications insert FAILS (a resolved Postgres error). */
function makeMintedClientWithFailingNotify() {
  const tablesTouched: string[] = [];
  const notifInsert = vi.fn().mockResolvedValue({ error: { code: '42501' } });
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
  return { client: { from }, notifInsert };
}

function makeMintDeps(mintedClient: unknown) {
  const generateLink = vi
    .fn()
    .mockResolvedValue({ data: { properties: { hashed_token: 'HASH.A' } }, error: null });
  const verifyOtp = vi
    .fn()
    .mockResolvedValue({ data: { session: { access_token: 'MINTED.A' } }, error: null });
  const getUserById = vi.fn(async (id: string) => ({ data: { user: { email: id } }, error: null }));
  const authAdmin = { admin: { generateLink, getUserById } };
  const buildClient = vi.fn().mockReturnValue(mintedClient);
  return { authAdmin, buildClient, generateLink, verifyOtp };
}

describe('I5 — a failed owner notification is recorded to error_events (reaches the alert path)', () => {
  it('over-credit skip: a failing notifyOwner insert is recorded via recordErrorEvent with the automation as contextId', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const automation = makeScheduleAutomation();
    const svc = makeServiceClient([automation]);
    const minted = makeMintedClientWithFailingNotify();
    const mintDeps = makeMintDeps(minted.client);

    const handler = vi.fn(async function* () {
      yield { runId: 'run-1', type: 'status', payload: { status: 'completed' } };
    });
    const rateGuard = { check: vi.fn().mockResolvedValue({ exceeded: true, retryAfterSeconds: 0 }) };

    await runDispatchTick({
      serviceClient: svc.client as never,
      authAdmin: mintDeps.authAdmin as never,
      buildClient: mintDeps.buildClient,
      verifyOtp: mintDeps.verifyOtp,
      handler: handler as never,
      modelClient: { create: vi.fn() } as never,
      model: 'anthropic/claude',
      conditionModel: { create: vi.fn() } as never,
      conditionModelId: 'cheap',
      rateGuard,
      now: () => new Date('2026-07-06T08:00:00Z'),
      newRunId: () => 'run-1',
      newMintedAt: () => '2026-07-06T08:00:00.000Z',
    });

    // The notify insert DID fail (the mock guarantees it) — that failure must now reach error_events.
    expect(minted.notifInsert).toHaveBeenCalledTimes(1);
    expect(svc.errorEventsInsert).toHaveBeenCalledTimes(1);
    expect(svc.errorEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        fn: 'agent-dispatch',
        error_code: 'NOTIFY_INSERT_FAILED',
        context_id: 'auto-A',
        org_id: 'org-A',
      }),
    );
  });

  it('condition-unevaluable skip: a failing notifyOwner insert is ALSO recorded via recordErrorEvent (the other call site)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const trigger = makeScheduleAutomation({
      id: 'trig-1',
      kind: 'trigger',
      schedule: null,
      trigger_on: { source: 'procurement_status_events', event: 'Ordered' },
      condition: 'the case has sat in Ordered for more than 30 days',
    });

    const errorEventsInsert = vi.fn().mockResolvedValue({ error: null });
    const scheduleIs = vi.fn().mockResolvedValue({ data: [], error: null });
    const triggerIs = vi.fn().mockResolvedValue({ data: [trigger], error: null });
    let automationSelectCall = 0;
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'evt-1', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-A' }],
      error: null,
    });
    const wmMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const wmSelect = vi.fn().mockReturnValue({ eq: () => ({ maybeSingle: wmMaybeSingle }) });
    const wmUpsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const firesInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [{ automation_id: 'trig-1' }], error: null }),
    });

    const svcFrom = vi.fn((table: string) => {
      if (table === 'agent_automations') {
        automationSelectCall += 1;
        const isMock = automationSelectCall === 1 ? scheduleIs : triggerIs;
        return { select: () => ({ eq: () => ({ eq: () => ({ is: isMock }) }) }) };
      }
      if (table === 'agent_dispatch_watermarks') return { select: wmSelect, upsert: wmUpsert };
      if (table === 'agent_automation_fires') return { insert: firesInsert };
      if (table === 'error_events') return { insert: errorEventsInsert };
      throw new Error(`service_role must never .from() business data; got: ${table}`);
    });
    const svcClient = { from: svcFrom, rpc };

    const minted = makeMintedClientWithFailingNotify();
    const mintDeps = makeMintDeps(minted.client);
    // The condition model THROWS -> evaluateCondition returns {fire:false, warning:...} -> the
    // "condition could not be evaluated" notifyOwner call site (:457-ish) is the one under test.
    const conditionModel = { create: vi.fn().mockRejectedValue(new Error('model unavailable')) };

    const handler = vi.fn(async function* () {
      yield { runId: 'run-1', type: 'status', payload: { status: 'completed' } };
    });

    await runDispatchTick({
      serviceClient: svcClient as never,
      authAdmin: mintDeps.authAdmin as never,
      buildClient: mintDeps.buildClient,
      verifyOtp: mintDeps.verifyOtp,
      handler: handler as never,
      modelClient: { create: vi.fn() } as never,
      model: 'anthropic/claude',
      conditionModel: conditionModel as never,
      conditionModelId: 'cheap',
      now: () => new Date('2026-07-06T08:00:00Z'),
      newRunId: () => 'run-1',
      newMintedAt: () => '2026-07-06T08:00:00.000Z',
    });

    expect(minted.notifInsert).toHaveBeenCalledTimes(1);
    expect(errorEventsInsert).toHaveBeenCalledTimes(1);
    expect(errorEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        fn: 'agent-dispatch',
        error_code: 'NOTIFY_INSERT_FAILED',
        context_id: 'trig-1',
        org_id: 'org-A',
      }),
    );
  });
});
