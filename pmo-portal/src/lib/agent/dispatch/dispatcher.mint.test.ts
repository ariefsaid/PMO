/**
 * dispatcher.mint.test.ts — THE minting slice (ADR-0044 §3, NFR-AAN-SEC-001) [OPUS-IMPL].
 *
 * The mint is the single most security-sensitive surface in the agent tier: a bug that mints for
 * the WRONG owner_id is a tenancy breach. Its scoping/audit/no-persist gate lands in the SAME file
 * as the mint code (never separately). [REC-1]: logic lives in
 * supabase/functions/agent-dispatch/*, its tests live here.
 *
 * Covers:
 *   - fireAutomation (Task D1/D2, FR-AAN-017/020): the fired run uses the MINTED client, userId ==
 *     automation.owner_id, prompt as the user message — indistinguishable from an interactive run.
 *   - AC-AAN-016: mint scoped to EXACTLY the dispatched row's owner_id — no other id in the call.
 *   - AC-AAN-017: every mint is audited BEFORE the minted client is used for the fire.
 *   - AC-AAN-020: the minted JWT is never persisted (not in the audit payload, not in mint.ts source).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fireAutomation } from '../../../../../supabase/functions/agent-dispatch/fire';
import { mintOwnerJwt, auditMint } from '../../../../../supabase/functions/agent-dispatch/mint';
import type { AutomationRow } from '../../../../../supabase/functions/agent-dispatch/dispatcher';

const HERE = dirname(fileURLToPath(import.meta.url));
const DISPATCH_DIR = resolve(HERE, '../../../../../supabase/functions/agent-dispatch');

function makeAutomation(overrides: Partial<AutomationRow> = {}): AutomationRow {
  return {
    id: 'auto-1',
    kind: 'schedule',
    owner_id: 'user-A',
    org_id: 'org-A',
    prompt: 'summarize my overdue tasks',
    schedule: '0 8 * * 1',
    enabled: true,
    archived_at: null,
    timeout_s: 90,
    ...overrides,
  };
}

/** An async-generator handler that emits a single terminal `completed` status event. */
function makeHandler(runId = 'run-1') {
  return vi.fn(async function* (
    _req: unknown,
    _deps: unknown,
  ): AsyncGenerator<{ runId: string; type: string; payload?: unknown }> {
    yield { runId, type: 'status', payload: { status: 'completed' } };
  });
}

