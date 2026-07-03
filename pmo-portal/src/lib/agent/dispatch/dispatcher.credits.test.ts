/**
 * dispatcher.credits.test.ts — the credits preflight (ADR-0044 §6, REC-4, FR-AAN-032/033).
 *
 * Automation runs meter against the OWNER's credit balance. The preflight runs BEFORE any fire —
 * over-budget means no `agent_runs` row reaches `running` (no fire) and a `severity='warning'`
 * notification is created for the owner ("automation X skipped — out of credits"), via the MINTED
 * owner client (RLS pins owner_id/org_id, NFR-AAN-SEC-006). [REC-1]: logic lives in
 * supabase/functions/agent-dispatch/*, tests here.
 */
import { describe, it, expect, vi } from 'vitest';
import { runDispatchTick } from '../../../../../supabase/functions/agent-dispatch/dispatcher';
import type { AutomationRow } from '../../../../../supabase/functions/agent-dispatch/dispatcher';

function makeScheduleAutomation(overrides: Partial<AutomationRow> = {}): AutomationRow {
  return {
    id: 'auto-A',
    kind: 'schedule',
    owner_id: 'user-A',
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
  const updateEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
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
  const authAdmin = { admin: { generateLink } };
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

    // The preflight was checked for the automation's OWNER, before any fire — and receives the
    // MINTED OWNER CLIENT (never service_role) so the real createCreditRateGuard can compute the
    // balance under owner RLS (ADR-0044 §6, NFR-AAN-SEC-002/SEC-006).
    expect(rateGuard.check).toHaveBeenCalledWith('user-A', minted.client);

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

    // last_fired_at was NOT stamped — no fire occurred (FR-AAN-033).
    expect(svc.updateMock).not.toHaveBeenCalled();
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
});
