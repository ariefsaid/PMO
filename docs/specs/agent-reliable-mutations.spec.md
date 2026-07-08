# SDD: Agent Reliable Mutations — proof-of-done for agent write actions

**Feature:** The agent's write actions (`create_activity`, `update_task_status`, `notify`,
`create_automation`) can today report **success without proof the rows committed**. The worst case is
`update_task_status`, which performs `.update().eq('id', taskId)` with **no `.select()` and no affected-row
count** and then returns the **input** as the result (`{ taskId, status }`, `actions.ts:333`) — so a write
the FE `can()` UX-preflight allowed but that **RLS or a server-enforced SoD rule silently refused** (ADR-0016
makes `can()` UX-only; ADR-0019 makes RLS/security-definer RPCs the enforcement authority) affects **0 rows**
and returns **no error**, yet the tool result looks identical to a real success. The model then over-claims
"done" and the user sees a lie. This spec adopts agent-native's Phase-0 **reliable-mutations** discipline
(`@agent-native/core` `docs/design/durable-agent-runs.md`, "Tie-in" → "Proof-of-done verification"):
**after a write, re-read and report the concrete committed identity (id / count) — never an optimistic echo
or a bare `{ok:true}`; on a `MAX_TOOL_ROUNDS`(=8) cutoff, report truthful "M of N committed + remainder."**

**Spec ID prefix:** ARM (`FR-ARM-###` functional · `NFR-ARM-###` non-functional · `AC-ARM-###` acceptance)
**ADR refs:** ADR-0036 (§2 deputy invariant — caller JWT, RLS sole enforcement authority; service_role only for
`auth.getUser`), ADR-0016 (`can()` is UX-only; RLS enforces), ADR-0019 (server-enforced SoD + destructive
deletes via security-definer RPC / restrictive RLS + pgTAP proof), ADR-0043 (agent-events persistence,
journaled tool-writes), ADR-0044 (`notify` / `create_automation`), ADR-0010 (test pyramid), ADR-0001 (org_id seam).
**Reference pattern (read-only):** `@agent-native/core` `docs/design/durable-agent-runs.md` — Phase-0 Tie-in
("Proof-of-done verification", "Loud termination") and Goal #2 ("truthful terminal state… never a false
success"). We adopt the **pattern**, not their Nitro/Netlify machinery.
**Layer ownership (ADR-0010):** action result-shapes + handler committed-summary aggregation → **Unit**
(Vitest; actions are pure-DI over an injected caller-JWT client, importable in Node per the `actions.ts`
header; handler aggregation is a pure fold over in-request tool results); the RLS-refused-write guarantee →
**pgTAP** (`supabase test db`, the ADR-0010 home for RLS/tenancy/role contracts); user-visible truthful answer
across a `MAX_TOOL_ROUNDS` cutoff → **E2E** (Playwright, one curated cross-stack journey).
**Status:** Draft — 2026-07-08
**Author:** Director (Claude Opus 4.8)

---

## 1. Context & problem

The agent-chat loop (`handler.ts` `runToolLoop`) executes the model's tool calls through `dispatchAction` /
`dispatchActionForced` (the **single** write-execution sites, `handler.ts:474` / `:489`), pushes the returned
`toolResult` into the next round's messages as `JSON.stringify(toolResult)` (`handler.ts:966`, `:997`), and
emits it on a `tool` event as `result: toolResult` (`handler.ts:959`, `:988`). So **whatever an action returns
is the model's entire basis for claiming "done"** — and it is also what the user reads in the transcript's
`ToolCallCard`. Two of the four write actions return **no committed proof**:

1. **`update_task_status` echoes its input.** `actions.ts:329-333` runs
   `sb.from('tasks').update({status}).eq('id', taskId)` with **no `.select()` and no `{count:'exact'}`** and
   returns `{ taskId, status }` — a verbatim copy of the input. PostgREST returns `{data:null, error:null,
   count:null}` for an `.update()` that matches zero rows (the default is `Prefer: return=minimal`); an
   RLS policy that filters the row out of the caller's view, or an SoD RPC that refuses, therefore yields
   **0 affected rows, no error, and a result that looks identical to success**. This is the silent over-claim.
