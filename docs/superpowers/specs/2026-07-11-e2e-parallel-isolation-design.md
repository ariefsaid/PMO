# Design — parallel-safe e2e via declared isolation classes + an enforcement guard

**Date:** 2026-07-11 · **Status:** approved (owner) · **Owner:** Director
**Supersedes risk introduced by:** #306 (`perf(e2e)`: `workers:1 → 4`)

## 1. Context & problem

#306 retired the per-spec bcrypt login (session `storageState` injection) and flipped CI e2e from
`workers:1` (serial) to `workers:4` (parallel). Measured win: the e2e run dropped from ~serial to
**3.6m** (179 tests), integration job **10.3m → 6.6m**. But the promote (#313) went **RED**: 171 passed,
1 failed, 2 flaky. The suite runs **4 workers against ONE shared Supabase seed org**
(`org_id 00000000-…-0001`); specs that mutate shared state now collide.

The auth-reuse half of #306 is good and stays. The `workers:4` half is unsafe because the suite has
no isolation contract. This design makes parallel-safety a **declared, enforced property of every
spec** — fixing today's offenders and preventing future ones.

## 2. Root cause — three distinct failure modes (not one)

The CI symptoms were misleading; a full audit (78 spec files) found three modes:

- **① Global-state flips** — mutate **org-scoped** state, breaking any concurrent reader during the
  window: `AC-CUA-090`/`AC-CUA-091` (flip org `tasks`→ClickUp via `external_domain_ownership`),
  `AC-ENT-005` (toggle org `incidents` entitlement), `AC-AU-001` (change shared `engineer@acme.test`
  role), `AC-732` (activate a budget on shared P001 → archives its seeded Active version).
- **② Shared-row mutators** — permanent change to a shared seed row; collide only if co-scheduled with
  that row's reader: `AC-816` (procurement PROC-2026-003 lifecycle), `AC-SCA-014` (task Done on SP-2401),
  `AC-TSE-021` (shared `engineer@` timesheet week), `AC-VB-E01` (fixed-name `"Test View"`).
- **③ Retry / contention (NOT a data race)** — the two specs the CI log *blamed*:
  `AC-DEL-022` (hard fail) owns a dedicated project P013 and asserts `milestone-strip-empty`; under
  `retries:2` its own first attempt leaves a milestone → the empty-state precondition breaks on retry.
  `AC-AR-013` (flaky) writes **nothing** (fully `page.route`-mocked) — pure timing contention under load.

~55 of 78 specs are **already parallel-safe** (read-only or `Date.now()`-named self-isolated), and 2
specs already use `test.describe.configure({ mode: 'serial' })`. The house has the patterns; it lacks
a contract.

## 3. Goals (per `docs/product-expectations.md` — robustness · reliability · efficiency)

1. **Reliability:** zero data-race flakes at `workers:4` — deterministic green.
2. **Efficiency:** keep the parallel win for the ~55 safe specs (serialize only true offenders).
3. **Robustness / future-proofing (the emphasis):** the convention is **declared per spec** and
   **enforced by a build gate**, so specs authored *later* (by any agent) cannot silently reintroduce
   the flakiness — the same forcing-function model as `check-migration-collisions.sh` (#308).

Non-goal (YAGNI): per-worker seed orgs (option C) — over-built for a single-tenant app with one seed
org; the serial lane covers the handful of genuinely global specs at far lower cost.

## 4. The isolation-class contract

Every `pmo-portal/e2e/*.spec.ts` declares one class in a header tag:

```ts
// @e2e-isolation: read-only | self-isolated | dedicated-row | serial
```

| Class | Definition | Lane | Author obligation |
|---|---|---|---|
| `read-only` | Only navigates/asserts; no DB write (incl. `page.route`-mocked edge fns) | parallel | no writes |
| `self-isolated` | Creates its own uniquely-named data (`Date.now()`/uuid) + cleans up | parallel | unique names; `afterEach`/service-role cleanup |
| `dedicated-row` | Owns an expendable seed row (P012/P013, Grace/Heidi…); no other spec reads it | parallel | `beforeEach` resets the row so it is **retry-safe** |
| `serial` | Mutates **org-global** state; must run with nothing else running | serial phase (`--workers=1`) | lives in the serial lane (§5) |

The tag is the forcing function: an author **must** classify the spec, which makes them reason about
isolation; the guard (§7) checks the declaration is present, placed correctly, and not obviously false.

## 5. Lane mechanism (Playwright)

Two projects, run as **two phases** in one `npm run e2e` (and in CI):

- **`chromium`** — `testDir: e2e`, `testIgnore: e2e/serial/**`, `fullyParallel: true`, `dependencies: ['setup']`.
  Runs at `workers: CI ? 4 : undefined`. Holds `read-only` / `self-isolated` / `dedicated-row` specs.
- **`serial`** — `testMatch: e2e/serial/**`, `fullyParallel: false`, `dependencies: ['setup']`.
  Run in a **separate invocation at `--workers=1`** so the global-flip specs run one-at-a-time with
  nothing else live.

`serial`-tagged specs physically live under `pmo-portal/e2e/serial/` (dir = lane; greppable + the guard
checks tag↔dir consistency). Runner:

```jsonc
// package.json
"e2e": "playwright test --project=chromium && playwright test --project=serial --workers=1"
```

Both invocations reuse one dev server (`reuseExistingServer: true`; CI starts it once) — the serial
phase adds only the ~5 global specs' wall-clock after the parallel batch, preserving most of the win.

> Why two phases, not `dependencies`-ordering in one run: Playwright's `workers` is global, so a single
> invocation cannot pin the serial project to 1 worker while the rest use 4. Two invocations is the
> simplest bulletproof way to guarantee the serial specs never overlap **anything** (mode-① needs total
> exclusivity, not just mutual). *(ponytail: two commands over a bespoke cross-file mutex.)*

## 6. Per-offender remediation

| Spec | Mode | Fix | Resulting class / lane |
|---|---|---|---|
| AC-CUA-090, AC-CUA-091 | ① | Move to `e2e/serial/` | `serial` |
| AC-ENT-005 | ① | Move to `e2e/serial/` | `serial` |
| AC-AU-001 | ① | Move to `e2e/serial/` | `serial` |
| AC-732 | ① | Move to `e2e/serial/` (archives shared P001 budget) | `serial` |
| AC-816 | ② | Repoint to a **dedicated** procurement fixture (§J already seeds isolation procs) | `dedicated-row` (parallel) |
| AC-SCA-014 | ② | Dedicate a task on SP-2401 (or a dedicated delivery project) | `dedicated-row` (parallel) |
| AC-TSE-021 | ② | Use a dedicated engineer+week (mirror `AC-IXD-TS-001`'s move) | `self-isolated` (parallel) |
| AC-VB-E01 | ② | Unique `Test View ${Date.now()}` name + cleanup | `self-isolated` (parallel) |
| AC-DEL-022 | ③ | `beforeEach`: service-role delete any milestones/tasks on P013 → empty-state precondition holds every attempt (retry-safe) | `dedicated-row` (parallel) |
| AC-AR-013 | ③ | Harden waits (SSE mock settle + ⌘J mount) — pure contention, no data change | `read-only` (parallel) |

All remaining ~68 specs: **classify + tag** to their existing behavior (mostly `read-only` /
`self-isolated`); no behavior change. Where a spec's real journey *intrinsically* needs a shared
mutation that can't be dedicated, it goes `serial` — coverage is never dropped to satisfy the lane
(consistent with the qa-acceptance BINDING authoring principle: fix isolation, never weaken the oracle).

## 7. Enforcement — `scripts/check-e2e-isolation.sh`

A sibling to `check-migration-collisions.sh`, wired identically (`npm run verify` first-steps + all 3 CI
jobs). It **fails the build** on:

1. **Missing/invalid tag** — any `e2e/*.spec.ts` without exactly one `// @e2e-isolation: <class>` where
   `<class>` ∈ the four names. *(The core forcing function: you cannot add a spec without classifying it.)*
2. **Lane mismatch** — a `serial`-tagged spec not under `e2e/serial/`, or a non-`serial` spec under it.
3. **High-signal mislabel** — a `read-only`-tagged spec containing write signals
   (`requireServiceRoleKey`, `.insert(`/`.update(`/`.delete(`).
4. **Shared-seed-ID writes outside a safe class** — a non-`serial`, non-`dedicated-row` spec that
   references a known **shared** seed UUID (e.g. `40000000-…-0001` P001, `00000000-…-0001` org) — the
   strongest mode-② heuristic. The known shared IDs live in a small allow/deny list at the top of the script.

`--self-test` proves it catches an untagged spec + a lane mismatch (mirrors the migration guard).

> ponytail ceiling: this is a **heuristic lint, not a proof** — it cannot statically prove a
> `self-isolated` claim is truly race-free (that needs runtime data-flow). The tag-presence requirement +
> the ID/service-role heuristics catch the realistic mistakes; the CI integration lane at `workers:4`
> remains the empirical backstop. Upgrade path: a runtime "shared-row touched by >1 spec" detector if
> heuristics ever prove insufficient.

## 8. Docs & agent-awareness (so future authors follow it by default)

- **`docs/qa-portfolio.md`** — add an "e2e parallel-isolation contract" section (the taxonomy + the guard
  + the two-lane run) as part of the QA source of truth.
- **`docs/product-expectations.md`** Part B — the Acceptance-layer DoD row references the contract
  (an e2e spec is not "done" until it declares a valid isolation class and passes the guard).
- **`.claude/agents/qa-acceptance.md`** — extend the BINDING authoring principle: *every e2e spec
  declares `@e2e-isolation`; prefer `self-isolated`/`dedicated-row`; use `serial` only for genuinely
  org-global journeys; never weaken an oracle to fit a lane.* This is the agent that authors e2e — it
  must know the contract at author time, not review time.
- **`pmo-portal/e2e/README.md`** — a short, practical "how to pick your isolation class" for humans + agents.

## 9. Verifying the fix

1. **Local, real measurement:** `npm run e2e` (both phases) at `workers:4` on a clean local stack —
   green, and capture the wall-clock vs the 10.3m baseline.
2. **Guard self-proof:** `check-e2e-isolation.sh --self-test` green; a deliberately-untagged spec fails.
3. **Promote gate:** re-open the dev→main promote → `integration` lane green at `workers:4`, first
   parallel-green proof + the measured integration-job time.

## 10. Scope / rollout

One PR to `dev` (`fix/e2e-parallel-isolation`): config split + per-offender fixes + tag every spec +
the guard + docs/agent-brief. Sequenced so the guard lands **after** all specs are tagged (else it
red-fails the very PR that introduces it). Verified by `npm run verify` + a full local e2e at
`workers:4` before the promote.
