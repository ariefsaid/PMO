/**
 * Tests for agentChatHandler — the pure async generator handler.
 * AC-AR-001: happy single-turn read (user → tool → assistant → completed).
 * AC-AR-002: empty userId → 401, no model call.
 * AC-AR-003: profiles lookup error → 400 BAD_REQUEST(orgId), no model call.
 * AC-AR-004: step cap → terminal completed (not errored), SDK called MAX_TOOL_ROUNDS times.
 * AC-AR-005: upstream SDK error scrubbed → UPSTREAM_ERROR, no prompt/data in log.
 * AC-MC-008/009/012: ModelClient (OpenRouter/OpenAI shape) parity after the provider swap.
 *
 * All ModelClient and Supabase calls are mocked via injected HandlerDeps.
 * No live LLM calls in CI (ADR-0039 decision 7).
 */
import { it, expect, vi } from 'vitest';
import {
  agentChatHandler,
  MAX_TOOL_ROUNDS,
} from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest } from './runtime/transport';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Collect all events from the async generator. */
async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

/** A basic request with one user message. */
const REQ: AgentChatRequest = {
  messages: [{ role: 'user', content: 'how many of my projects are active?' }],
};

function REQ_WITH_MSG(msg: string): AgentChatRequest {
  return { messages: [{ role: 'user', content: msg }] };
}

/**
 * Build a mock SupabaseLike that:
 *   1. Returns org-1 for .from('profiles').select('org_id').eq('id', userId).single()
 *   2. Returns the given rows from .from(table).select(cols).limit(n) via rowsFactory
 */
function mockOrgAnd(
  rowsFactory: () => { data: unknown[]; error: null },
): HandlerDeps['supabase'] {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1' }, error: null }),
              limit: vi.fn().mockResolvedValue({ data: [{ org_id: 'org-1' }], error: null }),
            }),
          }),
        };
      }
      // For other tables (entity reads)
      return {
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rowsFactory()),
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(rowsFactory()),
          }),
        }),
      };
    }),
  } as unknown as HandlerDeps['supabase'];
}

/** Build a mock SupabaseLike that fails the profiles lookup. */
function mockProfilesError(): HandlerDeps['supabase'] {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
        }),
      }),
    }),
  } as unknown as HandlerDeps['supabase'];
}

/** Build base deps; modelClient and supabase can be overridden. */
function baseDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    modelClient: {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'All done.' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
    },
    supabase: mockOrgAnd(() => ({ data: [], error: null })),
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    now: () => new Date('2026-06-30T00:00:00Z'),
    ...overrides,
  };
}

// ── Task 10: AC-AR-002 + AC-AR-003 (gates before any model call) ──────────────

it('AC-AR-002 emits a single 401 status event and never calls the model when userId is empty', async () => {
  const create = vi.fn();
  const events = await collect(
    agentChatHandler(REQ, baseDeps({ userId: '', modelClient: { create } })),
  );
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'status',
    payload: { status: 'errored', error: 'UNAUTHORIZED' },
  });
  expect(create).not.toHaveBeenCalled();
});

it('AC-AR-003 emits a 400 BAD_REQUEST (detail orgId) when the profiles lookup fails, before any model call', async () => {
  const create = vi.fn();
  const supabase = mockProfilesError();
  const events = await collect(
    agentChatHandler(REQ, baseDeps({ supabase, modelClient: { create } })),
  );
  expect(events.at(-1)).toMatchObject({
    type: 'status',
    payload: { status: 'errored', error: 'BAD_REQUEST', detail: 'orgId' },
  });
  expect(create).not.toHaveBeenCalled();
});

// ── Task 11: rate guard ────────────────────────────────────────────────────────

it('emits a 429 RATE_LIMITED terminal status and never calls the model when the injected rateGuard reports exceeded', async () => {
  const create = vi.fn();
  const rateGuard = {
    check: vi.fn().mockResolvedValue({ exceeded: true, retryAfterSeconds: 3600 }),
  };
  const events = await collect(
    agentChatHandler(REQ, baseDeps({ rateGuard, modelClient: { create } })),
  );
  expect(events.at(-1)).toMatchObject({
    type: 'status',
    payload: { status: 'errored', error: 'RATE_LIMITED', retryAfterSeconds: 3600 },
  });
  expect(create).not.toHaveBeenCalled();
});

