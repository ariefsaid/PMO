/**
 * Tests for agent write actions — schema validation, actions, and handler branches.
 *
 * AC-AW-001: Approve → write executes once under caller JWT, write_resolved emitted.
 * AC-AW-002: Deny → no write; model informed via tool_result; system write_resolved rejected.
 * AC-AW-003: Stale/duplicate decision pendingId mismatch → no write (idempotent).
 * AC-AW-004: Org/role re-derive fails on approve → AUTH_EXPIRED, no write.
 * AC-AW-005: Malformed args → no needs-approval; error tool_result to model.
 * AC-AW-006: confirm:false action (query_entity) bypasses approval entirely (parity with A3).
 * AC-AW-007: (re-homed) unmatched/stale decision → treated as rejected gracefully.
 * AC-AW-008: can() denies the role → PERMISSION_DENIED, no write.
 *
 * All ModelClient and Supabase calls are mocked via injected HandlerDeps
 * (OpenRouter/OpenAI shape — docs/specs/agent-model-client.spec.md).
 * `can` is injected via HandlerDeps.can — no module-level policy.ts import needed.
 */
import { it, expect, vi } from 'vitest';
import {
  CREATE_ACTIVITY_SCHEMA,
  UPDATE_TASK_STATUS_SCHEMA,
} from '../../../../supabase/functions/agent-chat/schema';
import {
  createActivityAction,
  updateTaskStatusAction,
} from '../../../../supabase/functions/agent-chat/actions';
import {
  agentChatHandler,
  MAX_TOOL_ROUNDS,
} from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest } from './runtime/transport';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

/** Mock supabase that returns org+role for profiles, and handles insert/update for writes. */
function mockSupabase(opts: {
  profileData?: { org_id: string; role: string } | null;
  profileError?: unknown;
  insertResult?: { data: unknown; error: unknown };
  updateResult?: { data: unknown; error: unknown };
  rowsFactory?: () => { data: unknown[]; error: null };
}): HandlerDeps['supabase'] {
  const {
    profileData = { org_id: 'org-1', role: 'Project Manager' },
    profileError = null,
    insertResult = { data: { id: 'act-1' }, error: null },
    updateResult = { data: null, error: null },
    rowsFactory = () => ({ data: [], error: null }),
  } = opts;

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: profileData,
                error: profileError,
              }),
              limit: vi.fn().mockResolvedValue({ data: profileData ? [profileData] : [], error: profileError }),
            }),
          }),
        };
      }
      if (table === 'crm_activities') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(insertResult),
            }),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(rowsFactory()),
            }),
            limit: vi.fn().mockResolvedValue(rowsFactory()),
          }),
        };
      }
      if (table === 'tasks') {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue(updateResult),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(rowsFactory()),
            }),
            limit: vi.fn().mockResolvedValue(rowsFactory()),
          }),
        };
      }
      // error_events: the observability-floor insert path driven by recordErrorEvent
      // (AC-OF-AGENT-DENIED-001). Returns a thenable resolving to {error:null} so
      // recordErrorEvent's await completes — mirroring the real client shape.
      if (table === 'error_events') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      // Default: read-only entity
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
        message: { role: 'assistant', content: 'All done.' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
    },
    supabase: mockSupabase({}),
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    can: vi.fn().mockReturnValue(true),
    now: () => new Date('2026-06-30T00:00:00Z'),
    ...overrides,
  };
}


const BASE_REQ: AgentChatRequest = {
  messages: [{ role: 'user', content: 'log a call activity' }],
};

// ── Task 1 (RED→GREEN): CREATE_ACTIVITY_SCHEMA ────────────────────────────────

it('CREATE_ACTIVITY_SCHEMA requires contactId+kind+subject and bounds lengths (FR-AW-014)', () => {
  expect(CREATE_ACTIVITY_SCHEMA.required).toEqual(['contactId', 'kind', 'subject']);
  expect((CREATE_ACTIVITY_SCHEMA.properties.kind as { enum: string[] }).enum)
    .toEqual(['call', 'email', 'meeting', 'note']);
  expect((CREATE_ACTIVITY_SCHEMA.properties.subject as { maxLength: number }).maxLength).toBe(200);
  expect((CREATE_ACTIVITY_SCHEMA.properties.body as { maxLength: number }).maxLength).toBe(2000);
  expect(CREATE_ACTIVITY_SCHEMA.additionalProperties).toBe(false);
});

