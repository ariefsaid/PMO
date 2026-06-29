/**
 * Unit tests for composeViewHandler — the pure handler for the compose-view edge function.
 * All Anthropic SDK and Supabase calls are mocked via injected deps.
 * AC-### tags in each it() title are the traceability anchors (ADR-0010).
 *
 * ADR-0039 decision 7: handler is a pure module importable in Vitest with SDK mocked.
 * Reconciliation #1: compileCompositionSpec throws (fail-fast); the loop feeds single error.
 * Reconciliation #4: org_id derived from profiles under caller JWT, not JWT claims.
 */
import { it, expect, vi, beforeEach } from 'vitest';
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

/** Invalid: unknown entity */
const INVALID_SPEC_UNKNOWN_ENTITY = {
  version: 1,
  panels: [
    {
      id: 'panel-bad',
      primitive: 'DataTable',
      querySpec: {
        entity: 'secrets',
        select: ['id'],
      },
    },
  ],
} as unknown as CompositionSpec;

// ── Mock builder helpers ───────────────────────────────────────────────────────

/**
 * Build a mock AnthropicLike whose messages.create resolves a tool_use block
 * carrying the given spec.
 */
function mockAnthropicReturning(spec: CompositionSpec) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'compose_view', input: spec }],
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
    },
  };
}

/**
 * Build a mock AnthropicLike that returns specSequence[i] on the i-th call.
 */
function mockAnthropicSequence(specs: (CompositionSpec | 'throw')[]) {
  let callCount = 0;
  const createFn = vi.fn().mockImplementation(() => {
    const idx = callCount++;
    const item = specs[idx];
    if (item === 'throw') {
      return Promise.reject(new Error('SECRET anthropic 500 body'));
    }
    return Promise.resolve({
      content: [{ type: 'tool_use', name: 'compose_view', input: item }],
      usage: { input_tokens: 100, output_tokens: 200 },
    });
  });
  return { messages: { create: createFn }, _createFn: createFn };
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

/** Base deps (anthropic and supabase get overridden per test) */
function baseDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    anthropic: mockAnthropicReturning(VALID_SPEC),
    supabase: mockSupabaseWithOrg('org-1'),
    userId: 'u-1',
    ...overrides,
  };
}

// ── Task 7 — AC-AS-001: happy path ────────────────────────────────────────────

it('AC-AS-001 returns {spec, repairAttempts:0} and calls Anthropic exactly once on first-pass valid spec', async () => {
  const anthropic = mockAnthropicReturning(VALID_SPEC);
  const result = await composeViewHandler(BASE_REQ, baseDeps({ anthropic }));

  expect(result.status).toBe(200);
  if (result.status === 200) {
    expect(result.body.repairAttempts).toBe(0);
    expect(result.body.spec).toEqual(VALID_SPEC);
  }
  expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
});

// ── Task 9 — AC-AS-002: repair loop ───────────────────────────────────────────

it('AC-AS-002 returns repairAttempts:1 and feeds the attempt-1 ValidationError code/detail back to the model', async () => {
  // First call returns invalid spec (MISSING_REQUIRED_FILTER), second returns valid
  const { messages, _createFn } = mockAnthropicSequence([
    INVALID_SPEC_TASKS_NO_FILTER,
    VALID_SPEC_WITH_TASKS,
  ]);
  const anthropic = { messages };

  const result = await composeViewHandler(BASE_REQ, baseDeps({ anthropic }));

  expect(result.status).toBe(200);
  if (result.status === 200) {
    expect(result.body.repairAttempts).toBe(1);
  }
  expect(_createFn).toHaveBeenCalledTimes(2);

  // The SECOND call's messages array must include the error code
  const secondCallArgs = _createFn.mock.calls[1][0];
  const userMessages = secondCallArgs.messages.filter((m: { role: string }) => m.role === 'user');
  const errorMessage = userMessages[userMessages.length - 1];
  expect(errorMessage.content).toContain('MISSING_REQUIRED_FILTER');
});

// ── Task 10 — AC-AS-003: repair exhausted → 422 ───────────────────────────────

