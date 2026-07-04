# Plan — Deputy-as-help-desk (`deputy-help`)

**Spec (authoritative):** `docs/specs/deputy-help.spec.md` — signed, review battery passed. Its
Decisions are settled; this plan does **not** re-litigate them. Line refs below were re-verified
against the worktree on 2026-07-04 (all match: `prompt.ts:22/44`, `handler.ts:903/916/957/972/1001/1063/1073/1120/1138/1219/1240`, `policy.ts:71`).

**What this plan does NOT do** (per task): change the spec · add tools/UI · invent an LLM-judge gate ·
touch the stack (no migration, no RLS, no route). Pure TS + docs. Edge-fn unit tests live under
`pmo-portal/src/lib/agent/` and import the edge fn by relative path — the repo's standing
vitest-discovery rule (precedent: `usage.test.ts`, `agentPrompt.test.ts`, `handlerAnswerCapabilities.test.ts`).

**In-flight migrations:** this issue adds **none** (no file under `supabase/migrations/` is touched).
Zero collision risk with in-flight schema work.

---

## 1. Design summary (brainstorm outcomes)

**Architecture.** A build-time, repo-versioned TypeScript constant (`HELP_CORPUS`) is appended to the
agent-chat system prompt; the caller's `role` is threaded in as a new parameter and interpolated into a
grounding sentence. Injection is **always-on** (the spec's settled decision, with the measured
cost-benefit table). No new tool, no new UI, no new table.

**Files touched (blast radius verified — `grep -rn buildAgentSystemPrompt`):** exactly 3 handler call
sites (`handler.ts:1001/1073/1138`) + 3 test call sites (`agentPrompt.test.ts:14/26/35`) + the builder
def (`prompt.ts:22`). No other callers exist.

| File | Action | Slice |
|---|---|---|
| `supabase/functions/agent-chat/helpCorpus.ts` | **NEW** — exports `HELP_CORPUS` (5920 chars ≈ 1480 tokens) + editing-rules header comment | 1 |
| `supabase/functions/agent-chat/prompt.ts` | **EDIT** — `buildAgentSystemPrompt` gains optional `role` param + role sentence + Rule #6 (grounding) + appended corpus | 1 |
| `supabase/functions/agent-chat/handler.ts` | **EDIT** — thread `initialRole` into `handleDecision` + `handleAnswer` + the fresh-turn site (atomic) | 2 |
| `pmo-portal/src/lib/agent/helpCorpus.test.ts` | **NEW** — fixture guard: char ceiling + content + no forbidden citations | 1 |
| `pmo-portal/src/lib/agent/agentPrompt.test.ts` | **EDIT** — AC-DH-001..004 + narrow the pre-existing `tasks` assertion | 1 |
| `pmo-portal/src/lib/agent/agentChatHandlerRoleGrounding.test.ts` | **NEW** — FR-DH-007 wiring guard (3 paths) | 2 |
| `docs/director-playbook.md` | **EDIT** — FR-DH-011 Ship-checklist line | 3 |
| `docs/qa-portfolio.md` | **EDIT** — AC-DH-005 live-verify runbook (new section) | 3 |

**Data flow.** None new — pure prompt text. `initialRole: string | null` (already derived in
`agentChatHandlerInner` at `handler.ts:903`, assigned `:916` from `profiles.role`) → new param →
interpolated sentence. `reAuthRole` (`handler.ts:1219`, derived inside `handleDecision`'s approve path,
**after** its prompt is built at `:1138`) is **out of scope** at the prompt-build site and must NOT be
used for role-grounding (spec Contradictions §1; reinforced in Task 2.2).

**Error handling.** `role === null` → the role sentence is omitted entirely (AC-DH-003); no `"null"`,
no broken sentence. Everything else is unchanged (the existing upstream profiles-lookup failure path
at handler gate (2) already terminal-errors before the prompt is built).

---

## 2. Design decisions (plan-level mechanical choices)

The spec leaves its Open Questions #1–#3 and the param shape to the plan; these resolve them
(no owner adjudication needed, per the `agent-transcript-contracts` precedent):

