# Feature: Agent usage ledger & per-user credits (batteries-included A, item 3)

> **Authority:** ADR-0043 (Accepted, 2026-07-03) is Related, not controlling — it names credits as
> "backlog batteries-included A item 3" and defers the design to this issue. ADR-0044 §6
> ("Credits — automation runs meter against the OWNER's balance") **IS binding here**: automations
> are a *consumer* of the balance this spec defines, and §6's shape (preflight at the RateGuard
> injection point; over-budget → no-start + notify) is normative for this spec's server-enforcement
> design, not merely descriptive. Where this spec and ADR-0044 §6 could be read to disagree,
> ADR-0044 wins — file an issue, don't ship the divergence. Related: ADR-0036 (deputy invariant +
> four ceilings), ADR-0039 (single LLM call site, caller-JWT deputy, untrusted-output boundary),
> ADR-0040 (`AgentRuntime` port), ADR-0041 (model-calling-action seam), ADR-0016/0017 (real-JWT +
> repository seam), ADR-0018 (soft-archive, N/A here — no soft-archivable row in this schema),
> ADR-0010 (test pyramid), ADR-0022 (PostHog — out of scope, item 4).
> Glossary: Assistant (deputy invariant), RateGuard (`supabase/functions/agent-chat/handler.ts`
> `HandlerDeps.rateGuard`, the existing injected/optional Gate-3 seam this spec activates).

## Overview

Every agent turn today calls a model with **no cost ceiling other than `MAX_TOOL_ROUNDS`** (D7,
handler.ts) — `RateGuard` exists as an injected interface (`agent-chat/handler.ts` Gate 3,
`agent-runtime-seam.spec.md` AR-OD-002) but is wired `undefined` in `index.ts`
(`// rateGuard: undefined (AR-OD-002 default — disabled in v1)`), and `compose-view/handler.ts`
carries the identical stub. No request's actual token/cost usage is ever recorded anywhere; the
`ModelResponse.usage` field (`prompt_tokens`/`completion_tokens`/`total_cost`, already surfaced on
`status` SSE events per issue 1) is read once for display and discarded.

This feature adds the storage + enforcement layer that makes usage real: **(a)** an `agent_usage`
table — one row per model-calling request, capturing what it cost; **(b)** a per-user **credit
balance** — an admin-grantable ledger with a computed spent-vs-granted check; **(c)** **server-side
enforcement at the existing `RateGuard` injection point**, before the model call, so an over-budget
user gets a clean typed error instead of a silently-billed request; **(d)** the panel UX for the
over-budget state; **(e)** the untrusted-usage-value hardening the issue-1 cross-family security
audit flagged as binding for every future consumer of `ModelResponse.usage`.

**User value:** *As the operator of a single-tenant deployment, I want to see what the assistant is
costing per user and cap it, so a runaway loop or a chatty user can't blow an unbounded model bill —
and as a user, if I'm out of budget I want a clear message, not a silent failure or an unexplained
429.*

**Pricing strategy is explicitly deferred** — this issue builds the **mechanism** (ledger + balance
+ enforcement seam), not policy (what a credit costs, what the default grant is, tiered plans). The
schema and enforcement are pricing-agnostic by design (see FR-AUC-008).

This is the whole of backlog "batteries-included A" item 3. PostHog events (item 4), automations
(ADR-0044 — a *consumer* of this balance, not built here), widgets/ask-user (ADR-0045), and any
admin UI for granting credits are explicitly out of scope (see Out of Scope).

---

## Design choices (recorded per the dispatch brief)

**Balance shape — a `credits` ledger table + a computed spent-vs-granted check (not a single mutable
counter column).** Two candidates were weighed:

1. **A single `profiles.credit_balance numeric` column, decremented per request.** Rejected: a
   mutable running total invites a read-then-write race under concurrent requests (two turns firing
   near-simultaneously can both read the pre-decrement balance and both pass a check that should
   have blocked the second), and it destroys the audit trail — there is no way to see *how* a user
   arrived at their current balance without a separate log anyway (which is exactly the
   `agent_usage` table this spec already needs). It also can't represent an admin grant as a
   distinguishable event (grants and spend become indistinguishable deltas on the same column).
2. **A `credits` grants ledger (append-only, admin-authored rows) + `agent_usage` spend ledger
   (append-only, one row per request) + a *computed* balance = `sum(credits.amount) −
   sum(agent_usage.cost)` (chosen).** Both source tables are already append-only-by-nature (a grant
   is an event; a usage row is a request record) — the balance is a `SUM` view/query over both, never
   a value that can drift out of sync with its inputs. This mirrors the codebase's existing
   preference for derived-not-stored aggregates (e.g. the Reserved-budget layer, ADR-0034:
   `Available = Budget − Committed − Reserved`, computed, not cached) and for append-only audit logs
   (`procurement_status_events`, `agent_events`) over mutable counters. The race is closed for free:
   the preflight check (FR-AUC-010) computes the balance **at check time** inside the same
   request, and a concurrency window (two simultaneous requests both reading a balance that permits
   them, both spending) is bounded by the per-request cost ceiling (`MAX_TOOL_ROUNDS` × the model's
   `max_tokens`) — an acceptable v1 posture, **not** a hard real-time lock (see NFR-AUC-PERF-002 and
   Alternatives).

