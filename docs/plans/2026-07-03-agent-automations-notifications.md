# Implementation plan — Agent automations (cron + event-triggered) + notifications inbox (batteries-included A, item 5)

- **Date:** 2026-07-03
- **Issue:** PMO #5 (batteries-included A) — ADR-0044 agent automations + notifications.
- **Author:** eng-planner (Claude Opus 4.8 · 1M)
- **Spec:** `docs/specs/agent-automations-notifications.spec.md` (FR-AAN-001..038, OBS-AAN-001..004, NFR-AAN-SEC/PERF/A11Y, AC-AAN-001..036 + traceability table)
- **Binding ADR:** `docs/adr/0044-agent-automations-and-notifications.md` (**ADR-0044 wins over spec on any conflict**)
- **Sibling specs consumed:** `docs/specs/agent-persistence.spec.md` (ADR-0043, issue-2 — the run/event tables this builds on) + `docs/specs/agent-usage-credits.spec.md` (issue-3 — the `RateGuard`/credit-preflight seam, §0 REC-4).
- **Format reference (structure/style this plan mirrors):** `docs/plans/2026-07-03-agent-persistence.md`.

---

## ⚠️ WARNING — post-merge drift (read before building)

This plan was written against the **`feat/agent-persistence` branch as the present baseline** (migration `0046`, `supabase/functions/agent-chat/persistence.ts`, DAL `src/lib/db/agentThreads.ts`/`agentEvents.ts`, panel `ThreadList`/`StuckRunBanner`/`FeedbackControl`) **before issues 3 and 4 merged**. Two numbering seams move as those land — **the implementer MUST re-confirm at build time, not trust the numbers below**:

1. **Migration number.** Baseline top is `0046_agent_persistence.sql`. Issue-3 (credits) takes **`0047`**. This plan takes **`0048_agent_automations_notifications.sql`**. If issue-3 has NOT merged when this builds, `ls supabase/migrations/ | tail` and take the next free number (never re-use). If issue-3 merged at a *different* number, still take the next-free.
2. **pgTAP test numbers.** Issue-2 owns `0090–0092`. Issue-3's spec places its pgTAP at unnumbered `00XX_*` (balance/tenancy/schema — ~3 files, likely `0093–0095`). This plan starts its pgTAP at **`0096`** to leave a clean gap. Re-confirm `ls supabase/tests/ | tail`; if issue-3 landed at different numbers, take the next free block of 4 and update the traceability table's filenames in lockstep.
3. **Issue-3 seam names.** This plan references the credit preflight as `RateGuard.check(userId)` (the OBS-AUC-001 shape) and a `_shared/creditRateGuard.ts` implementation. Issue-3's eng-plan fixes the exact filename + the `AGENT_CREDITS_ENFORCED` toggle default. **Confirm the exact exported symbol before writing Task F4/F5** (§0 REC-4). If issue-3 has not shipped, FR-AAN-032/033 + AC-AAN-027 are **blocked** — build Phases A–E, stub the credits preflight behind a no-op `RateGuard` in the dispatcher, and land Task F4/F5 + AC-AAN-027 only once the seam exists (spec "Contradictions" §, backlog sequences 3 before 5 for exactly this reason).

---

## 0. Authority reconciliation & conflicts found (binding — read before building)

ADR-0044 is Accepted and controlling; the spec operationalizes it faithfully. The spec's own "Contradictions" section already confirms **no requirement-level conflict** with ADR-0044. Below are the mechanical file-path/number reconciliations and the two genuine cross-code seams the plan must respect. None require owner adjudication (per the spec's "Open Questions": file names/exact SQL/mechanical choices are the eng-plan's to pick).

