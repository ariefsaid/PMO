# Implementation plan — Agent transcript interaction contracts (typed widgets · ask-user · live context)

- **Date:** 2026-07-03
- **Issue:** PMO agent-transcript-contracts (batteries-included A) — ADR-0045.
- **Author:** eng-planner (Claude Opus 4.8 · 1M)
- **Spec:** `docs/specs/agent-transcript-contracts.spec.md` (FR-ATC-001..020, OBS-ATC-001..005, NFR-ATC-SEC/PERF/A11Y, AC-ATC-001..017 + traceability table)
- **Binding ADR:** `docs/adr/0045-agent-transcript-interaction-contracts.md` (**ADR-0045 wins over spec on any conflict**)
- **Format model:** `docs/plans/2026-07-03-agent-persistence.md` (same shape/style/verify discipline).

> ## ⚠ WARNING — POST-MERGE DRIFT (read before building)
> This plan was written against the **`feat/agent-persistence`** branch, treating **issue-2 (ADR-0043
> persistence) content as the PRESENT baseline**: migration `0046_agent_persistence.sql`,
> `supabase/functions/agent-chat/persistence.ts`, `src/lib/db/agentThreads.ts`+`agentEvents.ts`+`agentRuns.ts`,
> and panel `ThreadList`/`StuckRunBanner`/`FeedbackControl` all EXIST at the exact line numbers cited
> below. **Before starting, `git rebase`/merge this issue onto the latest `feat/agent-persistence` (or its
> successor once issue-2 lands on `dev`) and re-grep the anchor lines** (`handler.ts` emit sites,
> `createThreadAndRun` call at handler.ts:353, `useAssistantPanel` approve/deny at :277-297,
> `TranscriptItem` `artifact`/`status` switch at :64-131, `AssistantPanel` context-of-render). If any
> anchor moved, adjust the task's line reference — the requirement/AC mapping does not change, only the
> insertion point. **NO schema change is expected (no migration).** If §3's `agent_threads.scope` write
> forces a schema/column change (it must NOT — the column already exists, jsonb, nullable), **STOP and
> escalate to the Director** rather than authoring a migration in this issue.

---

## 0. Authority reconciliation & conflicts found (binding — read before building)

ADR-0045 is Accepted and controlling; the spec operationalizes it faithfully. **No requirement-level
conflict between ADR-0045 and the spec was found** (the spec's own "Contradictions / conflicts flagged"
section confirms this). The eng-plan resolves the spec's four explicitly-delegated mechanical choices and
one repo-reality correction below. None needs owner adjudication (the spec grants file-name/wire-shape
picks to the plan, per the Companies/`user_views`/agent-persistence precedent).

