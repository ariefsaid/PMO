# Delivery UI Redesign (spine-3 UI fix) — implementation plan

Date: 2026-06-12  
Spec: `./docs/specs/delivery-milestones.spec.md`  
Approved design: `./docs/design/delivery-redesign-plan.md`  
Audit to close: `./docs/design/delivery-feature-audit.md`  
Visual reference: `./docs/design-mockups/delivery-redesign.html`

## Scope

### In
- Rebuild `pmo-portal/pages/project-detail/MilestoneStrip.tsx` to the approved one-bar, four-even-segment stepper.
- Keep milestone semantics locked by the spec/OD-DEL-1..8: effective % = `input_pct ?? calculated_pct ?? 0`, weighted project rollup, PM/Admin writes, no gates.
- Change the Projects list so **Progress = delivery %** and add a **Budget used** column sourced from committed procurement spend, not `projects.spent`.
- Remove the project-title delivery chip from `pmo-portal/pages/Projects.tsx`.
- Change `pmo-portal/pages/project-detail/tabs/TasksTab.tsx` milestone group headers to **name + target only**.
- Restyle `pmo-portal/components/DeliveryPctChip.tsx` into the dashboard mini-bar treatment.
- Preserve existing loading / error / empty / delete-confirm / engineer-read-only states.
- Keep the inline edit as single-click + toast, but move the field onto the DESIGN.md `input` token.

### Out
- No `project_milestones` table change; `weight` and `input_pct` already exist.
- No new milestone business rules.
- No gating / stage-blocking.
- No org-level milestone templates.
- No Storybook work in this issue; the shared component will be covered by RTL tests instead.

## Architectural decisions

### 1) Committed-spend path: **extend `get_projects_delivery(p_ids)`**

Use the existing batched delivery RPC and extend it to return `committed_spend` and `budget` per project. This keeps the Projects page on one round-trip, avoids a second batched RPC and avoids duplicating the weighted-rollup math inside `listProjects()`. The function remains **`security invoker`**, **`set search_path = public`**, **no `org_id` argument**, and **`anon` revoked**, so org scoping still comes from RLS on `projects` and `procurements`. The committed basis is the locked procurement basis from `getProjectCommittedSpend()` / `0022_finance_budget_debt.sql`: `sum(procurements.total_value)` where status is one of `('Ordered','Received','Vendor Invoiced','Paid')`. The frontend will consume that summary through the repository seam: keep `useProjectsDelivery()` for existing delivery-only callers, add a summary query in the same hook module for the Projects page, and compute `budgetUsedPct = committed_spend / budget` in the page layer.

**SQL to ship in `supabase/migrations/0023_delivery_milestones.sql`:**

```sql
create or replace function get_projects_delivery(p_ids uuid[])
  returns table (
    project_id uuid,
    delivery_pct numeric,
    committed_spend numeric,
    budget numeric
  )
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with eff as (
    select
      m.project_id,
      m.weight,
      coalesce(
        m.input_pct,
        count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0),
        0
      ) as effective_pct,
      (m.input_pct is not null or count(t.id) > 0) as has_signal
    from project_milestones m
    left join tasks t on t.milestone_id = m.id
    where m.project_id = any(p_ids)
    group by m.id
  ),
  committed as (
    select
      p.id as project_id,
      p.budget,
      coalesce(sum(pr.total_value), 0) as committed_spend
    from projects p
    left join procurements pr
      on pr.project_id = p.id
     and pr.status in ('Ordered', 'Received', 'Vendor Invoiced', 'Paid')
    where p.id = any(p_ids)
    group by p.id, p.budget
  )
  select
    c.project_id,
    case
      when bool_or(e.has_signal) then sum(e.weight * e.effective_pct) / nullif(sum(e.weight), 0)
      else null
    end as delivery_pct,
    c.committed_spend,
    c.budget
  from committed c
  left join eff e on e.project_id = c.project_id
  group by c.project_id, c.committed_spend, c.budget;
$$;

revoke all     on function get_projects_delivery(uuid[]) from public;
grant  execute on function get_projects_delivery(uuid[]) to authenticated;
revoke execute on function get_projects_delivery(uuid[]) from anon;
```