| ID | Spec/ADR says | Repo reality (verified) | Resolution (binding for this plan) |
|---|---|---|---|
| **REC-1** — edge-fn unit-test location | Traceability places dispatcher tests at `supabase/functions/agent-dispatch/dispatcher.*.test.ts`. | The agent-chat edge fn is **not** unit-tested in-place — all handler/logic unit tests live under **`pmo-portal/src/lib/agent/*.test.ts`** and import across the boundary (`import … from '../../../../supabase/functions/agent-chat/handler'`). There is **no Vitest project rooted in `supabase/`** (confirmed: issue-2's `handlerPersistence.test.ts` etc. all live under `pmo-portal`). | All dispatcher/mint/watermark/condition/credits **logic** lives in `supabase/functions/agent-dispatch/*.ts` (importable, pure), and its **tests** live under **`pmo-portal/src/lib/agent/dispatch/*.test.ts`**, importing via relative path `../../../../../supabase/functions/agent-dispatch/*`. The catalog-entry tests (`notify`/`create_automation`) live under `pmo-portal/src/lib/agent/` next to `agentChatHandler.test.ts`. AC-ids unchanged. |
| **REC-2** — repository/DAL location | Spec TODO says `src/lib/repositories/notifications.ts` / `agentAutomations.ts`. | Shipped agent/user_views code uses **`src/lib/db/*`** (`userViews.ts`, `agentThreads.ts`, `agentEvents.ts` from issue-2), NOT `src/lib/repositories/*`. | DAL files go to **`pmo-portal/src/lib/db/notifications.ts`** (+ `.test.ts`). No `agentAutomations.ts` DAL is needed client-side in v1 (automations are chat-created + dispatcher-read only; no client list/editor — spec Out of Scope). |
| **REC-3** — bell prop reinstatement | Spec FR-AAN-034/OBS-AAN-001: reinstate the `ContextBar` bell removed in B-5. | `ContextBarProps.notificationCount?: number` (line 17) is present but the bell **render block is deleted** (lines 115-119 are a comment). The prop is `_notificationCount` (underscore-unused). | The `NotificationBell` renders as its **own component** mounted in `ContextBar` behind `isFeatureEnabled('agentAssistant')`; the bell owns its own unread-count query (not the `notificationCount` prop, which the plan removes — OBS-AAN-001's "replaced by a real subscription/query, not a new prop shape"). Delete the `notificationCount` prop + its underscore param in the same edit (Task E4). |
| **REC-4** — credits seam name | Spec FR-AAN-032: "the `RateGuard` injection point, `HandlerDeps.rateGuard`, extended per the credits spec." | Confirmed in `handler.ts`: `RateGuard { check(userId): Promise<{exceeded, retryAfterSeconds}> }` (line 93) wired at Gate 3 (line 408). Issue-3's spec (`agent-usage-credits.spec.md` FR-AUC-011) supplies a **credit-backed** `RateGuard` impl in `_shared/creditRateGuard.ts` (exact name TBD by issue-3's plan). | The dispatcher's preflight (Task F4) constructs the **same credit-backed `RateGuard`** issue-3 wires into `index.ts`, calls `.check(owner_id)` before firing, and treats `exceeded:true` as no-start + warning notification (FR-AAN-033). **Blocked on issue-3** (see WARNING §3). |
| **REC-5** — `service_role` vs `procurement_status_events` RLS | FR-AAN-014: dispatcher reads status-event tables under `service_role` for watermark comparison. | `procurement_status_events` (migration 0038) has `enable`+`force` RLS with a read-only owner/tenant policy + **no write policy**. | **Not a conflict:** `service_role` bypasses RLS entirely (it is the postgres superuser-adjacent role Supabase issues), so the dispatcher's `service_role` client reads `procurement_status_events` regardless of its policies. The quarantine (FR-AAN-014/NFR-AAN-SEC-002/AC-AAN-018) is enforced by the dispatcher **only ever** calling `.from()` on `{agent_automations, agent_dispatch_watermarks, procurement_status_events}` under `service_role` — proven by Task D6's table-set assertion, not by RLS. Note this explicitly in the migration header + the security-auditor brief. |

**Constants this plan fixes (spec left them to the eng-plan):**

- **Migration number:** `0048` (WARNING §1 — re-confirm at build).
- **pgTAP block:** `0097–0100` (WARNING §2 — re-confirm).
- **Watermark storage shape (FR-AAN-013, spec Open Q):** a **new small table `agent_dispatch_watermarks`** — `(source text primary key, last_seen_id uuid, last_seen_at timestamptz, updated_at timestamptz)`, **service-role-only** (RLS `enable`+`force`, **no policy** → default-deny to every JWT role; only `service_role`, which bypasses RLS, reads/writes it). Rationale: a column on a singleton config row would couple watermark bookkeeping to an unrelated table and lacks a natural per-source key; a dedicated 1-row-per-source table is the minimal, indexed, monotonic store FR-AAN-013 needs and is trivially extensible when a second status-event source is added. It carries **no `org_id`/`owner_id`** — it is dispatcher infrastructure, not tenant data (the automations it feeds are tenant-scoped; the watermark is a global cursor over an append-only log). This is recorded in ADR-0046 (see §6), not just here, because "a non-tenant, service-role-only infra table in a tenancy-seam codebase" is a cross-cutting decision.
- **Condition-eval memo TTL (FR-AAN-022, NFR-AAN-PERF-003):** `CONDITION_MEMO_TTL_MS = 60_000` (60s = one tick window). Exported from `supabase/functions/agent-dispatch/condition.ts`. Rationale: a burst of matching events within a single dispatcher tick (≤1 min latency, ADR-0044 §2) must not re-bill the cheap model per event; 60s caps re-billing to once per `(automation_id, condition)` per tick without holding memo state across ticks (the dispatcher is a fresh edge-fn invocation each tick — the memo is an in-invocation `Map`, not a persisted cache, so TTL is really "within this tick's batch"; the 60s constant documents intent + guards a future long-tick).
- **`create_automation` role gate (spec Open Q):** **NO additional `can()`/role gate** beyond ownership — `getPermissionCheck('create_automation')` returns `null`, matching `create_activity`'s precedent (confirmed against `handler.ts` line 297-304: only `create_activity`/`update_task_status` map to a permission; the default is `null` = no role check, ownership via RLS is the gate). Flagged to the Director (§7 Q2) as the one policy call the spec said to raise if a restriction is wanted; the plan defaults to no-gate and proceeds.
- **`timeout_s` enforcement (spec Open Q):** reuse the existing `MAX_TOOL_ROUNDS=8` per-run bound (handler.ts line 51) as the primary wall-clock ceiling; the dispatcher additionally passes an `AbortSignal` with `automation.timeout_s * 1000` deadline into the fire call (Task D5). FR-AAN-018 fixes the *bound*, not the mechanism; this reuses the shipped bound (OBS-AAN-003) and adds a coarse deadline.

**The minting slice is the single most security-sensitive surface (NFR-AAN-SEC-001).** Every task touching `mint.ts` is marked **[OPUS-IMPL]** — it must be built by an opus-tier implementer, and its **cross-tenant gate test lands in the same task as the mint code** (never separately — a mint landing without its gate is the exact tenancy-breach risk ADR-0044 §3 names). Tasks D3/D4/D6 are the minting slice.

---

## 1. Architecture & data flow

```
pg_cron (per-minute job, migration 0048)
  └─ net.http_post → supabase/functions/agent-dispatch  (NEW edge fn — does NOT touch agent-chat code)
         index.ts        (Deno.serve entry; builds serviceClient + authAdmin; calls runDispatchTick)
         dispatcher.ts   (PURE tick orchestration — importable in Vitest via REC-1 path)
           selectDueSchedules(serviceClient, now)        ── service_role, agent_automations ONLY
           selectTriggerMatches(serviceClient, wm, now)  ── service_role, agent_automations + procurement_status_events + agent_dispatch_watermarks ONLY
           for each due automation:
             ├─ condition.ts  evaluateCondition(cheapModel, memo) → true | false | {error}   (kind='trigger' + condition only)
             ├─ credits: RateGuard.check(owner_id)  → exceeded? → no-start + notify(warning)   [issue-3 seam, REC-4]
             ├─ mint.ts   mintOwnerJwt(authAdmin, automation)  ── service_role → Auth admin API, owner_id ONLY  [OPUS-IMPL]
             │              └─ auditMint(mintedClient, automation) → agent_events type='system' row  (BEFORE any other use)
             ├─ fire.ts   fireAutomation(mintedClient, owner_id, automation, signal)
             │              └─ agentChatHandler(...)  — SAME catalog / SAME RLS ceiling / SAME can() re-auth
             │                   under the MINTED-owner-JWT client (indistinguishable from interactive)
             └─ watermark.ts  advanceWatermark(serviceClient, source, lastSeen)  (AFTER batch success)

Postgres (migration 0048)
  agent_automations   (owner-only RLS; kind CHECK; schedule/trigger_on conditional CHECK; soft-archive)
  notifications       (owner-only RLS; mark-read-only UPDATE; unread partial index)
  agent_dispatch_watermarks  (service-role-only infra table; no org_id/owner_id)

agent-chat catalog (SMALL touch — the interactive/minted producer side)
  actions.ts   +notifyAction (confirm:false)  +createAutomationAction (confirm:true)
  schema.ts    +NOTIFY_SCHEMA  +CREATE_AUTOMATION_SCHEMA
  handler.ts   register both in BASE_ACTIONS/BASE_ACTION_BY_NAME (getPermissionCheck default null)

Browser (flag agentAssistant ON)
  ContextBar  ── mounts ──► NotificationBell (NEW)  ── src/lib/db/notifications.ts
     ├─ unread-count badge (count where read_at is null)   listUnreadCount()
     ├─ inbox popover (created_at desc)                    listNotifications()
     └─ select → markNotificationRead(id) + deep-link      markNotificationRead()  (metadata.entity→route | metadata.run_id→resume)
```

**Deputy invariant for background runs (the whole safety argument, NFR-AAN-SEC-001).** `service_role` is used at **exactly two** call sites — (a) the Auth admin API to mint (mint.ts), (b) `.from()` on the quarantined table set for selection/watermark (dispatcher.ts/watermark.ts). The **fired run** uses the **minted-owner-JWT client** — never `service_role` — so `agentChatHandler` runs the same RLS-ceilinged loop as an interactive run (FR-AAN-017). AC-AAN-018 (Task D6) asserts the `service_role` table set is exactly `{agent_automations, agent_dispatch_watermarks, procurement_status_events}`; AC-AAN-019 (Task A6 pgTAP + D4 unit) proves the minted A-JWT is denied user-B data identically to interactive.

**`notify`/`create_automation` reuse the single write-dispatch gate (OBS-AAN-002, NFR-AW-SEC-001).** Both are ordinary `AgentAction`s in the agent-chat catalog: `notify` (`confirm:false`) dispatches immediately via the read path; `create_automation` (`confirm:true`) surfaces an approve chip and writes via `dispatchActionForced` under the caller JWT. No parallel write path.

---

## 2. File tree (exact paths — NEW unless marked EDIT)

```
supabase/
  migrations/
    0048_agent_automations_notifications.sql        NEW   2 tenant tables + 1 infra table + RLS + pg_cron job
  tests/
    0096_agent_automations_schema.test.sql          NEW   AC-AAN-001..004 (columns, kind CHECKs)
    0097_agent_automations_tenancy.test.sql         NEW   AC-AAN-005..008 (owner iso, cross-org, insert-pin, disabled/archived selection)
    0098_notifications.test.sql                     NEW   AC-AAN-009..015 (schema+index, tenancy, mark-read-only)
    0099_agent_automations_minting_gate.test.sql    NEW   AC-AAN-019 (minted-JWT cross-tenant denial == interactive)  [OPUS-IMPL]
  functions/agent-dispatch/                         NEW edge fn — does NOT touch agent-chat
    index.ts                                        NEW   Deno.serve entry (integration-only, not unit-tested)
    dispatcher.ts                                   NEW   runDispatchTick + selectDueSchedules + selectTriggerMatches (pure)
    cron.ts                                         NEW   cronMatches(expr, date) — schedule matcher (pure)
    watermark.ts                                    NEW   readWatermark / advanceWatermark (pure, service-role client injected)
    condition.ts                                    NEW   evaluateCondition + TTL memo (pure, cheap-model injected)
    mint.ts                                         NEW   mintOwnerJwt + auditMint (pure, auth-admin injected)  [OPUS-IMPL]
    fire.ts                                         NEW   fireAutomation (pure, minted client + agentChatHandler injected)
  functions/agent-chat/
    actions.ts                                      EDIT  +notifyAction +createAutomationAction
    schema.ts                                       EDIT  +NOTIFY_SCHEMA +CREATE_AUTOMATION_SCHEMA
    handler.ts                                      EDIT  register both in BASE_ACTIONS/BASE_ACTION_BY_NAME
pmo-portal/
  src/
    lib/
      db/
        notifications.ts                            NEW   listNotifications / listUnreadCount / markNotificationRead
        notifications.test.ts                       NEW   query-shape + mark-read-only-column unit
      agent/
        actions.notify.test.ts                      NEW   AC-AAN-026/031  (imports agent-chat/actions)
        actions.create_automation.test.ts           NEW   AC-AAN-028/029/030
        dispatch/
          dispatcher.schedule.test.ts               NEW   AC-AAN-021       (imports agent-dispatch/dispatcher)
          dispatcher.watermark.test.ts              NEW   AC-AAN-022
          dispatcher.condition.test.ts              NEW   AC-AAN-023/024/025
          dispatcher.credits.test.ts                NEW   AC-AAN-027       [blocked on issue-3, REC-4]
          dispatcher.mint.test.ts                   NEW   AC-AAN-016/017/020  [OPUS-IMPL]
          dispatcher.deputy-invariant.test.ts       NEW   AC-AAN-018/019(unit half)  [OPUS-IMPL]
    components/
      shell/
        NotificationBell.tsx                        NEW   bell + badge + inbox popover
        ContextBar.tsx                              EDIT  mount NotificationBell (flag-gated); drop dead notificationCount prop
        __tests__/NotificationBell.test.tsx         NEW   AC-AAN-032..035
  e2e/
    AC-AAN-036-automation-notification.spec.ts      NEW   chat-create → simulated fire → notification; second user cannot see
docs/
  adr/
    0045-dispatch-watermark-infra-table.md          NEW   the one net-new arch decision (a non-tenant service-role infra table)
```

**One new ADR (`0046`).** Every *behavioral* decision (minting, quarantine, poll-since-watermark, NL-condition fail-quiet, channel seam, credits) is already recorded in ADR-0044. The one decision ADR-0044 leaves to the plan and that is genuinely cross-cutting is the **watermark storage shape** — specifically that it is a **non-tenant, `org_id`-less, service-role-only infra table** in a codebase whose standing invariant is "every business table has RLS + `org_id`." That deserves an ADR so a future auditor grep-ing for a missing `org_id` finds the deliberate rationale, not a bug. (Confirm the next ADR number at build — `0044` is the latest; this plan assumes `0046`. If ADR-0046 was taken by the credits/widgets work meanwhile, take next-free.)

---

## 3. Traceability (AC → owning test, ADR-0010 lowest-sufficient layer)

| AC | Layer | Owning test (title / file) |
|---|---|---|
| AC-AAN-001 | pgTAP | `AC-AAN-001 agent_automations table exists with required columns` · `supabase/tests/0096_agent_automations_schema.test.sql` |
| AC-AAN-002 | pgTAP | `AC-AAN-002 kind=schedule requires non-null schedule` · `0096_agent_automations_schema.test.sql` |
| AC-AAN-003 | pgTAP | `AC-AAN-003 kind=trigger requires non-null trigger_on` · `0096_agent_automations_schema.test.sql` |
| AC-AAN-004 | pgTAP | `AC-AAN-004 valid schedule and trigger rows insert cleanly` · `0096_agent_automations_schema.test.sql` |
| AC-AAN-005 | pgTAP | `AC-AAN-005 non-owner same-org reads zero` · `supabase/tests/0097_agent_automations_tenancy.test.sql` |
| AC-AAN-006 | pgTAP | `AC-AAN-006 cross-org read zero incl admin` · `0097_agent_automations_tenancy.test.sql` |
| AC-AAN-007 | pgTAP | `AC-AAN-007 insert pins org and owner, spoofed owner denied` · `0097_agent_automations_tenancy.test.sql` |
| AC-AAN-008 | pgTAP | `AC-AAN-008 disabled/archived excluded from dispatcher selection` · `0097_agent_automations_tenancy.test.sql` |
| AC-AAN-009 | pgTAP | `AC-AAN-009 notifications table + unread index exist` · `supabase/tests/0098_notifications.test.sql` |
| AC-AAN-010 | pgTAP | `AC-AAN-010 non-owner same-org reads zero` · `0098_notifications.test.sql` |
| AC-AAN-011 | pgTAP | `AC-AAN-011 cross-org read zero incl admin` · `0098_notifications.test.sql` |
| AC-AAN-012 | pgTAP | `AC-AAN-012 insert pins owner_id, spoofed recipient denied` · `0098_notifications.test.sql` |
| AC-AAN-013 | pgTAP | `AC-AAN-013 mark-read update succeeds owner, only touches read_at` · `0098_notifications.test.sql` |
| AC-AAN-014 | pgTAP | `AC-AAN-014 mark-read update denied non-owner` · `0098_notifications.test.sql` |
| AC-AAN-015 | pgTAP | `AC-AAN-015 direct content update rejected` · `0098_notifications.test.sql` |
| AC-AAN-016 | Unit | `AC-AAN-016 mint scoped to exactly dispatched row owner_id` · `pmo-portal/src/lib/agent/dispatch/dispatcher.mint.test.ts` |
| AC-AAN-017 | Unit | `AC-AAN-017 every mint audited before use` · `dispatcher.mint.test.ts` |
| AC-AAN-018 | Unit | `AC-AAN-018 service_role never queries business data` · `pmo-portal/src/lib/agent/dispatch/dispatcher.deputy-invariant.test.ts` |
| AC-AAN-019 | pgTAP + Unit | `AC-AAN-019 minted-JWT cross-tenant denial identical to interactive` · `supabase/tests/0099_agent_automations_minting_gate.test.sql` + `dispatcher.deputy-invariant.test.ts` |
| AC-AAN-020 | Unit | `AC-AAN-020 minted JWT never persisted` · `dispatcher.mint.test.ts` |
| AC-AAN-021 | Unit | `AC-AAN-021 cron selection fires due schedules only` · `pmo-portal/src/lib/agent/dispatch/dispatcher.schedule.test.ts` |
| AC-AAN-022 | Unit | `AC-AAN-022 watermark advances, no double-fire` · `pmo-portal/src/lib/agent/dispatch/dispatcher.watermark.test.ts` |
| AC-AAN-023 | Unit | `AC-AAN-023 condition false no-fire no notification` · `pmo-portal/src/lib/agent/dispatch/dispatcher.condition.test.ts` |
| AC-AAN-024 | Unit | `AC-AAN-024 condition ambiguous no-fire plus warning notification` · `dispatcher.condition.test.ts` |
| AC-AAN-025 | Unit | `AC-AAN-025 condition evaluation memoized within TTL` · `dispatcher.condition.test.ts` |
| AC-AAN-026 | Unit | `AC-AAN-026 long-run completion produces notification` · `pmo-portal/src/lib/agent/actions.notify.test.ts` |
| AC-AAN-027 | Unit | `AC-AAN-027 over-credit no-start plus warning notification` · `pmo-portal/src/lib/agent/dispatch/dispatcher.credits.test.ts` |
| AC-AAN-028 | Unit | `AC-AAN-028 create_automation requires approval` · `pmo-portal/src/lib/agent/actions.create_automation.test.ts` |
| AC-AAN-029 | Unit | `AC-AAN-029 approved create_automation writes under caller JWT` · `actions.create_automation.test.ts` |
| AC-AAN-030 | Unit | `AC-AAN-030 validate mirrors kind-conditional constraint` · `actions.create_automation.test.ts` |
| AC-AAN-031 | Unit | `AC-AAN-031 notify confirm:false dispatches immediately` · `pmo-portal/src/lib/agent/actions.notify.test.ts` |
| AC-AAN-032 | Unit | `AC-AAN-032 bell badge reflects unread count` · `pmo-portal/src/components/shell/__tests__/NotificationBell.test.tsx` |
| AC-AAN-033 | Unit | `AC-AAN-033 inbox lists most recent first` · `NotificationBell.test.tsx` |
| AC-AAN-034 | Unit | `AC-AAN-034 select marks read, badge decrements` · `NotificationBell.test.tsx` |
| AC-AAN-035 | Unit | `AC-AAN-035 select with metadata.entity navigates` · `NotificationBell.test.tsx` |
| AC-AAN-036 | E2E | `AC-AAN-036 create automation simulated fire notification second user cannot see` · `pmo-portal/e2e/AC-AAN-036-automation-notification.spec.ts` |

---

## PHASE A — Migration + pgTAP + ADR  ★ WORKTREE-PARALLELIZABLE (no dependency on agent-chat/dispatch code)

> This phase is a self-contained new-file block (migration + 4 pgTAP files + 1 ADR). It can build in an isolated worktree in parallel with Phase B (dispatcher scaffold), since neither touches shipped source. TDD for SQL: write the pgTAP (RED, table absent), then the migration (GREEN). All `supabase` commands from repo root; `supabase db reset` between edits.

### Task A1 — ADR-0046 for the watermark infra table
**File:** `docs/adr/0045-dispatch-watermark-infra-table.md` (NEW)
Record: **Context** — the dispatcher needs a monotonic per-source cursor (FR-AAN-013) over the append-only `procurement_status_events` log; the codebase invariant is "every business table has RLS + `org_id`." **Decision** — `agent_dispatch_watermarks(source text pk, last_seen_id uuid, last_seen_at timestamptz, updated_at timestamptz)`, `enable`+`force` RLS with **no policy** (default-deny to every JWT role), **no `org_id`/`owner_id`** — it is dispatcher infra, not tenant data, read/written only by the `service_role` client (which bypasses RLS). **Consequences** — (+) minimal, indexed, extensible per source; a future second source adds a row, not a schema change. (−) a table with no `org_id` in an `org_id`-seam codebase — mitigated by this ADR + the migration header comment so a future auditor sees intent, not a bug; and by the AC-AAN-018 table-set assertion proving only `service_role` ever touches it.

**Verify:** `test -f docs/adr/0045-dispatch-watermark-infra-table.md`. (Confirm `0046` is free at build — `ls docs/adr/ | tail`; take next if taken.)

### Task A2 — Write the schema pgTAP (RED) — AC-AAN-001..004
**File:** `supabase/tests/0096_agent_automations_schema.test.sql` (NEW)
Copy the `begin; select plan(N); … select * from finish(); rollback;` frame from `supabase/tests/0089_user_views_tenancy.test.sql`. Assert:
- `has_table('agent_automations')`; columns per ADR-0044 §1: `has_column` for `id/org_id/owner_id/kind/prompt/schedule/trigger_on/condition/enabled/timeout_s/last_fired_at/created_at/updated_at/archived_at`.
- `col_type_is('agent_automations','trigger_on','jsonb')`, `col_type_is('agent_automations','enabled','boolean')`, `col_type_is('agent_automations','timeout_s','integer')`.
- **AC-AAN-002:** `throws_ok($$ insert into agent_automations (kind, prompt, schedule) values ('schedule','p', null) $$, '23514')` (CHECK violation — as table owner, bypassing RLS, to isolate the CHECK).
- **AC-AAN-003:** `throws_ok($$ insert into agent_automations (kind, prompt, trigger_on) values ('trigger','p', null) $$, '23514')`.
- **AC-AAN-004:** `lives_ok` for a valid `kind='schedule'` row (`schedule='* * * * *'`) and a valid `kind='trigger'` row (`trigger_on='{"source":"procurement_status_events","event":"Ordered"}'::jsonb`).

**Verify (fails):** `supabase db reset && supabase test db 2>&1 | grep 0096` → "relation agent_automations does not exist".

### Task A3 — Write the automations tenancy pgTAP (RED) — AC-AAN-005..008
**File:** `supabase/tests/0097_agent_automations_tenancy.test.sql` (NEW)
Model on `0089_user_views_tenancy.test.sql` (fixtures inserted as table owner, then `set local role authenticated` + `set local request.jwt.claims`). Namespace `00970000-…`. Org A = default `00000000-…-0001`; Org B = `00970000-…-0002`. Users: Ann (org A, Engineer, owner), Bob (org A, Engineer, non-owner), Dana (**org A, Admin**, non-owner), Erin (**org B, Admin**). Ann owns one `kind='schedule'` automation.
- **AC-AAN-005:** as Bob → `count(*) from agent_automations` where Ann's row = 0.
- **AC-AAN-006:** as Dana (org-A Admin) → 0; as Erin (org-B Admin) → 0 (cross-org wall, no Admin read grant — mirrors ADR-0043's no-Admin divergence).
- **AC-AAN-007:** as Bob → `throws_ok` inserting `agent_automations(owner_id => Ann's id, kind,'schedule', prompt, schedule)` (`WITH CHECK` denial `42501`); also assert Bob inserting his own owner but Ann's `org_id` is denied.
- **AC-AAN-008:** insert three of Ann's automations — one `enabled=false`, one `archived_at=now()`, one live+enabled with `schedule='* * * * *'`; assert the dispatcher's due-selection predicate (`enabled = true and archived_at is null and kind='schedule'`, run as a raw SQL query as Ann) returns only the live one. Title `AC-AAN-008 disabled/archived excluded from dispatcher selection`.

**Verify (fails):** `supabase test db 2>&1 | grep 0097`.

### Task A4 — Write the notifications pgTAP (RED) — AC-AAN-009..015
**File:** `supabase/tests/0098_notifications.test.sql` (NEW)
Namespace `00980000-…`, same 4-user shape. Assert:
- **AC-AAN-009:** `has_table('notifications')`; columns per ADR-0044 §5 (`id/org_id/owner_id/severity/title/body/metadata/read_at/created_at`); `col_type_is('notifications','severity','text')`; `has_index('notifications','notifications_owner_unread_idx')` (the partial `where read_at is null` index — assert existence via `has_index`, and separately query `pg_indexes` to assert the `WHERE (read_at IS NULL)` predicate is present).
- **AC-AAN-010:** notification addressed to Ann; as Bob → `count(*)` = 0.
- **AC-AAN-011:** as Dana (org-A Admin) → 0; as Erin (org-B Admin) → 0.
- **AC-AAN-012:** as Ann → `throws_ok` inserting `notifications(owner_id => Bob's id, title)` (`WITH CHECK` `42501`).
- **AC-AAN-013:** Ann's own notification, `read_at is null`; as Ann `update notifications set read_at = now() where id = <ann's>` → `lives_ok`; then `is()` that `title`/`body`/`severity`/`metadata` are unchanged.
- **AC-AAN-014:** as Bob → `update notifications set read_at = now()` on Ann's row → 0 rows affected (`is((select count(*) from ...), 0)` post-update, or `results_eq` on affected count).
- **AC-AAN-015:** as Ann → `throws_ok($$ update notifications set title = 'x' where id = <ann's> $$, '42501')` (content immutable even for owner — the mark-read-only trigger). Repeat for `body`/`severity`/`metadata` (one `throws_ok` each).

**Verify (fails):** `supabase test db 2>&1 | grep 0098`.

### Task A5 — Write the migration (GREEN) — FR-AAN-001..009
**File:** `supabase/migrations/0048_agent_automations_notifications.sql` (NEW)
Copy header/reversibility-comment style from `0046_agent_persistence.sql`; include the full manual-rollback DROP block (reverse order: trigger, function, cron unschedule, policies, indexes, tables). Reuse `auth_org_id()`/`auth_role()` from `0002_rls.sql` (do **not** redefine). Header MUST note REC-5 (service_role bypasses RLS; the watermark table is intentionally `org_id`-less infra per ADR-0046).

```sql
create table agent_automations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id      uuid not null references profiles(id) default auth.uid(),
  kind          text not null check (kind in ('schedule','trigger')),
  prompt        text not null,
  schedule      text,
  trigger_on    jsonb,
  condition     text,
  enabled       boolean not null default true,
  timeout_s     integer not null default 120,
  last_fired_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,
  -- kind-conditional required fields (FR-AAN-002):
  constraint agent_automations_schedule_req
    check (kind <> 'schedule' or (schedule is not null and length(trim(schedule)) > 0)),
  constraint agent_automations_trigger_req
    check (kind <> 'trigger' or (trigger_on is not null and trigger_on ? 'source' and trigger_on ? 'event'))
);
create index agent_automations_due_idx
  on agent_automations (kind) where enabled and archived_at is null;

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id    uuid not null references profiles(id) default auth.uid(),
  severity    text not null default 'info' check (severity in ('info','warning','critical')),
  title       text not null,
  body        text,
  metadata    jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_owner_unread_idx on notifications (owner_id) where read_at is null;

create table agent_dispatch_watermarks (
  source        text primary key,
  last_seen_id  uuid,
  last_seen_at  timestamptz,
  updated_at    timestamptz not null default now()
);
```
Then `enable`+`force` RLS on all three. **`agent_automations`** — owner-only `select`/`insert`/`update`/`delete` (`owner_id = auth.uid() and org_id = auth_org_id()`; INSERT `with check` the same). **`notifications`** — owner-only `select`/`insert`/`delete`; `update` (feedback-shape mark-read-only, mirroring `agent_events_update` in 0046): `for update using (owner_id = auth.uid() and org_id = auth_org_id()) with check (owner_id = auth.uid() and org_id = auth_org_id())` PLUS a **`before update` trigger `notifications_mark_read_only()`** that `raise exception … using errcode='42501'` unless every column except `read_at` is `not distinct from` its OLD value (pin `title/body/severity/metadata/owner_id/org_id/created_at`). This trigger is the AC-AAN-015 authority (the USING/WITH CHECK alone permits touching any column). **`agent_dispatch_watermarks`** — `enable`+`force` RLS, **no policy** (default-deny; only `service_role` reaches it).

**pg_cron job (FR-AAN-010):** at the end of the migration, register one per-minute job. Use `pg_cron` + `pg_net` (both Supabase extensions):
```sql
-- pg_cron per-minute dispatcher tick (FR-AAN-010). Guarded: create extension if absent (Supabase local + cloud both ship pg_cron/pg_net).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'agent-dispatch-tick', '* * * * *',
  $$ select net.http_post(
       url := current_setting('app.settings.dispatch_url', true),
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true))
     ); $$
);
```
**CI/local-dev caveat (mirror the AC-AGP-023 precedent):** `net.http_post` needs a reachable edge-fn URL + service-role key from GUCs (`app.settings.dispatch_url` / `app.settings.service_role_key`) that are NOT set in CI (edge runtime does not run in CI). The `cron.schedule` call itself is **idempotent DDL and MUST succeed** in `supabase db reset` (the pgTAP env) — it only *registers* the job; the job's *body* (`net.http_post`) fires against unset GUCs which `net.http_post` tolerates (queues a request that never resolves) — a **no-op in the test DB**. Task A6 asserts the job is *registered* (`cron.job` row exists) — the actual fire is **live-verified only** (Phase G, deployed env), never in CI. State this split explicitly in the migration header.

**Verify (green):** `supabase db reset && supabase test db 2>&1 | grep -E '0096|0097|0098'` → all pass. Then `supabase test db` full green (no regression).

### Task A6 — Minting cross-tenant gate pgTAP (RED→GREEN) — AC-AAN-019 (pgTAP half)  [OPUS-IMPL]
**File:** `supabase/tests/0099_agent_automations_minting_gate.test.sql` (NEW)
This proves the **minted-JWT session is denied cross-tenant data identically to interactive**, at the DB layer — the load-bearing ADR-0044 Verification test. A minted JWT, from Postgres's perspective, is just a `request.jwt.claims` with the owner's `sub`/`org_id`/`role` — so the test simulates it exactly as the interactive tenancy tests do (`set local request.jwt.claims`), because that IS what the minted client sends. Namespace `00990000-…`. Ann (org A) owns an automation + owns a `projects` row (business data). Bob (org A) owns a *different* `projects` row.
- Set the session to **Ann's claims** (the "minted A-JWT" simulation) and assert: Ann can read her own project (`count = 1`), and **cannot** read Bob's project (`count = 0`) — byte-for-byte the interactive result.
- Also assert (schema-level twin of the code gate): query `pg_policies` for the three new tables' `SELECT` policies and assert every `qual` references `owner_id = auth.uid()` and none references `auth_role` (no Admin cross-owner read).
Title `AC-AAN-019 minted-JWT cross-tenant denial identical to interactive`.

**Verify:** `supabase test db 2>&1 | grep 0099` → pass.

---

## PHASE B — Dispatcher scaffold: cron + watermark + selection (pure, unit-tested)  ★ WORKTREE-PARALLELIZABLE

> New-file edge-fn logic under `supabase/functions/agent-dispatch/`, tests under `pmo-portal/src/lib/agent/dispatch/` (REC-1). No shipped source touched → parallel-safe with Phase A. Test pattern copies `agentChatHandler.test.ts` (inject mocked deps; `vi.fn()` supabase). All Vitest commands from `pmo-portal/`.

### Task B1 — `cronMatches` failing test (RED) — supports AC-AAN-021
**File:** `pmo-portal/src/lib/agent/dispatch/dispatcher.schedule.test.ts` (NEW)
Import `{ cronMatches }` from `'../../../../../supabase/functions/agent-dispatch/cron'`. Assert:
- `cronMatches('* * * * *', new Date('2026-07-06T08:00:00Z'))` === `true`.
- `cronMatches('0 8 * * 1', new Date('2026-07-06T08:00:00Z'))` === `true` (Monday 8:00 UTC; 2026-07-06 is a Monday).
- `cronMatches('0 8 * * 1', new Date('2026-07-06T09:00:00Z'))` === `false` (wrong minute/hour).
- `cronMatches('0 8 * * 2', new Date('2026-07-06T08:00:00Z'))` === `false` (wrong DOW).

**Verify (fails):** `npx vitest run src/lib/agent/dispatch/dispatcher.schedule.test.ts -t cronMatches` → module-not-found.

### Task B2 — `cron.ts` (GREEN) — FR-AAN-011
**File:** `supabase/functions/agent-dispatch/cron.ts` (NEW)
Pure `cronMatches(expr: string, at: Date): boolean` — parse the standard 5-field cron (`min hour dom month dow`), support `*`, single values, comma lists, `*/n` steps, and `a-b` ranges (enough for the schedules `create_automation` produces). Compare against `at`'s UTC minute/hour/day-of-month/month/day-of-week. No external lib (a ~40-line matcher — cron parsing is a mechanical choice per spec Open Q; native, no dependency). Document that all matching is UTC (the schedule string is stored/matched in UTC; TZ-aware schedules are out of scope v1).

**Verify (green):** `npx vitest run src/lib/agent/dispatch/dispatcher.schedule.test.ts -t cronMatches` → pass.

### Task B3 — Schedule-selection failing test (RED) then wire (GREEN) — AC-AAN-021
**File:** `pmo-portal/src/lib/agent/dispatch/dispatcher.schedule.test.ts` (EDIT)
Add `it('AC-AAN-021 cron selection fires due schedules only')`. Build a mocked `serviceClient` whose `.from('agent_automations').select(...)` resolves three `kind='schedule'` rows with schedules `['* * * * *', '0 9 * * *', '0 10 * * *']` at `now = 08:00Z`. Import `selectDueSchedules(serviceClient, now)` from `'../../../../../supabase/functions/agent-dispatch/dispatcher'`. Assert it returns exactly the `'* * * * *'` row (the only one matching 08:00). Assert the `.from()` call was `'agent_automations'` and the query filtered `enabled`+`archived_at is null`+`kind='schedule'` (spy on the builder chain).

**File (GREEN):** `supabase/functions/agent-dispatch/dispatcher.ts` (NEW)
Export `selectDueSchedules(sb, now)`: `sb.from('agent_automations').select('*').eq('kind','schedule').eq('enabled', true).is('archived_at', null)` → filter the returned rows in-JS by `cronMatches(row.schedule, now)`. (Cron matching is done in-JS, not SQL, because `pg_cron` syntax parsing in a SQL predicate is not portable; the DB predicate narrows to enabled/live/schedule-kind, the JS matcher does the minute match.)

**Verify:** `npx vitest run src/lib/agent/dispatch/dispatcher.schedule.test.ts` → both pass.

### Task B4 — Watermark failing test (RED) — AC-AAN-022
**File:** `pmo-portal/src/lib/agent/dispatch/dispatcher.watermark.test.ts` (NEW)
Import `{ readWatermark, advanceWatermark }` from `'…/agent-dispatch/watermark'` and `{ selectTriggerMatches }` from `'…/agent-dispatch/dispatcher'`. Two-tick scenario:
- Tick 1: `readWatermark(sb,'procurement_status_events')` returns null (no row) → `selectTriggerMatches` reads status-events with `created_at > epoch` → one matching `Ordered` event `E1` (created `T1`) → returns one match; `advanceWatermark(sb,'procurement_status_events',{id:E1,at:T1})` upserts.
- Tick 2: `readWatermark` now returns `{last_seen_at: T1}` → `selectTriggerMatches` reads status-events `created_at > T1` → **zero** new events → returns `[]` (no double-fire).
Assert tick-2 returns empty (`AC-AAN-022`). Assert `advanceWatermark` issues an upsert on `agent_dispatch_watermarks` keyed on `source`.

**Verify (fails):** `npx vitest run src/lib/agent/dispatch/dispatcher.watermark.test.ts` → module-not-found.

### Task B5 — `watermark.ts` + `selectTriggerMatches` (GREEN) — FR-AAN-012/013, AC-AAN-022
**Files:** `supabase/functions/agent-dispatch/watermark.ts` (NEW), `dispatcher.ts` (EDIT).
`watermark.ts`: `readWatermark(sb, source): Promise<{lastSeenId, lastSeenAt} | null>` → `sb.from('agent_dispatch_watermarks').select('*').eq('source', source).maybeSingle()`; `advanceWatermark(sb, source, seen)` → `sb.from('agent_dispatch_watermarks').upsert({source, last_seen_id: seen.id, last_seen_at: seen.at, updated_at: new Date().toISOString()})`. Both take the injected `service_role` client. `selectTriggerMatches(sb, now, enabledTriggerAutomations)` in `dispatcher.ts`: for each distinct `trigger_on.source`, `readWatermark`, then `sb.from(source).select('*').gt('created_at', wm?.lastSeenAt ?? '1970-01-01').order('created_at')`; match each event's status against each automation's `trigger_on.event` (compare to `to_status` for `procurement_status_events`); return `{automation, event}` pairs + the max-seen `{id, at}` to advance **after** the batch (FR-AAN-013 monotonic-after-success). The advance is the caller's (runDispatchTick) responsibility post-fire, so a failed tick does not skip events.

**Verify (green):** `npx vitest run src/lib/agent/dispatch/dispatcher.watermark.test.ts` → pass.

---

## PHASE C — NL condition evaluation (pure, memoized, cheap-model)  ★ WORKTREE-PARALLELIZABLE

### Task C1 — Condition-eval failing tests (RED) — AC-AAN-023/024/025
**File:** `pmo-portal/src/lib/agent/dispatch/dispatcher.condition.test.ts` (NEW)
Import `{ evaluateCondition, makeConditionMemo }` from `'…/agent-dispatch/condition'`. Inject a mocked cheap `ModelClient` (`create: vi.fn()`). Cases:
- **AC-AAN-023:** model returns a clear `false` verdict → `evaluateCondition` resolves `{ fire: false }`; assert no notification-producing side-effect requested.
- **AC-AAN-024:** model `create` **throws** (or returns unparseable text like `"maybe?"`) → resolves `{ fire: false, warning: 'couldn't evaluate the condition for automation <id>' }` (fail-quiet-but-visible; the dispatcher turns `warning` into a `severity='warning'` notification in Task D5).
- **AC-AAN-025:** a memo built by `makeConditionMemo()` — call `evaluateCondition` N=3 times for the same `(automationId, condition)` key within TTL → `modelClient.create` is called **once** (subsequent calls reuse the memoized verdict).

**Verify (fails):** `npx vitest run src/lib/agent/dispatch/dispatcher.condition.test.ts` → module-not-found.

### Task C2 — `condition.ts` (GREEN) — FR-AAN-021..024, NFR-AAN-PERF-003
**File:** `supabase/functions/agent-dispatch/condition.ts` (NEW)
Export `CONDITION_MEMO_TTL_MS = 60_000`; `makeConditionMemo(): Map<string, {verdict; at:number}>`; `evaluateCondition(deps: { model: ModelClient; modelId: string; now: () => number; memo: Map }, automation, event): Promise<{ fire: boolean; warning?: string }>`. Build the memo key `\`${automation.id}::${automation.condition}\``; return the cached verdict if `now - at < CONDITION_MEMO_TTL_MS`. Otherwise call `model.create()` with a strict prompt: the condition text as **untrusted content** (ADR-0039 boundary — the condition is user-authored, the event context is data; the model returns a verdict, never executable instruction) asking for a single-token `true`/`false`. Parse: exactly `true` → `{fire:true}`; exactly `false` → `{fire:false}`; anything else or a thrown error → `{fire:false, warning: …}`. Never log the condition/prompt text (NFR-AAN-SEC-007) — on error log the automation id + error code only. Memoize the verdict (including a warning-verdict, so a broken condition isn't re-billed each event in the burst).

**Verify (green):** `npx vitest run src/lib/agent/dispatch/dispatcher.condition.test.ts` → pass.

---

## PHASE D — The minting slice + fire + tick orchestration (the security-sensitive core)  [OPUS-IMPL for D3/D4/D6]

> Depends on B (dispatcher/watermark) + C (condition). The mint tasks are **the** security-sensitive slice — opus implementer, and **the cross-tenant/scoping gate test lands in the SAME task as the mint code**. Do not split mint code from its gate.

### Task D1 — `fireAutomation` failing test (RED) — supports FR-AAN-017/020
**File:** `pmo-portal/src/lib/agent/dispatch/dispatcher.mint.test.ts` (NEW — the mint slice's test file)
Import `{ fireAutomation }` from `'…/agent-dispatch/fire'`. Inject a mocked `agentChatHandler` (`vi.fn()` async generator) + a `mintedClient` marker object. Assert `fireAutomation({ handler, mintedClient, ownerId, orgId, automation, signal })` calls `handler` with `deps.supabase === mintedClient` (identity), `deps.userId === automation.owner_id`, and the automation's `prompt` as the user message — i.e. the fired run uses the **minted client**, indistinguishable from interactive (FR-AAN-017/020).

**Verify (fails):** `npx vitest run src/lib/agent/dispatch/dispatcher.mint.test.ts -t fireAutomation` → module-not-found.

### Task D2 — `fire.ts` (GREEN) — FR-AAN-017/020
**File:** `supabase/functions/agent-dispatch/fire.ts` (NEW)
`fireAutomation(deps)` builds `HandlerDeps` with `supabase: deps.mintedClient`, `userId: deps.ownerId`, the same `modelClient`/model as interactive, and drains `agentChatHandler(req, deps)` server-side to a terminal status (the run persists via issue-2's `persistence` path — a fired run is an ordinary run, OBS-AAN-003). Pass `deps.signal` (the `timeout_s` AbortSignal, §0). Returns the terminal run id.

**Verify (green):** `npx vitest run src/lib/agent/dispatch/dispatcher.mint.test.ts -t fireAutomation` → pass.

### Task D3 — Mint-scoping + audit + no-persist gate (RED→GREEN, SAME TASK) — AC-AAN-016/017/020  [OPUS-IMPL]
**Files (test + code TOGETHER):** `pmo-portal/src/lib/agent/dispatch/dispatcher.mint.test.ts` (EDIT) + `supabase/functions/agent-dispatch/mint.ts` (NEW).
**Write the tests first (RED), then `mint.ts` (GREEN), in one task — the mint code never lands without its scoping/audit gate.**
Import `{ mintOwnerJwt, auditMint }` from `'…/agent-dispatch/mint'`. Inject a mocked `authAdmin` (`{ createSession: vi.fn() }` or the Supabase admin shape actually used — confirm the admin-API method at build; the plan assumes an admin `generateLink`/`createSession`-style call returning a JWT) + a mocked minted `supabase` client.
- **AC-AAN-016:** `mintOwnerJwt(authAdmin, automation)` calls the auth-admin API with **exactly** `automation.owner_id` — assert the mock was called with that uid and **no other id is present in the call args** (no request-supplied/model-supplied id). Also test the negative: passing an automation whose `owner_id` differs from any other field mints only for `owner_id`.
- **AC-AAN-017:** `auditMint(mintedClient, automation, mintedAt)` inserts an `agent_events` `type='system'` row carrying `{automation_id, owner_id, minted_at}` — and assert (ordering) that in the orchestration, `auditMint` is invoked **before** the minted client is used for anything else (spy call-order: audit insert precedes `fireAutomation`).
- **AC-AAN-020:** assert the returned mint object's JWT is **never** written to any table — inspect the `auditMint` insert payload and assert it contains no `jwt`/`access_token`/`refresh_token` field; assert `mint.ts` source (via `fs.readFileSync`) contains no persistence of the token (no `.insert(` referencing the token variable).
`mint.ts`: `mintOwnerJwt(authAdmin, automation)` → call the admin API for `automation.owner_id` only, return `{ client, expiresInS: automation.timeout_s }` (bound lifetime, FR-AAN-018); `auditMint(mintedClient, automation, mintedAt)` → `mintedClient.from('agent_events').insert({ type:'system', payload:{ kind:'automation_mint', automation_id, owner_id, minted_at } })` (audited under the owner's own client → owner RLS; the audit row is the owner's, FR-AAN-019). Never log/persist the token (NFR-AAN-SEC-008).

**Verify:** `npx vitest run src/lib/agent/dispatch/dispatcher.mint.test.ts` → AC-AAN-016/017/020 pass.

### Task D4 — Deputy-invariant + service_role-quarantine gate (RED→GREEN, SAME TASK) — AC-AAN-018 + AC-AAN-019 (unit half)  [OPUS-IMPL]
**Files (test + code TOGETHER):** `pmo-portal/src/lib/agent/dispatch/dispatcher.deputy-invariant.test.ts` (NEW) + `supabase/functions/agent-dispatch/dispatcher.ts` (EDIT — `runDispatchTick`).
- **AC-AAN-018 (service_role quarantine):** build a `serviceClient` mock recording every `.from(table)` call; run `runDispatchTick({ serviceClient, authAdmin, … })` through one full selection→(mint)→fire cycle; assert the set of tables touched **under `serviceClient`** is exactly `{'agent_automations', 'agent_dispatch_watermarks', 'procurement_status_events'}` — and that the **fired run's** `.from()` calls all went through the **minted** client (a different mock instance), never `serviceClient` (identity check). Titled `AC-AAN-018 service_role never queries business data`.
- **AC-AAN-019 (unit half):** static — read `supabase/functions/agent-dispatch/fire.ts` + `mint.ts` source and assert neither constructs a `service_role`/`SERVICE_ROLE` client for the fired run (the fired run only ever receives the minted client). Dynamic — assert the run dispatched for an automation owned by A is handed a client marked with A's identity, never B's. Titled `AC-AAN-019 minted-JWT cross-tenant denial identical to interactive` (the pgTAP half is Task A6).
`dispatcher.ts` `runDispatchTick`: orchestrate selection (B) → per due automation: condition (C) if trigger+condition → credits preflight (F, stubbed until issue-3) → mint (D3) → audit (D3) → fire (D2) → stamp `last_fired_at` (`serviceClient.from('agent_automations').update({last_fired_at}).eq('id',...)` — this is `agent_automations` metadata, within quarantine, FR-AAN-015) → advance watermark (B) after the batch.

**Verify:** `npx vitest run src/lib/agent/dispatch/dispatcher.deputy-invariant.test.ts` → pass. Also run the whole dispatch suite: `npx vitest run src/lib/agent/dispatch/` → all green.

### Task D5 — Wire condition-warning + `last_fired_at` into the tick (GREEN) — FR-AAN-015/024
**File:** `supabase/functions/agent-dispatch/dispatcher.ts` (EDIT)
In `runDispatchTick`, when `evaluateCondition` returns `{ fire:false, warning }`, insert a `severity='warning'` notification for the owner (via the **minted owner client** so RLS pins `owner_id` — mint even on the no-fire-but-warn path, or write via a lightweight owner-client mint scoped only to the notify; simplest: mint once per due automation before the condition branch so both the warning-notify and the fire share one minted client). Stamp `last_fired_at` only on an actual fire (FR-AAN-015). Confirm the AC-AAN-024 test (Task C1) now sees the warning routed to a notification insert (extend C1's assertion here if the notify insert is asserted at the tick layer rather than in `condition.ts`).

**Verify:** `npx vitest run src/lib/agent/dispatch/dispatcher.condition.test.ts src/lib/agent/dispatch/dispatcher.deputy-invariant.test.ts` → green.

### Task D6 — Dispatcher Deno entry (`index.ts`) — integration-only — FR-AAN-010
**File:** `supabase/functions/agent-dispatch/index.ts` (NEW)
`Deno.serve` entry invoked by the `pg_cron` `net.http_post`. Verify the incoming `Authorization` bearer == the service-role key (reject otherwise — this endpoint mints, it must not be publicly callable). Build the `serviceClient` (service-role key) + the `authAdmin` (`createClient(url, serviceRoleKey, { auth: { admin } })` or `supabase.auth.admin`), the cheap `ModelClient` (per-action model map, batteries-A item 1 seam), and the credit-backed `RateGuard` (issue-3, REC-4). Call `runDispatchTick(...)`. Gate the whole tick behind the `agentAssistant`-equivalent Deno env flag (mirror issue-2's `AGENT_PERSISTENCE`; with automations off, selecting 0 enabled automations is already a no-op — FR-AAN-038, so the flag mainly disables the mint/model path). **This file is integration-only** (not unit-tested — REC-1 keeps logic in the pure modules; `index.ts` is thin wiring) — verified by the deploy-time BUILD-VERIFY checklist + the e2e simulated fire (Task G1). State this in its header.

**Verify:** `cd pmo-portal && npm run typecheck` (shared `port.ts`/`ModelClient` types compile against the new fn) → zero errors. Deno lint is a deploy-time gate.

---

## PHASE E — agent-chat catalog touch + notifications DAL + bell/inbox UI  (serialize AFTER Phases A–D; touches shipped agent-chat + shell)

> These edit **shipped** files (`actions.ts`/`schema.ts`/`handler.ts`/`ContextBar.tsx`) → serialize with issues 3–5 (do not parallelize; a shared-file edit here can collide). TDD per task. Vitest from `pmo-portal/`.

### Task E1 — `notify` action failing tests (RED) — AC-AAN-026/031
**File:** `pmo-portal/src/lib/agent/actions.notify.test.ts` (NEW)
Import `{ notifyAction }` from `'../../../../supabase/functions/agent-chat/actions'`. Assert:
- **AC-AAN-031:** `notifyAction.confirm === false`; calling `notifyAction.run({title, body, severity}, ctx)` inserts one `notifications` row via `ctx.supabase` **immediately** (no approval round-trip), sending only `title/body/severity/metadata` — never an explicit `owner_id` (RLS default pins the caller's own uid, so it addresses the calling identity, FR-AAN-027).
- **AC-AAN-026:** a `notify` call carrying `metadata: { run_id }` (the long-run-completion producer) inserts a row whose `metadata.run_id` equals the run — assert the insert payload's metadata.

**Verify (fails):** `npx vitest run src/lib/agent/actions.notify.test.ts` → `notifyAction` undefined.

### Task E2 — `notifyAction` (GREEN) — FR-AAN-026/027/028
**Files:** `supabase/functions/agent-chat/schema.ts` (EDIT) + `actions.ts` (EDIT).
`schema.ts`: `NOTIFY_SCHEMA` (JSON Schema, mirrors `CREATE_ACTIVITY_SCHEMA` style) — `{ title: string(required, ≤200), body?: string(≤2000), severity?: 'info'|'warning'|'critical', metadata?: object }`. `actions.ts`: `notifyAction: AgentAction` with `name:'notify'`, `confirm:false`, `surfaces:['agent']`, `run(input, ctx)` — validate title present; `const sb = ctx.supabase as unknown as SupabaseLikeWithWrites; await sb.from('notifications').insert({ title, body: body ?? null, severity: severity ?? 'info', metadata: metadata ?? null })` (never send `owner_id`/`org_id` — column defaults + RLS pin them, FR-AAN-027). Return `{ ok: true }` or `{ error: 'notify db error', code }`.

**Verify (green):** `npx vitest run src/lib/agent/actions.notify.test.ts` → pass.

### Task E3 — `create_automation` action failing tests (RED) — AC-AAN-028/029/030
**File:** `pmo-portal/src/lib/agent/actions.create_automation.test.ts` (NEW)
Import `{ createAutomationAction }` + the handler's approve-chip path (copy the `create_activity` approval-flow test setup from `agentChatHandler.test.ts`). Assert:
- **AC-AAN-030:** `createAutomationAction.validate({ kind:'schedule', prompt:'x' })` (no `schedule`) → `{ ok:false, error: /schedule/ }`; `validate({ kind:'trigger', prompt:'x' })` (no `trigger_on`) → `{ ok:false, error: /source and event/ }`; a valid schedule + a valid trigger → `{ ok:true }`. Also drive the handler: an invalid-args `create_automation` proposal emits **no** `needs-approval` event (mirrors AC-AW-005 invalid-args-no-approval).
- **AC-AAN-028:** `createAutomationAction.confirm === true`; a valid proposal through the handler emits a `needs-approval` status event and writes **no** row (approve-chip flow).
- **AC-AAN-029:** approving (`dispatchActionForced`) inserts an `agent_automations` row via the **caller-JWT** client (`ctx.supabase`), never `service_role`, owned by the caller (no explicit `owner_id` sent).

**Verify (fails):** `npx vitest run src/lib/agent/actions.create_automation.test.ts` → `createAutomationAction` undefined.

### Task E4 — `createAutomationAction` + handler registration (GREEN) — FR-AAN-029/030/031, FR-AAN-038
**Files:** `supabase/functions/agent-chat/schema.ts` (EDIT), `actions.ts` (EDIT), `handler.ts` (EDIT).
`schema.ts`: `CREATE_AUTOMATION_SCHEMA` — `{ kind:'schedule'|'trigger'(required), prompt: string(required), schedule?: string, trigger_on?: {source,event}, condition?: string, timeout_s?: integer }`. `actions.ts`: `createAutomationAction` with `confirm:true`, `validate` enforcing FR-AAN-002's kind-conditional requirement (defense-in-depth vs. the DB CHECK), `summarize(i)` → a human-readable description (e.g. `` `Watch: ${i.prompt}` (${i.kind==='schedule' ? 'on schedule '+i.schedule : 'when '+i.trigger_on.event})` ``), `run` → `sb.from('agent_automations').insert({ kind, prompt, schedule: schedule ?? null, trigger_on: trigger_on ?? null, condition: condition ?? null, timeout_s: timeout_s ?? 120 })` via `dispatchActionForced` (caller JWT). `handler.ts`: add both to `BASE_ACTIONS` (line 56) + they auto-populate `BASE_ACTION_BY_NAME`; `getPermissionCheck` (line 294) — **leave default `null`** for both (§0: no extra role gate; ownership via RLS). **Flag gating (FR-AAN-038):** register both only when the agent-chat env flag is on (mirror the existing `composeEnabled` gating pattern in `handler.ts`) — with the flag off, the catalog omits them.

**Verify (green):** `npx vitest run src/lib/agent/actions.create_automation.test.ts src/lib/agent/actions.notify.test.ts src/lib/agent/agentChatHandler.test.ts` → all green (no regression to existing catalog tests).

### Task E5 — `notifications.ts` DAL + failing test (RED→GREEN) — FR-AAN-034/035/036
**Files:** `pmo-portal/src/lib/db/notifications.test.ts` (NEW), `pmo-portal/src/lib/db/notifications.ts` (NEW).
Follow `agentEvents.ts`/`userViews.ts` exactly (import `supabase` from `@/src/lib/supabase/client`, `AppError` on error, never send `org_id`/`owner_id`). Export:
- `listUnreadCount(): Promise<number>` → `.from('notifications').select('*', { count:'exact', head:true }).is('read_at', null)` (the partial-index fast path, FR-AAN-034).
- `listNotifications(): Promise<NotificationRow[]>` → `.from('notifications').select('*').order('created_at', { ascending:false })` (most-recent first, FR-AAN-035).
- `markNotificationRead(id): Promise<void>` → `.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)` (sends **only** `read_at` — RLS + the mark-read-only trigger enforce owner + column limit, FR-AAN-036).
`NotificationRow = Tables<'notifications'>` from regenerated `database.types.ts` (regen after migration 0048 — do NOT hand-cast, MEMORY: type-regen-not-casts). Tests assert query shape + that `markNotificationRead` sends only `read_at`. Titled `listNotifications orders created_at desc` / `markNotificationRead sends only read_at`.

**Verify:** `npx vitest run src/lib/db/notifications.test.ts` → pass.

### Task E6 — `NotificationBell` failing tests (RED) — AC-AAN-032..035, NFR-AAN-A11Y-001..003
**File:** `pmo-portal/src/components/shell/__tests__/NotificationBell.test.tsx` (NEW)
Render `<NotificationBell />` with the `notifications` DAL module mocked (`vi.mock('@/src/lib/db/notifications')`) and a `MemoryRouter`. Cases:
- **AC-AAN-032:** `listUnreadCount` → 3 → the bell shows a badge reading "3" and its `aria-label` includes "3 unread" (NFR-AAN-A11Y-001); the badge region is `aria-live="polite"` (NFR-AAN-A11Y-003).
- **AC-AAN-033:** open the bell (click) → `listNotifications` returns rows at distinct `created_at` → they render as a semantic `<ul>`/`<li>` in `created_at desc` order; read/unread conveyed by text/`aria`, not color alone (NFR-AAN-A11Y-002).
- **AC-AAN-034:** select an unread item → `markNotificationRead(id)` called → the item's read state flips and the badge decrements 3→2.
- **AC-AAN-035:** an item with `metadata.entity = {type:'procurement_case', id, label}` → selecting it navigates (assert `useNavigate` mock called with the resolved route); an item with only `metadata.run_id` → opens the run (assert the resume handler called); neither present → select only marks read.

**Verify (fails):** `npx vitest run src/components/shell/__tests__/NotificationBell.test.tsx` → component undefined.

### Task E7 — `NotificationBell.tsx` (GREEN) — FR-AAN-034/035/036, NFR-AAN-A11Y-001..003
**File:** `pmo-portal/src/components/shell/NotificationBell.tsx` (NEW)
A bell `<button>` (`Icon name="bell"` — confirm the icon name in `src/components/ui/icons`; if absent, add or reuse an existing) with `aria-label={\`Notifications, ${unread} unread\`}`, a visible focus ring (DESIGN.md tokens, mirror ContextBar's button classes), and a badge (`aria-live="polite"`) when `unread > 0`. On open, a popover `<ul aria-label="Notifications">` of `listNotifications()` rows, each a `<li><button>` showing `severity` marker + `title` + `body` + relative time + read/unread text state. On select: `await markNotificationRead(id)`, decrement local unread, then resolve `metadata`: `metadata.entity` → `useNavigate` to the record route (map `type`→path via the existing route map); else `metadata.run_id` → open the run transcript (the issue-2 resume path); else no-op. Loads counts/list on mount + on open. Use `count`-only for the badge (fast path), full list only when opened.

**Verify (green):** `npx vitest run src/components/shell/__tests__/NotificationBell.test.tsx` → pass.

### Task E8 — Mount `NotificationBell` in `ContextBar`; drop the dead prop (GREEN) — FR-AAN-034, OBS-AAN-001, REC-3
**File:** `pmo-portal/src/components/shell/ContextBar.tsx` (EDIT)
Remove `notificationCount?: number` from `ContextBarProps` and the `notificationCount: _notificationCount = 0` param (OBS-AAN-001 — replaced by the component's own query, "not a new prop shape"). Replace the dead comment block (lines 115-119) with `{isFeatureEnabled('agentAssistant') && <NotificationBell />}` placed where the bell historically sat (between `<ThemeToggle />` and the desktop right-cluster). Import `isFeatureEnabled` from `@/src/lib/features` + `NotificationBell`. Update any `ContextBar` caller passing `notificationCount` (grep — likely none, prop was dead) and `ContextBar.test.tsx` only if a query breaks (adjust, do not weaken — BDD rule).

**Verify:** `npx vitest run src/components/shell` → green; `grep -rn notificationCount pmo-portal/src` → no remaining references except the removed lines.

---

## PHASE F — Credits preflight integration  (BLOCKED on issue-3, REC-4 — serialize last)

> Build only once issue-3's credit-backed `RateGuard` seam exists. Until then, `runDispatchTick` uses a no-op `RateGuard` (always `{exceeded:false}`) and AC-AAN-027 is deferred (mark the task blocked in the tracker, do NOT fake-green it).

### Task F1 — Credits preflight failing test (RED) — AC-AAN-027
**File:** `pmo-portal/src/lib/agent/dispatch/dispatcher.credits.test.ts` (NEW)
Inject a mocked credit-backed `RateGuard` whose `check(ownerId)` resolves `{ exceeded: true }`. Run `runDispatchTick` for one due automation owned by that user. Assert: **no** fire happens (the mocked `fireAutomation`/`agentChatHandler` is never called → no `agent_runs` row reaches `running`, FR-AAN-033), and a `severity='warning'` notification ("automation X skipped — out of credits") is inserted for the owner (via the minted owner client). Titled `AC-AAN-027 over-credit no-start plus warning notification`.

**Verify (fails):** `npx vitest run src/lib/agent/dispatch/dispatcher.credits.test.ts`.

### Task F2 — Wire the preflight into the tick (GREEN) — FR-AAN-032/033
**File:** `supabase/functions/agent-dispatch/dispatcher.ts` (EDIT — `runDispatchTick`)
Before minting-to-fire, call `deps.rateGuard.check(automation.owner_id)`; on `exceeded:true`, mint the owner client (needed to write the warning under owner RLS), insert the `severity='warning'` "skipped — out of credits" notification, do **not** fire, do **not** stamp `last_fired_at`, continue to the next automation. The preflight runs strictly before any run starts (NFR-AAN-SEC-006). Wire the real `RateGuard` in `index.ts` (Task D6 — confirm issue-3's exported symbol, REC-4).

**Verify (green):** `npx vitest run src/lib/agent/dispatch/dispatcher.credits.test.ts src/lib/agent/dispatch/dispatcher.deputy-invariant.test.ts` → green.

---

## PHASE G — Curated e2e + full gate

### Task G1 — Automation→notification e2e (RED→GREEN) — AC-AAN-036
**File:** `pmo-portal/e2e/AC-AAN-036-automation-notification.spec.ts` (NEW)
Playwright, leading `test('AC-AAN-036 …')`. Two-user cross-stack journey against local Supabase, `VITE_FEATURES_AGENT_ASSISTANT=true`. Because the `pg_cron` tick + edge runtime do not run in the Playwright env (mirror AC-AGP-023 precedent — edge/cron are live-verified, not CI), **simulate the fire** by invoking `runDispatchTick` against the automation (either via a test-only invocation of the dispatch fn locally, or by directly exercising the `notify` producer path the fire would take — the journey's oracle is the *notification appearing + tenant isolation*, not the cron mechanism):
1. Sign in as user A; open the panel (⌘J); ask the assistant to "every weekday at 8am summarize my overdue tasks"; approve the `create_automation` chip; assert the automation is confirmed in chat.
2. Trigger a simulated dispatcher fire for that automation → assert a new run exists under A and an in-app **notification appears** — the `ContextBar` bell's unread badge increments.
3. Sign out; sign in as user B; open the panel + bell → assert user A's automation and notification do **not** appear (B's bell shows only B's count; a direct `listNotifications()` in-page for A's row returns empty — RLS wall).
Follow existing agent e2e patterns (`AC-AR-013`/`AC-CV-015` — full-serial, dedicated fixtures, MEMORY).

**Verify:** `cd pmo-portal && npx playwright test e2e/AC-AAN-036-automation-notification.spec.ts`.

### Task G2 — FULL verify + integration gate (binding pre-PR)
Run, from `pmo-portal/`, in order:
1. `npm run verify` (= `typecheck && lint:ci && test && build`) — the WHOLE suite (a shared-file edit like `ContextBar.tsx`/`handler.ts` can break other renders/handler tests).
2. From repo root: `supabase db reset && supabase test db` — all pgTAP incl. `0097–0100` green.
3. From `pmo-portal/`: `npx playwright test e2e/AC-AAN-036-automation-notification.spec.ts` (+ `AC-AR-013`/`AC-CV-015`/`AC-AGP-023` to confirm no agent-panel/persistence regression).
4. **Rendered Discover pass** on a clean build (`npm run build && npm run preview`): render the `NotificationBell` in all three states — empty (0 unread, badge hidden), unread (badge N + inbox list), and read (opened, decremented) — MEMORY: render-before-promote; stub unit tests are not the rendered pass.

**Only after all four are green** does the issue go to the review battery (3-lens + rendered Discover + BDD) → PR to `dev`. security-auditor runs at **full depth** on migration 0048, the entire `agent-dispatch` fn (esp. `mint.ts`), and both new agent-chat catalog entries (NFR-AAN-SEC-001, spec Depth note). Never open the PR before the full battery is green locally (MEMORY: pr-after-review-battery).

---

## 4. Type/signature consistency (guard across tasks)

- **`AgentAction`** shape for `notifyAction`/`createAutomationAction` is identical to `createActivityAction` (`actions.ts`): `{ name, description, inputSchema, surfaces:['agent'], confirm, validate?, summarize?, run }`. Write actions cast `ctx.supabase as unknown as SupabaseLikeWithWrites` (the shipped pattern, line 217).
- **`NotificationRow = Tables<'notifications'>`**, **`AgentAutomationRow = Tables<'agent_automations'>`** from regenerated `database.types.ts` (regen after 0048; do NOT hand-cast). `Severity = NotificationRow['severity']` reused by `NotificationBell` + `notifyAction`.
- **Dispatcher deps bag** (`runDispatchTick(deps)`): `{ serviceClient, authAdmin, modelClient, modelId, rateGuard, mintOwnerJwt, now, memo }` — the SAME shape asserted in `dispatcher.deputy-invariant.test.ts` (D4) and constructed in `index.ts` (D6).
- **`mintOwnerJwt(authAdmin, automation): Promise<{ client, expiresInS }>`** — identical in `mint.ts` (D3), `fire.ts`'s caller (D2), and the mint test (D3). The minted `client` is what `fireAutomation` receives as `mintedClient` (D2) — one client object, identity-checked in D4.
- **`evaluateCondition(deps, automation, event): Promise<{ fire: boolean; warning? }>`** — same in `condition.ts` (C2), the tick (D5), and the condition test (C1).
- **`{ source, event }`** is the `trigger_on` jsonb shape everywhere (migration CHECK A5, `selectTriggerMatches` B5, `create_automation` schema E4, condition C2).

## 5. Scaling / risk notes (Performance + Architecture lenses)

- **Dispatcher tick is bounded (NFR-AAN-PERF-001):** schedule selection is one indexed query (`agent_automations_due_idx` partial index on `kind where enabled and archived_at is null`) filtered in-JS by `cronMatches`; trigger selection is one watermark-indexed range scan per source (`procurement_status_events_procurement_idx` covers `created_at`). At single-tenant scale this is trivially bounded; at millions-of-automations the in-JS cron match becomes the driver — future escape hatch is precomputing next-fire timestamps in a column + a range query (additive, no contract change).
- **Unread-badge query is O(1) indexed (NFR-AAN-PERF-002):** the `notifications_owner_unread_idx` partial index makes `count where read_at is null` a single index scan.
- **Condition memo (NFR-AAN-PERF-003):** an in-invocation `Map` caps cheap-model calls to once per `(automation_id, condition)` per tick — a 1000-event burst matching one condition bills one model call, not 1000.
- **The minting path is the single top risk (NFR-AAN-SEC-001):** constrained to the row's `owner_id` (D3), audited before use (D3), proven cross-tenant-denied identically to interactive (A6 pgTAP + D4 unit), and `service_role` proven quarantined to `{agent_automations, agent_dispatch_watermarks, procurement_status_events}` (D4). This is why the mint tasks are opus + gate-in-same-task.
- **`agent_dispatch_watermarks` is the one non-tenant table** — ADR-0046 records why (dispatcher infra, service-role-only, no `org_id`); a future auditor grep for missing `org_id` finds intent, not a bug.
- **Duplicate-logic avoidance:** `notify`/`create_automation` reuse the shipped `AgentAction`/`dispatchActionForced` gate (OBS-AAN-002) — no parallel write path; `notifications.ts` DAL copies the `agentEvents.ts` shape verbatim; the fired run reuses `agentChatHandler` unchanged (OBS-AAN-003).

## 6. New ADR

**ADR-0046 — dispatch watermark infra table** (Task A1). The only net-new architectural decision beyond ADR-0044: a non-tenant, `org_id`-less, service-role-only infra table. Everything else (minting, quarantine, poll-since-watermark, NL-condition fail-quiet, channel seam, credits metering) is already ADR-0044.

## 7. Open questions for the Director

1. **`create_automation` role gate (spec Open Q, §0).** Plan defaults to **no** `can()`/role gate beyond ownership (`getPermissionCheck` → `null`, matching `create_activity`). If certain roles should be barred from creating trigger-kind automations on sensitive sources (e.g. an Engineer auto-firing on procurement events), that is an owner-adjudicated policy decision — **confirm no-gate is acceptable** before Build, else specify the restriction. Recommendation: no-gate for v1 (RLS owner-scoping already bounds what a fired run can touch).
2. **Issue-3 dependency ordering (WARNING §3, REC-4).** FR-AAN-032/033 + AC-AAN-027 are **blocked** on issue-3's credit-backed `RateGuard` seam. Confirm the build sequence: either (a) land issues 3 then 5 (backlog order — recommended), or (b) land Phases A–E+G of this issue now with a no-op preflight and Phase F as a fast-follow once issue-3 ships. Recommendation: (a).
3. **Auth admin mint API method (D3).** The plan assumes a Supabase Auth admin API that mints a short-lived owner session/JWT (`supabase.auth.admin`-style). Confirm the exact method available in the deployed Supabase version (e.g. `generateLink`/`createSession`/admin `signInWithId`) before D3 — the mint-scoping test asserts "called with exactly owner_id," which is method-agnostic, but the real call must exist. This is the one seam the plan cannot fully pin from repo state (no prior mint call exists — it's the first).
4. **pg_cron GUC delivery (A5, D6).** The per-minute job posts to `app.settings.dispatch_url` with `app.settings.service_role_key` from Postgres GUCs — these must be set in the deployed DB (not CI). Confirm the deploy runbook sets them (or switch to Supabase's Vault/`supabase_functions` invocation convention if that's the house pattern — no prior `pg_cron` job exists in this repo, this is the first, so the delivery mechanism is a build-time confirm against the deployed Supabase).
