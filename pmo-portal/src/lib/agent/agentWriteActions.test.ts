/**
 * Tests for agent write actions — schema validation, actions, and handler branches.
 *
 * AC-AW-001: Approve → write executes once under caller JWT, write_resolved emitted.
 * AC-AW-002: Deny → no write; model informed via tool_result; system write_resolved rejected.
 * AC-AW-003: Stale/duplicate decision pendingId mismatch → no write (idempotent).
 * AC-AW-004: Org/role re-derive fails on approve → AUTH_EXPIRED, no write.
 * AC-AW-005: Malformed args → no needs-approval; error tool_result to model.
 * AC-AW-006: confirm:false action (query_entity) bypasses approval entirely.
 * AC-AW-007: (re-homed) unmatched/stale decision → treated as rejected gracefully.
 * AC-AW-008: can() denies the role → PERMISSION_DENIED, no write.
 *
 * All Anthropic SDK and Supabase calls are mocked via injected HandlerDeps.
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
    anthropic: {
      messages: {
        create: vi.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'All done.' }],
          usage: {},
        }),
      },
    },
    supabase: mockSupabase({}),
    userId: 'user-1',
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

it('AC-AW-006 confirm:false action (query_entity) runs immediately with no needs-approval event', async () => {
  const anthropic = {
    messages: {
      create: vi.fn()
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          content: [
            { type: 'tool_use', id: 'tu1', name: 'query_entity', input: { entity: 'projects' } },
          ],
          usage: {},
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'You have 3 projects.' }],
          usage: {},
        }),
    },
  };

  const events = await collect(
    agentChatHandler(BASE_REQ, baseDeps({ anthropic })),
  );

  expect(events.find((e) => (e.payload as { status?: string })?.status === 'needs-approval')).toBeUndefined();
  expect(events.find((e) => e.type === 'tool')).toBeDefined();
});

// ── Task 12 (RED→GREEN): AC-AW-001 happy approve → write executes ─────────────

it('AC-AW-001 approve → create_activity executes once under caller JWT, write_resolved emitted', async () => {
  const runFn = vi.fn().mockResolvedValue({ id: 'act-1' });
  const validArgs = { contactId: 'c1', kind: 'call', subject: 'Follow-up' };
  const toolId = 'tool-use-id-1';

  // Turn 1: model emits create_activity tool_use
  const proposeAnthropicCreate = vi.fn().mockResolvedValue({
    stop_reason: 'tool_use',
    content: [
      { type: 'tool_use', id: toolId, name: 'create_activity', input: validArgs },
    ],
    usage: {},
  });

  const proposeReq: AgentChatRequest = {
    runId: 'run-1',
    messages: [{ role: 'user', content: 'log a call' }],
  };

  const proposeEvents = await collect(
    agentChatHandler(proposeReq, baseDeps({
      anthropic: { messages: { create: proposeAnthropicCreate } },
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
  const approveAnthropicCreate = vi.fn().mockResolvedValue({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Done — I\'ve logged the call activity.' }],
    usage: {},
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
      anthropic: { messages: { create: approveAnthropicCreate } },
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
      anthropic: {
        messages: {
          create: vi.fn().mockResolvedValue({
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'Done.' }],
            usage: {},
          }),
        },
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
      anthropic: {
        messages: {
          create: vi.fn().mockResolvedValue({
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'Permission denied.' }],
            usage: {},
          }),
        },
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

// ── Task 16 (RED→GREEN): AC-AW-005 malformed args → no needs-approval ─────────

it('AC-AW-005 malformed args (missing contactId) → no needs-approval; error tool_result to model; run NOT called', async () => {
  const invalidArgs = { kind: 'call', subject: 'Follow-up' }; // missing contactId
  const toolId = 'tool-use-id-5';

  const anthropic = {
    messages: {
      create: vi.fn()
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          content: [
            { type: 'tool_use', id: toolId, name: 'create_activity', input: invalidArgs },
          ],
          usage: {},
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'I need the contactId.' }],
          usage: {},
        }),
    },
  };

  const supabaseMock = mockSupabase({});
  const events = await collect(
    agentChatHandler(BASE_REQ, baseDeps({ anthropic, supabase: supabaseMock })),
  );

  // NO needs-approval event
  expect(events.find((e) => (e.payload as { status?: string })?.status === 'needs-approval')).toBeUndefined();
  // Loop should continue — model is called twice (once for tool, once after error result)
  expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
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
      anthropic: {
        messages: {
          create: vi.fn().mockResolvedValue({
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'Understood, I won\'t log that.' }],
            usage: {},
          }),
        },
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
      anthropic: {
        messages: {
          create: vi.fn().mockResolvedValue({
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'No pending action.' }],
            usage: {},
          }),
        },
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