### 2) Shared component: **extract `MilestonePhaseHeader`**

Yes: extract one presentational component because the redesign makes the same milestone identity block appear in the stepper and in the Tasks tab, and the audit already flagged the divergence. The shared component will have two explicit variants: `stepper` (name, effective %, target, from-tasks line, overdue/current/edit affordances) and `compact` (name + target only). This keeps the visual contract in one place, lets RTL own the matrix, and prevents a second drift the next time the strip and grouped tasks are edited independently. The modal does not need to consume it in this issue; the component is still the correct seam because it keeps the modal free to add a preview later without re-copying the markup.

## Design summary

- **Data flow**
  - Projects page loads `useProjects()` as today.
  - In parallel it loads `useProjectsDeliverySummary(ids)` from the extended `get_projects_delivery()` RPC.
  - `Projects.tsx` renders:
    - `Progress` from `delivery_pct`.
    - `Budget used` from `committed_spend / budget`.
  - PM dashboard keeps using `useProjectsDelivery()` and the repurposed `DeliveryPctChip` mini-bar.
- **Milestone strip**
  - Use semantic ordered-list markup (`<ol><li>`).
  - Single 12px segmented track, four even cells, fill width = effective %.
  - Label stack per phase: name, big effective %, `Target DD Mon`, `From tasks N%`, `Edit progress` for PM/Admin only.
  - `Current` micro-label on first incomplete milestone.
  - Overdue = `target_date < today && effective_pct < 100`.
- **Tasks tab**
  - Grouping logic stays the same.
  - Compact milestone header becomes name + target only; remove the percentage pill.
- **Accessibility**
  - Preserve keyboard-reachable edit affordances on every phase for PM/Admin.
  - Preserve a stable `aria-label="Delivery {n}%"` on the Projects progress cell so `AC-DEL-022` does not need a locator rewrite.
- **Performance**
  - Still one batched delivery query for the list page.
  - No N+1 procurement lookups.
- **Error handling**
  - Keep `classifyMutationError()` for inline edits and deletes.
  - Keep the strip loading/error/empty states; only the internal markup changes.

## Traceability

| Task | Files | ACs | Owning test(s) |
|---|---|---|---|
| 1 | `supabase/tests/0066_projects_delivery_summary.test.sql` | AC-DEL-017 | pgTAP `AC-DEL-017: get_projects_delivery returns delivery + committed spend scoped to the caller org` |
| 2 | `supabase/migrations/0023_delivery_milestones.sql`, `pmo-portal/src/lib/supabase/database.types.ts` | AC-DEL-017 | task 1 test |
| 3 | `pmo-portal/src/lib/db/milestones.test.ts`, `pmo-portal/src/hooks/useProjectsDelivery.test.tsx`, `pmo-portal/src/lib/repositories/index.test.ts` | AC-DEL-017 | new/updated unit tests in those files |
| 4 | `pmo-portal/src/lib/db/milestones.ts`, `pmo-portal/src/lib/repositories/types.ts`, `pmo-portal/src/lib/repositories/index.ts`, `pmo-portal/src/hooks/useProjectsDelivery.ts` | AC-DEL-017 | task 3 tests |
| 5 | `pmo-portal/pages/__tests__/Projects.deliveryBudget.test.tsx` | AC-DEL-013, AC-DEL-017 | RTL page test |
| 6 | `pmo-portal/pages/Projects.tsx` | AC-DEL-013, AC-DEL-017 | task 5 test |
| 7 | `pmo-portal/pages/project-detail/__tests__/MilestonePhaseHeader.test.tsx` | AC-DEL-008, AC-DEL-009, AC-DEL-010, AC-DEL-012 | RTL shared-component test |
| 8 | `pmo-portal/src/components/milestones/MilestonePhaseHeader.tsx` | AC-DEL-008, AC-DEL-009, AC-DEL-010, AC-DEL-012 | task 7 test |
| 9 | `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.display.test.tsx`, `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.atRisk.test.tsx` | AC-DEL-008, AC-DEL-009 | updated/new RTL strip display tests |
| 10 | `pmo-portal/pages/project-detail/MilestoneStrip.tsx` | AC-DEL-008, AC-DEL-009 | task 9 tests |
| 11 | `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.inlineEdit.test.tsx`, `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.states.test.tsx`, `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.deleteConfirm.test.tsx` | AC-DEL-012, AC-DEL-014 | updated/new RTL state tests |
| 12 | `pmo-portal/pages/project-detail/MilestoneStrip.tsx` | AC-DEL-012, AC-DEL-014 | task 11 tests |
| 13 | `pmo-portal/pages/project-detail/__tests__/TasksTab.grouping.test.tsx` | AC-DEL-010 | updated RTL grouping/header test |
| 14 | `pmo-portal/pages/project-detail/tabs/TasksTab.tsx` | AC-DEL-010 | task 13 test |
| 15 | `pmo-portal/components/__tests__/DeliveryPctChip.test.tsx`, `pmo-portal/src/components/dashboard/__tests__/PMDashboard.deliveryMiniBar.test.tsx` | AC-DEL-013, AC-DEL-017 | RTL component/dashboard tests |
| 16 | `pmo-portal/components/DeliveryPctChip.tsx`, `pmo-portal/src/components/dashboard/PMDashboard.tsx` | AC-DEL-013, AC-DEL-017 | task 15 tests |

