/**
 * dispatcher.deputy-invariant.test.ts — THE deputy-invariant gate for background runs [OPUS-IMPL].
 *
 * Ports the retired agent-native branch's deputy-invariant.gate shape into the automations
 * dispatcher (ADR-0044 Verification). The whole safety argument (NFR-AAN-SEC-001) is:
 *
 *   (a) service_role is used at EXACTLY two call sites — mint (the Auth admin API) and the
 *       quarantined table set {agent_automations, agent_dispatch_watermarks, <status-event sources>}
 *       for selection/watermark/last_fired_at. NEVER for business data.
 *   (b) The FIRED run uses the MINTED owner client — never service_role — so agentChatHandler runs
 *       the SAME RLS-ceilinged loop as an interactive run. A minted A-JWT is denied user-B data
 *       byte-for-byte identically to the interactive path (the pgTAP half is 0100; this is the unit
 *       half, proving the FIRED run never touches service_role and carries A's identity, never B's).
 *
 * [REC-1]: logic in supabase/functions/agent-dispatch/*, tests here.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runDispatchTick } from '../../../../../supabase/functions/agent-dispatch/dispatcher';
import type { AutomationRow } from '../../../../../supabase/functions/agent-dispatch/dispatcher';

const HERE = dirname(fileURLToPath(import.meta.url));
const DISPATCH_DIR = resolve(HERE, '../../../../../supabase/functions/agent-dispatch');

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

/**
 * A serviceClient mock that records EVERY .from(table) call. The schedule-selection chain
 * (.select().eq().eq().is()) resolves the given automations; agent_automations.update (last_fired_at)
 * and agent_dispatch_watermarks.upsert are recorded no-ops.
 */
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
    // agent_automations: select (selection) + update (last_fired_at)
    return { select: selectMock, update: updateMock };
  });

  return { client: { from }, tablesTouched, updateMock, updateEqMock };
}

/** A minted-client mock recording its own .from() calls (the fired run's business surface). */
function makeMintedClient() {
  const tablesTouched: string[] = [];
  const singleThread = () => Promise.resolve({ data: { id: 'thread-1' }, error: null });
  const singleRun = () => Promise.resolve({ data: { id: 'run-1' }, error: null });
  const singleEvent = () => Promise.resolve({ data: { id: 'evt-1' }, error: null });
  const insert = vi.fn((_row: unknown) => ({
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
    return { insert };
  });
  return { client: { from, __identity: 'minted-A' }, tablesTouched, insert };
}

function makeMintDeps(mintedClient: unknown) {
  const generateLink = vi
    .fn()
    .mockResolvedValue({ data: { properties: { access_token: 'MINTED.A' } }, error: null });
  const authAdmin = { admin: { generateLink } };
  const buildClient = vi.fn().mockReturnValue(mintedClient);
  return { authAdmin, buildClient, generateLink };
}

describe('runDispatchTick — AC-AAN-018 service_role never queries business data', () => {
  it('touches exactly {agent_automations, agent_dispatch_watermarks} under service_role; the fired run uses the minted client', async () => {
    const automation = makeScheduleAutomation();
    const svc = makeServiceClient([automation]);
    const minted = makeMintedClient();
    const mintDeps = makeMintDeps(minted.client);

    // The fired run's handler — asserts identity + records it never sees serviceClient.
    let firedSupabase: unknown = null;
    let firedUserId: string | null = null;
    const handler = vi.fn(async function* (
      _req: unknown,
      deps: { supabase: unknown; userId: string },
    ) {
      firedSupabase = deps.supabase;
      firedUserId = deps.userId;
      yield { runId: 'run-1', type: 'status', payload: { status: 'completed' } };
    });

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
      newRunId: () => 'run-1',
      newMintedAt: () => '2026-07-06T08:00:00.000Z',
    });

    // (a) service_role is quarantined: only automations metadata + watermark infra — no business data.
    const uniqueServiceTables = new Set(svc.tablesTouched);
    for (const t of uniqueServiceTables) {
      expect(['agent_automations', 'agent_dispatch_watermarks']).toContain(t);
    }
    // agent_automations was read for selection (the metadata enumeration).
    expect(uniqueServiceTables.has('agent_automations')).toBe(true);

    // (b) the FIRED run received the MINTED client, never serviceClient (identity check).
    expect(firedSupabase).toBe(minted.client);
    expect(firedSupabase).not.toBe(svc.client);
    // and carries A's identity (owner_id), never any other user's.
    expect(firedUserId).toBe('user-A');
  });
});

