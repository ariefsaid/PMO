# Plan — Issue #11: Adopt the test pyramid; rationalize e2e to curated journeys

- **Spec/decision:** ADR `docs/adr/0010-test-strategy-pyramid.md`
- **Date:** 2026-06-04
- **Owner of build:** implementer (TDD where new tests are added; mechanical deletes for e2e removal)
- **Hard rule:** zero net coverage loss. Every dropped/moved e2e behavior must be asserted at unit or
  pgTAP (existing-cited or newly-added) **before** the e2e is deleted. Add-then-delete ordering is
  enforced by task sequence (Phase 1 adds, Phase 2 deletes).

> Constraint reminder: this plan is authored by eng-planner under `docs/`. The implementer executes the
> tasks below against source/test/`CLAUDE.md`/`docs/`. eng-planner does not edit source.

---

## 1. Classification — all 22 e2e specs → KEEP / MOVE / DROP

Layer legend: U = Vitest/RTL unit · P = pgTAP integration · E = Playwright e2e.

| # | e2e spec | AC(s) | Verdict | Coverage lives / gets added |
|---|---|---|---|---|
| 1 | `AC-AUTH-001.spec.ts` | AUTH-001 | **KEEP (E)** | Real router+session redirect guard. Only meaningful e2e. |
| 2 | `AC-AUTH-002.spec.ts` | AUTH-002 | **KEEP→consolidate into #1 journey** | Deep-link guard; merge into the unauth-guard journey spec (Task 9). RTL `RequireAuth.test.tsx` proves redirect logic (AC-AUTH-008) but not real deep-link+session. |
| 3 | `AC-AUTH-003.spec.ts` | AUTH-003 | **KEEP (E)** | Real token issuance + role nav from real session. Nav-by-role *logic* also added at U (Task 4) but real-session render stays e2e. |
| 4 | `AC-AUTH-004.spec.ts` | AUTH-004 | **DROP** | Already U: `src/auth/LoginPage.test.tsx` → `'shows an inline error on invalid credentials (AC-AUTH-004)'`. Inline error + stay-on-login is pure form logic. |
| 5 | `AC-AUTH-005.spec.ts` | AUTH-005 | **KEEP (E)** | Magic-link round-trip via Mailpit — only provable cross-stack. |
| 6 | `AC-AUTH-006.spec.ts` | AUTH-006 | **KEEP (E)** | Sign-out clears real session + blocks re-entry. |
| 7 | `AC-AUTH-009.spec.ts` | AUTH-009 | **MOVE → U** | Engineer nav set. Added at U in Task 4 (`Sidebar.test.tsx`, AC-AUTH-009). Nav visibility is role→render logic; no stack needed. |
| 8 | `AC-AUTH-010.spec.ts` | AUTH-010 | **MOVE → U (partial KEEP)** | Impersonation *logic* already U: `src/auth/impersonation.test.tsx` (AC-AUTH-010/011). Nav-collapse-on-view-as added at U Task 4. The "identity unchanged after view-as" thread folds into the role-nav journey (Task 9) only if cheap; otherwise DROP (logic fully at U). |
| 9 | `AC-AUTH-011.spec.ts` | AUTH-011 | **DROP** | Already U: `src/auth/impersonation.test.tsx` `'is a no-op for non-Admin'` (AC-AUTH-011) + Task 4 asserts Finance has no "View as role" control at render level. |
| 10 | `AC-AUTH-012.spec.ts` | AUTH-012 | **KEEP (E)** | Session survives real reload — storage/GoTrue behavior, e2e-only. |
| 11 | `AC-401-projects-real-data.spec.ts` | 401/403/404 | **KEEP (E) as the projects real-DB smoke; DROP 403/404 sub-tests** | 401 real-row smoke KEEP (consolidated journey Task 10). 403 Leads filter + 404 search already U: `pages/Projects.test.tsx` (AC-403, AC-404). Delete those two `test(...)` blocks; keep one real-row assertion. |
| 12 | `AC-402-my-projects-real-id.spec.ts` | 402 | **DROP** | Already U: `pages/Projects.test.tsx` `'"My Projects" uses the real profile id (AC-402)'`. Real-id filter is render logic over mocked rows. |
| 13 | `AC-407-engineer-rls-read.spec.ts` | 407 | **MOVE → P** | Engineer reads all org projects = RLS SELECT read path. **ADD** pgTAP (Task 2): an Engineer (read-allowed role) SELECTs all in-org projects. Org-isolation already at `0002_tenant_isolation.test.sql`; this adds the in-org *read-allowed* assertion. U `Projects.test.tsx` AC-407 covers board render. |
| 14 | `AC-501-procurement-real-data.spec.ts` | 501/503/504 | **DROP (fold 501 into dashboard/projects smoke not needed)** | 501 joined-name render + 503 Active-Orders filter + 504 search all already U: `pages/Procurement.test.tsx` (AC-501/503/504). Procurement adds no new cross-stack risk beyond the projects smoke. DROP whole file. |
| 15 | `AC-502-my-requests-real-id.spec.ts` | 502 | **DROP** | Already U: `pages/Procurement.test.tsx` `'"My Requests" uses the real profile id (AC-502)'`. |
| 16 | `AC-508-engineer-rls-read.spec.ts` | 508 | **MOVE → P** | Engineer reads org procurements = RLS read path. **ADD** pgTAP (Task 2, same file): Engineer SELECTs in-org procurements. |
| 17 | `AC-601-timesheets-real-data.spec.ts` | 601/602 | **DROP** | Already U: `pages/Timesheets.test.tsx` (AC-601 joined name, AC-602/607 weekly total 10.0). The fragile week-navigation loop is pure e2e cost for a derived value already unit-proven. |
| 18 | `AC-603-timesheets-own-rows.spec.ts` | 603 | **MOVE → P** | Engineer sees only own timesheet rows (16.0), not PM total. This is **timesheet own-row RLS isolation** — a real policy not yet in pgTAP. **ADD** pgTAP (Task 3): `timesheets_select` / `timesheet_entries_select` own-row visibility + manager-read. |
| 19 | `AC-604-timesheets-empty.spec.ts` | 604 | **DROP** | Already U: `pages/Timesheets.test.tsx` `'empty state when the current week has no entries (AC-604)'` + different-week empty (AC-604). Empty state is render logic. |
| 20 | `AC-701-dashboard-real-kpis.spec.ts` | 701/702 | **KEEP (E) as the dashboard real-DB smoke** | KPI *formatting* already U (`pages/ExecutiveDashboard.test.tsx` AC-701/702). KEEP one e2e asserting the RPC→real-UI numbers (consolidated journey Task 11) — proves the security-invoker RPC + real seed end-to-end. |
| 21 | `AC-705-dashboard-top-projects.spec.ts` | 705 | **DROP** | Already U: `pages/ExecutiveDashboard.test.tsx` `'top projects table shows joined client name (AC-705)'`. SQL join shape proven by the RPC migration + the kept dashboard smoke (Task 11). |
| 22 | `AC-709-dashboard-rls-scoped.spec.ts` | 709 | **MOVE → P + fold into #20 smoke** | Org-scoped RPC aggregate. The RPC is `security invoker`, so org-scoping = RLS on the underlying tables — proven by org-isolation pgTAP (`0002`) + the dashboard smoke (Task 11) asserting `active_projects=2` for the seeded org. U `useDashboard.test.tsx` keys/calls (AC-709). No new pgTAP needed beyond Task 2 read-path; remove the standalone e2e. |