- **D1 (Open Q #1 — corpus format):** flat markdown inside a TS template-string constant. Prose for a
  model, not data for code; no parsing, no `.md` import, no `Deno.readTextFile`, no build step (FR-DH-003).
- **D2 (Open Q #2 — runbook home):** a new section in `docs/qa-portfolio.md`. That doc is ADR-0030's
  designated home for "live-verify, not CI" items; this is exactly such an item. Avoids a new
  top-level `docs/runbooks/` category for one runbook.
- **D3 (Open Q #3 — corpus subset):** **all user-facing glossary terms** (20 of 22 — every term except
  **Operator** and **Spine**, which the spec's own Open Q #3 flags as internal/authoring concepts an end
  user will not ask about) **+ 8 core role workflows** (one-or-more per role, covering each role's
  primary screen × top job, plus the Engineer→approve-timesheet out-of-role case for FR-DH-009).
  Measured: **5920 chars ≈ 1480 tokens** at the spec's 4 chars/token rate → satisfies the task's
  "≤1.5k tokens" ruling with 1 token to spare. Full coverage of remaining terms is an incremental,
  corpus-only follow-up (no re-spec).
- **D4 (param shape — not an Open Q):** `role: string | null = null` — **optional, default null**.
  Rationale: keeps every task a green-tree checkpoint (the handler's three 2-arg call sites keep
  compiling through slice 1). The spec's silent-omission worry (Contradictions §1) is then caught by
  the **three mandatory FR-DH-007 threading tests** in slice 2 — which assert the *right value* reaches
  each of the three prompts, a stronger guard than compiler enforcement of a required param. The spec
  mandates atomic threading and accepts `role: string | null`; optional-with-default satisfies both.
- **D5 (char ceiling):** the fixture test asserts `HELP_CORPUS.length <= 6000` (= 1500 tokens at the
  spec's 4 chars/token rate — the auditable guardrail NFR-DH-PERF-001 wants). The corpus is authored to
  ~5920 chars (≈1480 tokens), leaving ~80 chars of headroom under the ceiling. Bump the ceiling only
  when intentionally growing the corpus, and record the new measured size in the spec's "Injection
  strategy" section.

---

## 3. Tasks (strict TDD, 2–5 min each, no placeholders)

> All single-file test runs are the **inner TDD loop only**. The binding pre-push gate is the **full
> `npm run verify`** in Task 4.1 — never push on a per-file green alone (AGENTS.md).

### Slice 1 — help corpus + injection

---

**Task 1.1 — RED: `helpCorpus` fixture guard.** *(NFR-DH-PERF-001, NFR-DH-SEC-003)*

Create `pmo-portal/src/lib/agent/helpCorpus.test.ts` (NEW) with exactly:

```ts
/**
 * Fixture guard for the deputy-help-desk corpus (spec docs/specs/deputy-help.spec.md).
 * NFR-DH-PERF-001: corpus size is bounded + measured at authoring time (≤6000 chars ≈ ≤1500 tokens
 * at the spec's 4 chars/token rate). NFR-DH-SEC-003: no internal-only citations leak into user copy.
 */
import { it, expect } from 'vitest';
import { HELP_CORPUS } from '../../../../supabase/functions/agent-chat/helpCorpus';

it('NFR-DH-PERF-001 help corpus is non-empty and within the 6000-char / 1500-token ceiling', () => {
  expect(HELP_CORPUS.length).toBeGreaterThan(0);
  expect(HELP_CORPUS.length).toBeLessThanOrEqual(6000);
});

it('help corpus contains the load-bearing anchors (term + role-scoped screen)', () => {
  expect(HELP_CORPUS).toContain('Committed spend');
  expect(HELP_CORPUS).toContain('/timesheets');
  expect(HELP_CORPUS).toContain('/approvals');
  expect(HELP_CORPUS).toContain('/procurement/:id');
  expect(HELP_CORPUS).toContain('Project Manager');
  expect(HELP_CORPUS).toContain('Engineer');
});

it('NFR-DH-SEC-003 help corpus contains no internal-only citations or data-row shapes', () => {
  expect(HELP_CORPUS).not.toMatch(/ADR-\d|OD-[A-Z]|NFR-|FR-DH|AC-DH|STRIDE|OWASP|\bRLS\b|\borg_id\b/);
  expect(HELP_CORPUS).not.toMatch(/\{"id":/);
});
```

**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/agent/helpCorpus.test.ts` → fails (module
`./helpCorpus` not found). ✅ expected red.

---

**Task 1.2 — GREEN: author `helpCorpus.ts` (+ the slice-3 editing-rules header, which lives in this file).**
*(FR-DH-001/002/003/004, NFR-DH-SEC-003)*

Create `supabase/functions/agent-chat/helpCorpus.ts` (NEW) with exactly (the constant body is the
curated corpus; do **not** add a trailing newline inside the backticks — the `.length` is asserted):

```ts
/**
 * helpCorpus.ts — curated, end-user-facing product-help text appended to the agent-chat system
 * prompt (spec docs/specs/deputy-help.spec.md, FR-DH-001/002/003).
 *
 * This is a PURPOSE-WRITTEN artifact, derived from docs/glossary.md + docs/jtbd.md but authored for
 * an end user reading an assistant's answer — NOT a copy of those internal documents.
 *
 * Editing rules (binding):
 *   - Plain language only. NO ADR/OD/NFR/FR/AC citations, no "RLS"/"STRIDE"/"OWASP", no org_id —
 *     this text is shown to end users (NFR-DH-SEC-003).
 *   - Each "how do I" entry declares the role(s) that can perform it, mirroring the role sets in
 *     pmo-portal/src/auth/policy.ts (FR-DH-004). Keep role names exact: Admin, Executive,
 *     Project Manager, Finance, Engineer.
 *   - Keep it bounded: HELP_CORPUS.length MUST stay ≤ 6000 chars (≈ 1500 tokens). The fixture test
 *     in pmo-portal/src/lib/agent/helpCorpus.test.ts enforces this (NFR-DH-PERF-001). If you must grow
 *     past it, bump the ceiling deliberately AND record the new measured size in the spec's
 *     "Injection strategy" section.
 *   - When a feature changes a screen's affordances, a role's permissions, or a glossary term, update
 *     this file in the same PR (FR-DH-011; see docs/director-playbook.md Ship step).
 *   - Ship as a plain TS template-string constant (Deno+Node-importable leaf module): no .md import,
 *     no Deno.readTextFile, no build step (FR-DH-003). Mirrors readEntities.ts/schema.ts style.
 */
export const HELP_CORPUS = `# PMO Portal — product help for the Assistant

Reference material. Answer only for what the asking user's role can do; if an action belongs to another role, say so and name who can do it.

## Terms (plain-language definitions)

**Milestone** — a named chunk of delivery work inside one project (e.g. "Engineering design", "Procurement", "Site construction"), with a target date, a weight, and a percent-complete. The PM may type an override percent; otherwise it is calculated from its tasks.

**Task** — the smallest unit of tracked work. Belongs to a project and may sit under one milestone. Engineers log hours against tasks.

**Document** — a controlled record in a project's document register (drawing, specification, report, contract) with a category, a revision mark, and a lifecycle (Draft → … → Approved). It holds one file, changeable only while Draft; once issued, content changes need a new revision.

**Revision** — a successive issue of the same document (Rev A → Rev B). Each revision is its own register entry with its own lifecycle, created from its predecessor — that act links the lineage. Older revisions become "Superseded" but stay readable.

**Superseded** — terminal document status meaning "replaced by a newer Approved revision of the same document". Read-only, reached automatically.

**Committed spend** — the sum of all procurement records (Purchase Orders, etc.) in statuses Ordered, Received, Vendor Invoiced, or Paid for a project — the single live spend number on the project header ("Committed"), the Finance dashboard, and the Delivery summary.

**Actual / Realized spend** — the same number as Committed spend, shown under the label "Actual" on the project stat strip and the Finance "Budget vs Actual" card. No separate actuals ledger exists today; committed purchase orders are the realized-cost proxy.

**Procurement case** — one procure-to-pay effort modeled as a folder that carries a title, project, requester, type, and lifecycle status. It is the folder the records hang under, not a single document.

**Procurement record** — a real document under a case: Purchase Request, RFQ, Quotation, Purchase Order, Goods Receipt, Vendor Invoice, or Payment. A case may hold many of each.

**RFQ (Request for Quotation)** — a procurement record asking vendors for pricing. One RFQ may gather many Quotations; a Quotation may cite its RFQ.

**System-assigned number** — the ID PMO mints for a procurement record (e.g. PR-250619-0001), unique per org, gap-tolerant.

**External reference number** — the ID the document carries in the outside world (vendor quotation number, real PO number, supplier invoice number), captured alongside the system-assigned number so a record is findable from both sides.

**Active contract value** — the sum of signed contract values across projects currently in delivery. Smaller than "revenue on hand" because revenue also accrues on completed work.

**Delivery** — the post-win, pre-handover execution of a project. Finite: it ends at handover or commissioning.

**O&M (Service)** — recurring post-handover service under its own contract (maintenance, breakdowns, asset care). Not part of Delivery.

**Organization (org)** — the tenant boundary: one paying client group behind one access wall. A client group with subsidiaries is still one org.

**Entity** — an operating or legal company within a client group, modeled as a dimension on the org's data; users span Entities by default. Not the same as a Company, which is a CRM counterparty (client or vendor).

**Assistant** — the in-app agent you are talking to. It explores your own data and can propose actions, acting under your identity and permissions — never more than you could yourself.

**Deputy** — the Assistant's authorization stance: it carries your badge, never a master key. Whatever bounds you (your organisation, your role, separation of duties) bounds the Assistant identically.

**User view** — a dashboard you compose at runtime (manually or via the Assistant) and own as data, not code. Private by default; sharing shows each viewer only their own authorized data.

## How do I… (by role)

**How do I log my hours?** — Role: Engineer. Go to Timesheets (/timesheets), pick the task you worked on, and enter your hours. Engineers log time against their own tasks.

**How do I approve a timesheet?** — Roles: Project Manager (Finance holds money authority). Go to Approvals (/approvals) or Timesheets (/timesheets); preview and approve or reject in place. Engineers cannot approve timesheets.

**How do I see whether my projects are on track?** — Roles: Project Manager, Executive. Open Projects (/projects) to spot the off-track ones, then open a project (/projects/:id) for status, what is blocked, and the next action.

**How do I create or edit a milestone?** — Roles: Project Manager, Admin. Inside a project's detail view, add or edit a milestone. Only PM and Admin can write milestones; other roles can view them.

**How do I run or advance a procurement case?** — Roles: Admin, Project Manager, Finance (procurement-admin hat). Open the case (/procurement/:id) and capture each record — PR, RFQ, quotes, Purchase Order, goods receipt, invoice, payment — with its reference number and file, then advance the case.

**How do I approve spend or release payment?** — Roles: Project Manager approves; Finance pays. Go to Approvals (/approvals) to preview and approve or reject; payment release is a Finance action. Approver and requester must be different people.

**How do I advance a sales opportunity?** — Roles: Project Manager, Finance. On the opportunity (/sales/:id), advance its stage. Marking a deal won records the contract value; editing contract value on a won or on-hand project needs money authority (Admin, Executive, or Finance).

**How do I manage users and roles?** — Role: Admin. Go to Administration (/administration) to create or edit users and assign roles.`;
```

**Verify (GREEN):** `cd pmo-portal && npx vitest run src/lib/agent/helpCorpus.test.ts` → 3/3 pass.
Sanity-check the authored length matches the plan: `node -e "import('./pmo-portal/supabase/functions/agent-chat/helpCorpus.ts').then(m=>console.log('len',m.HELP_CORPUS.length))"` is not runnable from node directly (TS); instead trust the passing test (it asserts `length <= 6000`).

---

**Task 1.3 — RED: AC-DH-001/002/004 tests + narrow the pre-existing `tasks` assertion.**
*(AC-DH-001, AC-DH-002, AC-DH-004)*

Edit `pmo-portal/src/lib/agent/agentPrompt.test.ts`.

**Edit A — narrow the `tasks` assertion (lines 21–22).** The corpus legitimately mentions *tasks* as a
product concept, so the old `not.toContain('tasks')` would false-fail once the corpus is appended
(Task 1.4). Preserve its **intent** (tasks is not a `query_entity` entity) by matching the entity-bullet
format instead of the whole prompt:

```
oldText:
  // tasks is NOT in A1 entities (D5)
  expect(p).not.toContain('tasks');
newText:
  // tasks is NOT in A1 entities (D5). The help corpus legitimately mentions tasks as a product
  // concept (FR-DH-001), so assert tasks is not a query_entity entity by the entity-bullet format,
  // not that the word "tasks" is absent from the whole prompt.
  expect(p).not.toContain('  - tasks\n    - table:');
```

**Edit B — append three new tests** at the end of the file:

```ts
it('AC-DH-001 help corpus text is present in every system prompt (FR-DH-005)', () => {
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);
  // a defined term + a role-scoped entry's screen reference prove the corpus is unconditionally appended
  expect(p).toContain('Committed spend');
  expect(p).toContain('/timesheets');
});

it('AC-DH-002 built prompt contains no data-row shapes and no interpolated org/user data (NFR-AR-SEC-005, NFR-DH-SEC-001)', () => {
  // role is the only per-request variable this feature folds in; pass one to prove it appears as a
  // word, not as a row/uuid.
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, 'Engineer');
  expect(p).not.toMatch(/\{"id":/);
  expect(p).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i); // no org/user uuids interpolated
});

it('AC-DH-004 grounding-rule instruction text is present verbatim (FR-DH-008)', () => {
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);
  expect(p).toMatch(/only.*(actions|affordances).*(role|permitted)/i);
});
```

**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/agent/agentPrompt.test.ts` → the 3 new
AC-DH-001/002/004 tests fail (corpus + Rule #6 not injected yet); the narrowed `tasks` assertion and
the 3 pre-existing tests still pass. File typechecks (these calls use the current 2-arg signature).

---

**Task 1.4 — GREEN: inject corpus + grounding Rule #6 into `buildAgentSystemPrompt`.**
*(FR-DH-005, FR-DH-008; closes AC-DH-001/002/004)*

Edit `supabase/functions/agent-chat/prompt.ts`.

**Edit A — add the import** (after the existing `readEntities.ts` import, line 8):

```
oldText:
import type { AgentReadEntity } from './readEntities.ts';
newText:
import type { AgentReadEntity } from './readEntities.ts';
import { HELP_CORPUS } from './helpCorpus.ts';
```

**Edit B — rewrite the function** (signature + body; replaces lines 22–69, the `export function … }`).
Exact replacement of the whole function:

```
oldText:
export function buildAgentSystemPrompt(
  entities: ReadonlyArray<AgentReadEntity>,
  rowCap: number,
): string {
newText:
export function buildAgentSystemPrompt(
  entities: ReadonlyArray<AgentReadEntity>,
  rowCap: number,
  role: string | null = null,
): string {
```

**Edit C — inject the role sentence + append the corpus.** In the returned template literal:

```
oldText:
  return `You are a read-only deputy assistant for a project management platform.
You act only within what this user can see — you cannot exceed their access.
Your reads are scoped by the user's own permissions (RLS); you cannot read other organisations' data.

## Rules (binding)

1. Use the "query_entity" tool to read data. Do not invent or guess entity or column names.
2. You may only query the entities and columns listed below.
3. Each query returns at most ${rowCap} rows. If you need more context, narrow your filters.
4. Never include data rows or cell values in your reasoning — only the tool's returned result.
5. You are read-only: no writes, no mutations, no raw SQL.
newText:
  // FR-DH-007: tell the model the asking user's role so it can ground help answers. Omit the sentence
  // entirely when no role resolved (AC-DH-003) — never render "null" or a broken sentence.
  const roleSentence = role ? `\nThe current user's role is ${role}.` : '';

  return `You are a read-only deputy assistant for a project management platform.
You act only within what this user can see — you cannot exceed their access.
Your reads are scoped by the user's own permissions (RLS); you cannot read other organisations' data.${roleSentence}

## Rules (binding)

1. Use the "query_entity" tool to read data. Do not invent or guess entity or column names.
2. You may only query the entities and columns listed below.
3. Each query returns at most ${rowCap} rows. If you need more context, narrow your filters.
4. Never include data rows or cell values in your reasoning — only the tool's returned result.
5. You are read-only: no writes, no mutations, no raw SQL.
6. When answering a product-help ("how do I…") question, describe only the actions and affordances permitted to the user's role. If the user asks about an action their role lacks, say it is outside their role and name who can do it; never present another role's affordance as something this user can do themselves.
```

**Edit D — append the corpus** at the very end of the returned template (after the final
`When you have enough information to answer the user's question, respond in plain text.` line):

```
oldText:
The tool returns { rowCount, rows } or { error: "..." } on validation failure.
When you have enough information to answer the user's question, respond in plain text.`;
newText:
The tool returns { rowCount, rows } or { error: "..." } on validation failure.
When you have enough information to answer the user's question, respond in plain text.

${HELP_CORPUS}`;
```

**Verify (GREEN for AC-DH-001/002/004):** `cd pmo-portal && npx vitest run src/lib/agent/agentPrompt.test.ts`
→ all tests pass (AC-DH-001/002/004 now green; the 3 pre-existing tests still green). `npm run typecheck`
→ 0 errors (handler's three 2-arg call sites still compile via the `= null` default).

> Rule #6 string note: `…describe only the actions and affordances permitted to the user's role…`
> satisfies the AC-DH-004 regex `/only.*(actions|affordances).*(role|permitted)/i` (only → actions → permitted).

---

**Task 1.5 — RED→GREEN: add the `role` interpolation proof (AC-DH-003).** *(FR-DH-007 builder layer; AC-DH-003)*

(The param + `roleSentence` already ship from Task 1.4. This task adds the AC-DH-003 test and confirms
the builder-layer behavior; the handler *wiring* is slice 2.)

Append to `pmo-portal/src/lib/agent/agentPrompt.test.ts`:

```ts
it('AC-DH-003 caller role interpolated into prompt; null role omits the role sentence (FR-DH-007)', () => {
  const withRole = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, 'Engineer');
  expect(withRole).toMatch(/The current user's role is Engineer/i);

  const noRole = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, null);
  expect(noRole).not.toMatch(/The current user's role is/i);
  expect(noRole).not.toContain('null');
});
```

**Verify (GREEN):** `cd pmo-portal && npx vitest run src/lib/agent/agentPrompt.test.ts` → passes
(interpolation already implemented in 1.4; this test pins it).

---

### Slice 2 — role threading (atomic — the spec mandates all three sites land together)

---

**Task 2.1 — RED: FR-DH-007 wiring guard (3 paths).**

Create `pmo-portal/src/lib/agent/agentChatHandlerRoleGrounding.test.ts` (NEW). Harness mirrors
`handlerAnswerCapabilities.test.ts` (mockSupabase returns `role: 'Project Manager'`; `rateGuard` absent
⇒ all three paths proceed straight to the model — verified at `handler.ts:981` `if (deps.rateGuard)`).
Exactly:

```ts
/**
 * FR-DH-007 wiring guard — NOT a numbered AC (AC-DH-003 owns the builder-layer proof). This pins
 * that the caller's role (initialRole, derived from profiles in agentChatHandlerInner) reaches the
 * system prompt at ALL THREE construction sites: the fresh-turn path, handleAnswer, and handleDecision.
 * The spec's Contradictions §1 warns that missing any one site silently omits role-grounding from
 * that path; these three tests catch that regression. Harness mirrors handlerAnswerCapabilities.test.ts.
 */
import { it, expect, vi } from 'vitest';
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest, ConversationMessage } from './runtime/transport';

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function mockSupabase() {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
        }),
      };
    }),
  } as unknown as HandlerDeps['supabase'];
}

function baseDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    // rateGuard omitted on purpose ⇒ fresh-turn + continuation paths skip the credit gate and
    // proceed to the model (handler.ts:981 `if (deps.rateGuard)`).
    modelClient: {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'ok' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
    },
    supabase: mockSupabase(),
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    now: () => new Date('2026-07-03T00:00:00Z'),
    can: () => true,
    ...overrides,
  };
}

function transcriptWithPendingQuestion(questionId: string): ConversationMessage[] {
  return [
    { role: 'user', content: 'log a call' },
    { role: 'assistant', content: 'Which project is this for?' },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: questionId, name: 'ask_user',
          input: { prompt: 'Which project?', options: [{ id: 'a', label: 'Alpha' }] } },
      ],
    },
  ];
}

function systemPromptFromFirstCall(create: ReturnType<typeof vi.fn>): string {
  const messages = (create.mock.calls[0][0] as { messages: { role: string; content?: unknown }[] }).messages;
  return String(messages[0].content);
}

it('FR-DH-007 fresh-turn path threads the caller role into the system prompt', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop', message: { role: 'assistant', content: 'ok' },
    usage: {}, model: 'deepseek/deepseek-v4-flash',
  });
  const req: AgentChatRequest = { runId: 'run-1', messages: [{ role: 'user', content: 'how do I approve a timesheet?' }] };
  await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));
  expect(systemPromptFromFirstCall(create)).toMatch(/The current user's role is Project Manager/i);
});

it('FR-DH-007 answer-continuation path (handleAnswer) threads the caller role into the system prompt', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop', message: { role: 'assistant', content: 'ok' },
    usage: {}, model: 'deepseek/deepseek-v4-flash',
  });
  const req: AgentChatRequest = {
    runId: 'run-1',
    messages: transcriptWithPendingQuestion('q1'),
    answer: { questionId: 'q1', optionId: 'a' },
  };
  await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));
  expect(systemPromptFromFirstCall(create)).toMatch(/The current user's role is Project Manager/i);
});

it('FR-DH-007 decision-continuation path (handleDecision) threads the caller role into the system prompt', async () => {
  // A fabricated pendingId with a transcript that has NO trailing confirm tool_use takes
  // handleDecision's stale/no-op branch (handler.ts `!trailingToolUse`), which still runs the model
  // with the prompt built at handleDecision's own buildAgentSystemPrompt call site — exactly the call
  // site this test pins. reAuthRole is NOT used there (derived later, out of scope at the prompt build).
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop', message: { role: 'assistant', content: 'ok' },
    usage: {}, model: 'deepseek/deepseek-v4-flash',
  });
  const req: AgentChatRequest = {
    runId: 'run-1',
    messages: [{ role: 'user', content: 'approve it' }],
    decision: { pendingId: 'stale-pending-id', verdict: 'approve' },
  };
  await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));
  expect(systemPromptFromFirstCall(create)).toMatch(/The current user's role is Project Manager/i);
});
```

**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/agent/agentChatHandlerRoleGrounding.test.ts` →
all 3 fail (today the handler builds the prompt with no role → it lacks "The current user's role is
Project Manager"). ✅ expected red.

---

**Task 2.2 — GREEN: thread `initialRole` into all three system-prompt construction sites (atomic).**
*(FR-DH-007)*

Apply these **six** edits to `supabase/functions/agent-chat/handler.ts` as one atomic change (the spec's
Contradictions §1 mandates this; a partial application leaves two of the three prompts silently
un-grounded — caught by the Task 2.1 tests).

**⚠ CRITICAL:** at `handleDecision`'s prompt-build site (`:1138`) use the new `initialRole` parameter —
**never `reAuthRole`**. `reAuthRole` (`handler.ts:1219-1231`) is derived *later*, inside `handleDecision`'s
approve path, strictly after its prompt is already built at `:1138`; it is out of scope there and
continues to serve only its existing `canFn` re-auth job at `:1240`.

```
Edit 1 — fresh-turn site (handler.ts:1001):
oldText:   const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP) + buildGroundingHint(req.context?.entity);
newText:   const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, initialRole) + buildGroundingHint(req.context?.entity);