describe('runDispatchTick — AC-AAN-019 minted-JWT cross-tenant denial identical to interactive (unit half)', () => {
  it('the fired run is handed a client marked with A identity, never B; fire.ts/mint.ts never build a service_role client for the fired run', async () => {
    const automation = makeScheduleAutomation({ owner_id: 'user-A' });
    const svc = makeServiceClient([automation]);
    const minted = makeMintedClient();
    const mintDeps = makeMintDeps(minted.client);

    let firedSupabase: unknown = null;
    const handler = vi.fn(async function* (_req: unknown, deps: { supabase: unknown }) {
      firedSupabase = deps.supabase;
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

    // Dynamic: the fired run is handed A's minted client (RLS ceiling = A) — never B, never service.
    expect(firedSupabase).toBe(minted.client);

    // Static twin: neither fire.ts nor mint.ts constructs a service_role/SERVICE_ROLE client for
    // the fired run — the fired run ONLY ever receives the injected minted client.
    const fireSrc = readFileSync(resolve(DISPATCH_DIR, 'fire.ts'), 'utf8');
    const mintSrc = readFileSync(resolve(DISPATCH_DIR, 'mint.ts'), 'utf8');
    expect(fireSrc).not.toMatch(/service_role|SERVICE_ROLE/i);
    expect(mintSrc).not.toMatch(/\.from\(['"`](companies|projects|contracts|procurement_cases)/);
    // The mint audit writes only to agent_threads/agent_runs/agent_events (the owner's own transcript).
    expect(mintSrc).toMatch(/agent_events/);
  });

  it('AC-AAN-024 (tick layer): an unevaluable trigger condition mints + warns + does NOT fire', async () => {
    const trigger = makeScheduleAutomation({
      id: 'trig-1',
      kind: 'trigger',
      schedule: null,
      trigger_on: { source: 'procurement_status_events', event: 'Ordered' },
      condition: 'sits >30 days in Ordered',
    });

    // serviceClient: schedule-select returns none; trigger-select returns the trigger; the source
    // table yields one matching Ordered event; watermark null.
    const tablesTouched: string[] = [];
    const scheduleIs = vi.fn().mockResolvedValue({ data: [], error: null });
    const triggerIs = vi.fn().mockResolvedValue({ data: [trigger], error: null });
    let automationSelectCall = 0;
    const makeSelectChain = (isMock: ReturnType<typeof vi.fn>) => ({
      eq: () => ({ eq: () => ({ is: isMock }) }),
    });
    const orderMock = vi.fn().mockResolvedValue({
      data: [{ id: 'evt-1', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-A' }],
      error: null,
    });
    const evtSelect = vi.fn().mockReturnValue({ gte: () => ({ order: orderMock }) });
    const wmMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const wmSelect = vi.fn().mockReturnValue({ eq: () => ({ maybeSingle: wmMaybeSingle }) });
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null });

    const from = vi.fn((table: string) => {
      tablesTouched.push(table);
      if (table === 'agent_automations') {
        automationSelectCall += 1;
        // 1st select = schedules, 2nd = triggers.
        return { select: () => makeSelectChain(automationSelectCall === 1 ? scheduleIs : triggerIs), update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
      }
      if (table === 'agent_dispatch_watermarks') return { select: wmSelect, upsert: upsertMock };
      return { select: evtSelect };
    });
    const svcClient = { from };

    const minted = makeMintedClient();
    // Add a notifications insert path to the minted client.
    const notifInsert = vi.fn().mockResolvedValue({ error: null });
    const origFrom = minted.client.from;
    (minted.client as { from: (t: string) => unknown }).from = vi.fn((table: string) => {
      if (table === 'notifications') {
        minted.tablesTouched.push(table); // record order alongside the audit writes
        return { insert: notifInsert };
      }
      return origFrom(table);
    });
    const mintDeps = makeMintDeps(minted.client);

    const handler = vi.fn(async function* () {
      yield { runId: 'run-1', type: 'status', payload: { status: 'completed' } };
    });
    // The cheap condition model returns an unparseable verdict → warning path.
    const conditionModel = { create: vi.fn().mockResolvedValue({ message: { role: 'assistant', content: 'maybe?' } }) };

    await runDispatchTick({
      serviceClient: svcClient as never,
      authAdmin: mintDeps.authAdmin as never,
      buildClient: mintDeps.buildClient,
      handler: handler as never,
      modelClient: { create: vi.fn() } as never,
      model: 'm',
      conditionModel: conditionModel as never,
      conditionModelId: 'cheap',
      now: () => new Date('2026-07-06T08:00:00Z'),
      newRunId: () => 'run-1',
      newMintedAt: () => '2026-07-06T08:00:00.000Z',
    });

    // No fire (the handler was never invoked).
    expect(handler).not.toHaveBeenCalled();
    // A severity='warning' notification was written via the MINTED owner client.
    expect(notifInsert).toHaveBeenCalledTimes(1);
    expect(notifInsert.mock.calls[0][0]).toMatchObject({ severity: 'warning' });
    // gpt-5.5 #3: the mint was AUDITED (agent_events written) BEFORE the warning notification —
    // an unevaluable-condition skip that mints still leaves an audit trail first.
    const auditIdx = minted.tablesTouched.indexOf('agent_events');
    const notifIdx = minted.tablesTouched.indexOf('notifications');
    expect(auditIdx).toBeGreaterThanOrEqual(0);
    expect(notifIdx).toBeGreaterThan(auditIdx);
  });

  it('FR-AAN-020: the fired run persists as an ordinary run under the MINTED owner client (startSeq=1)', async () => {
    const automation = makeScheduleAutomation();
    const svc = makeServiceClient([automation]);
    const minted = makeMintedClient();
    const mintDeps = makeMintDeps(minted.client);
    const buildPersistence = vi.fn().mockReturnValue({ supabase: minted.client, ownerId: 'user-A', orgId: '', startSeq: 1 });
    let firedPersistence: unknown = null;
    const handler = vi.fn(async function* (_req: unknown, deps: { persistence?: unknown }) {
      firedPersistence = deps.persistence;
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
      buildPersistence,
    });

    // Persistence deps built per-fire with the MINTED client + owner + runId (never service_role).
    expect(buildPersistence).toHaveBeenCalledWith(minted.client, 'user-A', 'run-1');
    // The fired run received the persistence deps (resumes the audit-created run at seq 1).
    expect(firedPersistence).toMatchObject({ supabase: minted.client, startSeq: 1 });
  });

  it('last_fired_at is stamped on an actual fire, via the quarantined agent_automations table', async () => {
    const automation = makeScheduleAutomation();
    const svc = makeServiceClient([automation]);
    const minted = makeMintedClient();
    const mintDeps = makeMintDeps(minted.client);
    const handler = vi.fn(async function* () {
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

    // last_fired_at stamped under service_role on agent_automations (FR-AAN-015, within quarantine).
    expect(svc.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ last_fired_at: expect.any(String) }),
    );
    expect(svc.updateEqMock).toHaveBeenCalledWith('id', 'auto-A');
  });
});
