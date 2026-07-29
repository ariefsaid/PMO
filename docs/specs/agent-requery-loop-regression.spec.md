# Spec — Agent re-query loop & no-answer regression

- **Status:** Draft (awaiting owner sign-off)
- **Owner:** Director
- **Surface:** `supabase/functions/agent-chat/*`, `supabase/functions/_shared/transcriptCompaction.ts`
- **Read-first:** ADR-0050 (agent prompt charter), ADR-0052 (eval harness — the real gate; prompt
  steering is NOT verified against the live `deepseek-v4-flash`), ADR-0045 (typed widgets / `as:"table"`).
- **Severity:** High — live in production. The agent can burn its whole tool-call budget re-fetching
  data it already has, hit `MAX_TOOL_ROUNDS`, and return **no answer at all**.

## 1. Problem (observed, from prod transcripts)

Same prompt — *"Which of my projects are behind schedule?"* — two runs on the hosted project:

| | Good run `f4b8609d` (Jul 8, pre-#293) | Regression run `ebe98163` (Jul 16) |
|---|---|---|
| `query_entity` calls | 6, column-projected, no `as:"table"` | 8, all `as:"table"`, **redundant re-fetches** |
| Raw tables shown in chat | none (hidden tool cards) | every read → inline `data_table` widget |
| Terminal event | assistant final answer, `completed` | `completed` **"reached step limit"** → CANCELLED, **no answer** |

Evidence the 8 reads were rediscovery, not progress: seq 3 `projects` → seq 15 `projects` again;
seq 6 `milestones`(filtered) → seq 18 `milestones`(all) again; seq 9/12 `tasks` → **seq 21 = exact
duplicate of seq 12**. It exhausted `MAX_TOOL_ROUNDS=8` before ever synthesizing.

### Root cause

1. **PRIMARY — `transcriptCompaction.ts` marker invites re-query.** #293 (Jul 10) replaces old
   `role:'tool'` bodies past the recency window (`recentMessages: 6`) with a marker whose `note` reads
   *"Older tool result omitted to save context. **Re-run the tool if you still need this data.**"* On a
   cross-entity question the model needs `projects` + `milestones` + `tasks` in context at once — that
   spans > 3 turns, so the earlier results get compacted and the marker **explicitly tells the weak
   `deepseek-v4-flash` to re-run the tool**. It obeys, loops, and never reaches synthesis. The Jul 8 run
   predates #293, kept the full transcript, and answered.

2. **SECONDARY — step-cap exhaustion yields nothing.** `handler.ts:1118` terminates a fell-through loop
   with a `completed`/"reached step limit" status and **no assistant answer** — the user is left with a
   pile of raw tables and no conclusion.

3. **COSMETIC — `as:"table"` on intermediate reads.** `prompt.ts:147` instructs `as:"table"` for any
   tabular data; the model applies it to every *exploratory* read, dumping raw rows inline (ADR-0045
   `data_table` widget) instead of only when presenting a final result the user asked to see.

## 2. Goals / non-goals

**Goals**
- G1: A cross-entity analytical question returns a synthesized answer, not a step-limit dead-end.
- G2: Compaction never instructs the model to re-run a tool it already ran.
- G3: Even if the loop still occurs, the turn ends with a useful answer, never silence.
- G4: Intermediate exploratory reads stop dumping raw `data_table` widgets into the chat.

**Non-goals**
- Raising `MAX_TOOL_ROUNDS` (masks the loop instead of fixing it — stays at 8).
- Changing `runQueryEntity`, RLS, the entity catalog, or the widget schema (DEC-2 keeps the query path
  byte-unchanged).
- Swapping the model.

## 3. Requirements (EARS)

### Compaction (root cause)
- **FR-RQL-001** *(ubiquitous)* — The compaction marker that replaces an old tool-result body SHALL
  state the result was already retrieved and incorporated, and SHALL NOT instruct the model to re-run
  the tool.
- **FR-RQL-002** *(state-driven)* — While a tool result is compacted, the marker SHALL retain enough
  provenance for the model to reference it without re-fetching: the entity/tool name, the `rowCount`,
  and the fact that it is available earlier in the transcript.
- **FR-RQL-003** *(ubiquitous)* — The default recency window and trigger threshold SHALL be sized so a
  single analytical turn's reads across the standard entity set (projects + milestones + tasks) are not
  compacted mid-turn under typical row volumes. (Tune `DEFAULT_COMPACTION.recentMessages` / `triggerChars`;
  keep the `AGENT_COMPACTION_*` deploy overrides.)
- **NFR-RQL-SEC-001** — The compaction safety invariants hold unchanged: `messages[0]` untouched, no
  message removed, no `tool_call_id` changed, replacement is valid JSON.

### Step-cap synthesis (defensive completeness)
- **FR-RQL-010** *(event-driven)* — When the tool loop reaches `MAX_TOOL_ROUNDS` without a final
  assistant answer this turn, the handler SHALL make one final model call with tools disabled and an
  instruction to answer now from the data already gathered, and stream that as the assistant answer
  before the terminal status.
- **FR-RQL-011** *(state-driven)* — While emitting the forced final answer, the terminal status SHALL
  remain non-errored (`completed`); the "reached step limit" reason MAY be retained for telemetry but a
  substantive answer SHALL precede it.
- **FR-RQL-012** *(conditional)* — Where the malformed-tool-call path (`MALFORMED_TOOL_CALL`, `handler.ts`
  Item 2) is the cause of exhaustion, the existing errored termination SHALL be preserved (no forced
  synthesis on malformed JSON).

### `as:"table"` steering (cosmetic)
- **FR-RQL-020** *(ubiquitous)* — The system prompt SHALL steer `as:"table"` to the presentation of a
  result the user asked to see, not intermediate/exploratory lookups.
- **NFR-RQL-EVAL-001** — Per ADR-0052, FR-RQL-020's effect SHALL be verified by the eval harness against
  the deployed model, not only by unit text-presence assertions (prompt steering on the weak model is
  otherwise unproven).

## 4. Design (chosen approach)

**4.1 Compaction marker (FR-RQL-001/002)** — `transcriptCompaction.ts:compactedMarker`. Replace the
`note` string. New shape (still valid JSON, still small):
```json
{ "_compacted": true,
  "note": "This result was already retrieved earlier in this conversation and used. Do NOT call the tool again for it — answer from the transcript.",
  "tool": "<name>", "rowCount": <n>, "chars_omitted": <original> }
```
`compactedMarker` gains the tool name + rowCount (thread them from the caller in `compactTranscript`,
which has the `role:'tool'` message — `m.name` and a parsed `rowCount` when present).

**4.2 Window/trigger (FR-RQL-003)** — Raise `recentMessages` (6 → e.g. 12, i.e. ~6 recent turns) and
`triggerChars` enough that a normal 6–8-read analytical turn survives. Values validated against the
prod transcript sizes; keep env overrides.

**4.3 Forced synthesis round (FR-RQL-010/011/012)** — `handler.ts`, at the loop fall-through
(~`:1114`). If `!lastRoundMalformed` and no assistant text was emitted this turn, issue one more
`model.create` call with `tools: []` (or provider equivalent) and a system-appended directive:
*"You have reached the tool-call limit. Give your best final answer now using only the data already
gathered; do not request more tools."* Stream its text as the assistant answer, then
`statusEvent('completed', …, 'reached step limit')`.

**4.4 Prompt steer (FR-RQL-020)** — `prompt.ts:147`. Amend the `as:"table"` guidance to: use it only
when presenting data the user asked to see as your answer; for intermediate lookups omit `as`.

### Rejected alternatives
- **Full row digest in the marker** — retaining every omitted row defeats the compaction token-saving.
- **Raise `MAX_TOOL_ROUNDS`** — hides the loop; the model still wastes budget and can still exhaust.
- **Suppress the widget for non-final reads at emit time** — the handler cannot know mid-stream whether
  a read is the final one; prompt steering (4.4) is the correct layer.

## 5. Acceptance criteria (Given/When/Then)

- **AC-RQL-001** *(compaction marker)* — Given a transcript over the trigger with an old `role:'tool'`
  body past the recency window, When `compactTranscript` runs, Then the replaced body contains no
  instruction to re-run/re-call the tool and includes `tool` and `rowCount`. *(Layer: unit — Vitest on
  `transcriptCompaction.ts`.)*
- **AC-RQL-002** *(invariants hold)* — Given the same input, Then `messages[0]` is byte-identical, no
  message is dropped, every `tool_call_id` is preserved, and each replaced body is valid JSON.
  *(Unit.)*
- **AC-RQL-003** *(window sizing)* — Given a single-turn transcript of N sequential `query_entity`
  reads across projects/milestones/tasks at representative row counts, When compaction runs with the new
  defaults, Then none of that turn's tool results are compacted. *(Unit, fixture from the prod shape.)*
- **AC-RQL-010** *(forced synthesis)* — Given a handler run where the model calls a tool every round up
  to `MAX_TOOL_ROUNDS` and never emits final text, When the loop exhausts (non-malformed), Then an
  `assistant` event with non-empty text is emitted before the terminal `completed` status. *(Unit —
  handler with a mocked model client that always returns a tool call.)*
- **AC-RQL-011** *(malformed unchanged)* — Given exhaustion caused by `lastRoundMalformed`, Then the run
  still terminates `errored`/`MALFORMED_TOOL_CALL` with no forced synthesis. *(Unit.)*
- **AC-RQL-020** *(prompt steering, eval-gated)* — Given the deployed model and the eval prompt *"Which
  of my projects are behind schedule?"*, When the run completes, Then it emits a final synthesized answer
  AND does not emit a `data_table` widget for intermediate reads. *(Layer: eval harness, ADR-0052 —
  NOT a unit text-presence test.)*
- **AC-RQL-021** *(regression guard, eval)* — The same eval prompt SHALL complete without a "reached
  step limit" termination across the eval sample. *(Eval harness.)*

## 6. Traceability

| Requirement | Owning layer | Artifact |
|---|---|---|
| FR-RQL-001/002, NFR-RQL-SEC-001 | Unit | `transcriptCompaction` test (AC-RQL-001/002) |
| FR-RQL-003 | Unit | AC-RQL-003 fixture |
| FR-RQL-010/011/012 | Unit | handler test (AC-RQL-010/011) |
| FR-RQL-020, NFR-RQL-EVAL-001 | Eval (ADR-0052) | AC-RQL-020/021 |

## 7. Rollout / verification

- Edge-fn tests import the SHIPPED handler + mock `globalThis.fetch` (test-binding gate; no DI in prod
  code). Mutation-check the forced-synthesis branch — break it and AC-RQL-010 must go red.
- Full `npm run verify` + Deno suites; the eval harness (ADR-0052) is the acceptance gate for FR-RQL-020/021.
- Deploy is owner-gated (agent surface). The `AGENT_COMPACTION_*` overrides give a no-redeploy escape
  hatch if the new defaults need tuning in prod.

## 8. Owner decisions (resolved 2026-07-28)

- OD-1 *(was OQ-1)* — **Ship all three together** ("completely"). All of FR-RQL-001/002/003 + 010/011/012 +
  020 are implemented on `fix/agent-requery-loop`. Fix #3 (`as:"table"` steer) is eval-gated — the eval
  run (AC-RQL-020/021) is still owed before trusting it, but the prompt change ships with the rest.
- OD-2 *(was OQ-2)* — Set from the failing prod transcript size (~50k+ chars for an 8-read analytical turn):
  `triggerChars` 24k→**80k** (~20k tokens, well within deepseek context), `recentMessages` 6→**12**.
  Both stay deploy-tunable via `AGENT_COMPACTION_*`.
- OD-3 — The broader **"vendor vs build the agent harness"** question is tracked SEPARATELY (backlog:
  research-first, lock-in-averse, evaluate LangChain/LangGraph + `pi` + guardrails, not Vercel by default).
  It does not gate or couple to this fix.

## 9. Status

Built + verified on `fix/agent-requery-loop`: `npm run verify` green (8 gates), agent-chat + `_shared`
Deno tests green, boot-smoke OK.

**Review battery (2026-07-28) — all three PASS/SHIP:**
- security-auditor: **SHIP**, no findings above INFO (confirmed `tools:[]` genuinely disables tools at
  `openRouterModelClient.ts:221`; no SoD/tenancy/injection surface).
- spec-reviewer & code-quality-reviewer: **fix-then-ship** — one Important gap: AC-RQL-003 had no owning
  test. **Closed:** added the AC-RQL-003 window-sizing fixture (asserts a ~50k-char single analytical turn
  stays uncompacted under the 80k default, and WOULD have compacted under the old 24k). Minor items also
  applied: AC-id test titles (AC-RQL-001/002/011 now grep-discoverable), `catch` logs the error object,
  synthesis-ignores-`tool_calls` + truncation intent documented.

Owner review + PR-to-`dev` pending; deploy is agent-surface owner-gated. Owed: the ADR-0052 eval run for
AC-RQL-020/021 (prompt-steer effect on the live model).
