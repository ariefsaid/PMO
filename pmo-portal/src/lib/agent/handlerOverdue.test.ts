import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentChatHandler, type HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import { fakeSupabase, type FakeCall } from './testing/fakeSupabase';

const P1 = '11111111-1111-4111-8111-111111111111';
async function collect(it: AsyncIterable<AgentEvent>) { const out: AgentEvent[] = []; for await (const e of it) out.push(e); return out; }
const toolCall = (name: string, args: object) => ({
  finish_reason: 'tool_calls', usage: {}, model: 'm',
  message: { role: 'assistant', content: null, tool_calls: [{ id: 'tc-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
});
const stop = (text: string) => ({ finish_reason: 'stop', usage: {}, model: 'm', message: { role: 'assistant', content: text } });

function respond(c: FakeCall) {
  if (c.table === 'profiles' && c.columns === 'org_id, role') return { data: { org_id: 'org-1', role: 'Finance' }, error: null };
  if (c.table === 'profiles' && c.columns === 'timezone') return { data: { timezone: 'Asia/Jakarta' }, error: null };
  if (c.table === 'profiles') return { data: [{ id: 'u-2', full_name: 'Budi' }], error: null };
  if (c.table === 'organizations') return { data: { default_timezone: 'Asia/Jakarta', default_locale: 'en-US', default_number_locale: 'id-ID' }, error: null };
  if (c.table === 'org_features') return { data: { enabled: true }, error: null };
  if (c.table === 'tasks') return { data: [{ id: 't-1', name: 'Pour foundation', end_date: '2026-10-02', project_id: P1, assignee_id: 'u-2' }], error: null };
  if (c.table === 'projects') return { data: [{ id: P1, name: 'Harbor Tower' }], error: null };
  if (c.table === 'sales_invoices') return { data: [{ id: 'si-1', si_number: 'ACC-SINV-2026-00012', invoice_date: '2026-09-01', erp_outstanding_amount: 850000000, currency: 'IDR', tax_treatment: 'inclusive', project_id: P1, companies: { name: 'PT Client', erp_payment_terms_days: 30 } }], error: null };
  return { data: null, error: null };
}

describe('whats_overdue through the handler (#787)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-06T03:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('AC-AIN-001 shows the overdue tasks and invoices with links; the model receives only the receipt', async () => {
    const { client } = fakeSupabase(respond);
    const create = vi.fn().mockResolvedValueOnce(toolCall('whats_overdue', {})).mockResolvedValueOnce(stop('Two things need you.'));
    const deps: HandlerDeps = {
      modelClient: { create }, model: 'm', userId: 'u-fin', can: () => true,
      supabase: client as unknown as HandlerDeps['supabase'],
    };
    const events = await collect(agentChatHandler({ messages: [{ role: 'user', content: "What's overdue this week?" }] }, deps));

    const text = events.filter((e) => e.type === 'assistant').map((e) => e.text).join('\n');
    expect(text).toContain('— 1 task, 1 invoice');
    expect(text).toContain(`[Pour foundation](/projects/${P1}/tasks) — Harbor Tower · due 2 Oct (4 days late) · Budi`);
    expect(text).toContain('[ACC-SINV-2026-00012](/sales-invoices?q=ACC-SINV-2026-00012) — PT Client');

    const toolMsg = create.mock.calls[1][0].messages.at(-1);
    expect(toolMsg.role).toBe('tool');
    expect(JSON.parse(toolMsg.content)).toMatchObject({ ok: true, overdueTasks: 1, overdueInvoices: 1 });
    expect(toolMsg.content).not.toContain('Pour foundation');
    expect(events.some((e) => (e.payload as { label?: string } | undefined)?.label === "Checking what's overdue…")).toBe(true);
  });
});