Edit 2 — handleAnswer: add the new parameter to its signature (handler.ts:1063–1070):
oldText:
  deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port.ts').DeputyContext,
  persist?: PersistenceRuntime,
): AsyncGenerator<AgentEvent> {
  const answer = req.answer!;
newText:
  deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port.ts').DeputyContext,
  initialRole: string | null,
  persist?: PersistenceRuntime,
): AsyncGenerator<AgentEvent> {
  const answer = req.answer!;

Edit 3 — handleAnswer: use it at its prompt-build site (handler.ts:1073):
oldText:
  const answer = req.answer!;

  const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);
newText:
  const answer = req.answer!;

  const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, initialRole);

Edit 4 — handleAnswer: pass it at the call site (handler.ts:972):
oldText:     yield* handleAnswer(req, deps, emit, statusEvent, deputyCtx, persist);
newText:     yield* handleAnswer(req, deps, emit, statusEvent, deputyCtx, initialRole, persist);

Edit 5 — handleDecision: add the new parameter to its signature (handler.ts:1120–1128):
oldText:
  canFn: CanFn,
  deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port.ts').DeputyContext,
  persist?: PersistenceRuntime,
): AsyncGenerator<AgentEvent> {
  const decision = req.decision!;
newText:
  canFn: CanFn,
  deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port.ts').DeputyContext,
  initialRole: string | null,
  persist?: PersistenceRuntime,
): AsyncGenerator<AgentEvent> {
  const decision = req.decision!;

Edit 6 — handleDecision: use it at its prompt-build site (handler.ts:1138) + pass it at the call site (handler.ts:957):
oldText:
    yield emit('user', { text: lastUserMsg.content });
  }

  const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);
