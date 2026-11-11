/**
 * S4 — the assistant follows the org's resolved switches (FR-PLN-008, AC-PLN-006) and emits ONE
 * privacy-preserving missing-tool signal (FR-PLN-009, AC-PLN-007).
 *
 * Binding rule: this suite imports the SHIPPED handler (`agentChatHandler` from `./handler.ts`) and
 * mocks only the wire (`globalThis.fetch`) and the client seam (`resolved_org_features`). No dependency
 * injection is added to production code, and no test-only branch exists inside the handler.
 */
import { assertEquals, assert, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { agentChatHandler } from './handler.ts';
import { createAutomationAction } from './actions.ts';
import type { HandlerDeps } from './handler.ts';
import { sanitizeServerProps } from '../_shared/posthogServer.ts';
import type { AgentEvent } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import type { AgentChatRequest } from '../../../pmo-portal/src/lib/agent/runtime/transport.ts';

const MODEL = 'deepseek/deepseek-v4-flash';
const QUESTION = 'How much cement is on hand in gudang A?';
const MODEL_ANSWER = "Stock isn't on your organisation's plan, so I can't look that up.";

type Ph = { event: string; properties: Record<string, unknown> };

const resp = (over: Record<string, unknown>) => ({
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, total_cost: 0.0001 },
  model: MODEL,
  ...over,
});

/** One tool round then a final text answer. */
const toolThenStop = (name: string, args: unknown, answer = MODEL_ANSWER) => [
  resp({
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'tc-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    },
  }),
  resp({ finish_reason: 'stop', message: { role: 'assistant', content: answer } }),
];

interface Opts {
  /** The resolver's answer: a key→enabled map, `'error'`, or `'absent'` (no rpc on the client). */
  switches?: Record<string, boolean> | 'error' | 'absent';
  rounds: unknown[];
  route?: string;
  consent?: boolean;
  posthog?: boolean;
  question?: string;
}

async function run(o: Opts) {
  const ph: Ph[] = [];
  const rpcCalls: string[] = [];
  const stockRpcCalls: string[] = [];
  const registered: Promise<unknown>[] = [];
  const create = (() => {
    let i = 0;
    return async (payload: { messages: { role: string; content: string | null }[]; tools?: { function: { name: string } }[] }) => {
      const script = o.rounds;
      return script[Math.min(i++, script.length - 1)] as never;
    };
  })();

  const client: Record<string, unknown> = {
    from: (table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }) }) }) };
      }
      if (table === 'organizations') {
        return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ lifecycle_state: 'live' }], error: null }) }) }) };
      }
      if (table === 'agent_usage') {
        return { insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'u' }, error: null }) }) }) };
      }
      if (table === 'stock_items' || table === 'stock_warehouses') {
        return { select: () => ({ limit: async () => ({ data: [], error: null }) }) };
      }
      return { select: () => ({ limit: async () => ({ data: [], error: null }) }) };
    },
  };
  if (o.switches !== 'absent') {
    client.rpc = async (fn: string) => {
      rpcCalls.push(fn);
      if (fn === 'resolved_org_features') {
        if (o.switches === 'error') return { data: null, error: { message: 'boom' } };
        const switches = o.switches ?? {};
        return {
          data: Object.entries(switches).map(([feature_key, enabled]) => ({ feature_key, enabled, display_enabled: enabled, source: 'plan' })),
          error: null,
        };
      }
      if (fn === 'get_stock_on_hand' || fn === 'get_stock_ledger') {
        stockRpcCalls.push(fn);
        return { data: [], error: null };
      }
      return { data: null, error: null };
    };
  }

  if (o.posthog) {
    (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => registered.push(p) };
    Deno.env.set('POSTHOG_PROJECT_KEY', 'phc_test');
    (globalThis as { fetch: unknown }).fetch = async (_url: string, init: RequestInit) => {
      ph.push(JSON.parse(String(init.body)));
      return { ok: true } as Response;
    };
  }

  const req: AgentChatRequest = {
    runId: 'run-s4',
    threadId: 'thread-s4',
    messages: [{ role: 'user', content: o.question ?? QUESTION }],
    ...(o.route ? { context: { route: o.route } } : {}),
    ...(o.consent ? { analytics: { consent: true as const, sessionId: 'replay-1' } } : {}),
  };

  const events: AgentEvent[] = [];
  try {
    for await (
      const e of agentChatHandler(req, {
        modelClient: { create } as never,
        model: MODEL,
        supabase: client as never,
        userId: 'user-1',
        usage: { supabase: client as never },
        // The answer check would add an extra model round; the switch behaviour is what this suite owns.
        verifyAnswer: false,
        now: () => new Date('2026-11-03T00:00:00Z'),
      })
    ) {
      events.push(e);
    }
    if (o.posthog) await Promise.all([...registered]);
    for (let n = 0; n < 20; n++) await new Promise((r) => setTimeout(r, 0));
  } finally {
    if (o.posthog) {
      Deno.env.delete('POSTHOG_PROJECT_KEY');
      delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
      delete (globalThis as { fetch?: unknown }).fetch;
    }
  }
  const toolEvents = events.filter((e) => e.type === 'tool').map((e) => e.payload as { name: string; result: unknown });
  const last = events.filter((e) => e.type === 'assistant').at(-1);
  return { events, toolEvents, last, ph, rpcCalls, stockRpcCalls };
}

