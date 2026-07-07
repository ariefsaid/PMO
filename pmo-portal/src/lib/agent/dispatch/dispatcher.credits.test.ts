/**
 * dispatcher.credits.test.ts — the credits preflight (ADR-0044 §6, REC-4, FR-AAN-032/033).
 *
 * Automation runs meter against the automation's ORG credit pool (AMENDED by ADR-0049 /
 * ops-admin-surface FR-CRE-002/004 — was the owner's per-owner balance). The preflight runs
 * BEFORE any fire — over-budget means no `agent_runs` row reaches `running` (no fire) and a
 * `severity='warning'` notification is created for the owner ("automation X skipped — out of
 * credits"), via the MINTED owner client (RLS pins owner_id/org_id, NFR-AAN-SEC-006). [REC-1]:
 * logic lives in supabase/functions/agent-dispatch/*, tests here.
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

  return { client: { from }, tablesTouched, updateMock };
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
  return { client: { from, __identity: 'minted-A' }, tablesTouched, notifInsert, auditInsert };
}

function makeMintDeps(mintedClient: unknown) {
  const generateLink = vi
    .fn()
    .mockResolvedValue({ data: { properties: { access_token: 'MINTED.A' } }, error: null });
  const getUserById = vi.fn(async (id: string) => ({ data: { user: { email: id } }, error: null }));
  const authAdmin = { admin: { generateLink, getUserById } };
  const buildClient = vi.fn().mockReturnValue(mintedClient);
  return { authAdmin, buildClient, generateLink };
}

describe('runDispatchTick — AC-AAN-027 over-credit no-start plus warning notification', () => {
  it('does not fire and creates a warning notification when the owner balance would be exceeded', async () => {
    const automation = makeScheduleAutomation();
    const svc = makeServiceClient([automation]);
    const minted = makeMintedClient();
    const mintDeps = makeMintDeps(minted.client);

    const handler = vi.fn(async function* () {
      yield { runId: 'run-1', type: 'status', payload: { status: 'completed' } };
    });

    const rateGuard = { check: vi.fn().mockResolvedValue({ exceeded: true, retryAfterSeconds: 0 }) };

    await runDispatchTick({
      serviceClient: svc.client as never,
      authAdmin: mintDeps.authAdmin as never,
      buildClient: mintDeps.buildClient,
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

    // No fire: the handler (and therefore no agent_runs row reaching 'running') is never invoked.
    expect(handler).not.toHaveBeenCalled();

    // The preflight was checked for the automation's ORG pool (AMENDED by ADR-0049 —
    // FR-CRE-004: any member's turn reads the same org pool), before any fire — and receives
    // the MINTED OWNER CLIENT (never service_role) so the real createCreditRateGuard can
    // compute the balance under owner RLS (ADR-0044 §6, NFR-AAN-SEC-002/SEC-006).
    expect(rateGuard.check).toHaveBeenCalledWith('org-A', minted.client);

    // A severity='warning' notification was created for the owner via the MINTED owner client.
    expect(minted.notifInsert).toHaveBeenCalledTimes(1);
    const payload = minted.notifInsert.mock.calls[0][0] as {
      severity: string;
      title: string;
      metadata: Record<string, unknown> | null;
    };
    expect(payload.severity).toBe('warning');
    expect(payload.title).toMatch(/out of credits/i);
    expect(payload.metadata).toMatchObject({ automation_id: 'auto-A' });

    // AUDIT-M2: the schedule's minute-claim DOES stamp last_fired_at (claim-then-fire, exactly
    // once, BEFORE the credit preflight) — but no post-fire stamp follows the credit skip. The
    // fire itself never happened (handler assertion above); FR-AAN-033's "no fire" is unchanged,
    // the stamp just moved to the claim.
    expect(svc.updateMock).toHaveBeenCalledTimes(1);
    expect(svc.updateMock).toHaveBeenCalledWith({ last_fired_at: '2026-07-06T08:00:00.000Z' });
  });

  it('gpt-5.5 #3: a mint that then writes a warning notification is AUDITED first (audit before any minted-client write)', async () => {
    // The over-credit skip path mints, then notifies via the minted client without firing. Every
    // mint must leave an audit trail BEFORE any other minted-client DB use — otherwise a skipped-but-
    // minted candidate produces a minted-client write (the notification) with no audit event. This
    // asserts the ORDER on the minted client: an agent_events (audit) write precedes the
    // notifications write.
    const automation = makeScheduleAutomation();
    const svc = makeServiceClient([automation]);
    const minted = makeMintedClient();
    const mintDeps = makeMintDeps(minted.client);

    const handler = vi.fn(async function* () {
      yield { runId: 'run-1', type: 'status', payload: { status: 'completed' } };
    });
    const rateGuard = { check: vi.fn().mockResolvedValue({ exceeded: true, retryAfterSeconds: 0 }) };

    await runDispatchTick({
      serviceClient: svc.client as never,
      authAdmin: mintDeps.authAdmin as never,
      buildClient: mintDeps.buildClient,
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

    // No fire.
    expect(handler).not.toHaveBeenCalled();
    // The mint was audited: the minted client wrote agent_threads/agent_runs/agent_events even on
    // the skip path (a minted-but-skipped candidate still leaves an audit trail, gpt-5.5 #3).
    expect(minted.tablesTouched).toContain('agent_events');
    // And the audit write happened BEFORE the notification write (order on the minted client).
    const firstAuditIdx = minted.tablesTouched.indexOf('agent_events');
    const firstNotifIdx = minted.tablesTouched.indexOf('notifications');
    expect(firstAuditIdx).toBeGreaterThanOrEqual(0);
    expect(firstNotifIdx).toBeGreaterThan(firstAuditIdx);
  });

  it('fires normally when the owner balance is not exceeded', async () => {
    const automation = makeScheduleAutomation();
    const svc = makeServiceClient([automation]);
    const minted = makeMintedClient();
    const mintDeps = makeMintDeps(minted.client);

    const handler = vi.fn(async function* (
      _req: unknown,
      _deps: { usage?: { supabase: unknown } },
    ) {
      yield { runId: 'run-1', type: 'status', payload: { status: 'completed' } };
    });

    const rateGuard = { check: vi.fn().mockResolvedValue({ exceeded: false, retryAfterSeconds: 0 }) };

    await runDispatchTick({
      serviceClient: svc.client as never,
      authAdmin: mintDeps.authAdmin as never,
      buildClient: mintDeps.buildClient,
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

    // The fire happened — the preflight allowed it.
    expect(handler).toHaveBeenCalledTimes(1);
    // No warning notification was written.
    expect(minted.notifInsert).not.toHaveBeenCalled();
    // last_fired_at WAS stamped (an actual fire occurred).
    expect(svc.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ last_fired_at: expect.any(String) }),
    );

    // Usage recording is threaded to the fired run under the SAME minted owner client (the
    // _shared/usage.ts seam consumed via HandlerDeps.usage — never service_role).
    const [, handlerDeps] = handler.mock.calls[0];
    expect(handlerDeps.usage).toMatchObject({ supabase: minted.client });
  });

  it("AC-USE-002 (ops-admin-surface S5): the fired run is threaded usageAction='automation'", async () => {
    const automation = makeScheduleAutomation();
    const svc = makeServiceClient([automation]);
    const minted = makeMintedClient();
    const mintDeps = makeMintDeps(minted.client);

    const handler = vi.fn(async function* (
      _req: unknown,
      _deps: { usageAction?: string },
    ) {
      yield { runId: 'run-1', type: 'status', payload: { status: 'completed' } };
    });

    const rateGuard = { check: vi.fn().mockResolvedValue({ exceeded: false, retryAfterSeconds: 0 }) };

    await runDispatchTick({
      serviceClient: svc.client as never,
      authAdmin: mintDeps.authAdmin as never,
      buildClient: mintDeps.buildClient,
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

    const [, handlerDeps] = handler.mock.calls[0];
    expect(handlerDeps.usageAction).toBe('automation');
  });
});
