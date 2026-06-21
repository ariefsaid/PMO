# Implementation plan — Procurement Reserved budget layer (DecisionSupportPanel)

- **Spec:** `docs/specs/procurement-reserved-budget.spec.md` (signed off — FR-RB-001..041, AC-RB-001..014).
- **Authority:** ADR-0034. Owner's four `[OWNER-DECISION]`s are RESOLVED and baked in below (do not re-open).
- **Scope:** docs/spec already signed. This plan covers DAL + hook + pgTAP + panel logic + states + unit tests.
- **No app code is written by the planner.** Tasks below are for the implementer (TDD red→green).

## Resolved owner decisions (baked in)
1. **RESERVED_STATUSES = `['Approved', 'Vendor Quoted', 'Quote Selected']`** (post-approval, pre-PO).
2. **Panel visible ONLY when status ∈ `{Draft, Requested, Approved, Vendor Quoted, Quote Selected}`**; returns
   `null` for `{Ordered, Received, Vendor Invoiced, Paid, Rejected, Cancelled}`. (Removes the double-count bug structurally.)
3. **Reserved TILE shows `otherReserved` (excludes current case); headroom math (Available, afterRequest) uses TOTAL `reserved`.**
4. **Panel-only.** ProjectBudget page surfacing Reserved is a noted follow-up — NOT in this plan.

## Non-goals (explicit — confirm UNTOUCHED, no ripple)
- `COMMITTED_STATUSES`, `getProjectCommittedSpend`, `useProjectCommittedSpend` — **byte-for-byte unchanged**.
- Migration 0009 (`projects.spent`), 0026 (`get_projects_delivery.committed_spend`), the committed-drift pgTAP guard,
  every dashboard, every Finance card — **NOT in the change set**. No new migration, RLS policy, or RPC.
- `pages/ProjectBudget.tsx` — out of scope (OWNER-DECISION-4 follow-up).

## Change set (files the implementer will touch)
| File | Change |
|------|--------|
| `pmo-portal/src/lib/db/procurements.ts` | + `RESERVED_STATUSES` const, + `getProjectReservedSpend()` |
| `pmo-portal/src/lib/db/procurements.test.ts` | + reserved-read unit tests (AC-RB-001, AC-RB-003) |
| `pmo-portal/src/hooks/useProcurements.ts` | + `useProjectReservedSpend()` hook |
| `pmo-portal/pages/procurement/DecisionSupportPanel.tsx` | + status prop, reserved read, Available/Reserved tiles, per-stage math, visibility gate, advisory |
| `pmo-portal/pages/procurement/DecisionSupportPanel.test.tsx` | + new behavior tests (AC-RB-004..014) |
| `pmo-portal/pages/procurement/ProcurementOverviewTab.tsx` | thread `status` prop through |
| `pmo-portal/pages/procurement/ProcurementOverviewTab.test.tsx` | pass `status` in existing render helper (compile fix) |
| `pmo-portal/pages/ProcurementDetails.tsx` | pass `status={p.status}` to `ProcurementOverviewTab` |
| `supabase/tests/0035_procurement_reserved_spend.test.sql` | NEW pgTAP — reserved org-scoping (AC-RB-002) |

Reference patterns to mirror: `getProjectCommittedSpend` (same file), `useProjectCommittedSpend`
(`useProcurements.ts`), `supabase/tests/0020_procurement_committed_contract.test.sql`.

---

## Type contract (consistent across all tasks)
- `ProcurementStatus` is imported from `@/src/lib/db/procurementLifecycle` (`export type ProcurementStatus = ProcurementRow['status']`).
- `RESERVED_STATUSES: ProcurementRow['status'][] = ['Approved', 'Vendor Quoted', 'Quote Selected']`.
- New panel prop: `status: ProcurementStatus` (required).
- `DecisionSupportPanelProps` gains `status`; `ProcurementOverviewTabProps` gains `status`.