Deno.test('AC-PLN-006 stock off — query_stock is not offered, stock entities are gone, the plan line is in the prompt', async () => {
  const captured: { tools?: { function: { name: string; parameters: unknown } }[]; messages?: { role: string; content: string | null }[] }[] = [];
  const script = toolThenStop('query_stock', { topic: 'on_hand' });
  let i = 0;
  const create = async (payload: never) => {
    captured.push(payload);
    return script[Math.min(i++, script.length - 1)] as never;
  };

  const client = {
    from: (table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }) }) }) };
      }
      return { select: () => ({ limit: async () => ({ data: [], error: null }) }) };
    },
    rpc: async (fn: string) => fn === 'resolved_org_features'
      ? { data: [{ feature_key: 'stock', enabled: false }, { feature_key: 'crm', enabled: true }], error: null }
      : { data: [], error: null },
  };
  const events: AgentEvent[] = [];
  for await (
    const e of agentChatHandler(
      { messages: [{ role: 'user', content: QUESTION }] },
      {
        modelClient: { create } as never, model: MODEL, supabase: client as never, userId: 'user-1',
        verifyAnswer: false, now: () => new Date('2026-11-03T00:00:00Z'),
      },
    )
  ) events.push(e);

  const first = captured[0];
  const names = (first.tools ?? []).map((t) => t.function.name);
  assertEquals(names.includes('query_stock'), false, 'query_stock must not be offered while stock is off');
  assert(names.includes('query_entity'), 'core tools stay offered');
  const queryEntity = (first.tools ?? []).find((t) => t.function.name === 'query_entity')!;
  const entityEnum = (queryEntity.function.parameters as { properties: { entity: { enum: string[] } } }).properties.entity.enum;
  assertEquals(entityEnum.some((e) => e.startsWith('stock_')), false, 'no stock entity may be advertised');
  assert(entityEnum.includes('projects'), 'core entities stay offered');

  const system = String((first.messages ?? [])[0]?.content ?? '');
  assert(system.toLowerCase().includes('not on'), 'the prompt must tell the model the feature is not on the plan');
  assert(system.includes('stock'), 'the plan line names the switched-off feature');
  assertEquals(system.includes('stock_items'), false, 'a switched-off entity must not appear in the schema section');

  // Execution refusal: the model called it anyway → refused, and the stock read RPC never ran.
  const stockTool = events.filter((e) => e.type === 'tool').map((e) => e.payload as { name: string; result: { code?: string } })
    .find((p) => p.name === 'query_stock')!;
  assertEquals(stockTool.result.code, 'FEATURE_OFF');
});

Deno.test('AC-PLN-006 stock off — query_entity stock_items is refused at the action layer', async () => {
  const r = await run({ switches: { stock: false }, rounds: toolThenStop('query_entity', { entity: 'stock_items' }) });
  const result = r.toolEvents.find((p) => p.name === 'query_entity')!.result as { code?: string; error?: string };
  assertEquals(result.code, 'FEATURE_OFF');
});