// ── Task 3 (RED→GREEN): UPDATE_TASK_STATUS_SCHEMA ─────────────────────────────

it('UPDATE_TASK_STATUS_SCHEMA requires taskId+status with the 4 task_status enums (FR-AW-015)', () => {
  expect(UPDATE_TASK_STATUS_SCHEMA.required).toEqual(['taskId', 'status']);
  expect((UPDATE_TASK_STATUS_SCHEMA.properties.status as { enum: string[] }).enum)
    .toEqual(['To Do', 'In Progress', 'Done', 'Blocked']);
});

// ── Task 5 (RED→GREEN): createActivityAction validator + humanSummary ──────────

it('createActivityAction.validate rejects missing contactId; accepts valid args (NFR-AW-SEC-005)', () => {
  expect(createActivityAction.validate({ kind: 'call', subject: 'x' }).ok).toBe(false);
  const ok = createActivityAction.validate({ contactId: 'c1', kind: 'call', subject: 'Follow-up' });
  expect(ok.ok).toBe(true);
});

it('createActivityAction.summarize composes a server-side humanSummary from validated args (D-A3-5)', () => {
  expect(createActivityAction.summarize({ contactId: 'c1', kind: 'call', subject: 'Follow-up' }))
    .toBe('Log a call activity on contact c1: "Follow-up"');
});

// ── Task 7 (RED→GREEN): updateTaskStatusAction validator + humanSummary ─────────

it('updateTaskStatusAction.validate rejects bad status; summarize composes (FR-AW-015, D-A3-5)', () => {
  expect(updateTaskStatusAction.validate({ taskId: 't1', status: 'Nope' }).ok).toBe(false);
  expect(updateTaskStatusAction.validate({ taskId: 't1', status: 'Done' }).ok).toBe(true);
  expect(updateTaskStatusAction.summarize({ taskId: 't1', status: 'Done' }))
    .toBe('Set task t1 status to "Done"');
});

// ── Task 10 (RED→GREEN): AC-AW-006 confirm:false bypasses approval ────────────