## Task plan

### Task 1 — Add the failing pgTAP proof for the extended delivery summary RPC
**Files**
- `supabase/tests/0066_projects_delivery_summary.test.sql`

**Test first**
- Add a new pgTAP file that seeds:
  - one in-org project with milestones and procurements,
  - one out-of-org project,
  - procurements in `Ordered`, `Received`, `Vendor Invoiced`, `Paid`, and one ignored row in `Draft`.
- Add assertions that `get_projects_delivery(array[p1])` returns:
  - the existing weighted `delivery_pct`,
  - `committed_spend = sum(total_value)` of the four committed statuses only,
  - the project `budget`,
  - no row for the other org while running as the authenticated org-A PM.
- Use a leading AC title such as `AC-DEL-017: get_projects_delivery returns delivery + committed spend scoped to the caller org`.

**Implementation next**
- None in this task.

**Verify**
- `supabase test db --filter 0066_projects_delivery_summary`

### Task 2 — Extend the SQL function and generated TS return type
**Files**
- `supabase/migrations/0023_delivery_milestones.sql`
- `pmo-portal/src/lib/supabase/database.types.ts`

**Implementation**
- Replace the existing `get_projects_delivery()` body with the SQL in Decision 1.
- Update the generated TS function return in `database.types.ts` from:

```ts
Returns: { delivery_pct: number; project_id: string }[]
```

to:

```ts
Returns: {
  budget: number
  committed_spend: number
  delivery_pct: number
  project_id: string
}[]
```

**Verify**
- `supabase test db --filter 0066_projects_delivery_summary`

### Task 3 — Add the failing DAL, repository, and hook tests for the richer summary shape
**Files**
- `pmo-portal/src/lib/db/milestones.test.ts`
- `pmo-portal/src/lib/repositories/index.test.ts`
- `pmo-portal/src/hooks/useProjectsDelivery.test.tsx`

**Test first**
- In `milestones.test.ts`:
  - keep the existing `getProjectsDelivery()` behavior test,
  - add a new `getProjectsDeliverySummary()` test that expects `{ p1: { deliveryPct: 75, committedSpend: 500000, budget: 900000 } }` from the richer RPC row.
- In `index.test.ts`:
  - add `repositories.milestone.deliverySummaryForProjects(ids)` delegation coverage.
- In `useProjectsDelivery.test.tsx`:
  - add `useProjectsDeliverySummary(ids)` returning the summary map,
  - keep `useProjectsDelivery(ids)` returning the delivery-only map for PM dashboard callers.

**Implementation next**
- None in this task.

**Verify**
- `cd pmo-portal && npm test -- src/lib/db/milestones.test.ts src/lib/repositories/index.test.ts src/hooks/useProjectsDelivery.test.tsx`