Deno.test('AC-PLN-006 stock on — the same org gets the tool, the entity and a real read', async () => {
  const captured: { tools?: { function: { name: string; parameters: unknown } }[]; messages?: { content: string | null }[] }[] = [];
  const script = toolThenStop('query_stock', { topic: 'on_hand' }, 'Nothing in stock.');
  let i = 0;
  const create = async (payload: never) => {
    captured.push(payload);
    return script[Math.min(i++, script.length - 1)] as never;
  };
  const stockCalls: string[] = [];
  const client = {
    from: (table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }) }) }) };
      }
      return { select: () => ({ limit: async () => ({ data: [], error: null }) }) };
    },
    rpc: async (fn: string) => {
      if (fn === 'resolved_org_features') return { data: [{ feature_key: 'stock', enabled: true }], error: null };
      stockCalls.push(fn);
      return { data: [], error: null };
    },
  };
  const events: AgentEvent[] = [];
  for await (
    const e of agentChatHandler(
      { messages: [{ role: 'user', content: QUESTION }] },
      { modelClient: { create } as never, model: MODEL, supabase: client as never, userId: 'user-1', verifyAnswer: false },
    )
  ) events.push(e);

  const names = (captured[0].tools ?? []).map((t) => t.function.name);
  assert(names.includes('query_stock'), 'stock on ⇒ the tool is offered');
  const queryEntity = (captured[0].tools ?? []).find((t) => t.function.name === 'query_entity')!;
  const entityEnum = (queryEntity.function.parameters as { properties: { entity: { enum: string[] } } }).properties.entity.enum;
  assert(entityEnum.includes('stock_items'), 'stock on ⇒ the entity is offered');
  assertEquals(stockCalls.includes('get_stock_on_hand'), true, 'the read actually reached the stock RPC');
  const system = String((captured[0].messages ?? [])[0]?.content ?? '');
  assertEquals(system.includes("plan does not include"), false, 'stock on ⇒ no not-on-plan paragraph');
});

Deno.test('S4 failure semantics — an unreachable resolver keeps every tool (fail open)', async () => {
  const r = await run({ switches: 'error', rounds: toolThenStop('query_entity', { entity: 'stock_items' }) });
  const result = r.toolEvents.find((p) => p.name === 'query_entity')!.result as { code?: string };
  assertEquals(result.code, undefined, 'a resolver failure must not refuse an otherwise-valid read');
  assert(r.rpcCalls.includes('resolved_org_features'), 'the resolver was attempted');
});

Deno.test('AC-PLN-007 — a missing-tool answer emits exactly one event with org, route and module (no text)', async () => {
  const r = await run({
    switches: { stock: false }, rounds: toolThenStop('query_stock', { topic: 'on_hand' }),
    route: '/stock', posthog: true,
  });
  const events = r.ph.filter((e) => e.event === 'agent_missing_tool');
  assertEquals(events.length, 1, 'exactly one missing-tool event per run');
  const p = events[0].properties;
  assertEquals(p.org_id, 'org-1');
  assertEquals(p.route, '/stock');
  assertEquals(p.module, 'stock');
  assertEquals(p.source, 'plan', 'the separated demand signal says whether it was the plan or a missing tool');
  const wire = JSON.stringify(r.ph);
  assertEquals(wire.includes('cement'), false, 'no question text may leave the server');
  assertEquals(wire.includes('gudang'), false, 'no question text may leave the server');
  assertEquals(wire.includes("isn't on your organisation"), false, 'no answer text may leave the server');
  assertEquals(p.user_id, undefined, 'consent was not given → no user id');
  assertEquals(p.$session_id, undefined, 'consent was not given → no session id');
});

Deno.test('AC-PLN-007 — consent adds only the link; the route is templated, never raw ids', async () => {
  const r = await run({
    switches: { stock: false }, rounds: toolThenStop('query_stock', { topic: 'on_hand' }),
    route: '/projects/0b9a1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d/stock?tab=levels', consent: true, posthog: true,
  });
  const events = r.ph.filter((e) => e.event === 'agent_missing_tool');
  assertEquals(events.length, 1);
  assertEquals(events[0].properties.route, '/projects/:id/stock');
  assertEquals(events[0].properties.user_id, 'user-1');
  assertEquals(events[0].properties.$session_id, 'replay-1');
});

Deno.test('AC-PLN-007 — an ordinary answer emits no missing-tool event', async () => {
  const r = await run({
    switches: { stock: true }, rounds: [resp({ finish_reason: 'stop', message: { role: 'assistant', content: 'There are 4 active projects.' } })],
    route: '/dashboard', posthog: true,
  });
  assertEquals(r.ph.filter((e) => e.event === 'agent_missing_tool').length, 0);
});