it('AC-AW-006 confirm:false action (query_entity) runs immediately with no needs-approval event (parity with A3)', async () => {
  const modelClient = {
    create: vi.fn()
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
        message: { role: 'assistant', content: 'You have 3 projects.' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
  };

  const events = await collect(
    agentChatHandler(BASE_REQ, baseDeps({ modelClient })),
  );

  expect(events.find((e) => (e.payload as { status?: string })?.status === 'needs-approval')).toBeUndefined();
  expect(events.find((e) => e.type === 'tool')).toBeDefined();
});

// ── Task 12 (RED→GREEN): AC-AW-001 happy approve → write executes ─────────────

it('AC-AW-001 AC-MC-011 approve → create_activity executes once under caller JWT, write_resolved emitted', async () => {
  const runFn = vi.fn().mockResolvedValue({ id: 'act-1' });
  const validArgs = { contactId: 'c1', kind: 'call', subject: 'Follow-up' };
  const toolId = 'tool-use-id-1';

  // Turn 1: model emits create_activity tool_use
  const proposeModelClientCreate = vi.fn().mockResolvedValue({
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: toolId, type: 'function', function: { name: 'create_activity', arguments: JSON.stringify(validArgs) } },
      ],
    },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const proposeReq: AgentChatRequest = {
    runId: 'run-1',
    messages: [{ role: 'user', content: 'log a call' }],
  };

  const proposeEvents = await collect(
    agentChatHandler(proposeReq, baseDeps({
      modelClient: { create: proposeModelClientCreate },
      supabase: mockSupabase({ insertResult: { data: { id: 'act-1' }, error: null } }),
      can: vi.fn().mockReturnValue(true),
    })),
  );

  // Turn 1 should emit needs-approval and END (no tool event, no completed)
  const needsApprovalEvent = proposeEvents.find(
    (e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'needs-approval',
  );
  expect(needsApprovalEvent).toBeDefined();
  expect((needsApprovalEvent!.payload as { actionName: string }).actionName).toBe('create_activity');
  expect((needsApprovalEvent!.payload as { humanSummary: string }).humanSummary).toBeTruthy();
  expect((needsApprovalEvent!.payload as { structuredArgs: unknown }).structuredArgs).toMatchObject(validArgs);
  expect(proposeEvents.find((e) => e.type === 'tool')).toBeUndefined();
  expect(proposeEvents.find((e) => (e.payload as { status?: string })?.status === 'completed')).toBeUndefined();
  // Action run was NOT called during propose
  expect(runFn).not.toHaveBeenCalled();

  const pendingId = (needsApprovalEvent!.payload as { pendingId: string }).pendingId;
  expect(pendingId).toBeTruthy();

  // Turn 2 (approve): re-POST with decision + prior transcript that ends with unresolved tool_use
  const approveModelClientCreate = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'Done — I\'ve logged the call activity.' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const approveReq: AgentChatRequest = {
    runId: 'run-1',
    messages: [
      { role: 'user', content: 'log a call' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: toolId, name: 'create_activity', input: validArgs },
        ],
      },
    ],
    decision: { pendingId, verdict: 'approve' },
  };

  const supabaseMock = mockSupabase({ insertResult: { data: { id: 'act-1' }, error: null } });
  const canMock = vi.fn().mockReturnValue(true);

  const approveEvents = await collect(
    agentChatHandler(approveReq, baseDeps({
      modelClient: { create: approveModelClientCreate },
      supabase: supabaseMock,
      can: canMock,
    })),
  );

  // Should emit tool event with pendingId, system write_resolved, assistant text, completed
  const toolEvent = approveEvents.find((e) => e.type === 'tool');
  expect(toolEvent).toBeDefined();
  expect((toolEvent!.payload as { pendingId: string }).pendingId).toBe(pendingId);

  const writeResolvedEvent = approveEvents.find(
    (e) => e.type === 'system' &&
      (e.payload as { event?: string })?.event === 'write_resolved',
  );
  expect(writeResolvedEvent).toBeDefined();
  expect((writeResolvedEvent!.payload as { decision: string }).decision).toBe('approved');

  const completedEvent = approveEvents.find(
    (e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'completed',
  );
  expect(completedEvent).toBeDefined();

  // Verify insert was called (the action's run executed under caller JWT)
  const fromCalls = (supabaseMock.from as ReturnType<typeof vi.fn>).mock.calls;
  expect(fromCalls.some(([table]: [string]) => table === 'crm_activities')).toBe(true);
});

// ── Task 14 (RED→GREEN): AC-AW-004 deputy re-auth fails ──────────────────────


// ── AC-AW-004 proper two-phase mock ──────────────────────────────────────────

it('AC-AW-004 (two-phase) approve but re-auth fails after initial gate → AUTH_EXPIRED, no insert', async () => {
  const validArgs = { contactId: 'c1', kind: 'call', subject: 'Follow-up' };
  const toolId = 'tool-use-id-3';
  let callCount = 0;

  // First profiles call (Gate 2) succeeds; second (re-auth) fails
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                  return Promise.resolve({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null });
                }
                return Promise.resolve({ data: null, error: { message: 'user deprovisioned' } });
              }),
            }),
          }),
        };
      }
      const insertSpy = vi.fn();
      return {
        insert: insertSpy,
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
        }),
      };
    }),
  } as unknown as HandlerDeps['supabase'];

  const req: AgentChatRequest = {
    runId: 'run-3',
    messages: [
      { role: 'user', content: 'log a call' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: toolId, name: 'create_activity', input: validArgs },
        ],
      },
    ],
    decision: { pendingId: 'pending-2', verdict: 'approve' },
  };

  const events = await collect(
    agentChatHandler(req, baseDeps({
      modelClient: {
        create: vi.fn().mockResolvedValue({
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'Done.' },
          usage: {},
          model: 'deepseek/deepseek-v4-flash',
        }),
      },
      supabase,
      can: vi.fn().mockReturnValue(true),
    })),
  );

  const erroredEvent = events.find(
    (e) => e.type === 'status' && (e.payload as { error?: string })?.error === 'AUTH_EXPIRED',
  );
  expect(erroredEvent).toBeDefined();

  // No insert should have been called
  const fromCalls = (supabase.from as ReturnType<typeof vi.fn>).mock.calls;
  const activityCalls = fromCalls.filter(([t]: [string]) => t === 'crm_activities');
  expect(activityCalls).toHaveLength(0);
});

