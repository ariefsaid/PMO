/**
 * Tests for the compose_view integration in agentChatHandler.
 * AC-CV-001: compose_view tool in catalog when composeEnabled.
 * AC-CV-002: compose_view absent when composeEnabled is false.
 * AC-CV-003: successful compose emits artifact event after assistant text.
 * AC-CV-004: repair exhaustion → assistant error text, no artifact.
 * AC-CV-016: upstream error → assistant error text, no artifact.
 *
 * Uses the same harness as agentChatHandler.test.ts (baseDeps, mockOrgAnd).
 * ModelClient and composeSpec are fully mocked; no live LLM calls (ADR-0039 decision 7).
 * Mock shape: OpenRouter/OpenAI (ModelResponse) per docs/specs/agent-model-client.spec.md.
 */
import { it, expect, vi, beforeEach } from 'vitest';
import {
  agentChatHandler,
} from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest } from './runtime/transport';
import type { CompositionSpec } from '../viewspec/types';

// ── Mock runComposeView / composeSpec ──────────────────────────────────────────
// We mock at the actions module level so the handler's dispatch branch uses the mock.

vi.mock('../../../../supabase/functions/agent-chat/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../supabase/functions/agent-chat/actions')>();
  return {
    ...actual,
    runComposeView: vi.fn(),
  };
});

import { runComposeView as mockRunComposeView } from '../../../../supabase/functions/agent-chat/actions';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p1',
      primitive: 'KPITile',
      querySpec: {
        entity: 'projects',
        select: ['id'],
        aggregate: { fn: 'count', column: 'id', alias: 'count' },
      },
    },
  ],
};

const REQ_COMPOSE: AgentChatRequest = {
  messages: [{ role: 'user', content: 'show me active projects by status' }],
};

// ── Helpers (mirrored from agentChatHandler.test.ts) ─────────────────────────

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function mockOrgAnd(
  rowsFactory: () => { data: unknown[]; error: null },
): HandlerDeps['supabase'] {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1', role: 'Admin' }, error: null }),
              limit: vi.fn().mockResolvedValue({ data: [{ org_id: 'org-1' }], error: null }),
            }),
          }),
        };
      }
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

function baseDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    modelClient: {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'Done.' },
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

beforeEach(() => {
  vi.clearAllMocks();
});

// ── AC-CV-001: catalog includes compose_view when composeEnabled ──────────────

it('AC-CV-001 includes a compose_view tool with { prompt } input schema when composeEnabled', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'Sure!' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  await collect(
    agentChatHandler(
      REQ_COMPOSE,
      baseDeps({ modelClient: { create }, composeEnabled: true }),
    ),
  );

  expect(create).toHaveBeenCalledTimes(1);
  const callArgs = create.mock.calls[0][0];
  const tools = callArgs.tools as Array<{ type: string; function: { name: string; parameters: { required?: string[] } } }>;

  const composeTool = tools.find((t) => t.function.name === 'compose_view');
  expect(composeTool).toBeDefined();
  expect(composeTool!.function.parameters.required).toContain('prompt');

  // Catalog order: query_entity first, compose_view last (FR-CV-002 — "after existing actions")
  expect(tools[0].function.name).toBe('query_entity');
  expect(tools[tools.length - 1].function.name).toBe('compose_view');
});

// ── AC-CV-002: catalog omits compose_view when composeEnabled is false ─────────

it('AC-CV-002 omits compose_view from the catalog when composeEnabled is false', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'Sure!' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  await collect(
    agentChatHandler(
      REQ_COMPOSE,
      baseDeps({ modelClient: { create }, composeEnabled: false }),
    ),
  );

  const callArgs = create.mock.calls[0][0];
  const tools = callArgs.tools as Array<{ function: { name: string } }>;
  // compose_view must be absent from the catalog
  expect(tools.find((t) => t.function.name === 'compose_view')).toBeUndefined();
  // The base catalog (A1+A3 actions) is still present
  expect(tools.some((t) => t.function.name === 'query_entity')).toBe(true);
});

// ── AC-CV-003: successful compose emits artifact event ──────────────────────