it('rateGuard absent ⇒ proceeds to the model', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'Done.' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });
  const events = await collect(
    agentChatHandler(REQ, baseDeps({ modelClient: { create } })),
  );
  expect(create).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toMatchObject({ type: 'status', payload: { status: 'completed' } });
});

// ── Task 12: AC-AR-001 + AC-AR-004 (tool loop + step cap) ─────────────────────

it('AC-MC-008 tool-use loop parity: happy read path, same event order (OpenRouter/OpenAI shape)', async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tu1', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects' }) } },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    })
    .mockResolvedValueOnce({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'You have 3 active projects.' },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    });

  const supabase = mockOrgAnd(() => ({
    data: [{ id: '1' }, { id: '2' }, { id: '3' }],
    error: null,
  }));

  const events = await collect(agentChatHandler(REQ, baseDeps({ supabase, modelClient: { create } })));

  // The live step-trail hint is a transient `status` event emitted right BEFORE each tool runs
  // (payload.kind==='step'); it rides the same stream (persistence skips it, the panel intercepts
  // it into the indicator). So the happy read path is: user → status(step) → tool → assistant →
  // status(completed).
  expect(events.map((e) => e.type)).toEqual(['user', 'status', 'tool', 'assistant', 'status']);
  expect(events[1]).toMatchObject({ type: 'status', payload: { kind: 'step' } });
  expect(events.at(-1)).toMatchObject({ type: 'status', payload: { status: 'completed' } });
  expect(create).toHaveBeenCalledTimes(2);
});

it('AC-MC-009 MAX_TOOL_ROUNDS unchanged after the provider swap', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'tu', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects' }) } },
      ],
    },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });
  const supabase = mockOrgAnd(() => ({ data: [], error: null }));

  const events = await collect(agentChatHandler(REQ, baseDeps({ supabase, modelClient: { create } })));

  expect(create).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
  expect(events.at(-1)).toMatchObject({
    type: 'status',
    payload: { status: 'completed' },
    text: expect.stringMatching(/step limit/i),
  });
});

// ── #5: parallel reads / serial writes ───────────────────────────────────────

it('parallelizes multiple read tool calls in one round (both execute, both results returned)', async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'r1', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects' }) } },
          { id: 'r2', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'tasks' }) } },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    })
    .mockResolvedValueOnce({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Projects and tasks summarized.' },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    });
  const supabase = mockOrgAnd(() => ({ data: [{ id: '1' }], error: null }));

  const events = await collect(agentChatHandler(REQ, baseDeps({ supabase, modelClient: { create } })));

  // Both reads ran in the SAME round → two tool events, then one more model round to answer.
  const toolEvents = events.filter((e) => e.type === 'tool');
  expect(toolEvents).toHaveLength(2);
  expect(create).toHaveBeenCalledTimes(2);
  expect(events.at(-1)).toMatchObject({ type: 'status', payload: { status: 'completed' } });

  // Round 2's transcript answers BOTH tool_call_ids (the API pairing invariant).
  const round2Messages = create.mock.calls[1][0].messages;
  const toolResultIds = round2Messages.filter((m: { role: string }) => m.role === 'tool').map((m: { tool_call_id: string }) => m.tool_call_id);
  expect(toolResultIds).toEqual(expect.arrayContaining(['r1', 'r2']));
});

it('never parallelizes a write: a read+write round runs only the read and DEFERS the write', async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'read1', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects' }) } },
          { id: 'write1', type: 'function', function: { name: 'create_activity', arguments: JSON.stringify({ type: 'note', body: 'x', company_id: 'c1' }) } },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    })
    .mockResolvedValueOnce({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Done.' },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    });
  const supabase = mockOrgAnd(() => ({ data: [{ id: '1' }], error: null }));

  const events = await collect(agentChatHandler(REQ, baseDeps({ supabase, modelClient: { create } })));

  // The write was NOT parallelized or executed this round: no needs-approval, exactly one tool event
  // (the read). The write is deferred — the loop continues to a second model round.
  expect(events.some((e) => e.type === 'status' && (e as { payload?: { status?: string } }).payload?.status === 'needs-approval')).toBe(false);
  expect(events.filter((e) => e.type === 'tool')).toHaveLength(1);
  expect(create).toHaveBeenCalledTimes(2);

  // Round 2's transcript answers BOTH ids: the real read result + a deferred marker for the write,
  // so the assistant(tool_calls)→tool(result) pairing stays valid.
  const round2Messages = create.mock.calls[1][0].messages;
  const writeResult = round2Messages.find((m: { role: string; tool_call_id?: string }) => m.role === 'tool' && m.tool_call_id === 'write1');
  expect(writeResult).toBeDefined();
  expect(JSON.parse(writeResult.content)._deferred).toBe(true);
  const readResult = round2Messages.find((m: { role: string; tool_call_id?: string }) => m.role === 'tool' && m.tool_call_id === 'read1');
  expect(readResult).toBeDefined();
  expect(JSON.parse(readResult.content)._deferred).toBeUndefined();
});