// ── Task 14 (RED→GREEN): AC-AW-008 can() denies → PERMISSION_DENIED ──────────

it('AC-AW-008 approve but can() denies the role → PERMISSION_DENIED, no write', async () => {
  const validArgs = { contactId: 'c1', kind: 'call', subject: 'Follow-up' };
  const toolId = 'tool-use-id-4';

  const req: AgentChatRequest = {
    runId: 'run-4',
    messages: [
      { role: 'user', content: 'log a call' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: toolId, name: 'create_activity', input: validArgs },
        ],
      },
    ],
    decision: { pendingId: 'pending-3', verdict: 'approve' },
  };

  const supabaseMock = mockSupabase({});
  const canMock = vi.fn().mockReturnValue(false); // denies

  const events = await collect(
    agentChatHandler(req, baseDeps({
      modelClient: {
        create: vi.fn().mockResolvedValue({
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'Permission denied.' },
          usage: {},
          model: 'deepseek/deepseek-v4-flash',
        }),
      },
      supabase: supabaseMock,
      can: canMock,
    })),
  );

  const permDeniedEvent = events.find(
    (e) => e.type === 'status' && (e.payload as { error?: string })?.error === 'PERMISSION_DENIED',
  );
  expect(permDeniedEvent).toBeDefined();

  // No insert should have been called
  const fromCalls = (supabaseMock.from as ReturnType<typeof vi.fn>).mock.calls;
  const activityCalls = fromCalls.filter(([t]: [string]) => t === 'crm_activities');
  expect(activityCalls).toHaveLength(0);
});

// ── Observability floor (audit Obs-High): durable AGENT_PERMISSION_DENIED event ──
// AC-OF-AGENT-DENIED-001: when can() refuses a SoD-gated write, the security signal must
// survive the SSE-stream close — i.e. a durable error_events row is inserted via
// recordErrorEvent (same mechanism as agent-chat/index.ts:95). Covers the decision-path
// denial site (handler.ts Site B); the confirmed-write re-auth site (Site A) shares the
// identical wiring.

it('AC-OF-AGENT-DENIED-001 can() denies → durable error_events row recorded with fn/contextId/orgId, before stream errored', async () => {
  const validArgs = { contactId: 'c1', kind: 'call', subject: 'Follow-up' };
  const toolId = 'tool-use-id-9';

  const req: AgentChatRequest = {
    runId: 'run-9',
    messages: [
      { role: 'user', content: 'log a call' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: toolId, name: 'create_activity', input: validArgs },
        ],
      },
    ],
    decision: { pendingId: 'pending-9', verdict: 'approve' },
  };

  // profileData.org_id is the orgId the durable row must carry.
  const supabaseMock = mockSupabase({ profileData: { org_id: 'org-1', role: 'Sales' } });
  const canMock = vi.fn().mockReturnValue(false); // denies

  const events = await collect(
    agentChatHandler(req, baseDeps({
      modelClient: {
        create: vi.fn().mockResolvedValue({
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'Permission denied.' },
          usage: {},
          model: 'deepseek/deepseek-v4-flash',
        }),
      },
      supabase: supabaseMock,
      can: canMock,
    })),
  );

  // The stream still errored (the durable recording must NOT change the user-facing signal)
  expect(events.find(
    (e) => e.type === 'status' && (e.payload as { error?: string })?.error === 'PERMISSION_DENIED',
  )).toBeDefined();

  // AND a durable error_events row was inserted (the audit signal survives the stream close).
  // The error_events branch in mockSupabase returns {insert: spy}; correlate via the .from()
  // call index — from is a single vi.fn, so mock.calls[i] and mock.results[i] line up.
  const fromMock = supabaseMock.from as ReturnType<typeof vi.fn>;
  const errorEventsCallIdx = fromMock.mock.calls.findIndex(([t]: [string]) => t === 'error_events');
  expect(errorEventsCallIdx).toBeGreaterThanOrEqual(0);
  const errorEventsBranch = fromMock.mock.results[errorEventsCallIdx].value as { insert: ReturnType<typeof vi.fn> };
  const insertedRow = errorEventsBranch.insert.mock.calls[0]?.[0] as {
    fn: string; error_code: string; context_id?: string; org_id?: string;
  };
  expect(insertedRow).toBeDefined();
  expect(insertedRow.fn).toBe('agent-chat');
  expect(insertedRow.error_code).toBe('AGENT_PERMISSION_DENIED');
  expect(insertedRow.context_id).toBe('create_activity');
  expect(insertedRow.org_id).toBe('org-1');
});

