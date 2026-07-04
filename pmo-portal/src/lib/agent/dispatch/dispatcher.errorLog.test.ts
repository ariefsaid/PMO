/**
 * Observability hardening (spike 2026-07-04, harden #1): runDispatchTick's per-unit catch
 * must log a DISTINCT, greppable errorCode per failure phase (mint / audit / fire) instead
 * of one generic "automation failed" message — so a stuck automation is diagnosable from
 * logs alone without a debugger session. [REC-1]: logic lives in
 * supabase/functions/agent-dispatch/dispatcher.ts, tests live here.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runDispatchTick } from '../../../../../supabase/functions/agent-dispatch/dispatcher';
import type { AutomationRow } from '../../../../../supabase/functions/agent-dispatch/dispatcher';

function makeScheduleAutomation(overrides: Partial<AutomationRow> = {}): AutomationRow {
  return {
    id: 'auto-A',
    kind: 'schedule',
    owner_id: 'user-A',
    org_id: 'org-A',
    prompt: 'summarize my overdue tasks',
    schedule: '* * * * *',
    enabled: true,
    archived_at: null,
    timeout_s: 90,
    ...overrides,
  };
}

function makeServiceClient(automations: AutomationRow[]) {
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
    if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock, upsert: upsertMock };
    return { select: selectMock, update: updateMock };
  });

  return { client: { from } };
}

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
  return { client: { from } };
}

/** A minted client whose audit-event insert (the 3rd .from() call) fails. */
function makeMintedClientAuditFails() {
  const tablesTouched: string[] = [];
  const singleThread = () => Promise.resolve({ data: { id: 'thread-1' }, error: null });
  const singleRun = () => Promise.resolve({ data: { id: 'run-1' }, error: null });
  const failedEvent = () => Promise.resolve({ data: null, error: { code: '23503' } });
  const auditInsert = vi.fn((_row: unknown) => ({
    select: () => ({
      single: () => {
        const last = tablesTouched[tablesTouched.length - 1];
        if (last === 'agent_threads') return singleThread();
        if (last === 'agent_runs') return singleRun();
        return failedEvent();
      },
    }),
  }));
  const from = vi.fn((table: string) => {
    tablesTouched.push(table);
    return { insert: auditInsert };
  });
  return { client: { from } };
}

function makeMintDeps(mintedClient: unknown, generateLinkImpl?: () => Promise<unknown>) {
  const generateLink =
    generateLinkImpl ??
    vi.fn().mockImplementation(() => Promise.resolve({ data: { properties: { access_token: 'MINTED' } }, error: null }));
  const authAdmin = { admin: { generateLink } };
  const buildClient = vi.fn().mockImplementation(() => mintedClient);
  return { authAdmin, buildClient };
}

describe('runDispatchTick — structured errorCode per failure phase (harden #1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs errorCode AUTOMATION_MINT_FAILED when mintOwnerJwt fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const automation = makeScheduleAutomation({ id: 'auto-mint-fail' });
    const svc = makeServiceClient([automation]);
    const failingGenerateLink = vi.fn().mockResolvedValue({ data: null, error: { message: 'mint boom' } });
    const mintDeps = makeMintDeps(makeMintedClient().client, failingGenerateLink);

    await runDispatchTick({
      serviceClient: svc.client as never,
      authAdmin: mintDeps.authAdmin as never,
      buildClient: mintDeps.buildClient,
      handler: (async function* () {}) as never,
      modelClient: { create: vi.fn() } as never,
      model: 'm',
      conditionModel: { create: vi.fn() } as never,
      conditionModelId: 'cheap',
      now: () => new Date('2026-07-06T08:00:00Z'),
      newRunId: () => 'run-1',
      newMintedAt: () => '2026-07-06T08:00:00.000Z',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [, context] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect(context).toMatchObject({ errorCode: 'AUTOMATION_MINT_FAILED', contextId: 'auto-mint-fail' });
  });

  it('logs a DIFFERENT errorCode AUTOMATION_AUDIT_FAILED when auditMint fails (mint succeeded)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const automation = makeScheduleAutomation({ id: 'auto-audit-fail' });
    const svc = makeServiceClient([automation]);
    const mintDeps = makeMintDeps(makeMintedClientAuditFails().client);

    await runDispatchTick({
      serviceClient: svc.client as never,
      authAdmin: mintDeps.authAdmin as never,
      buildClient: mintDeps.buildClient,
      handler: (async function* () {}) as never,
      modelClient: { create: vi.fn() } as never,
      model: 'm',
      conditionModel: { create: vi.fn() } as never,
      conditionModelId: 'cheap',
      now: () => new Date('2026-07-06T08:00:00Z'),
      newRunId: () => 'run-1',
      newMintedAt: () => '2026-07-06T08:00:00.000Z',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [, context] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect(context).toMatchObject({ errorCode: 'AUTOMATION_AUDIT_FAILED', contextId: 'auto-audit-fail' });
  });

  it('logs a DIFFERENT errorCode AUTOMATION_FIRE_FAILED when the handler throws mid-fire (mint+audit succeeded)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const automation = makeScheduleAutomation({ id: 'auto-fire-fail' });
    const svc = makeServiceClient([automation]);
    const mintDeps = makeMintDeps(makeMintedClient().client);

    const handler = vi.fn(async function* (): AsyncGenerator<{ runId: string; type: string; payload?: unknown }> {
      if (true as boolean) throw new Error('fire boom');
      yield { runId: 'unreachable', type: 'status', payload: { status: 'completed' } };
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

    expect(spy).toHaveBeenCalledTimes(1);
    const [, context] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect(context).toMatchObject({ errorCode: 'AUTOMATION_FIRE_FAILED', contextId: 'auto-fire-fail' });
    // Never the thrown error's message text (could carry prompt/internal detail).
    expect(JSON.stringify(context)).not.toContain('fire boom');
  });
});