// ── Blocker 3: loop termination uses finish_reason !== 'tool_calls'; length handled ──

it('terminates on finish_reason stop even when a tool_calls entry is accidentally present', async () => {
  // OLD CODE: `if (!toolBlock || resp.stop_reason === 'end_turn')` — the OR lets this complete
  // but the OLD code would also trigger completion even if there IS a toolBlock when
  // stop_reason is end_turn, silently skipping the tool. The correct sentinel is
  // finish_reason !== 'tool_calls'.
  //
  // This test ensures: when finish_reason is 'stop' AND the message has both text + a
  // spurious tool_calls entry, we complete (not dispatch the tool).
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: {
      role: 'assistant',
      content: 'Final answer.',
      // Spurious tool_calls entry with finish_reason:'stop' — model API won't do this, but if
      // it did, old code would complete (correct result via OR branch), new code does too.
      tool_calls: [
        { id: 'tu1', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects' }) } },
      ],
    },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const events = await collect(agentChatHandler(REQ, baseDeps({ modelClient: { create } })));
  // Must complete after 1 SDK call — do not dispatch tool on stop
  expect(create).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toMatchObject({ type: 'status', payload: { status: 'completed' } });
});

it('finish_reason length emits completed with truncation note (not silent)', async () => {
  // OLD CODE would emit a generic 'completed' indistinguishable from a real answer.
  // Fixed: emit completed with text 'response truncated'.
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'length',
    message: { role: 'assistant', content: 'Partial answer...' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const events = await collect(agentChatHandler(REQ, baseDeps({ modelClient: { create } })));
  expect(create).toHaveBeenCalledTimes(1);
  const last = events.at(-1)!;
  expect(last).toMatchObject({ type: 'status', payload: { status: 'completed' } });
  expect(last.text).toMatch(/truncated/i);
});

// ── Blocker 2: no module-level mutable _runId (cross-request isolation) ──────

it('concurrent runs produce distinct runIds (no module-level _runId contamination)', async () => {
  // If _runId were a module-level mutable shared across calls, events from concurrent
  // runs could carry the wrong runId. The runId used in events must come solely from
  // the local variable inside the generator, not from module scope.
  const makeCreate = (text: string) =>
    vi.fn().mockResolvedValue({
      finish_reason: 'stop',
      message: { role: 'assistant', content: text },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    });

  const req1: AgentChatRequest = { runId: 'run-A', messages: [{ role: 'user', content: 'q1' }] };
  const req2: AgentChatRequest = { runId: 'run-B', messages: [{ role: 'user', content: 'q2' }] };

  const [evs1, evs2] = await Promise.all([
    collect(agentChatHandler(req1, baseDeps({ modelClient: { create: makeCreate('ans1') } }))),
    collect(agentChatHandler(req2, baseDeps({ modelClient: { create: makeCreate('ans2') } }))),
  ]);

  // Every event from run-A must carry runId 'run-A' and vice versa
  for (const ev of evs1) expect(ev.runId).toBe('run-A');
  for (const ev of evs2) expect(ev.runId).toBe('run-B');
});

// ── Task 13: AC-AR-005 upstream error scrubbed ────────────────────────────────

it('AC-AR-005 scrubs the raw SDK error to UPSTREAM_ERROR and logs no prompt/data rows', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const create = vi.fn().mockRejectedValue(new Error('SECRET upstream body'));

  const events = await collect(
    agentChatHandler(
      REQ_WITH_MSG('show me my projects'),
      baseDeps({ modelClient: { create } }),
    ),
  );

  const last = events.at(-1)!;
  expect(last).toMatchObject({
    type: 'status',
    payload: { status: 'errored', error: 'UPSTREAM_ERROR' },
  });
  expect(JSON.stringify(last)).not.toContain('SECRET');

  for (const c of spy.mock.calls) {
    const s = JSON.stringify(c);
    expect(s).not.toContain('SECRET');
    expect(s).not.toContain('show me my projects');
  }

  spy.mockRestore();
});

// ── Task 13: AC-MC-012 per-round usage surfaced on the terminal status event ─

it('AC-MC-012 per-round usage is surfaced additively on the terminal status event', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'done' },
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160, total_cost: 0.0002 },
    model: 'deepseek/deepseek-v4-flash',
  });

  const events = await collect(
    agentChatHandler(REQ, baseDeps({ modelClient: { create } })),
  );

  const completedEvent = events.find(
    (e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'completed',
  );
  expect(completedEvent).toBeDefined();
  expect(completedEvent!.payload).toMatchObject({
    status: 'completed',
    model: 'deepseek/deepseek-v4-flash',
    prompt_tokens: 120,
    completion_tokens: 40,
    total_cost: 0.0002,
  });
});

