# Observability & Analytics — spec

**Status:** DRAFT, awaiting owner sign-off
**Date:** 2026-07-25
**Owner decisions captured:** 2026-07-25 (see §1.2)
**Supersedes nothing.** Extends `observability-floor.spec.md` and `posthog-instrumentation.spec.md`.

---

## 1. Context

### 1.1 Why now

v0.8.0 shipped to production on 2026-07-25. That deploy revealed that `adapter-dispatch` had been
serving an **8-day-old build** and that **11 edge functions had never been deployed at all** — and
nothing alerted anyone. The product now performs money write-through (invoices, payments, timesheets,
budgets) against a live ERP, and the failure signal for that path is weak:

- **4 of 22** edge functions produce `error_events` (`agent-dispatch`, `agent-chat`, `compose-view`,
  `m365-token-custody`). The 18 that do not include **every** ERP/ClickUp/external integration function.
- `recordErrorEvent` (`_shared/errorEvent.ts:39-50`) **swallows its own insert failure** and returns
  `void`; 3 of the 4 producers call it un-awaited. A broken error pipeline is indistinguishable from
  a healthy, quiet one.
- `error_events` has **no retention** — it grows unbounded.
- The alert drain re-sends forever if a stamp write fails (§4.2), and runs **hourly**, so a production
  error alert can be delayed ~1h.

Separately, the analytics layer has the same defect class: **two provisioned dashboard tiles can never
render data**, because their events never fire. An empty chart reads as "no failures".

### 1.2 Owner decisions (binding, 2026-07-25)

| # | Decision | Consequence for this spec |
|---|---|---|
| OD-OBS-1 | **Session replay + autocapture stay demo-prospect only.** Not enabled for real users. | The unknown-unknown net for real users must come from autocapture-independent signals only (§5.1). `$rageclick` as a queryable event is **out of reach** and is explicitly not pursued. |
| OD-OBS-2 | **Consent = disclose + in-app opt-out + `respect_dnt: true`. No banner.** Legitimate-interest posture; B2B named account-holders. | §6. No `opt_out_capturing_by_default`. Cookieless mode rejected (it disables replay/surveys, kills GeoIP, and inflates user counts via daily salt rotation). |
| OD-OBS-3 | **Taxonomy optimises for friction + the demo funnel.** | §5.2–§5.3. Customer-adoption metrics (PostHog group analytics on `org_id`) are **deferred**, not built. |

### 1.3 Architectural ruling: PostHog is the triage surface, Postgres is the record

PostHog has **no row-level security** — the project is the tenancy boundary. Anyone with project
access sees every tenant's errors. It also drops data past the free allowance *permanently*
("lost forever" — PostHog billing docs), and client capture is defeated by ad-blockers.

Therefore:

- **`error_events` (Postgres) is the system of record.** Tenant-scoped, joinable to app data,
  guaranteed delivery, retained on our terms, no consent required (server-side legitimate interest).
- **PostHog is the triage surface.** Symbolicated stacks, automatic issue grouping, spike alerting,
  and user-impact counts — all of which are substantial work to build and are not worth building.

Neither replaces the other. Anything a customer or auditor might ask about must be answerable from
Postgres alone.

### 1.4 Non-goals

- **Feature flags via PostHog.** When the flag quota is exhausted the SDK silently returns `false`
  for every flag, so a gated feature would vanish in production. The existing env/DB-driven flags
  (`src/lib/features.ts`, `org_features`) are the safer design and stay.
- **Session replay / autocapture for real users** (OD-OBS-1).
- **PostHog group analytics on `org_id`** — deferred with OD-OBS-3.
- **Surveys.** Available free (1,500 responses/mo) but no question is currently worth asking.
- **An operator UI over `error_events`** — see §3.4.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Producer** | An edge function that INSERTs into `error_events`. |
| **Drain** | `telegram-notify`, which SELECTs unnotified rows, alerts, and stamps `notified_at`. |
| **Silent false signal** | A green/empty/quiet result that is indistinguishable from a broken measurement. The recurring defect class in this codebase. |
| **Friction event** | An analytics event recording that a user was blocked, confused, or shown an error. |

---

## 3. Strand A — `error_events` coverage and integrity

### 3.1 Coverage

**FR-OBS-001** (ubiquitous) The system shall record an `error_events` row for every unhandled or
explicitly-caught operational failure in every deployed edge function.

