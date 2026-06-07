# ADR-0017 — Repository / API seam (FE/API/BE modularity)

Status: Accepted
Date: 2026-06-07
Plan basis: `docs/plans/2026-06-07-crud-rbac-program.md` (§Architecture — the 3 layers + the seam, §ADRs to author, Phase 1 §2).
Companion docs: `docs/design/crud-components.md` (§2.3), `docs/adr/0003-data-access-layer-pattern.md` (the DAL this seam wraps).

## Context

The owner wants app-wide FE CRUD across three layers (FE / API / BE) with a **modularity seam** so the
Supabase backend can later be swapped for an ERP/REST backend **without rewriting the frontend**. Today
the data layer is a flat set of Data Access Layer functions in `pmo-portal/src/lib/db/*` (ADR-0003): each
hook imports the concrete functions (`listProjects`, `transitionProcurement`, …) directly and they call
the Supabase client. That is fine for reads + the shipped lifecycle writes, but it hard-wires every hook
to Supabase: there is no named contract a second backend could implement, and the thrown error type is
inconsistent — three different shapes have accreted (`Error` from most fns, `ProcurementError` from
`procurementLifecycle.ts`, `TimesheetWriteError` from `timesheets.ts`), each independently re-deriving the
"carry the Postgres `code`" idea, and `classifyMutationError` lived **inline** in `pages/ProcurementDetails.tsx`.

We need (a) a typed contract per entity that the FE consumes instead of concrete DAL fns, (b) one shared,
backend-agnostic error type, and (c) the error-classification helper shared so every CRUD mutation can
surface a recoverable, classified failure. This must be **cheap and low-risk now**: the full FE-CRUD
program is large, so the seam itself cannot be a rewrite.

## Decision

**1. A typed repository interface per entity is the API contract.** `pmo-portal/src/lib/repositories/types.ts`
declares `ProjectRepository`, `CompanyRepository`, `ProfileRepository`, `ProcurementRepository`,
`TimesheetRepository`, `BudgetRepository`, and an assembling `Repositories` type. Each interface mirrors the
**existing** DAL function signatures (`list` / `get` / `create*` / `update*` / `transition` / archive as
applicable) — no signature diverges from its DAL counterpart, so adopting the seam is a pure rename of the
call target, not a behavioral change.

**2. The current DAL is the Supabase *implementation* of those interfaces.** `pmo-portal/src/lib/repositories/index.ts`
assembles a `repositories` object whose methods are **thin wrappers** that delegate to the existing
`src/lib/db/*` functions. The wrappers add exactly one thing: they normalize any thrown value to a shared
`AppError` (preserving the `code`). The DAL functions are **not moved or rewritten** — the wrappers import
them. A future ERP/REST backend is a *new* module exporting the same `Repositories` shape; the FE imports
`repositories` and never changes.

**3. A shared `AppError { message, code? }` (extends `Error`) replaces the per-DAL error classes at the
seam.** `pmo-portal/src/lib/appError.ts` exports `AppError` plus `toAppError(err)`, which reads a
structurally-present string `.code` (so it transparently preserves the codes already carried by
`ProcurementError` / `TimesheetWriteError` / a raw PostgREST error) and is idempotent on an existing
`AppError`. The repository wrappers throw `AppError`; consumers catch one code-bearing type regardless of
backend. `AppError extends Error`, so all existing `err instanceof Error` / `.message` consumers keep working.

**4. `classifyMutationError` is promoted to a shared module.** Moved from inline in
`pages/ProcurementDetails.tsx` to `pmo-portal/src/lib/classifyMutationError.ts`, mapping the preserved code
to a `{ headline, detail }` toast contract (`P0001` → illegal-state, `42501` → not-permitted/SoD, `23505`
→ duplicate, else generic), reading the code structurally so it works for `AppError` and any code-bearing
error. `ProcurementDetails.tsx` now imports it; **behavior is unchanged** (its component tests stay green).

## Scope of THIS change (additive, low-risk — Phase 1 §2)

- New `pmo-portal/src/lib/appError.ts` (`AppError`, `toAppError`) + unit test.
- New `pmo-portal/src/lib/classifyMutationError.ts` (promoted) + unit test; `ProcurementDetails.tsx` re-pointed at it.
- New `pmo-portal/src/lib/repositories/{types.ts,index.ts}` (interfaces + Supabase impl) + unit test.
- **Existing hooks are NOT touched.** They keep importing the DAL directly; the seam is consumed only by
  new CRUD code from Phase 2+. This keeps the foundation PR small and the blast radius near-zero.

## What is explicitly NOT in this change

- **Migrating existing hooks onto `repositories`** — out of scope; they work and the rename is behavior-neutral
  but not free of regression risk, so it is deferred (and may simply never be needed: new code uses the seam,
  old code keeps working).
- **Retiring `ProcurementError` / `TimesheetWriteError`** — they remain the DAL-internal throw types; the seam
  normalizes them to `AppError` at the boundary. Collapsing them into `AppError` is a later cleanup, not required now.
- **The second (ERP/REST) repository adapter** — the interfaces land now; an actual second implementation is
  deferred (plan §Deferred). The value today is the contract + the single error type, not a live second backend.

## Consequences

- **Positive:** there is now a named, typed contract per entity the FE depends on instead of concrete Supabase
  fns; swapping the backend later is "implement `Repositories` again", zero FE change. One error type + one
  classifier means every CRUD mutation surfaces a classified, recoverable toast instead of a silent no-op or a
  generic message. The change is additive — no existing path is modified except the behavior-neutral
  `classifyMutationError` import in `ProcurementDetails.tsx`.
- **Cost:** a thin indirection layer (the wrappers) that must be kept in sync with DAL signatures — mitigated
  because the interfaces are typed against the DAL's own exported types, so a signature drift fails `tsc`. New
  code must remember to consume `repositories` rather than the DAL directly (enforced by review, not lint, for now).
- **Reversibility:** purely additive new files; deleting them and reverting the one import restores the prior state.

## Alternatives considered

- **Leave hooks importing the DAL directly (do nothing).** Rejected: gives no backend-swap seam and leaves the
  inline classifier + three error shapes, which the owner's FE/API/BE modularity ask explicitly wants resolved.
- **Move (not wrap) the DAL into `repositories/` (near-verbatim relocation, plan §Architecture wording).**
  Rejected for *this* PR as higher-risk: relocating every `db/*` file churns imports across all existing hooks
  and tests for no behavioral gain. The thin-wrapper approach delivers the same contract additively; a later
  relocation remains possible behind the unchanged interface.
- **A single `DataRepository` god-interface.** Rejected: one interface per entity matches the existing
  per-entity DAL files, keeps each contract small, and lets a future backend implement entities incrementally.
- **A class-based repository with DI container.** Rejected as over-engineered for a single-tenant MVP with one
  live backend; a plain object of typed methods is sufficient and tree-shakeable.

## Verification

From `pmo-portal`: `npm test` (the `appError`, `classifyMutationError`, and `repositories` unit tests assert
the error contract, the classifier mapping, the repository shape + delegation + AppError normalization, and the
unchanged `ProcurementDetails` component tests), `npm run typecheck` (the interfaces typecheck against the DAL's
own exported types), and `npm run lint -- --max-warnings=0` all green.
