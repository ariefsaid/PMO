# Implementation Plan — A3: Agent Write-Actions with Approve/Deny (stateless model)

**Feature:** `docs/specs/agent-write-actions.spec.md` (FR-AW-001..020, NFR-AW-SEC-001..008, AC-AW-001..017)
**ADR:** `docs/adr/0040-in-app-agent-panel-pmo-native-vs-sidecar.md` (Option A behind the B-shaped seam)
**Date:** 2026-06-30 · **Author:** eng-planner (Claude Opus 4.8)
**Branch context:** A1 (`agent-chat` edge fn + port + `PmoNativeRuntime`) and A2 (`AssistantPanel`) are on the branch.
**Status:** Ready to build — TDD, no-placeholder.

> **READ THE RECONCILIATIONS SECTION (§5) FIRST.** The Director's binding decisions D-A3-1..5 change the
> *mechanism* of approval from the spec's `waitForApproval`/`agent-approve` model (FR-AW-004/006/007/020,
> AW-OD-004 Option A) to a **stateless re-POST** model (AW-OD-004 Option B). Several spec FRs/ACs must be
> amended; §5 lists each one and the exact wording change. **Every AC's observable assertion is preserved** —
> only the wire mechanism changes.

---

## 0. Architecture: the stateless approval protocol (D-A3-1)

The whole A3 design pivots on **how an approval decision reaches the handler**. The spec assumed a long-lived
SSE stream with an in-memory `waitForApproval` promise resolved by a second `agent-approve` endpoint
(AW-OD-004 A). **D-A3-1 overrides this:** no new endpoint, no server-held pending state, no `waitForApproval`.

```
  Turn 1 (propose) ──────────────────────────────────────────────────────────────
  client POST /agent-chat { messages:[...user] }
    handler runs the tool loop; model emits tool_use for create_activity (confirm:true)
    handler VALIDATES args against the action's inputSchema
      ├─ invalid → tool_result "error" to model, loop continues (NO needs-approval)  [AC-AW-005]
      └─ valid   → handler composes humanSummary (server-side, D-A3-5)
                   emit status{ status:'needs-approval', pendingId, actionName,
                                humanSummary, structuredArgs }
                   ENDS the stream with run status 'needs-approval'   (no write executed)  [FR-AW-009]

  Turn 2a (approve) ─────────────────────────────────────────────────────────────
  client POST /agent-chat { messages:[...prior, { role:'user', content:[
                              { type:'tool_result', tool_use_id, content:'APPROVE' } ]}],
                            decision:{ pendingId, verdict:'approve' } }
    handler RE-VALIDATES args against inputSchema (D-A3-2, defence-in-depth)  [AC-AW-005 path]
    handler RE-AUTHORIZES (deputy re-auth, FR-AW-010): org re-derive + can() preflight  [AC-AW-004, AC-AW-008]
    handler EXECUTES the write via the action.run under the caller-JWT client  [AC-AW-001]
      RLS + the column-pin trigger + FK are the authority (D-A3-2)
    emit tool{ name, pendingId, result } → system{ write_resolved, decision:'approved' } [FR-AW-013]
    loop continues; model acknowledges; status 'completed'

  Turn 2b (deny) ────────────────────────────────────────────────────────────────
  client POST /agent-chat { messages:[...prior, tool_result 'DENY'], decision:{ pendingId, verdict:'reject' } }
    handler does NOT execute; appends rejection tool_result; emit system{ write_resolved, decision:'rejected' }
    model acknowledges; status 'completed'  (write NEVER ran)  [AC-AW-002, NFR-AW-SEC-006]
```

**Why this is safe (D-A3-2, the security-auditor MUST confirm this):** the approval args travel as the
model's original `tool_use` block re-sent in the transcript; on Turn 2a the handler **re-validates against the
action's `inputSchema`** and **re-derives org + `can()`** before executing under the **caller's JWT**. The
worst a malicious/forged decision turn can do is execute an action **the authenticated user could already
perform via the normal UI** — RLS/SoD is the ceiling. There is no privilege escalation surface.

**Idempotency (FR-AW-008, AC-AW-003) in a stateless world:** the client (panel) is the single resolver — a
chip can be approved/denied **once**, then it is disabled (FR-AW-017, AC-AW-016). The handler additionally
treats a `decision.pendingId` that does not match the *trailing* unresolved `tool_use` in the transcript as a
no-op (returns a rejection tool_result), so a stale/duplicate decision turn cannot trigger a second write.

**Expiry (D-A3-4, AW-OD-005):** there is no server-held pending write to time out. A `needs-approval` chip
approved after the run is stale simply re-POSTs the transcript; the model re-proposes if its context moved on.
No `APPROVAL_TIMEOUT_MS` timer is built (see §5 — supersedes NFR-AW-PERF-001/AC-AW-007's timer mechanism;
the *graceful-progress* assertion of AC-AW-007 is re-homed onto the "unmatched pendingId → rejected" path).

---

## 1. File tree (what this plan touches)

```
supabase/functions/agent-chat/
  schema.ts              EXTEND  + CREATE_ACTIVITY_SCHEMA, UPDATE_TASK_STATUS_SCHEMA (JSON Schema)
  actions.ts             EXTEND  + createActivityAction, updateTaskStatusAction (confirm:true) + validators + humanSummary
  handler.ts             EXTEND  the confirm/approval branch: dispatchAction gate, decision-turn handling, deputy re-auth, write-resolved system event
  index.ts               EXTEND  pass `decision` from the parsed body into the handler (1 line; integration-only, no unit test)

pmo-portal/src/lib/agent/runtime/
  port.ts                EXTEND  + NeedsApprovalPayload, WriteResolvedPayload exported types
  transport.ts           EXTEND  + AgentDecision field on AgentChatRequest
  pmoNativeRuntime.ts     EXTEND  control('approve'|'reject') → stash decision + re-subscribe; track pendingId from last needs-approval event

pmo-portal/src/hooks/
  useAssistantPanel.ts   EXTEND  drain needs-approval → 'needs-approval' phase; approve()/deny() actions; disable composer

pmo-portal/src/components/panel/
  ApprovalChip.tsx       NEW     the approve/deny chip (humanSummary + Approve/Deny + pending/resolved states, a11y)
  TranscriptItem.tsx     EXTEND  route status{needs-approval} → <ApprovalChip>; route system{write_resolved} → inline notice
  AssistantPanel.tsx     EXTEND  thread approve/deny + needs-approval phase into Composer disable + status label

— TESTS (TDD, written first) —
pmo-portal/src/lib/agent/agentWriteActions.test.ts   NEW  AC-AW-001..008 (handler + action validators, SDK+supabase mocked)
pmo-portal/src/components/panel/ApprovalChip.test.tsx NEW  AC-AW-013..017 (RTL + jest-axe, runtime mocked via context)
pmo-portal/e2e/AC-AW-012-agent-write-approval.spec.ts NEW  AC-AW-012 (page.route mock: propose→chip→Approve→write; +Deny negative)

supabase/tests/
  agent_write_create_activity_rls.test.sql     NEW  AC-AW-009 (cross-tenant activity insert under caller JWT)
  agent_write_update_task_status_rls.test.sql  NEW  AC-AW-010 (column-pinned own-task status under caller JWT)
  agent_write_sod_contract_value.test.sql      NEW  AC-AW-011 (deferred SoD money write blocked at DB)
```