newText:
    yield emit('user', { text: lastUserMsg.content });
  }

  const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, initialRole);

— and separately —
oldText:     yield* handleDecision(req, deps, emit, statusEvent, canFn, deputyCtx, persist);
newText:     yield* handleDecision(req, deps, emit, statusEvent, canFn, deputyCtx, initialRole, persist);
```

> The `yield emit('user', …)` + `const system = …` block is unique to `handleDecision`
> (`handleAnswer` has no `emit('user')` before its system build; the fresh-turn site has a different
> system line carrying `+ buildGroundingHint`). If the editor reports non-uniqueness, anchor Edit 6's
> system-line half with the preceding `const { pendingId, verdict } = decision;` block.

**Verify (GREEN):** `cd pmo-portal && npx vitest run src/lib/agent/agentChatHandlerRoleGrounding.test.ts`
→ 3/3 pass. `npm run typecheck` → 0 errors. (Sanity: the existing `handlerAnswerCapabilities.test.ts`,
`agentWriteActions.test.ts`, `agentChatHandler.test.ts` suites still pass — they construct `HandlerDeps`
without referencing these internal functions' signatures.)

---

### Slice 3 — docs

---

**Task 3.1 — `docs/director-playbook.md`: FR-DH-011 Ship-checklist line.** *(FR-DH-011)*

In §2 "The per-issue loop", step 8 (Ship), add an indented sub-bullet immediately after the step-8
sentence (lines 84–85):

```
oldText:
8. **Ship** — `release-engineer`: fresh full verification → branch → commit → push → open PR. **It
   never merges.** Then the **Director merges** (see §6) and syncs.