Derived values inside the panel (after the loading/error/no-budget guards), all defaulting to `0`:
```
const reserved      = reservedQ.data ?? 0;          // TOTAL reserved (incl. this case if applicable)
const available     = budgetAmount - committedSpend - reserved;        // FR-RB-010
const caseInReserved = RESERVED_STATUSES.includes(status);             // FR-RB-013/014
const afterRequest  = available - (caseInReserved ? 0 : totalValue);   // FR-RB-013
const otherReserved = reserved - (caseInReserved ? totalValue : 0);    // FR-RB-014 (tile only)
```
Visibility (FR-RB-020), applied AFTER the existing `if (!projectId) return null`:
```
const PANEL_VISIBLE_STATUSES = ['Draft','Requested','Approved','Vendor Quoted','Quote Selected'];
if (!PANEL_VISIBLE_STATUSES.includes(status)) return null;
```

---

## Tasks (ordered; each 2–5 min; TDD red→green)

### Phase A — DAL read + hook + pgTAP (tenancy seam first)

#### Task A1 — RED: unit test for `getProjectReservedSpend` sum (AC-RB-001)
**File:** `pmo-portal/src/lib/db/procurements.test.ts` (append a new `describe`).
Add (mirrors the existing `getProjectCommittedSpend` block; reuse `makeChainedBuilder`):
```ts
import { listProcurements, getProjectCommittedSpend, getProjectReservedSpend } from './procurements';

describe('getProjectReservedSpend', () => {
  it('AC-RB-001: sums total_value over Approved/Vendor Quoted/Quote Selected for the project', async () => {
    const { mockEq, mockIn } = makeChainedBuilder({
      data: [{ total_value: 80000 }, { total_value: 40000 }, { total_value: 30000 }],
      error: null,
    });
    const total = await getProjectReservedSpend('proj-1');
    expect(mockFrom).toHaveBeenCalledWith('procurements');
    expect(mockSelect).toHaveBeenCalledWith('total_value');
    expect(mockEq).toHaveBeenCalledWith('project_id', 'proj-1');
    expect(mockIn).toHaveBeenCalledWith('status', ['Approved', 'Vendor Quoted', 'Quote Selected']);
    expect(total).toBe(150000);
  });

  it('AC-RB-001: returns 0 when there are no reserved procurements', async () => {
    makeChainedBuilder({ data: [], error: null });
    await expect(getProjectReservedSpend('proj-1')).resolves.toBe(0);
  });

  it('AC-RB-001: sends no org_id (RLS scopes it)', async () => {
    makeChainedBuilder({ data: [], error: null });
    await getProjectReservedSpend('proj-1');
    expect(JSON.stringify(mockSelect.mock.calls)).not.toContain('org_id');
  });

  it('AC-RB-001: throws on PostgREST error', async () => {
    makeChainedBuilder({ data: null, error: { message: 'kaboom' } });
    await expect(getProjectReservedSpend('proj-1')).rejects.toThrow('kaboom');
  });
});
```
**Verify (must FAIL — function not yet exported):**
`cd pmo-portal && npx vitest run src/lib/db/procurements.test.ts`

#### Task A2 — GREEN: add `RESERVED_STATUSES` + `getProjectReservedSpend` (AC-RB-001, AC-RB-003)
**File:** `pmo-portal/src/lib/db/procurements.ts`. After the `getProjectCommittedSpend` block (line ~45) add:
```ts
/**
 * Reserved-spend basis for ONE project (ADR-0034): Σ procurement total_value where status ∈
 * {Approved, Vendor Quoted, Quote Selected} — approved-but-not-yet-ordered demand ("encumbrance").
 * DISTINCT from Committed (which is Ordered..Paid) — RESERVED_STATUSES and COMMITTED_STATUSES are
 * disjoint. org_id is NEVER sent — RLS scopes by org. Returns 0 when the project has none.
 */
export const RESERVED_STATUSES: ProcurementRow['status'][] = [
  'Approved',
  'Vendor Quoted',
  'Quote Selected',
];

export async function getProjectReservedSpend(projectId: string): Promise<number> {
  const { data, error } = await supabase
    .from('procurements')
    .select('total_value')
    .eq('project_id', projectId)
    .in('status', RESERVED_STATUSES);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce(
    (sum, row) => sum + Number((row as { total_value: number }).total_value ?? 0),
    0,
  );
}
```
(Leave `COMMITTED_STATUSES` and `getProjectCommittedSpend` UNTOUCHED — FR-RB-004.)
**Verify (must PASS):** `cd pmo-portal && npx vitest run src/lib/db/procurements.test.ts`