// ── D6: `agent_assistant` off is a REFUSAL, not a hidden tool ────────────────────────────────
// The key gates the assistant capability itself. It is enforced in the ONE handler every assistant
// run goes through — interactive chat and the fired-automation runner (agent-dispatch drives the same
// handler under a minted owner client), so both are covered by the same check and no path makes a
// model call while the feature resolves off.

/** A caller-JWT client stub whose ONLY interesting answer is the resolver. */
function resolverClient(answer: () => { data: unknown; error: unknown }) {
  return {
    from: (table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1', role: 'Finance' }, error: null }) }) }) };
      }
      return { select: () => ({ limit: async () => ({ data: [], error: null }) }) };
    },
    rpc: async (fn: string) => (fn === 'resolved_org_features' ? answer() : { data: [], error: null }),
  };
}

const rows = (switches: Record<string, boolean>) => ({
  data: Object.entries(switches).map(([feature_key, enabled]) => ({ feature_key, enabled, display_enabled: enabled, source: 'plan' })),
  error: null,
});

Deno.test('D6 agent_assistant off — the run is refused before any model call', async () => {
  let modelCalls = 0;
  const client = resolverClient(() => rows({ agent_assistant: false, crm: true, stock: true }));
  const events: AgentEvent[] = [];
  for await (
    const e of agentChatHandler(
      { messages: [{ role: 'user', content: 'How many projects are open?' }] },
      {
        modelClient: { create: async () => { modelCalls++; return resp({ finish_reason: 'stop', message: { role: 'assistant', content: 'hi' } }); } } as never,
        model: MODEL, supabase: client as never, userId: 'user-1',
      },
    )
  ) events.push(e);

  assertEquals(modelCalls, 0, 'no model call may happen while the assistant is off');
  const errored = events.filter((e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'errored');
  assertEquals(errored.length, 1);
  assertEquals((errored[0].payload as { error?: string }).error, 'FEATURE_OFF', 'the refusal is typed');
  assertEquals(events.some((e) => e.type === 'tool'), false, 'no tool may run');
});

Deno.test('D6 agent_assistant off — the fired-automation runner enters the same handler, so it is refused too', async () => {
  // The dispatch tick's deps shape (fireAutomation): model client, model, the MINTED owner client and
  // the owner id — nothing interactive. Same refusal, so an automation cannot run a switched-off
  // assistant even if a row still exists.
  let modelCalls = 0;
  const events: AgentEvent[] = [];
  for await (
    const e of agentChatHandler(
      { runId: 'run-dispatch', messages: [{ role: 'user', content: 'Daily digest' }] },
      {
        modelClient: { create: async () => { modelCalls++; return resp({ finish_reason: 'stop', message: { role: 'assistant', content: 'hi' } }); } } as never,
        model: MODEL, supabase: resolverClient(() => rows({ agent_assistant: false })) as never, userId: 'owner-1',
      },
    )
  ) events.push(e);

  assertEquals(modelCalls, 0);
  assertEquals(
    (events.find((e) => (e.payload as { status?: string })?.status === 'errored')?.payload as { error?: string })?.error,
    'FEATURE_OFF',
  );
});

Deno.test('D6 agent_assistant on — the same org runs, and an unresolved resolver does not refuse', async () => {
  const on = await run({ switches: { agent_assistant: true }, rounds: [resp({ finish_reason: 'stop', message: { role: 'assistant', content: 'There are 4 active projects.' } })] });
  assertEquals(on.events.some((e) => (e.payload as { status?: string })?.status === 'errored'), false, 'agent_assistant on ⇒ the run proceeds');

  const unresolved = await run({ switches: 'error', rounds: [resp({ finish_reason: 'stop', message: { role: 'assistant', content: 'There are 4 active projects.' } })] });
  assertEquals(unresolved.events.some((e) => (e.payload as { status?: string })?.status === 'errored'), false, 'an unreachable resolver keeps the read assistant available');
});

// ── Writes never fail open ──────────────────────────────────────────────────────────────────
// A chip can be approved after the resolver read failed, so the WRITE path checks its own key at
// execution. Reads keep the fail-open rule; a write does not: an unknown entitlement refuses.

/** A two-turn run (propose → approve) with a per-request resolver answer. */
async function proposeThenApprove(opts: {
  tool: string;
  args: Record<string, unknown>;
  switchesPerTurn: Array<Record<string, boolean> | 'error'>;
}) {
  const inserts: Array<{ table: string; row: unknown }> = [];
  let turn = 0;
  const client = {
    from: (table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1', role: 'Finance' }, error: null }) }) }) };
      }
      return {
        insert: (row: unknown) => {
          inserts.push({ table, row });
          return { select: () => ({ single: async () => ({ data: { id: 'row-1' }, error: null }) }) };
        },
        select: () => ({ limit: async () => ({ data: [], error: null }) }),
      };
    },
    rpc: async (fn: string) => {
      if (fn !== 'resolved_org_features') return { data: [], error: null };
      const answer = opts.switchesPerTurn[Math.min(turn, opts.switchesPerTurn.length - 1)];
      if (answer === 'error') return { data: null, error: { message: 'resolver unavailable' } };
      return rows(answer);
    },
  };
  const model = async () => resp({
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant', content: null,
      tool_calls: [{ id: 'tc-1', type: 'function', function: { name: opts.tool, arguments: JSON.stringify(opts.args) } }],
    },
  });
  const base = {
    model: MODEL, supabase: client as never, userId: 'user-1', verifyAnswer: false,
    can: () => true,
    now: () => new Date('2026-11-03T00:00:00Z'),
  };

  const first: AgentEvent[] = [];
  for await (const e of agentChatHandler({ runId: 'run-1', threadId: 't-1', messages: [{ role: 'user', content: 'do it' }] }, { ...base, modelClient: { create: model } as never })) first.push(e);
  const chip = first.find((e) => (e.payload as { status?: string })?.status === 'needs-approval');
  const pendingId = (chip?.payload as { pendingId?: string } | undefined)?.pendingId;

  turn = 1;
  const second: AgentEvent[] = [];
  for await (
    const e of agentChatHandler(
      {
        runId: 'run-1',
        threadId: 't-1',
        messages: [
          { role: 'user', content: 'do it' },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'tc-1', name: opts.tool, input: opts.args }] as never },
        ],
        decision: { pendingId: pendingId ?? '', verdict: 'approve' },
      },
      { ...base, modelClient: { create: async () => resp({ finish_reason: 'stop', message: { role: 'assistant', content: 'Not on your plan.' } }) } as never },
    )
  ) second.push(e);

  return { chip: chip?.payload, second, inserts };
}

