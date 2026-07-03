/**
 * Unit tests for composeViewHandler — the pure handler for the compose-view edge function.
 * All ModelClient and Supabase calls are mocked via injected deps (OpenRouter/OpenAI
 * shape — docs/specs/agent-model-client.spec.md).
 * AC-### tags in each it() title are the traceability anchors (ADR-0010).
 *
 * ADR-0039 decision 7: handler is a pure module importable in Vitest with the model
 * client mocked.
 * Reconciliation #1: compileCompositionSpec throws (fail-fast); the loop feeds single error.
 * Reconciliation #4: org_id derived from profiles under caller JWT, not JWT claims.
 */
import { it, expect, vi } from 'vitest';
import {
  composeViewHandler,
  MAX_REPAIR_ATTEMPTS,
} from '../../../../supabase/functions/compose-view/handler';
import type { HandlerDeps } from '../../../../supabase/functions/compose-view/handler';
import type { ComposeViewRequest } from '../agent/types';
import type { CompositionSpec } from '../viewspec/types';

// ── Valid spec fixtures ────────────────────────────────────────────────────────

/** A single KPITile panel on projects — no requiredFilter entity. Passes compileCompositionSpec. */
const VALID_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'panel-1',
      primitive: 'KPITile',
      querySpec: {
        entity: 'projects',
        select: ['id', 'name', 'contract_value'],
        aggregate: { fn: 'sum', column: 'contract_value', alias: 'total' },
      },
    },
  ],
};

/** A tasks panel with a valid project_id filter (required filter satisfied). */
const VALID_SPEC_WITH_TASKS: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'panel-tasks',
      primitive: 'DataTable',
      querySpec: {
        entity: 'tasks',
        select: ['id', 'name', 'status'],
        filters: [{ column: 'project_id', op: 'eq', value: 'proj-1' }],
      },
    },
  ],
};

/** Invalid: tasks panel with NO project_id filter → MISSING_REQUIRED_FILTER. */
const INVALID_SPEC_TASKS_NO_FILTER: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'panel-bad',
      primitive: 'DataTable',
      querySpec: {
        entity: 'tasks',
        select: ['id', 'name', 'status'],
        // Missing required project_id filter
      },
    },
  ],
};

// Note: INVALID_SPEC_UNKNOWN_ENTITY tested in clientValidation.test.ts (AC-AS-020);
// the handler's gate for unknown-entity is covered by the repair loop reaching
// MISSING_REQUIRED_FILTER in AC-AS-002/003 above.

// ── Mock builder helpers ───────────────────────────────────────────────────────

/**
 * Build a mock ModelClient whose create() resolves a tool_calls entry
 * carrying the given spec (OpenRouter/OpenAI shape).
 */
function mockModelClientReturning(spec: CompositionSpec) {
  return {
    create: vi.fn().mockResolvedValue({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'compose_view', arguments: JSON.stringify(spec) } }],
      },
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      model: 'deepseek/deepseek-v4-flash',
    }),
  };
}

/**
 * Build a mock ModelClient that returns specSequence[i] on the i-th call.
 */
function mockModelClientSequence(specs: (CompositionSpec | 'throw')[]) {
  let callCount = 0;
  const createFn = vi.fn().mockImplementation(() => {
    const idx = callCount++;
    const item = specs[idx];
    if (item === 'throw') {
      return Promise.reject(new Error('SECRET model 500 body'));
    }
    return Promise.resolve({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: `c${idx}`, type: 'function', function: { name: 'compose_view', arguments: JSON.stringify(item) } }],
      },
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      model: 'deepseek/deepseek-v4-flash',
    });
  });
  return { create: createFn, _createFn: createFn };
}

/**
 * Build a mock SupabaseLike that returns the given org_id from profiles lookup.
 */
function mockSupabaseWithOrg(orgId: string) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { org_id: orgId },
            error: null,
          }),
        }),
      }),
    }),
  };
}

/** Base valid request */
const BASE_REQ: ComposeViewRequest = {
  prompt: 'show projects',
  orgId: 'org-1',
};

/** Base deps (modelClient and supabase get overridden per test) */
function baseDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    modelClient: mockModelClientReturning(VALID_SPEC),
    model: 'deepseek/deepseek-v4-flash',
    supabase: mockSupabaseWithOrg('org-1'),
    userId: 'u-1',
    ...overrides,
  };
}

// ── Task 7 — AC-AS-001: happy path ────────────────────────────────────────────

it('AC-AS-001 returns {spec, repairAttempts:0} and calls the model exactly once on first-pass valid spec', async () => {
  const modelClient = mockModelClientReturning(VALID_SPEC);
  const result = await composeViewHandler(BASE_REQ, baseDeps({ modelClient }));

  expect(result.status).toBe(200);
  if (result.status === 200) {
    expect(result.body.repairAttempts).toBe(0);
    expect(result.body.spec).toEqual(VALID_SPEC);
  }
  expect(modelClient.create).toHaveBeenCalledTimes(1);
});

// ── Task 9 — AC-AS-002: repair loop ───────────────────────────────────────────

it('AC-AS-002 returns repairAttempts:1 and feeds the attempt-1 ValidationError code/detail back to the model', async () => {
  // First call returns invalid spec (MISSING_REQUIRED_FILTER), second returns valid
  const { create, _createFn } = mockModelClientSequence([
    INVALID_SPEC_TASKS_NO_FILTER,
    VALID_SPEC_WITH_TASKS,
  ]);
  const modelClient = { create };

  const result = await composeViewHandler(BASE_REQ, baseDeps({ modelClient }));

  expect(result.status).toBe(200);
  if (result.status === 200) {
    expect(result.body.repairAttempts).toBe(1);
  }
  expect(_createFn).toHaveBeenCalledTimes(2);

  // The SECOND call's messages array must include the error code in the last user message
  const secondCallArgs = _createFn.mock.calls[1][0];
  const userMessages = secondCallArgs.messages.filter((m: { role: string }) => m.role === 'user');
  const errorMessage = userMessages[userMessages.length - 1];
  expect(errorMessage.content).toContain('MISSING_REQUIRED_FILTER');
});