#### Task A3 — RED→GREEN: disjointness unit assertion (AC-RB-003)
**File:** `pmo-portal/src/lib/db/procurements.test.ts`. The committed test asserts `COMMITTED_STATUSES` indirectly;
add an explicit disjointness check. First export `COMMITTED_STATUSES` from `procurements.ts` (change
`const COMMITTED_STATUSES` → `export const COMMITTED_STATUSES` — additive, no behavior change). Then append:
```ts
import { COMMITTED_STATUSES, RESERVED_STATUSES } from './procurements';

describe('AC-RB-003: Committed and Reserved sets are disjoint', () => {
  it('shares no status between COMMITTED_STATUSES and RESERVED_STATUSES', () => {
    const overlap = COMMITTED_STATUSES.filter((s) => RESERVED_STATUSES.includes(s));
    expect(overlap).toEqual([]);
  });
  it('COMMITTED_STATUSES is exactly Ordered/Received/Vendor Invoiced/Paid (unchanged)', () => {
    expect(COMMITTED_STATUSES).toEqual(['Ordered', 'Received', 'Vendor Invoiced', 'Paid']);
  });
});
```
**Verify (must PASS):** `cd pmo-portal && npx vitest run src/lib/db/procurements.test.ts`

#### Task A4 — GREEN: add `useProjectReservedSpend` hook (AC-RB-004 enabler, FR-RB-005)
**File:** `pmo-portal/src/hooks/useProcurements.ts`. Extend the import on line 2-6 to include
`getProjectReservedSpend`, then after `useProjectCommittedSpend` (line ~32) add:
```ts
/**
 * Reserved spend for ONE project (ADR-0034): Σ total_value in Approved/Vendor Quoted/Quote Selected —
 * approved-but-not-yet-ordered demand. Powers the DecisionSupportPanel's Reserved/Available figures.
 * Org-scoped via RLS; query key carries orgId so the cache is tenant-scoped.
 */
export function useProjectReservedSpend(projectId: string | null | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<number>({
    queryKey: ['project-reserved-spend', orgId, projectId],
    queryFn: () => getProjectReservedSpend(projectId as string),
    enabled: Boolean(orgId && projectId),
  });
}
```
**Verify (must PASS — typecheck):** `cd pmo-portal && npx tsc --noEmit`