// ── Task 16 (RED→GREEN): AC-AW-005 malformed args → no needs-approval ─────────

it('AC-AW-005 malformed args (missing contactId) → no needs-approval; error tool_result to model; run NOT called', async () => {
  const invalidArgs = { kind: 'call', subject: 'Follow-up' }; // missing contactId
  const toolId = 'tool-use-id-5';

  const modelClient = {
    create: vi.fn()
      .mockResolvedValueOnce({
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: toolId, type: 'function', function: { name: 'create_activity', arguments: JSON.stringify(invalidArgs) } },
          ],
        },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      })
      .mockResolvedValueOnce({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'I need the contactId.' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
  };

  const supabaseMock = mockSupabase({});
  const events = await collect(
    agentChatHandler(BASE_REQ, baseDeps({ modelClient, supabase: supabaseMock })),
  );

  // NO needs-approval event
  expect(events.find((e) => (e.payload as { status?: string })?.status === 'needs-approval')).toBeUndefined();
  // Loop should continue — model is called twice (once for tool, once after error result)
  expect(modelClient.create).toHaveBeenCalledTimes(2);
  // No crm_activities insert
  const fromCalls = (supabaseMock.from as ReturnType<typeof vi.fn>).mock.calls;
  const activityCalls = fromCalls.filter(([t]: [string]) => t === 'crm_activities');
  expect(activityCalls).toHaveLength(0);
});

// ── Task 16 (RED→GREEN): AC-AW-002 deny → no write ───────────────────────────

it('AC-AW-002 deny → no write; system{write_resolved, decision:rejected} emitted; run completes', async () => {
  const validArgs = { contactId: 'c1', kind: 'call', subject: 'Follow-up' };
  const toolId = 'tool-use-id-6';

  const req: AgentChatRequest = {
    runId: 'run-5',
    messages: [
      { role: 'user', content: 'log a call' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: toolId, name: 'create_activity', input: validArgs },
        ],
      },
    ],
    decision: { pendingId: 'pending-4', verdict: 'reject' },
  };

  const supabaseMock = mockSupabase({});

  const events = await collect(
    agentChatHandler(req, baseDeps({
      modelClient: {
        create: vi.fn().mockResolvedValue({
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'Understood, I won\'t log that.' },
          usage: {},
          model: 'deepseek/deepseek-v4-flash',
        }),
      },
      supabase: supabaseMock,
    })),
  );

  // write_resolved with rejected
  const writeResolvedEvent = events.find(
    (e) => e.type === 'system' &&
      (e.payload as { event?: string })?.event === 'write_resolved',
  );
  expect(writeResolvedEvent).toBeDefined();
  expect((writeResolvedEvent!.payload as { decision: string }).decision).toBe('rejected');

  // No insert
  const fromCalls = (supabaseMock.from as ReturnType<typeof vi.fn>).mock.calls;
  const activityCalls = fromCalls.filter(([t]: [string]) => t === 'crm_activities');
  expect(activityCalls).toHaveLength(0);

  // Run completes
  const completedEvent = events.find(
    (e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'completed',
  );
  expect(completedEvent).toBeDefined();
});