### Task 4 — Wire the richer summary through the DAL, repository seam, and hook module
**Files**
- `pmo-portal/src/lib/db/milestones.ts`
- `pmo-portal/src/lib/repositories/types.ts`
- `pmo-portal/src/lib/repositories/index.ts`
- `pmo-portal/src/hooks/useProjectsDelivery.ts`

**Implementation**
- Add a summary type and mapper in `milestones.ts`:

```ts
export interface ProjectDeliverySummary {
  deliveryPct: number | null;
  committedSpend: number;
  budget: number;
}

export async function getProjectsDeliverySummary(ids: string[]): Promise<Record<string, ProjectDeliverySummary>>
```

- Keep `getProjectsDelivery(ids)` as a thin adapter over the summary result:

```ts
const summary = await getProjectsDeliverySummary(ids);
return Object.fromEntries(
  Object.entries(summary)
    .filter(([, row]) => row.deliveryPct != null)
    .map(([id, row]) => [id, row.deliveryPct as number]),
);
```

- Extend the repository contract with:

```ts
deliverySummaryForProjects: (ids: string[]) => Promise<Record<string, ProjectDeliverySummary>>;
```

- In `useProjectsDelivery.ts`, export both hooks:
  - `useProjectsDelivery(ids)` for delivery-only callers,
  - `useProjectsDeliverySummary(ids)` for `Projects.tsx`.
- Keep the query-key root `['projects-delivery', ...]` so `useMilestoneMutations()` invalidation still refreshes both views.

**Verify**
- `cd pmo-portal && npm test -- src/lib/db/milestones.test.ts src/lib/repositories/index.test.ts src/hooks/useProjectsDelivery.test.tsx`

### Task 5 — Add the failing Projects page test for delivery progress + budget used
**Files**
- `pmo-portal/pages/__tests__/Projects.deliveryBudget.test.tsx`

**Test first**
- Mock:
  - `useProjects()` with two rows,
  - `useProjectsDeliverySummary()` with one populated delivery/committed row and one `deliveryPct: null` row.
- Assert all of the redesign outcomes:
  - the project-title metadata line no longer contains a `DeliveryPctChip`,
  - the `Progress` column exposes `aria-label="Delivery 50%"` and renders `50%`,
  - the new `Budget used` column renders `53%` and `$2.0M of $3.8M budget`,
  - a no-milestones row renders `No phases yet`,
  - the status pill for `Ongoing Project` keeps the non-green `open`/neutral variant.

**Verify**
- `cd pmo-portal && npm test -- pages/__tests__/Projects.deliveryBudget.test.tsx`

### Task 6 — Implement the Projects list redesign
**Files**
- `pmo-portal/pages/Projects.tsx`

**Implementation**
- Replace the title-line chip import and render.
- Swap the page data source from `useProjectsDelivery()` to `useProjectsDeliverySummary()`.
- Change the progress cell to delivery, not `utilizationPct(p)`.
- Add a `Budget used` column with bar + subline.
- Preserve the stable label for e2e by rendering the progress wrapper like:

```tsx
<div aria-label={`Delivery ${roundedDelivery}%`} className="flex flex-col gap-0.5">
  <ProgressBar value={roundedDelivery} showValue compact />
</div>
```

- Compute budget used in the page layer:

```ts
const budgetUsedPct = summary?.budget > 0
  ? Math.round((summary.committedSpend / summary.budget) * 100)
  : 0;
```

- Render the subline as `formatCurrency(summary.committedSpend)` + `of` + `formatCurrency(summary.budget)` + `budget`.
- Leave the existing `pillVariantForProjectStatus()` call in place; it already gives `open` for `Ongoing Project`, which satisfies the redesign without new status logic.

**Verify**
- `cd pmo-portal && npm test -- pages/__tests__/Projects.deliveryBudget.test.tsx`

### Task 7 — Add the failing shared milestone-header tests
**Files**
- `pmo-portal/pages/project-detail/__tests__/MilestonePhaseHeader.test.tsx`

**Test first**
- Add one test for `variant="stepper"` asserting:
  - phase name,
  - big effective `%`,
  - `Target DD Mon`,
  - `From tasks N%`,
  - `Current` micro-label when requested,
  - `Overdue` pill and warning target class when overdue,
  - `Edit progress` button for PM/Admin only.