#### Task A5 — pgTAP: Reserved read is org-scoped (AC-RB-002)
**File (NEW):** `supabase/tests/0035_procurement_reserved_spend.test.sql`. Mirror
`0020_procurement_committed_contract.test.sql`'s fixture style. Create TWO orgs, each with a like-named
project and an `Approved` procurement; assert that an org-A authenticated reader, scoped by RLS, sums ONLY
org-A's reserved rows (the org-B `Approved` row is invisible), and that an `Approved`/`Vendor Quoted`/
`Quote Selected` row IS in the reserved set while a `Requested`/`Ordered` row is NOT.
```sql
-- 0035_procurement_reserved_spend.test.sql
-- AC-RB-002: Reserved-spend read is org-scoped by RLS (no client org_id) + the reserved status
-- contract {Approved, Vendor Quoted, Quote Selected} (ADR-0034, distinct from Committed).
begin;
select plan(4);

insert into organizations (id, name) values
  ('00350000-0000-0000-0000-000000000001','Reserved Org A'),
  ('00350000-0000-0000-0000-000000000002','Reserved Org B');

insert into auth.users (id, email) values
  ('00350000-0000-0000-0000-0000000000a1','pm-resA@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00350000-0000-0000-0000-0000000000a1','00350000-0000-0000-0000-000000000001','PM ResA','pm-resA@example.com','Project Manager');

insert into projects (id, org_id, name, code) values
  ('00350000-0000-0000-0000-000000000100','00350000-0000-0000-0000-000000000001','Shared Name Project','PRJ-RA'),
  ('00350000-0000-0000-0000-000000000200','00350000-0000-0000-0000-000000000002','Shared Name Project','PRJ-RB');

-- Org A: two reserved rows (Approved 80k, Quote Selected 40k) + one NON-reserved (Requested 10k).
insert into procurements (id, org_id, project_id, title, status, total_value, requested_by_id) values
  ('00350000-0000-0000-0000-000000000010','00350000-0000-0000-0000-000000000001','00350000-0000-0000-0000-000000000100','A Approved','Approved',80000,'00350000-0000-0000-0000-0000000000a1'),
  ('00350000-0000-0000-0000-000000000011','00350000-0000-0000-0000-000000000001','00350000-0000-0000-0000-000000000100','A QuoteSel','Quote Selected',40000,'00350000-0000-0000-0000-0000000000a1'),
  ('00350000-0000-0000-0000-000000000012','00350000-0000-0000-0000-000000000001','00350000-0000-0000-0000-000000000100','A Requested','Requested',10000,'00350000-0000-0000-0000-0000000000a1');

-- Org B: an Approved row on the like-named project — must be invisible to org A.
insert into procurements (id, org_id, project_id, title, status, total_value, requested_by_id) values
  ('00350000-0000-0000-0000-000000000020','00350000-0000-0000-0000-000000000002','00350000-0000-0000-0000-000000000200','B Approved','Approved',999999,'00350000-0000-0000-0000-0000000000a1');

-- Read as an org-A authenticated user: the client query getProjectReservedSpend runs
--   select total_value from procurements where project_id = $1 and status in (RESERVED_STATUSES)
-- with org scoping enforced solely by RLS (org_id = auth_org_id()).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00350000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-RB-002: org A sees only its own reserved rows (80k + 40k = 120k); org B's 999999 is invisible.
select is(
  (select coalesce(sum(total_value),0)::numeric
     from procurements
     where project_id = '00350000-0000-0000-0000-000000000100'
       and status in ('Approved','Vendor Quoted','Quote Selected')),
  120000::numeric,
  'AC-RB-002: org A reserved sum = 120000 (RLS excludes org B''s like-named project row)');

-- AC-RB-002: the org-B reserved row is NOT visible to org A at all (RLS row hiding).
select is(
  (select count(*)::int from procurements where id = '00350000-0000-0000-0000-000000000020'),
  0,
  'AC-RB-002: org B reserved row is invisible to an org A reader (RLS)');

-- AC-RB-001 contract (cross-check at SQL): the Requested row is excluded from reserved.
select is(
  (select count(*)::int
     from procurements
     where project_id = '00350000-0000-0000-0000-000000000100'
       and id = '00350000-0000-0000-0000-000000000012'
       and status in ('Approved','Vendor Quoted','Quote Selected')),
  0,
  'AC-RB-002: Requested status is NOT in the reserved set');

reset role;

-- Reserved and Committed sets are disjoint at the data layer (no status in both).
select ok(
  not exists (
    select 1 from (values ('Approved'),('Vendor Quoted'),('Quote Selected')) r(s)
    where r.s in ('Ordered','Received','Vendor Invoiced','Paid')
  ),
  'AC-RB-002: reserved set is disjoint from committed set');

select * from finish();
rollback;
```
> Note: confirm `projects` requires no extra NOT-NULL columns in this schema; if the committed test's
> fixtures omit `projects` rows, follow its exact column list. Adjust columns to match the live `projects`
> insert shape used elsewhere in `supabase/tests/` if `name`/`code` differ.
**Verify (must PASS):** `supabase test db` (run from repo root) — or `supabase db reset && supabase test db`.

---

### Phase B — Panel: thread `status`, reserved read, Available/Reserved tiles, per-stage math