it('AC-AS-003 returns 422 REPAIR_EXHAUSTED with the last validationError after MAX_REPAIR_ATTEMPTS', async () => {
  // Always returns invalid spec
  const { messages, _createFn } = mockAnthropicSequence(
    Array(MAX_REPAIR_ATTEMPTS + 1).fill(INVALID_SPEC_TASKS_NO_FILTER),
  );

  const result = await composeViewHandler(BASE_REQ, baseDeps({ anthropic: { messages } }));

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

it('AC-AS-008 returns 429 RATE_LIMITED without calling Anthropic when the injected rateGuard reports exceeded', async () => {
  const anthropic = mockAnthropicReturning(VALID_SPEC);
  const rateGuard = {
    check: vi.fn().mockResolvedValue({ exceeded: true, retryAfterSeconds: 3600 }),
  };

  const result = await composeViewHandler(BASE_REQ, baseDeps({ anthropic, rateGuard }));

  expect(result.status).toBe(429);
  if (result.status === 429) {
    expect(result.body.error).toBe('RATE_LIMITED');
    expect(result.body.retryAfterSeconds).toBe(3600);
  }
  expect(anthropic.messages.create).not.toHaveBeenCalled();
});

it('rate guard absent ⇒ no 429, model is called', async () => {
  const anthropic = mockAnthropicReturning(VALID_SPEC);
  // No rateGuard injected
  const result = await composeViewHandler(BASE_REQ, baseDeps({ anthropic, rateGuard: undefined }));

  expect(result.status).toBe(200);
  expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
});

// ── Task 12 — AC-AS-004, 005, 006, 007: gates ────────────────────────────────

it('AC-AS-004 returns 401 without calling Anthropic when userId is empty', async () => {
  const anthropic = mockAnthropicReturning(VALID_SPEC);

  const result = await composeViewHandler(BASE_REQ, baseDeps({ anthropic, userId: '' }));

  expect(result.status).toBe(401);
  if (result.status === 401) {
    expect(result.body.error).toBe('UNAUTHORIZED');
  }
  expect(anthropic.messages.create).not.toHaveBeenCalled();
});

it('AC-AS-005 returns 400 without calling Anthropic when body orgId ≠ profile org_id', async () => {
  const anthropic = mockAnthropicReturning(VALID_SPEC);
  // Profile returns org-2 but request says org-1
  const supabase = mockSupabaseWithOrg('org-2');

  const result = await composeViewHandler(BASE_REQ, baseDeps({ anthropic, supabase }));

  expect(result.status).toBe(400);
  if (result.status === 400) {
    expect(result.body.error).toBe('BAD_REQUEST');
    expect(result.body.detail).toBe('orgId');
  }
  expect(anthropic.messages.create).not.toHaveBeenCalled();
});

it('AC-AS-006 returns 400 without calling Anthropic when prompt > 2000 chars', async () => {
  const anthropic = mockAnthropicReturning(VALID_SPEC);
  const longPromptReq: ComposeViewRequest = {
    prompt: 'x'.repeat(2001),
    orgId: 'org-1',
  };

  const result = await composeViewHandler(longPromptReq, baseDeps({ anthropic }));

  expect(result.status).toBe(400);
  if (result.status === 400) {
    expect(result.body.error).toBe('BAD_REQUEST');
    expect(result.body.detail).toBe('prompt');
  }
  expect(anthropic.messages.create).not.toHaveBeenCalled();
});

it('AC-AS-007 returns 502 UPSTREAM_ERROR and hides the raw SDK error', async () => {
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  // Anthropic SDK throws with a secret message
  const anthropic = {
    messages: {
      create: vi.fn().mockRejectedValue(new Error('SECRET anthropic 500 body')),
    },
  };

  const result = await composeViewHandler(BASE_REQ, baseDeps({ anthropic }));

  expect(result.status).toBe(502);
  if (result.status === 502) {
    expect(result.body.error).toBe('UPSTREAM_ERROR');
    // Must NOT expose the raw error
    expect(JSON.stringify(result.body)).not.toContain('SECRET');
  }

  // Verify console.error was not called with req.prompt (NFR-AS-SEC-004)
  for (const call of consoleSpy.mock.calls) {
    expect(JSON.stringify(call)).not.toContain('show projects');
  }

  consoleSpy.mockRestore();
});