// ── Item 2 (deferred-debt refactor): MALFORMED_TOOL_CALL differentiation ──────

it('malformed tool arguments (main loop) → error tool_result appended, run recovers on the model\'s next valid attempt', async () => {
  const create = vi.fn()
    // Round 1: model emits invalid JSON in the arguments string
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tu1', type: 'function', function: { name: 'query_entity', arguments: '{not valid json' } },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    })
    // Round 2: model retries with valid JSON
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tu2', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects' }) } },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    })
    // Round 3: model concludes
    .mockResolvedValueOnce({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'You have 2 active projects.' },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    });

  const supabase = mockOrgAnd(() => ({ data: [{ id: '1' }, { id: '2' }], error: null }));

  const events = await collect(agentChatHandler(REQ, baseDeps({ supabase, modelClient: { create } })));

  // Run must NOT fail as UPSTREAM_ERROR — it must recover and complete normally.
  expect(create).toHaveBeenCalledTimes(3);
  expect(events.at(-1)).toMatchObject({ type: 'status', payload: { status: 'completed' } });
  expect(events.find((e) => (e.payload as { error?: string })?.error === 'UPSTREAM_ERROR')).toBeUndefined();
  // A real tool event is still emitted for the successful (round 2) call.
  expect(events.find((e) => e.type === 'tool')).toBeDefined();
});

it('malformed tool arguments that never recover exhaust the loop with a distinct MALFORMED_TOOL_CALL error', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'tu', type: 'function', function: { name: 'query_entity', arguments: '{still not valid' } },
      ],
    },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const events = await collect(agentChatHandler(REQ, baseDeps({ modelClient: { create } })));

  expect(create).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
  expect(events.at(-1)).toMatchObject({
    type: 'status',
    payload: { status: 'errored', error: 'MALFORMED_TOOL_CALL' },
  });
});

it('a malformed round healed by later missing-toolCall rounds exhausts as the generic step-limit completion, not MALFORMED_TOOL_CALL', async () => {
  // Round 1: malformed JSON sets lastRoundMalformed=true.
  // Rounds 2..MAX_TOOL_ROUNDS: finish_reason 'tool_calls' but an empty tool_calls array —
  // toolCall is falsy, so the main pass's onMissingToolCall:'continue-as-unknown' branch
  // runs (else { toolInput = {} }), which must reset lastRoundMalformed to false. Without
  // that reset, exhaustion at MAX_TOOL_ROUNDS misreports the stale MALFORMED_TOOL_CALL flag
  // instead of the correct generic "reached step limit" completion.
  const create = vi.fn()
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tu1', type: 'function', function: { name: 'query_entity', arguments: '{not valid json' } },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    })
    .mockResolvedValue({
      finish_reason: 'tool_calls',
      message: { role: 'assistant', content: null, tool_calls: [] },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    });

  const events = await collect(agentChatHandler(REQ, baseDeps({ modelClient: { create } })));

  expect(create).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
  expect(events.find((e) => (e.payload as { error?: string })?.error === 'MALFORMED_TOOL_CALL')).toBeUndefined();
  expect(events.at(-1)).toMatchObject({
    type: 'status',
    payload: { status: 'completed' },
    text: expect.stringMatching(/step limit/i),
  });
});
