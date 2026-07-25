# ADR-0062 — Money-write UI is decoupled from the ERP push (enqueue-now, reflect-status-async)

> Number reconciled by the Director 2026-07-24: authored provisionally as ADR-0060 on a stale-base
> worktree; renumbered to **0062** against `origin/dev` (0061 = integration-enablement-model is the
> current ceiling; note dev carries a pre-existing triple-0059 collision, untouched here).

- **Status:** Proposed (Director, eng-planner phase, 2026-07-24). **Owner sign-off required** (changes the
  write-semantics of every money flow — a spec-level decision).
- **Date:** 2026-07-24
- **Deciders:** Director (eng-planner phase); owner at spec sign-off.
- **Related:** **ADR-0055** (external-system adapters — SoT/enhancement; §4 synchronous write-through — this
  ADR narrows §4 for outbox-backed money flows), **ADR-0058** (`external_command_outbox` + `erpnext-sweep`
  eventual-consistency backstop — the durable hand-off this UI leans on; referenced, not modified),
  **ADR-0056** (ClickUp pending-push composed at the surface, not the repository return type — the
  precedent this generalizes), ADR-0017 (repository seam), ADR-0016 (`can()` UX-only, RLS is authority),
  ADR-0001 (`org_id` seam), ADR-0010 (test pyramid). Spec:
  `docs/specs/decouple-money-ui-from-erp-push.spec.md`.
- **Scope:** the FE/UI write-semantics of money flows that push to ERPNext (budget activate, sales-invoice
  submit, payment-entry submit, procurement transition, timesheet submit). **NOT in scope:** the outbox
  table / sweep / `get_budget_push_status` (ADR-0058); the tactical client+server timeout (separate issue,
  reclassified here as a safety net); ERPNext API mapping.

## Context

Money-write UI actions that push to ERPNext synchronously **`await` the push inline in the mutation** and
block the surface on it. Concretely, `src/lib/db/budgets.ts::activateAndPush` → `dispatchDomainCommand` →
the `adapter-dispatch` edge fn: the confirm dialog stays open with disabled buttons until the push resolves.
When ERPNext is slow or down, the UI **freezes** — the PMO-side write (durable and complete on its own) is
not acknowledged until the ERP round-trip returns. This broke CI e2e AC-732; in production it means a down
ERPNext freezes budget activation and every sibling money flow (SI/PE submit, procurement, timesheet).

The machinery to NOT block already exists. ADR-0055 §6 keeps budget **versions** PMO-side (durable local
truth); ADR-0058's `external_command_outbox` + `erpnext-sweep` **own eventual consistency** — the push is
guaranteed to land (or surface `failed`) whether or not the UI waits. `get_budget_push_status` + the push
mirror already expose the async status, and the P0 shared pending-push behavior
(`pmo-portal/src/lib/adapterSeam/pendingPush.ts`) + `TaskPushBadge` are the presentational precedent for
showing a push state without a modal. So the UI is waiting on a round-trip whose delivery is already
guaranteed by other machinery — pure downside, no upside.

A tactical client+server timeout is being added separately. A timeout **caps** the freeze; it does not
remove the freeze **class** — every synchronous-await money flow still couples its acknowledgement to ERP
reachability, just with a ceiling. This ADR removes the class.

## Decision

**1. The money-write UI is decoupled from the ERP push. The PMO-side write is instant and durable; the push
is enqueued and its status reflected asynchronously.**

For each money flow (F1 budget-activate, F2 SI-submit, F3 PE-submit, F4 procurement-transition, F5
timesheet-submit):

- The mutation performs the **PMO-side durable write** (the `activate_budget_version` RPC; the outbox
  hand-off for document-only flows) and **resolves on that outcome alone** — it never `await`s
  `adapter-dispatch` on the mutation path.
- The ERP push is **enqueued onto `external_command_outbox`** (ADR-0058). The `erpnext-sweep` drains it and
  reconciles the ERP answer into the read-model. The FE does not participate in delivery.
- **No PMO action's success is gated on ERP reachability.** A down/slow ERPNext leaves money actions fully
  responsive; only the *push status* is `queued`/`pushing` longer.

**2. Blocking `await push` on the mutation path is an anti-pattern — banned for money flows.** The confirm/
submit surface closes (or re-enables) on the PMO-side write outcome, never remaining open+disabled pending
the push. A PMO-side write failure is surfaced via `classifyMutationError` unchanged; it is not a push
failure and is not enqueued.