#### Task B1 — RED: panel Available formula + visibility + tiles tests (AC-RB-004..009)
**File:** `pmo-portal/pages/procurement/DecisionSupportPanel.test.tsx`. Update the two `vi.mock` blocks to also
expose `useProjectReservedSpend`, add a `reservedState`, reset it in `beforeEach`, and add the `status` prop to
`renderPanel` calls (default `'Requested'` so existing tests stay visible). Then add:
```ts
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => committedState,
  useProjectReservedSpend: () => reservedState,
}));
const reservedState = { data: 0 as number | undefined, isPending: false, isError: false };
// in beforeEach: reservedState.data = 0; reservedState.isPending = false; reservedState.isError = false;

describe('AC-RB-004 — Available = Budget − Committed − Reserved', () => {
  it('AC-RB-004: shows Available $500 for budget 1000 / committed 300 / reserved 200', () => {
    budgetState.data = 1000; committedState.data = 300; reservedState.data = 200;
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested' });
    expect(screen.getByText(/available/i)).toBeInTheDocument();
    expect(screen.getByText(/\$500\b/)).toBeInTheDocument();
  });
  it('AC-RB-004: Available tile uses neg tone when negative', () => {
    budgetState.data = 1000; committedState.data = 800; reservedState.data = 400; // available = -200
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested' });
    const neg = screen.getByText(/-?\$200/);
    expect(neg.className).toMatch(/destructive/);
  });
});

describe('AC-RB-005 — Reserved tile shows other-reserved, never "encumbered"', () => {
  it('AC-RB-005: total reserved 200, this case 50 (Approved) → tile shows $150', () => {
    budgetState.data = 1000; committedState.data = 0; reservedState.data = 200;
    const { container } = renderPanel({ projectId: 'p1', totalValue: 50, projectName: 'X', status: 'Approved' });
    expect(screen.getByText(/^reserved$/i)).toBeInTheDocument();
    expect(screen.getByText(/\$150\b/)).toBeInTheDocument();
    expect(screen.getByText(/approved, not yet ordered/i)).toBeInTheDocument();
    expect(container.textContent?.toLowerCase()).not.toMatch(/encumber/);
  });
});

describe('AC-RB-006 — After = Available − thisRequest at Requested', () => {
  it('AC-RB-006: available 500 (budget 700, committed 100, reserved 100), thisRequest 120 → After $380', () => {
    budgetState.data = 700; committedState.data = 100; reservedState.data = 100;
    renderPanel({ projectId: 'p1', totalValue: 120, projectName: 'X', status: 'Requested' });
    expect(screen.getByText(/after this request/i)).toBeInTheDocument();
    expect(screen.getByText(/\$380\b/)).toBeInTheDocument();
  });
});

describe('AC-RB-007 — After = Available at Approved (no double-subtract)', () => {
  it('AC-RB-007: this case 120 already in reserved → After equals Available $500, NOT $380', () => {
    budgetState.data = 700; committedState.data = 100; reservedState.data = 100; // available = 500
    renderPanel({ projectId: 'p1', totalValue: 120, projectName: 'X', status: 'Approved' });
    expect(screen.getByText(/\$500\b/)).toBeInTheDocument();
    expect(screen.queryByText(/\$380\b/)).not.toBeInTheDocument();
  });
});

describe('AC-RB-008 — panel visible Draft..Quote Selected', () => {
  it.each(['Draft','Requested','Approved','Vendor Quoted','Quote Selected'] as const)(
    'AC-RB-008: shows the Budget-impact card at status %s', (status) => {
      budgetState.data = 1000; committedState.data = 0; reservedState.data = 0;
      renderPanel({ projectId: 'p1', totalValue: 10, projectName: 'X', status });
      expect(screen.getByRole('heading', { name: /budget impact/i })).toBeInTheDocument();
    });
});

describe('AC-RB-009 — panel hidden Ordered..terminal', () => {
  it.each(['Ordered','Received','Vendor Invoiced','Paid','Rejected','Cancelled'] as const)(
    'AC-RB-009: renders nothing at status %s', (status) => {
      budgetState.data = 1000; committedState.data = 0; reservedState.data = 0;
      const { container } = renderPanel({ projectId: 'p1', totalValue: 10, projectName: 'X', status });
      expect(container.firstChild).toBeNull();
    });
});
```
> Existing tests (AC-IXD-PROC-W5-2a..g) must keep compiling: add `status: 'Requested'` to every `renderPanel`
> call already in the file, and update the "Remaining vs. committed" expectations only if a label changes
> (the existing four tiles remain; we are ADDING Reserved + Available — see B2 for the final tile list).
**Verify (must FAIL — panel has no `status` prop yet):**
`cd pmo-portal && npx vitest run pages/procurement/DecisionSupportPanel.test.tsx`

#### Task B2 — GREEN: panel — `status` prop, reserved read, visibility, tiles, per-stage math (AC-RB-004..009, FR-RB-010..021)
**File:** `pmo-portal/pages/procurement/DecisionSupportPanel.tsx`.
1. Import: add `useProjectReservedSpend` to the `useProcurements` import (line 27); add
   `import { RESERVED_STATUSES } from '@/src/lib/db/procurements';` and
   `import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';`.
