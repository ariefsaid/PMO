# SDD: Assistant accuracy — grounded figures, aggregation, a check pass

**Status:** Approved by the Director — 2026-10-22 (owner direction: tune the assistant harness for v0.25; users accept
waiting for an accurate answer when progress is visible). Issues: #1297, #1296.

**Why.** A model comparison (5 PMO tasks, 3+ runs per model, scored against database-checked facts) found that most lost
accuracy comes from the assistant's own loop, not the model:

1. `whats_overdue` gives the model only counts, so "which project has the most overdue tasks" and a user-requested
   overdue table cannot be answered from it.
2. The prompt forbids repeating the overdue list, so an explicit table request is refused (#1296).
3. `query_entity` cannot count, group, sum, sort or compare, and returns at most 50 rows, so models count by hand.
4. The tool loop samples at temperature 0.8.
5. Nothing makes the model check its figures, and models stop with "I can't determine…" when one more lookup would do.

**Supersedes:**
- The *model-facing* half of **FR-AIN-006** / **AC-AIN-001** (`assistant-invoice-reach.spec.md`): the model now
  receives the overdue rows, not only a receipt. The user-facing half (server-rendered list shown verbatim, FR-AIN-007
  links and caps) is unchanged.
- The default value in **FR-AMT-003** (`agent-model-tuning.spec.md`, Draft): the default becomes 0.2. The operator
  lever in that draft remains future work.

## Requirements (EARS)

- **FR-ACC-001** — When `whats_overdue` returns, the handler shall give the model the fetched rows in compact form
  (tasks: project, task, owner, due date, days late; invoices: invoice, project/company, amount, due date, days late),
  the overdue count per project, the totals and the truncation flags, while still showing the user the same
  server-rendered list as today. Counts follow the panel's existing semantics: they cover the rows the tool fetched
  (its existing caps: 50 overdue tasks, 50 overdue invoices from a 200-row unpaid scan). When a cap truncated the
  data, the result marks the totals and per-project counts `partial: true`, and the model-facing note says to use
  `query_entity` with `group_by` for complete counts.
- **FR-ACC-002** — When the user asks for something the overdue panel does not give (a table with given columns or
  sort, a grouping, "which project has the most", a follow-up about the rows), the assistant shall answer from the
  overdue rows in exactly the requested shape; otherwise it shall add at most one short sentence.
- **FR-ACC-003** — `query_entity` shall accept the filter operators `neq`, `lt`, `lte`, `gt`, `gte` (dates and
  numbers for the comparisons) in addition to `eq` and `in`, and up to three filters combined with AND, and an optional `order_by: {column, direction}`.
- **FR-ACC-004** — Where `group_by` is given (optionally with `sum: <numeric column>`), `query_entity` shall return
  `{groups: [{key, count, sum?}], rowCount, truncated}` computed over all rows the caller can read that match the
  filter, paging the caller-JWT read, up to a hard cap of **5,000 rows**. `rowCount` is the number of rows aggregated.
  When the cap is reached it shall set `truncated: true`, and the model-facing note shall say the totals are partial.
- **FR-ACC-005** — Every column named in a filter, `order_by`, `group_by` or `sum` shall be on the entity's existing
  whitelist; otherwise the call is refused with a clear error. Reads use the caller's JWT only (RLS stays the authority).
- **FR-ACC-006** — The always-on Charter shall carry three concise rules: every figure in the final answer comes from
  a tool result in this turn (recount, never estimate); if data needed to answer is missing, fetch it — never answer
  "I can't determine…" while a tool can get it; deliver the shape the user asked for (table, columns, sort, grouping).
  The query_entity guidance shall say to use `group_by`/`sum` for counts and totals.
- **FR-ACC-007** — While `AGENT_VERIFY_ANSWER` is not `false`, when the model returns a final answer, the handler shall
  emit the step label "Double-checking the answer…", run one tools-disabled model call that checks the draft against
  the tool results in the transcript and returns the corrected answer (or the same answer), and emit that answer
  instead of the draft. Its usage is recorded like any other model call.
- **FR-ACC-008** — If the check call fails or returns no text, the handler shall emit the original draft (an answer is
  never lost).
- **FR-ACC-009** — The tool loop, the step-limit synthesis call and the check call shall use
  `DEFAULT_AGENT_TEMPERATURE = 0.2`.

## Acceptance criteria

- **AC-ACC-001** — *Given* 19 overdue tasks across 4 projects, *when* the model calls `whats_overdue`, *then* the
  model-facing result contains all 19 task rows (project, task, owner, due, days late) and per-project counts, and the
  user-facing list is byte-identical to today's rendering.
- **AC-ACC-014** — *Given* 60 overdue tasks (more than the 50-row fetch cap), *when* the model calls `whats_overdue`,
  *then* the model-facing result carries the 50 fetched rows, per-project counts over those rows, `partial: true`,
  and a note telling the model to use `query_entity` with `group_by` for complete counts; the user-facing list is
  unchanged (it already shows the true count with "+").
- **AC-ACC-002** — *Given* the overdue tool result, *when* the prompt is built, *then* it no longer instructs the model
  never to repeat the list, and it states that an explicitly requested table/grouping/follow-up is answered from the rows.
- **AC-ACC-003** — *Given* tasks with mixed end dates, *when* `query_entity` is called with `filter
  {column:"end_date", op:"lt", value:"2026-10-22"}` and `order_by {column:"end_date", direction:"asc"}`, *then* only
  earlier rows are returned, in ascending order. Same for `lte`, `gt`, `gte`; `neq` excludes the value; two filters
  combine with AND (e.g. `status neq Done` AND `end_date lt today`).
- **AC-ACC-004** — *Given* 1,200 caller-visible tasks across 3 projects, *when* `query_entity` is called with
  `group_by:"project_id"`, *then* the counts sum to 1,200, `rowCount` is 1,200 and `truncated` is false (the read
  pages past the per-response cap).
- **AC-ACC-005** — *Given* purchase orders, *when* `group_by` is used with `sum:"amount"`, *then* each group's sum
  equals the sum of its rows.
- **AC-ACC-006** — *Given* more than 5,000 matching rows, *when* `group_by` is used, *then* `rowCount` is 5,000,
  `truncated` is true and the result note says the totals are partial.
- **AC-ACC-007** — *Given* a column not on the entity whitelist, *when* it is named in `filter`, `order_by`,
  `group_by` or `sum`, *then* the call is refused and no read is made.
- **AC-ACC-008** — *Given* a caller who cannot see some rows under RLS, *when* `group_by` runs, *then* those rows are
  not counted (the read uses the caller's JWT, never service_role).
- **AC-ACC-009** — *Given* the built prompt, *then* the Charter contains the three rules of FR-ACC-006 and the
  query_entity guidance mentions `group_by`/`sum`; the existing ADR-0050 assertions (security wording, no "respond in
  plain text") still hold.
- **AC-ACC-010** — *Given* `AGENT_VERIFY_ANSWER` unset, *when* the model returns a final draft, *then* a step event
  "Double-checking the answer…" is emitted, one tools-disabled model call is made, and the assistant message emitted
  is that call's text; usage covers both calls.
- **AC-ACC-011** — *Given* `AGENT_VERIFY_ANSWER=false`, *then* no check call is made and the draft is emitted.
- **AC-ACC-012** — *Given* the check call throws or returns empty text, *then* the draft is emitted and the turn
  completes normally.
- **AC-ACC-013** — *Given* any model call from the tool loop, the step-limit synthesis or the check pass, *then* it is
  sent with temperature 0.2.

## Traceability (owning layer)

| AC | Owning test (unit unless noted) |
|---|---|
| AC-ACC-001, 002, 014 | `pmo-portal/src/lib/agent/handlerOverdue.test.ts` + prompt tests |
| AC-ACC-003..007 | query_entity action/DAL unit tests (mocked client, including paging) |
| AC-ACC-008 | pgTAP-free: unit test that the read uses the caller client; RLS itself is already covered by existing pgTAP |
| AC-ACC-009 | `pmo-portal/src/lib/agent/prompt.experience.test.ts` |
| AC-ACC-010..013 | `pmo-portal/src/lib/agent/agentChatHandler*.test.ts` |

Real-model behaviour is measured by the model-compare eval (ADR-0052), before and after, not gated in CI.
