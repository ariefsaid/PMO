# ADR-0044 — Agent automations (cron + event-triggered) + the notifications inbox

- **Status:** Accepted (owner-directed 2026-07-03)
- **Date:** 2026-07-03
- **Deciders:** Owner, Director
- **Related:** ADR-0036 (deputy invariant §2 + four ceilings — the invariant this ADR must preserve for
  background runs), ADR-0039 (single LLM call site + untrusted-output boundary), ADR-0040 (Option A
  `AgentRuntime` port; 2026-07-03 addendum forward plan), ADR-0041 (model-calling-action seam),
  ADR-0043 (thread/event persistence + run lifecycle — automations produce runs/events; credits),
  ADR-0018 (soft-archive), ADR-0016/0017 (real-JWT + repository seam), ADR-0010 (test pyramid),
  ADR-0022 (PostHog), ADR-0001 (org_id seam), ADR-0008 (impersonation is view-only).
- **Scope:** owner-created **automations** (scheduled + event-triggered agent runs) and the
  **notifications inbox** that is their delivery surface. Coupled deliberately: notifications is how an
  automation (which has no live user watching) reports back. This ADR decides architecture; per-issue
  specs/plans follow.

## Context

The highest-value new capability the battery-mining pass found (`docs/spikes/2026-07-03-agent-native-battery-mining.md`
Tier-1 #1) is **automations**: a user tells the assistant *"every Monday 8am, summarize my overdue tasks"*
(cron) or *"when a procurement case sits >30 days in Ordered, notify me"* (event + NL condition). Their
delivery surface (Tier-1 #2) is a **notifications inbox** — also the surface for long-run completions
("bulk import done — 3 rows failed"). Upstream runs an always-on in-process 60s scheduler; PMO has **no
always-on Node process** — only Supabase (Postgres + `pg_cron` + edge functions).

The load-bearing problem is the **deputy invariant** (ADR-0036 §2): every agent run so far executes under
a **live user's JWT**, so RLS is the ceiling by construction. A **background** run has no live user and no
live JWT. Naively that tempts `service_role` execution — which **bypasses RLS** and detonates the org_id
tenancy seam. This ADR's central decision is how to run an automation *as its owner* with RLS still the
ceiling, without ever querying business data as `service_role`.

## Decision

Tags: **[PMO]** = a PMO addition/extension.

### 1. `agent_automations` — an owner-scoped tenant entity, created via chat or (later) UI. **[PMO]**

```
agent_automations
  id           uuid pk default gen_random_uuid()
  org_id       uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001'  -- tenancy seam
  owner_id     uuid not null references profiles(id) default auth.uid()                                    -- runAs = owner (v1)
  kind         text not null check (kind in ('schedule','trigger'))
  prompt       text not null                    -- the goal handed to the agent loop when it fires
  schedule     text                             -- cron expression; required when kind='schedule', null otherwise
  trigger_on   jsonb                            -- { source, event }; required when kind='trigger' (see §2)
  condition    text                             -- optional NL condition, evaluated by a small model (§4)
  enabled      boolean not null default true
  timeout_s    integer not null default 120     -- hard wall-clock cap per fired run
  last_fired_at timestamptz
  created_at   timestamptz not null default now()
  updated_at   timestamptz not null default now()
  archived_at  timestamptz                      -- soft-archive (ADR-0018)
```

- **`runAs = OWNER only, v1.** No shared automations (upstream's `runAs: creator|shared` collapses to
  owner-only). Sharing is deferred with the same rationale as ADR-0043 §1.
- **Created via chat** — a new `AgentAction` (`create_automation`, `confirm:true` so it surfaces an
  approve chip like any write, per ADR-0040 A3) the agent can call, or a UI list later. The action writes
  the row under the caller JWT (owner RLS), exactly like any other write.
- **RLS: owner-only** (`owner_id = auth.uid() and org_id = auth_org_id()` on all verbs; INSERT re-pins
  both via default + `with check`, mirroring `user_views_insert`/ADR-0043 §1). org_id is the wall.
- **pgTAP:** owner isolation + cross-org denial; INSERT re-pin (a user cannot create an automation owned
  by someone else); `enabled`/`archived_at` respected by the dispatcher's selection query. Owns these ACs
  at the pgTAP layer (ADR-0010).

### 2. Execution infra — `pg_cron` → a dispatcher edge fn; event triggers via a watermark queue. **[PMO]**

- **Schedules:** a single `pg_cron` job (per minute) invokes a **dispatcher Supabase Edge Function** that
  selects due `enabled`, non-archived `kind='schedule'` automations (cron match) and fires each. **No
  always-on Node** — contrast upstream's in-process scheduler. The dispatcher fires each automation as an
  ordinary agent run (ADR-0043 run/events), under the minted owner JWT (§3).
- **Event triggers — poll-since-watermark, chosen over trigger→queue-on-write.** `kind='trigger'`
  automations hook the **existing append-only status-event tables** (e.g. `procurement_status_events`,
  `0038`). The dispatcher keeps a **watermark** (last-seen event `id`/`created_at` per source) and, each
  tick, selects new status-events since the watermark, matches them against enabled trigger automations
  (`trigger_on.source`/`event`), and fires. **Why poll-since-watermark over a DB trigger writing a queue
  table:** (a) the status-event tables are **already** the append-only, RLS-owned, ordered log — a second
  queue table would duplicate them; (b) a `pg_trigger` firing an edge fn (via `pg_net`) on every business
  write couples the hot write path to the agent tier and to network reachability, a scaling and
  failure-isolation risk; (c) polling a watermark is idempotent, cheap (indexed range scan), and naturally
  batched. The cost — up-to-one-tick latency — is acceptable for "notify me when…" automations. A
  dedicated queue table can be introduced later **without** changing the automation contract if sub-minute
  latency is ever required.
- The dispatcher's **selection** query (which automations exist, their owner_id) runs as `service_role`
  **for enumeration only** — it reads `agent_automations` metadata to know *what to run and for whom*. It
  **never** reads tenant business data as `service_role`; that happens only under the minted owner JWT
  (§3). This split is the whole safety argument and must be enforced by review + test.

### 3. THE hard decision — background runs execute under a **minted, short-lived, owner-scoped JWT**; RLS stays the ceiling. **[PMO]**

A background automation runs the **normal agent loop** (`agentChatHandler`, ADR-0039/0040) under a JWT
minted **for its owner** at dispatch time. Concretely:

1. The dispatcher uses `service_role` **only** to call the Supabase Auth **admin API** to mint a
   **short-lived** session/JWT for `agent_automations.owner_id` (the automation's own owner — no other
   user is reachable from an automation row). `service_role` is used to **mint, never to query business
   data**.
2. The minted JWT is handed to the standard deputy path: a caller-JWT-scoped Supabase client, the same
   `AgentAction` catalog, the same RLS ceiling. From the agent loop's perspective it is **indistinguishable
   from an interactive run** — same tools, same `can()` re-auth on writes (ADR-0040 A3), same untrusted-
   output boundary (ADR-0039).
3. The minted JWT is never persisted. **⚠ Amended 2026-07-04 (gpt-5.5 cross-family audit):** the JWT's
   *token* lifetime is **NOT** bounded to `timeout_s` — the Supabase Auth `generateLink` admin API used to
   mint exposes no per-token TTL knob, so a minted access token carries the project's default token
   lifetime. `timeout_s` bounds only the **wall-clock fire deadline** (an `AbortController` on the fired
   run, code: `wallClockTimeoutS`), not the credential's validity window. The mitigation for a leaked
   minted token is therefore the deputy ceiling itself (it can only reach the owner's own RLS-scoped data),
   NOT a short TTL. A narrower-TTL admin mint mechanism should replace `generateLink` if/when Supabase
   exposes one; until then, treat minted tokens as default-lifetime bearer tokens in threat models.

**The risk, and how it is constrained.** A minting path is privileged — a bug that mints for the *wrong*
`owner_id` would be a tenancy breach. Constraints (binding):
- Minting is **only ever** for the `owner_id` of the **specific automation row** being dispatched — the
  dispatcher passes that `owner_id`, never a request-supplied or model-supplied one. The model **cannot**
  influence whose JWT is minted (it only supplied the `prompt` at creation time, itself an owner write).
- **Every mint is audited** (an `agent_events`/system audit row: automation id, owner_id, minted-at) so a
  wrong mint is detectable.
- A **pgTAP + handler gate test proves cross-tenant denial is identical to the interactive path**: an
  automation owned by user A, running under the minted A-JWT, is denied any read/write of user B's data by
  RLS — byte-for-byte the interactive deputy-invariant result. This is the same gate ADR-0043/0040 already
  require, extended to the minted-JWT path.
- Impersonation semantics (ADR-0008) do not apply: an automation runs as the **real** owner, never an
  impersonated effective role.

### 4. NL trigger conditions — evaluated by a small (cheap-tier) model, memoized, fail-quiet-but-visible. **[PMO]**

When an automation carries a `condition` (e.g. "…sits **>30 days** in Ordered"), the dispatcher evaluates
it with a **small, cheap-tier model** (the per-action model map, backlog batteries-A item 1 / the
vendor-neutral `ModelClient` seam) against the triggering event's context, **memoized with a TTL** so the
same condition on a burst of events is not re-billed. Evaluation outcomes:
- **True** → fire the run.
- **False** → no-fire (silent; the common case).
- **Failing or ambiguous** (model error, unparseable condition) → **no-fire AND a `warning` notification
  to the owner** ("couldn't evaluate the condition for automation X"). Fail-quiet-but-visible: never
  silently swallow, never fire on uncertainty. A condition is a **grounding hint, never an authorization**
  — RLS still bounds whatever the fired run can touch.

### 5. `notifications` — the inbox, with a channel abstraction from day one. **[PMO]**

```
notifications
  id          uuid pk default gen_random_uuid()
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001'
  owner_id    uuid not null references profiles(id) default auth.uid()   -- recipient (v1 = the automation owner)
  severity    text not null default 'info' check (severity in ('info','warning','critical'))
  title       text not null
  body        text
  metadata    jsonb          -- { source, automation_id?, run_id?, entity {type,id,label}? } — deep-link context
  read_at     timestamptz    -- null = unread
  created_at  timestamptz not null default now()
```

- **In-app inbox in the shell:** a **bell + unread badge** in the ContextBar; unread = `read_at is null`.
  Marking read is the one narrow owner UPDATE (touching `read_at` only, `with check`-guarded).
- **Channel abstraction from day one:** the producer writes a `notifications` row (in-app, v1) through a
  channel seam; **webhook/Slack/email** slot in later as additional channels **without redesign** — the
  DB row stays the durable record.
- **Producers:** agents create notifications via a `notify` **`AgentAction`** (`confirm:false` — a
  notification is not a business write, it is addressed only to its own owner). The first producers are
  **automations** (§1–§4) and **long-run completions** (ADR-0043 runs reaching a terminal state on a
  long/background task).
- **RLS: owner-only** (`owner_id = auth.uid() and org_id = auth_org_id()`); the `notify` action and the
  dispatcher write under the recipient's context (interactive: caller JWT; background: the minted owner
  JWT of §3 — v1 recipient == automation owner, so no cross-user notify path exists yet). **Index:**
  `notifications (owner_id) where read_at is null` (unread-badge fast path).
- **pgTAP:** owner isolation + cross-org denial; a user cannot create a notification for another user
  (INSERT `with check` pins `owner_id`); the mark-read UPDATE only touches `read_at` and only for the owner.

### 6. Credits — automation runs meter against the OWNER's balance; over-budget → no-start + notify. **[PMO]**

Automation runs meter against the **owner's** credit balance (ADR-0043 credits / backlog batteries-A item
3 — the SaaS metering seam). At dispatch, the credit preflight (the existing `RateGuard` injection point,
ADR-0039) runs for the owner: **a run that would exceed the balance does not start**, and the owner gets a
`warning` notification ("automation X skipped — out of credits"). Background spend is bounded by the same
per-user meter as interactive spend — no separate, unmetered cost channel.

## Feature-flag gating

Gated behind the shipped **`agentAssistant`** flag (`VITE_FEATURES_AGENT_ASSISTANT`,
`pmo-portal/src/lib/features.ts`). With the flag off, the tables and the `pg_cron`/dispatcher exist but the
create-automation/notify actions are absent from the catalog and the bell is hidden — an environment
without an LLM provider ships unchanged (ADR-0039 posture). The `pg_cron` job selecting 0 rows is a no-op.

## Consequences

**Positive**
- The single highest-value new capability (automations) ships on Supabase-native infra — `pg_cron` +
  one dispatcher edge fn — **no always-on Node**, no new deployable class.
- The deputy invariant survives background execution **by construction**: the minted JWT runs the **same**
  RLS-ceilinged loop; `service_role` is quarantined to mint + metadata-enumeration and proven never to
  touch business data.
- Notifications give automations (and long runs) a durable, owner-scoped delivery surface with a channel
  seam ready for Slack/email — the DB row is always the record.
- Credits bound background spend on the same per-user meter as interactive — no unmetered cost channel.

**Negative / costs**
- A **privileged minting path** now exists — the most security-sensitive surface in the agent tier. It is
  constrained (owner_id from the row only, audited, gate-tested) but must be reviewed as such on every
  change (security-auditor owns it).
- Up-to-one-tick latency for event triggers (poll-since-watermark) — acceptable for "notify me when…";
  a queue table is the future escape hatch if sub-minute latency is needed.
- New infra corners: `pg_cron` scheduling, a dispatcher edge fn, watermark bookkeeping, small-model
  condition evaluation + memoization — each a testable seam but net-new surface.

## Alternatives considered

- **`service_role` execution with app-level filtering.** Rejected: violates ADR-0036 §2 — a privileged
  connection bypasses RLS; app-level filtering is exactly the by-prompt-not-by-DB enforcement the deputy
  model exists to avoid. One bug = cross-tenant leak.
- **Storing per-user refresh tokens to re-auth automations.** Rejected: strictly worse than minting —
  long-lived credential at rest, revocation/rotation burden, a fat breach target. Minting a short-lived
  JWT per fire is bounded and auditable.
- **Always-on Node scheduler (upstream's model).** Rejected: PMO has no always-on Node; adding one is a
  new deployable + ops surface the `pg_cron` path avoids.
- **`pg_trigger` → `pg_net` → edge fn on every business write (trigger→queue).** Rejected as the v1
  mechanism (see §2): couples the hot write path to the agent tier + network reachability; duplicates the
  existing append-only status-event log. Kept as a future option behind the unchanged automation contract.
- **Firing on an ambiguous/failed NL condition.** Rejected: fail-quiet-but-visible (§4) — never act on
  uncertainty; surface it as a warning instead.

## Verification (what proves the decision when built)

- **pgTAP (owning layer, ADR-0010):** owner isolation + cross-org denial for `agent_automations` and
  `notifications`; INSERT re-pin (cannot create rows owned by / addressed to another user); mark-read /
  enabled/archived selection behavior.
- **The minting cross-tenant gate (the load-bearing test):** an automation owned by user A, dispatched
  under the **minted A-JWT**, is denied every read/write of user B's data by RLS — **identical** to the
  interactive deputy-invariant result (extend the existing `deputy-invariant.gate` / port the retired
  branch's shape). A test asserts the dispatcher mints **only** for the row's `owner_id` and that
  `service_role` never issues a business-data query in the automation path.
- **Handler/dispatcher unit tests (Vitest, mocked auth-admin + Supabase + model, ADR-0039 dec 7):**
  cron selection fires due schedules only; watermark advances and does not double-fire; an NL condition
  false → no-fire, ambiguous → no-fire + warning notification; a long-run completion produces a
  notification; over-credit → no-start + warning notification.
- **Curated e2e (one cross-stack AC, ADR-0010):** user asks the assistant to create a scheduled
  automation (approve chip) → it appears in the list → a simulated fire produces a run + an in-app
  notification (bell badge increments); a second user never sees it.
- **Decision-level:** owner sign-off (recorded here); `docs/README.md` ADR range/Latest updated to
  include 0044.