2. Props: add `status: ProcurementStatus;` to `DecisionSupportPanelProps`; destructure `status`.
3. Call the third hook unconditionally next to the others:
   `const reservedQ = useProjectReservedSpend(projectId);`
4. After `if (!projectId) return null;` add the visibility gate:
   ```ts
   const PANEL_VISIBLE_STATUSES: ProcurementStatus[] =
     ['Draft', 'Requested', 'Approved', 'Vendor Quoted', 'Quote Selected'];
   if (!PANEL_VISIBLE_STATUSES.includes(status)) return null;
   ```
5. Fold reserved into pending/error: `const isPending = budget.isPending || committed.isPending || reservedQ.isPending;`
   and `const isError = budget.isError || committed.isError || reservedQ.isError;`.
6. After `const committedSpend = committed.data ?? 0;` compute the derived values from the **Type contract**
   section (`reserved`, `available`, `caseInReserved`, `afterRequest`, `otherReserved`).
7. Replace the `tiles` array. Keep "This request" and "Project budget"; replace
   "Remaining vs. committed" semantics with the new layer. Final five-tile order:
   ```ts
   const afterPct = budgetAmount > 0 ? (afterRequest / budgetAmount) * 100 : 0;
   const tiles = [
     { label: 'This request', value: formatCurrency(totalValue) },
     { label: 'Reserved', value: formatCurrency(otherReserved), sub: 'approved, not yet ordered' },
     { label: 'Available', value: formatCurrency(available),
       tone: available < 0 ? ('neg' as const) : undefined },
     { label: 'Project budget', value: formatCurrency(budgetAmount) },
     { label: 'After this request', value: formatCurrency(afterRequest),
       sub: `${afterPct.toFixed(1)}% headroom remaining`,
       tone: afterRequest < 0 ? ('neg' as const) : undefined },
   ];
   ```
   (Use `<StatTiles tiles={tiles} columns={3} />` or leave default — confirm with the rendered review;
   layout is not asserted by tests, only labels/values.)
**Verify (B1 + existing PASS):** `cd pmo-portal && npx vitest run pages/procurement/DecisionSupportPanel.test.tsx`

#### Task B3 — thread `status` through `ProcurementOverviewTab` (FR-RB-021)
**File:** `pmo-portal/pages/procurement/ProcurementOverviewTab.tsx`.
- Add `import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';`.
- Add `status: ProcurementStatus;` to `ProcurementOverviewTabProps`; destructure it; pass `status={status}`
  into `<DecisionSupportPanel ... />`.
**File:** `pmo-portal/pages/procurement/ProcurementOverviewTab.test.tsx` — add `status: 'Requested'` (or a valid
value) to the props in its render helper so it still type-checks.
**Verify:** `cd pmo-portal && npx vitest run pages/procurement/ProcurementOverviewTab.test.tsx && npx tsc --noEmit`

#### Task B4 — pass `p.status` from `ProcurementDetails` (FR-RB-021)
**File:** `pmo-portal/pages/ProcurementDetails.tsx`, the `<ProcurementOverviewTab>` render (line ~817).
Add `status={p.status}` alongside `totalValue={Number(p.total_value)}`. (`p.status` is `ProcurementStatus`.)
**Verify (typecheck):** `cd pmo-portal && npx tsc --noEmit`

---

### Phase C — Panel states + advisories (preserve existing, add reserved-aware advisory)