**No source file outside `supabase/functions/agent-chat/` and `pmo-portal/src/{lib/agent,hooks,components/panel}` is
touched. No FE repository or DAL file is edited** (the edge fn is Deno and cannot import them — §0/D-A3 constraint).

---

## 2. Pre-flight facts (load-bearing; verified against the branch)

- **The edge fn cannot import the FE DAL.** `src/lib/db/crmActivities.ts` and `tasks.ts` import
  `@/src/lib/supabase/client` (a browser singleton). The write actions therefore call the **table directly**
  via `ctx.supabase` (the caller-JWT client), mirroring `runQueryEntity`. The SQL path is identical to what the
  DAL wraps, so RLS/triggers fire the same.
- **`crm_activities` insert** = `ctx.supabase.from('crm_activities').insert({ contact_id, kind, subject, body,
  occurred_at }).select().single()`. `org_id` is **trigger-stamped from the parent contact** (migration 0030);
  `logged_by_id` may be `null` (the DAL passes it; the agent path leaves it null — RLS doesn't require it).
- **`crm_activities.kind` is TITLE-CASE** in the DB enum: `'Call' | 'Email' | 'Meeting' | 'Note'`
  (`database.types.ts`). The spec's lowercase `call|email|meeting|note` (FR-AW-014) is the **agent-facing**
  enum; the action **maps lowercase → title-case** before the insert. (Reconciliation R-A3-6.)
- **`tasks` status update** = `ctx.supabase.from('tasks').update({ status }).eq('id', taskId)`. Status enum =
  `'To Do' | 'In Progress' | 'Done' | 'Blocked'` (`task_status`). The column-pin trigger
  `tasks_assignee_status_only` (migration 0016) + `tasks_update_own_status` policy enforce own-task-for-Engineer
  at the DB. **No new migration needed** for AC-AW-010 — the existing RLS is the authority; the pgTAP just
  *proves* the agent path respects it.
- **`HandlerSupabaseLike` must gain `.insert(...).select().single()` and `.update(...).eq(...)` shapes** for the
  write actions (currently only `.select()` read shapes exist). Extend the interface in `handler.ts`.
- **The existing handler dispatch** (handler.ts lines 237–283) only knows `queryEntityAction`. A3 generalizes it
  to a small **action registry** `[queryEntityAction, createActivityAction, updateTaskStatusAction]` and a
  `dispatchAction` helper that branches on `action.confirm` (FR-AW-009 / NFR-AW-SEC-001 — the single gate).
- **`can()` runs in the FE bundle but is pure** (`src/auth/policy.ts`, no browser deps). The handler imports it
  via the existing relative-import convention (like `ENTITY_WHITELIST`). The role is read from `profiles`
  under the caller JWT (already looked up for `orgId` — extend that `.single()` to also `select('org_id, role')`).

---

## 3. Tasks (TDD, 2–5 min each; RED test → GREEN impl → verify)

> Verify commands run from `pmo-portal/`. Handler/action tests import the Deno files via relative path (the
> existing convention, see `agentChatHandler.test.ts`). The final gate is `npm run verify` (Task 24).

### Group A — schemas + the two write actions (actions.ts, schema.ts)

**Task 1 (RED) — `create_activity` schema test.**
File: `pmo-portal/src/lib/agent/agentWriteActions.test.ts` (new).
Write the failing test:
```ts
import { it, expect } from 'vitest';
import { CREATE_ACTIVITY_SCHEMA } from '../../../../supabase/functions/agent-chat/schema';
it('CREATE_ACTIVITY_SCHEMA requires contactId+kind+subject and bounds lengths (FR-AW-014)', () => {
  expect(CREATE_ACTIVITY_SCHEMA.required).toEqual(['contactId', 'kind', 'subject']);
  expect((CREATE_ACTIVITY_SCHEMA.properties.kind as { enum: string[] }).enum)
    .toEqual(['call', 'email', 'meeting', 'note']);
  expect((CREATE_ACTIVITY_SCHEMA.properties.subject as { maxLength: number }).maxLength).toBe(200);
  expect((CREATE_ACTIVITY_SCHEMA.properties.body as { maxLength: number }).maxLength).toBe(2000);
  expect(CREATE_ACTIVITY_SCHEMA.additionalProperties).toBe(false);
});
```
Verify (RED): `npx vitest run src/lib/agent/agentWriteActions.test.ts` → fails (export missing).

**Task 2 (GREEN) — add `CREATE_ACTIVITY_SCHEMA`.**
File: `supabase/functions/agent-chat/schema.ts`. Append:
```ts
export const CREATE_ACTIVITY_SCHEMA = {
  type: 'object' as const,
  required: ['contactId', 'kind', 'subject'] as string[],
  additionalProperties: false,
  properties: {
    contactId: { type: 'string' as const, description: "Parent contact id (the caller's own org)." },
    kind: { type: 'string' as const, enum: ['call', 'email', 'meeting', 'note'],
      description: 'Activity kind.' },
    subject: { type: 'string' as const, maxLength: 200, description: 'Short subject line.' },
    body: { type: 'string' as const, maxLength: 2000, description: 'Optional detail.' },
    occurredAt: { type: 'string' as const, description: 'ISO-8601; defaults to now if omitted.' },
  },
};
```
Verify (GREEN): `npx vitest run src/lib/agent/agentWriteActions.test.ts` → Task 1 passes.

**Task 3 (RED) — `update_task_status` schema test.** Append to `agentWriteActions.test.ts`:
```ts
import { UPDATE_TASK_STATUS_SCHEMA } from '../../../../supabase/functions/agent-chat/schema';
it('UPDATE_TASK_STATUS_SCHEMA requires taskId+status with the 4 task_status enums (FR-AW-015)', () => {
  expect(UPDATE_TASK_STATUS_SCHEMA.required).toEqual(['taskId', 'status']);
  expect((UPDATE_TASK_STATUS_SCHEMA.properties.status as { enum: string[] }).enum)
    .toEqual(['To Do', 'In Progress', 'Done', 'Blocked']);
});
```
Verify (RED): same command → new test fails.

**Task 4 (GREEN) — add `UPDATE_TASK_STATUS_SCHEMA`.** File: `schema.ts`. Append:
```ts
export const UPDATE_TASK_STATUS_SCHEMA = {
  type: 'object' as const,
  required: ['taskId', 'status'] as string[],
  additionalProperties: false,
  properties: {
    taskId: { type: 'string' as const, description: "Task id (the caller's own org)." },
    status: { type: 'string' as const, enum: ['To Do', 'In Progress', 'Done', 'Blocked'],
      description: 'New task status.' },
  },
};
```
Verify (GREEN): both schema tests pass.

**Task 5 (RED) — `create_activity` arg validator + humanSummary.** Append to `agentWriteActions.test.ts`:
```ts
import { createActivityAction } from '../../../../supabase/functions/agent-chat/actions';
it('createActivityAction.validate rejects missing contactId; accepts valid args (NFR-AW-SEC-005)', () => {
  expect(createActivityAction.validate({ kind: 'call', subject: 'x' }).ok).toBe(false);
  const ok = createActivityAction.validate({ contactId: 'c1', kind: 'call', subject: 'Follow-up' });
  expect(ok.ok).toBe(true);
});
it('createActivityAction.summarize composes a server-side humanSummary from validated args (D-A3-5)', () => {
  expect(createActivityAction.summarize({ contactId: 'c1', kind: 'call', subject: 'Follow-up' }))
    .toBe('Log a call activity on contact c1: "Follow-up"');
});
```
Verify (RED): fails (no `createActivityAction`).

**Task 6 (GREEN) — implement `createActivityAction`.** File: `supabase/functions/agent-chat/actions.ts`. Add a
small validator (mirror `runQueryEntity`'s structured-error style; no Zod — JSON-shape checks) and the action:
```ts
import { CREATE_ACTIVITY_SCHEMA, UPDATE_TASK_STATUS_SCHEMA } from './schema';

const ACTIVITY_KIND_MAP: Record<string, 'Call' | 'Email' | 'Meeting' | 'Note'> = {
  call: 'Call', email: 'Email', meeting: 'Meeting', note: 'Note',
};

interface CreateActivityInput { contactId: string; kind: keyof typeof ACTIVITY_KIND_MAP; subject: string; body?: string; occurredAt?: string; }

function validateCreateActivity(input: unknown): { ok: true; value: CreateActivityInput } | { ok: false; error: string } {
  const i = input as Partial<CreateActivityInput>;
  if (typeof i?.contactId !== 'string' || !i.contactId) return { ok: false, error: 'contactId is required' };
  if (typeof i?.kind !== 'string' || !(i.kind in ACTIVITY_KIND_MAP)) return { ok: false, error: 'kind must be call|email|meeting|note' };
  if (typeof i?.subject !== 'string' || !i.subject || i.subject.length > 200) return { ok: false, error: 'subject is required (max 200 chars)' };
  if (i.body !== undefined && (typeof i.body !== 'string' || i.body.length > 2000)) return { ok: false, error: 'body must be a string (max 2000 chars)' };
  if (i.occurredAt !== undefined && typeof i.occurredAt !== 'string') return { ok: false, error: 'occurredAt must be an ISO-8601 string' };
  return { ok: true, value: i as CreateActivityInput };
}

export const createActivityAction: AgentAction & {
  validate: (input: unknown) => { ok: true; value: CreateActivityInput } | { ok: false; error: string };
  summarize: (input: CreateActivityInput) => string;
} = {
  name: 'create_activity',
  description: 'Log a CRM activity (call/email/meeting/note) on a contact. Requires user approval.',
  inputSchema: CREATE_ACTIVITY_SCHEMA,
  surfaces: ['agent'],
  confirm: true,
  validate: validateCreateActivity,
  summarize: (i) => `Log a ${i.kind} activity on contact ${i.contactId}: "${i.subject}"`,
  run: async (input, ctx) => {
    const v = validateCreateActivity(input);
    if (!v.ok) return { error: v.error };
    const { contactId, kind, subject, body, occurredAt } = v.value;
    const { data, error } = await ctx.supabase
      .from('crm_activities')
      .insert({
        contact_id: contactId,
        kind: ACTIVITY_KIND_MAP[kind],
        subject,
        body: body ?? null,
        occurred_at: occurredAt ?? new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return { error: 'create_activity db error', code: (error as { code?: string }).code };
    return { id: (data as { id?: string }).id };
  },
};
```
(Extend `DeputyContext.supabase` / `SupabaseLike` for `.insert().select().single()` in Task 9.)
Verify (GREEN): Task 5 tests pass.

**Task 7 (RED) — `update_task_status` validator + humanSummary.** Append to `agentWriteActions.test.ts`:
```ts
import { updateTaskStatusAction } from '../../../../supabase/functions/agent-chat/actions';
it('updateTaskStatusAction.validate rejects bad status; summarize composes (FR-AW-015, D-A3-5)', () => {
  expect(updateTaskStatusAction.validate({ taskId: 't1', status: 'Nope' }).ok).toBe(false);
  expect(updateTaskStatusAction.validate({ taskId: 't1', status: 'Done' }).ok).toBe(true);
  expect(updateTaskStatusAction.summarize({ taskId: 't1', status: 'Done' }))
    .toBe('Set task t1 status to "Done"');
});
```
Verify (RED): fails.

**Task 8 (GREEN) — implement `updateTaskStatusAction`.** File: `actions.ts`. Add:
```ts
const TASK_STATUSES = ['To Do', 'In Progress', 'Done', 'Blocked'] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];
interface UpdateTaskStatusInput { taskId: string; status: TaskStatus; }

function validateUpdateTaskStatus(input: unknown): { ok: true; value: UpdateTaskStatusInput } | { ok: false; error: string } {
  const i = input as Partial<UpdateTaskStatusInput>;
  if (typeof i?.taskId !== 'string' || !i.taskId) return { ok: false, error: 'taskId is required' };
  if (typeof i?.status !== 'string' || !(TASK_STATUSES as readonly string[]).includes(i.status)) return { ok: false, error: 'status must be one of To Do|In Progress|Done|Blocked' };
  return { ok: true, value: i as UpdateTaskStatusInput };
}

export const updateTaskStatusAction: AgentAction & {
  validate: (input: unknown) => { ok: true; value: UpdateTaskStatusInput } | { ok: false; error: string };
  summarize: (input: UpdateTaskStatusInput) => string;
} = {
  name: 'update_task_status',
  description: "Advance a task's status. Requires user approval; RLS restricts engineers to their own tasks.",
  inputSchema: UPDATE_TASK_STATUS_SCHEMA,
  surfaces: ['agent'],
  confirm: true,
  validate: validateUpdateTaskStatus,
  summarize: (i) => `Set task ${i.taskId} status to "${i.status}"`,
  run: async (input, ctx) => {
    const v = validateUpdateTaskStatus(input);
    if (!v.ok) return { error: v.error };
    const { error } = await ctx.supabase.from('tasks').update({ status: v.value.status }).eq('id', v.value.taskId);
    if (error) return { error: 'update_task_status db error', code: (error as { code?: string }).code };
    return { taskId: v.value.taskId, status: v.value.status };
  },
};
```
Verify (GREEN): Task 7 tests pass.

### Group B — port + transport types

**Task 9 (GREEN, type-only — no behavior test; covered by typecheck) — extend port + transport types.**
File: `pmo-portal/src/lib/agent/runtime/port.ts`. Append (FR-AW-012):
```ts
export interface NeedsApprovalPayload {
  status: 'needs-approval';
  pendingId: string;
  actionName: string;
  humanSummary: string;
  structuredArgs: object;
}
export interface WriteResolvedPayload {
  event: 'write_resolved';
  decision: 'approved' | 'rejected';
  actionName: string;
  pendingId: string;
}
```
Extend `SupabaseLike` with write builders (used by the edge fn cast):
```ts
  from(table: string): {
    select(columns: string): { /* …existing read shapes… */ };
    insert(row: object): { select(): { single(): PromiseLike<{ data: unknown; error: unknown }> } };
    update(patch: object): { eq(column: string, value: string): PromiseLike<{ data: unknown; error: unknown }> };
  };
```
File: `pmo-portal/src/lib/agent/runtime/transport.ts`. Extend `AgentChatRequest`:
```ts
export interface AgentDecision { pendingId: string; verdict: 'approve' | 'reject'; }
export interface AgentChatRequest {
  runId?: string;
  messages: ConversationMessage[];
  context?: RunContext;
  /** A3: present on an approve/deny re-POST (D-A3-1, AW-OD-004 Option B). */
  decision?: AgentDecision;
}
```
Verify: `npm run typecheck` → zero errors.

### Group C — handler approval branch (handler.ts)

**Task 10 (RED) — AC-AW-006: `confirm:false` (read) bypasses approval.** Append to `agentWriteActions.test.ts`
a handler-level test (reuse the `collect`/`baseDeps` helpers pattern from `agentChatHandler.test.ts` — import or
re-declare a local mock builder). The model emits `query_entity`; assert NO `needs-approval` status event is
emitted and the read result `tool` event appears.
```ts
it('AC-AW-006 confirm:false action (query_entity) runs immediately with no needs-approval event', async () => {
  const events = await collect(agentChatHandler(REQ, depsThatEmitToolUse('query_entity', { entity: 'projects' })));
  expect(events.find((e) => (e.payload as { status?: string })?.status === 'needs-approval')).toBeUndefined();
  expect(events.find((e) => e.type === 'tool')).toBeDefined();
});
```
Verify (RED): fails (registry not yet generalized — `create_activity` not registered, but this test asserts the
read still works after generalization; write it now so Task 11 keeps it green).

**Task 11 (GREEN) — generalize dispatch into a registry + `dispatchAction` gate (FR-AW-009/NFR-AW-SEC-001).**
File: `handler.ts`. Replace the single-tool block (lines ~211–283) with a registry and a gated dispatcher:
```ts
import { queryEntityAction, createActivityAction, updateTaskStatusAction } from './actions';
const ACTIONS = [queryEntityAction, createActivityAction, updateTaskStatusAction];
const ACTION_BY_NAME = new Map(ACTIONS.map((a) => [a.name, a]));
// tools: ACTIONS.map((a) => ({ name: a.name, description: a.description, input_schema: a.inputSchema }))
```
`dispatchAction(action, toolInput, ctx)` is the **single** site that may call `action.run`; it MUST guard:
```ts
if (action.confirm) throw new Error('confirm action must route through the approval branch'); // unreachable guard
return action.run(toolInput, ctx);
```
The loop branches: if `action.confirm` is true → go to the **propose** branch (Task 12); else → `dispatchAction`
(read path, unchanged behavior). Keep the existing `query_entity` event shape (`payload: { name, input, result }`).
Verify (GREEN): Task 10 passes; the existing `agentChatHandler.test.ts` AC-AR-001/004 still pass:
`npx vitest run src/lib/agent/agentChatHandler.test.ts src/lib/agent/agentWriteActions.test.ts`.

**Task 12 (RED) — AC-AW-001 happy approve → write executes.** Append a two-turn handler test:
Turn 1: model emits `create_activity` tool_use with valid args, `stop_reason:'tool_use'`. Assert the handler
emits `status{ status:'needs-approval', pendingId, actionName:'create_activity', humanSummary, structuredArgs }`
and ENDS (no `tool` write event, run not 'completed'); assert the action's `run` mock was NOT called.
Turn 2: re-POST with `decision:{ pendingId, verdict:'approve' }` and the prior transcript; mock model returns a
final `end_turn` text. Assert: `run` called exactly once under the caller-JWT supabase; a `tool` event with
`payload.pendingId === <pendingId>`; a `system{ payload:{ event:'write_resolved', decision:'approved' } }`;
terminal `completed`.
```ts
it('AC-AW-001 approve → create_activity executes once under caller JWT, write_resolved emitted', async () => { /* … */ });
```
Verify (RED): fails.

**Task 13 (GREEN) — implement the propose + decision branches.** File: `handler.ts`.
- **Propose branch** (when `action.confirm` and there is no matching `decision` in the request): call
  `action.validate(toolInput)`. If `!ok` → append an error `tool_result` to the model and continue the loop
  (NO needs-approval) — this is the AC-AW-005 path. If ok → mint `pendingId = makeId()`, emit
  `statusEvent('needs-approval', { pendingId, actionName: action.name, humanSummary: action.summarize(value), structuredArgs: value })`, then `return` (end the stream). The `tool_use` block stays in the transcript the client replays.
- **Decision branch** (when `req.decision` is present): find the action by the trailing unresolved `tool_use`'s
  name; if `req.decision.verdict === 'reject'` OR the `decision.pendingId` doesn't correspond to that trailing
  tool_use → append a rejection `tool_result` ("Write action declined by user."), emit
  `system({ payload: { event:'write_resolved', decision:'rejected', actionName, pendingId } })`, continue loop
  (AC-AW-002 / AC-AW-007-rehome / idempotency). If `verdict === 'approve'` → run the **deputy re-auth** (Task 14)
  then execute: `const result = await dispatchActionForced(action, validatedArgs, ctx)` (a variant that bypasses
  the confirm guard because approval is the gate), emit `tool({ payload:{ name, pendingId, result } })` +
  `system({ payload:{ event:'write_resolved', decision:'approved', actionName, pendingId } })`, append the write
  result as a `tool_result`, continue the loop so the model acknowledges.
Verify (GREEN): AC-AW-001 passes.

**Task 14 (RED) — AC-AW-004 + AC-AW-008 deputy re-auth gates.** Append:
- AC-AW-004: on the approve turn, mock the org/role re-derive `.single()` to return `{ data: null, error }`
  (user deprovisioned / token stale) → assert `status{ error:'AUTH_EXPIRED' }`, `run` NOT called, terminal `errored`.
- AC-AW-008: mock org+role OK but a role that `can('create','contactActivity')` denies (e.g. `role:'Engineer'`
  for create_activity, which is MASTER_DATA-only) → assert `status{ error:'PERMISSION_DENIED' }`, `run` NOT
  called, and a model-readable tool_result appended.
```ts
it('AC-AW-004 approve but org/role re-derive fails → AUTH_EXPIRED, no write', async () => { /* … */ });
it('AC-AW-008 approve but can() denies the role → PERMISSION_DENIED, no write', async () => { /* … */ });
```
Verify (RED): fails.

**Task 15 (GREEN) — implement deputy re-auth (FR-AW-010).** File: `handler.ts`. Before executing an approved
write: (1) re-run the profiles lookup `select('org_id, role')` under `ctx.supabase`; if it errors/empty →
`statusEvent('errored', { error:'AUTH_EXPIRED' })` and `return`. (2) Map `actionName → can(action, entity)`:
`create_activity → can('create','contactActivity', { realRole })`, `update_task_status →
can('edit','taskStatus', { realRole })`. If `false` → `statusEvent('errored', { error:'PERMISSION_DENIED' })` +
append a model-readable rejection tool_result + continue loop (do NOT terminate the run as errored — the model
explains; matches NFR-AW-SEC-003's "DB would reject; surface friendly"). Import `can` from
`../../../pmo-portal/src/auth/policy` (pure module, relative import per the `ENTITY_WHITELIST` convention).
Verify (GREEN): AC-AW-004 + AC-AW-008 pass.

**Task 16 (RED) — AC-AW-005 malformed args → no needs-approval; AC-AW-002 deny → no write; AC-AW-003 idempotent.**
Append three tests:
- AC-AW-005: Turn-1 model emits `create_activity` with NO `contactId` → assert NO `needs-approval` event, an
  error `tool_result` is fed back, `run` NOT called, loop continues.
- AC-AW-002: Turn-2 with `decision.verdict:'reject'` → `run` NOT called, `system{ decision:'rejected' }`, a
  rejection tool_result in the messages, terminal `completed`.
- AC-AW-003: Turn-2 with `decision.pendingId` that does NOT match the trailing tool_use's minted id (simulating a
  stale/duplicate approve) → handler treats as rejected (no-op), `run` NOT called. (Stateless idempotency.)
Verify (RED): fails.

**Task 17 (GREEN) — wire the three branches.** Most logic exists from Tasks 13/15; add the
`decision.pendingId` vs trailing-tool_use matching (the handler re-mints? No — see note). **pendingId matching
note:** because the handler is stateless, on Turn 2 it cannot recall the Turn-1 `pendingId`. The match is
**positional**: the trailing unresolved `tool_use` block in the replayed transcript IS the pending write; the
client echoes the original `pendingId` in `decision.pendingId` purely for the panel's bookkeeping and the
`write_resolved`/`tool` event payloads. The handler accepts `decision` iff the transcript ends with exactly one
unresolved confirm-action `tool_use`; otherwise (none, or already has a tool_result) it is a no-op rejection
(AC-AW-003). Implement that guard. Verify (GREEN): AC-AW-002/003/005 pass.

**Task 18 (GREEN, 1 line) — thread `decision` through index.ts.** File: `supabase/functions/agent-chat/index.ts`.
The handler reads `req.decision`; `index.ts` already passes the parsed `body` as `req`. Add a comment confirming
`decision` is carried (no code change if `body` is passed wholesale — confirm by reading; if the body is
reconstructed field-by-field anywhere, add `decision: body.decision`). Integration-only file (no unit test).
Verify: `npm run typecheck`.

### Group D — adapter (pmoNativeRuntime.ts)

**Task 19 (RED) — control('approve'|'reject') re-POSTs the decision.** File:
`pmo-portal/src/lib/agent/pmoNativeRuntime.test.ts` (extend existing). Test: subscribe yields a
`needs-approval` event (mock fetch returns an SSE frame with `pendingId:'p1'`); then `control(runId,'approve')`
followed by re-`subscribe` causes a second fetch whose JSON body includes `decision:{ pendingId:'p1',
verdict:'approve' }` and the full prior transcript. `control(runId,'reject')` sends `verdict:'reject'`.
Verify (RED): fails.

**Task 20 (GREEN) — implement adapter approve/reject.** File: `pmoNativeRuntime.ts`.
- In `_doSubscribe`, when an event with `payload.status === 'needs-approval'` is seen, stash
  `state.pendingId = payload.pendingId` and `state.pendingToolUseId` (so the next re-POST appends the
  decision tool_result against the right `tool_use_id`).
- Extend `control`: for `'approve'|'reject'`, set `state.pendingDecision = { pendingId: state.pendingId,
  verdict: cmd === 'approve' ? 'approve' : 'reject' }`. (The next `subscribe()` re-POST reads it.)
- In `_doSubscribe`'s request body, include `decision: state.pendingDecision` when present, then clear it after
  the fetch resolves. The transcript already carries the prior turns (D8 stateless replay); append the
  decision `tool_result` turn to `state.messages` before the POST so the model's loop continues correctly.
Note: the run-state `Map` entry is deleted in the `finally` of `_doSubscribe`; for A3, **defer deletion when
the stream ended in `needs-approval`** (the run is paused, not done) so the pending decision survives to the next
subscribe. Add that condition. Verify (GREEN): Task 19 passes; existing pmoNativeRuntime tests stay green.

### Group E — hook + panel UI

**Task 21 (RED) — AC-AW-013/016/017 ApprovalChip render + a11y.** File:
`pmo-portal/src/components/panel/ApprovalChip.test.tsx` (new). Render `<ApprovalChip>` with props
`{ humanSummary, state:'pending', onApprove, onDeny }`:
- AC-AW-013: the `humanSummary` text is visible; an "Approve" button and a "Deny" button are present.
- AC-AW-016: with `state:'approved'`, the Approve button is `disabled` or absent and shows "Approved ✓".
- AC-AW-017: `jest-axe` `axe(container)` returns zero violations in pending, approved, and denied states.
- a11y: the chip has `aria-live="assertive"` (NFR-AW-A11Y-001).
Verify (RED): fails (no component).

**Task 22 (GREEN) — implement `ApprovalChip`.** File: `pmo-portal/src/components/panel/ApprovalChip.tsx` (new).
Strictly `DESIGN.md` tokens (mirror `ToolCallCard`/`ErrorCard` classes). Props:
```ts
interface ApprovalChipProps {
  humanSummary: string;
  state: 'pending' | 'approving' | 'approved' | 'denied';
  onApprove: () => void;
  onDeny: () => void;
}
```
Render: `role="group"` + `aria-live="assertive"`; the truncated (120-char) summary; in `pending` →
Approve (primary) + Deny (secondary) buttons, both keyboard-operable; in `approving` → buttons disabled + a
pending indicator; in `approved` → "Approved ✓" (buttons absent/disabled); in `denied` → "Denied". (FR-AW-017,
FR-AW-018, NFR-AW-A11Y-001/002, AC-AW-016.)
Verify (GREEN): AC-AW-013/016/017 pass.

**Task 23 (RED→GREEN) — AC-AW-014/015 + wire the chip into the hook/transcript/panel.**
RED — File: `pmo-portal/src/components/panel/ApprovalChip.test.tsx` (or a sibling
`AssistantPanel.approval.test.tsx`): render `AssistantPanel` with a context-mocked runtime that scripts a
`needs-approval` event (the existing panel tests mock the runtime via `AgentRuntimeContext`). Assert:
- AC-AW-014: chip visible; composer Send `disabled`; click Approve → `runtime.control(runId,'approve')` called;
  on a subsequent scripted `tool` event with matching `pendingId` → chip shows "Approved ✓".
- AC-AW-015: click Deny → `runtime.control(runId,'reject')`; chip shows "Denied"; after a terminal `completed`
  status event the composer re-enables.
GREEN — three edits:
1. `useAssistantPanel.ts`: in `drain`, when a `status` event has `payload.status === 'needs-approval'`, set
   `phase` to a new `'needs-approval'` value (extend `RunPhase`) and append the event (so TranscriptItem renders
   the chip). Add `approve()`/`deny()` actions: `runtime.control(runIdRef.current, 'approve'|'reject')` then
   re-`subscribe(runId)` + `drain` (the adapter sends the decision). On `write_resolved`/`completed` clear the
   phase. Track the active `pendingId` so the chip and the re-subscribe agree.
2. `TranscriptItem.tsx`: `case 'status'` → if `payload.status === 'needs-approval'` render `<ApprovalChip
   humanSummary={payload.humanSummary} state=… onApprove onDeny />` (state derived from a later matching
   `write_resolved` system event). `case 'system'` → if `payload.event === 'write_resolved'` render a quiet
   inline notice ("Write approved ✓" / "Write denied"), FR-AW-013.
3. `AssistantPanel.tsx`: treat `phase === 'needs-approval'` like `running` for composer disable
   (FR-AW-019/NFR-AW-A11Y-003) with the status label "A write action awaits your decision"; pass `approve`/`deny`
   down to the chip via the transcript (lift through `useAssistantPanel`).
Verify (GREEN): `npx vitest run src/components/panel src/hooks/useAssistantPanel*` → AC-AW-014/015 pass; existing
A2 panel tests stay green.

### Group F — pgTAP proofs (integration)

**Task 24 (RED→GREEN) — AC-AW-009 cross-tenant activity insert under caller JWT.** File:
`supabase/tests/agent_write_create_activity_rls.test.sql` (new). Mirror `0073_crm_activity_rls.test.sql`:
two orgs, an Engineer (MASTER_DATA includes Engineer? **No** — `crm_activities_write` is the 4-role gate
Admin·Exec·PM·Finance; Engineer is denied, per AC-CRM-012). **Reconcile AC-AW-009 wording (R-A3-7):** the spec
says "Engineer is in MASTER_DATA roles" — that is FALSE for crm_activities. Use a **PM** (in MASTER_DATA) for the
success case and assert the cross-org PM insert is denied (42501 parent-org guard). Assertions:
`set local request.jwt.claims` to PM-A → `lives_ok` insert on an org-A contact (the exact
`insert into crm_activities (contact_id, kind, subject)` the action runs, org not sent);
`throws_ok … '42501'` for the same PM-A inserting on an org-B contact.
Verify: `supabase test db` (or `supabase db reset && supabase test db`) → file passes. CI: PR→`main` integration.

**Task 25 (RED→GREEN) — AC-AW-010 column-pinned own-task status.** File:
`supabase/tests/agent_write_update_task_status_rls.test.sql` (new). Two profiles in org X (Engineer B assigned
to T1; T2 assigned to someone else). As Engineer B's JWT: `lives_ok update tasks set status='Done' where id=T1`
(own task → policy `tasks_update_own_status` + trigger allow status-only); `results_eq` that
`update tasks set status='Done' where id=T2` affects **0 rows** (USING hides the non-own row). This proves the
agent's `update_task_status` path respects the column-pinned RLS (ADR-0019 §4) under the caller JWT.
Verify: `supabase test db` → passes.

**Task 26 (RED→GREEN) — AC-AW-011 deferred SoD money write blocked at DB.** File:
`supabase/tests/agent_write_sod_contract_value.test.sql` (new). As a PM JWT on a WON/on-hand project, attempt a
direct `update projects set contract_value = … ` and assert it is rejected (`throws_ok '42501'` — the column
grant / SoD policy is the fence). This proves A3's deferral of money writes is safe: even if a future agent
action tried it, the DB blocks the non-RPC path. (If the existing schema fences `contract_value` via an RPC-only
grant rather than `42501` on direct update, adjust the assertion to the actual enforced error — confirm against
`supabase/migrations/` for the contract_value SoD policy before finalizing the errcode.)
Verify: `supabase test db` → passes.

### Group G — e2e + full gate

**Task 27 (RED→GREEN) — AC-AW-012 cross-stack approve→write + Deny negative.** File:
`pmo-portal/e2e/AC-AW-012-agent-write-approval.spec.ts` (new). Model it on
`AC-AR-013-assistant-panel-journey.spec.ts`. `page.route('**/functions/v1/agent-chat')` is **stateful**: the
first POST (no `decision`) returns the propose SSE frames ending in
`status{ status:'needs-approval', pendingId:'abc-123', actionName:'create_activity', humanSummary:'Log a call
activity on contact XYZ', structuredArgs:{ contactId:'…', kind:'call', subject:'Follow-up' } }`; the second POST
(body contains `decision.verdict==='approve'`) returns
`tool{ payload:{ name:'create_activity', pendingId:'abc-123', result:{ id:'act-1' } } }` →
`assistant{ text:"Done — I've logged the call activity." }` → `status{ status:'completed' }`. Journey + assertions
per spec §AC-AW-012 (Approve buttons visible; composer disabled at needs-approval; control('approve') re-POST
detected; assistant text matches `/logged the call activity/i`; Send re-enabled). **Negative companion test:**
clicking Deny → the second POST carries `decision.verdict==='reject'`; the mock returns a denial
acknowledgment; assert chip shows "Denied" and NO `create_activity` result frame is requested/shown.
Verify (parse): `npx playwright test e2e/AC-AW-012-agent-write-approval.spec.ts --list`. CI: PR→`dev` fast lane.

**Task 28 (GATE) — full verify.** Run from `pmo-portal/`: `npm run verify`
(= `typecheck && lint:ci && test && build`). Zero errors, ESLint zero warnings, ≥80% line coverage on the new
files. Confirm `grep -rn "AC-AW-0" src supabase ../supabase` finds each AC at its owning layer.
Verify: `npm run verify` → green.

---

## 4. AC → layer → file traceability

| AC-### | Assertion | Layer | Tool | File | Task |
|---|---|---|---|---|---|
| AC-AW-001 | Approve → write executes once under caller JWT | Unit | Vitest | `src/lib/agent/agentWriteActions.test.ts` | 12,13 |
| AC-AW-002 | Deny → no write; model informed | Unit | Vitest | `…agentWriteActions.test.ts` | 16,17 |
| AC-AW-003 | Stale/duplicate decision → no second write (idempotent) | Unit | Vitest | `…agentWriteActions.test.ts` | 16,17 |
| AC-AW-004 | Org/role re-derive fails on approve → AUTH_EXPIRED, no write | Unit | Vitest | `…agentWriteActions.test.ts` | 14,15 |
| AC-AW-005 | Malformed args → no needs-approval; error to model | Unit | Vitest | `…agentWriteActions.test.ts` | 16,17 |
| AC-AW-006 | `confirm:false` read bypasses approval | Unit | Vitest | `…agentWriteActions.test.ts` | 10,11 |
| AC-AW-007 | (re-homed) unmatched/expired decision → rejected gracefully | Unit | Vitest | `…agentWriteActions.test.ts` | 16,17 |
| AC-AW-008 | `can()` false on approve → PERMISSION_DENIED, no write | Unit | Vitest | `…agentWriteActions.test.ts` | 14,15 |
| AC-AW-009 | RLS denies cross-tenant activity insert (PM, not Engineer) | Integration | pgTAP | `supabase/tests/agent_write_create_activity_rls.test.sql` | 24 |
| AC-AW-010 | `update_task_status` column-pinned to assignee | Integration | pgTAP | `supabase/tests/agent_write_update_task_status_rls.test.sql` | 25 |
| AC-AW-011 | Deferred SoD `contract_value` blocked at DB | Integration | pgTAP | `supabase/tests/agent_write_sod_contract_value.test.sql` | 26 |
| AC-AW-012 | Full approve journey + Deny negative (mocked edge fn) | E2E | Playwright | `pmo-portal/e2e/AC-AW-012-agent-write-approval.spec.ts` | 27 |
| AC-AW-013 | needs-approval → ApprovalChip renders; composer disabled | Unit | Vitest/RTL | `src/components/panel/ApprovalChip.test.tsx` | 21,22 |
| AC-AW-014 | Approve click → control('approve'); chip resolves | Unit | Vitest/RTL | `…ApprovalChip.test.tsx` (+ panel) | 23 |
| AC-AW-015 | Deny click → control('reject'); composer re-enables | Unit | Vitest/RTL | `…ApprovalChip.test.tsx` (+ panel) | 23 |
| AC-AW-016 | Resolved chip disabled (no re-approval) | Unit | Vitest/RTL | `…ApprovalChip.test.tsx` | 21,22 |
| AC-AW-017 | axe-core zero violations on chip states | Unit | Vitest/RTL + jest-axe | `…ApprovalChip.test.tsx` | 21,22 |

**Type-only / supporting tasks (no AC, covered by typecheck/lint):** 2,4 (schemas), 9 (port/transport types),
18 (index wiring), 19–20 (adapter — exercised end-to-end by AC-AW-012/014/015), 28 (gate).

---

## 5. Reconciliations (binding Director decisions vs. spec wording)

The spec was authored around AW-OD-004 **Option A** (a long-lived SSE + in-memory `waitForApproval` resolved by
a new `agent-approve` endpoint). **D-A3-1 selects Option B** (stateless re-POST to `agent-chat` with a
`decision` field; no second endpoint). These spec items must be amended; every AC's *observable behavior* is
preserved.

| ID | Spec text | Amendment (for the spec-reviewer to ratify) | Driver |
|---|---|---|---|
| **R-A3-1** | FR-AW-003/004 — handler holds the pending write in memory; `waitForApproval(pendingId)` injectable; SSE stays open. | **Strike `waitForApproval` and the open-stream hold.** The handler emits `needs-approval` and **ends the stream** (run status `needs-approval`). The decision arrives on a **fresh POST** carrying `decision:{pendingId,verdict}` + the replayed transcript. No `HandlerDeps.waitForApproval`. | D-A3-1 |
| **R-A3-2** | FR-AW-006/007/020 + AW-OD-004 — `control('approve'/'reject')` resolves an in-memory promise; default = `agent-approve` endpoint (Option A). | **Adopt Option B.** `control('approve'/'reject')` stashes a `decision` the adapter sends on the next `subscribe()` re-POST to `agent-chat`. **Delete the `agent-approve` endpoint requirement** (AW-OQ-001 → Option B). | D-A3-1 |
| **R-A3-3** | FR-AW-008 — idempotency via an in-memory `consumed` flag on `pendingId`. | **Re-home to positional matching:** the handler accepts a `decision` iff the replayed transcript ends in exactly one unresolved confirm-action `tool_use`; otherwise it is a no-op rejection. The panel disables the chip after one click (UI idempotency). | D-A3-1, D-A3-4 |
| **R-A3-4** | NFR-AW-PERF-001 + AC-AW-007 — `APPROVAL_TIMEOUT_MS` (5 min) times out `waitForApproval`; expiry → rejected. | **No server timer** (no server-held pending write exists to expire — D-A3-4). AC-AW-007's *assertion* (an unresolvable/stale decision is treated as rejected and the run progresses gracefully) is **re-homed** onto the positional-mismatch path (R-A3-3). A stale chip approved later simply re-proposes. | D-A3-4 |
| **R-A3-5** | NFR-AW-SEC-007 — `agent-approve` requires `Authorization: Bearer <caller JWT>` matching the run userId; 403 on mismatch. | **Re-home to `agent-chat`:** the decision re-POST already carries the caller JWT (existing `agent-chat` auth gate verifies it and re-derives org/role under it — Task 15). No separate endpoint to authenticate. Cross-user replay is impossible because the write runs under the **poster's** JWT (RLS ceiling). | D-A3-1, D-A3-2 |
| **R-A3-6** | FR-AW-014 — `kind` enum `call|email|meeting|note`. | Keep the **agent-facing** enum lowercase; the action **maps to the DB title-case enum** `Call|Email|Meeting|Note` before insert (the DB `crm_activities.kind` enum is title-case). Add a note to FR-AW-014. | repo fact |
| **R-A3-7** | AC-AW-009 — "user A has role `engineer` … Engineer is in MASTER_DATA roles." | **Factually wrong for `crm_activities`:** the write gate is Admin·Exec·PM·Finance; **Engineer is denied** (proven by AC-CRM-012). Amend AC-AW-009 to use a **PM** for the success case (cross-org PM insert denied 42501). | repo fact |

**Security note for the auditor (D-A3-2):** confirm that the stateless decision re-POST cannot escalate
privilege — the write is re-validated against the action `inputSchema`, re-authorized via org/role re-derive +
`can()`, and executed under the **poster's caller JWT** (RLS/SoD ceiling). Worst case = an action the user could
already perform in the UI. This is the explicit thing to verify in review.

---

## 6. Open questions for the Director

1. **AC-AW-011 errcode (Task 26):** the spec asserts `42501` on a direct `contract_value` UPDATE. I have not
   located the exact `contract_value` SoD fence migration; the implementer must confirm whether it is a revoked
   column grant (`42501`) or an RPC-only path with a different enforced error, and pin the `throws_ok` errcode to
   the real one. **Not a blocker** — the proof's intent (direct money write is fenced) holds either way.
2. **`RunPhase` extension (Task 23):** I extend `RunPhase` with `'needs-approval'`. If the A2 reviewer prefers
   keeping `RunPhase` as-is and deriving "awaiting approval" from the transcript tail, the hook can compute it
   instead. Either is correct; I chose the explicit phase for clearer composer-disable logic. Flag if you want
   the derived approach.
3. **`spec.md` amendment ownership:** the §5 reconciliations require edits to `agent-write-actions.spec.md`
   (FR-AW-003/004/006/007/008/014/020, NFR-AW-PERF-001, NFR-AW-SEC-007, AC-AW-007, AC-AW-009). Confirm whether
   eng-planner amends the spec now or the spec-reviewer ratifies first. The plan is internally consistent without
   the spec edit, but the spec will read as contradictory (Option A vs Option B) until amended.

Nothing else blocks the build.