### Result counts
- **KEEP (e2e):** 7 specs → consolidated into **6 curated journeys** (see §2).
- **MOVE (assertion relocates to lower layer):** 5 e2e behaviors (407, 508, 603, 709, AUTH-009/010 nav).
- **DROP (already covered lower):** 9 specs/sub-tests (AUTH-004, AUTH-011, 402, 502, 501, 503, 504, 601/602, 604, 705) + 403/404 sub-tests of #11.
- Net e2e: **22 → 6** journey specs.

### Curated journey set (the ~6 we keep)
1. `e2e/AC-AUTH-001-unauth-guard.spec.ts` — unauth visit `/` AND deep-link `/projects/:id` both redirect to `/login` (merges old #1 + #2). Owns AUTH-001, AUTH-002.
2. `e2e/AC-AUTH-003-login-role-nav.spec.ts` — PM password login → dashboard with PM nav from a real session (old #3). Owns AUTH-003.
3. `e2e/AC-AUTH-005-magic-link.spec.ts` — magic-link via Mailpit (old #5, unchanged). Owns AUTH-005.
4. `e2e/AC-AUTH-006-signout.spec.ts` — sign-out → `/login`, re-entry blocked (old #6, unchanged). Owns AUTH-006.
5. `e2e/AC-AUTH-012-session-persist.spec.ts` — session survives reload (old #10, unchanged). Owns AUTH-012.
6. `e2e/AC-401-projects-smoke.spec.ts` — one real-DB→real-UI smoke: PM logs in, sees ≥1 seeded project row (trimmed old #11). Owns AUTH-403-adjacent smoke + AC-401 cross-stack.
7. `e2e/AC-701-dashboard-smoke.spec.ts` — Exec logs in, dashboard shows RPC KPI `active_projects` from real seed (trimmed old #20, absorbs AC-709 org-scope). Owns AC-701 cross-stack + AC-709 org-scope.

(7 files; #1 merges two ACs, so "journeys" ≈ 6 distinct flows. If the implementer prefers, #6+#7 may be
merged into one "authenticated user sees real data" journey → 6 files. Either is acceptable; keep ≤8.)

---

## 2. New lower-layer tests to add (coverage gaps — Phase 1, BEFORE any delete)

Three gaps exist. Everything else is already covered (cited above).

### Gap A — Role-based nav rendering (was only e2e: AUTH-003/009/010/011)
No unit test renders `components/Sidebar.tsx` with a mocked role to assert nav-item visibility. Add it.

### Gap B — Project/procurement org read path for read-allowed roles (was e2e: 407/508)
`0002_tenant_isolation.test.sql` proves *cross-org* isolation but not the *in-org read-allowed* path for
an Engineer (read-only role). Add a focused pgTAP read-path test.

### Gap C — Timesheet own-row visibility (was e2e: 603)
`timesheets_select` / `timesheet_entries_select` own-row-vs-manager visibility has **no** pgTAP. This is
a real policy (migration `0002_rls.sql` lines 149–168). Add pgTAP.

---

## 3. Tasks

> Each task: exact path, exact change, exact verify command (run inside `pmo-portal/` unless the command
> is `supabase ...`, run from repo root `/Users/ariefsaid/Coding/PMO`). TDD tasks specify the RED test.

### Phase 1 — ADD missing lower-layer coverage (must land first)

---

#### Task 1 — RED+GREEN: Sidebar role-nav unit test (Gap A; covers AC-AUTH-003, AC-AUTH-009, AC-AUTH-010, AC-AUTH-011 at U)
**File (new):** `/Users/ariefsaid/Coding/PMO/pmo-portal/components/Sidebar.test.tsx`

First read `components/Sidebar.tsx` to confirm the prop/hook it uses for the effective role (the e2e
proves it consumes `useEffectiveRole`; the page tests mock `@/src/auth/impersonation`). Mirror the mock
style from `pages/Projects.test.tsx` (mock `@/src/auth/useAuth` and `@/src/auth/impersonation`), wrap in
`<MemoryRouter>`, and assert nav-item visibility per role. Write this exact test body:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import Sidebar from './Sidebar';

let effectiveRole = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole, realRole: 'Admin', canImpersonate: effectiveRole === 'Admin' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', full_name: 'Test User', org_id: 'org-1' }, role: effectiveRole }),
}));

const renderNav = () => render(<MemoryRouter><Sidebar /></MemoryRouter>);

describe('Sidebar role-based nav', () => {
  it('PM sees Projects, Sales Pipeline, Procurement, Timesheets (AC-AUTH-003)', () => {
    effectiveRole = 'Project Manager';
    renderNav();
    for (const name of ['Projects', 'Sales Pipeline', 'Procurement', 'Timesheets']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('Engineer sees Dashboard/Projects/Timesheets/Tasks but not restricted nav (AC-AUTH-009)', () => {
    effectiveRole = 'Engineer';
    renderNav();
    for (const name of ['Dashboard', 'Projects', 'Timesheets', 'Tasks']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    for (const name of ['Sales Pipeline', 'Procurement', 'Companies', 'Reports', 'Administration']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });

  it('Admin sees Administration + Sales Pipeline; viewing as Engineer collapses the nav (AC-AUTH-010)', () => {
    effectiveRole = 'Admin';
    const { unmount } = renderNav();
    expect(screen.getByRole('link', { name: 'Administration' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales Pipeline' })).toBeInTheDocument();
    unmount();
    effectiveRole = 'Engineer'; // simulate "view as Engineer" — nav is driven by effectiveRole
    renderNav();
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
  });

  it('non-Admin (Finance) renders no nav requiring Admin (AC-AUTH-011)', () => {
    effectiveRole = 'Finance';
    renderNav();
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
  });
});
```

If `Sidebar.tsx` reads role from a prop instead of the hooks, adapt the mock to pass the prop (read the
source first). Do NOT change `Sidebar.tsx` behavior — these tests must pass against current code.
If the nav uses a different accessible name (e.g. icon-only at a breakpoint), assert on the rendered
text label the component already outputs; keep the AC-id in each `it(...)` title verbatim.

**Verify:** `npm test -- components/Sidebar.test.tsx`

---

#### Task 2 — RED+GREEN: pgTAP project + procurement in-org read path (Gap B; covers AC-407, AC-508 at P)
**File (new):** `/Users/ariefsaid/Coding/PMO/supabase/tests/0006_read_path.test.sql`

Mirror the fixture style of `0002_tenant_isolation.test.sql`. Assert that an **Engineer** (read-allowed,
write-denied) in org A reads *all* org-A projects and procurements via the SELECT policies. Exact body:

```sql
begin;
select plan(2);

insert into organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Org A');

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000e1','eng@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('a0000000-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-000000000001','Eng A','eng@example.com','Engineer');

insert into projects (id, org_id, name, status) values
  ('a1111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Project A1','Ongoing Project'),
  ('a1111111-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Project A2','Leads');

insert into procurements (id, org_id, title, status) values
  ('a2222222-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Proc A1','Draft'),
  ('a2222222-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Proc A2','Ordered');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- AC-407: an Engineer (read-allowed) reads all in-org projects via projects_select.
select is(
  (select count(*)::int from projects where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 2,
  'AC-407: Engineer reads all in-org projects (RLS read path)');

-- AC-508: an Engineer reads all in-org procurements via procurements_select.
select is(
  (select count(*)::int from procurements where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 2,
  'AC-508: Engineer reads all in-org procurements (RLS read path)');

reset role;
select * from finish();
rollback;
```

**Verify (repo root):** `supabase test db` (the runner picks up `supabase/tests/*.test.sql`).

---

#### Task 3 — RED+GREEN: pgTAP timesheet own-row visibility (Gap C; covers AC-603 at P)
**File (new):** `/Users/ariefsaid/Coding/PMO/supabase/tests/0007_timesheet_own_rows.test.sql`

Prove `timesheets_select` + `timesheet_entries_select`: an Engineer sees only their own timesheet/entries;
a manager-role (PM) sees others' submitted rows. Exact body:

```sql
begin;
select plan(4);

insert into organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Org A');

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000a1','pm@example.com'),
  ('a0000000-0000-0000-0000-0000000000e1','eng@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('a0000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','PM A','pm@example.com','Project Manager'),
  ('a0000000-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-000000000001','Eng A','eng@example.com','Engineer');

insert into projects (id, org_id, name, status) values
  ('a1111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Project A1','Ongoing Project');

-- PM timesheet (10.0h across 2 entries) + Engineer timesheet (16.0h across 2 entries).
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('a6666666-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a1','2026-06-01','Submitted'),
  ('a6666666-0000-0000-0000-00000000000e','aaaaaaaa-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e1','2026-06-01','Draft');

insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours) values
  ('a7777777-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','a6666666-0000-0000-0000-00000000000a','a1111111-0000-0000-0000-000000000001','2026-06-01',6),
  ('a7777777-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000001','a6666666-0000-0000-0000-00000000000a','a1111111-0000-0000-0000-000000000001','2026-06-02',4),
  ('a7777777-0000-0000-0000-00000000000e','aaaaaaaa-0000-0000-0000-000000000001','a6666666-0000-0000-0000-00000000000e','a1111111-0000-0000-0000-000000000001','2026-06-01',8),
  ('a7777777-0000-0000-0000-00000000000f','aaaaaaaa-0000-0000-0000-000000000001','a6666666-0000-0000-0000-00000000000e','a1111111-0000-0000-0000-000000000001','2026-06-02',8);

-- Become the Engineer.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- AC-603: Engineer sees only their own timesheet (not the PM's).
select is(
  (select count(*)::int from timesheets), 1,
  'AC-603: Engineer sees only their own timesheet row');
-- AC-603: and only their own entries (sum = 16.0, never the PM total 10.0).
select is(
  (select coalesce(sum(hours),0)::numeric from timesheet_entries), 16.0,
  'AC-603: Engineer sees only their own 16.0h of entries');

reset role;
-- Become the PM (a manager role): timesheets_select grants managers read of others'' rows.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Manager sees both timesheets (own + Engineer''s).
select is(
  (select count(*)::int from timesheets), 2,
  'AC-603: a manager (PM) reads both own and the Engineer timesheet');
-- Manager sees all entries (26.0h total).
select is(
  (select coalesce(sum(hours),0)::numeric from timesheet_entries), 26.0,
  'AC-603: a manager (PM) reads all org timesheet entries');

reset role;
select * from finish();
rollback;
```

If `timesheets` / `timesheet_entries` have NOT-NULL columns beyond those inserted, read
`supabase/migrations/0001_init_schema.sql` and add the required columns to the fixture inserts (do not
change the assertions). The seed sums (16.0 / 10.0 / 26.0) match the AC-603 e2e being replaced.

**Verify (repo root):** `supabase test db`

---

### Phase 2 — RE-TAG retained lower-layer ownership (no behavior change)

#### Task 4 — Confirm AC-id tags present on retained owning tests (covers traceability for DROP/MOVE ACs)
**Files (no new code; verify/annotate only):**
- `/Users/ariefsaid/Coding/PMO/pmo-portal/pages/Projects.test.tsx` — already tags AC-401/402/403/404/405/406/407/408. No edit.
- `/Users/ariefsaid/Coding/PMO/pmo-portal/pages/Procurement.test.tsx` — already tags AC-501/502/503/504/505/506/507. No edit.
- `/Users/ariefsaid/Coding/PMO/pmo-portal/pages/Timesheets.test.tsx` — already tags AC-601/602/604/605/606/607. No edit.
- `/Users/ariefsaid/Coding/PMO/pmo-portal/pages/ExecutiveDashboard.test.tsx` — already tags AC-701..708. No edit.
- `/Users/ariefsaid/Coding/PMO/pmo-portal/src/auth/LoginPage.test.tsx` — already tags AC-AUTH-004. No edit.
- `/Users/ariefsaid/Coding/PMO/pmo-portal/src/auth/impersonation.test.tsx` — already tags AC-AUTH-010/011. No edit.

Action: run the grep below to PROVE each MOVE/DROP AC now has an owning lower-layer test before deleting
any e2e. If any AC in the DROP/MOVE list lacks a tagged owner, STOP and add the tag (do not delete its e2e).

**Verify:** `grep -rEn "AC-(401|402|403|404|501|502|503|504|601|602|604|705|AUTH-004|AUTH-009|AUTH-010|AUTH-011|407|508|603|709)" pmo-portal/src pmo-portal/pages pmo-portal/components supabase/tests`
— every listed AC must return ≥1 match outside `pmo-portal/e2e/`.

---

### Phase 3 — DELETE / CONSOLIDATE e2e (only after Phase 1+2 green)

#### Task 5 — Delete fully-covered e2e specs (DROP set)
Delete these files (coverage cited in §1):
- `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-AUTH-004.spec.ts` (AC-AUTH-004 → U)
- `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-AUTH-009.spec.ts` (AC-AUTH-009 → U Task 1)
- `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-AUTH-010.spec.ts` (AC-AUTH-010 → U Task 1 + impersonation.test)
- `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-AUTH-011.spec.ts` (AC-AUTH-011 → U)
- `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-402-my-projects-real-id.spec.ts` (AC-402 → U)
- `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-407-engineer-rls-read.spec.ts` (AC-407 → P Task 2 + U)
- `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-501-procurement-real-data.spec.ts` (AC-501/503/504 → U)
- `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-502-my-requests-real-id.spec.ts` (AC-502 → U)
- `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-508-engineer-rls-read.spec.ts` (AC-508 → P Task 2)
- `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-601-timesheets-real-data.spec.ts` (AC-601/602 → U)
- `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-603-timesheets-own-rows.spec.ts` (AC-603 → P Task 3)
- `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-604-timesheets-empty.spec.ts` (AC-604 → U)
- `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-705-dashboard-top-projects.spec.ts` (AC-705 → U)
- `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-709-dashboard-rls-scoped.spec.ts` (AC-709 → P Task 2 + Task 8 smoke)

**Verify:** `git status --porcelain pmo-portal/e2e` shows exactly 14 deletions; then `npx playwright test --list` lists the remaining specs without error.

---

#### Task 6 — Consolidate the unauth-guard journey
**File (rename/edit):** `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-AUTH-001.spec.ts` → rename to
`/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-AUTH-001-unauth-guard.spec.ts`, then merge AC-AUTH-002's
deep-link assertion into it and delete `AC-AUTH-002.spec.ts`. Final content:

```ts
import { test, expect } from '@playwright/test';

// AC-AUTH-001 + AC-AUTH-002 — unauth users are guarded to /login (curated journey).
test('AC-AUTH-001 unauthenticated visit to / redirects to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
});

test('AC-AUTH-002 deep-link to a protected route redirects to /login when logged out', async ({ page }) => {
  await page.goto('/projects/40000000-0000-0000-0000-000000000001');
  await expect(page).toHaveURL(/\/login$/);
});
```
Then delete `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-AUTH-002.spec.ts`.

**Verify:** `npx playwright test e2e/AC-AUTH-001-unauth-guard.spec.ts` (stack up) — 2 tests pass.

---

#### Task 7 — Trim the projects e2e to a single real-DB smoke
**File (edit + rename):** `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-401-projects-real-data.spec.ts`
→ rename to `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-401-projects-smoke.spec.ts`. Remove the AC-403
(Leads filter) and AC-404 (search) `test(...)` blocks (now U-owned). Final content:

```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-401 — real-DB→real-UI smoke: a real session surfaces real seeded project rows.
test('AC-401 PM sees real seeded projects with joined client + PM names', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/projects');
  await expect(page.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();
  await expect(page.locator('span, div, td').filter({ hasText: 'Innovate Corp' }).first()).toBeVisible();
  await expect(page.locator('span, div, td').filter({ hasText: 'Alice Manager' }).first()).toBeVisible();
});
```

**Verify:** `npx playwright test e2e/AC-401-projects-smoke.spec.ts` (stack up) — 1 test passes.

---

#### Task 8 — Trim the dashboard e2e to a single real-RPC smoke (absorbs AC-709 org-scope)
**File (edit + rename):** `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-701-dashboard-real-kpis.spec.ts`
→ rename to `/Users/ariefsaid/Coding/PMO/pmo-portal/e2e/AC-701-dashboard-smoke.spec.ts`. Keep the KPI
assertions (these prove the security-invoker RPC over the real seed = org-scoped, covering AC-709's intent
end-to-end). Final content:

```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-701 (+ AC-709 org-scope) — real RPC over the real seed yields org-scoped KPIs in the real UI.
test('AC-701 Executive sees real org-scoped KPI values from the RPC', async ({ page }) => {
  await login(page, 'exec@acme.test');
  await page.goto('/');
  await expect(page.getByTestId('kpi-active-projects')).toHaveText(/2/); // org-scoped via security-invoker RPC (AC-709)
  await expect(page.getByTestId('kpi-total-contract-value')).toHaveText(/\$8,000,000/);
});
```

**Verify:** `npx playwright test e2e/AC-701-dashboard-smoke.spec.ts` (stack up) — 1 test passes.

---

#### Task 9 — Full-suite green after rationalization
No file change. Confirm the whole pyramid is green and the e2e count is the curated set.

**Verify (all must pass):**
- `npm run typecheck`
- `npm test` (unit; new Sidebar tests included)
- `supabase test db` (pgTAP; now includes 0006 + 0007 → 36 tests)
- `npx playwright test` (stack up) → exactly **6 e2e files**: AC-AUTH-001-unauth-guard, AC-AUTH-003,
  AC-AUTH-005, AC-AUTH-006, AC-AUTH-012, AC-401-projects-smoke, AC-701-dashboard-smoke (7 files; AC-AUTH-001
  carries 2 ACs). Confirm via `npx playwright test --list`.

---

### Phase 4 — Codify the convention (docs the implementer edits)

#### Task 10 — Edit `CLAUDE.md`: replace the "one e2e per AC" rule with the pyramid convention
**File:** `/Users/ariefsaid/Coding/PMO/CLAUDE.md`

Replace the final bullet of the "Spec & test conventions" section (current line 74):
```
- Each `AC-###` → exactly one Playwright spec `e2e/<AC-id>.spec.ts`, named so traceability is obvious.
```
with this exact text:
```
- **Test pyramid (ADR-0010).** Each `AC-###` is owned by **one** test at the **lowest sufficient layer**:
  Unit (Vitest/RTL, mocked) for logic/components/render-empty-error-filter; Integration (**pgTAP**,
  `supabase test db`) for RLS/tenancy/role read+write contracts; E2E (Playwright, ~6–8 curated journeys)
  for real cross-stack flows only. Coverage is never lost — never push an AC up a layer to satisfy a
  convention.
- **AC-id tagging (traceability).** The owning test names its `AC-###` in its title/description so
  `grep -r AC-XXX` finds the canonical proof at whatever layer owns it: Vitest in the `it(...)` title;
  pgTAP as the leading token of the test description; Playwright as the leading token of the `test(...)`
  title with file `e2e/<AC-id>-<slug>.spec.ts`. An AC may be referenced at multiple layers but has exactly
  one owning layer (recorded in the plan's traceability table).
```

**Verify:** `grep -n "lowest sufficient layer" CLAUDE.md` returns 1 match; `grep -n "exactly one Playwright spec" CLAUDE.md` returns 0 matches.

---

#### Task 11 — Edit `docs/product-expectations.md`: update the Acceptance/BDD DoD row
**File:** `/Users/ariefsaid/Coding/PMO/docs/product-expectations.md`

Replace the **Acceptance (BDD)** row (current line 97):
```
| **Acceptance (BDD)** | qa-acceptance | Each `AC-###` has a passing `e2e/<AC-id>.spec.ts`; tests assert behavior, never weakened to pass; per-AC pass matrix green. |
```
with this exact text:
```
| **Acceptance (BDD)** | qa-acceptance | Each `AC-###` has a passing **owning test at its lowest sufficient layer** (Unit / pgTAP / E2E per ADR-0010), AC-id-tagged for traceability; cross-stack journeys covered by the curated e2e set; tests assert behavior, never weakened to pass; per-AC pass matrix green across all three layers. |
```

**Verify:** `grep -n "lowest sufficient layer" docs/product-expectations.md` returns 1 match.

---

#### Task 12 — Note the CI implication in the backlog cross-ref
**File:** `/Users/ariefsaid/Coding/PMO/docs/backlog.md`

Under "Non-blocked backlog", append to item **5. pgTAP in CI** the sentence:
```
(Now load-bearing per ADR-0010: the integration band owns RLS/tenancy ACs — pgTAP must be a CI gate, not local-only. E2e suite shrank 22→7 files, so CI e2e wall-clock drops; wire e2e+pgTAP together.)
```

**Verify:** `grep -n "ADR-0010" docs/backlog.md` returns 1 match.

---

## 4. Task count & AC coverage map

**12 tasks.** AC ownership after this issue:

| AC(s) | Owning layer (post-change) | Owning file |
|---|---|---|
| AUTH-001, AUTH-002 | E2E | `e2e/AC-AUTH-001-unauth-guard.spec.ts` |
| AUTH-003 | E2E (+ U nav) | `e2e/AC-AUTH-003-*.spec.ts` (+ `components/Sidebar.test.tsx` Task 1) |
| AUTH-004 | U | `src/auth/LoginPage.test.tsx` (existing) |
| AUTH-005 | E2E | `e2e/AC-AUTH-005-*.spec.ts` |
| AUTH-006 | E2E | `e2e/AC-AUTH-006-*.spec.ts` |
| AUTH-009 | U | `components/Sidebar.test.tsx` (Task 1) |
| AUTH-010, AUTH-011 | U | `components/Sidebar.test.tsx` (Task 1) + `src/auth/impersonation.test.tsx` |
| AUTH-012 | E2E | `e2e/AC-AUTH-012-*.spec.ts` |
| 401 | E2E smoke + U | `e2e/AC-401-projects-smoke.spec.ts` + `pages/Projects.test.tsx` |
| 402,403,404,405,406,408 | U | `pages/Projects.test.tsx` (existing) |
| 407 | P + U | `supabase/tests/0006_read_path.test.sql` (Task 2) + `pages/Projects.test.tsx` |
| 501,502,503,504,505,506,507 | U | `pages/Procurement.test.tsx` (existing) |
| 508 | P | `supabase/tests/0006_read_path.test.sql` (Task 2) |
| 601,602,604,605,606,607 | U | `pages/Timesheets.test.tsx` (existing) |
| 603 | P | `supabase/tests/0007_timesheet_own_rows.test.sql` (Task 3) |
| 701,702,703,704,706,707,708 | U | `pages/ExecutiveDashboard.test.tsx` (existing) |
| 701 (cross-stack), 709 | E2E + P | `e2e/AC-701-dashboard-smoke.spec.ts` (Task 8) + `0002`/`0006` org-scope; `useDashboard.test.tsx` keys |
| 705 | U | `pages/ExecutiveDashboard.test.tsx` (existing) |

**New lower-layer tests added (coverage gaps):**
1. `components/Sidebar.test.tsx` — role-nav (AUTH-003/009/010/011).
2. `supabase/tests/0006_read_path.test.sql` — Engineer in-org read path (AC-407, AC-508).
3. `supabase/tests/0007_timesheet_own_rows.test.sql` — timesheet own-row visibility + manager read (AC-603).

## 5. Risks / open questions
- **Sidebar source coupling (Task 1):** the exact nav labels + how `Sidebar.tsx` reads the effective role
  must be confirmed against source before writing the test (mock-via-hook vs prop). The test must pass
  against *current* behavior — if a label differs, match the rendered label, don't change the component.
- **pgTAP fixture NOT-NULL columns (Tasks 2/3):** if `0001_init_schema.sql` requires columns beyond those
  inserted, the fixture inserts must be extended (assertions unchanged). Flagged inline in each task.
- **CI gap (informational, not in this issue):** pgTAP now owns RLS/tenancy ACs but is not yet a CI gate
  (backlog items 4–5). Until wired, the integration band is enforced locally only — Task 12 records this.
- **Behavior only meaningfully testable at e2e (kept, do not push down):** real token issuance + role nav
  from a real session (AUTH-003), magic-link round-trip (AUTH-005), session persistence across reload
  (AUTH-012), redirect guards (AUTH-001/002), and one real-DB→real-UI smoke per module (401, 701). These
  are the irreducible top of the pyramid.