> **Status: PARTIAL (amended 2026-07-28, spec-reviewer pass).** `serveWithErrorReporting` (ADR-0066)
> closes the *unhandled-throw* half for all 22/22 deployed functions. It does **not** close the
> *explicitly-caught* half: a handler that catches its own error and returns a `Response` — rather
> than re-throwing — produces no `error_events` row and no PostHog `$exception`. Verified:
> `clickup-sweep/index.ts`'s `MISCONFIGURED`/`OWNERSHIP_READ_FAILED` 500s and its per-org `catch` that
> logs then returns HTTP 200 `{ok:true}`; `erpnext-sweep/index.ts`'s `MISCONFIGURED`. Only 1 call site
> outside `_shared` (`agent-chat`) calls `reportEdgeError` directly. This is the largest remaining
> blind spot (ADR-0066's Non-coverage section) and is precisely the deploy-misconfiguration class
> behind v0.8.0's 8-day-stale-deploy incident (§1.1) that motivated this spec. Wiring
> `reportEdgeError` into handled-error return paths is a deferred item in `docs/backlog.md`, not
> implemented as part of this spec's shipped program.

**FR-OBS-002** (ubiquitous) The `EdgeFunctionName` union in `_shared/errorLog.ts:22-27` shall
enumerate **all** deployed edge functions, not a subset.

> Implementation note: that closed union is the blocking seam. It currently lists 5 names
> (`agent-chat`, `compose-view`, `agent-dispatch`, `admin-invite-user`, `telegram-notify`), so the
> other 17 functions *cannot* call `logStructuredError` without a type error. Widen the union first;
> the wiring is mechanical after that.

**FR-OBS-003** (event-driven) When an edge function catches an operational error, it shall call
`logStructuredError` with a stable `errorCode` drawn from a documented enum, rather than emitting a
free-text `console.error`.

> 79 non-test `console.error` calls exist across 22 function directories, several interpolating raw
> error objects. These are unsearchable and unaggregatable, and risk leaking payload contents.

### 3.2 The pipeline must report its own failure

**FR-OBS-010** (event-driven) When an `error_events` INSERT fails, the system shall emit a distinct,
countable signal (`ERROR_EVENT_INSERT_FAILED`) that reaches **PostHog**, not only `console.error`,
such that a failed error pipeline is distinguishable from an absence of errors.

**FR-OBS-011** (ubiquitous) `recordErrorEvent` shall report insert success or failure to its caller.

> Precise current state (`errorEvent.ts:39-50`): it *does* already `console.error` an
> `ERROR_EVENT_INSERT_FAILED` line on both the PostGREST `{error}` shape and a thrown error — so this
> is not a total blind spot. What is missing is that (a) the signal never leaves the function logs,
> so nothing counts or alerts on it, and (b) the function returns `void` regardless, so no caller can
> react — and 3 of the 4 producers call it un-awaited anyway.
>
> The net effect is still the silent-false-signal class, inside the very component whose job is to
> make failures visible: an operator reading a dashboard cannot tell a quiet system from a broken
> recorder. But an implementer should know the log line already exists rather than adding a second one.

**AC-OBS-010** *(Given/When/Then)*
- **Given** the `error_events` table is unwritable (revoked privilege, statement timeout),
- **When** an edge function records an error,
- **Then** an `ERROR_EVENT_INSERT_FAILED` structured log line is emitted **and** a PostHog
  `$exception` is captured, **and** the original error is still surfaced to the caller.

**AC-OBS-011**
- **Given** a healthy `error_events` table,
- **When** `recordErrorEvent` is called,
- **Then** it resolves to a success indicator, and a unit test asserts the failure indicator on the
  error path (i.e. the test fails if the swallow is reintroduced).

### 3.3 Retention

**FR-OBS-020** (state-driven) While rows exist older than the retention window, the system shall
delete them on a scheduled job.

**FR-OBS-021** The retention window shall be **90 days**, chosen to outlive a quarterly audit cycle
while bounding table growth.

**AC-OBS-020**
- **Given** `error_events` rows with `created_at` older than 90 days,
- **When** the purge job runs,
- **Then** those rows are deleted, rows inside the window are untouched, and the job records how many
  it deleted.

**AC-OBS-021**
- **Given** the purge job has never run,
- **When** a pgTAP test inspects the schedule,
- **Then** a cron entry for the purge exists and is enabled.

> ⚑ Registering cron is not the same as cron working. Migration `0071` registered a
> `telegram-notify-tick` that ran **thousands of times with zero successes** in production because
> its GUCs were never set — discovered only when `0083` replaced it. Any test that asserts
> "a schedule exists" must be paired with an assertion that the job has succeeded recently (§4.3).

### 3.4 Frontend surface — deliberately not built

**FR-OBS-030** (ubiquitous) `error_events` shall remain service-role-only.

The table has FORCE RLS with **zero policies** (`0071_error_events.sql:30-34`) — default-deny by
design. An FE surface would require either a new policy or a security-definer RPC, plus an
operator-only UI, plus tests for the tenancy boundary on a table that deliberately has none.

**We are not building it.** PostHog is the triage surface (§1.3) and Telegram is the alert channel.
If an operator console is wanted later it is its own issue with its own security review.

> Note for future readers: `0075_explicit_api_grants.sql:103-106` grants table DML on `error_events`
> to `authenticated` **and** `anon`. `0105` later revoked anon's write DML. These grants are inert
> only because RLS has no policies — if a policy is ever added, those grants become live. Any future
> FE-surface work must revoke them first.

---

## 4. Strand B — alerting and correctness hardening

### 4.1 Scope

A batch of independently-verified defects. Each carries the evidence that proves it, so a reviewer
can re-confirm without re-deriving.

### 4.2 The re-alert loop

**FR-HRD-001** (event-driven) When the `notified_at` stamp write fails, the drain shall detect the
failure, log it, and not treat the affected rows as notified.

**Evidence:** `telegram-notify/index.ts:96-100` awaits the UPDATE but discards the result.
supabase-js resolves (does not throw) with `error` populated, so an RLS change, statement timeout, or
PostgREST 5xx is invisible. The Telegram send at `:86-94` has already succeeded, so the rows keep
`notified_at IS NULL` and the next tick re-selects and re-sends them. The cooldown cannot suppress
this: `lastNotifiedByCode` is derived at `:57-66` from rows *where `notified_at IS NOT NULL`*, so if
the stamp never lands the code is never considered recently-notified. Unbounded at cron cadence.

**FR-HRD-002** (state-driven) While an error code has been alerted, repeated alerts for that code
shall be bounded regardless of stamp-write success.

> FR-HRD-001 fixes the cause; FR-HRD-002 bounds the blast radius if a similar path is ever
> reintroduced. Belt and braces are justified here because the failure mode is "alert-spam the owner
> forever" and the file is explicitly excluded from unit testing (`index.ts:4-7`).

**AC-HRD-001**
- **Given** a group of `error_events` whose Telegram send succeeded,
- **When** the `notified_at` UPDATE returns an error,
- **Then** the failure is logged with a distinct code, and the next tick does **not** re-send the
  same group unboundedly.

**FR-HRD-011** *(ratified 2026-07-28)* (ubiquitous) `alert_send_log` and `ops_job_heartbeats` — the
write-ahead and liveness tables the FR-HRD-001/FR-HRD-010 fixes introduced — shall remain
service-role-only: RLS enabled and forced, zero policies, `authenticated` denied all access, with
`service_role` retaining exactly the grants it needs. Mirrors the `error_events` posture (FR-OBS-030).

**AC-HRD-011**
- **Given** `alert_send_log` and `ops_job_heartbeats`,
- **When** a pgTAP test inspects their RLS state and grants,
- **Then** both tables have RLS enabled and forced with zero policies, an `authenticated` JWT is
  denied SELECT/INSERT/UPDATE on both, and `service_role` retains its required grants.

> Not the same claim as FR-HRD-002. FR-HRD-002 ("repeated alerts are bounded") is proven at the Unit
> layer, folded into `AC-HRD-001` (`pmo-portal/src/lib/agent/telegramDrain.test.ts`, "SAME group is
> not re-sent"). `0160_alert_ops_tables_lockdown.test.sql` proves a different thing — table lockdown
> — and was originally mis-tagged `AC-HRD-002` in the implementation plan before this reconciliation;
> it is retagged `AC-HRD-011` in both the test and here, rather than repurposing the never-ratified
> plan id.

### 4.3 Alerting must prove itself alive

**FR-HRD-010** (ubiquitous) The alert path shall have a liveness signal that distinguishes "no errors
occurred" from "the alert path is broken".

> This is the `0071` cron lesson generalised. Both states currently present as silence.
> `HEARTBEAT_URL` is unset in production (verified 2026-07-25 against the deployed function secrets),
> so `pingHeartbeat` is a no-op today.

### 4.4 Swallowed notification failures

**FR-HRD-020** (event-driven) When an owner notification insert fails, the system shall log it with a
structured code.

**Evidence:** `agent-dispatch/dispatcher.ts:288-306`. Bare `catch {}` with no binding. Doubly silent:
the cast declares `insert` resolving to `{ error: unknown }` and that `error` is never destructured,
so the ordinary supabase-js failure mode is dropped *before* the catch would apply. Both call sites
(`:435` condition-unevaluable, `:447` over-credit) are fail-quiet-but-visible paths — so a swallowed
failure means the owner is never told, which defeats the entire purpose of those paths. Contrast the
same file's `:515-525`, which does it correctly.

### 4.5 NUL bytes make files invisible to `grep`

**FR-HRD-030** (ubiquitous) No tracked text file shall contain a literal NUL byte.

**FR-HRD-031** (ubiquitous) CI shall fail if a tracked text file contains a NUL byte.

**Evidence:** three files use a NUL as a composite-key delimiter, written as a **literal byte**
instead of the `\u0000` escape:

| File | Line |
|---|---|
| `supabase/functions/agent-dispatch/dispatcher.ts` (deployed) | 209 |
| `pmo-portal/src/lib/adapterSeam/erpnext/agingSnapshot.ts` | 132 |
| `pmo-portal/src/lib/viewspec/compiler.test.ts` | 159 |

The delimiter intent is sound. The encoding is not: `file(1)` reports `data`, and **`grep` silently
skips the file**. Demonstrated: `grep -rn "recordErrorEvent" supabase/functions/` returns 9 hits;
`grep -an` returns 10. Every grep-based gate over these paths is blind to them.

**AC-HRD-030** *(wording corrected 2026-07-28 — see below)*
- **Given** a tracked text file containing a NUL byte,
- **When** CI runs,
- **Then** the build fails naming the file.

> **Correction (2026-07-28):** this AC originally said "naming the file **and line**." The shipped
> gate, `scripts/check-nul-bytes.sh`, names only the file — its scan is a single batched
> `perl -0777` whole-file slurp (see the script's own header comment), and a whole-file slurp has no
> line cursor to report. This was a **deliberate** performance choice, not an oversight: a per-file
> line-aware scan was measured at ~57s over the tracked tree versus ~0.44s for the batched slurp
> (`docs/backlog.md`'s NUL-byte entry records the same two numbers). Do not "fix" the script to add
> line numbers without re-confirming that tradeoff still holds.

**AC-HRD-031**
- **Given** the three files above after the fix,
- **When** `file(1)` is run on each,
- **Then** each reports text, and behaviour is unchanged (the delimiter is still a NUL at runtime).

> ⚑ Authoring hazard, learned the hard way: writing `\u0000` *through an editing tool* can itself
> emit a real NUL. This happened while drafting this spec and turned `docs/backlog.md` binary. The
> CI guard in FR-HRD-031 is what makes this class self-detecting.

### 4.6 Money and concurrency defects

**FR-HRD-040** (ubiquitous) `set_project_contract_value` shall reject negative values, and the
underlying column shall carry a `CHECK (>= 0)` constraint.
**Evidence:** `0076_audit_events.sql:212` — no sign check in the RPC, no CHECK on the column.
Both halves are one task: the RPC guard gives the good error message, the constraint is the authority.

**FR-HRD-041** (ubiquitous) `enforce_automation_owner_cap` shall be free of the count-then-insert race.
**Evidence:** `0059:31`. Two concurrent inserts can both observe a count below the cap. The
SHARE ROW EXCLUSIVE exemplar at `0065:69` shows the intended pattern — note that `0065:69` is the
*exemplar*, **not** the defect; an older backlog entry pointed there and sent readers to the wrong file.

**FR-HRD-042** — ~~Interactive record creation shall be idempotent under retry.~~
**REMOVED FROM THIS SPEC 2026-07-25. Deferred to its own spec.**

**Evidence** (still valid): idempotency exists only on the bulk-import path (`0072`/`0073`).

**Why it was pulled.** The planner correctly refused to plan it: one sentence with no AC, no named
entity, and no key transport is not a requirement, it is a wish. It needs four decisions first —
which entities are in scope; whether the key is a client-minted `client_request_id` or a natural key;
what counts as "a retry"; and whether a duplicate returns the existing row or raises `23505`. That is
a multi-table schema + RLS + FE-contract change and deserves its own spec and its own review.

Bundling it here would have produced either an invented design or a task nobody could execute.
Everything else in §4.6 is planned and stays.

**FR-HRD-043** ~~`spike-rls.yml` shall use `npm ci`, not `npm install`.~~ **SUPERSEDED 2026-07-28:** the spike and its workflow were deleted outright (owner-approved) — ADR-0036's §8, the only reason the lane was retained, closed 2026-07-03. The requirement is satisfied by removal; there is no longer a lane to install anything.

### 4.7 Each fix must fail before it passes

**NFR-HRD-001** Every defect in §4 shall be covered by a test that **fails against the unfixed code**.

> Non-negotiable for this batch specifically. Several of these defects are invisible to the existing
> suite precisely because the code swallows the signal — a test written after the fix can pass
> against both versions and prove nothing. Demonstrate red first.

---

## 5. Strand C — PostHog

### 5.1 Signals available under OD-OBS-1

With autocapture and replay off for real users, these three are still available and are the entire
unknown-unknown net for them:

| Signal | Config | Event | Billed? |
|---|---|---|---|
| Heatmaps, incl. **rage- and dead-click coordinates** (the only dead-click signal in use — see the row below) | `capture_heatmaps: true` | `$$heatmap` | **No** — does not count against the event allowance |
| Dead clicks (separate, autocapture-gated SDK producer) | `capture_dead_clicks: false` — **shipped disabled, reversing this table's original `true`; see §9 amendment 5** | `$dead_click` | N/A — not captured |
| Web vitals | `capture_performance: { web_vitals: true, network_timing: false }` | `$web_vitals` | Yes, samplable |

**FR-PHG-001** *(amended 2026-07-27/28, see §9 amendment 5 — `AC-CON-005`)* The client shall enable
heatmaps (including their always-on, coordinate-only dead-click detector, `{x, y, target_fixed,
type}`, folded into `$$heatmap`) and web-vitals capture for all users, with `network_timing` off.
The SDK's separate, autocapture-gated `capture_dead_clicks` producer (the `$dead_click` event) shall
remain **disabled** — it carries raw rendered element text (`$el_text`/`$elements_chain`/
`attr__title`), a leak surface none of the app's controls (`before_send`, `property_denylist`,
`buildEventProperties`) reach.

**FR-PHG-002** The client shall use `capture_heatmaps`, not the deprecated `enable_heatmaps`.
**Evidence:** `client.ts:143` currently sets `enable_heatmaps: false`, which is both deprecated and
the wrong value.

**FR-PHG-003** `capture_dead_clicks` shall be set **explicitly**.
**Evidence:** the docs claim a default of `true`, but the SDK type source declares `@default
undefined`, which defers to remote project config. Relying on the documented default risks capturing
nothing.

**FR-PHG-004** (conditional) Where `$pageleave` is wanted, `capture_pageleave` shall be set explicitly.
**Evidence:** its default is `'if_capture_pageview'`, so the existing `capture_pageview: false` has
**silently disabled `$pageleave` as well**.

> Deliberately **not** pursued: `$rageclick` as a queryable event. It is emitted from inside the
> autocapture code path and is unreachable with `autocapture: false`. The heatmap path performs its
> own rage detection and yields coordinates unbilled — that is the available substitute, and it is
> enough to answer "where do people rage-click", just not via a trend query.

**Confirmed against the pinned dependency, 2026-07-25.** The claims above were re-checked in
`node_modules/@posthog/types/dist/posthog-config.d.ts` at the installed `posthog-js@1.396.6` — not
against the published docs, which disagree on one of them:

| Option | Installed type says | Consequence |
|---|---|---|
| `capture_dead_clicks` | `@default undefined` | The **docs claim `true`**. Trusting the docs would capture nothing, since `undefined` defers to remote project config. FR-PHG-003 stands. |
| `capture_pageleave` | `@default 'if_capture_pageview'` | `$pageleave` is silently off today because `capture_pageview: false`. FR-PHG-004 stands. |
| `capture_heatmaps` | `@default undefined` | — |
| `enable_heatmaps` | `@deprecated Use capture_heatmaps instead.` | The current config sets the deprecated name, to `false`. FR-PHG-002 stands. |

All options named in this spec exist in 1.396.6; no upgrade is required.

**Verification requirement:** `$dead_click` properties are assembled by the autocapture property
extractor and may carry element text. Before enabling on real users, capture one live event and
confirm `mask_all_text` strips it. Do not assume.

### 5.2 Friction instrumentation — instrument at the funnel, not the form

**FR-PHG-010** (event-driven) When a user is shown a mutation error, the system shall capture a
friction event carrying a stable `reason_code`.

**FR-PHG-011** The instrumentation point shall be `classifyMutationError`
(`src/lib/classifyMutationError.ts:27`), not `useEntityForm`.

**Rationale — and the trap this avoids.** `save_failed` is currently **inert**. Two independent
conditions must both hold and neither does:

1. No caller anywhere in `src/` or `pages/` passes `entityType` to `useEntityForm`
   (verified by search; the only `entityType` hits are an unrelated local in `EmptyState.tsx` and the
   analytics builder's own parameter).
2. The hook's catch only runs if `onValid` throws — but every form's submit callback catches its own
   error and calls `onError(err)` **without rethrowing** (e.g. `pages/Companies.tsx:421-429`).

So the obvious fix — pass the missing `entityType` prop — **would still produce zero events**, and
the still-empty chart would look like a product fact rather than a broken fix.

`classifyMutationError` has **161 call sites across 25+ files** (hooks, DAL, export/import, adapter
dispatch) versus 17 entity forms. It already extracts the error `code`. Instrumenting there:

- is one site instead of ~17, and a new form cannot forget to opt in;
- captures errors that never touch a form at all;
- is by construction "errors the user was actually shown", which is the friction signal itself.

**FR-PHG-012** `permission_denied_seen` shall either be wired to a real call site or removed along
with its dashboard tile.
**Evidence:** zero call sites; a tile is provisioned for it.

**FR-PHG-013** (ubiquitous) No provisioned dashboard tile shall depend on an event that has no call site.

**AC-PHG-010**
- **Given** a mutation that fails with a PostgREST error,
- **When** the user is shown the error,
- **Then** exactly one friction event is captured with the correct `reason_code`, and no PII appears
  in its properties.

**AC-PHG-013**
- **Given** the dashboard provisioning script,
- **When** a CI check cross-references every tile's event name against the capture call sites,
- **Then** any tile whose event has no call site fails the check.

> AC-PHG-013 is the generalised fix. Fixing `save_failed` and `permission_denied_seen` by hand
> resolves today's two instances; the check is what stops the third.

### 5.3 Demo funnel

**FR-PHG-020** The demo funnel shall be answerable end-to-end from captured events: land → persona
selected → login → first module opened → last module before exit.

**FR-PHG-021** A dashboard shall present that funnel, using the existing `demo_persona_selected`,
`auth_login_succeeded` and `app_route_viewed` events.

> `demo_persona_selected` and `coming_soon_clicked` currently have **no provisioned tile** despite
> firing — free signal already being collected and never looked at.

### 5.4 Quota safety

**FR-PHG-030** (state-driven) While consumption of any PostHog free allowance exceeds 80%, the system
shall alert the owner.

**FR-PHG-031** The quota check shall read `GET /api/projects/:project_id/quota_limits/`
(personal API key, `project:read` scope), which returns `usage` and `limit` per resource.

**Rationale.** Exceeding a free allowance is **destructive, not billed**: PostHog stops ingesting and
the excess data is "lost forever". A mid-month quota stop would flatten every chart, and — the whole
point of this spec — that is indistinguishable from nobody using the product. PostHog's own 80%/100%
emails go only to the org owner and are easy to miss.

**FR-PHG-032** (owner action, not code) Error-tracking **rate limits** and **suppression rules** shall
be configured in PostHog project settings to bound exception ingestion below the 100k/month free
allowance.

> These drop *before* ingestion and are therefore unbilled, and the per-issue bucket means one
> runaway loop cannot consume the whole quota. This is strictly better than client-side filtering
> because it cannot be forgotten in a deploy. It is a settings change, not a code change.

**AC-PHG-030**
- **Given** a resource at ≥80% of its free allowance,
- **When** the quota check runs,
- **Then** it exits non-zero and names the resource, its usage and its limit.

### 5.5 Sizing (why quota is not the binding constraint)

At ~50 events per session, the 1M/month event allowance is ~20,000 sessions/month; replay's 5,000/month
is the tighter limit and is not being used for real users anyway. For a demo plus a handful of client
orgs this is large headroom. **The binding constraint on this program is privacy, not quota** — so the
posture is to capture the useful signals and guard them with a hard ceiling and an alarm, rather than
to under-capture pre-emptively.

Retention note: free-tier retention is 1 year for events but **30 days for session replay**.

---

## 6. Consent and privacy (OD-OBS-2)

**FR-CON-001** The client shall set `respect_dnt: true`.

**FR-CON-002** The app shall provide an in-app analytics opt-out control that persists across sessions.

**FR-CON-003** (event-driven) When a user opts out, the client shall call `posthog.opt_out_capturing()`,
which stops all capture including autocapture and replay.

**FR-CON-004** The `/privacy` page shall describe, in plain language, what analytics data is collected,
by whom it is processed, and how to opt out.
**Evidence:** `pages/Privacy.tsx` currently contains **zero** mentions of analytics, PostHog or cookies.

**FR-CON-005** No consent banner shall be added (OD-OBS-2).

**AC-CON-003**
- **Given** an app build where analytics is genuinely ENABLED (valid `phc_`-shaped key present),
- **And** a user who has opted out,
- **When** they navigate and trigger errors,
- **Then** no network request is made to the PostHog host, and the preference survives a reload.
- **And (control)** the same journey **without** opting out **does** produce a request to the PostHog
  host — proving the assertion is capable of failing.

> ⚑ **This AC was rewritten 2026-07-25 because its first form could never fail.** `config.ts:98`
> disables analytics entirely unless a valid `phc_`-shaped key is present, which is never the case in
> the e2e environment. So "no request to the PostHog host" passed **before any work was done**, and
> would have kept passing if the opt-out were deleted entirely. The control assertion is not optional
> garnish — it is the only thing that distinguishes "opt-out works" from "analytics was never on".
>
> This is the same defect class the spec exists to fix, found in the spec itself. Any AC asserting the
> *absence* of something must be paired with a positive control.

### 6.1 Existing privacy controls (preserve — do not regress)

These are already correct and must survive this work:

- `person_profiles: 'identified_only'` — identified events cost up to 4× anonymous ones.
- `FORBIDDEN_PROPERTY_KEYS` (24 keys incl. `email`, `contract_value`, `notes`, `query`) — **throws in
  dev**, drops in production; also passed to the SDK as `property_denylist`.
- `redactExceptionText` — strips JWTs, query strings, bearer/`sk-` tokens, bare email addresses and
  32+ char high-entropy runs, then truncates to 2000 chars; wired as `before_send`.
- `search_used` sends `result_count`, never the query; `filter_applied` sends `option_count`, never
  the selected value.
- `distinct_id` is the user UUID, never the email.

**NFR-CON-001** Any new event shall route through `buildEventProperties` so the forbidden-key guard
applies. No direct `posthog.capture` calls (enforced today by an ESLint `no-restricted-imports` rule
making `client.ts` the only permitted importer of `posthog-js` — preserve it).

---

## 7. Traceability

| AC | Owning layer | Location |
|---|---|---|
| AC-OBS-010, AC-OBS-011 | Unit (Vitest) | `pmo-portal/src/lib/agent/errorEvent.test.ts` |
| AC-OBS-020, AC-OBS-021 | Integration (pgTAP) | `supabase/tests/` |
| AC-HRD-001 | Unit (Vitest) | telegram drain logic |
| AC-HRD-011 | Integration (pgTAP) | `supabase/tests/0160_alert_ops_tables_lockdown.test.sql` |
| AC-HRD-030 | CI gate | `scripts/check-nul-bytes.sh` |
| AC-HRD-031 | Unit / CI gate | — |
| FR-HRD-040, FR-HRD-041 | Integration (pgTAP) | `supabase/tests/` |
| AC-PHG-010 | Unit (Vitest) | analytics |
| AC-PHG-013 | CI gate | cross-reference tiles ↔ call sites |
| AC-PHG-030 | Unit (Vitest) | quota script |
| AC-CON-003 | E2E (Playwright) | one curated journey — genuinely cross-stack |
| AC-CON-005 | Unit (Vitest) | `pmo-portal/src/lib/analytics/client.test.ts`, `client.deadClickGate.test.ts` (real-SDK regression guard) |

Per ADR-0010 each AC has exactly one owning layer. Only AC-CON-003 warrants e2e: it asserts that no
network request leaves the browser, which cannot be proven at a lower layer.

---

## 8. Open questions for the owner

1. **`HEARTBEAT_URL` is unset in production**, so the alert-path heartbeat is a no-op. Configure a
   heartbeat monitor (BetterStack or equivalent), or accept that alert-path liveness is unproven?
2. **Telegram drain cadence is hourly.** For money write-through failures, is ~1h acceptable, or
   should the ERP-integration error codes alert faster?
3. **Retention of 90 days** for `error_events` — confirm, or name a different window.

> Director's working assumptions pending answers: 90-day retention, hourly cadence unchanged.
> `HEARTBEAT_URL` stays unset until the owner opts into an external monitor; the code path already
> exists and activates the moment the secret is set.

---

## 9. Amendments after planning (2026-07-25; extended 2026-07-28)

The plan (`docs/plans/2026-07-25-observability-analytics.md`) surfaced four defects in this spec at
planning time (items 1–4 below). A later spec-reviewer pass (2026-07-28), run after all 11 PRs had
already shipped, found two more defects that a review at Design+Plan time could not have caught — one
where the implementation diverged from the spec without an amendment (item 5), and one where the spec
itself asserted a capability absence that the shipped code disproved (the superseded paragraph at the
end). Recorded here rather than silently patched, because the *kind* of error matters more than the
fix.

1. **AC-CON-003 could never fail.** Rewritten in §6 with a mandatory positive control. **General rule
   adopted: any AC asserting the absence of a behaviour must be paired with a control proving the
   assertion can fail.** Applies to every future spec, not just this one.

2. **FR-HRD-042 was unplannable** and has been removed to its own future spec (§4.6).

3. **Nine FRs carried no AC id** — FR-OBS-001/002/003, FR-HRD-010/020/043, FR-PHG-001–004/020/021,
   FR-CON-001/002/004/005. The plan assigns `PROPOSED` ids that are direct restatements of the FR
   text with no invented behaviour. **Those ids are hereby ratified**; the plan is authoritative for
   their wording.

4. **AC-HRD-001's root cause is deeper than §4.2 stated.** The re-alert loop is not merely a discarded
   UPDATE result: the cooldown itself is derived from `error_events.notified_at`
   (`telegram-notify/index.ts:57-66`) — *the very column the failing stamp writes*. So a failed stamp
   both leaves the row unnotified **and** erases the evidence that would have suppressed the re-send.
   That circularity is why the loop is unbounded rather than merely noisy. The fix is a write-ahead
   `alert_send_log` recording the send attempt **before** the Telegram call, so cooldown state does
   not depend on the write that can fail.

5. **FR-PHG-001 was inverted by the implementation — correctly — with no spec amendment until now
   (2026-07-27→28, spec-reviewer pass).** The original FR-PHG-001 and this table said
   `capture_dead_clicks: true`. Building it, a capture against the **real** SDK (not a mock —
   `client.deadClickGate.test.ts`'s own header explains why a mocked assertion could never have
   caught this) showed that `capture_dead_clicks: true` enables a *separate*, autocapture-gated
   `$dead_click` producer carrying `$el_text` / `$elements_chain` / `attr__title` — the raw rendered
   text of the clicked element. Two live captures during the build returned **"MYR 4,250,000.00"**
   and **"Approve contract for Petronas Carigali"**. None of the app's existing controls reach it:
   `before_send` only touches `$exception_*` fields, `property_denylist` is exact-key matching (these
   keys are not denylisted), and `buildEventProperties` never runs — the SDK emits `$dead_click`
   directly, bypassing the app's facade entirely. Shipped as `capture_dead_clicks: false`
   (`client.ts:212`). **This does not lose the signal FR-PHG-001 actually wanted**: heatmaps run
   their own, unconditional, coordinate-only dead-click detector (`{x, y, target_fixed, type}`, no
   element text, folded into `$$heatmap`) — §5.1's first row. FR-PHG-001 and §5.1's table are
   restated above to require the heatmap-based detector only, with the autocapture-gated producer
   disabled. **`AC-CON-005`** (`client.test.ts:339`, `client.deadClickGate.test.ts:57`) is hereby
   **ratified** as the id covering this: `capture_dead_clicks` is explicitly `false`, proven against
   the real, unmocked SDK's own gating function rather than a mock that could never have caught the
   leak. Traceability: §7.

**Superseded 2026-07-28 (spec-reviewer pass) — the paragraph below asserted a capability absence that
was false; replaced with what the shipped test actually proves.** FR-HRD-041's pgTAP,
`supabase/tests/0163_automation_cap_race.test.sql`, uses `dblink` to drive a genuine **second**
Postgres session that holds the same `profiles`-row lock the cap trigger takes, and asserts a
concurrent `agent_automations` INSERT actually **blocks** on it (`55P03` under a short
`lock_timeout`) — a real two-session interleaving, not merely a structural inference that the lock
statement is present. The original draft of this test (`0162`, in the implementation plan's task B3)
carried the limitation this paragraph used to describe, and even cited
`supabase/tests/0151_timesheet_fence_concurrency.test.sql` as evidence `dblink` wasn't available —
while `0151` itself already used `dblink`. That citation was wrong twice over: `dblink` was already
enabled in this stack, and the file named as proof it wasn't was itself proof that it was. **A "known
limitation" note asserting an absent capability is worse than no note at all: nobody re-checks it, so
the real proof never gets written** — the same principle ADR-0066 states about undocumented blind
spots ("a net whose blind spots are undocumented gets trusted beyond its reach") applies here to a
*false* claim of no coverage, not just an undocumented gap. This is the second time this exact error
class has appeared in this program (the first was the plan's `0151`-citing paragraph above). Treat any
future "this stack lacks X" claim as unverified until re-checked against the current tree — never
carried forward from a previous draft.

---

## 10. ⚑ NEW SECTION (ui-implementer, 2026-07-28) — `/privacy` Discover-pass fixes: AC-CON-010/011/012

> **Added by the `fix/consent-surface` ui-implementer dispatch.** Another agent may be concurrently
> editing this file for a different item — this section is appended, self-contained, and does not
> modify anything above. If a merge conflict surfaces here, keep both additions; they are additive.

A rendered Discover pass over `/privacy` (the consent surface §6 specifies) found four defects, three
of them truthfulness problems: the page told the user something the code did not do. Fixes ratified
below; full narrative in `docs/decisions.md` `OD-CON-3`.

**AC-CON-010** (unit, Vitest — `src/components/legal/AnalyticsOptOutToggle.test.tsx`)
- **Given** the analytics opt-out control on `/privacy`,
- **When** a user clicks the visible label sentence (not just the 16px box),
- **Then** the control toggles exactly once — the label text IS the hit target, per every checkbox
  convention, not an unassociated sibling `<span>`.
- **And** the control's accessible name is the visible sentence itself (via `aria-labelledby`), never
  a separately-worded `aria-label` that duplicates the same words a screen reader would then read
  again as ordinary page content.

**AC-CON-011** (unit, Vitest — `src/lib/analytics/client.test.ts` for `getConsentState`;
`AnalyticsOptOutToggle.test.tsx` for the rendered three states)
- **Given** a browser with Do Not Track set (or a deployment with analytics not enabled at all),
- **When** `/privacy` renders the opt-out control,
- **Then** the control shows the accurate "not collecting" state and explains WHY (DNT vs.
  deployment-disabled vs. an explicit opt-out are three distinct, correctly-labelled states — not a
  boolean that can contradict the DNT disclosure sentence directly above it).
- Supersedes the implicit assumption in §6 that `hasAnalyticsOptedOut()` alone answers "is this
  browser's usage being sent" — it does not; `getConsentState` (client.ts) is now the single source
  of truth, checked in the same priority order `doInit`'s own guard uses.

**AC-CON-012** (e2e, Playwright — `e2e/AC-CON-012-no-third-party-on-consent-page.spec.ts`)
- **Given** a browser that has opted out of analytics (or simply loads the page at all),
- **When** it loads `/privacy`,
- **Then** it contacts ZERO third-party origins — not just PostHog (AC-CON-003's scope), but ANY
  undisclosed third party. Closes a real leak: Inter was loaded from
  `fonts.googleapis.com`/`fonts.gstatic.com` on every page, including `/privacy` itself, before any
  consent choice, and even for a fully opted-out session (the opt-out only ever gated PostHog, never
  the font fetch). Fixed by self-hosting Inter (`public/fonts/`, `index.css` `@font-face`); the
  `<link>`s are removed from `index.html`.
- **Positive control (required — the same rule §9 amendment 1 states):** the same test file proves
  (a) its own request-listener actually captures a real injected cross-origin request, and (b) an
  opted-IN session on the same 'consent' Playwright lane DOES attempt a third-party (PostHog)
  request — so "zero third-party requests" is never trivially true because nothing loaded at all.

**AC-A11Y-CHECKBOX-001** (unit, Vitest token-math — `src/components/ui/__tests__/checkboxBorderContrast.test.ts`)
**+ AC-VISUAL-CHECKBOX-001** (e2e, rendered computed-style — `e2e/AC-VISUAL-CHECKBOX-001-dark-contrast.spec.ts`)
- Dark `--input` (the `Checkbox` primitive's unchecked-state border, its ONLY visual indication)
  measured 2.13:1 against dark `--background` — below WCAG 1.4.11's 3:1 non-text floor. Raised to
  `240 4% 42%` (~3.36:1). Two layers because a token-math test cannot catch a Tailwind-cascade
  regression that a real render would — see `DESIGN.md`'s Accessibility posture section.

### Traceability addendum (extends §7)

| AC | Owning layer | Location |
|---|---|---|
| AC-CON-010 | Unit (Vitest) | `pmo-portal/src/components/legal/AnalyticsOptOutToggle.test.tsx` |
| AC-CON-011 | Unit (Vitest) | `pmo-portal/src/lib/analytics/client.test.ts`, `AnalyticsOptOutToggle.test.tsx` |
| AC-CON-012 | E2E (Playwright) | `pmo-portal/e2e/AC-CON-012-no-third-party-on-consent-page.spec.ts` |
| AC-A11Y-CHECKBOX-001 | Unit (Vitest) | `pmo-portal/src/components/ui/__tests__/checkboxBorderContrast.test.ts` |
| AC-VISUAL-CHECKBOX-001 | E2E (Playwright) | `pmo-portal/e2e/AC-VISUAL-CHECKBOX-001-dark-contrast.spec.ts` |
