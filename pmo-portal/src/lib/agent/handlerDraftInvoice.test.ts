import { describe, expect, it, vi } from 'vitest';
import { agentChatHandler, type HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import { fakeSupabase, type FakeCall, type Invoker } from './testing/fakeSupabase';
import { C1, P1, world } from './testing/draftInvoiceFixtures';

async function collect(it: AsyncIterable<AgentEvent>) { const out: AgentEvent[] = []; for await (const e of it) out.push(e); return out; }
const toolCall = (name: string, args: object) => ({ finish_reason: 'tool_calls', usage: {}, model: 'm',
  message: { role: 'assistant', content: null, tool_calls: [{ id: 'tc-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } });
const stop = (text: string) => ({ finish_reason: 'stop', usage: {}, model: 'm', message: { role: 'assistant', content: text } });

function setup(role: string) {
  const base = world();
  const respond = (c: FakeCall) => (c.table === 'profiles' ? { data: { org_id: 'org-1', role }, error: null } : base(c));
  const invoke = vi.fn<Invoker>(async (name) => name === 'external-items'
    ? { data: { items: [{ code: 'SVC', name: 'Services' }] }, error: null }
    : { data: { canonical: { id: 'si-new', si_number: 'ACC-SINV-2026-00099' } }, error: null });
  return { ...fakeSupabase(respond, invoke), invoke };
}
const deps = (client: unknown, create: ReturnType<typeof vi.fn>, can: HandlerDeps['can'] = vi.fn(() => true)): HandlerDeps =>
  ({ modelClient: { create }, model: 'm', userId: 'u-fin', can, supabase: client as HandlerDeps['supabase'] });
const USER = { role: 'user' as const, content: 'Invoice work order WO-20261001-001' };

async function propose(role = 'Finance') {
  const s = setup(role);
  const create = vi.fn().mockResolvedValueOnce(toolCall('draft_invoice', { workOrder: 'WO-20261001-001' })).mockResolvedValueOnce(stop('Only Finance can.'));
  const events = await collect(agentChatHandler({ runId: 'run-1', messages: [USER] }, deps(s.client, create)));
  const chip = events.find((e) => (e.payload as { status?: string } | undefined)?.status === 'needs-approval');
  return { ...s, create, events, chip: chip?.payload as { pendingId: string; humanSummary: string; structuredArgs: Record<string, unknown> } | undefined };
}
const approveReq = (pendingId: string, args: object) => ({
  runId: 'run-1',
  decision: { pendingId, verdict: 'approve' as const },
  messages: [USER, { role: 'assistant' as const, content: [{ type: 'tool_use', id: pendingId, name: 'draft_invoice', input: args }] }],
}) as never;
const dispatchBody = (invoke: ReturnType<typeof setup>['invoke']) =>
  (invoke.mock.calls.find(([name]) => name === 'adapter-dispatch')?.[1] as { body: Record<string, unknown> } | undefined)?.body;

describe('draft_invoice through the handler (#787)', () => {
  it('AC-AIN-002 proposes the resolved Draft, then approval sends one CREATE as the caller', async () => {
    const { chip, invoke, client } = await propose();
    expect(chip?.humanSummary).toMatch(/^Save as Draft: invoice PT Client .* Not submitted\.$/);
    expect(chip?.structuredArgs).toMatchObject({ kind: 'prepared-draft-invoice', customerId: C1, projectId: P1, items: [{ rate: 1_000_000 }] });
    expect(dispatchBody(invoke)).toBeUndefined();

    const can = vi.fn(() => true);
    const create = vi.fn().mockResolvedValueOnce(stop('Saved as a draft.'));
    const events = await collect(agentChatHandler(approveReq(chip!.pendingId, chip!.structuredArgs), deps(client, create, can)));
    expect(can).toHaveBeenCalledWith('create', 'salesInvoice', { realRole: 'Finance' });
    expect(invoke.mock.calls.filter(([name]) => name === 'adapter-dispatch')).toHaveLength(1);
    expect(dispatchBody(invoke)).toMatchObject({ domain: 'revenue', operation: 'create', idempotencyKey: chip!.structuredArgs.idempotencyKey,
      record: { id: chip!.structuredArgs.commandId, erp_doc_kind: 'sales-invoice', customerId: C1, projectId: P1 } });
    expect(events.find((e) => e.type === 'tool')).toMatchObject({ payload: { name: 'draft_invoice', result: { ok: true, status: 'Draft' } } });
  });

  it('AC-AIN-007 a PM gets the refusal, no chip, no dispatch', async () => {
    const { chip, invoke, create } = await propose('Project Manager');
    expect(chip).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
    expect(JSON.parse(create.mock.calls[1][0].messages.at(-1).content)).toEqual({ error: 'Only Finance or Admin can raise an invoice.' });
  });

  it('AC-AIN-010 role lost before approval → PERMISSION_DENIED, nothing dispatched', async () => {
    const { chip, invoke, client } = await propose();
    const events = await collect(agentChatHandler(approveReq(chip!.pendingId, chip!.structuredArgs), deps(client, vi.fn(), vi.fn(() => false))));
    expect(events.some((e) => (e.payload as { error?: string } | undefined)?.error === 'PERMISSION_DENIED')).toBe(true);
    expect(dispatchBody(invoke)).toBeUndefined();
  });

  it('AC-AIN-011 smuggled fields in the replayed args never reach the dispatch', async () => {
    const { chip, invoke, client } = await propose();
    const forged = { ...chip!.structuredArgs, verb: 'submit', operation: 'transition', author_user_id: 'someone-else' };
    await collect(agentChatHandler(approveReq(chip!.pendingId, forged), deps(client, vi.fn().mockResolvedValueOnce(stop('ok')))));
    const body = dispatchBody(invoke);
    expect(body?.operation).toBe('create');
    expect(JSON.stringify(body)).not.toMatch(/verb|submit|transition|author_user_id/);
  });
});