- Add one test for `variant="compact"` asserting:
  - name + `Target DD Mon` are present,
  - no percent and no edit affordance are rendered.

**Verify**
- `cd pmo-portal && npm test -- pages/project-detail/__tests__/MilestonePhaseHeader.test.tsx`

### Task 8 — Implement the shared `MilestonePhaseHeader` component
**Files**
- `pmo-portal/src/components/milestones/MilestonePhaseHeader.tsx`

**Implementation**
- Create a presentational component with an explicit prop shape:

```ts
type MilestonePhaseHeaderProps = {
  variant: 'stepper' | 'compact';
  name: string;
  targetDate: string | null;
  effectivePct: number;
  calculatedPct: number | null;
  isCurrent?: boolean;
  isOverdue?: boolean;
  canEditProgress?: boolean;
  onEditProgress?: () => void;
};
```

- Add a local formatter so every surface renders `Target DD Mon` consistently:

```ts
const formatTargetDate = (value: string | null) =>
  value
    ? `Target ${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(`${value}T00:00:00`))}`
    : null;
```

- `stepper` variant renders:
  - name,
  - big `pct(effectivePct)`,
  - target line,
  - `From tasks ${pct(calculatedPct)}`,
  - optional `Current`, `Overdue`, `Edit progress`.
- `compact` variant renders only name + target.

**Verify**
- `cd pmo-portal && npm test -- pages/project-detail/__tests__/MilestonePhaseHeader.test.tsx`

### Task 9 — Add the failing MilestoneStrip display tests for the stepper layout and overdue state
**Files**
- `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.display.test.tsx`
- `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.atRisk.test.tsx`

**Test first**
- Update `MilestoneStrip.display.test.tsx` so the existing AC-DEL-008 / AC-DEL-009 tests assert the approved oracle:
  - one segmented stepper track exists,
  - the phase block shows the effective `%` headline,
  - the secondary line reads `From tasks 60%` or `From tasks —`,
  - no `PM input` label exists anymore.
- Add `MilestoneStrip.atRisk.test.tsx` asserting a past target + `<100` phase renders `Overdue` and the warning target treatment.

**Verify**
- `cd pmo-portal && npm test -- pages/project-detail/__tests__/MilestoneStrip.display.test.tsx pages/project-detail/__tests__/MilestoneStrip.atRisk.test.tsx`

### Task 10 — Rebuild `MilestoneStrip` around the one-bar stepper
**Files**
- `pmo-portal/pages/project-detail/MilestoneStrip.tsx`

**Implementation**
- Replace the vertical card stack with:

```tsx
<ol className="grid gap-3" aria-label="Delivery phases">
  <li>
    <div className="flex h-3 overflow-hidden rounded-full bg-border">
      {milestones.map((m) => (
        <span key={m.id} className="flex-1 bg-secondary">
          <span className={fillClass(m)} style={{ width: `${Math.max(0, Math.min(100, m.effective_pct))}%` }} />
        </span>
      ))}
    </div>
    <div className="mt-3 grid grid-cols-4 gap-2">...</div>
  </li>
</ol>
```

- Derive `currentMilestoneId` as the first milestone with `effective_pct < 100`.
- Use `MilestonePhaseHeader` for each phase block.
- Keep the existing create button and delete-confirm copy.
- Keep `aria-label`s on edit/delete triggers.

**Verify**
- `cd pmo-portal && npm test -- pages/project-detail/__tests__/MilestoneStrip.display.test.tsx pages/project-detail/__tests__/MilestoneStrip.atRisk.test.tsx`

### Task 11 — Add the failing strip tests for inline edit, states, and delete-confirm
**Files**
- `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.inlineEdit.test.tsx`
- `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.states.test.tsx`
- `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.deleteConfirm.test.tsx`