it('AC-CV-003 emits an artifact event after assistant text and before completed on a successful compose', async () => {
  // Round 1: model uses compose_view tool (with text before it)
  // Round 2: model ends the turn
  const create = vi.fn()
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: "Here's a view:",
        tool_calls: [
          { id: 'tu-compose-1', type: 'function', function: { name: 'compose_view', arguments: JSON.stringify({ prompt: 'active projects by status' }) } },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    })
    .mockResolvedValueOnce({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'View composed!' },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    });

  vi.mocked(mockRunComposeView).mockResolvedValueOnce({
    spec: VALID_SPEC,
    repairAttempts: 0,
    tokensUsed: 320,
    title: 'Active projects by status',
  });

  const events = await collect(
    agentChatHandler(
      REQ_COMPOSE,
      baseDeps({ modelClient: { create }, composeEnabled: true }),
    ),
  );

  const types = events.map((e) => e.type);

  // Must include exactly one artifact event
  const artifactEvents = events.filter((e) => e.type === 'artifact');
  expect(artifactEvents).toHaveLength(1);

  const artifact = artifactEvents[0];
  expect(artifact.payload).toMatchObject({
    kind: 'compose_view',
    spec: VALID_SPEC,
    repairAttempts: 0,
    title: 'Active projects by status',
  });

  // Artifact appears after the assistant text event and before completed (FR-CV-008)
  const assistantIdx = events.findIndex((e) => e.type === 'assistant' && e.text === "Here's a view:");
  const artifactIdx = events.findIndex((e) => e.type === 'artifact');
  const completedIdx = events.findIndex((e) => e.type === 'status' && (e.payload as { status: string }).status === 'completed');

  expect(assistantIdx).toBeGreaterThanOrEqual(0);
  expect(artifactIdx).toBeGreaterThan(assistantIdx);
  expect(completedIdx).toBeGreaterThan(artifactIdx);

  // No errored event
  expect(types).not.toContain('errored');
});

// ── AC-CV-004: repair exhaustion → assistant error, no artifact ─────────────

it('AC-CV-004 emits an assistant error event (not an artifact) when compose exhausts repair', async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tu-compose-2', type: 'function', function: { name: 'compose_view', arguments: JSON.stringify({ prompt: 'x' }) } },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    })
    .mockResolvedValueOnce({
      finish_reason: 'stop',
      message: { role: 'assistant', content: "I couldn't help with that." },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    });

  vi.mocked(mockRunComposeView).mockResolvedValueOnce({
    error: 'compose failed',
    code: 'REPAIR_EXHAUSTED',
  });

  const events = await collect(
    agentChatHandler(
      REQ_COMPOSE,
      baseDeps({ modelClient: { create }, composeEnabled: true }),
    ),
  );

  // No artifact events
  expect(events.filter((e) => e.type === 'artifact')).toHaveLength(0);

  // An assistant text event with the user-facing error message (FR-CV-006)
  const assistantEvents = events.filter((e) => e.type === 'assistant');
  expect(assistantEvents.some((e) => /wasn.t able to compose|try rephrasing/i.test(e.text ?? ''))).toBe(true);

  // Terminal completed (not errored — FR-CV-006)
  const last = events.at(-1)!;
  expect(last.type).toBe('status');
  expect((last.payload as { status: string }).status).toBe('completed');
});

// ── AC-CV-016: upstream error → assistant error text, no artifact ────────────

it('AC-CV-016 emits an assistant error event (not an artifact) on an upstream compose error', async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tu-compose-3', type: 'function', function: { name: 'compose_view', arguments: JSON.stringify({ prompt: 'y' }) } },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    })
    .mockResolvedValueOnce({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Sorry.' },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    });

  vi.mocked(mockRunComposeView).mockResolvedValueOnce({
    error: 'compose failed',
    code: 'UPSTREAM_ERROR',
  });

  const events = await collect(
    agentChatHandler(
      REQ_COMPOSE,
      baseDeps({ modelClient: { create }, composeEnabled: true }),
    ),
  );

  // No artifact events
  expect(events.filter((e) => e.type === 'artifact')).toHaveLength(0);

  // An assistant error text
  const assistantEvents = events.filter((e) => e.type === 'assistant');
  expect(assistantEvents.some((e) => /wasn.t able to compose|try rephrasing/i.test(e.text ?? ''))).toBe(true);

  // Terminal completed
  const last = events.at(-1)!;
  expect(last.type).toBe('status');
  expect((last.payload as { status: string }).status).toBe('completed');
});