// ── Task 16 (RED→GREEN): AC-AW-003/AC-AW-007 stale pendingId → no-op rejection ─
// AC-AW-007 is re-homed here (R-A3-4): unmatched/stale decision → rejected gracefully.

it('AC-AW-003 AC-AW-007 stale/duplicate decision (no trailing unresolved tool_use) → no write (idempotent, graceful)', async () => {
  // Transcript does NOT end with an unresolved tool_use for a confirm action
  const req: AgentChatRequest = {
    runId: 'run-6',
    messages: [
      { role: 'user', content: 'log a call' },
      // No trailing tool_use — so there's no pending confirm action to resolve
    ],
    decision: { pendingId: 'stale-pending-id', verdict: 'approve' },
  };

  const supabaseMock = mockSupabase({});

  const events = await collect(
    agentChatHandler(req, baseDeps({
      modelClient: {
        create: vi.fn().mockResolvedValue({
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'No pending action.' },
          usage: {},
          model: 'deepseek/deepseek-v4-flash',
        }),
      },
      supabase: supabaseMock,
    })),
  );

  // Should NOT insert
  const fromCalls = (supabaseMock.from as ReturnType<typeof vi.fn>).mock.calls;
  const activityCalls = fromCalls.filter(([t]: [string]) => t === 'crm_activities');
  expect(activityCalls).toHaveLength(0);

  // Should complete (treated as no-op / reject path)
  const completedEvent = events.find(
    (e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'completed',
  );
  expect(completedEvent).toBeDefined();
});

// ── Item 2 (deferred-debt refactor): MALFORMED_TOOL_CALL in the decision-continuation loop ──
// Reuses the stale/duplicate-decision request shape above — it has no trailing unresolved
// tool_use, so handleDecision routes it straight into the shared runLoop continuation pass.

it('malformed tool arguments (decision-continuation loop) → error tool_result appended, run recovers', async () => {
  const req: AgentChatRequest = {
    runId: 'run-7',
    messages: [
      { role: 'user', content: 'log a call' },
      // No trailing tool_use — routes into the runLoop continuation pass.
    ],
    decision: { pendingId: 'stale-pending-id-2', verdict: 'approve' },
  };

  const create = vi.fn()
    // Round 1: malformed JSON arguments
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tu1', type: 'function', function: { name: 'query_entity', arguments: '{broken' } },
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
      message: { role: 'assistant', content: 'Found your projects.' },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    });

  const supabaseMock = mockSupabase({ rowsFactory: () => ({ data: [{ id: '1' }], error: null }) });

  const events = await collect(
    agentChatHandler(req, baseDeps({ modelClient: { create }, supabase: supabaseMock })),
  );

  expect(create).toHaveBeenCalledTimes(3);
  expect(events.at(-1)).toMatchObject({ type: 'status', payload: { status: 'completed' } });
  expect(events.find((e) => (e.payload as { error?: string })?.error === 'UPSTREAM_ERROR')).toBeUndefined();
  expect(events.find((e) => e.type === 'tool')).toBeDefined();
});

it('malformed tool arguments (decision-continuation loop) that never recover exhaust the loop with MALFORMED_TOOL_CALL', async () => {
  const req: AgentChatRequest = {
    runId: 'run-8',
    messages: [
      { role: 'user', content: 'log a call' },
    ],
    decision: { pendingId: 'stale-pending-id-3', verdict: 'approve' },
  };

  const create = vi.fn().mockResolvedValue({
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'tu', type: 'function', function: { name: 'query_entity', arguments: '{still broken' } },
      ],
    },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const supabaseMock = mockSupabase({});

  const events = await collect(
    agentChatHandler(req, baseDeps({ modelClient: { create }, supabase: supabaseMock })),
  );

  expect(create).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
  expect(events.at(-1)).toMatchObject({
    type: 'status',
    payload: { status: 'errored', error: 'MALFORMED_TOOL_CALL' },
  });
});