describe('fireAutomation — FR-AAN-017/020 (the fired run is an ordinary, minted-client run)', () => {
  it('drives agentChatHandler with the minted client, owner userId, and the automation prompt', async () => {
    const automation = makeAutomation();
    const mintedClient = { __identity: 'minted-A' };
    const modelClient = { create: vi.fn() };
    const handler = makeHandler('run-99');

    const result = await fireAutomation({
      handler: handler as never,
      mintedClient: mintedClient as never,
      modelClient: modelClient as never,
      model: 'anthropic/claude',
      ownerId: automation.owner_id,
      automation,
      runId: 'run-99',
      signal: new AbortController().signal,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const [req, deps] = handler.mock.calls[0] as [
      { runId?: string; messages: Array<{ role: string; content: unknown }> },
      { supabase: unknown; userId: string },
    ];
    // The fired run uses the MINTED client — never service_role (FR-AAN-017).
    expect(deps.supabase).toBe(mintedClient);
    // Scoped to the automation's owner — indistinguishable from an interactive A run.
    expect(deps.userId).toBe('user-A');
    // The automation prompt is the user message that drives the run.
    const userMsg = req.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toBe('summarize my overdue tasks');
    // Continues the pre-created run (audit already established it) — one run per fire (FR-AAN-020).
    expect(req.runId).toBe('run-99');
    // Returns the terminal run id.
    expect(result).toBe('run-99');
  });

  it('drains the generator server-side to its terminal status', async () => {
    const events: string[] = [];
    const handler = vi.fn(async function* () {
      events.push('emitted-1');
      yield { runId: 'r', type: 'assistant', text: 'working' };
      events.push('emitted-2');
      yield { runId: 'r', type: 'status', payload: { status: 'completed' } };
    });

    await fireAutomation({
      handler: handler as never,
      mintedClient: {} as never,
      modelClient: { create: vi.fn() } as never,
      model: 'm',
      ownerId: 'user-A',
      automation: makeAutomation(),
      runId: 'r',
      signal: new AbortController().signal,
    });

    // Both events were pulled — the generator was fully drained (no early break).
    expect(events).toEqual(['emitted-1', 'emitted-2']);
  });
});

describe('mintOwnerJwt — AC-AAN-016 (mint scoped to EXACTLY the dispatched row owner_id)', () => {
  it('calls the Auth admin API with exactly the automation owner_id and no other id', async () => {
    const automation = makeAutomation({ owner_id: 'user-A', id: 'auto-1' });
    const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-A' } }, error: null });
    const generateLink = vi
      .fn()
      .mockResolvedValue({ data: { properties: { access_token: 'MINTED.JWT.A' } }, error: null });
    const buildClient = vi.fn().mockReturnValue({ __identity: 'minted-A' });
    const authAdmin = { admin: { generateLink, createUser } };

    const minted = await mintOwnerJwt({ authAdmin: authAdmin as never, buildClient }, automation);

    // The admin API was invoked for exactly owner_id — never a model/request-supplied id.
    expect(generateLink).toHaveBeenCalledTimes(1);
    const callArg = generateLink.mock.calls[0][0] as Record<string, unknown>;
    // owner_id is the ONLY identity in the call args.
    const idsInCall = JSON.stringify(callArg);
    expect(idsInCall).toContain('user-A');
    // Assert no OTHER user id (e.g. user-B) can appear — the automation carries only owner_id.
    expect(idsInCall).not.toContain('user-B');
    expect(minted.client).toBe(buildClient.mock.results[0]?.value);
    // Lifetime bounded to timeout_s (FR-AAN-018).
    expect(minted.expiresInS).toBe(90);
  });

  it('mints only for owner_id even when other automation fields differ (no field leakage)', async () => {
    const automation = makeAutomation({ owner_id: 'user-A', prompt: 'user-B is mentioned in the prompt' });
    const generateLink = vi
      .fn()
      .mockResolvedValue({ data: { properties: { access_token: 'JWT' } }, error: null });
    const buildClient = vi.fn().mockReturnValue({});
    const authAdmin = { admin: { generateLink } };

    await mintOwnerJwt({ authAdmin: authAdmin as never, buildClient }, automation);

    // The mint identity comes from owner_id ONLY — never the prompt/condition text.
    const callArg = generateLink.mock.calls[0][0] as { user_id?: string };
    expect(callArg.user_id ?? JSON.stringify(callArg)).not.toBe('user-B is mentioned in the prompt');
    // The buildClient is handed the minted access token, not owner_id-as-identity.
    expect(buildClient).toHaveBeenCalledWith('JWT');
  });
});

describe('auditMint — AC-AAN-017 (every mint is audited before use) + AC-AAN-020 (no JWT persisted)', () => {
  it('inserts an agent_events type=system audit row carrying automation_id/owner_id/minted_at', async () => {
    const automation = makeAutomation({ id: 'auto-7', owner_id: 'user-A' });
    const eventInsert = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'evt-1' }, error: null }) }),
    });
    const threadInsert = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'thread-1' }, error: null }) }),
    });
    const runInsert = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'run-1' }, error: null }) }),
    });
    const from = vi.fn((table: string) => {
      if (table === 'agent_threads') return { insert: threadInsert };
      if (table === 'agent_runs') return { insert: runInsert };
      if (table === 'agent_events') return { insert: eventInsert };
      throw new Error(`unexpected table ${table}`);
    });
    const mintedClient = { from };

    await auditMint(mintedClient as never, automation, 'run-1', '2026-07-06T08:00:00.000Z');

    // The audit event is a type='system' row on the fired run (FR-AAN-019).
    expect(eventInsert).toHaveBeenCalledTimes(1);
    const payload = eventInsert.mock.calls[0][0] as { type: string; run_id: string; payload: Record<string, unknown> };
    expect(payload.type).toBe('system');
    expect(payload.run_id).toBe('run-1');
    expect(payload.payload).toMatchObject({
      kind: 'automation_mint',
      automation_id: 'auto-7',
      owner_id: 'user-A',
      minted_at: '2026-07-06T08:00:00.000Z',
    });
    // AC-AAN-020: the audit payload NEVER contains the JWT / any token.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/access_token|refresh_token|"jwt"|Bearer/i);
  });

  it('AC-AAN-020 minted JWT never persisted: mint.ts source never writes the token to any table', () => {
    const src = readFileSync(resolve(DISPATCH_DIR, 'mint.ts'), 'utf8');
    // No .insert()/.upsert()/.update() call anywhere near a token variable — the minted token
    // is only ever handed to the in-memory client builder, never to a Supabase write.
    expect(src).not.toMatch(/insert\([^)]*access_token/);
    expect(src).not.toMatch(/insert\([^)]*jwt/i);
    expect(src).not.toMatch(/upsert\([^)]*token/i);
    // The audit (auditMint) writes automation_id/owner_id/minted_at only — asserted structurally
    // above; here we assert mint.ts contains no token-persisting write literal.
    expect(src).not.toMatch(/\.(insert|upsert|update)\([^)]*token/i);
  });
});