**Test first**
- In `MilestoneStrip.inlineEdit.test.tsx`, change the PM/Admin oracle from “click PM input cell” to “every phase exposes `Edit progress`”. Assert Engineer still sees none.
- Assert the input uses the field token classes (`h-8`, `rounded-md`, `border-input`).
- In `MilestoneStrip.states.test.tsx`, keep loading/error assertions and update the empty PM copy to the planning prompt text.
- Add `MilestoneStrip.deleteConfirm.test.tsx` asserting the per-phase overflow/delete path still opens the same destructive confirm copy.

**Verify**
- `cd pmo-portal && npm test -- pages/project-detail/__tests__/MilestoneStrip.inlineEdit.test.tsx pages/project-detail/__tests__/MilestoneStrip.states.test.tsx pages/project-detail/__tests__/MilestoneStrip.deleteConfirm.test.tsx`

### Task 12 — Finish the strip interactions and state treatments
**Files**
- `pmo-portal/pages/project-detail/MilestoneStrip.tsx`

**Implementation**
- Replace the raw number field classes with the DESIGN token classes:

```tsx
className="h-8 w-[72px] rounded-md border border-input bg-background px-2.5 text-[13px] tabular"
```

- Render `Edit progress` on **every** phase when `canEdit` is true; omit it entirely for Engineer.
- Use the new empty-state copy and silhouette treatment.
- Move delete into a quiet per-phase overflow button; keep the existing `ConfirmDialog` description unchanged.

**Verify**
- `cd pmo-portal && npm test -- pages/project-detail/__tests__/MilestoneStrip.inlineEdit.test.tsx pages/project-detail/__tests__/MilestoneStrip.states.test.tsx pages/project-detail/__tests__/MilestoneStrip.deleteConfirm.test.tsx`

### Task 13 — Add the failing TasksTab compact-header test
**Files**
- `pmo-portal/pages/project-detail/__tests__/TasksTab.grouping.test.tsx`

**Test first**
- Update the header assertion so the milestone region shows:
  - the milestone name,
  - `Target 15 Aug` (or the seeded date),
  - **no percentage**.
- Keep the existing AC-DEL-010 grouping assertions unchanged.

**Verify**
- `cd pmo-portal && npm test -- pages/project-detail/__tests__/TasksTab.grouping.test.tsx`

### Task 14 — Implement the TasksTab compact milestone header
**Files**
- `pmo-portal/pages/project-detail/tabs/TasksTab.tsx`

**Implementation**
- Swap the current header block for `MilestonePhaseHeader variant="compact"`.
- Remove the blue `%` pill entirely.
- Keep the `Add task` button placement and grouping order unchanged.
- Change the ungrouped label from italic-muted to a normal muted `No milestone` label.

**Verify**
- `cd pmo-portal && npm test -- pages/project-detail/__tests__/TasksTab.grouping.test.tsx pages/project-detail/__tests__/TasksTab.addInGroup.test.tsx`

### Task 15 — Add the failing dashboard mini-bar tests
**Files**
- `pmo-portal/components/__tests__/DeliveryPctChip.test.tsx`
- `pmo-portal/src/components/dashboard/__tests__/PMDashboard.deliveryMiniBar.test.tsx`

**Test first**
- Update `DeliveryPctChip.test.tsx` so the component test expects:
  - null still renders nothing,
  - non-null renders a mini-bar + value pair, not a blue pill.
- Add a dashboard test that renders one PM dashboard row and asserts:
  - the delivery mini-bar appears beside the status pill,
  - the accessible label `Delivery 32%` is preserved.

**Verify**
- `cd pmo-portal && npm test -- components/__tests__/DeliveryPctChip.test.tsx src/components/dashboard/__tests__/PMDashboard.deliveryMiniBar.test.tsx`

### Task 16 — Implement the dashboard mini-bar treatment
**Files**
- `pmo-portal/components/DeliveryPctChip.tsx`
- `pmo-portal/src/components/dashboard/PMDashboard.tsx`

**Implementation**
- Replace the pill markup with a compact neutral mini-bar:

```tsx
return (
  <span aria-label={`Delivery ${rounded}%`} className="inline-flex items-center gap-2">
    <span className="h-1.5 w-12 overflow-hidden rounded-full bg-secondary">
      <span className="block h-full rounded-full bg-primary" style={{ width: `${rounded}%` }} />
    </span>
    <span className="text-[11.5px] font-bold tabular text-foreground">{rounded}%</span>
  </span>
);
```