**Server writes usage rows — caller-JWT insert, like ADR-0043 §6 (decided, not left open).**
`agent_usage` rows are written by the `agent-chat`/`compose-view` edge functions under the **caller's
verified JWT**, exactly as `agent_runs`/`agent_events` are (ADR-0043 §6): "The `agent-chat` edge fn
writes … under the caller's JWT … `service_role` is never used on these tables — the deputy
invariant … is unchanged." The same reasoning applies verbatim: a usage row is metadata about the
caller's *own* request, RLS/owner-only is sufficient, and there is no reason to escalate privilege to
record it. (Automations, ADR-0044 §3, write under the *minted owner JWT* — still caller-JWT-shaped
from this table's perspective; §6 below.)

**`agent_usage.run_id`** references `agent_runs(id)` (issue 2's table) — a usage row is always
produced *by* a run (the request that triggered a model call). `run_id` is **nullable** only for the
narrow case of a model call that fails before a run row exists (see FR-AUC-004 note) — in practice
this should be rare once issue 2 is merged, since `createThreadAndRun` runs before the tool-loop.

---

## Functional Requirements

### Schema — `agent_usage` (per-request usage ledger)

**FR-AUC-001 — `agent_usage` table.**
The system shall provide an `agent_usage` table with `id`, `org_id` (not null, default seed-org —
the tenancy seam, ADR-0001), `owner_id` (not null, default `auth.uid()` — the spending user),
`run_id` (nullable, FK → `agent_runs(id)` on delete set null), `model` (not null text, the resolved
model id actually called), `prompt_tokens` (not null integer, default 0), `completion_tokens` (not
null integer, default 0), `cost` (not null numeric, default 0 — the request's `total_cost` in the
provider's currency unit, or 0 when the provider does not report cost), `created_at` (not null,
default `now()`).

**FR-AUC-002 — One row per model-calling request, not per tool round.**
The system shall insert exactly one `agent_usage` row per **model API call** (`modelClient.create()`
invocation) — i.e. once per tool-use round in the agent loop (`agent-chat/handler.ts`'s `for (let
round...)` and `runLoop`'s equivalent) and once per `compose-view` invocation — not once per SSE
event and not aggregated across a whole run. This keeps the ledger's grain aligned with what
`ModelResponse.usage` actually reports (one usage object per `create()` call).

**FR-AUC-003 — Usage values are clamped before persistence (untrusted input, binding).**
When persisting a usage row, the system shall clamp `prompt_tokens`, `completion_tokens`, and `cost`
each independently to `Number.isFinite(x) && x >= 0 ? x : 0` — a value from the model/provider
response that is `NaN`, `Infinity`, negative, or otherwise non-finite shall be stored as `0`, never
propagated as-is and never allowed to throw or block the write. (Carries forward the issue-1
cross-family security audit's binding finding: `ModelResponse.usage` values are provider-reported,
untrusted input.)

**FR-AUC-004 — `run_id` is set when a run exists at usage-recording time.**
Where the model call occurs inside an already-created `agent_runs` row (the normal case — issue 2's
`createThreadAndRun` runs before the tool loop begins), the system shall set `agent_usage.run_id` to
that run's id. Where no run row exists yet (e.g. persistence is flag-disabled per ADR-0043
FR-AGP-026, or a `compose-view` call that is not itself wrapped in an `agent_runs` row), `run_id`
shall be `null` — the usage row and its `cost`/tokens are still recorded; only the FK linkage is
absent. Usage recording is **not** gated behind the `agentAssistant`/persistence flag (FR-AUC-018)
even though `run_id` linkage is best-effort.

**FR-AUC-005 — Indexes.**
The system shall index `agent_usage (owner_id, created_at)` (the balance-computation + "my usage
history" hot path) and `agent_usage (run_id)` (the per-run cost rollup / debugging path).

### Schema — `credits` (admin-grant ledger)

**FR-AUC-006 — `credits` table.**
The system shall provide a `credits` table with `id`, `org_id` (not null, default seed-org),
`owner_id` (not null — the user the grant is *for*; no default, always explicit on insert since an
admin is granting to someone else), `amount` (not null numeric, `> 0` check — grants are always
positive; see FR-AUC-009 for how a grant differs from a deduction), `note` (nullable text — free-form
admin annotation, e.g. `"initial allocation"`, `"support comp"`), `granted_by` (not null, default
`auth.uid()` — the admin who made the grant), `created_at` (not null, default `now()`).

**FR-AUC-007 — Grants are append-only.**
The system shall permit `INSERT` and `SELECT` on `credits` but **no** `UPDATE`/`DELETE` by any role
other than a future explicit reversal mechanism (not built in v1 — see Out of Scope); a mis-issued
grant is corrected by issuing an equal-and-opposite negative-sum adjustment through the same
mechanism that creates grants (FR-AUC-009), never by editing or deleting the original row — this
keeps the ledger's audit trail intact (mirrors `agent_events`/`procurement_status_events` append-only
discipline).

**FR-AUC-008 — Pricing-agnostic units (deferred policy).**
`credits.amount` and `agent_usage.cost` share the same numeric unit (the spec does not name a
currency, a "1 credit = $X" rate, or a conversion factor — that is pricing policy, explicitly
deferred). The schema is unit-agnostic by construction: whatever unit an operator chooses (raw
provider cost in USD, a marked-up "credit" unit, a flat per-request charge computed some other way),
both tables use it consistently and the balance computation (FR-AUC-010) is unit-agnostic arithmetic
(`sum(amount) − sum(cost)`).

**FR-AUC-009 — A grant of negative or zero amount is rejected at the constraint level.**
Because `credits.amount` is `check (amount > 0)`, an admin correction that reduces a user's balance
is **not** expressible as a negative-amount `credits` row (that would violate the constraint) — it is
made by not issuing a further grant (the balance is `granted − spent`; there is no "ungrant" primitive
in v1). This is a deliberate simplicity choice for v1, not an oversight (see Out of Scope: admin
affordance).

### Balance computation & server-side enforcement (ADR-0044 §6, the RateGuard injection point)

**FR-AUC-010 — Computed balance = `sum(credits.amount) − sum(agent_usage.cost)`, scoped per owner.**

> **Amended by ADR-0049 / ops-admin-surface (FR-CRE-002):** the balance scope is now per-**ORG**
> (`org_id`), not per-owner — `(Σ credits.amount where org_id=X, regardless of owner_id) −
> (Σ agent_usage.cost where org_id=X)`, computed by the `org_credit_balance(p_org_id)` security-
> definer RPC. The per-owner wording above is the pre-org-pool baseline; a non-null `owner_id` is
> now BOTH historical attribution AND a live contribution to the org pool (no backfill).

The system shall compute a user's current credit balance as `(sum of that owner_id's credits.amount)
− (sum of that owner_id's agent_usage.cost)`, computed fresh at check time (never cached/stored) —
an owner with no `credits` rows has a balance of `0 − spent`, i.e. a negative balance (out of
budget) by default until an admin grants credits (v1 posture: no free default allowance is
schema-implied; whether an operator seeds a default grant per new user is a deployment/seed-data
decision, out of this spec's scope).

**FR-AUC-011 — Preflight enforcement at the `RateGuard` injection point, before the model call.**
The system shall implement the existing injected `RateGuard` interface
(`agent-chat/handler.ts`/`compose-view/handler.ts` `RateGuard.check(userId): Promise<{exceeded,
retryAfterSeconds}>`) with a **credit-backed** implementation: `check(userId)` computes the caller's
current balance (FR-AUC-010) and returns `exceeded: true` when the balance is `<= 0`. The handler's
existing Gate 3 (`if (deps.rateGuard) { const r = await deps.rateGuard.check(...); if (r.exceeded)
{...return...} }`) already runs this **before any `modelClient.create()` call** — no new gate is
added to `handler.ts`; this spec's implementation of `RateGuard` is wired into `index.ts` in place of
today's `undefined` (AR-OD-002/AS-OD-002 default flips from "off" to "on, credit-backed" — see FR-AUC-017).

**FR-AUC-012 — Over-budget returns a distinct typed error, not the generic 429 shape's ambiguity.**
When the credit-backed `RateGuard.check` reports `exceeded: true`, the handler's existing Gate-3
branch (`yield statusEvent('errored', { error: 'RATE_LIMITED', retryAfterSeconds })`) fires
unchanged at the wire level; this spec requires the credit implementation to additionally
distinguish the *reason* for the client (see FR-AUC-013) so "out of credits" and "too many
requests/minute" (a hypothetical future non-credit `RateGuard`) are not conflated in the UI, even
though both currently produce the same `RATE_LIMITED` SSE error code.

**FR-AUC-013 — `retryAfterSeconds` semantics for the credit case.**
Because a credit shortfall does not resolve itself after a fixed wait (unlike a request-per-minute
throttle), the credit-backed `RateGuard.check` shall return `retryAfterSeconds: 0` (or omit a
meaningful retry hint) when `exceeded` is due to insufficient balance, and the client (FR-AUC-016)
shall treat `retryAfterSeconds <= 0` on a `RATE_LIMITED` error as "out of credits" (not "come back in
N seconds") for copy purposes. (This is a client-side interpretation convention, not a new wire
field — see Open Questions for the alternative of adding an explicit `reason` field.)

**FR-AUC-014 — Enforcement runs per model-calling request, matching FR-AUC-002's grain.**
The preflight (FR-AUC-011) runs once per `agentChatHandler`/`runLoop` invocation entry (Gate 3, as
today) — i.e. once per HTTP POST / tool-round-loop-start, not once per individual tool round inside
an already-permitted loop. A user who starts a turn with a positive balance is not re-checked
mid-loop even if that turn's own spend exhausts the balance; the **next** turn (or the next
`req.decision` re-POST beginning a fresh `agentChatHandler` invocation) is where the now-negative
balance is caught. (A mid-loop rounds-based ceiling already exists and is unchanged: `MAX_TOOL_ROUNDS`,
D7 — this spec does not add a mid-turn abort-on-overspend; see Out of Scope.)

**FR-AUC-015 — `compose-view` uses the same `RateGuard` implementation.**
The `compose-view/handler.ts` `RateGuard` injection point (identical shape, currently also
`undefined` per `// rateGuard: undefined (AS-OD-002 default — disabled in v1)`) shall be wired to the
**same** credit-backed implementation and the **same** per-owner balance — a user's compose-view
calls and agent-chat calls draw from one shared balance, not two independent budgets.

### Panel UX — over-budget state

**FR-AUC-016 — Composer disabled + message on `RATE_LIMITED`/out-of-credits.**
When the panel receives a `status` event with `error: 'RATE_LIMITED'` (interpreted per FR-AUC-013 as
out-of-credits when `retryAfterSeconds <= 0`), the system shall disable the message composer (input +
send control) and display a clear, non-technical message (e.g. "You've used up your assistant credits
for now — contact your admin to request more.") in place of/alongside the composer, until the panel
is next reopened or the user's balance changes (no live balance polling in v1 — see Out of Scope).

**FR-AUC-017 — Feature-flag gating unchanged; enforcement gating is new and separate.**
The panel/edge-fn continue to be gated behind the existing `agentAssistant` flag
(`VITE_FEATURES_AGENT_ASSISTANT`) as today (unchanged). **Separately**, whether the credit-backed
`RateGuard` is wired in `index.ts` at all is controlled by a new, independent env toggle (e.g.
`AGENT_CREDITS_ENFORCED`, default value and exact name left to the eng-plan) — this lets an operator
run the assistant flag ON with enforcement OFF (today's effective behavior: `rateGuard: undefined`,
unlimited) during initial rollout, and flip enforcement on once grant seed-data exists for their
users, without a code change. Usage **recording** (FR-AUC-001..005) is unconditional and independent
of both flags — the ledger exists and fills regardless, so enabling enforcement later has historical
data to compute against immediately.

### Security — untrusted usage values (binding, from the issue-1 cross-family audit)

**FR-AUC-018 — No trust boundary crossed by the balance computation.**
The balance computation (FR-AUC-010) and the preflight (FR-AUC-011) read only `credits` (admin-authored,
already trusted) and `agent_usage.cost`/tokens (model-response-derived, but already clamped at
write time per FR-AUC-003) — no additional untrusted-input handling is needed at read time; the
clamp at FR-AUC-003 is the single point where the untrusted boundary is crossed and closed.

---

## Observed / legacy behavior to preserve (OBS)

**OBS-AUC-001 — `RateGuard` interface shape is unchanged.** `check(userId: string): Promise<{
exceeded: boolean; retryAfterSeconds: number }>` (`agent-chat/handler.ts` / `compose-view/handler.ts`)
is reused verbatim; this spec supplies an *implementation*, not a new interface.

**OBS-AUC-002 — Gate 3's position and control flow is unchanged.** The rate-guard check already runs
after Gate 2 (org/role lookup) and before Gate 3.5 (the decision branch) / the tool-use loop begins —
this spec activates that existing gate, it does not move it or add a new one.

**OBS-AUC-003 — `ModelResponse.usage` shape is unchanged (issue 1 baseline).** `prompt_tokens` /
`completion_tokens` / `total_tokens` / `total_cost?` (`_shared/modelClient.ts`) are read as-is; this
spec adds no new field to `ModelResponse` — it persists the existing fields (clamped) into
`agent_usage`.

**OBS-AUC-004 — `status` SSE events already carry usage fields.** The `completed` status event today
already includes `model`, `prompt_tokens`, `completion_tokens`, and optionally `total_cost` (handler.ts,
both the main loop and `runLoop`) — issue 1 baseline. This spec does not change what the client sees
on a successful turn; it adds server-side *persistence* of the same numbers and a *new* possible
`errored`/`RATE_LIMITED` status the client did not previously receive (because `rateGuard` was always
`undefined`).

---

## Non-Functional Requirements

### Security (OWASP / STRIDE)

- **NFR-AUC-SEC-001 — No `service_role` on `agent_usage`/`credits` reads or the caller's own usage
  writes.** `agent_usage` INSERT (the spend record) is written under the caller's JWT (deputy
  invariant, ADR-0036 §2, matching ADR-0043 §6's precedent) — never `service_role`. Verified by a
  deputy-invariant-style gate test (mirrors AC-AGP-018's shape).
- **NFR-AUC-SEC-002 — `credits` INSERT is Admin-only, server-enforced by RLS, not just UX.** A
  non-Admin caller's attempt to insert a `credits` row (for themselves or anyone) is denied by RLS —
  `can()`-style UX gating (ADR-0016) may additionally hide any future admin affordance, but RLS is
  the enforcement authority per the project's standing rule.
- **NFR-AUC-SEC-003 — `org_id` seam enforced server-side on both tables.** `org_id` is stamped via
  column default and re-verified by `WITH CHECK` on both `agent_usage` and `credits`; a client-supplied
  cross-org `org_id` is preserved (not silently rewritten) so it hits `WITH CHECK` and is denied
  (the `0015`/`user_views`/ADR-0043 pattern).
- **NFR-AUC-SEC-004 — Usage values are clamped before every persistence/metering use, not just once.**
  `Number.isFinite(x) && x >= 0` clamping (FR-AUC-003) applies at the single site that constructs the
  `agent_usage` insert payload — since the balance computation (FR-AUC-010) only ever reads
  already-clamped `agent_usage.cost` values, no second clamp is needed at read time, but a reviewer
  must confirm no future write path to `agent_usage.cost`/tokens bypasses this site.
  **NFR-AUC-SEC-004-EXT (adversarial-input hardening, binding — carried from the issue-1 audit
  scope note in the dispatch brief):** the clamp function shall treat a non-numeric type (string,
  object, array, `null`, `undefined`) identically to a non-finite number — coerced to `0`, never
  passed to `Number.isFinite` un-typechecked in a way that could throw or coerce unexpectedly (e.g.
  `Number.isFinite("5")` is `false`, correctly clamping a stringly-typed value to `0` rather than
  silently parsing it).
- **NFR-AUC-SEC-005 — The credit-backed `RateGuard.check` is a read-only preflight; it never mutates
  `credits`/`agent_usage` itself.** `check()` computes and returns a boolean; the actual `agent_usage`
  row for *this* request is written after the model call resolves (FR-AUC-002), by the normal
  persistence path — `check()` and the write are two different call sites, so a `check()` that is
  called speculatively/repeatedly (e.g. retried on a transient error) cannot itself inflate spend.
- **NFR-AUC-SEC-006 — No prompt/row content in logs.** Usage-recording and balance-check error paths
  follow the existing handler discipline (NFR-AR-SEC-005/NFR-AGP-SEC-005): logs on error carry
  counts/codes only, never token content or the user's message text.

### Performance

- **NFR-AUC-PERF-001 — Balance computation is indexed.** The `sum(...)` queries backing FR-AUC-010
  each hit `agent_usage (owner_id, created_at)` / a `credits (owner_id)` index (implicit from the
  owner-only RLS predicate; add an explicit index if the eng-plan's query plan shows a seq scan) —
  bounded cost per preflight check, not a full-table scan as usage grows.
- **NFR-AUC-PERF-002 — The balance check is eventually-consistent within a turn, not a hard lock
  (accepted v1 tradeoff).** Two concurrent requests from the same user can both pass the preflight
  before either's usage row is written (the race named in "Design choices" above) — bounded by the
  existing per-request cost ceiling (`MAX_TOOL_ROUNDS`), not eliminated by a `SELECT ... FOR UPDATE`
  or an atomic decrement. Acceptable for a single-tenant MVP; revisit (e.g. an advisory lock on
  `owner_id`, or a reservation-hold pattern) before the balance is relied on as a hard billing
  ceiling at multi-tenant scale.

### Accessibility (WCAG 2.1 AA)

- **NFR-AUC-A11Y-001 — Over-budget message is announced.** The composer-disabled state (FR-AUC-016)
  uses `role="status"`/`aria-live` consistent with the panel's existing status-announcement pattern
  (ADR-0043's `NFR-AGP-A11Y-001` precedent), so screen-reader users learn why the composer is
  disabled, not just see it visually greyed out.
- **NFR-AUC-A11Y-002 — Disabled composer remains a properly labeled, programmatically-disabled
  control** (`aria-disabled`/`disabled`, not merely visually dimmed), matching existing panel
  patterns.

---

## Acceptance Criteria

> Layer per ADR-0010: **pgTAP** for RLS/tenancy/append-only contracts and the balance computation's
> SQL correctness; **Unit** (Vitest, SDK+Supabase mocked) for the clamp function, the `RateGuard`
> implementation's decision logic, and panel composer-disable behavior; **E2E** — none required (no
> new cross-stack journey; the existing `AC-AR-*`/`AC-AGP-023` journeys already cross the stack, and
> an "out of credits" journey is adequately covered by the unit-layer `RateGuard` + panel tests per
> ADR-0010's "never push an AC up a layer" rule — this feature's cross-stack risk is fully captured
> without a dedicated Playwright spec). Each AC names its owning layer; the traceability table
> records the canonical owner.

### Schema & indexes

**AC-AUC-001 — `agent_usage` table exists with required columns. [pgTAP]**
Given the migration is applied,
When the schema is inspected,
Then `agent_usage` exists with `id`, `org_id`, `owner_id`, `run_id` (nullable, FK →
`agent_runs(id)`), `model`, `prompt_tokens`, `completion_tokens`, `cost`, `created_at` — exactly
FR-AUC-001.

**AC-AUC-002 — `credits` table exists with required columns and the positive-amount constraint.
[pgTAP]**
Given the migration is applied,
When the schema is inspected,
Then `credits` exists with `id`, `org_id`, `owner_id`, `amount` (`check (amount > 0)`), `note`,
`granted_by`, `created_at` — exactly FR-AUC-006 — and an `INSERT` of `amount <= 0` is rejected by the
check constraint.

**AC-AUC-003 — Required indexes exist. [pgTAP]**
Given the migration is applied,
When indexes are inspected,
Then `agent_usage (owner_id, created_at)` and `agent_usage (run_id)` both exist.

### RLS — tenancy & owner isolation

**AC-AUC-004 — Owner reads own usage rows; non-owner in the same org reads zero. [pgTAP]**
Given user A has an `agent_usage` row,
When user B (same org, not the owner) queries `agent_usage` for that row,
Then user B's query returns zero rows.

**AC-AUC-005 — Cross-org read returns zero regardless of role, including Admin. [pgTAP]**
Given user A (org 1) has an `agent_usage` row,
When a user in org 2 — including an org-2 Admin — queries for it,
Then zero rows are returned.

**AC-AUC-006 — A user can read their own `credits` grants; cannot read another user's. [pgTAP]**
Given user A has a `credits` grant,
When user A queries `credits`,
Then their own grant is visible; when user B (same org) queries, it is not.

**AC-AUC-007 — Only an Admin can INSERT a `credits` row; a non-Admin insert is denied. [pgTAP]**
Given a non-Admin authenticated caller,
When they attempt to `INSERT` into `credits` (for themselves or another user),
Then the insert is denied by RLS.

**AC-AUC-008 — `agent_usage` INSERT is owner-pinned; a spoofed `owner_id` is rejected. [pgTAP]**
Given an authenticated caller,
When they insert an `agent_usage` row with an explicit `owner_id` of another user,
Then the insert is denied by `WITH CHECK`.

**AC-AUC-009 — No `UPDATE`/`DELETE` on `credits` is permitted (append-only). [pgTAP]**
Given an existing `credits` row,
When any authenticated caller (including the granting Admin) attempts `UPDATE` or `DELETE` on it,
Then the operation is denied by RLS — mis-issued grants are corrected only by a new row (FR-AUC-007),
never by mutation.

### Balance computation

**AC-AUC-010 — Balance = granted minus spent, computed correctly. [pgTAP]**
Given a user has been granted 100 (one `credits` row) and has two `agent_usage` rows costing 10 and
15,
When the balance is computed (`sum(credits.amount) − sum(agent_usage.cost)` scoped to that owner),
Then the result is 75.

**AC-AUC-011 — A user with no grants has a balance of `0 − spent` (negative once any spend exists).
[pgTAP]**
Given a user has zero `credits` rows and one `agent_usage` row costing 5,
When the balance is computed,
Then the result is -5.

### Clamp / untrusted-value hardening

**AC-AUC-012 — Non-finite/negative usage values are clamped to 0 before persisting. [Unit]**
Given a `ModelResponse.usage` containing `prompt_tokens: NaN`, `completion_tokens: -3`, and
`total_cost: Infinity`,
When the usage-recording code constructs the `agent_usage` insert payload,
Then the persisted row has `prompt_tokens: 0`, `completion_tokens: 0`, `cost: 0`.

**AC-AUC-013 — Non-numeric usage values are clamped to 0, not coerced or thrown. [Unit]**
Given a `ModelResponse.usage.total_cost` of `"5"` (string), `null`, or an object,
When the usage-recording code constructs the `agent_usage` insert payload,
Then `cost` is persisted as `0` and no exception is thrown (NFR-AUC-SEC-004-EXT).

**AC-AUC-014 — A well-formed, valid usage value passes through unchanged. [Unit]**
Given `prompt_tokens: 120`, `completion_tokens: 45`, `total_cost: 0.0031` (all finite, non-negative),
When the usage-recording code constructs the `agent_usage` insert payload,
Then the persisted values equal the input values exactly (the clamp is a no-op on valid input).

### Server-side enforcement (RateGuard)

**AC-AUC-015 — A user with a positive balance is not rate-limited. [Unit]**
Given a user's computed balance is `> 0`,
When the credit-backed `RateGuard.check(userId)` is called,
Then it resolves `{ exceeded: false }`.

**AC-AUC-016 — A user with a zero-or-negative balance is rate-limited before the model call. [Unit]**
Given a user's computed balance is `<= 0`,
When `agentChatHandler` runs with the credit-backed `RateGuard` injected,
Then Gate 3 yields a `status` event `{ error: 'RATE_LIMITED' }` and `modelClient.create` is **never**
called (proving the preflight runs strictly before the model call, matching FR-AUC-011).

**AC-AUC-017 — The same enforcement applies to `compose-view`. [Unit]**
Given a user's computed balance is `<= 0`,
When `composeViewHandler`/`runComposeView`'s equivalent entry point runs with the same credit-backed
`RateGuard` injected,
Then it is denied identically (FR-AUC-015) — proving the shared balance/shared guard, not two
independent budgets.

**AC-AUC-018 — A usage row IS still recorded even when persistence (ADR-0043 flag) is off. [Unit]**
Given `deps.persistence` is `undefined` (ADR-0043 flag off) but the usage-recording call site is
reached,
When a model call completes,
Then an `agent_usage` row is still inserted (`run_id: null`, per FR-AUC-004) — proving usage
recording is independent of the thread/run/event persistence flag (FR-AUC-004/017).

### Panel UX

**AC-AUC-019 — Composer disables on `RATE_LIMITED` and shows the out-of-credits message. [Unit]**
Given the panel receives a `status` event `{ error: 'RATE_LIMITED', retryAfterSeconds: 0 }`,
When the panel renders,
Then the message composer is disabled (`aria-disabled`/`disabled`) and an out-of-credits message is
shown in a `role="status"`/`aria-live` region.

---

## Traceability

| AC | Owning layer | Owning test (name / file) |
|---|---|---|
| AC-AUC-001 | pgTAP | `AC-AUC-001 agent_usage table exists with required columns` (`supabase/tests/00XX_agent_usage_schema.test.sql`) |
| AC-AUC-002 | pgTAP | `AC-AUC-002 credits table exists, positive-amount constraint enforced` |
| AC-AUC-003 | pgTAP | `AC-AUC-003 required indexes exist` |
| AC-AUC-004 | pgTAP | `AC-AUC-004 non-owner same-org reads zero` (`supabase/tests/00XX_agent_usage_credits_tenancy.test.sql`) |
| AC-AUC-005 | pgTAP | `AC-AUC-005 cross-org read zero incl admin` |
| AC-AUC-006 | pgTAP | `AC-AUC-006 own grant visible, other user's grant not` |
| AC-AUC-007 | pgTAP | `AC-AUC-007 non-admin credits insert denied` |
| AC-AUC-008 | pgTAP | `AC-AUC-008 agent_usage insert owner-pinned, spoofed owner denied` |
| AC-AUC-009 | pgTAP | `AC-AUC-009 credits update/delete denied (append-only)` |
| AC-AUC-010 | pgTAP | `AC-AUC-010 balance equals granted minus spent` (`supabase/tests/00XX_agent_usage_credits_balance.test.sql`) |
| AC-AUC-011 | pgTAP | `AC-AUC-011 no-grant balance is negative spent` |
| AC-AUC-012 | Unit | `AC-AUC-012 non-finite negative usage clamped to zero` (`supabase/functions/agent-chat/usage.test.ts`) |
| AC-AUC-013 | Unit | `AC-AUC-013 non-numeric usage clamped to zero no throw` |
| AC-AUC-014 | Unit | `AC-AUC-014 valid usage passes through unchanged` |
| AC-AUC-015 | Unit | `AC-AUC-015 positive balance not rate-limited` (`supabase/functions/agent-chat/rateGuard.credits.test.ts`) |
| AC-AUC-016 | Unit | `AC-AUC-016 zero-or-negative balance blocks before model call` (`supabase/functions/agent-chat/handler.credits.test.ts`) |
| AC-AUC-017 | Unit | `AC-AUC-017 compose-view shares the same balance and guard` (`supabase/functions/compose-view/handler.credits.test.ts`) |
| AC-AUC-018 | Unit | `AC-AUC-018 usage recorded independent of persistence flag` |
| AC-AUC-019 | Unit | `AC-AUC-019 composer disables and shows out-of-credits message` (`pmo-portal/src/components/panel/AssistantPanel.credits.test.tsx`) |

---

## SoD & Security (OWASP / STRIDE)

**Spoofing / tenancy (STRIDE-S, OWASP A01 broken access control).** Both tables are `enable`+`force`
RLS. `agent_usage`: owner-only `SELECT`/`INSERT`, `org_id`/`owner_id` server-stamped via column
default + `WITH CHECK` re-pin (never client-trusted), identical posture to `agent_events`
(ADR-0043). `credits`: owner-only `SELECT` (a user sees their own grant history), **Admin-only**
`INSERT` (a genuinely new RLS shape not yet present on any agent-family table — reviewed at full
depth per the Depth note below), no `UPDATE`/`DELETE` for anyone.

**Tampering (STRIDE-T, OWASP A01/A08).** `credits` is append-only by RLS policy (no `UPDATE`/`DELETE`
policy exists for any role) — a mis-issued grant cannot be silently altered or removed; correction is
a new, auditable row. `agent_usage` rows are written once at request-completion time by the server
(no client-supplied `cost`/token fields are ever accepted directly from the browser — the browser
never calls the `agent_usage` insert; only the edge function does, using the provider's own
`ModelResponse.usage`, clamped).

**Elevation / deputy invariant (STRIDE-E, ADR-0036 §2).** `agent_usage` INSERT and the balance-check
read both run under the caller's JWT — no `service_role` (NFR-AUC-SEC-001). The one place a *future*
admin-grant UI (out of scope v1) would need Admin-role RLS, not `service_role`, to insert `credits` —
recorded here so a v2 admin affordance does not reach for `service_role` out of convenience.

**Denial of Service / cost exhaustion (the feature's actual threat model).** This is the primary risk
this spec closes: today, nothing stops a runaway loop or a single chatty user from generating
unbounded model spend beyond the existing `MAX_TOOL_ROUNDS` per-turn cap. The credit-backed
`RateGuard` (FR-AUC-011) closes the **cross-turn** exposure (a user can't start turn after turn once
their balance is exhausted); NFR-AUC-PERF-002 records the accepted **intra-turn / concurrent-request**
residual risk (bounded by `MAX_TOOL_ROUNDS`, not eliminated) as a v1 tradeoff, not an oversight.

**Injection (OWASP A03).** No new user-controlled string is interpolated into SQL; usage/grant writes
go through parameterized PostgREST inserts. The clamp (FR-AUC-003/NFR-AUC-SEC-004) is the only
place untrusted provider-reported numeric data crosses into a stored value, and it is a pure
arithmetic/type check, not string handling.

**Repudiation (STRIDE-R).** `agent_usage` (append-only in practice — no code path updates it after
insert, though not trigger-enforced like `agent_events`; see Open Questions) and `credits`
(RLS-enforced append-only) together **are** the billing audit trail — what was spent, by whom, and
what was granted, by whom.

**Depth note (model-tiering).** This change introduces the family's **first Admin-only INSERT RLS
policy** (every prior agent-family table, per ADR-0043, is strictly owner-only with no role-based
branch) and a DoS/cost-exhaustion threat model that is new to this family — the security-auditor
should run at full depth on the migration + both `RateGuard` wiring sites (`agent-chat/index.ts`,
`compose-view/index.ts`), not a light pass, per the dispatch brief's explicit security emphasis.

---

## Error Handling

| Error condition | Surface / code | User message |
|---|---|---|
| Balance `<= 0` at turn start | SSE `status` event `{ error: 'RATE_LIMITED', retryAfterSeconds: 0 }` (Gate 3, unchanged wire shape) | Composer disabled; "You've used up your assistant credits for now — contact your admin to request more." |
| Non-Admin attempts to insert `credits` | RLS `42501` (zero rows / policy violation) | N/A — no client code path attempts this in v1 (no admin UI shipped); a direct API call is denied silently by RLS. |
| Provider returns non-finite/negative/non-numeric usage | Clamped to 0, logged (count only) | No user-visible error — the turn completes normally; only the recorded cost/tokens are zeroed, never blocking the response. |
| `agent_usage` insert fails (transient DB error) | Logged, swallowed (mirrors ADR-0043 persistence discipline) | Turn completes normally; that one request's spend is simply not recorded (fails open, not closed — a missed usage row under-counts spend rather than blocking a user; accepted v1 tradeoff, not a billing-grade guarantee). |
| `run_id` FK target missing (run row not yet created / persistence off) | `run_id` stored as `null` (FR-AUC-004) | No error — usage is still recorded. |

---

## Implementation TODO

### Backend (migration + RLS + pgTAP)

- [ ] Migration `0047_agent_usage_credits.sql` (**0046 is taken by issue 2's `agent_persistence`
      migration** — confirm against `main`/`dev` at build time per the Companies/`user_views`
      precedent of letting the eng-plan pick the exact number): create `agent_usage`, `credits`
      exactly per FR-AUC-001/006; the two indexes (FR-AUC-005); `enable`+`force` RLS; owner-only
      `select`/`insert` on `agent_usage` (`with check` re-pins owner_id/org_id, and — mirroring
      `agent_events_insert`'s symmetric FK-ownership guard, ADR-0043 §2 — additionally verifies
      `run_id` (when non-null) belongs to a run the caller owns); owner-only `select` + Admin-only
      `insert` on `credits` (no `update`/`delete` policy for any role — append-only by omission,
      matching the `credits` FR-AUC-007 requirement); the `amount > 0` check constraint.
- [ ] pgTAP: `agent_usage_credits_schema.test.sql` (AC-AUC-001..003), `agent_usage_credits_tenancy.test.sql`
      (AC-AUC-004..009, mirrors `0092_agent_persistence_tenancy.test.sql` shape), `agent_usage_credits_balance.test.sql`
      (AC-AUC-010/011).

### Backend (edge-fn usage recording + RateGuard implementation)

- [ ] `supabase/functions/_shared/usage.ts` (or `agent-chat/usage.ts`): the clamp function
      (FR-AUC-003/NFR-AUC-SEC-004-EXT) + the `agent_usage` insert helper, caller-JWT (mirrors
      `persistence.ts`'s style: swallow-and-log errors, never block the turn).
- [ ] Wire the usage-insert call at the single site each handler already reads `resp.usage` (the
      `completed`/`length` status-event branches in `agent-chat/handler.ts`'s main loop AND
      `runLoop`, plus `compose-view/handler.ts`'s equivalent) — one insert per `modelClient.create()`
      resolution (FR-AUC-002), independent of the ADR-0043 persistence flag (FR-AUC-004/018).
- [ ] `supabase/functions/_shared/creditRateGuard.ts` (or similar): implements the `RateGuard`
      interface, computing the balance (FR-AUC-010) and returning `{ exceeded, retryAfterSeconds: 0
      }` per FR-AUC-011/013.
- [ ] `agent-chat/index.ts` + `compose-view/index.ts`: replace `rateGuard: undefined` with the new
      credit-backed guard, gated by the new `AGENT_CREDITS_ENFORCED` env toggle (FR-AUC-017; default
      value TBD by the eng-plan).
- [ ] Unit tests: `usage.test.ts` (AC-AUC-012..014), `rateGuard.credits.test.ts` (AC-AUC-015),
      `handler.credits.test.ts` (AC-AUC-016/018), `compose-view/handler.credits.test.ts` (AC-AUC-017).

### Frontend (panel UX)

- [ ] `useAssistantPanel`/`AssistantPanel`: on receiving `{ error: 'RATE_LIMITED', retryAfterSeconds:
      0 }`, disable the composer and render the out-of-credits message (FR-AUC-016, AC-AUC-019).
- [ ] No new repository/DAL needed in v1 (no client-facing "my balance" read is in scope — see Out of
      Scope; the *only* client-observable effect of a low balance is the disabled composer on the
      next turn attempt).

### E2E / gates

- [ ] No new curated Playwright spec required (ADR-0010 "lowest sufficient layer" — see Acceptance
      Criteria preamble). If a future audit finds this judgment wrong, add one `AC-AUC-0XX` e2e
      journey then, not speculatively now.
- [ ] Full `npm run verify` before PR; render the panel's disabled-composer state before
      promote — MEMORY durable rule (rendered-review-catches-what-tests-pass).

---

## Out of Scope (deferred)

- **Pricing strategy** — what a credit costs, default grant size, tiered plans, currency/unit naming.
  Explicitly deferred per the dispatch brief; this spec builds the mechanism only (FR-AUC-008).
- **Admin affordance for granting credits (v1).** Grants are made via SQL/seed data directly against
  `credits` in v1 (the dispatch brief's explicit instruction) — no admin UI, no `create_credit_grant`
  `AgentAction`. A future issue adds a UI list/form once the mechanism here is proven.
- **Grant reversal / negative adjustment primitive.** FR-AUC-009 records why this is deferred
  (`amount > 0` constraint, no "ungrant" row type in v1).
- **A client-facing "my balance" display.** The panel reacts to a `RATE_LIMITED` error reactively
  (FR-AUC-016); there is no proactive "42 credits remaining" indicator in v1. (A natural follow-up
  once an admin UI exists to make the number meaningful to a user.)
- **Automations' consumption of this balance (ADR-0044 §6).** ADR-0044 §6 already specifies
  automations meter against the *owner's* balance at the same `RateGuard` injection point and
  no-start + notify on exhaustion — this spec builds the balance/guard that ADR-0044's automations
  issue will *call*; wiring the dispatcher to it is that later issue's work, not this one's.
- **PostHog usage/spend analytics events (batteries-included A item 4).** Not built here; a later
  issue's scope per the backlog.
- **A hard real-time concurrency lock on the balance check.** NFR-AUC-PERF-002 records the accepted
  v1 race window; a `SELECT ... FOR UPDATE`/advisory-lock/reservation-hold upgrade is deferred until
  needed.
- **Per-model or per-action differentiated pricing/weighting.** `cost` is whatever the provider
  reports (or 0); this spec does not add a markup or per-action multiplier layer.
- **A dedicated curated e2e journey for the out-of-credits path.** Judged adequately covered at the
  unit layer per ADR-0010 (see Acceptance Criteria preamble); revisit if a real defect surfaces there
  that only a cross-stack test would have caught.

---

## Contradictions / conflicts flagged against existing code & locked decisions

None found. ADR-0044 §6 is Accepted and controlling for the enforcement shape (preflight at the
`RateGuard` injection point, over-budget → no-start + notify for automations specifically); this spec
extends the same mechanism to interactive use (the case ADR-0044 itself assumes already exists: "the
existing `RateGuard` injection point"). No existing ADR or spec assigns a different shape to the
balance or a different write path to usage rows — `RateGuard` was always designed as an injectable,
initially-disabled seam (AR-OD-002/AS-OD-002) precisely so a real implementation could be dropped in
later without a rewrite; this spec is that drop-in.

One naming note, not a contradiction: this spec's `agent_usage` table name matches the dispatch
brief's SCOPE (a) verbatim; ADR-0043/0044 do not name it (they only anticipate its existence:
ADR-0043 Related list, ADR-0044 §6 "backlog batteries-included A item 3").

## Open Questions

1. **Exact migration number** — assumed `0047_agent_usage_credits.sql` (0046 is issue 2's
   `agent_persistence`; confirmed taken by reading the current `feat/agent-persistence` branch state
   at spec time). The eng-plan confirms against `main`/`dev` at build time, per the
   Companies/`user_views`/ADR-0043 precedent of leaving exact numbering to the plan.
2. **`RATE_LIMITED` reason disambiguation** — FR-AUC-013 proposes a client-side convention
   (`retryAfterSeconds <= 0` ⇒ "out of credits") rather than a new wire field, to avoid touching the
   `AgentEvent`/SSE status-event shape (which issue 1/ADR-0040 established and issue 2 already
   extends with persistence fields). If a future non-credit `RateGuard` (a request-per-minute
   throttle) is ever added alongside this one, an explicit `payload.reason: 'credits' | 'throttle'`
   field would be cleaner — deferred until that second `RateGuard` implementation actually exists
   (YAGNI), not designed speculatively now. Flagging for the eng-plan/owner to confirm this
   convention-over-field tradeoff is acceptable before build.
3. **`AGENT_CREDITS_ENFORCED` default value** — FR-AUC-017 leaves the toggle's default (on vs. off)
   to the eng-plan. Recorded here as a decision the plan must make explicit (not silently pick):
   defaulting **off** matches today's `rateGuard: undefined` behavior (safest for not breaking an
   existing deployment with no seeded grants — everyone would otherwise go instantly to balance `0`,
   locking out all users); defaulting **on** is safer against runaway cost but requires seed-data
   discipline. Recommend **off by default**, flipped on deliberately once an operator has granted
   initial balances — but this is the eng-plan's/owner's call, not pre-decided here.
4. **Whether `agent_usage` needs its own append-only trigger** (like `agent_events`'s
   `agent_events_feedback_only` trigger) or whether "no `UPDATE`/`DELETE` policy exists" is
   sufficient. Since no FR in this spec requires ever updating a usage row (unlike `agent_events`'
   feedback columns), the simpler "omit the policy" approach (RLS default-denies any verb with no
   matching policy) is assumed sufficient and no trigger is planned — flagging in case the eng-plan's
   security pass judges a defense-in-depth trigger worthwhile anyway.