Deno.test('create_automation — an approved chip writes nothing when the plan could not be resolved', async () => {
  const r = await proposeThenApprove({
    tool: 'create_automation',
    args: { kind: 'schedule', prompt: 'Send the weekly summary', schedule: '0 9 * * 1' },
    switchesPerTurn: ['error', 'error'],
  });
  assertEquals(r.inserts.filter((i) => i.table === 'agent_automations').length, 0, 'no automation row may be written on an unknown entitlement');
  const rejected = r.second.find((e) => (e.payload as { event?: string })?.event === 'write_resolved');
  assertEquals((rejected?.payload as { decision?: string }).decision, 'rejected');
  assertEquals((rejected?.payload as { reason?: string }).reason, 'plan_unverified');
});

Deno.test('create_automation — the action refuses an off assistant key itself (defence behind the run gate)', async () => {
  const inserts: unknown[] = [];
  const ctx = {
    jwt: '', userId: 'u-1', orgId: 'org-1', role: 'Finance', featureSwitches: { agent_assistant: false },
    supabase: { from: () => ({ insert: (row: unknown) => { inserts.push(row); return { select: () => ({ single: async () => ({ data: { id: 'x' }, error: null }) }) }; } }) },
  };
  const out = await createAutomationAction.run(
    { kind: 'schedule', prompt: 'Send the weekly summary', schedule: '0 9 * * 1' },
    ctx as never,
  );
  assertEquals((out as { code?: string }).code, 'FEATURE_OFF');
  assertEquals(inserts.length, 0);
});

Deno.test('AC-PLN-006 approve after the switch changed — the pending write is refused, not executed', async () => {
  // The review's own scenario: the chip was proposed while crm resolved on, and the approval re-POST
  // arrives after the key resolved off. The write must be refused AND resolved as rejected.
  const r = await proposeThenApprove({
    tool: 'create_activity',
    args: { contactId: 'c-1', kind: 'call', subject: 'Kickoff call' },
    switchesPerTurn: [{ crm: true }, { crm: false }],
  });
  assertEquals(!!r.chip, true, 'the chip is proposed while the key is on');
  assertEquals(r.inserts.filter((i) => i.table === 'crm_activities').length, 0, 'the write must not execute');
  const rejected = r.second.find((e) => (e.payload as { event?: string })?.event === 'write_resolved');
  assertEquals((rejected?.payload as { decision?: string; reason?: string }).decision, 'rejected');
  assertEquals((rejected?.payload as { reason?: string }).reason, 'feature_off');
});