// ── Task 10 — AC-AS-003: repair exhausted → 422 ───────────────────────────────

it('AC-AS-003 returns 422 REPAIR_EXHAUSTED with the last validationError after MAX_REPAIR_ATTEMPTS', async () => {
  // Always returns invalid spec
  const { create, _createFn } = mockModelClientSequence(
    Array(MAX_REPAIR_ATTEMPTS + 1).fill(INVALID_SPEC_TASKS_NO_FILTER),
  );

  const result = await composeViewHandler(BASE_REQ, baseDeps({ modelClient: { create } }));

  expect(result.status).toBe(422);
  if (result.status === 422) {
    expect(result.body.error).toBe('REPAIR_EXHAUSTED');
    expect(result.body.repairAttempts).toBe(MAX_REPAIR_ATTEMPTS);
    expect(result.body.validationError?.code).toBe('MISSING_REQUIRED_FILTER');
  }
  // Should have been called MAX_REPAIR_ATTEMPTS + 1 times
  expect(_createFn).toHaveBeenCalledTimes(MAX_REPAIR_ATTEMPTS + 1);
});

// ── Task 11 — AC-AS-008: rate guard ───────────────────────────────────────────

it('AC-AS-008 returns 429 RATE_LIMITED without calling the model when the injected rateGuard reports exceeded', async () => {
  const modelClient = mockModelClientReturning(VALID_SPEC);
  const rateGuard = {
    check: vi.fn().mockResolvedValue({ exceeded: true, retryAfterSeconds: 3600 }),
  };

  const result = await composeViewHandler(BASE_REQ, baseDeps({ modelClient, rateGuard }));

  expect(result.status).toBe(429);
  if (result.status === 429) {
    expect(result.body.error).toBe('RATE_LIMITED');
    expect(result.body.retryAfterSeconds).toBe(3600);
  }
  expect(modelClient.create).not.toHaveBeenCalled();
});

it('rate guard absent ⇒ no 429, model is called', async () => {
  const modelClient = mockModelClientReturning(VALID_SPEC);
  // No rateGuard injected
  const result = await composeViewHandler(BASE_REQ, baseDeps({ modelClient, rateGuard: undefined }));

  expect(result.status).toBe(200);
  expect(modelClient.create).toHaveBeenCalledTimes(1);
});

// ── Task 12 — AC-AS-004, 005, 006, 007: gates ────────────────────────────────

it('AC-AS-004 returns 401 without calling the model when userId is empty', async () => {
  const modelClient = mockModelClientReturning(VALID_SPEC);

  const result = await composeViewHandler(BASE_REQ, baseDeps({ modelClient, userId: '' }));

  expect(result.status).toBe(401);
  if (result.status === 401) {
    expect(result.body.error).toBe('UNAUTHORIZED');
  }
  expect(modelClient.create).not.toHaveBeenCalled();
});

it('AC-AS-005 returns 400 without calling the model when body orgId ≠ profile org_id', async () => {
  const modelClient = mockModelClientReturning(VALID_SPEC);
  // Profile returns org-2 but request says org-1
  const supabase = mockSupabaseWithOrg('org-2');

  const result = await composeViewHandler(BASE_REQ, baseDeps({ modelClient, supabase }));

  expect(result.status).toBe(400);
  if (result.status === 400) {
    expect(result.body.error).toBe('BAD_REQUEST');
    expect(result.body.detail).toBe('orgId');
  }
  expect(modelClient.create).not.toHaveBeenCalled();
});

it('AC-AS-006 returns 400 without calling the model when prompt > 2000 chars', async () => {
  const modelClient = mockModelClientReturning(VALID_SPEC);
  const longPromptReq: ComposeViewRequest = {
    prompt: 'x'.repeat(2001),
    orgId: 'org-1',
  };

  const result = await composeViewHandler(longPromptReq, baseDeps({ modelClient }));

  expect(result.status).toBe(400);
  if (result.status === 400) {
    expect(result.body.error).toBe('BAD_REQUEST');
    expect(result.body.detail).toBe('prompt');
  }
  expect(modelClient.create).not.toHaveBeenCalled();
});

it('AC-AS-007 AC-MC-016 returns 502 UPSTREAM_ERROR and hides the raw model error', async () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  // Model call throws with a secret message
  const RAW_UPSTREAM_MARKER = 'SECRET model 500 body';
  const modelClient = {
    create: vi.fn().mockRejectedValue(new Error(RAW_UPSTREAM_MARKER)),
  };

  const result = await composeViewHandler(BASE_REQ, baseDeps({ modelClient }));

  expect(result.status).toBe(502);
  if (result.status === 502) {
    expect(result.body.error).toBe('UPSTREAM_ERROR');
    // Must NOT expose the raw error
    expect(JSON.stringify(result.body)).not.toContain('SECRET');
  }

  // Verify console.error was not called with req.prompt (NFR-AS-SEC-004)
  for (const call of consoleErrorSpy.mock.calls) {
    expect(JSON.stringify(call)).not.toContain('show projects');
  }

  // AC-MC-016: the raw upstream error text must never appear in ANY console call
  // (error/warn/log) — not just the response body (NFR-MC-SEC-004).
  for (const spy of [consoleErrorSpy, consoleWarnSpy, consoleLogSpy]) {
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(RAW_UPSTREAM_MARKER);
    }
  }

  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  consoleLogSpy.mockRestore();
});