**3. Push status is an async, non-blocking indicator — composed at the surface, not the mutation return
type (generalizing ADR-0056 decision 2).** A `MoneyPushBadge` (generalizing `TaskPushBadge`) reads the push
status (`queued`/`pushing`/`pushed`/`failed`/`held`) from `get_budget_push_status` / the outbox status —
**not** from the write-request lifecycle. It renders label+icon (never color-only), converges after the
sweep with no user write, and offers a single manual "retry push" (re-enqueue) from `failed`/`held`. Orgs
that do not employ ERPNext, and PMO-owned-only records, render **no badge and issue no poll** — byte-for-byte
the pre-rewire UI. The DAL/repository signatures do not thread push state to non-ERPNext callers.

**4. Money-honesty: the four-fact fence.** The UI keeps four facts distinct and never announces a push that
did not happen: (1) PMO-side write happened (local truth — "Version activated" / "Submission queued"); (2)
push queued/in-flight (NOT ERP-confirmed); (3) push confirmed by ERPNext (`pushed` — the only state that may
assert ERP acceptance); (4) push failed/held. Document-only flows (SI/PE) announce **"queued"**, never
"submitted", until status is `pushed`. **Only the sweep may set the terminal `pushed`** (single-writer-of-
truth, ADR-0055 §3) — the client never marks `pushed`.

**5. The tactical timeout becomes a safety net, not the mechanism.** With the push off the mutation path,
the client+server timeout no longer governs UI responsiveness (nothing on the UI path awaits the push). It
remains as a bound on the outbox-drain / sweep push attempt — defense in depth against a hung ERP call
inside the async worker, not the thing that keeps the UI unfrozen.

### Relationship to ADR-0055 §4

ADR-0055 §4 ("synchronous write-through … external system down ⇒ writes to its domains fail honestly")
described the **P0/P2 pre-outbox** semantics and the ClickUp task path (where the adapter commit is the
durable act). This ADR **narrows §4 for the ERPNext money flows that ADR-0058's outbox now backs**: the
durable act is the PMO-side write + the outbox enqueue, so "fail honestly on ERP-down" becomes "succeed the
PMO-side write, show the push as `queued`, and let the sweep deliver". The SoT rule, the enhancement/read-
model rule, and single-writer-of-truth are all unchanged — only *when the UI stops waiting* changes.
ClickUp task writes (no outbox; synchronous pending-push) are unaffected and keep the ADR-0056 path.

## Migration path (which flows convert first)

1. **F1 budget-activate converts first** — the diagnosed freeze (AC-732), and the only flow with
   `get_budget_push_status` + a push mirror already in place. It is the reference conversion; its
   `MoneyPushBadge` + surface wiring is the template.
2. **F2–F5 (SI/PE submit, procurement transition, timesheet submit)** follow the identical pattern as a
   tracked fast-follow — each gets its own curated e2e journey (the "queued, not submitted" honesty AC per
   flow). Recommended as separate issues so each carries its own acceptance proof; the Director to confirm
   whether they ride this issue or fast-follow.
3. **Adjacent same-class flows** (party-master create, sales orders) MUST adopt the pattern when they land —
   they must not reintroduce a blocking `await` on the money-write path.

## Consequences

- **The freeze class is removed, not just capped.** A down/slow ERPNext can never freeze a money action —
  the UI is responsive by construction, independent of the timeout's value.
- **Honesty is stronger, not weaker.** The four-fact fence forbids the pre-rewire implicit lie (a spinner
  that reads as "posting to ERP" while the ERP may reject). The user sees "activated / queued" truthfully and
  a real terminal state after the sweep.
- **Eventual consistency is unchanged** — the outbox + sweep already guaranteed delivery; the UI simply
  stops co-waiting. No new divergence state is introduced.
- **A new async read cost:** money surfaces on ERPNext orgs poll `get_budget_push_status` / outbox status.
  Bounded (org-scoped by RLS, only for records with an outstanding push) and off for non-ERPNext orgs.
- **`can()` / RLS unchanged:** push status reads are org-scoped by `auth_org_id()`; the client sends no
  `org_id`; the client can never write `pushed`. The FE is a UX reflection of a server-owned fact.
- **CI e2e AC-732's freeze mode is retired** and replaced by AC-APU-030 (activate-with-ERP-down stays
  interactive) — a stronger assertion than "the push eventually returns".
- **Reversible.** The rewire is FE-local (mutation stops awaiting; a badge reads a status that already
  exists). Reverting is re-inlining the await — no schema change, no data migration.
