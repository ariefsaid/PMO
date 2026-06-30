/**
 * Tests for agentChatHandler — the pure async generator handler.
 * AC-AR-001: happy single-turn read (user → tool → assistant → completed).
 * AC-AR-002: empty userId → 401, no model call.
 * AC-AR-003: profiles lookup error → 400 BAD_REQUEST(orgId), no model call.
 * AC-AR-004: step cap → terminal completed (not errored), SDK called MAX_TOOL_ROUNDS times.
 * AC-AR-005: upstream SDK error scrubbed → UPSTREAM_ERROR, no prompt/data in log.
 *
 * All Anthropic SDK and Supabase calls are mocked via injected HandlerDeps.
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

/** Build base deps; anthropic and supabase can be overridden. */
function baseDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    anthropic: {
      messages: {
        create: vi.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'All done.' }],
          usage: {},
        }),
      },
    },
    supabase: mockOrgAnd(() => ({ data: [], error: null })),
    userId: 'user-1',
    now: () => new Date('2026-06-30T00:00:00Z'),
    ...overrides,
  };
}

// ── Task 10: AC-AR-002 + AC-AR-003 (gates before any model call) ──────────────

it('AC-AR-002 emits a single 401 status event and never calls Anthropic when userId is empty', async () => {
  const create = vi.fn();
  const events = await collect(
    agentChatHandler(REQ, baseDeps({ userId: '', anthropic: { messages: { create } } })),
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
    agentChatHandler(REQ, baseDeps({ supabase, anthropic: { messages: { create } } })),
  );
  expect(events.at(-1)).toMatchObject({
    type: 'status',
    payload: { status: 'errored', error: 'BAD_REQUEST', detail: 'orgId' },
  });
  expect(create).not.toHaveBeenCalled();
});

// ── Task 11: rate guard ────────────────────────────────────────────────────────

it('emits a 429 RATE_LIMITED terminal status and never calls Anthropic when the injected rateGuard reports exceeded', async () => {
  const create = vi.fn();
  const rateGuard = {
    check: vi.fn().mockResolvedValue({ exceeded: true, retryAfterSeconds: 3600 }),
  };
  const events = await collect(
    agentChatHandler(REQ, baseDeps({ rateGuard, anthropic: { messages: { create } } })),
  );
  expect(events.at(-1)).toMatchObject({
    type: 'status',
    payload: { status: 'errored', error: 'RATE_LIMITED', retryAfterSeconds: 3600 },
  });
  expect(create).not.toHaveBeenCalled();
});

it('rateGuard absent ⇒ proceeds to the model', async () => {
  const create = vi.fn().mockResolvedValue({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Done.' }],
    usage: {},
  });
  const events = await collect(
    agentChatHandler(REQ, baseDeps({ anthropic: { messages: { create } } })),
  );
  expect(create).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toMatchObject({ type: 'status', payload: { status: 'completed' } });
});

// ── Task 12: AC-AR-001 + AC-AR-004 (tool loop + step cap) ─────────────────────

it('AC-AR-001 dispatches query_entity then completes: user→tool→assistant→completed, SDK called exactly twice', async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'tu1', name: 'query_entity', input: { entity: 'projects' } },
      ],
      usage: {},
    })
    .mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'You have 3 active projects.' }],
      usage: {},
    });

  const supabase = mockOrgAnd(() => ({
    data: [{ id: '1' }, { id: '2' }, { id: '3' }],
    error: null,
  }));

  const events = await collect(agentChatHandler(REQ, baseDeps({ supabase, anthropic: { messages: { create } } })));

  expect(events.map((e) => e.type)).toEqual(['user', 'tool', 'assistant', 'status']);
  expect(events.at(-1)).toMatchObject({ type: 'status', payload: { status: 'completed' } });
  expect(create).toHaveBeenCalledTimes(2);
});

it('AC-AR-004 stops after MAX_TOOL_ROUNDS when the model never finalises, completing gracefully (R4/D7)', async () => {
  const create = vi.fn().mockResolvedValue({
    stop_reason: 'tool_use',
    content: [
      { type: 'tool_use', id: 'tu', name: 'query_entity', input: { entity: 'projects' } },
    ],
    usage: {},
  });
  const supabase = mockOrgAnd(() => ({ data: [], error: null }));

  const events = await collect(agentChatHandler(REQ, baseDeps({ supabase, anthropic: { messages: { create } } })));

  expect(create).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
  expect(events.at(-1)).toMatchObject({
    type: 'status',
    payload: { status: 'completed' },
    text: expect.stringMatching(/step limit/i),
  });
});

// ── Blocker 3: loop termination uses stop_reason !== 'tool_use'; max_tokens handled ──

it('terminates on stop_reason end_turn even when a tool_use block is accidentally present', async () => {
  // OLD CODE: `if (!toolBlock || resp.stop_reason === 'end_turn')` — the OR lets this complete
  // but the OLD code would also trigger completion even if there IS a toolBlock when
  // stop_reason is end_turn, silently skipping the tool. The correct sentinel is
  // stop_reason !== 'tool_use'.
  //
  // This test ensures: when stop_reason is 'end_turn' AND content has both text + a
  // spurious tool_use block, we complete (not dispatch the tool).
  const create = vi.fn().mockResolvedValue({
    stop_reason: 'end_turn',
    content: [
      { type: 'text', text: 'Final answer.' },
      // Spurious tool_use block with end_turn — model API won't do this, but if it did,
      // old code would complete (correct result via OR branch), new code does too (via !=tool_use).
      { type: 'tool_use', id: 'tu1', name: 'query_entity', input: { entity: 'projects' } },
    ],
    usage: {},
  });

  const events = await collect(agentChatHandler(REQ, baseDeps({ anthropic: { messages: { create } } })));
  // Must complete after 1 SDK call — do not dispatch tool on end_turn
  expect(create).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toMatchObject({ type: 'status', payload: { status: 'completed' } });
});

it('stop_reason max_tokens emits completed with truncation note (not silent)', async () => {
  // OLD CODE would emit a generic 'completed' indistinguishable from a real answer.
  // Fixed: emit completed with text 'response truncated'.
  const create = vi.fn().mockResolvedValue({
    stop_reason: 'max_tokens',
    content: [{ type: 'text', text: 'Partial answer...' }],
    usage: {},
  });

  const events = await collect(agentChatHandler(REQ, baseDeps({ anthropic: { messages: { create } } })));
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
      stop_reason: 'end_turn',
      content: [{ type: 'text', text }],
      usage: {},
    });

  const req1: AgentChatRequest = { runId: 'run-A', messages: [{ role: 'user', content: 'q1' }] };
  const req2: AgentChatRequest = { runId: 'run-B', messages: [{ role: 'user', content: 'q2' }] };

  const [evs1, evs2] = await Promise.all([
    collect(agentChatHandler(req1, baseDeps({ anthropic: { messages: { create: makeCreate('ans1') } } }))),
    collect(agentChatHandler(req2, baseDeps({ anthropic: { messages: { create: makeCreate('ans2') } } }))),
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
      baseDeps({ anthropic: { messages: { create } } }),
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
