# ClickUp ↔ PMO tasks — divergence analysis

**Date:** 2026-07-20 · **Status:** analysis, no code changed · **Follows:** `docs/plans/2026-07-20-clickup-integration-completion.md`

### Resolved since (2026-07-22)
The divergences analyzed here are closed in the merged implementation: task description/priority (#350),
archive and rollup exclusion (#352), and integration-enablement/project ownership through **PRs #353–#358**.
That includes status-map resolution, project-aware ownership and client routing, safe unbound-List handling,
active-binding-only sweep, default-ON uniform kill-switch, the two-direction binding map, and atomic connect
with operator-only trap-state recovery. The remaining open items are tracked in the completion plan; this
spike's analysis below is retained as historical evidence.

**OD-INT-13 (status map round 3, `fix/status-map-round3`)** — the strict pairwise-distinctness rule for PMO→ClickUp status mapping was replaced with explicit per-status resolution allowing `pmo-only` outcomes:
- `Blocked` defaults to `pmo-only` when no distinct ClickUp status exists (ClickUp ships 3 statuses by default).
- `pmo-only` statuses are never pushed outbound and never overwritten inbound.
- Collapse is permitted only when explicitly recorded, never by auto-derivation.
- Storage: `pmoOnlyStatuses?: string[]` on binding `config` jsonb (optional, no migration).
- Validation still rejects a PMO status with no recorded resolution at link time.
- A named test asserts the real 3-status List links successfully with `Blocked` resolving `pmo-only`.

This resolves the shipping blocker in §2.1 (both bugs A and B). The remaining divergences in §2.1 are now about *map completeness at link time*, not a structural impossibility.

What PMO's task model can and cannot express against ClickUp's, where the current sync code
diverges from ClickUp's documented behaviour, and what must be filled, verified and tested before
`EXTERNAL_CONNECT_ENABLED` goes on.

Sources: ClickUp official API docs (cited inline); PMO code map (file:line cited inline).
Everything below marked **[doc]** is from ClickUp's published docs; **[unverified]** could not be
confirmed from official docs and needs a live check.

---

## 1. Field divergence

PMO `tasks` has **13 columns** (`0001_init_schema.sql:206-217` + `0023`/`0034`/`0093`). ClickUp's task
object has ~40 fields. The mapped set is **5 fields** (`clickup/mapping.ts:75-111`).

### 1a. Mapped today (the entire sync surface)

| PMO | ClickUp | Direction | Fidelity |
|---|---|---|---|
| `name` | `name` | both | exact |
| `status` (4-value enum) | `status.status` (per-List string) | both | **lossy + broken, see §2.1** |
| `start_date` (date) | `start_date` (ms epoch) | both | **date↔datetime, see §2.4** |
| `end_date` (date) | `due_date` (ms epoch) | both | same |
| `assignee_id` (single FK) | `assignees[]` (array) | both | **lossy, see §2.3** |
| `completed_at` | `date_done` | inbound only | see §2.5 |

### 1b. PMO-only — deliberately never pushed (`onboarding.ts:50-61`)

`milestone_id`, `task_dependencies`, `org_id`, `project_id`, `tombstoned_at`, `source_updated_at`.
These are PMO *enhancements* over an externally-owned domain (ADR-0055) and the column-pin trigger
(`0093:97-139`) enforces that users may only touch them while ClickUp owns tasks. **Correct as
designed** — but see §3.2, dependencies are not actually pinned.

### 1c. ClickUp-only — PMO has no home for these

Every one is silently discarded on pull-adopt and invisible to a PMO user. Each needs an explicit
decision: *give it a column*, or *document it as "lives in ClickUp"* and link out.

| ClickUp field | Impact if ignored | Suggested call |
|---|---|---|
| `description` / `markdown_description` | PMO tasks are a bare name. Push-seeded ClickUp tasks have no body. | **Add a column.** Highest user-visible gap. |
| `priority` (1–4) | No priority anywhere in PMO — no column, no enum, no UI. | **Add.** Cheap; users will expect it. |
| `parent` (subtasks) | ClickUp subtasks are **excluded by default** from list reads → currently invisible AND undocumented (§2.2). | Decide: flatten, or `parent_task_id`. |
| `tags[]` | lost | document as ClickUp-side |
| `time_estimate` / `time_spent` | PMO `timesheet_entries` keys on `project_id`, not `task_id` (`0001:193-200`) — no join possible | document; revisit with timesheets |
| `custom_fields[]` | lost; also the natural home for a PMO-id round-trip key (§3.5) | **use one** for idempotency |
| `checklists`, `comments`, `attachments`, `watchers`, `points`, `linked_tasks`, `dependencies` | lost | document as ClickUp-side |

---

## 2. Semantic divergences — where both sides have the field but disagree

These are worse than missing fields, because they look like they work.

### 2.1 ⛔ Status mapping — **shipping blocker, two independent bugs**

**Bug A — `external-link` writes empty maps.** The P3 link path the admin UI actually calls inserts
`config: { direction, statusMap: {}, memberMap: {} }` (`external-link/index.ts:466-476`). Outbound,
`toClickUpStatus` **throws `commit-rejected` when a status is unmapped** (`statusMap.ts:17-23`).
⇒ With a binding created by `external-link`, **every outbound task write fails**, and push-seed
fails on its first task. Inbound, `fromClickUpStatus` falls back to `defaultPmoStatus` (`:30-35`)
⇒ **every ClickUp task lands in PMO as `To Do`**, including completed ones.

The older `clickup-onboard` fn *does* capture maps from the List (`captureMaps`, `:67-101`). The two
link paths diverged; the one wired to the UI is the empty one.

**Bug B — `captureMaps` is itself incomplete**, so fixing A by calling it is not enough:
- `pmoToClickUp` only ever gets `To Do` and `Done` (`:90-97`). PMO's enum has **four** values
  (`0001_init_schema.sql:23`) — **`In Progress` and `Blocked` stay unmapped ⇒ `commit-rejected`**
  on any task not in those two states.
- It treats only `type === 'closed'` as done. ClickUp status types are `open | custom | closed |
  done` **[doc]** — a `done`-type status maps to PMO `To Do`. Completions made in ClickUp under a
  `done` status will read back as not-started.

**Confirmed against the real workspace (2026-07-20):** the probe List's statuses were
`to do` (type `open`), `in progress` (type `custom`), `complete` (type `closed`). Under `captureMaps`
that yields `pmoToClickUp = {To Do:"to do", Done:"complete"}` — so a PMO task in **`In Progress` or
`Blocked` is `commit-rejected`**, even though the List has a perfectly good `in progress` status.
Inbound, `in progress` (type `custom`) maps to PMO `To Do`.

**Consequence beyond tasks:** PMO's `delivery_pct`, milestone `effective_pct`, the S-curve and the
project Gantt are all derived from `status = 'Done'` (`0023:59-66`, `0033:161-176`, `sCurve.ts:46-54`).
A silent status mis-map corrupts **delivery reporting**, not just a task row.

**Fill:** build the map at link time from `GET /list/{id}` → `statuses[]` **[doc]** covering all four
PMO statuses and all four ClickUp types; surface it in the link UI for confirmation; refuse to
activate a binding whose `pmoToClickUp` does not cover the full PMO enum.

### 2.2 Default-excluded tasks — the read filter is wrong four ways

`GET /list/{id}/task` excludes, **by default**: closed, **subtasks**, **archived**, and **tasks-in-
multiple-lists** **[doc]**. Our sweep passes only `include_closed=true` (`reads.ts:25-32`).

⇒ ClickUp **subtasks never reach PMO** and never will. ⇒ **Archived** ClickUp tasks vanish from the
feed while their PMO mirror lives on forever (see §2.6). ⇒ A task in two Lists is seen or missed
depending on which List is polled.

The same defaults break the **link-direction emptiness check** (`external-link/index.ts:112-194`): a
List containing only closed/archived/subtask items reads as **empty**, so push-seed proceeds into a
non-empty List. This is the `include_closed` question from the completion plan — it is a four-part
question, not one.

### 2.3 Single assignee vs `assignees[]`

Inbound takes `assignees[0]` (`mapping.ts:31-42`). ClickUp does not document array-order stability
**[unverified]** ⇒ the PMO assignee can flap between syncs with no user action, and each flap is a
real UPDATE that fires cache invalidation across milestones + delivery (`useTasks.ts:67-73`).

Outbound is better than it looks: `resolvePreviousAssigneeIds` (`dispatchFactory.ts:87-98`) returns
only the *mapped* previous assignee, so the `{add, rem}` delta does **not** strip co-assignees.

**Also: `memberMap` is empty in both link paths** (`external-link:470`; `captureMaps:99-100` leaves it
empty by design). ⇒ inbound assignee → `null` always; outbound assignee → dropped from the payload.
**Assignee sync is effectively dead until a member map exists.** Needs a PMO-profile ↔ ClickUp-member
join (by email — both sides expose it) at link time.

### 2.4 `date` vs ms-epoch datetime

PMO `start_date`/`end_date` are `date`. ClickUp stores ms epoch with companion `due_date_time` /
`start_date_time` booleans **[doc]**; date-only custom fields "return 4:00 am in the user's timezone"
**[doc]**. Round-tripping a date-only value can shift a day across timezones and produce a **phantom
diff every sync** — each one a write, an invalidation, and a rate-limit call. We never send
`due_date_time`/`start_date_time` (`types.ts` create/update bodies).

**Fill:** send `*_time: false` on writes; normalise inbound to the date in a fixed timezone; add a
"no-op if unchanged" guard before writing the mirror.

### 2.5 `date_done` vs `date_closed` — **partly resolved live 2026-07-20**

Moving a task into a `closed`-type status set **both** `date_done` and `date_closed`, so the mapping
holds for `closed`. The probe workspace had no `done`-type status, so the `done`-type case is still
**[unverified]** — keep the fallback (`status='Done'` + `completed_at is null` ⇒ use `date_closed`,
then `end_date`).

Original concern:

We map `date_done` → `completed_at` and the completion trigger **trusts it verbatim** under external
ownership (`0093:141-166`). ClickUp distinguishes `date_done` from `date_closed` **[doc]**. A task in a
`closed`-type-but-not-`done` status can have `date_done = null` ⇒ PMO `status='Done'` with
`completed_at = null` ⇒ the S-curve loses that completion point (`sCurve.ts:46-54` uses `completed_at`
as the real signal, `end_date` only as proxy).

### 2.6 Archive ≠ delete

ClickUp archiving fires **`taskUpdated`, not `taskDeleted`** **[doc]**. PMO tombstones only on
`taskDeleted` (`webhookApply.ts:92-109`). Combined with §2.2 (archived excluded from sweep), an
archived ClickUp task becomes a **permanently stale PMO row that no code path can ever reconcile**.
PMO has no task-archive concept either — `policy.ts:154-159` declares `task.archive` but nothing
implements it and there is no `archived_at` column.

---

## 3. Protocol / correctness gaps

### 3.1 ⛔ Webhook payload shape is wrong — **VERIFIED LIVE 2026-07-20**

Captured with `scripts/clickup-webhook-capture.ts` (7 real deliveries, fixtures in
`supabase/functions/_shared/testing/fixtures/clickup-webhook/`). The workspace artifacts were deleted.

**Real envelope — identical on all 7 deliveries:**
```json
{ "event": "...", "task_id": "...", "team_id": "...", "webhook_id": "...", "history_items": [ ... ] }
```

- **No `task` object** on any event (`hasTaskObject: false`, 7/7). Our type assumes one.
- **No `date_updated`** ⇒ the source-mod guard (`applyEngine.ts:78-80`) has no cursor to compare.
- **No `list_id`.** ⚠️ **New finding:** `clickup-webhook/index.ts:87-96` resolves the binding for an
  unmapped (adopt) task from the payload's `list_id`. That field does not exist ⇒ **the adopt tier is
  unreachable dead code**. The List must come from the re-GET (`task.list.id`).
- `team_id` **is** present and undocumented — a cheaper org-resolution key than the current
  single-org fallback (`:99-114`).
- `taskDeleted` carries `history_items: []` (docs say the key is absent; ours had it empty). Either
  way there is no state — a tombstone still needs a locally cached last-known value.
- **Signature header present on 7/7**, confirming verify-before-parse on the raw body.

**Event fan-out — 5 actions produced 7 deliveries.** One status change fires **both** `taskUpdated`
(`field: "status"`) *and* `taskStatusUpdated`. Since the fix re-GETs the task, duplicates are
idempotent but double the API cost. **Subscribe to `taskCreated`/`taskUpdated`/`taskDeleted` only** —
`taskUpdated` already carries status and archive changes; `taskStatusUpdated` is pure duplication.

**Archive confirmed (§2.6):** archiving fired `taskUpdated` with `history_items[].field === "archived"`.
That is the exact detection hook.



`ClickUpWebhookPayload` (`types.ts:63+`) assumes `{ event, task_id, date_updated, list_id, task }`.
The real envelope is `{ event, task_id, webhook_id, history_items[] }` **[doc]** — **there is no task
object and no `date_updated`**. `history_items[]` is a per-field before/after delta.

⇒ As built, inbound webhooks cannot populate the mirror, and the source-mod guard
(`applyEngine.ts:78-80`) has no cursor value to compare. **The correct pattern is: verify → 200 →
enqueue → re-`GET /task/{id}` → apply.** `taskDeleted` carries no `history_items` at all **[doc]**.

This was flagged PROVISIONAL in the code's own comments; the docs now confirm it is wrong.

### 3.2 Dependencies are not ownership-pinned

`0093` re-cut every `tasks` policy but left `task_dependencies_write` untouched (`0002_rls.sql:102-108`).
⇒ While ClickUp owns tasks, users can still create dependency edges. They render on the Gantt
(`ganttLayout.ts:385-410`) and are **pure PMO-local phantoms** — never pushed, invisible in ClickUp.
Either that is intended (a PMO enhancement, like `milestone_id` — then say so and test it) or it is
an oversight. Undocumented today.

### 3.3 The agent's task-status action breaks under external ownership

`agent-chat` `update_task_status` writes `tasks.status` directly under the caller's JWT
(`actions.ts:316-341`), bypassing `routeTaskWrite()`. Under external ownership the column-pin trigger
branch (b) (`0093:97-139`) pins all roles to enhancement columns ⇒ **the write raises `42501`**.
The AI assistant will fail with a raw permission error the moment ClickUp is employed. Must route
through `adapter-dispatch` or be disabled with an explanatory message.

Same class, but benign: `updateTaskMilestone` (`milestones.ts:216-225`) also bypasses routing — and
that one is *correct*, because `milestone_id` is an enhancement column. Worth a test that pins the
distinction.

### 3.4 Echo loop — and a cheap fix we already have the pieces for

PMO writes with a personal token that belongs to a real ClickUp user, so **our own writes fire
webhooks back at us**. The `source_updated_at` guard only rejects *older* changes; our echo arrives
*newer* and is applied. Mostly idempotent, but it doubles write volume, burns the rate limit, and
races concurrent user edits.

ClickUp's only supported loop-break is the actor id on `history_items[*].user.id` **[doc]**.
**We already call `GET /user` during connect to validate the token** — store that user id on the
binding and drop self-authored events. Small change, real value.

### 3.5 No idempotency anywhere

ClickUp documents **no** idempotency key, no ETag, no optimistic concurrency **[doc]**. A timed-out
`POST /list/{id}/task` retry **duplicates the task**. `commitClickUpTaskCommand` (`commands.ts:33-42`)
has no read-before-create. Fix: write the PMO uuid into a ClickUp Custom Field (or Custom Task ID)
and reconcile on retry.

### 3.6 Webhook budget and health are unmanaged

**[doc]** ClickUp marks a webhook *Failing* if the endpoint errors **or takes >7s**; retries 5× per
event then **drops the event permanently**; 100 failures ⇒ *Suspended*; a 401/410 suspends
immediately; **no notification is sent** and failed events are never redelivered.

We have no async enqueue (the handler does its DB work inline, and §3.1 adds an outbound re-GET to
that path), and nothing polls `GET /team/{id}/webhook` for `health.status`/`fail_count`. A quiet
suspension would look exactly like "ClickUp isn't changing anything."

### 3.7 Rate limit is unhandled

100 req/min per token on Free/Unlimited/Business **[doc]**, shared with everything else using that
token. The sweep runs every 5 min (`0094_clickup_sweep_cron.sql`), enumerates multiple Lists, 100
tasks/page. Nothing reads `X-RateLimit-Remaining` or handles **429** via `X-RateLimit-Reset` (there is
no `Retry-After` **[doc]**). A `rateLimiter` lane exists (`rateLimit.ts`) but is a client-side lane,
not a server-signal backoff.

### 3.8 List lifecycle is unhandled

If the bound List is deleted, moved or renamed, the sweep just returns nothing, forever, silently.
`listDeleted` / `listUpdated` webhook events exist **[doc]** and are not subscribed.

---

## 4. Ranked gap list

**Blockers — the integration is not functional without these**

1. §2.1 status map (both bugs) — outbound fails entirely; inbound corrupts delivery reporting.
2. §3.1 webhook envelope — inbound sync as designed cannot work.
3. §2.2 read filters (`subtasks`, `archived`, `include_timl`) + the emptiness check that depends on them.
4. §2.3 member map absent — assignee sync is dead.

**Correctness — silent data damage**

5. §2.6 archive→stale-forever · 6. §3.5 duplicate-on-retry · 7. §2.5 `date_done` gap ·
8. §3.3 agent action 42501 · 9. §2.4 date/timezone phantom diffs

**Operability — fails quietly in production**

10. §3.6 webhook health + 7s budget · 11. §3.7 429 handling · 12. §3.4 echo filter · 13. §3.8 List lifecycle

**Decisions needed (not bugs)**

14. §1c which ClickUp-only fields get a PMO home — `description` and `priority` are the two that
    users will notice immediately. 15. §3.2 are PMO-local dependencies intended?

---

## 5. What to verify live (and how, without spamming — OD-INT-8)

One session, one pass, clean up after. Each item below is a *wire-shape* question mocks cannot answer.

| # | Question | Method | Cost |
|---|---|---|---|
| V1 | Do closed/archived/subtask items make a List read as empty? | create 1 closed + 1 archived + 1 subtask in the test List; `GET /list/{id}/task` with each flag combination | ~6 calls |
| V2 | What are the test List's real statuses and types? | `GET /list/{id}` → `statuses[]` | 1 |
| V3 | Real webhook envelope, incl. a `taskUpdated` from an archive | tunnel + register webhook, capture one delivery each of created/updated/status/deleted/archived, **then delete the registration** | 5 events |
| V4 | Does `date_done` populate for a `closed`-but-not-`done` status? | move a task through each status type, read back | ~4 |
| V5 | Write round-trip incl. `*_time: false` and a Custom Field id round-trip | create → update → delete one task | ~4 |
| V6 | Echo: does our own write produce a webhook with our user id in `history_items[*].user.id`? | one write while the webhook is live | 0 extra |

All within one 100-req minute. **Delete every task, subtask and webhook registration created.**

---

## 6. What to test (and at which layer, per ADR-0010)

**Unit (Vitest, mocked fetch) — most of this belongs here**
- statusMap covers all 4 PMO statuses × all 4 ClickUp types; **a binding whose `pmoToClickUp` misses
  any PMO status is rejected at link time** (the mutation check: delete a mapping ⇒ red).
- `fromClickUpStatus` maps by ClickUp status **type**, not just by name.
- Read query builder emits `subtasks`/`archived`/`include_timl`/`include_closed`; emptiness check uses them.
- Webhook: parse a **real captured V3 envelope** (fixture from §5) → re-GET → apply. Assert the handler
  never reads a `task` object off the payload.
- Echo filter drops self-authored events; keeps others.
- `date_done` null + `Done` status ⇒ `completed_at` fallback behaviour is explicit.
- Date round-trip is a no-op (no phantom write) across a timezone boundary.
- 429 with `X-RateLimit-Reset` ⇒ backoff, not failure.

**pgTAP**
- `task_dependencies` write under external ownership: whichever way §3.2 is decided, pin it.
- Agent-path status write under external ownership fails/succeeds per the §3.3 decision.
- `updateTaskMilestone` still permitted under external ownership (enhancement column).
- Archive-sourced tombstone path once §2.6 is decided.

**E2E (curated, one journey — AC-EAC-018)**
- connect → link (map confirmed in UI) → create a PMO task → appears in ClickUp → change status in
  ClickUp → PMO milestone % and delivery_pct move. That last assertion is the one that proves the
  status map is right, because it is the thing §2.1 silently corrupts.

**Guardrail**
- A CI check that `external-link` and `clickup-onboard` cannot drift again — one shared map-building
  function, imported by both. The bug in §2.1 exists *because* there are two link paths.