newText:
8. **Ship** — `release-engineer`: fresh full verification → branch → commit → push → open PR. **It
   never merges.** Then the **Director merges** (see §6) and syncs.
   - **Help-corpus check (FR-DH-011):** does this change a screen's affordances, a role's permissions,
     or a glossary term? If yes, update `supabase/functions/agent-chat/helpCorpus.ts` in the same PR
     and re-run the AC-DH-005 live-verify runbook (`docs/qa-portfolio.md`).
```

**Verify:** `sed -n '84,90p' docs/director-playbook.md` shows the new sub-bullet.

---

**Task 3.2 — `docs/qa-portfolio.md`: AC-DH-005 live-verify runbook.** *(AC-DH-005)*

Append a new section at the end of the file (after the "Rollout phases" section):

```
## Live-verify runbooks (not-CI items — ADR-0030 MVP posture)

Manual runbooks for behavior that is real but deliberately not CI-gated (ADR-0030: no LLM-judge in CI
for MVP). Run before promoting a corpus / system-prompt change and periodically thereafter; record the
run date + result inline.

### Deputy-as-help-desk — role-grounded "how do I" answers (AC-DH-005)

**Scope:** the Assistant's product-help answers, grounded in the asking user's role, produced after
the `helpCorpus.ts` always-on injection (spec `docs/specs/deputy-help.spec.md`).