Deno.test('AC-PLN-007 — the event allowlist has no text key, so a message can never ride along', () => {
  // Strict mode is what CI-adjacent suites use; the emitter in production drops unknown keys. Both
  // directions matter: a text key must not exist for this event, and the allowed set must be exactly
  // the codes the privacy contract promises (org + route + module + the consent-gated link).
  assertThrows(
    () => sanitizeServerProps('agent_missing_tool', { org_id: 'org-1', module: 'stock', message: 'secret' }, true),
    Error,
    'message',
  );
  assertEquals(
    sanitizeServerProps(
      'agent_missing_tool',
      { org_id: 'org-1', route: '/stock', module: 'stock', source: 'plan', $session_id: 's-1', user_id: 'u-1' },
      true,
    ),
    { org_id: 'org-1', route: '/stock', module: 'stock', source: 'plan', $session_id: 's-1', user_id: 'u-1' },
  );
});

// ── #1783 item 1 (D17 / AC-PLN-006/007): receipts are offered AND executable at Basic; the Full-off
// label and the missing-tool hint stay truthful. These drive the REAL handler loop end to end. ──

Deno.test('#1783 D17 Basic on + Full off — query_entity offers and EXECUTES procurement_receipts', async () => {
  const captured: { tools?: { function: { name: string; parameters: unknown } }[]; messages?: { content: string | null }[] }[] = [];
  const script = toolThenStop('query_entity', { entity: 'procurement_receipts' }, 'You received 6 of 10 cables.');
  let i = 0;
  const create = async (payload: never) => {
    captured.push(payload);
    return script[Math.min(i++, script.length - 1)] as never;
  };
  const receiptReads: string[] = [];
  const client = {
    from: (table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }) }) }) };
      }
      if (table === 'procurement_receipts') {
        receiptReads.push(table);
        return { select: () => ({ limit: async () => ({ data: [], error: null }) }) };
      }
      return { select: () => ({ limit: async () => ({ data: [], error: null }) }) };
    },
    rpc: async (fn: string) => fn === 'resolved_org_features'
      ? { data: [{ feature_key: 'procurement', enabled: true }, { feature_key: 'procurement_full', enabled: false }].map((row) => ({ ...row, display_enabled: row.enabled, source: 'plan' })), error: null }
      : { data: [], error: null },
  };
  const events: AgentEvent[] = [];
  for await (
    const e of agentChatHandler(
      { messages: [{ role: 'user', content: 'What did we receive against the pump purchase?' }] },
      { modelClient: { create } as never, model: MODEL, supabase: client as never, userId: 'user-1', verifyAnswer: false },
    )
  ) events.push(e);

  const queryEntity = (captured[0].tools ?? []).find((t) => t.function.name === 'query_entity')!;
  const entityEnum = (queryEntity.function.parameters as { properties: { entity: { enum: string[] } } }).properties.entity.enum;
  assert(entityEnum.includes('procurement_receipts'), 'the receipts entity is offered at Basic');
  const result = events.filter((e) => e.type === 'tool').map((e) => e.payload as { name: string; result: { code?: string } })
    .find((p) => p.name === 'query_entity')!.result;
  assertEquals(result.code, undefined, 'the receipts read executed — never a FEATURE_OFF refusal');
  assertEquals(receiptReads.length, 1, 'the read actually reached the receipts table');
  const system = String((captured[0].messages ?? [])[0]?.content ?? '');
  assertEquals(system.toLowerCase().includes('goods receipts and three-way match'), false, 'the off- Full label no longer claims goods receipts');
});

Deno.test('#1783 D17 procurement off — receipts are refused at the action layer, like any procurement read', async () => {
  const r = await run({ switches: { procurement: false, procurement_full: false }, rounds: toolThenStop('query_entity', { entity: 'procurement_receipts' }) });
  const result = r.toolEvents.find((p) => p.name === 'query_entity')!.result as { code?: string; error?: string };
  assertEquals(result.code, 'FEATURE_OFF');
});