| ID | Decision the spec/ADR left to the plan | Resolution (binding for this plan) |
|---|---|---|
| **DEC-1** — answer re-POST wire shape (Open Q 1 / FR-ATC-011) | New `AgentChatRequest.answer` field alongside `decision`, **OR** widen `decision.verdict`. | **New `AgentChatRequest.answer?: AgentAnswer` field** (`transport.ts`), sibling to `decision`. Reads cleaner against `findTrailingConfirmToolUse`'s generalization (a `question` resolution is structurally distinct from an approve/reject verdict — a separate field keeps the A3 `decision` union untouched, satisfying OBS-ATC-002 by construction). `AgentAnswer = { questionId: string; optionId?: string; freeText?: string }`. |
| **DEC-2** — which action returns widget results (Open Q 2 / FR-ATC-002) | Reshape `query_entity` result, or add a thin wrapper action. | **Reshape `query_entity`'s result at the HANDLER emit site, not inside the action.** `runQueryEntity` stays byte-unchanged (it returns `{rowCount, rows}`). The handler, when the model's `query_entity` tool call carries an optional `as: 'table'` framing hint (added to `QUERY_ENTITY_SCHEMA` as an OPTIONAL enum, non-breaking), maps `{rows, columns-from-select}` → a `DataTableWidget` and runs it through the widget emit path (Phase X). Smallest diff; no new action in the catalog; `query_entity` keeps its single read contract. Chart/insight framings are v1-schema-valid but **not** auto-produced by any action in this issue — they are exercised by unit tests with hand-built payloads (the registry/validation is the deliverable; an action that emits them is a future issue, and the spec only mandates the *table* path end-to-end via AC-ATC-017). |
| **DEC-3** — promote `zod` to a direct dep now vs. prerequisite issue (Open Q 3 — **flagged for Director**) | — | **Promote in THIS issue** (spec's own recommendation). One-line `pmo-portal/package.json` change (`dependencies.zod`), gated behind the widget-schema module this issue builds; also add `zod` to `supabase/functions/agent-chat/deno.json` imports so the SHARED schema module resolves under Deno. Recorded as an **open question for the Director to confirm** (§6 Q1) but planned as in-issue since splitting adds PR-sequencing cost for zero isolation benefit. |
| **DEC-4** — `RunContext.entityId?` deprecation (Contradictions §2) | Deprecate/migrate or leave dormant. | **Leave dormant, mark `@deprecated`.** A repo grep confirms **no caller populates `entityId`** today (`grep -rn 'entityId' pmo-portal/src` → only the field decl at `port.ts:49`). Retain it (FR-ATC-014 says "not removed in this issue"), add a `/** @deprecated use entity.id */` JSDoc; do not migrate or delete. |
| **REC-1** — edge-fn logic test location (standing convention) | Traceability names handler tests at `supabase/functions/agent-chat/*.test.ts`. | **Handler/persistence widget+question+context tests live under `pmo-portal/src/lib/agent/*.test.ts`** and import across the boundary via the existing relative path (`import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler'`), matching the shipped `agentChatHandler.test.ts` / `handlerPersistence.test.ts` pattern — there is no Vitest project rooted in `supabase/`. AC-ids unchanged; the traceability table below records the ACTUAL files. |

**Constants/shapes this plan fixes (spec left them to the eng-plan):**
- **Widget schema module:** `pmo-portal/src/lib/agent/widgets/schema.ts` (shared, imported by edge fn via relative path + by SPA via `@/`).
- **Renderer registry:** `pmo-portal/src/components/panel/widgets/registry.tsx` (a `kind → (widget) => ReactElement` map — `.tsx`, it returns JSX).
- **Widget slot component:** `pmo-portal/src/components/panel/widgets/WidgetSlot.tsx` (client re-validate + registry dispatch + text fallback).
- **Question chips component:** `pmo-portal/src/components/panel/QuestionChips.tsx` (mirrors `ApprovalChip.tsx`).
- **`AgentAnswer` type** (DEC-1): `{ questionId: string; optionId?: string; freeText?: string }` — added to `transport.ts`.
- **`control('answer')` payload:** `runtime.control(runId, 'answer', { optionId?, freeText? })` — the SPA adapter stashes it onto the pending `AgentChatRequest.answer` (mirroring the A3 `pendingDecision` stash).
- **Question id:** the server-emitted `QuestionPayload` carries a `questionId` (server-minted `makeId()`, exactly like `pendingId` for A3), echoed back on the answer for positional correlation.

---

## 1. Architecture & data flow

```
Browser (flag agentAssistant ON)
  AssistantPanel ── useAssistantPanel (hook, src/hooks/)
     ├─ Transcript → TranscriptItem  (EDIT: +artifact{kind:'widget'} case → WidgetSlot;
     │                                        +status{kind:'question'} case → QuestionChips)
     │      ├─ WidgetSlot (NEW)     → client-revalidate (widgets/schema.ts, SAME zod)
     │      │                          → registry (widgets/registry.tsx) → DataTable/StatusBarChart/KPITile
     │      │                          → text fallback on any failure/unknown kind (never executable)
     │      └─ QuestionChips (NEW)  → tappable option <button>s + optional free-text
     ├─ answerQuestion(qid,optionId?,freeText?) (hook, NEW) → runtime.control(runId,'answer',payload)
     └─ AgentContextProvider (NEW) → {route,entity?,selection?} on createRun + followUp

  PmoNativeRuntime (adapter) — control() gains 'answer' verb (stashes AgentChatRequest.answer)
                             — createRun/followUp already thread context (RunState.context)
        POST /functions/v1/agent-chat  { messages, context?, decision? | answer? }
                                                              │
supabase/functions/agent-chat/ (Deno edge fn, caller-JWT deputy — unchanged auth)
  port.ts        (EDIT: control union += 'answer'; RunContext += entity/selection; +WidgetPayload/QuestionPayload/AgentAnswer types re-export site)
  transport.ts   (EDIT: AgentChatRequest.answer?; AgentAnswer type)
  widgets/schema.ts (NEW, under pmo-portal/src/lib/agent/widgets — SHARED zod, imported here by relative path)
  handler.ts     (EDIT: widget emit path (validate→emit artifact|fallback text);
                        question resolution branch (req.answer → findTrailingQuestion → resume same run, idempotent);
                        context grounding (inject entity hint into system/context message — READ ONLY);
                        narrow scope write: createThreadAndRun scope = req.context?.entity (not req.context))
  actions.ts     (EDIT: QUERY_ENTITY_SCHEMA gains optional `as:'table'` framing hint — non-breaking)
  persistence.ts (UNCHANGED — createThreadAndRun already takes scope?: unknown; handler narrows the arg)
                                                              │
Postgres — NO schema change. agent_threads.scope (jsonb, nullable) already exists (0046). §3 only
           changes WHAT the handler passes as `scope` (entity, not whole context). §3 reuses
           agent-persistence.spec's RLS/tenancy proofs (AC-AGP-004..008) — no new pgTAP.
```

**Port stays a superset (OBS-ATC-002/003, AC-ATC-011).** `AgentEventType` gains **no** member; both widgets
and questions ride existing `artifact`/`status` types via a new payload `kind` discriminant. `control`'s
command union gains `'answer'` only — every existing verb keeps its signature.

**Untrusted-output boundary is enforced TWICE (ADR-0039 extended, ADR-0045 §1).** The SAME
`WIDGET_PAYLOAD_SCHEMA` (widgets/schema.ts) is `.safeParse`d server-side before emit (FR-ATC-003) and
client-side before render (FR-ATC-004). A failure → text fallback, never a throw, never partial render,
never executable content (NFR-ATC-SEC-002, FR-ATC-006).

**Context is grounding-only (deputy invariant, FR-ATC-016, NFR-ATC-SEC-003).** `req.context` is injected
into the model's system/context message as a hint; **no** code path reads it to select a client, skip
`can()`, or bypass `dispatchAction`. A forged `entity.id` degrades to a normal zero-row RLS read under the
caller JWT (AC-ATC-013) — the existing `runQueryEntity` + caller-scoped `deps.supabase` are untouched.

---

## 2. File tree (exact paths — NEW unless marked EDIT)

```
supabase/functions/agent-chat/
  deno.json                                          EDIT  add "zod" import (npm:zod) so widgets/schema.ts resolves under Deno
  port.ts                                            EDIT  control union += 'answer'; RunContext += entity/selection (entityId @deprecated)
  transport.ts                                       EDIT  AgentAnswer type; AgentChatRequest.answer?
  actions.ts                                         EDIT  QUERY_ENTITY_SCHEMA optional `as:'table'` hint (non-breaking)
  handler.ts                                         EDIT  widget emit path; question resolution branch; context grounding; scope-narrow at createThreadAndRun call
pmo-portal/
  package.json                                       EDIT  dependencies.zod (DEC-3)
  src/
    lib/agent/
      widgets/
        schema.ts                                    NEW   WIDGET_PAYLOAD_SCHEMA zod discriminated union + types (FR-ATC-001), SHARED
        schema.test.ts                               NEW   FR-ATC-001 schema accepts/rejects the three kinds + malformed
      handlerWidgets.test.ts                         NEW   AC-ATC-001/002 (server validate→emit|fallback)  [REC-1]
      handlerQuestion.test.ts                        NEW   AC-ATC-009/010 (answer resolves same run; idempotent) [REC-1]
      handlerContext.test.ts                         NEW   AC-ATC-012/013/014/015/016 (grounding; forged id 0-row; scope write) [REC-1]
    lib/agent/runtime/
      port.test.ts                                   EDIT  AC-ATC-011 control superset assertion (currently only the purity test)
    components/panel/
      widgets/
        registry.tsx                                 NEW   kind → PMO component map (FR-ATC-005)
        registry.test.tsx                            NEW   AC-ATC-005/006 (data_table→DataTable, data_insight→KPITile)
        WidgetSlot.tsx                               NEW   client re-validate + registry dispatch + text fallback (FR-ATC-004/005/006)
        WidgetSlot.test.tsx                          NEW   AC-ATC-003/004 (client revalidate fallback; unregistered kind no iframe)
      QuestionChips.tsx                              NEW   options as buttons + optional free-text (FR-ATC-009, NFR-ATC-A11Y-002)
      QuestionChips.test.tsx                         NEW   AC-ATC-007/008 (chips render; tap→control answer not followUp)
      TranscriptItem.tsx                             EDIT  +artifact{kind:'widget'}→WidgetSlot; +status{kind:'question'}→QuestionChips
      TranscriptItem.widgets.test.tsx                (covered by WidgetSlot.test.tsx — see traceability)
    hooks/
      useAssistantPanel.ts                           EDIT  answerQuestion(qid,optionId?,freeText?); thread question payload into transcript
    lib/agent/context/
      AgentContextProvider.tsx                       NEW   route/entity/selection provider → context on createRun/followUp (FR-ATC-015)
      useAgentContext.ts                             NEW   hook read side (host pages expose selected-entity via this)
  e2e/
    AC-ATC-017-widget-question-context.spec.ts       NEW   over-budget table inline + question chip continues same run
docs/
  adr/                                                (0045 already exists — NO new ADR; this plan records no new arch decision)
```

**No new ADR.** ADR-0045 records every architectural decision (the widget union, the `control('answer')`
verb, the live-context shape, the twice-validated boundary, feature-flag gating). This plan introduces no
irreversible/cross-cutting decision beyond it; the four mechanical choices (DEC-1..4) are recorded in §0.

---

## 3. Traceability (AC → owning test, ADR-0010 lowest-sufficient layer)

| AC | Layer | Owning test (title / file) |
|---|---|---|
| AC-ATC-001 | Unit | `AC-ATC-001 valid DataTableWidget passes zod, emits artifact widget` · `pmo-portal/src/lib/agent/handlerWidgets.test.ts` |
| AC-ATC-002 | Unit | `AC-ATC-002 malformed widget never emitted, falls back to assistant text` · `handlerWidgets.test.ts` |
| AC-ATC-003 | Unit | `AC-ATC-003 client re-validates, renders text fallback on failure` · `pmo-portal/src/components/panel/widgets/WidgetSlot.test.tsx` |
| AC-ATC-004 | Unit | `AC-ATC-004 unregistered kind renders text fallback, no iframe/eval` · `WidgetSlot.test.tsx` |
| AC-ATC-005 | Unit | `AC-ATC-005 data_table renders via registry as DataTable` · `pmo-portal/src/components/panel/widgets/registry.test.tsx` |
| AC-ATC-006 | Unit | `AC-ATC-006 data_insight renders via registry as KPITile` · `registry.test.tsx` |
| AC-ATC-007 | Unit | `AC-ATC-007 question payload renders as chips` · `pmo-portal/src/components/panel/QuestionChips.test.tsx` |
| AC-ATC-008 | Unit | `AC-ATC-008 tapping chip calls control answer not followUp` · `QuestionChips.test.tsx` |
| AC-ATC-009 | Unit | `AC-ATC-009 answer resolves same run, no new createRun` · `pmo-portal/src/lib/agent/handlerQuestion.test.ts` |
| AC-ATC-010 | Unit | `AC-ATC-010 duplicate answer is idempotent no-op` · `handlerQuestion.test.ts` |
| AC-ATC-011 | Unit | `AC-ATC-011 control verb set is a superset, answer added, no existing member changed` · `pmo-portal/src/lib/agent/runtime/port.test.ts` |
| AC-ATC-012 | Unit | `AC-ATC-012 context.entity grounds query_entity read` · `pmo-portal/src/lib/agent/handlerContext.test.ts` |
| AC-ATC-013 | Unit | `AC-ATC-013 forged context entity id yields zero rows not elevated access` · `handlerContext.test.ts` |
| AC-ATC-014 | Unit | `AC-ATC-014 createRun with context.entity populates thread scope` · `handlerContext.test.ts` |
| AC-ATC-015 | Unit | `AC-ATC-015 createRun with no entity writes scope null` · `handlerContext.test.ts` |
| AC-ATC-016 | Unit | `AC-ATC-016 follow-up context does not overwrite existing scope` · `handlerContext.test.ts` |
| AC-ATC-017 | E2E | `AC-ATC-017 over-budget table renders inline, question chip continues run` · `pmo-portal/e2e/AC-ATC-017-widget-question-context.spec.ts` |

Supporting (non-owning) references: `schema.test.ts` exercises FR-ATC-001 at the schema layer (the shape
proof underpinning AC-ATC-001..006); `TranscriptItem`'s two new switch cases are exercised through
`WidgetSlot.test.tsx`/`QuestionChips.test.tsx` (the owning render assertions live there).

---

## PHASE W — Widget schemas + renderer registry + slot (⚑ WORKTREE-PARALLELIZABLE — ALL NEW FILES)

> **Parallel-safety:** Phase W touches **only NEW files** (`widgets/schema.ts` + test, `widgets/registry.tsx`
> + test, `WidgetSlot.tsx` + test) plus **two one-line non-behavioral additions** (`package.json` zod dep,
> `deno.json` zod import). It has **zero edits to `handler.ts`/`port.ts`/`transport.ts`/`TranscriptItem.tsx`**
> — it is fully buildable and testable in an isolated worktree BEFORE Phases Q/X exist. Wire it into
> `TranscriptItem` only in the Integration phase (Task I1). Dispatch this whole phase to a parallel agent;
> the only shared-file contact is the additive `package.json`/`deno.json` lines (de-dup on integrate).

### Task W0 — Add `zod` as a direct dependency (DEC-3) — supports FR-ATC-001, NFR-ATC-SEC-001
**Files:** `pmo-portal/package.json` (EDIT), `supabase/functions/agent-chat/deno.json` (EDIT)
- In `pmo-portal/package.json`, add to `dependencies` (alphabetical position): `"zod": "^3.23.8"`. Run
  `npm install` from `pmo-portal/` to write the lockfile (use `npm install` here to ADD the dep; CI/verify
  later uses `npm ci`).
- In `supabase/functions/agent-chat/deno.json`, add to `imports`: `"zod": "npm:zod@^3.23.8"` (so the shared
  `widgets/schema.ts`, imported by the edge fn via relative path, resolves `zod` under Deno). Keep the
  existing `@supabase/supabase-js` entry.

**Verify:** from `pmo-portal/`: `node -e "require('zod'); console.log('zod resolvable')"` → prints the line;
`git diff --stat package.json deno.json` shows only the two additions.

### Task W1 — `WIDGET_PAYLOAD_SCHEMA` failing test (RED) — FR-ATC-001, NFR-ATC-SEC-001
**File:** `pmo-portal/src/lib/agent/widgets/schema.test.ts` (NEW)
Import `{ WIDGET_PAYLOAD_SCHEMA, type WidgetPayload }` from `'./schema'`. Assert with `.safeParse`:
- A `DataTableWidget` `{ kind:'data_table', columns:[{key:'name',label:'Project'}], rows:[{name:'Alpha'}] }` → `.success === true`.
- A `DataChartWidget` `{ kind:'data_chart', chartType:'bar', series:[{label:'A',value:3}] }` → `.success === true`; `chartType:'pie'` (not in the `'bar'|'line'|'donut'` enum) → `.success === false`.
- A `DataInsightWidget` `{ kind:'data_insight', label:'Over-budget projects', value:3 }` → `.success === true`; with `delta:{dir:'up',text:'+2'}` and `tone:'red'` → success; `tone:'cyan'` → failure (tone enum mirrors `KPITone` = `'blue'|'violet'|'amber'|'red'|'green'`).
- Malformed: `{ kind:'data_table', columns:[{key:'name',label:'P'}], rows:'not-an-array' }` → `.success === false`.
- Missing discriminant: `{ columns:[], rows:[] }` (no `kind`) → `.success === false`.
- Unknown kind: `{ kind:'iframe_app' }` → `.success === false`.

**Verify (fails):** from `pmo-portal/`: `npx vitest run src/lib/agent/widgets/schema.test.ts` → module-not-found.

### Task W2 — `schema.ts` (GREEN for W1) — FR-ATC-001
**File:** `pmo-portal/src/lib/agent/widgets/schema.ts` (NEW)
```ts
import { z } from 'zod';

/** v1 chart types — mirrors StatusBarChart's visual vocabulary (ADR-0045 §1). */
export const CHART_TYPES = ['bar', 'line', 'donut'] as const;
/** v1 insight tones — mirrors KPITone ('blue'|'violet'|'amber'|'red'|'green'). */
export const INSIGHT_TONES = ['blue', 'violet', 'amber', 'red', 'green'] as const;

const dataTable = z.object({
  kind: z.literal('data_table'),
  columns: z.array(z.object({ key: z.string(), label: z.string() })),
  rows: z.array(z.record(z.string(), z.unknown())),
  caption: z.string().optional(),
});
const dataChart = z.object({
  kind: z.literal('data_chart'),
  chartType: z.enum(CHART_TYPES),
  series: z.array(z.object({ label: z.string(), value: z.number() })),
  caption: z.string().optional(),
});
const dataInsight = z.object({
  kind: z.literal('data_insight'),
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  delta: z.object({ dir: z.enum(['up', 'down', 'neutral']), text: z.string() }).optional(),
  tone: z.enum(INSIGHT_TONES).optional(),
});

/** ADR-0045 §1 — the SOLE validation authority (NFR-ATC-SEC-001). Server + client import THIS. */
export const WIDGET_PAYLOAD_SCHEMA = z.discriminatedUnion('kind', [dataTable, dataChart, dataInsight]);
export type WidgetPayload = z.infer<typeof WIDGET_PAYLOAD_SCHEMA>;
export type DataTableWidget = z.infer<typeof dataTable>;
export type DataChartWidget = z.infer<typeof dataChart>;
export type DataInsightWidget = z.infer<typeof dataInsight>;
```
Import `zod` bare (`from 'zod'`) — resolvable by Vitest (Task W0 dep) and by Deno (Task W0 import map).

**Verify (green):** `npx vitest run src/lib/agent/widgets/schema.test.ts` → pass.

### Task W3 — Renderer registry failing test (RED) — AC-ATC-005/006, FR-ATC-005, NFR-ATC-A11Y-001
**File:** `pmo-portal/src/components/panel/widgets/registry.test.tsx` (NEW)
Wrap renders in `<MemoryRouter>` (KPITile/DataTable pull `react-router-dom`). Import `{ renderWidget }` from `'./registry'`.
- **AC-ATC-005:** `render(renderWidget({ kind:'data_table', columns:[{key:'name',label:'Project'}], rows:[{name:'Alpha'}] }))`; assert `screen.getByText('Alpha')` is present AND a real table cell exists (`screen.getByRole('cell', { name: 'Alpha' })` at desktop width — DataTable's desktop branch renders `<table>`); assert NO `<pre>`/markdown block (`expect(document.querySelector('pre')).toBeNull()`). Title: `AC-ATC-005 data_table renders via registry as DataTable`.
- **AC-ATC-006:** `render(renderWidget({ kind:'data_insight', label:'Over-budget projects', value:3 }))`; assert `screen.getByText('Over-budget projects')` and `screen.getByText('3')` present (KPITile renders label + value). Title: `AC-ATC-006 data_insight renders via registry as KPITile`.

**Verify (fails):** `npx vitest run src/components/panel/widgets/registry.test.tsx` → module-not-found.

### Task W4 — `registry.tsx` (GREEN for W3) — FR-ATC-005, NFR-ATC-A11Y-001
**File:** `pmo-portal/src/components/panel/widgets/registry.tsx` (NEW)
Export `renderWidget(widget: WidgetPayload): React.ReactElement` — a `switch (widget.kind)` (the same
switch-over-registry shape `HydratedPrimitive.tsx` uses), mapping each kind to an existing PMO primitive:
- `data_table` → `<DataTable rows={widget.rows} columns={widget.columns.map(c => ({ key:c.key, header:c.label, cell:(row)=> row[c.key]==null?'':String(row[c.key]) }))} rowKey={(r)=>String(r.id ?? JSON.stringify(r))} />` (import from `@/src/components/ui/DataTable`; hydrates the shipped component → inherits its table semantics/a11y, NFR-ATC-A11Y-001).
- `data_chart` → wrap `<StatusBarChart>` in a `<ChartFrame state="ready">`; map `series` → `data:[{status:label,count:value}]`, `toneFor` cycling `chartTheme.series` (copy the `HydratedPrimitive` StatusBarChart tone helper), `label`/`noun` from `caption ?? 'Results'`/`'items'`. (import `StatusBarChart` from `@/src/components/dashboard/StatusBarChart`, `ChartFrame` from `@/src/components/dashboard/ChartFrame`, `chartTheme` from `@/src/components/ui/chartTheme`.) `chartType` currently selects the bar rendering; `line`/`donut` are schema-valid but render via the bar primitive in v1 (documented — ADR-0045 §1 maps `data_chart → ChartFrame`; a per-type chart is a future registry entry).
- `data_insight` → `<KPITile icon="doc" tone={widget.tone ?? 'blue'} label={widget.label} value={widget.value} delta={widget.delta} />` (import from `@/src/components/ui/KPITile`).
No `default` that renders payload content — this function is only ever called on an already-validated
`WidgetPayload` (WidgetSlot validates first); an exhaustive switch with a `never`-typed fallthrough returns
the text fallback element for type-safety, never raw payload.

**Verify (green):** `npx vitest run src/components/panel/widgets/registry.test.tsx` → pass.

### Task W5 — `WidgetSlot` failing tests (RED) — AC-ATC-003/004, FR-ATC-004/006, NFR-ATC-SEC-002, NFR-ATC-A11Y-003
**File:** `pmo-portal/src/components/panel/widgets/WidgetSlot.test.tsx` (NEW)
`render(<WidgetSlot widget={…} />)` inside `<MemoryRouter>`.
- **AC-ATC-003:** pass a malformed payload the client zod rejects (`{ kind:'data_table', columns:[{key:'n',label:'N'}], rows:'nope' }` cast through `as unknown`); assert the text fallback renders (a real text node with an accessible string, e.g. `screen.getByText(/couldn.t display/i)`, NFR-ATC-A11Y-003) AND no `<table>` renders (`expect(screen.queryByRole('table')).toBeNull()`) AND it does not throw (the render itself passing is the no-throw proof). Title: `AC-ATC-003 client re-validates, renders text fallback on failure`.
- **AC-ATC-004:** pass `{ kind:'iframe_app', src:'javascript:alert(1)' } as unknown`; assert text fallback renders AND `expect(document.querySelector('iframe')).toBeNull()` AND no element carries the raw `src` string (`expect(screen.queryByText('javascript:alert(1)')).toBeNull()`) AND no `dangerouslySetInnerHTML` path (the render is plain-text only). Title: `AC-ATC-004 unregistered kind renders text fallback, no iframe/eval`.

**Verify (fails):** `npx vitest run src/components/panel/widgets/WidgetSlot.test.tsx` → module-not-found.

### Task W6 — `WidgetSlot.tsx` (GREEN for W5) — FR-ATC-004/005/006, NFR-ATC-SEC-002, NFR-ATC-A11Y-003
**File:** `pmo-portal/src/components/panel/widgets/WidgetSlot.tsx` (NEW)
```tsx
export const WidgetSlot: React.FC<{ widget: unknown }> = ({ widget }) => {
  const parsed = WIDGET_PAYLOAD_SCHEMA.safeParse(widget);          // FR-ATC-004 — SAME schema, second gate
  if (!parsed.success) {
    return (
      <div role="note" className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
        This result couldn&apos;t be displayed.
      </div>                                                        // FR-ATC-006 / NFR-ATC-SEC-002 — fixed safe string, real text node (A11Y-003)
    );
  }
  return renderWidget(parsed.data);                                 // FR-ATC-005 — registry dispatch
};
```
Import `WIDGET_PAYLOAD_SCHEMA` from `@/src/lib/agent/widgets/schema`, `renderWidget` from `./registry`. No
`dangerouslySetInnerHTML`, no `eval`, no `iframe` anywhere in the module (NFR-ATC-SEC-002 — the D-A2-8
precedent binding on the panel). The `widget` prop is typed `unknown` on purpose: the slot is the trust
boundary and must never assume the payload is well-formed.

**Verify (green):** `npx vitest run src/components/panel/widgets/WidgetSlot.test.tsx` → pass. **Phase-W gate:**
`npx vitest run src/lib/agent/widgets src/components/panel/widgets` → all Phase-W tests green (this whole set
is independently green with no Phase-Q/X code present).

---

## PHASE Q — Ask-user questions (port control('answer') + handler resolution + chips UI)

> Depends on Phase W only for the shared `TranscriptItem` edit at Integration; Phase Q's own files
> (`transport.ts`, `port.ts`, `handler.ts`, `QuestionChips.tsx`, `useAssistantPanel.ts`, `pmoNativeRuntime.ts`)
> are independent of Phase W. Build after W lands (or in parallel if the shared `TranscriptItem`/`port.ts`
> edits are serialized at integrate).

### Task Q1 — `control('answer')` superset test (RED) — AC-ATC-011, FR-ATC-010, OBS-ATC-002/003
**File:** `pmo-portal/src/lib/agent/runtime/port.test.ts` (EDIT — currently only the purity test)
Add a compile-time + shape assertion. Because `port.ts` is types-only (the existing test asserts zero
runtime exports), prove the superset at the TYPE level with a `satisfies`/assignability check in the test
body plus a doc-comment naming the AC:
```ts
it('AC-ATC-011 control verb set is a superset, answer added, no existing member changed', () => {
  type Cmd = Parameters<import('./port').AgentRuntime['control']>[1];
  // Every existing verb still assignable (no member removed/renamed):
  const existing: Cmd[] = ['pause', 'resume', 'cancel', 'approve', 'reject'];
  const added: Cmd = 'answer';                       // new member present
  expect([...existing, added]).toHaveLength(6);
  // @ts-expect-error — a non-member is still rejected (union not widened to string)
  const bogus: Cmd = 'delete-everything'; void bogus;
});
```
This fails to COMPILE today (`'answer'` not in the union; the `@ts-expect-error` fires on the wrong line),
so `tsc`/vitest reports RED.

**Verify (fails):** `npx vitest run src/lib/agent/runtime/port.test.ts` → type error on `'answer'`.

### Task Q2 — Extend `control` + `RunContext` + answer wire shape (GREEN for Q1) — FR-ATC-010/014, DEC-1/DEC-4
**Files:** `supabase/functions/agent-chat/port.ts` (EDIT), `supabase/functions/agent-chat/transport.ts` (EDIT)
- `port.ts`:
  - `AgentRuntime.control` union → `'pause' | 'resume' | 'cancel' | 'approve' | 'reject' | 'answer'` (add a
    trailing `payload?: AgentAnswer` param — see below — as an OPTIONAL third arg so existing
    `control(runId, 'cancel')` calls are unaffected: `control(runId, cmd, payload?): Promise<void>`).
  - `RunContext` → `{ route?: string; /** @deprecated use entity.id */ entityId?: string; entity?: { type: string; id: string; label: string }; selection?: unknown }` (FR-ATC-014, DEC-4 — `entityId` retained + deprecated).
  - Add exported payload types (types-only, keeps `port.test.ts` purity intact):
    `export interface QuestionPayload { kind: 'question'; questionId: string; prompt: string; options: { id: string; label: string }[]; allowFreeText?: boolean }` (FR-ATC-008).
    `export interface AgentAnswer { questionId: string; optionId?: string; freeText?: string }` (DEC-1).
    Re-export `WidgetPayload` type from the shared schema module for handler convenience:
    `export type { WidgetPayload } from '../../../pmo-portal/src/lib/agent/widgets/schema';` (type-only import — no runtime value, purity preserved).
- `transport.ts`: add `AgentChatRequest.answer?: AgentAnswer` (import `AgentAnswer` from `./port`), sibling
  to `decision` (DEC-1). Leave `AgentDecision` untouched (OBS-ATC-002).

**Verify (green):** `npx vitest run src/lib/agent/runtime/port.test.ts` → pass; `cd pmo-portal && npm run typecheck` → zero errors.

### Task Q3 — `QuestionChips` failing tests (RED) — AC-ATC-007/008, FR-ATC-009/011, NFR-ATC-A11Y-002
**File:** `pmo-portal/src/components/panel/QuestionChips.test.tsx` (NEW)
- **AC-ATC-007:** `render(<QuestionChips prompt="Which project?" options={[{id:'a',label:'Alpha'},{id:'b',label:'Beta'}]} onAnswer={vi.fn()} />)`; assert two `<button>`s named "Alpha" and "Beta" (`screen.getByRole('button', { name: 'Alpha' })` etc.), the prompt text renders, and (NFR-ATC-A11Y-002) the container is `role="group"` `aria-live` with the prompt as its accessible name. Assert NO text input when `allowFreeText` is absent. Title: `AC-ATC-007 question payload renders as chips`.
- **AC-ATC-008:** with `onAnswer = vi.fn()`, click "Alpha" → assert `onAnswer` called once with `{ optionId: 'a' }`; assert a `followUp` is NOT involved (this is a prop-level test — `onAnswer` is the ONLY callback surface; the hook wiring test in Q6 proves it routes to `control` not `followUp`). Title: `AC-ATC-008 tapping chip calls control answer not followUp`.
- When `allowFreeText`, a labeled text input + submit renders and submitting calls `onAnswer({ freeText })`.

**Verify (fails):** `npx vitest run src/components/panel/QuestionChips.test.tsx` → module-not-found.

### Task Q4 — `QuestionChips.tsx` (GREEN for Q3) — FR-ATC-009, NFR-ATC-A11Y-002
**File:** `pmo-portal/src/components/panel/QuestionChips.tsx` (NEW)
Mirror `ApprovalChip.tsx` conventions exactly (DESIGN.md tokens; `h-8` 32px buttons; focus ring). Props
`{ prompt: string; options: { id: string; label: string }[]; allowFreeText?: boolean; onAnswer: (a: { optionId?: string; freeText?: string }) => void; disabled?: boolean }`. Render:
- `role="group" aria-label={prompt} aria-live="polite"` container (the prompt is announced when it appears, NFR-ATC-A11Y-002).
- `<p>` prompt line, then each option as a real `<button type="button" onClick={() => onAnswer({ optionId: opt.id })}>` (keyboard-operable — real buttons, mirrors ApprovalChip).
- When `allowFreeText`: a `<label>` with a visible label + `<input>` and a submit button → `onAnswer({ freeText })`.
- Disable all controls when `disabled` (resolved state, mirrors ApprovalChip's `pending → resolved`).

**Verify (green):** `npx vitest run src/components/panel/QuestionChips.test.tsx` → pass.

### Task Q5 — Handler question-resolution failing tests (RED) — AC-ATC-009/010, FR-ATC-011/012/013
**File:** `pmo-portal/src/lib/agent/handlerQuestion.test.ts` (NEW) [REC-1]
Import `agentChatHandler` from `'../../../../supabase/functions/agent-chat/handler'`; copy the `baseDeps`
mock helpers from `agentChatHandler.test.ts` (mocked `modelClient` + `supabase` with the profiles
`.eq().single()` resolving `{ org_id, role }`). Drive the answer re-POST:
- **AC-ATC-009:** build a `req` carrying `runId` (present), an `answer: { questionId:'q1', optionId:'a' }`, and a replayed `messages` transcript whose trailing assistant turn contains the unresolved question (a `status`-kind marker the handler's finder recognizes — see Q6 for the exact transcript encoding). Collect the handler's yielded events; assert **NO** `createRun`/new-run id appears — the stream continues under the SAME `req.runId` (assert every emitted `ev.runId === req.runId`), mirroring the A3 continuation. Mock `modelClient.create` to return an `end_turn` assistant message so the run completes. Title: `AC-ATC-009 answer resolves same run, no new createRun`.
- **AC-ATC-010:** build a `req` whose replayed transcript ALREADY contains a resolution for the trailing question (the positional check, mirroring `findTrailingConfirmToolUse`'s already-resolved branch); send a duplicate `answer` for the same `questionId`; assert the handler treats it as a no-op — it does not re-inject the answer twice and simply runs the model to continue (assert the model is called at most once for the continuation, and no duplicate answer tool/user message is appended). Title: `AC-ATC-010 duplicate answer is idempotent no-op`.

**Verify (fails):** `npx vitest run src/lib/agent/handlerQuestion.test.ts` → the two AC tests fail (no answer branch yet).

### Task Q6 — Handler question-resolution branch (GREEN for Q5) — FR-ATC-011/012/013
**File:** `supabase/functions/agent-chat/handler.ts` (EDIT)
- **Emit side (a question awaiting an answer):** the model requests a clarification via a dedicated
  mechanism the handler owns — for v1, the handler recognizes an assistant tool result / a synthetic
  `status{kind:'question'}` and emits `yield emit('status', { payload: { kind:'question', questionId, prompt, options, allowFreeText } })` then **ends the stream** (exactly as the A3 needs-approval branch ends the stream at handler.ts:602). `questionId = makeId()`. This mirrors the A3 propose branch structurally; the model surfaces the question by producing a `question`-shaped tool result (the exact model-facing trigger is an internal detail — the AC-owning tests construct the transcript directly). Keep this behind the same tool loop; do not add a new `AgentEventType` (OBS-ATC-003).
- **Resolve side (`req.answer` present):** add a branch at the top of `agentChatHandlerInner`, sibling to
  the existing `if (req.decision)` at handler.ts:428 —
  ```ts
  if (req.answer) {
    yield* handleAnswer(req, deps, emit, statusEvent, deputyCtx, persist);
    return;
  }
  ```
  Implement `handleAnswer` mirroring `handleDecision` (handler.ts:652): rebuild `messages` from the replay,
  call a new `findTrailingQuestion(req.messages)` (a generalization of `findTrailingConfirmToolUse`,
  handler.ts:976 — walk backwards for the trailing unresolved `question` marker in the replayed transcript;
  return `null` if a resolution already follows it, giving the AC-ATC-010 idempotent no-op). When found and
  not stale: append the answer as a `role:'tool'`/user message that continues the model turn (the answer text
  = the chosen option's label or the free text), then `yield* runLoop(...)` (handler.ts:852) so the SAME run
  continues to a final answer. When stale/null: `yield* runLoop(...)` directly (no-op continuation — AC-ATC-010).
  **NFR-ATC-SEC-004:** the answer re-POST re-derives org/role via the same profiles lookup `handleDecision`
  performs before resuming (already in the shared gate-2 path) — no new deputy bypass.

**Verify (green):** `npx vitest run src/lib/agent/handlerQuestion.test.ts` → AC-ATC-009/010 pass;
`npx vitest run src/lib/agent/agentChatHandler.test.ts src/lib/agent/handlerPersistence.test.ts` → still green (no regression to A3/persistence).

### Task Q7 — Hook `answerQuestion` + adapter `control('answer')` (GREEN, wiring) — AC-ATC-008, FR-ATC-011
**Files:** `pmo-portal/src/hooks/useAssistantPanel.ts` (EDIT), `pmo-portal/src/lib/agent/runtime/pmoNativeRuntime.ts` (EDIT)
- `pmoNativeRuntime.ts`: extend `control` signature to `control(runId, cmd, payload?)`; add a `cmd === 'answer'`
  branch that stashes `state.pendingAnswer = payload as AgentAnswer` and marks `awaitingDecision`-style
  continuation (mirror the `approve`/`reject` stash at pmoNativeRuntime.ts:86-92). In `_doSubscribe`, include
  `...(answer ? { answer } : {})` on the `AgentChatRequest` body (mirror the `decision` spread at
  pmoNativeRuntime.ts:160-166). Add `pendingAnswer?: AgentAnswer` + `RunState` question bookkeeping (stash the
  `questionId` from the emitted `status{kind:'question'}` event, exactly as A3 stashes `pendingId`).
- `useAssistantPanel.ts`: add `answerQuestion(questionId: string, optionId?: string, freeText?: string)` to
  `UseAssistantPanel`, mirroring `approve`/`deny` (useAssistantPanel.ts:277-297): call
  `runtime.control(activeRunId, 'answer', { questionId, optionId, freeText })`, `setPhase('running')`,
  `runtime.subscribe(activeRunId)`, `drain(...)`. In `drain`, add a `status`-branch case: when
  `payload?.kind === 'question'`, append the event to the transcript (so `TranscriptItem` renders
  `QuestionChips`) and stash the active `questionId` (like the `needs-approval` branch at useAssistantPanel.ts:154-167).
  **Never call `followUp` for an answer** (FR-ATC-011, OBS-ATC-004).

**Verify (green):** `npx vitest run src/lib/agent/runtime/pmoNativeRuntime.test.ts src/hooks` → green (adjust the
existing `pmoNativeRuntime.test.ts`/`useAssistantPanel.*.test.ts` only if the new optional param breaks a
mock signature — widen the mock, never weaken an assertion, BDD rule).

---

## PHASE X — Live context (RunContext population + client provider + handler grounding + scope write)

> Depends on Phase Q's `port.ts` `RunContext` edit (Task Q2). Build after Q2 lands.

### Task X1 — Handler context-grounding + scope-write failing tests (RED) — AC-ATC-012..016, FR-ATC-016/017/018
**File:** `pmo-portal/src/lib/agent/handlerContext.test.ts` (NEW) [REC-1]
Copy the `baseDeps` mock helpers from `agentChatHandler.test.ts` + `handlerPersistence.test.ts` (a
persistence-enabled `deps.persistence` with a mocked `agent_threads` insert that captures the `scope` arg).
- **AC-ATC-012:** `req.context = { route:'/projects/123', entity:{ type:'project', id:'123', label:'Alpha' } }`, user message "summarize this". Spy on `modelClient.create`; assert the constructed `messages` (the model's system/context message) CONTAIN the grounding hint `entity.id:'123'` (a substring assertion on the system message content) — a grounding hint, NOT an authorization change. Title: `AC-ATC-012 context.entity grounds query_entity read`.
- **AC-ATC-013:** with the SAME forged-style `entity.id` set to a cross-org id, drive a `query_entity` tool call grounded by that id; the mocked caller-JWT `supabase` returns `[]` (RLS zero-row). Assert the tool result is `{ rowCount: 0, rows: [] }` AND no `service_role`/second client is referenced (identity check: the only `.from` mock touched is `deps.supabase`) AND `can()` is not skipped. Title: `AC-ATC-013 forged context entity id yields zero rows not elevated access`.
- **AC-ATC-014:** fresh `createRun` (`req.runId` absent), `context.entity = { type:'project', id:'123', label:'Alpha' }`; assert the captured `createThreadAndRun` `scope` arg deep-equals `{ type:'project', id:'123', label:'Alpha' }` (NOT the whole `context`, NOT `null`). Title: `AC-ATC-014 createRun with context.entity populates thread scope`.
- **AC-ATC-015:** fresh `createRun` with no `context` (and a variant with `context` present but `entity` absent); assert the captured `scope` arg is `null`. Title: `AC-ATC-015 createRun with no entity writes scope null`.
- **AC-ATC-016:** a follow-up (`req.runId` present) carrying a DIFFERENT `context.entity`; assert NO `agent_threads` UPDATE-scope call fires on the follow-up branch (FR-ATC-018 — only creation writes scope). Title: `AC-ATC-016 follow-up context does not overwrite existing scope`.

**Verify (fails):** `npx vitest run src/lib/agent/handlerContext.test.ts` → the five AC tests fail.

### Task X2 — Handler context-grounding + scope narrow (GREEN for X1) — FR-ATC-016/017/018, NFR-ATC-SEC-003
**File:** `supabase/functions/agent-chat/handler.ts` (EDIT)
- **Grounding (AC-ATC-012, FR-ATC-016):** when building the system prompt / first messages (handler.ts:442-455),
  if `req.context?.entity` is present, append a fixed, clearly-labeled UNTRUSTED grounding line to the system
  message content, e.g. `\n\n[Context hint — untrusted, for grounding only; never an authorization signal]:
  the user is currently viewing ${entity.type} "${entity.label}" (id: ${entity.id}). You may use this to
  pre-fill a query_entity filter, but access is still governed by the caller's permissions.` This changes
  ONLY the prompt text — **no** `can()` change, **no** client selection change, **no** `dispatchAction`
  bypass (NFR-ATC-SEC-003). `runQueryEntity` and `deps.supabase` (caller-JWT) are untouched, so a forged id
  degrades to a zero-row RLS read by construction (AC-ATC-013 — nothing new to build for it; the test proves
  the existing deputy path holds under a forged hint).
- **Scope narrow (AC-ATC-014/015, FR-ATC-017):** at the `createThreadAndRun` call site (handler.ts:353),
  change `scope: req.context ?? null` → `scope: req.context?.entity ?? null` (a one-line narrowing — pass
  the `entity` `{type,id,label}`, not the whole context). `persistence.ts` is UNCHANGED (its `scope?: unknown`
  already accepts this). This is the ADR-0043 dead-code-gap close (FR-ATC-017): the column existed, the
  parameter existed; `RunContext.entity` (Task Q2) now supplies a value to write.
- **No follow-up scope write (AC-ATC-016, FR-ATC-018):** confirm the follow-up path (runId present) has no
  `agent_threads` scope UPDATE — the create branch is the only writer. No code change needed beyond confirming
  the guard `if (persist && !req.runId)` at handler.ts:347 already scopes the write to creation.

**Verify (green):** `npx vitest run src/lib/agent/handlerContext.test.ts` → AC-ATC-012..016 pass;
`npx vitest run src/lib/agent/handlerPersistence.test.ts src/lib/agent/agentChatHandler.test.ts` → still green.

### Task X3 — Client context provider (GREEN, wiring) — FR-ATC-015, FR-ATC-019/020
**Files:** `pmo-portal/src/lib/agent/context/useAgentContext.ts` (NEW), `pmo-portal/src/lib/agent/context/AgentContextProvider.tsx` (NEW), `pmo-portal/src/lib/agent/runtime/pmoNativeRuntime.ts` (already threads `context` — verify), `pmo-portal/src/hooks/useAssistantPanel.ts` (EDIT — pass context on createRun/followUp)
- `AgentContextProvider.tsx`: a React context provider that reads `route` from `react-router-dom`'s
  `useLocation().pathname` and exposes an imperative `setEntity({ type, id, label })` / `setSelection` a host
  page CAN call (survey confirms **no** existing app-wide "selected entity" seam — host pages hold local
  selection state; the provider offers an opt-in setter, no page is forced to adopt it in v1). Exposes
  `getContext(): RunContext`.
- `useAgentContext.ts`: the read hook returning `getContext()`.
- `useAssistantPanel.ts`: on `send`'s `createRun` (useAssistantPanel.ts:236) and `followUp`
  (useAssistantPanel.ts:249), pass `context: getContext()` (via the provider) when
  `isFeatureEnabled('agentAssistant')` — the existing `AgentChatRequest.context` field carries it (no new
  wire field, FR-ATC-015). `createRun` already accepts `{ goal, context }`; add the arg. `followUp` is
  message-only today — thread context via the adapter's `RunState.context` set at createRun (context is
  established at run creation; a follow-up on the same run reuses it, which is correct for v1 since
  `RunState.context` persists — no `followUp` signature change needed).
- **FR-ATC-019 (no agent-driven nav):** assert by omission — the provider is READ-only; there is no setter
  that drives the router from `context`. Add a code comment citing FR-ATC-019.
- **FR-ATC-020 (flag gate):** all context wiring is behind `isFeatureEnabled('agentAssistant')`; with the
  flag off, `getContext()` is never called and no `context` is sent.

**Verify (green):** `cd pmo-portal && npm run typecheck` → zero errors; `npx vitest run src/hooks src/lib/agent/context` → green.

---

## PHASE I — Integration (wire W/Q into TranscriptItem + AssistantPanel)

### Task I1 — Wire WidgetSlot + QuestionChips into `TranscriptItem` (GREEN, integration) — FR-ATC-002/009, OBS-ATC-001, FR-ATC-020
**File:** `pmo-portal/src/components/panel/TranscriptItem.tsx` (EDIT)
- **`artifact` case (TranscriptItem.tsx:124-131):** add a second branch BEFORE the `compose_view` check —
  `if (artifactPayload?.kind === 'widget') { if (!isFeatureEnabled('agentAssistant')) return null; return <WidgetSlot widget={(event.payload as { widget?: unknown }).widget} />; }`. The existing `compose_view`
  branch is untouched (OBS-ATC-001) — widgets are a NEW sibling case, `ArtifactSlot`'s props/behavior
  unchanged. Import `WidgetSlot` from `./widgets/WidgetSlot`.
- **`status` case (TranscriptItem.tsx:64-107):** add a branch before the `needs-approval` check —
  `if (payload?.kind === 'question') { if (!isFeatureEnabled('agentAssistant')) return null; const q = event.payload as QuestionPayload; return <QuestionChips prompt={q.prompt} options={q.options} allowFreeText={q.allowFreeText} onAnswer={({optionId,freeText}) => onAnswer?.(q.questionId, optionId, freeText)} />; }`. The A3 `needs-approval` branch is untouched (OBS-ATC-002). Import `QuestionChips` from `./QuestionChips` and `QuestionPayload` from `@/src/lib/agent/runtime/port`.
- Add an `onAnswer?: (questionId: string, optionId?: string, freeText?: string) => void` prop to
  `TranscriptItemProps`, threaded from `Transcript` → `AssistantPanel` (like `onApprove`/`onDeny`).

**Verify (green):** `npx vitest run src/components/panel/TranscriptItem.test.tsx src/components/panel/ArtifactSlot.test.tsx` → green (compose_view path unregressed, OBS-ATC-001).

### Task I2 — Thread `onAnswer` through `Transcript` + `AssistantPanel` (GREEN) — FR-ATC-011/020
**Files:** `pmo-portal/src/components/panel/Transcript.tsx` (EDIT), `pmo-portal/src/components/panel/AssistantPanel.tsx` (EDIT)
- `Transcript.tsx`: add `onAnswer?` to `TranscriptProps`, pass to each `<TranscriptItem onAnswer={onAnswer} />` (mirror `onApprove`/`onDeny` at Transcript.tsx:99-108).
- `AssistantPanel.tsx`: destructure `answerQuestion` from `useAssistantPanel()` (AssistantPanel.tsx:94-110); pass `onAnswer={(qid, optionId, freeText) => void answerQuestion(qid, optionId, freeText)}` to `<Transcript>` (AssistantPanel.tsx:406-413). Wrap the panel tree in `<AgentContextProvider>` at its mount site (or the app's runtime provider composition — survey `AgentRuntimeContext`'s provider location and co-locate) so `getContext()` resolves (FR-ATC-015).

**Verify (green):** `npx vitest run src/components/panel/AssistantPanel.test.tsx src/components/panel/AssistantPanel.mobile.test.tsx src/components/panel/Transcript.test.tsx` → green (adjust queries only if a new region breaks an existing selector — never weaken an assertion).

---

## PHASE E — Curated e2e + full gate

### Task E1 — Widget + question + context e2e (RED→GREEN) — AC-ATC-017
**File:** `pmo-portal/e2e/AC-ATC-017-widget-question-context.spec.ts` (NEW)
Playwright, leading `test('AC-ATC-017 …')` title. Single curated cross-stack journey against local Supabase
(follow the `e2e/AC-AR-013-*`/`AC-CV-015-*` full-serial + dedicated-fixture patterns; requires
`VITE_FEATURES_AGENT_ASSISTANT=true` + `AGENT_PERSISTENCE` on for the e2e env). Because the model is live,
either (a) run against a deterministic seeded stub model, or (b) if the e2e harness already stubs
`agent-chat` responses (check the AR-013/CV-015 fixtures), script the SSE to return a `DataTableWidget`
artifact then a `question` status. Journey:
1. Sign in (seed user); open the panel (⌘J / Rail); ask "show me over-budget projects"; wait for the
   agent's `artifact{kind:'widget', widget:{kind:'data_table',…}}` → assert a real `<table>` with the
   expected rows renders inline in the transcript (`getByRole('table')` + a known project name cell),
   **not** a markdown/`<pre>` block.
2. In the same journey, when the agent asks a clarifying `question` → assert option chips render; tap a
   chip → assert the **same run** continues (no new run id; no reload) to a final assistant answer.

**Verify:** from `pmo-portal/`: `npx playwright test e2e/AC-ATC-017-widget-question-context.spec.ts`.

### Task E2 — FULL verify + integration gate (binding pre-PR)
Run, from `pmo-portal/`, in order:
1. `npm run verify` (= `typecheck && lint:ci && test && build`) — the WHOLE suite, never just touched files
   (a shared-component edit like `TranscriptItem.tsx` can break other renders — the recurring CI-verify-red trap).
2. From repo root: `supabase db reset && supabase test db` — all pgTAP still green (this issue adds **no**
   migration and **no** pgTAP; §3 reuses `agent-persistence.spec`'s AC-AGP-004..008 RLS proofs unchanged. If
   `supabase test db` is red, a Phase-2 baseline drifted — do NOT add pgTAP here; escalate).
3. From `pmo-portal/`: `npx playwright test e2e/AC-ATC-017-widget-question-context.spec.ts` (+ the agent
   panel journeys `AC-AR-013`/`AC-CV-015` to confirm no widget/question/context regression).
4. **Rendered Discover pass** on a clean build (`npm run build && npm run preview`): render a widget table,
   a `data_chart` (ChartFrame), a `data_insight` KPI tile, a question with chips (+ free-text), and the
   text fallback (an unregistered kind) — MEMORY durable rule: rendered-review-catches-what-tests-pass;
   stub unit tests are NOT the rendered pass (this is exactly what let an unstyled panel reach PR #209).

**Only after all four are green** does the issue go to the review battery (3-lens + rendered Discover + BDD)
→ PR to `dev`. Never open the PR before the full battery is green locally (MEMORY: pr-after-review-battery).

---

## 4. Type/signature consistency (guard across tasks)

- `WidgetPayload` = `z.infer<typeof WIDGET_PAYLOAD_SCHEMA>` from `widgets/schema.ts` — the SINGLE type,
  imported by `registry.tsx` (W4), `WidgetSlot.tsx` (W6), `handler.ts` widget emit (I1/DEC-2), and re-exported
  type-only from `port.ts` (Q2). `INSIGHT_TONES` MUST equal `KPITone` (`'blue'|'violet'|'amber'|'red'|'green'`);
  `CHART_TYPES` MUST equal the `data_chart` enum — both asserted in `schema.test.ts` (W1).
- `WIDGET_PAYLOAD_SCHEMA` is the sole validator on BOTH the server emit (FR-ATC-003) and the client render
  (FR-ATC-004) — no hand-rolled `typeof` substitute anywhere (NFR-ATC-SEC-001). `WidgetSlot` and the handler
  both call `.safeParse` on the SAME imported schema.
- `AgentAnswer = { questionId: string; optionId?: string; freeText?: string }` — identical in `port.ts`
  (Q2), `transport.ts` `AgentChatRequest.answer` (Q2), `pmoNativeRuntime.control` payload (Q7),
  `useAssistantPanel.answerQuestion` (Q7), and `QuestionChips.onAnswer` (which passes `{optionId?,freeText?}`;
  the hook adds the `questionId`). `QuestionPayload.questionId` (server-minted) is the correlation key.
- `control(runId, cmd, payload?)` — the third `payload?: AgentAnswer` arg is OPTIONAL so every existing
  `control(runId, 'cancel'|'approve'|'reject')` call (useAssistantPanel.ts:262/282/293, :331) compiles
  unchanged (AC-ATC-011, OBS-ATC-002).
- `RunContext.entity?: { type: string; id: string; label: string }` — same shape in the grounding hint
  (X2), the scope write (X2 → `createThreadAndRun` scope arg), and the client provider `getContext()` (X3).
  `agent_threads.scope` receives EXACTLY this `{type,id,label}` object (AC-ATC-014), never the whole context.

## 5. Scaling / risk notes (Performance + Architecture lenses)

- **Widget validation is O(rows), bounded (NFR-ATC-PERF-001):** the zod parse walks ≤ `AGENT_READ_ROW_CAP`
  (50) rows once, no network round-trip, no O(n²). The client re-parse (WidgetSlot) is the same bounded cost
  — negligible against the render. No caching needed at v1 scale.
- **No new trust surface beyond the schema + registry (ADR-0045 Consequences):** the `kind → component` map
  and the zod schema must be maintained in lockstep — an unknown `kind` MUST fail safe to text (W5/W6 prove
  it). The registry has no `default` that renders payload content; adding a v2 kind is one schema member + one
  registry case + one test, never an architecture change.
- **Context is zero-authorization-risk by construction (FR-ATC-016, NFR-ATC-SEC-003):** grounding only
  changes prompt TEXT; RLS + `deps.supabase` (caller-JWT) + `can()` are untouched, so a forged
  `entity.id` is a nuisance (a wasted zero-row read), never a breach (ADR-0036 §2). The reviewer-guarded
  invariant: X2's grounding edit must not touch client selection / `can()` / `dispatchAction` — it appends
  to a string, nothing else.
- **`followUp` full-replay unchanged (OBS-ATC-004):** answers ride `control`/`req.answer` (the stateless
  re-POST family A3 already uses), NOT `followUp`'s messages-replay — no new replay cost, one idempotency
  story (the `findTrailingQuestion` generalization of `findTrailingConfirmToolUse`).
- **Duplicate-logic avoidance:** `handleAnswer` reuses `runLoop`/the profiles re-auth/the trailing-finder
  pattern from `handleDecision` (not a parallel path); `renderWidget` reuses the `HydratedPrimitive`
  switch-over-registry shape and the SAME PMO primitives (DataTable/StatusBarChart/KPITile) — no new visual
  vocabulary, no forked table/chart/tile markup (NFR-ATC-A11Y-001).
- **`selection` deferred (Out of Scope):** `RunContext.selection?: unknown` is a typed escape hatch only —
  not populated in v1; do not build a selection model here.

## 6. Open questions for the Director

1. **Promote `zod` to a direct `pmo-portal` dependency in THIS issue** (DEC-3, spec Open Q 3). Plan: yes,
   in-issue — a one-line `package.json` add + a `deno.json` import, gated behind the widget-schema module
   this issue builds; splitting into a prerequisite issue adds PR-sequencing cost for zero isolation benefit
   (nothing in the repo depends on zod's absence; compose-view's hand-rolled `compileCompositionSpec` is
   unaffected — zod is scoped to the widget contract only, not a repo-wide validation migration). **Confirm.**
2. **E2E model determinism for AC-ATC-017** (Task E1). The one curated journey needs the agent to return a
   `DataTableWidget` then a `question` deterministically. Recommendation: reuse whatever `agent-chat` SSE
   stubbing the existing `AC-AR-013`/`AC-CV-015` journeys use (a scripted response), NOT a live model call —
   confirm the e2e harness stubs the edge fn (if it calls a live model, AC-ATC-017 must gate on a seeded
   deterministic model or a fixture). **Confirm the e2e stubbing approach** before Task E1.
3. **`data_chart` per-type rendering (bar-only in v1).** The registry maps all `chartType` values
   (`bar|line|donut`) to the `StatusBarChart` bar primitive in v1 (ADR-0045 §1 maps `data_chart → ChartFrame`
   generically; PMO has no shipped line/donut primitive in the panel's import surface). `line`/`donut` are
   schema-valid but render as bars until a future issue adds per-type primitives. **Confirm this is
   acceptable for v1** (the only end-to-end-mandated widget is the table, AC-ATC-017; charts/insights are
   proven at the unit layer with hand-built payloads).