- Leave PM dashboard call sites unchanged except for any spacing needed around the new inline bar.

**Verify**
- `cd pmo-portal && npm test -- components/__tests__/DeliveryPctChip.test.tsx src/components/dashboard/__tests__/PMDashboard.deliveryMiniBar.test.tsx`

## Audit coverage

| Finding | Plan task(s) |
|---|---|
| F-DEL-01a | 5, 6 |
| F-DEL-01b | 1, 2, 3, 4, 5, 6 |
| F-DEL-02 | 5, 6 |
| F-DEL-03 | 5, 6 |
| F-DEL-04 | 5, 6, 15, 16 |
| F-DEL-05 | 5, 6 |
| F-DEL-06 | 9, 10 |
| F-DEL-07 | 7, 8, 9, 10, 11, 12 |
| F-DEL-08 | 11, 12 |
| F-DEL-09 | 9, 10 |
| F-DEL-10 | 11, 12 |
| F-DEL-11 | 7, 8, 9, 10, 13, 14 |
| F-DEL-12 | 9, 10 |
| F-DEL-13 | 11, 12 |
| F-DEL-14 | no code change in this redesign issue |
| F-DEL-15 | no code change in this redesign issue |
| F-DEL-16 | no code change in this redesign issue |
| F-DEL-17 | no code change in this redesign issue |
| F-DEL-18 | 7, 8, 13, 14 |
| F-DEL-19 | 14 |
| F-DEL-20 | 14 |
| F-DEL-21 | 15, 16 |
| F-DEL-A1 | 7, 8, 9, 10, 11, 12, 14, 16 |
| F-DEL-A2 | 5, 6, 7, 8, 9, 10, 15, 16 |
| F-DEL-A3 | 7, 8, 9, 10, 15, 16 |
| F-DEL-A4 | 7, 8 |

### Deliberate deferrals
- `F-DEL-14` through `F-DEL-17` are modal-field findings, but the owner-approved scope for this issue is the shipped strip/list/dashboard/tasks-tab redesign only. They are not ignored; they are intentionally out of scope for this one-file plan.
- Storybook coverage from the design-plan is deferred; the repo’s test harness for this issue is RTL + pgTAP + the existing curated Playwright journey.

## Final verification sweep

Run these after Task 16 is green:

1. `cd pmo-portal && npm test -- pages/__tests__/Projects.deliveryBudget.test.tsx pages/project-detail/__tests__/MilestonePhaseHeader.test.tsx pages/project-detail/__tests__/MilestoneStrip.display.test.tsx pages/project-detail/__tests__/MilestoneStrip.atRisk.test.tsx pages/project-detail/__tests__/MilestoneStrip.inlineEdit.test.tsx pages/project-detail/__tests__/MilestoneStrip.states.test.tsx pages/project-detail/__tests__/MilestoneStrip.deleteConfirm.test.tsx pages/project-detail/__tests__/TasksTab.grouping.test.tsx components/__tests__/DeliveryPctChip.test.tsx src/components/dashboard/__tests__/PMDashboard.deliveryMiniBar.test.tsx src/lib/db/milestones.test.ts src/lib/repositories/index.test.ts src/hooks/useProjectsDelivery.test.tsx`
2. `supabase test db --filter 0066_projects_delivery_summary`
3. `cd pmo-portal && npm run typecheck`
4. `cd pmo-portal && npm run lint:ci`
5. `cd pmo-portal && npx playwright test e2e/AC-DEL-022-milestone-journey.spec.ts`

## Self-check

- Primary inputs re-read and reflected: approved stepper shape, task-tab no-% header, delivery-as-progress, committed-spend basis, dashboard mini-bar, at-risk state, token-correct input.
- The committed-spend decision is concrete and uses real SQL.
- The plan keeps `AC-DEL-022` stable by preserving `aria-label="Delivery {n}%"` in the Projects progress cell.
- No source edits are proposed outside app code/tests/migrations; no extra docs or ADRs are required for this UI-fix issue.