#### Task C1 — RED: loading / error / no-budget states still hold with reserved read (AC-RB-010..012)
**File:** `pmo-portal/pages/procurement/DecisionSupportPanel.test.tsx`. Add:
```ts
describe('AC-RB-010 — loading state (reserved read pending)', () => {
  it('AC-RB-010: shows skeleton, no tiles, when reserved read is pending', () => {
    budgetState.data = 1000; committedState.data = 0; reservedState.isPending = true;
    renderPanel({ projectId: 'p1', totalValue: 10, projectName: 'X', status: 'Requested' });
    expect(document.querySelectorAll('.skel').length).toBeGreaterThan(0);
    expect(screen.queryByText(/this request/i)).not.toBeInTheDocument();
  });
});
describe('AC-RB-011 — error state (reserved read error)', () => {
  it('AC-RB-011: shows "budget unavailable", no tiles, when reserved read errors', () => {
    budgetState.data = 1000; reservedState.isError = true;
    renderPanel({ projectId: 'p1', totalValue: 10, projectName: 'X', status: 'Requested' });
    expect(screen.getByText(/budget unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/this request/i)).not.toBeInTheDocument();
  });
});
describe('AC-RB-012 — no-budget state', () => {
  it('AC-RB-012: budget 0 shows "no active budget", no reserved/available figures', () => {
    budgetState.data = 0; reservedState.data = 500;
    renderPanel({ projectId: 'p1', totalValue: 10, projectName: 'X', status: 'Requested' });
    expect(screen.getByText(/no active budget/i)).toBeInTheDocument();
    expect(screen.queryByText(/available/i)).not.toBeInTheDocument();
  });
});
```
**Verify:** these PASS already after B2 (states fold reserved into pending/error and the no-budget guard
precedes tile compute). If any FAIL, fix the panel guard ordering in B2 — do NOT weaken the test.
`cd pmo-portal && npx vitest run pages/procurement/DecisionSupportPanel.test.tsx`

#### Task C2 — RED: over-available advisory at Requested (AC-RB-013, FR-RB-040)
**File:** `pmo-portal/pages/procurement/DecisionSupportPanel.test.tsx`. Add:
```ts
describe('AC-RB-013 — over-available advisory at Requested', () => {
  it('AC-RB-013: status Requested, available 100, thisRequest 250 → role=status advisory, over by $150, approval still permitted', () => {
    budgetState.data = 100; committedState.data = 0; reservedState.data = 0; // available = 100
    renderPanel({ projectId: 'p1', totalValue: 250, projectName: 'X', status: 'Requested' });
    const advisory = screen.getByRole('status');
    expect(advisory.textContent).toMatch(/exceeds available budget/i);
    expect(advisory.textContent).toMatch(/\$150\b/);
    expect(advisory.textContent).toMatch(/advisory only|still permitted/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
```
**Verify (must FAIL — advisory copy/logic not updated):**
`cd pmo-portal && npx vitest run pages/procurement/DecisionSupportPanel.test.tsx`

#### Task C3 — RED: no-false-advisory + over-budget info at Approved (AC-RB-014, FR-RB-041)
**File:** same test file. Add:
```ts
describe('AC-RB-014 — already-reserved: no false advisory; over-budget info instead', () => {
  it('AC-RB-014: Approved with available >= 0 → no over-available advisory based on thisRequest', () => {
    budgetState.data = 1000; committedState.data = 0; reservedState.data = 200; // available 800 ≥ 0
    renderPanel({ projectId: 'p1', totalValue: 999, projectName: 'X', status: 'Approved' });
    expect(screen.queryByText(/exceeds available budget/i)).not.toBeInTheDocument();
  });
  it('AC-RB-014: Approved with available < 0 → over-budget advisory by |available|', () => {
    budgetState.data = 1000; committedState.data = 900; reservedState.data = 300; // available -200
    renderPanel({ projectId: 'p1', totalValue: 50, projectName: 'X', status: 'Approved' });
    const advisory = screen.getByRole('status');
    expect(advisory.textContent).toMatch(/over budget/i);
    expect(advisory.textContent).toMatch(/\$200\b/);
  });
});
```
**Verify (must FAIL):** `cd pmo-portal && npx vitest run pages/procurement/DecisionSupportPanel.test.tsx`

#### Task C4 — GREEN: replace the advisory block with the reserved-aware branch (AC-RB-013, AC-RB-014, FR-RB-040/041)
**File:** `pmo-portal/pages/procurement/DecisionSupportPanel.tsx`. Replace the existing
`isOverBudget`/`overageAmount` derivation and the `{isOverBudget && <ErrBanner .../>}` block with:
```ts
// FR-RB-040: only when NOT already in Reserved (Draft/Requested) AND request exceeds available.
const overAvailable = !caseInReserved && totalValue > available;
const overAvailableAmount = overAvailable ? totalValue - available : 0;
// FR-RB-041: when already in Reserved, no thisRequest-based advisory; show over-budget info if available<0.
const overBudgetReserved = caseInReserved && available < 0;
```
```tsx
{overAvailable && (
  <ErrBanner
    className="mt-3 mb-0"
    title="Over available budget"
    sub={<>This request exceeds available budget by{' '}
      <strong className="tabular">{formatCurrency(overAvailableAmount)}</strong>. Approval is still
      permitted — this is an advisory only.</>}
  />
)}
{overBudgetReserved && (
  <ErrBanner
    className="mt-3 mb-0"
    title="Project over budget"
    sub={<>This project is over budget by{' '}
      <strong className="tabular">{formatCurrency(-available)}</strong> across committed and reserved
      demand. This is an advisory only.</>}
  />
)}
```
(`ErrBanner` is already `role="status"` — verify it renders `role="status"`; the existing test relied on that.)
**Verify (C2 + C3 + all prior PASS):** `cd pmo-portal && npx vitest run pages/procurement/DecisionSupportPanel.test.tsx`