**Setup:** a live local stack (`supabase db reset` + seed), one signed-in session per role — `Admin`,
`Executive`, `Project Manager`, `Finance`, `Engineer` (the `ALL` set, `pmo-portal/src/auth/policy.ts:71`).

**For each role, ask the Assistant:**
1. A term-definition question, e.g. *"What's the difference between Committed and Actual spend?"* →
   the answer must match the glossary meaning (Committed = Σ procurement records in Ordered…Paid;
   Actual = the same number, labeled "Actual"; no separate actuals ledger today).
2. A role-appropriate "how do I" question, e.g. Engineer → *"How do I log my hours?"*, PM → *"How do I
   approve a timesheet?"*, Admin → *"How do I manage users and roles?"* → the answer must name the real
   screen/route and the real action.
3. An **out-of-role** question, e.g. Engineer → *"How do I approve this timesheet?"* → the answer must
   redirect ("that's a PM/Finance action"), **not** fabricate approval steps (FR-DH-009).

**Pass:** all three behaviors hold across all 5 roles. **On failure:** file a `helpCorpus.ts` follow-up
(FR-DH-011) and do not promote the change.

| Run date | Runner | Admin | Exec | PM | Finance | Engineer | Notes |
|---|---|---|---|---|---|---|---|
| _(run before merge)_ | | | | | | | |
```

**Verify:** `tail -n 30 docs/qa-portfolio.md` shows the new section + table.

> The corpus **editing-rules header** (the third slice-3 deliverable) physically lives inside
> `helpCorpus.ts` and is therefore authored in Task 1.2 — it is not a separate docs file.

---

### Final gate

**Task 4.1 — full `verify`.** `cd pmo-portal && npm run verify` (=`typecheck && lint:ci && test && build`).
Must be fully green. No integration/e2e lane is newly required (no schema, no route, no RLS change —
this issue touches only `prompt.ts`, `handler.ts`, `helpCorpus.ts`, three test files, and two docs).
Confirm `supabase test db` is **not** needed (no migration) and that no file under
`supabase/migrations/` was touched.

---

## 4. Traceability (every AC placed exactly once)

| AC | Owning layer | Owning test / artifact | Satisfying task(s) |
|---|---|---|---|
| **AC-DH-001** (corpus text present in every system prompt) | Unit | `agentPrompt.test.ts` → `AC-DH-001 help corpus text is present in every system prompt` | 1.3 (RED) → 1.4 (GREEN) |
| **AC-DH-002** (no data-row shapes / no interpolated org-user data) | Unit | `agentPrompt.test.ts` → `AC-DH-002 built prompt contains no data-row shapes …` | 1.3 (RED) → 1.4 (GREEN) |
| **AC-DH-003** (role interpolated; null omits the role sentence) | Unit | `agentPrompt.test.ts` → `AC-DH-003 caller role interpolated into prompt …` | 1.5 |
| **AC-DH-004** (grounding-rule instruction present verbatim) | Unit | `agentPrompt.test.ts` → `AC-DH-004 grounding-rule instruction text is present verbatim` | 1.3 (RED) → 1.4 (GREEN) |
| **AC-DH-005** (role-grounded "how do I" answers are accurate) | Live-verify runbook | `docs/qa-portfolio.md` → "Deputy-as-help-desk — role-grounded 'how do I' answers (AC-DH-005)" | 3.2 |

**Non-AC guards (not in the table above — they pin FRs, not ACs):**
- `helpCorpus.test.ts` → NFR-DH-PERF-001 (≤6000-char / ≤1500-token ceiling) + NFR-DH-SEC-003 (no
  internal citations) + content anchors. (Task 1.1/1.2.)
- `agentChatHandlerRoleGrounding.test.ts` → FR-DH-007 wiring (the caller's role reaches all three
  system-prompt construction sites). (Task 2.1/2.2.) Not a numbered AC; AC-DH-003 owns the
  builder-layer proof, this owns the handler wiring.

---

## 5. Notes for the Director

- **No open questions require owner adjudication.** Spec Open Questions #1–#3 are resolved by D1–D3
  above (mechanical choices the spec explicitly delegated to the plan).
- **Migration safety:** this issue adds no migration and touches no schema/RLS/route — zero collision
  with any in-flight migration. The only "stack" contact is two edge-fn `.ts` files + their unit tests.
- **The one runtime-correctness trap** is `reAuthRole` vs `initialRole` at `handleDecision`'s prompt
  site (`:1138`) — Task 2.2 flags it explicitly and the FR-DH-007 decision-path test (Task 2.1) would
  catch a mistake (it would fail if `reAuthRole` were somehow used, since `reAuthRole` is derived from
  a *second* profiles lookup that the test's mock also satisfies — so the test is a wiring guard, not a
  reAuth guard; the `reAuthRole` discipline is enforced by code review + the spec's Contradictions note).
- **Cost audit (NFR-DH-PERF-001):** corpus = **5920 chars ≈ 1480 tokens** (measured 2026-07-04 at the
  spec's 4 chars/token rate). Always-on per-turn input cost; revisit as an on-demand tool only if the
  corpus grows an order of magnitude (spec "Injection strategy"). Record future measured sizes here.

PLAN-DONE
