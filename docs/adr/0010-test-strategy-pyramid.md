# ADR 0010 — Test strategy: adopt the test pyramid; AC maps to the lowest sufficient layer

- **Status:** Accepted
- **Date:** 2026-06-04
- **Issue:** #11 — Adopt the test pyramid; rationalize e2e to curated journeys
- **Supersedes:** the `CLAUDE.md` convention "each `AC-###` → exactly one Playwright e2e spec"

## Context

The current convention forces **every** acceptance criterion to the top of the pyramid: one
Playwright e2e spec per `AC-###`. The result is an inverted pyramid:

- **Unit (Vitest/RTL):** 24 test files, ~77 tests, mocked hooks/db, milliseconds, no stack.
- **E2E (Playwright):** 22 specs, real browser + live Supabase + Mailpit, seconds each, flaky-prone
  (week-navigation loops, Mailpit polling, ordering between specs).
- **Integration (pgTAP):** 5 files, 28 tests, DB contract / RLS / tenancy, fast against local PG.

The e2e layer **duplicates lower layers**. Render/filter/empty/loading/error are already proven in the
page `*.test.tsx` with mocked hooks (e.g. `pages/Projects.test.tsx` covers AC-401/402/403/404/405/406/407/408).
Query-key/db-call wiring is proven in the hook tests (`src/hooks/*.test.tsx`). RLS read/role isolation is
the contract that pgTAP is purpose-built for (`supabase/tests/0002_tenant_isolation.test.sql` already
proves projects cross-org SELECT isolation as `AC-102`).

E2E is the **most expensive and least reliable** layer. It earns its cost only for genuine cross-stack
user journeys — real auth token issuance, redirect guards, session persistence, role-driven nav rendered
from a real session, and a real DB round-trip surfacing real rows in the real UI. Spending it on
assertions that a mock or a SQL policy proves more directly is waste with no added confidence.

## Decision

1. **Adopt the test pyramid.** Each behavior is tested at the **lowest layer that can sufficiently prove
   it**:
   - **Unit (bulk)** — Vitest/RTL, mocked data/hooks. Pure logic, formatters, hooks (query keys, db-fn
     wiring), and component render/loading/empty/error/filter/derived-value states.
   - **Integration (some)** — **pgTAP** (`supabase test db`). RLS/tenancy/role read+write contracts and
     data-layer↔real-DB shape. This is where org-isolation and own-row visibility are *proven*, not in a
     browser.
   - **E2E (few — a curated ~6–8 journeys)** — Playwright. Real cross-stack user flows only: things that
     are *only meaningfully provable* through the whole stack (token issuance, route guards, session
     persistence, role nav from a real session, real-DB→real-UI smoke).

2. **Traceability is preserved, not coupled to e2e.** An `AC-###` maps to **one** owning test at the
   lowest sufficient layer — not necessarily a Playwright spec. Coverage is never lost: every behavior
   keeps exactly one canonical assertion.

3. **AC-id tagging convention (uniform across layers).** The owning test names its AC-id in the test
   title / description, so `grep -r "AC-XXX"` finds the canonical proof at whatever layer owns it:
   - **Vitest/RTL:** the AC-id appears in the `it(...)` title, e.g.
     `it('renders seeded projects with joined client + PM names (AC-401)', …)`.
   - **pgTAP:** the AC-id is the leading token of the test description string, e.g.
     `'AC-102: org A cannot read org B rows (SELECT isolation)'`.
   - **Playwright:** the AC-id is the leading token of the `test(...)` title and the file is named
     `e2e/<AC-id>.spec.ts`, e.g. `test('AC-AUTH-003 PM login lands on dashboard …')`.
   A single AC may be *referenced* at multiple layers (defense in depth) but has exactly **one owning
   layer** — recorded in the traceability table in the spec/plan.

4. **A behavior is kept at e2e only if it is not sufficiently provable lower.** "Sufficient" means the
   lower-layer test would have to mock away the very thing under test (the browser, the auth token, the
   redirect, the live policy enforcement). Render-of-mocked-rows and policy-logic are *not* in that set.

## Consequences

**Positive**
- The suite becomes a correct pyramid: many fast unit tests, a focused pgTAP integration band, a thin
  e2e cap. CI wall-clock and flake both drop; the e2e suite shrinks from 22 specs to ~6–8 journeys.
- RLS/tenancy correctness moves to pgTAP where it is asserted directly against policies (deterministic,
  no browser timing), closing two real coverage gaps (timesheet own-row SELECT isolation; org-scoped
  read path) that e2e only proved indirectly.
- Lower-layer tests are the *contract*: faster red/green for the implementer, clearer failure locality.

**Negative / costs**
- One-time migration cost: lower-layer coverage for dropped e2e behaviors must be **added before**
  deleting the e2e (zero net coverage loss is the hard rule).
- `pgTAP` must run in CI for the integration band to be a real gate (today CI runs typecheck/lint/unit/
  build only; pgTAP + e2e run locally). Tracked in `docs/backlog.md` "Non-blocked backlog" items 4–5.
- Reviewers must learn the new tagging convention and consult the traceability table to find an AC's
  owning layer rather than assuming `e2e/<AC>.spec.ts` exists.

**Behaviors that remain e2e-only (cannot be pushed down — kept):**
- Unauthenticated redirect / protected-deep-link guard (real router + real session) — AC-AUTH-001/002.
- Password login issues a real token and lands authenticated (AC-AUTH-003), incl. role nav from a real
  session; sign-out clears the real session and blocks re-entry (AC-AUTH-006); session survives reload
  (AC-AUTH-012); magic-link round-trip via Mailpit (AC-AUTH-005). These exercise GoTrue + storage, which
  unit mocks deliberately stub out.
- One real-DB→real-UI smoke per module proving the wired stack returns real rows (projects, dashboard
  KPIs) — distinct from the mocked render tests.