---

### Phase D — Full verify + rendered review

#### Task D1 — Full suite gate (binding pre-push)
**Verify (ALL must PASS):** `cd pmo-portal && npm run verify`
(= `typecheck && lint:ci && test && build`. Targeted runs above were the inner loop; this is the gate.)

#### Task D2 — pgTAP suite
**Verify:** from repo root — `supabase db reset && supabase test db` (the new `0035` must pass; the existing
committed `0020` + drift guard must stay green, proving no ripple).

#### Task D3 — Rendered review (UI correctness — verify-green ≠ visually-correct)
Render `/procurement/:id` for a case at **Requested** (panel visible, advisory when over), at **Approved**
(Reserved tile shows OTHER reserved; After == Available), and at **Ordered** (panel ABSENT). Confirm five
tiles read cleanly and no "encumber" text appears. (Director/design-reviewer pass per ADR-0030; no new e2e.)

---

## Traceability (one owning layer per AC — ADR-0010)
| AC | Behavior | Owning layer | File | Task |
|----|----------|--------------|------|------|
| AC-RB-001 | Reserved sum over status set | Unit (Vitest, mocked) | `src/lib/db/procurements.test.ts` | A1/A2 |
| AC-RB-002 | Reserved org-scoping (RLS) | pgTAP | `supabase/tests/0035_procurement_reserved_spend.test.sql` | A5 |
| AC-RB-003 | Committed unchanged & disjoint | Unit (set assertion) | `src/lib/db/procurements.test.ts` | A3 |
| AC-RB-004 | Available = Budget − Committed − Reserved | Unit (RTL) | `DecisionSupportPanel.test.tsx` | B1/B2 |
| AC-RB-005 | Other-reserved tile, no "encumbered" | Unit (RTL) | `DecisionSupportPanel.test.tsx` | B1/B2 |
| AC-RB-006 | After = Available − thisRequest (Requested) | Unit (RTL) | `DecisionSupportPanel.test.tsx` | B1/B2 |
| AC-RB-007 | After = Available (Approved, no double-count) | Unit (RTL) | `DecisionSupportPanel.test.tsx` | B1/B2 |
| AC-RB-008 | Panel visible Draft..Quote Selected | Unit (RTL) | `DecisionSupportPanel.test.tsx` | B1/B2 |
| AC-RB-009 | Panel hidden Ordered..terminal | Unit (RTL) | `DecisionSupportPanel.test.tsx` | B1/B2 |
| AC-RB-010 | Loading state | Unit (RTL) | `DecisionSupportPanel.test.tsx` | C1 |
| AC-RB-011 | Error state | Unit (RTL) | `DecisionSupportPanel.test.tsx` | C1 |
| AC-RB-012 | No-budget state | Unit (RTL) | `DecisionSupportPanel.test.tsx` | C1 |
| AC-RB-013 | Over-available advisory (Requested) | Unit (RTL) | `DecisionSupportPanel.test.tsx` | C2/C4 |
| AC-RB-014 | No false advisory / over-budget info (Approved) | Unit (RTL) | `DecisionSupportPanel.test.tsx` | C3/C4 |

**No new E2E** (ADR-0010): the panel is a read-only derivation; math/states are unit-owned, tenancy is pgTAP-owned.

## Traceability summary (1-line)
All 14 ACs covered: AC-RB-001/003 unit (DAL), AC-RB-002 pgTAP (RLS), AC-RB-004..014 unit (RTL panel) — every owning
test names its `AC-RB-###` in its title; no AC pushed up a layer; no new e2e.