2. **`notify` discards its read-back.** `actions.ts:368-377` runs `.insert(...).select().single()` (so the row
   IS read back) but returns `{ ok: true }`, throwing the committed `id` away — the model/user cannot cite the
   notification that was created, and a future batched notify would have no count to report.

`create_activity` (`actions.ts:280`, returns `{id}`) and `create_automation` (`actions.ts:503`, returns `{id}`)
**already** read back the committed id via `.select().single()` — they are the correct baseline; this spec
normalizes the shape and lifts the other two actions to the same proof-of-done standard.

Compounding the per-write gap, the **run-level terminal** is bare: when the `MAX_TOOL_ROUNDS`=8 loop
(`handler.ts:59`) falls through, `handler.ts:1009` emits `statusEvent('completed', {}, 'reached step limit')` —
a terminal with **no committed summary and no remainder**, even when the run performed writes. So a multi-write
turn that was cut off mid-plan can terminate "completed" with the user told nothing about which writes landed.
agent-native calls this exact failure mode the "silent looked-done" case (`durable-agent-runs.md` "Problem" →
"A tool call that returned a success marker (✓)… does not guarantee its effect was committed… The user is told
it worked; the data says otherwise") and prescribes proof-of-done + loud termination as the Phase-0 cure.

> **The gap is PROOF-OF-DONE REPORTING, not idempotency.** We **already** have journaled-write de-dupe:
`persistence.ts` `loadJournaledWrites` + `hashToolArgs` (sha-256 of canonicalized validated args) make a
re-driven write idempotent across resume/decision re-POST. A re-driven `update_task_status` will **not**
double-apply. That machinery is correct and out of scope here — FR-ARM-008 forbids rebuilding it. What is
missing is that the *first* execution reports **whether it actually committed**, which de-dupe never
addressed (de-dupe answers "did this already happen?"; proof-of-done answers "did it actually happen *this*
time?"). This spec addresses only the second question.

### 1.1 Current-state audit (built vs missing — with file evidence)

Every claim below was verified by reading the code, not trusted from the brief.

| Concern | State | Evidence |
|---|---|---|
| `update_task_status` reads back committed identity | **MISSING** | `actions.ts:329-333`: `.update({status}).eq('id',taskId)` — no `.select()`, no count; returns input echo `{taskId,status}` |
| `notify` reports committed identity | **MISSING** | `actions.ts:374-377`: `.select().single()` then returns `{ok:true}`, discarding the read-back row/id |
| `create_activity` reports committed identity | **BUILT (baseline)** | `actions.ts:270-280`: `.insert(...).select().single()` → returns `{id}` (the committed PK) |
| `create_automation` reports committed identity | **BUILT (baseline)** | `actions.ts:492-503`: `.insert(...).select().single()` → returns `{id}` |
| Write action error surfacing (DB error code) | **BUILT** | every action returns `{error, code}` on a thrown/constraint error (e.g. `actions.ts:279`, `:332`, `:376`, `:502`) |
| Detects an RLS/SoD-refused write (0 rows, no error) | **MISSING** | no write action checks affected-row count or re-reads after update; PostgREST returns no error for a 0-row `.update()` under `return=minimal` |
| Single write-execution site (no scattered `action.run`) | **BUILT** | `handler.ts:474` `dispatchAction`, `:489` `dispatchActionForced` (the only callers of `action.run`); approval branch `:943`/`:1526`, read/confirm:false branch `:972` |
| Tool result is the model's only "done" basis | **BUILT (the lever)** | `handler.ts:966`/`:997` push `JSON.stringify(toolResult)` as the next round's `role:'tool'` message; `:959`/`:988` emit it on the `tool` event |
| Journaled-write de-dupe (idempotency) | **BUILT — do NOT rebuild** | `persistence.ts` `hashToolArgs` + `loadJournaledWrites`; FR-ARM-008 |
| Loud `MAX_TOOL_ROUNDS` step-limit terminal | **BUILT (bare)** | `handler.ts:1009` `statusEvent('completed', {}, 'reached step limit')` — terminal exists but carries **no committed summary / remainder** |
| Prompt "verify before done" / anti-fabrication rules | **BUILT (prose only)** | `prompt.ts:125` (anti-fabrication), `:126` (verify-before-done), `:151-152` (log-activity-and-task-writes skill) — but **no** "report committed ids/counts from the write result; never claim done if committed=0" discipline |
| Model pinned `deepseek/deepseek-v4-flash` | **BUILT — binding, untouched** | not referenced here; this spec changes action result-shapes + handler terminal, never the model |

**Verdict per scope group:** Group 1 (per-write proof-of-done) = **CHANGE existing actions' result shapes**
(no new tools; `update_task_status` and `notify` gain a read-back; all four normalize to a `committed` field).
Group 2 (run-level truthful terminal) = **ENRICH the existing step-limit terminal** (`handler.ts:1009`), not a
new terminal. Group 3 (answer truthfulness) = **PROMPT steering** (one skill clause + re-use of the existing
verify-before-done rule). No new table, no new tool, no migration (§1.2).

### 1.2 Schema impact — none (no migration)

Proof-of-done is a **read-back on existing tables** (`tasks`, `notifications`, `crm_activities`,
`agent_automations`), all of which already have RLS + the `org_id` seam and are read every day by the panel.
No new column, table, index, RPC, or RLS policy is introduced; nothing is written that isn't already written.
**RLS-preserving + org_id-seam-compatible by construction** — the read-back rides the same caller-JWT client
the write did (NFR-ARM-SEC-001), so a row the caller can't see is a row the read-back can't see, which is
*exactly* the signal we want (FR-ARM-002). A reversible migration would only be needed if we persisted the
committed summary; we deliberately derive it from the run's own in-request tool results instead (FR-ARM-006),
so there is nothing to roll back at the DB layer.

---

## 2. Functional Requirements (EARS)

Conventions: **[PROOF]** per-write proof-of-done · **[BATCH]** multi-row / run-level aggregation ·
**[TRUTH]** answer truthfulness (no silent over-claim) · **[DEDUP]** the explicit non-rebuild boundary.

### 2.1 Per-write proof-of-done `[PROOF]`

**FR-ARM-001** (ubiquitous — the read-back contract)
The system SHALL make every agent write action's tool result carry the **concrete committed identity obtained
by a post-write read-back** — for a single-row insert the committed primary-key `id`, and for a single-row
update either the committed `id`/echoed business key **plus an affected-row count of 1** — and SHALL NOT
return an optimistic echo of the input or a bare `{ok:true}` as the success marker. The committed identity is
the model's and the user's **only** basis for "the write happened."

**FR-ARM-002** (state-driven — the RLS/SoD-refused case, the motivating scenario)
While a write completes with **0 affected/returned rows and no database error** — i.e. RLS filtered the target
row out of the caller's view, or a server-enforced SoD rule (ADR-0019 security-definer RPC / restrictive RLS)
silently refused it — the action SHALL return a structured **`{ committed: 0, reason }`** outcome, NOT the
input echo and NOT `{ok:true}`. Because the deputy runs under the caller's JWT and RLS is the enforcement
authority (ADR-0036 §2), a write the FE `can()` UX-preflight (ADR-0016) allowed can STILL be refused
server-side; proof-of-done via read-back is precisely what catches this. `reason` SHALL be a stable
machine-readable token (e.g. `'not_visible_or_refused'`), never a free-text guess at the policy.

**FR-ARM-003** (ubiquitous — the four actions, concretely)
- **`update_task_status`** SHALL read back the affected row (append `.select().single()` to the existing
  `.update().eq('id',taskId)` at `actions.ts:329-331`, or equivalently request `{count:'exact'}` and re-read)
  and return `{ committed: 1, id, status }` on success — **replacing** the current input echo
  `{taskId, status}` (`actions.ts:333`). On 0 rows it SHALL return `{ committed: 0, reason:'not_visible_or_refused' }`
  (FR-ARM-002).
- **`notify`** SHALL return `{ committed: 1, id }` — the committed notification PK it already fetches via
  `.select().single()` (`actions.ts:374`) and currently discards — **replacing** `{ok:true}`
  (`actions.ts:377`).
- **`create_activity`** and **`create_automation`** SHALL additionally carry an explicit `committed: 1`
  alongside the `id` they already return (`actions.ts:280`, `:503`), so all four write actions share one
  uniform `{committed, id?, …}` success shape the model can reason over.

**FR-ARM-004** (ubiquitous — error surfacing unchanged)
A write that errors (a constraint violation, a thrown RPC error, a timeout) SHALL continue to return
`{ error, code }` exactly as today (`actions.ts:279`, `:332`, `:376`, `:502`). Proof-of-done does not change
error handling; it closes the **no-error-but-no-rows** gap (FR-ARM-002), which is orthogonal to the
already-handled error path.

### 2.2 Multi-row / run-level truthful aggregation `[BATCH]`

**FR-ARM-005** (ubiquitous — batch action contract, forward-looking)
Any write action that commits **N rows in one call** (a future bulk/batch action, or an action that loops
inserts internally) SHALL report `{ committed: N }` on full success and `{ committed: M, notDone: N-M,
reason }` on partial success — never a bare success for a batch that did not fully commit. (No batch write
action exists today; this FR fixes the contract so the first one added cannot reintroduce the silent-partial
failure. It also covers any single action that internally performs >1 insert.)

**FR-ARM-006** (state-driven — run-level committed summary on the step-limit terminal)
While a run performs **one or more write tool-calls across rounds** and then the `runToolLoop` reaches the
`MAX_TOOL_ROUNDS`=8 cap (`handler.ts:59`), the terminal `statusEvent('completed', …, 'reached step limit')`
at `handler.ts:1009` SHALL carry a **truthful committed summary** — the list/count of writes this run actually
committed, with their ids — derived from the run's own in-request tool results (the `toolResult` values
already pushed to `messages` at `handler.ts:966`/`:997` and already journaled on `tool` events). The summary
SHALL state **"M of N committed"** when the run had a multi-write plan that the cutoff interrupted, and the
**remainder not done** — never a bare "done"/"reached step limit" that implies the plan finished.

**FR-ARM-007** (event-driven — tie into the existing loud terminal, do not add a new one)
When the step-limit terminal fires on a run that committed ≥1 write, the system SHALL surface the committed
summary (FR-ARM-006) **through the existing terminal event** — enriching its payload/text — rather than
introducing a new event type, a new status value, or a new persistence column. A run that committed **zero**
writes and hit the cap MAY keep the plain "reached step limit" text (no summary to report).

### 2.3 Answer truthfulness (no silent over-claim) `[TRUTH]`

**FR-ARM-008** (ubiquitous — the model must report what the proof says)
The model's final assistant text SHALL NOT assert a write succeeded beyond what that write's tool result
proves: it SHALL report exactly the committed identity/count the result carries (`committed:1, id` → "logged
activity *id*"; `committed:0` → "I couldn't write that — it looks like you don't have access to that record"),
and SHALL NOT say "done" / "updated" / "created" when `committed` is 0 or absent. The system prompt SHALL add
one proof-of-done clause to the existing `log-activity-and-task-writes` skill (`prompt.ts:151-152`) stating
this, reusing — not duplicating — the existing "verify before done" (`prompt.ts:126`) and anti-fabrication
(`prompt.ts:125`) rules. (Defense-in-depth only — NFR-ARM-SEC-002; the tool-result contract is the real
guarantee, the prompt reduces prose over-claim.)

### 2.4 The dedup boundary (explicit non-rebuild) `[DEDUP]`

**FR-ARM-009** (ubiquitous — do NOT rebuild idempotency)
The proof-of-done work SHALL reuse the **existing journaled-write de-dupe** (`persistence.ts` `hashToolArgs` +
`loadJournaledWrites`, consumed by the handler's resume gate) for all idempotency needs and SHALL NOT add a
parallel de-dupe, idempotency-key, or "did this already happen" mechanism. Proof-of-done (did it commit *this*
time) and de-dupe (has it already happened) are distinct concerns; this spec touches only the former. The
implementer MUST NOT conflate them.

---

## 3. Non-Functional Requirements

### 3.1 Security (OWASP / STRIDE)

- **NFR-ARM-SEC-001 — Deputy invariant preserved; read-back rides the caller JWT.** Every read-back
  (FR-ARM-001/003) SHALL use the **same already-injected caller-JWT supabase client** the write used
  (`DeputyContext.supabase`, ADR-0036 §2) — never a `service_role` client, never a hand-threaded `org_id`. A
  row RLS hides from the caller is hidden from the read-back too — which is exactly why `committed:0`
  (FR-ARM-002) is a correct, safe signal and not a false negative. Verified by AC-ARM-007 (pgTAP).
- **NFR-ARM-SEC-002 — Proof-of-done is reporting, not an enforcement control.** The write has already executed
  under RLS by the time the read-back runs; the read-back only *observes and reports*. It SHALL NOT widen
  access, bypass a `can()` gate, or become a second authority — RLS remains the sole enforcement authority
  (ADR-0036 §2). Removing the proof-of-done reporting can regress UX honesty but MUST NOT be able to change
  what a write is allowed to do.
- **NFR-ARM-SEC-003 — No row data leaked by the committed summary.** The step-limit committed summary
  (FR-ARM-006) carries only committed ids/counts the caller already legitimately wrote; it SHALL NOT include
  rows the caller could not read. Logging discipline is unchanged (NFR-AR-SEC-005) — never log prompt/answer
  text or full row payloads.

### 3.2 Performance

- **NFR-ARM-PERF-001 — Bounded extra cost: at most one cheap PK-scoped SELECT per write.** `create_activity` /
  `create_automation` / `notify` already issue `.select().single()` (no new round-trip — they just stop
  discarding the row). `update_task_status` gains **one** `.select()`/count on the PK it just updated — a
  single indexed read per write turn, negligible against the per-round model call (the dominant cost). No
  write action SHALL add unbounded reads, loops, or N+1 patterns to produce its proof.

### 3.3 Quality / model behavior (the honest risk)

- **NFR-ARM-QUAL-001 — Prose over-claim is reduced, not eliminated.** The tool-result contract (FR-ARM-001)
  removes the *structural* ability to silently over-claim (the result now carries the truth), but a weak
  tool-selector (deepseek-v4-flash) can still write "done" in prose while the result says `committed:0`.
  FR-ARM-008's prompt clause reduces this; it does not guarantee it. A regression net is recommended (an agent
  eval asserting the model's answer matches the committed count) but is **out of scope** here and flagged as
  an Open Question — this spec delivers the contract that makes such an eval possible.

---

## 4. Acceptance Criteria (Given/When/Then)

> Layer per ADR-0010 — **one owning layer each**: Unit (Vitest, mocked supabase) owns the action result-shape
> and handler-aggregation logic (actions are pure-DI, importable in Node per the `actions.ts` header);
> pgTAP owns the RLS-refused-write guarantee (the ADR-0019 server-enforced-SoD home); E2E (Playwright) owns the
> one user-visible truthful-answer journey across the cutoff. No AC is split across layers.

**AC-ARM-001 — `update_task_status` returns committed identity, not an input echo. [Unit]**
Given `updateTaskStatusAction.run` is called with a valid `{taskId, status}` against a mocked caller-JWT
client whose `.update().eq().select().single()` resolves one affected row,
When the action runs,
Then the result is `{ committed: 1, id: <taskId>, status }` — and is NOT the prior shape `{ taskId, status }`
(FR-ARM-001/003).

**AC-ARM-002 — An RLS/SoD-refused update reports `committed:0`, never a silent success. [Unit — the motivating
scenario]**
Given `updateTaskStatusAction.run` is called against a mocked client whose `.update().eq().select().single()`
resolves **0 rows / a `PGRST116` "0 rows" error** (the RLS-blocked / SoD-refused case),
When the action runs,
Then the result is `{ committed: 0, reason: 'not_visible_or_refused' }` — NOT `{taskId,status}` and NOT an
error (the DB returned no error; only 0 rows) — asserting FR-ARM-002, the core anti-over-claim guarantee.

**AC-ARM-003 — `notify` returns the committed id, not `{ok:true}`. [Unit]**
Given `notifyAction.run` is called with a valid `{title}` against a mocked client whose insert+select resolves
a row with id `n1`,
When the action runs,
Then the result is `{ committed: 1, id: 'n1' }` — the previously-discarded PK is now reported
(FR-ARM-003, replacing `actions.ts:377`'s `{ok:true}`).

**AC-ARM-004 — `create_activity` / `create_automation` carry `committed:1` alongside their id. [Unit]**
Given either action runs successfully (insert+select resolves one row),
When it returns,
Then the result is `{ committed: 1, id }` — the uniform shape (FR-ARM-003); the existing `{id}`-only return
is upgraded, not replaced.

**AC-ARM-005 — A DB error still surfaces as `{error, code}`. [Unit]**
Given any write action's insert/update throws a constraint error (e.g. a FK violation),
When the action runs,
Then the result is `{ error: <stable msg>, code: <pg code> }` exactly as today — proof-of-done did not regress
error handling (FR-ARM-004).

**AC-ARM-006 — A batch/partial write reports `M of N + reason`, never bare success. [Unit]**
Given a write action that commits N rows returns only M<N committed (e.g. a bulk action partial, simulated by
a mocked client),
When the action runs,
Then the result is `{ committed: M, notDone: N-M, reason }` — never `{committed:N}` for a partial commit
(FR-ARM-005).

**AC-ARM-007 — A caller without UPDATE rights on a task sees `committed:0` server-side (RLS is the authority).
[pgTAP]**
Given a DB role that lacks UPDATE on a target `tasks` row (RLS/SoD refuses; ADR-0019),
When `update_task_status`'s `.update().eq('id').select().single()` runs under that role,
Then PostgREST returns 0 rows / a 0-rows error (no DB error), and the action's read-back therefore yields
`committed:0` — proving the deputy invariant (NFR-ARM-SEC-001) and that proof-of-done catches a silently
refused write where `can()` had allowed it (the motivating scenario, end-to-end at the DB).

**AC-ARM-008 — A multi-write turn cut by `MAX_TOOL_ROUNDS` surfaces a truthful "M of N committed" terminal and
answer, not bare "done". [E2E]**
Given a signed-in user drives the panel to perform a multi-write turn that consumes all 8 tool rounds
(scripted/mocked model that issues writes then keeps going),
When the run hits the step-limit terminal (`handler.ts:1009`),
Then (a) the terminal event carries a committed summary derived from the run's tool results, and (b) the
user-visible answer names the committed writes (ids/count) and the remainder not done — it does NOT say "done"
or show a bare "reached step limit" for a turn that left work unfinished (FR-ARM-006/007/008).

---

## 5. Traceability

| AC | Owning layer | Owning test (name / file) |
|---|---|---|
| AC-ARM-001 | Unit | `AC-ARM-001 update_task_status returns committed identity` (`supabase/functions/agent-chat/actions.proof.test.ts`) |
| AC-ARM-002 | Unit | `AC-ARM-002 rls-refused update reports committed 0 not success` (same file; the motivating-scenario assertion) |
| AC-ARM-003 | Unit | `AC-ARM-003 notify returns committed id` (same file) |
| AC-ARM-004 | Unit | `AC-ARM-004 create_activity/create_automation carry committed 1` (same file) |
| AC-ARM-005 | Unit | `AC-ARM-005 write db error still surfaces code` (same file) |
| AC-ARM-006 | Unit | `AC-ARM-006 batch partial reports M of N + reason` (same file) |
| AC-ARM-007 | pgTAP | `AC-ARM-007 caller without update rights sees committed 0` (`supabase/functions/agent-chat/_tests_/arm_rls_refused_test.sql` — `supabase test db`) |
| AC-ARM-008 | E2E | `AC-ARM-008 cutoff turn surfaces truthful M of N` (`pmo-portal/e2e/AC-ARM-008-cutoff-truthful.spec.ts`) |

> Unit tests cover the action result-shapes + the handler's committed-summary fold (pure logic over the
> in-request tool results); pgTAP owns the one RLS-as-authority proof; E2E owns the single user-visible
> truthful-answer journey. No AC is owned at two layers.

---

## 6. Observed / legacy behavior to preserve (OBS)

**OBS-ARM-001 — `create_activity` / `create_automation` already read back their id.** This spec **normalizes**
(`committed:1, id`) rather than re-invents them; their `.insert(...).select().single()` path is the reference
implementation for FR-ARM-001.

**OBS-ARM-002 — Write error surfacing (`{error, code}`) is unchanged.** FR-ARM-004 / AC-ARM-005 keep the
existing error path byte-for-byte; only the **no-error-but-no-rows** gap (FR-ARM-002) is new.

**OBS-ARM-003 — The deputy invariant is untouched.** No path here constructs a `service_role` client, threads
`org_id` from the client, or bypasses `dispatchAction`/`dispatchActionForced`. The read-back uses the same
caller-JWT client the write did (NFR-ARM-SEC-001).

**OBS-ARM-004 — Journaled-write de-dupe is untouched.** `hashToolArgs` + `loadJournaledWrites` continue to
make re-driven writes idempotent; FR-ARM-009 forbids rebuilding it.

**OBS-ARM-005 — Model, tool catalog, and event types are untouched.** `deepseek/deepseek-v4-flash` stays
pinned (binding); no new tool, no new `agent_events.type`, no new status value; the step-limit terminal is
*enriched*, not replaced (FR-ARM-007).

---

## 7. SoD & Security (OWASP / STRIDE)

**Elevation / deputy invariant (STRIDE-E, ADR-0036 §2, OWASP A01).** The motivating failure is itself an
authorization-honesty bug: today a server-side RLS/SoD refusal can be reported to the user as success.
Proof-of-done (FR-ARM-002) closes it by making the **read-back** — under the same caller JWT — the source of
truth for "committed." No path widens access; RLS stays the ceiling (NFR-ARM-SEC-001/002, AC-ARM-007).

**Tampering / integrity (STRIDE-T, OWASP A08).** A forged/stale `taskId` the caller cannot update yields 0
rows → `committed:0` (FR-ARM-002); the model is steered to report "couldn't write" not "done" (FR-ARM-008).
The committed summary (FR-ARM-006) cannot invent ids — it is a fold over results the run already produced.

**Spoofing / tenancy (STRIDE-S).** Unchanged — the read-back is caller-JWT-scoped; a cross-tenant id is
invisible to it (returns `committed:0`), not leaked (NFR-ARM-SEC-003). No RLS policy or `org_id` seam is
touched.

**Repudiation (STRIDE-R).** Unchanged — write tool events still journal through the existing `agent_events`
append-only path (ADR-0043); the committed summary is derived, not a new audit record.

**Depth note (model-tiering for the security review).** This change is **RLS/table-untouched and
reporting-focused**, but it *closes a genuine authorization-honesty hole* (silent over-claim on a refused
write). The security-auditor should focus depth on AC-ARM-002/007 (the RLS-refused → `committed:0` guarantee
under the caller JWT) and confirm the read-back never elevates (NFR-ARM-SEC-001) — a focused pass, not a
lightwave, since the motivating scenario *is* an authz-honesty fix.

---

## 8. Error Handling

| Error condition | Surface / behavior | User outcome |
|---|---|---|
| Write matches 0 rows under RLS/SoD (no DB error) | `{ committed: 0, reason: 'not_visible_or_refused' }` (FR-ARM-002); prompt steers honest report (FR-ARM-008) | User is told the write didn't land (access/visibility) — not lied to as "done" |
| Write throws a constraint / FK / timeout error | `{ error, code }` unchanged (FR-ARM-004/AC-ARM-005) | User sees the action failed; model can self-correct on the code (as `query_entity` already does) |
| Read-back itself errors (rare transient) | Action returns `{ error, code }` (treat as a failed write, not `committed:0`) — never report success without proof | User sees a failure, not a false success; safe failure mode |
| Batch write commits M of N | `{ committed: M, notDone: N-M, reason }` (FR-ARM-005/AC-ARM-006) | User sees exactly what landed and what didn't |
| Run hits `MAX_TOOL_ROUNDS` mid multi-write plan | Terminal carries committed summary + remainder (FR-ARM-006/007/AC-ARM-008) | User sees "M of N committed, N-M not done (step limit)" — not bare "done" |
| Model over-claims in prose despite `committed:0` | Tool-result contract is correct; prompt reduces it (FR-ARM-008); eval (out of scope) would catch it | Occasional prose/contract mismatch; tracked by NFR-ARM-QUAL-001 |

---

## 9. Non-goals (explicitly out of scope)

- **A SQL-backed progress checkpoint / durable background execution** (agent-native Phase 1/2, Option A/B).
Out — that's the heavier "live reconnect / durable runs" gap (gap-analysis row "Live reconnect", do-next #6),
a separate medium build with new endpoints. This spec adopts only the **Phase-0 proof-of-done + loud
termination pattern**.
- **Rebuilding journaled-write de-dupe / idempotency.** Out — it exists (`hashToolArgs` +
`loadJournaledWrites`); FR-ARM-009 forbids it. The `!runId` lifecycle fix (gap-analysis do-now #1) is also a
separate, already-shipped issue.
- **A model bump or an agent eval harness as a *decided* deliverable.** Out — NFR-ARM-QUAL-001 flags both as
options; the eval is *enabled* by this contract but not built here.
- **Changing the model, the tool catalog, the `agent_events` schema, or any RLS policy.** Out — binding pin
and ADR-0043/0019 boundaries; this spec is result-shape + terminal-text + one prompt clause only.
- **Persisting the committed summary as a new column/table.** Out — it is derived from in-request tool results
(FR-ARM-006), keeping the change migration-free (§1.2).
- **`compose_view` / `ask_user` proof-of-done.** Out — `compose_view` returns `{ok, panels}` / an artifact
(not a row commit) and `ask_user` emits a question (no write); neither is a row-mutation whose commit is in
doubt.

---

## 10. Open Questions for the owner

1. **`update_task_status` proof mechanism — `.select().single()` vs `{count:'exact'}`?** `.select().single()`
   is uniform with the insert actions and returns the row (so we can echo the new status from the DB, not the
   input) but turns a 0-row update into a `PGRST116` error we must map to `committed:0` (FR-ARM-002).
   `{count:'exact'}` is cheaper and gives the count directly but no row to echo. Recommendation: `.select()`
   (returns the row → strongest proof, uniform shape) and map the 0-rows error to `committed:0`. Owner
   confirm?

2. **Committed-summary surface — terminal text vs payload vs both?** FR-ARM-007 enriches the existing
   `statusEvent('completed', …, 'reached step limit')`. Should the summary live in the event's `text` (the
   user reads it), its `payload` (the panel can render it structured), or both? Recommendation: both — a
   concise human text + a structured `payload.committed` for `ToolCallCard`/`ActivityTrail`. Eng-plan owns
   the exact shape.

3. **Eval harness now or later?** NFR-ARM-QUAL-001 flags that prose over-claim can survive the contract. Build
   a minimal agent eval (fixed prompts × seeded DB × oracle asserting answer matches `committed`) in *this*
   issue, or defer it as gap-analysis do-next #8? Recommendation: defer — this issue delivers the contract
   that makes the eval meaningful; ship the contract first.

4. **Scope of "batch write" (FR-ARM-005).** No batch write action exists today. Is FR-ARM-005 (the forward-
   looking contract) enough, or does the owner want a concrete first batch action (e.g. bulk task-status
   update) built in this issue to exercise it? Recommendation: contract only here — add the first batch action
   as its own issue so this one stays MEDIUM.

---

## 11. Contradictions / conflicts flagged against existing code & locked decisions

None against ADR-0036/0016/0019/0043 (this spec operates strictly inside their boundaries — caller-JWT
read-back, RLS as authority, no service_role on business data, no schema change). Facts worth flagging for the
eng-plan (none is a contradiction):

1. **`update_task_status` is the only action that needs a *new* read (not just a re-surfacing of an existing
   one).** `notify`/`create_activity`/`create_automation` already `.select().single()` and only stop
   discarding the row; `update_task_status` (`actions.ts:329-333`) has no `.select()` today and gains one —
   the one place that adds a round-trip (NFR-ARM-PERF-001).
2. **PostgREST 0-rows-on-update is a *success with null data*, not an error.** FR-ARM-002's `committed:0`
   detection MUST treat both "0 rows from `.select()` (PGRST116)" and "`count:0`" as the refused signal — the
   DB returns no error in either case, which is precisely why today's code silently over-claims.
3. **The step-limit terminal at `handler.ts:1009` is shared by the main pass and the decision-continuation
   pass** (both use `runToolLoop`). Enriching it (FR-ARM-007) MUST apply to both callers; the eng-plan should
   confirm the committed summary is derivable in both (both push `toolResult` to `messages` at `:966`/`:997`).
4. **The committed summary is a pure fold over already-produced results — no new persistence.** This is what
   keeps §1.2 migration-free; the eng-plan MUST NOT add a column/table to "store" the summary (that would
   re-introduce a migration and a double-write window the de-dupe work specifically avoided).
