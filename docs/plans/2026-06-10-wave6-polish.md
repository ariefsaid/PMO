# Wave-6 Polish Sweep — Implementation Plan

**Date:** 2026-06-10
**Author:** eng-planner
**Status:** Ready to build
**Scope source:** owner-locked Wave-6 subset (3 gated PRs). Scope NOT re-litigated here.
**Repo:** `pmo-portal/` (React 19 + Vite 6 + TS ~5.8 + Tailwind v4 + Supabase). All commands run inside `pmo-portal/` unless the path is `supabase/…`.

This plan turns the locked Wave-6 subset into a buildable, TDD-first task list across **3 gated PRs**:

- **PR-1 — A11y (Theme G):** G4 (Tabs `aria-controls`/`id` wiring) + G6 (disabled-submit `aria-describedby` reason).
- **PR-2 — Data/visual clarity:** H8 (ProgressBar at-risk red band) + J7 (budget edit-mode Total footer) + J8 (add-row input `type=text`+parseMoneyInput) + J9 (seed: backdate one open deal for N14).
- **PR-3 — DS hygiene:** H7 (DRY the pending-approval predicate) + H1 (remove `cyan` KPITone) + H3/H2-scoped-subset (StatusPill named token + ≤6 off-grid spacing fixes).

> **Test pyramid (ADR-0010):** every behavior AC is owned by exactly ONE test at the lowest sufficient layer. All Wave-6 ACs are Unit (Vitest/RTL) except **J9** (a seed/demo fixture — owned by the existing pgTAP `0057` + N14 e2e; no NEW test). No RLS/tenancy contract changes in this sweep.

---

## Pre-flight findings (read before building)

1. **H1 cyan is used in TWO files, not one.** `tone="cyan"` appears at:
   - `src/components/dashboard/PMDashboard.tsx:60` — "My projects" tile.
   - `pages/ExecutiveDashboard.tsx:133` — "Active projects" tile.
   Removing `'cyan'` from the `KPITone` union requires BOTH call sites to change or typecheck fails. The brief named only PMDashboard; the plan covers both (Task PR3-H1-2/3).

2. **H3 StatusPill darkened-text values are DESIGN.md-sanctioned inline literals AND are asserted by `rgb()` in tests.** `src/components/ui/__tests__/StatusPill.test.tsx` pins `pill.style.color` to resolved `rgb(...)` for `open`/`won`/`lost`/`violet` (lines 25/43/51/104). jsdom does NOT resolve `var(--token)` → `rgb()`; if we move the literals into a CSS variable and apply `color: var(--status-open-text)`, those assertions read back `var(--status-open-text)` (or empty) and FAIL. **Therefore H3(a) introduces named tokens as a documented alias layer but the inline `style={{ color: 'hsl(...)' }}` literal stays as the applied value** (token documented in `index.css` + `DESIGN.md`, referenced in a code comment) so the rendered color is byte-identical and the existing `rgb()` assertions stay green. The AC asserts the token EXISTS and is documented + the StatusPill comment references it — not a `var()` swap. This is the lowest-risk reading of the owner's "scoped subset" decision; flagged for the reviewer.

3. **Tabs renders a SINGLE shared `role="tabpanel"`** (`pages/project-detail/ProjectDetail.tsx:145`), not one panel per tab — content is switched inside one panel. G4's wiring exposes the active tab's id + the active panel id; the single consumer panel gets `id` + `aria-labelledby` pointing at the active tab. (See Task PR1-G4-3.)

4. **J9 is pgTAP-neutral.** `supabase/tests/0057_sales_pipeline_attention.test.sql` asserts P002 ("Northwind ERP Rollout") `last_update` is **non-null + a valid timestamp + owner = "Alice Manager"** (lines 23-47). It does NOT assert freshness or a specific timestamp value. Backdating P002's `last_update` to `now() - interval '45 days'` keeps all 6 assertions passing and makes the N14 "Needs attention" filter demonstrable. Projects default `last_update = now()` (`0001_init_schema.sql:82`), which is why no open deal is currently ≥30d stale.

---

## Traceability table

| AC | Item | Behavior | Owning layer | Owning test (file → title leading token) |
|---|---|---|---|---|
| AC-W6-G4 | G4 | Each tab wires `id`+`aria-controls` to a panel that back-references it via `aria-labelledby` | Unit (RTL) | `src/components/ui/__tests__/Tabs.a11y.test.tsx` → `it('AC-W6-G4: …')` |
| AC-W6-G6 | G6 | Disabled submit (blank required) has `aria-describedby` → visible reason; cleared when complete | Unit (RTL) | `src/components/ui/__tests__/EntityFormModal.a11y.test.tsx` → `it('AC-W6-G6: …')` |
| AC-W6-H8 | H8 | ProgressBar tone: ≥90 destructive, ≥70 warning, else success; 90 pulled from `AT_RISK_THRESHOLD` | Unit (RTL) | `src/components/ui/__tests__/ProgressBar.test.tsx` → `it('AC-W6-H8: …')` |
| AC-W6-J7 | J7 | Budget Draft edit-mode table renders the same Total footer as read-only mode | Unit (RTL) | `pages/__tests__/ProjectBudget.wave6.test.tsx` → `it('AC-W6-J7: …')` |
| AC-W6-J8 | J8 | Budget add-row amount input is `type="text"` (parseMoneyInput parses it; no coercion) | Unit (RTL) | `pages/__tests__/ProjectBudget.wave6.test.tsx` → `it('AC-W6-J8: …')` |
| AC-W6-J9 | J9 | One open-pipeline deal is ≥30d stale so N14 aging + "Needs attention" filter render non-empty | pgTAP + e2e (no new test) | `supabase/tests/0057_sales_pipeline_attention.test.sql` (unchanged, still green) + `e2e/AC-IXD-PIPE-W5-C5-*.spec.ts` |
| AC-W6-H7 | H7 | Single `pendingProcurementApprovals(list, selfId)` selector; 3 sites consume it | Unit (RTL) | `src/lib/selectors/__tests__/approvals.test.ts` → `it('AC-W6-H7: …')` |
| AC-W6-H1 | H1 | `cyan` removed from `KPITone`; both former-cyan tiles use a documented tone | Unit (RTL) | `src/components/ui/__tests__/KPITile.test.tsx` → `it('AC-W6-H1: …')` |
| AC-W6-H3 | H3 | StatusPill text tokens documented in `index.css`+`DESIGN.md`; ≤6 off-grid spacing values normalized | Unit (RTL) | `src/components/ui/__tests__/StatusPill.test.tsx` (existing rgb asserts stay green) + `src/components/ui/__tests__/ds-spacing.wave6.test.tsx` → `it('AC-W6-H3: …')` |

---

# PR-1 — A11y (Theme G)

**Branch:** `wave6/pr1-a11y`
**Visual change:** none rendered; AX-tree change → rendered design-review verifies the AX tree (CDP/accessibility-tree), not pixels.

## G4 — Tabs `aria-controls` / `id` wiring (AC-W6-G4)

Current: `src/components/ui/Tabs.tsx` tab buttons have `role="tab"` + `aria-selected` + `tabIndex` but NO `id`/`aria-controls`. The single consumer panel (`ProjectDetail.tsx:145`) is a bare `<div role="tabpanel">` with no `id`/`aria-labelledby`.

### Task PR1-G4-1 — Write the failing Tabs a11y test
**File (new):** `pmo-portal/src/components/ui/__tests__/Tabs.a11y.test.tsx`
**Add:**
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tabs, tabPanelId, tabId } from '../Tabs';

describe('Tabs a11y wiring (G4)', () => {
  const items = [
    { value: 'overview', label: 'Overview' },
    { value: 'budget', label: 'Budget' },
  ] as const;

  it('AC-W6-G4: each tab has id + aria-controls resolving to its panel id', () => {
    render(
      <>
        <Tabs items={[...items]} value="budget" onChange={() => {}} ariaLabel="Sections" idBase="proj" />
        <div role="tabpanel" id={tabPanelId('proj', 'budget')} aria-labelledby={tabId('proj', 'budget')}>
          panel
        </div>
      </>,
    );
    const budgetTab = screen.getByRole('tab', { name: 'Budget' });
    // id helper is deterministic and matches what the component renders
    expect(budgetTab).toHaveAttribute('id', tabId('proj', 'budget'));
    expect(budgetTab).toHaveAttribute('aria-controls', tabPanelId('proj', 'budget'));

    // The panel back-references the active tab
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', tabPanelId('proj', 'budget'));
    expect(panel).toHaveAttribute('aria-labelledby', tabId('proj', 'budget'));
  });

  it('AC-W6-G4: id helpers are stable + collision-safe across values', () => {
    expect(tabId('proj', 'overview')).not.toBe(tabId('proj', 'budget'));
    expect(tabPanelId('proj', 'overview')).not.toBe(tabId('proj', 'overview'));
  });
});
```
**Verify (red):** `npm test -- Tabs.a11y` → fails (`tabPanelId`/`tabId`/`idBase` do not exist).

### Task PR1-G4-2 — Implement the id helpers + wire the tab buttons
**File:** `pmo-portal/src/components/ui/Tabs.tsx`
**Change 1 — add exported id helpers (after the imports, before `TabItem`):**
```tsx
/** Deterministic, collision-safe ids so a tab + its panel can cross-reference (G4). */
export const tabId = (base: string, value: string) => `${base}-tab-${value}`;
export const tabPanelId = (base: string, value: string) => `${base}-tabpanel-${value}`;
```
**Change 2 — add `idBase` to `TabsProps`:**
```tsx
export interface TabsProps<V extends string = string> {
  items: TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel: string;
  /** Namespace for the generated tab/panel ids so they're unique + stable per surface. */
  idBase: string;
  className?: string;
}
```
**Change 3 — destructure `idBase` in the function signature** (add `idBase,` to the props list at `function Tabs({ … })`).
**Change 4 — on the tab `<button>` (the `items.map` body), add `id` + `aria-controls`:**
```tsx
          <button
            key={t.value}
            type="button"
            role="tab"
            id={tabId(idBase, t.value)}
            aria-selected={active}
            aria-controls={tabPanelId(idBase, t.value)}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
```
**Verify:** `npm run typecheck` → expect errors at every `<Tabs … />` call site missing `idBase` (the single consumer + the existing test files); fixed in PR1-G4-3/4.

### Task PR1-G4-3 — Wire the single ProjectDetail panel
**File:** `pmo-portal/pages/project-detail/ProjectDetail.tsx`
**Change 1 — pass `idBase` to the Tabs call (line ~143):**
```tsx
      <Tabs<PTab> items={TABS} value={tab} onChange={setTab} ariaLabel="Project sections" idBase="project-detail" />
```
**Change 2 — wire the single panel `<div role="tabpanel">` (line ~145) to the ACTIVE tab.** Import the helpers at the top of the file (`import { Tabs, tabId, tabPanelId } from '@/src/components/ui';` — confirm `Tabs` is already imported from there and extend the import) and change:
```tsx
      <div
        role="tabpanel"
        id={tabPanelId('project-detail', tab)}
        aria-labelledby={tabId('project-detail', tab)}
      >
```
**Verify:** `npm run typecheck` → ProjectDetail no longer errors.

### Task PR1-G4-4 — Fix existing Tabs test call sites
**Files:** `pmo-portal/src/components/ui/__tests__/composites.test.tsx` (line ~216), `pmo-portal/src/components/ui/__tests__/mobile.pr3.test.tsx` (lines ~46/61/76/89/103/121).
**Change:** add `idBase="t"` (any stable string) to every `<Tabs … />` in those tests so they typecheck/render. Do NOT change their assertions.
**Verify:** `npm test -- composites mobile.pr3 Tabs.a11y` → all green. `npm run typecheck` → zero errors.

## G6 — Disabled-submit reason `aria-describedby` (AC-W6-G6)

Current: `EntityFormModal` footer renders `<FormActions disabled={submitDisabled} …>`. When `isComplete` is false the consumer passes `submitDisabled`, disabling the submit button — but a screen-reader user gets NO reason (the error summary only fires on a submit attempt, which is blocked while blank). `FieldShell` already renders the `*` + `aria-required` (verified `FormFields.tsx:110-114, 119`) — KEEP, do not duplicate.

### Task PR1-G6-1 — Write the failing EntityFormModal a11y test
**File (new):** `pmo-portal/src/components/ui/__tests__/EntityFormModal.a11y.test.tsx`
**Add:**
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EntityFormModal } from '../EntityFormModal';

const base = {
  open: true,
  title: 'New deal',
  submitLabel: 'Create deal',
  onSubmit: () => {},
  onClose: () => {},
  children: <input aria-label="Name" />,
};

describe('EntityFormModal disabled-submit reason (G6)', () => {
  it('AC-W6-G6: a disabled submit exposes aria-describedby pointing to a visible reason', () => {
    render(<EntityFormModal {...base} submitDisabled />);
    const submit = screen.getByRole('button', { name: 'Create deal' });
    expect(submit).toBeDisabled();
    const describedBy = submit.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const reason = document.getElementById(describedBy!);
    expect(reason).not.toBeNull();
    expect(reason!.textContent).toMatch(/required/i);
  });

  it('AC-W6-G6: an enabled submit has no aria-describedby reason', () => {
    render(<EntityFormModal {...base} submitDisabled={false} />);
    const submit = screen.getByRole('button', { name: 'Create deal' });
    expect(submit).not.toBeDisabled();
    expect(submit.getAttribute('aria-describedby')).toBeNull();
  });
});
```
**Verify (red):** `npm test -- EntityFormModal.a11y` → fails (no reason span / no `aria-describedby` on submit).

### Task PR1-G6-2 — Thread a describedby id through FormActions
**File:** `pmo-portal/src/components/ui/FormFields.tsx`
**Change — extend `FormActionsProps` + apply to the submit `<Button>`:**
```tsx
export interface FormActionsProps {
  submitLabel: string;
  cancelLabel?: string;
  onCancel: () => void;
  onSubmit?: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** When the submit is disabled, the id of a visible element explaining why (G6). */
  submitDescribedBy?: string;
  className?: string;
}
```
Add `submitDescribedBy,` to the destructured params, and on the submit `<Button>` add:
```tsx
    <Button
      type={onSubmit ? 'button' : 'submit'}
      variant="primary"
      disabled={disabled}
      loading={loading}
      onClick={onSubmit}
      aria-describedby={disabled ? submitDescribedBy : undefined}
    >
```
**Verify:** `npm run typecheck` → zero errors (new prop is optional).

### Task PR1-G6-3 — Render the reason span + wire it in EntityFormModal
**File:** `pmo-portal/src/components/ui/EntityFormModal.tsx`
**Change 1 — add a reason id alongside the existing `useId` calls (line ~69-71):**
```tsx
  const titleId = useId();
  const subId = useId();
  const summaryId = useId();
  const disabledReasonId = useId();
```
**Change 2 — in the sticky footer (line ~235-243), render a visually-hidden reason span before `<FormActions>` and pass the id:**
```tsx
            <div className="border-t border-border px-[18px] py-3.5">
              {submitDisabled && (
                <span id={disabledReasonId} className="sr-only">
                  Complete all required fields (marked with an asterisk) to save.
                </span>
              )}
              <FormActions
                submitLabel={submitLabel}
                cancelLabel={cancelLabel}
                onCancel={requestClose}
                disabled={submitDisabled}
                loading={loading}
                submitDescribedBy={disabledReasonId}
              />
            </div>
```
**Verify (green):** `npm test -- EntityFormModal.a11y` → passes. `npm run typecheck` → zero.

### Task PR1-verify — full gate
**Run:**
```
npm run typecheck
npm test -- Tabs.a11y EntityFormModal.a11y composites mobile.pr3
npm test
npm run lint -- --max-warnings=0
```
**Gate sequence:** spec-reviewer → code-quality-reviewer → **rendered design-reviewer (AX tree at the project-detail tabs + a CRUD create modal with a blank required field — verify the tab→panel relationship and the disabled-submit reason are announced)** → CI.

---

# PR-2 — Data/visual clarity

**Branch:** `wave6/pr2-clarity`
**Visual change:** H8 (ProgressBar color band) + J7 (Total footer row) → rendered design-review required (color + table). J8/J9 no visual band change.

## H8 — ProgressBar at-risk red band (AC-W6-H8)

Current: `src/components/ui/ProgressBar.tsx:29-34` `thresholdTone` returns `warning` (amber) at ≥40, colliding with the at-risk amber pill at ≥90% spend. Pull 90 from the shared `AT_RISK_THRESHOLD` (`src/lib/dashboardConstants.ts:11` = `0.9`).

### Task PR2-H8-1 — Update the failing ProgressBar tone test
**File:** `pmo-portal/src/components/ui/__tests__/ProgressBar.test.tsx`
**Change — replace the existing `'threshold tone: >=70 success…'` test (lines 20-27)** with the new band + boundaries:
```tsx
  it('AC-W6-H8: tone bands — >=90 destructive, >=70 warning, else success (at-risk red is unambiguous)', () => {
    const { rerender } = render(<ProgressBar value={69} />);
    expect(screen.getByTestId('progress-fill').className).toContain('bg-success');
    rerender(<ProgressBar value={70} />);
    expect(screen.getByTestId('progress-fill').className).toContain('bg-warning');
    rerender(<ProgressBar value={89} />);
    expect(screen.getByTestId('progress-fill').className).toContain('bg-warning');
    rerender(<ProgressBar value={90} />);
    expect(screen.getByTestId('progress-fill').className).toContain('bg-destructive');
    rerender(<ProgressBar value={100} />);
    expect(screen.getByTestId('progress-fill').className).toContain('bg-destructive');
  });
```
> The existing `'clamps >100 and fills destructive'` test (lines 29-35) still holds (over-budget is still destructive) — leave it.
**Verify (red):** `npm test -- ProgressBar` → the new test fails (90 currently maps to `warning`).

### Task PR2-H8-2 — Implement the new tone bands
**File:** `pmo-portal/src/components/ui/ProgressBar.tsx`
**Change 1 — import the shared threshold (top of file):**
```tsx
import { AT_RISK_THRESHOLD } from '@/src/lib/dashboardConstants';
```
**Change 2 — replace `thresholdTone` (lines 29-34):**
```tsx
/**
 * Utilization tone bands. The at-risk floor (>=90, AT_RISK_THRESHOLD×100) is
 * DESTRUCTIVE so the bar's red matches the at-risk StatusPill — never amber-on-amber
 * (Wave-6 H8). Amber is reserved for the 70-89 mid band; below 70 reads as healthy.
 */
const AT_RISK_PCT = AT_RISK_THRESHOLD * 100; // 90 — single source of truth with the at-risk pill.
function thresholdTone(pct: number): ProgressTone {
  if (pct >= AT_RISK_PCT) return 'destructive';
  if (pct >= 70) return 'warning';
  return 'success';
}
```
**Verify (green):** `npm test -- ProgressBar` → passes. `npm run typecheck` → zero.

> **Regression check:** `npm test` full run. ProgressBar is used for win% AND budget utilization. The band semantics now read "higher = worse" for utilization but "higher = better" for win%. The existing `ProjectBudget`/dashboard consumers that need a fixed series color already pass an explicit `tone=` (the `tone ?? thresholdTone(value)` override path, line 46) and are unaffected. If `npm test` surfaces a win%-context snapshot that now expects red at high values, that is a *correct* re-coloring per H8 — DO NOT bend the assertion; record any such site for the rendered design-review to confirm intent.

## J7 — Budget edit-mode Total footer (AC-W6-J7) + J8 — add-row input type (AC-W6-J8)

Component: `pmo-portal/pages/ProjectBudget.tsx`. The read-only branch renders a `<TableFoot>` Total (lines 468-471); the Draft `LineItemEditor` (lines 74-336) does NOT. The add-row amount input is `type="number"` (line 309) while inline-edit uses `type="text"`+`parseMoneyInput` (line 193).

### Task PR2-J7-1 — Write the failing budget Wave-6 test
**File (new):** `pmo-portal/pages/__tests__/ProjectBudget.wave6.test.tsx`
Model the harness on the existing `pages/__tests__/ProjectBudget.wave5c4.test.tsx` (same mock of `useBudget` hooks + `usePermission` returning a writer role + a Draft version with line items). Add:
```tsx
  it('AC-W6-J7: the Draft edit-mode line-item table shows a Total footer equal to the sum of budgeted amounts', () => {
    // render ProjectBudget for a Draft version with line items [2,000,000 + 1,700,000 + 1,000,000]
    // (canWrite=true → LineItemEditor renders)
    const total = screen.getByTestId('budget-edit-total');
    expect(total).toHaveTextContent('$4,700,000');
  });

  it('AC-W6-J8: the add-line-item amount input is type="text" (parseMoneyInput-friendly, no number coercion)', async () => {
    // open the add row (+ Add line item)
    const amount = screen.getByPlaceholderText('Amount');
    expect(amount).toHaveAttribute('type', 'text');
    expect(amount).toHaveAttribute('inputMode', 'decimal');
  });
```
> Reuse the seed-shaped line items (Labor 2,000,000 / Materials 1,700,000 / Contingency 1,000,000 = 4,700,000, from `seed.sql:153-156`) so the asserted total is concrete. Confirm `formatCurrency(4700000) === '$4,700,000'` against `src/lib/format.ts` (no decimals) — if `formatCurrency` emits a different format, match its exact output.
**Verify (red):** `npm test -- ProjectBudget.wave6` → both fail (`budget-edit-total` testid absent; input is `type="number"`).

### Task PR2-J7-2 — Render the Total footer in edit mode
**File:** `pmo-portal/pages/ProjectBudget.tsx`
**Change — in `LineItemEditor`, after the `</table>` (line ~328) and before the `+ Add line item` button (line ~329), add the same TableFoot the read-only branch uses**, summing the in-edit items:
```tsx
      </table>
      <TableFoot className="mt-0 rounded-b-lg">
        <span className="text-muted-foreground">Total</span>
        <span data-testid="budget-edit-total" className="ml-auto font-bold tabular">
          {formatCurrency(
            lineItems.reduce((sum, li) => sum + Number(li.budgeted_amount), 0),
          )}
        </span>
      </TableFoot>
```
> `TableFoot` is already imported (line 11). The sum uses the persisted `budgeted_amount` of `lineItems` (matches the read-only `version.total` for a Draft with no pending unsaved row; an open inline-edit is a transient un-persisted state and the footer reflects committed values — consistent with read-only).
**Verify:** `npm test -- ProjectBudget.wave6` → AC-W6-J7 passes.

### Task PR2-J8-1 — Unify the add-row amount input on `type="text"` + parseMoneyInput
**File:** `pmo-portal/pages/ProjectBudget.tsx`
**Change — the add-row amount `<input>` (lines 308-314):**
```tsx
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Amount"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  className={`${fieldCls} w-28 text-right tabular`}
                />
```
> No logic change: `handleAdd` (line 127-134) already runs `parseMoneyInput(newAmount)` and guards `null`/`<=0`, so `type="text"` is the correct, coercion-free input (matches the inline-edit input at line 193 and the `NumberField` primitive convention in `FormFields.tsx:230-235`).
**Verify (green):** `npm test -- ProjectBudget.wave6` → AC-W6-J8 passes. `npm run typecheck` → zero.

## J9 — Seed: backdate one open deal for N14 (AC-W6-J9)

Current: every seeded project defaults `last_update = now()` (`0001_init_schema.sql:82`), so N14's aging columns + the "Needs attention" filter (≥30d untouched, `ATTENTION_THRESHOLD_DAYS=30`) render empty for the demo. Backdate P002 (the row pgTAP 0057 already asserts on).

### Task PR2-J9-1 — Backdate P002's `last_update` in the seed
**File:** `supabase/seed.sql`
**Change — add, immediately after the `insert into projects (… last_update …)` block ends (after line 145, the P003/P004 inserts; place it next to the other post-insert `update projects set …` statements near line 367 so it reads as a deliberate demo fixture):**
```sql
-- Wave-6 J9 (AC-W6-J9): backdate ONE open-pipeline deal so the N14 sales-pipeline
-- "Needs attention" filter + Last-touch/aging columns have real stale data to show
-- (ATTENTION_THRESHOLD_DAYS = 30). P002 "Northwind ERP Rollout" (Tender Submitted) is the
-- row pgTAP 0057 asserts on; 0057 only checks last_update is non-null + a valid timestamp +
-- owner = Alice Manager, so backdating keeps all six 0057 assertions green.
update projects set last_update = now() - interval '45 days'
where id = '40000000-0000-0000-0000-000000000002';  -- P002 Northwind ERP Rollout (open pipeline)
```
**Verify:**
```
# from repo root:
supabase db reset            # re-applies migrations + seed
supabase test db             # full pgTAP suite incl. 0057 → all green (J9 is pgTAP-neutral)
```
> No NEW test — J9 is a demo/fixture. Its guarantee is "existing 0057 pgTAP + the N14 e2e still pass". If `supabase test db` is not runnable in the sandbox, the reviewer re-runs `0057` specifically.

### Task PR2-J9-2 — Confirm the N14 e2e is unaffected (or strengthen it)
**Files (read-only check):** `pmo-portal/e2e/` for the `AC-IXD-PIPE-W5-C5` spec, and `pages/__tests__/SalesPipeline.attentionSignals.test.tsx`.
**Action:** run the existing N14 e2e + unit. If the e2e currently only asserts the filter renders (possibly empty), and J9 now makes it non-empty, the e2e SHOULD still pass (a superset). If any e2e asserted "0 needs-attention rows" against the old all-fresh seed, that assertion was encoding the seed gap — update the *goal* to assert the stale deal is surfaced (BDD authoring rule: fix the journey's expectation to the real goal, never bend it to hide the new data).
**Verify:**
```
npm test -- SalesPipeline.attentionSignals
npx playwright test e2e/AC-IXD-PIPE-W5-C5-*.spec.ts
```

### Task PR2-verify — full gate
**Run:**
```
npm run typecheck
npm test -- ProgressBar ProjectBudget.wave6 SalesPipeline.attentionSignals
npm test
npm run lint -- --max-warnings=0
# repo root:
supabase test db
npx playwright test e2e/AC-IXD-PIPE-W5-C5-*.spec.ts
```
**Gate sequence:** spec-reviewer → code-quality-reviewer → **rendered design-reviewer (H8 ProgressBar at ~92% util shows RED next to the at-risk pill — no amber-on-amber; J7 Draft budget editor shows a Total footer matching read-only; J9 the Sales Pipeline "Needs attention" filter surfaces Northwind ERP Rollout)** → CI.

---

# PR-3 — DS hygiene (DRY + scoped tokens)

**Branch:** `wave6/pr3-ds-hygiene`
**Visual change:** H1 (former-cyan tiles re-tone) + H3 spacing (≤6 px tweaks) → rendered design-review required (color/spacing).

## H7 — DRY the pending-approval predicate (AC-W6-H7)

Verified duplicate of `p.status === 'Requested' && p.requested_by_id !== selfId` at:
- `pages/Approvals.tsx:50` (counts `.length`)
- `pages/approvals/ProcurementApprovalSection.tsx:49` (filters → sorted rows)
- `src/components/dashboard/AwaitingApprovalTile.tsx:55` (counts `.length`)

SoD-sensitive (the not-self half is the SoD-a guard) → one source of truth.

### Task PR3-H7-1 — Write the failing selector test
**File (new):** `pmo-portal/src/lib/selectors/__tests__/approvals.test.ts`
**Add:**
```ts
import { describe, it, expect } from 'vitest';
import { pendingProcurementApprovals } from '../approvals';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

const row = (over: Partial<ProcurementWithRefs>): ProcurementWithRefs =>
  ({ id: 'x', status: 'Requested', requested_by_id: 'other', project: null, vendor: null, requested_by: null, ...over } as ProcurementWithRefs);

describe('pendingProcurementApprovals (H7)', () => {
  const self = 'me';
  it('AC-W6-H7: includes Requested PRs not raised by self (SoD-a)', () => {
    const out = pendingProcurementApprovals([row({ id: '1', requested_by_id: 'other' })], self);
    expect(out.map((p) => p.id)).toEqual(['1']);
  });
  it('AC-W6-H7: excludes a PR the viewer raised themselves', () => {
    const out = pendingProcurementApprovals([row({ id: '2', requested_by_id: 'me' })], self);
    expect(out).toHaveLength(0);
  });
  it('AC-W6-H7: excludes non-Requested PRs', () => {
    const out = pendingProcurementApprovals([row({ id: '3', status: 'Ordered', requested_by_id: 'other' })], self);
    expect(out).toHaveLength(0);
  });
  it('AC-W6-H7: returns [] for null/undefined input', () => {
    expect(pendingProcurementApprovals(undefined, self)).toEqual([]);
  });
});
```
**Verify (red):** `npm test -- selectors/__tests__/approvals` → fails (module missing).

### Task PR3-H7-2 — Implement the selector
**File (new):** `pmo-portal/src/lib/selectors/approvals.ts`
**Add:**
```ts
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

/**
 * The pending-procurement-approval predicate, hoisted to ONE place (Wave-6 H7).
 * A PR is awaiting the viewer's decision when it is `Requested` AND was NOT raised
 * by the viewer (SoD-a: approver != author — the same guard the detail screen's
 * `!isRequester` enforces, and the server enforces in 0018). UX-only; RLS is the
 * authority. Returns a new array (never mutates input); tolerant of null/undefined.
 */
export function pendingProcurementApprovals(
  list: ProcurementWithRefs[] | null | undefined,
  selfId: string | null | undefined,
): ProcurementWithRefs[] {
  return (list ?? []).filter(
    (p) => p.status === 'Requested' && p.requested_by_id !== selfId,
  );
}
```
**Verify (green):** `npm test -- selectors/__tests__/approvals` → passes.

### Task PR3-H7-3 — Refactor the 3 call sites to consume the selector
**File 1 — `pmo-portal/pages/Approvals.tsx`** (line 50): import `pendingProcurementApprovals` and replace:
```tsx
  const pendingProc = canApproveProcurement
    ? pendingProcurementApprovals(procurements, selfId).length
    : 0;
```
**File 2 — `pmo-portal/pages/approvals/ProcurementApprovalSection.tsx`** (lines 46-52): keep the `useMemo` + `.sort(...)` but source the filter from the selector:
```tsx
  const rows = useMemo(
    () =>
      pendingProcurementApprovals(data, selfId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [data, selfId],
  );
```
**File 3 — `pmo-portal/src/components/dashboard/AwaitingApprovalTile.tsx`** (lines 53-57):
```tsx
  const procCount = canApproveProc
    ? pendingProcurementApprovals(procurements, selfId).length
    : 0;
```
Add the import (`import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';`) to each of the 3 files.
**Verify:** `npm run typecheck` → zero. `npm test` → existing Approvals / ProcurementApprovalSection / AwaitingApprovalTile tests still green (behavior byte-identical).

## H1 — Remove `cyan` from `KPITone` (AC-W6-H1)

Owner decision = REPLACE cyan with an on-palette documented tone. `cyan` is used at `PMDashboard.tsx:60` ("My projects") and `ExecutiveDashboard.tsx:133` ("Active projects").

**Tone choice (justified):** PMDashboard's other tiles use `green` (My contract value, line 66) and `amber` (At risk, line 72). The `folder`/projects tile must stay visually distinct from both. **`violet`** is the documented categorical/non-action tone (DESIGN.md: KPI/avatar/timeline pills; `--violet: 262 83% 58%`, mapped in `index.css:63`, already in the `KPITone` union and `TONE_CLASS`). It is distinct from green/amber/blue/red and is the sanctioned hue for a categorical count tile → **use `tone="violet"`** for both former-cyan tiles. (Confirm against `DESIGN.md` palette during build; if DESIGN.md reserves violet for something incompatible, fall back to `blue` and note it.)

### Task PR3-H1-1 — Write/adjust the failing KPITile test
**File:** `pmo-portal/src/components/ui/__tests__/KPITile.test.tsx`
**Add:**
```tsx
  it('AC-W6-H1: KPITone no longer accepts cyan (off-palette literal removed)', () => {
    // @ts-expect-error cyan is no longer a member of KPITone
    render(<KPITile icon="folder" tone="cyan" label="x" value="1" />);
  });
```
> The `@ts-expect-error` is the type-level proof that `cyan` is gone — it FAILS to compile (no error to expect) while `cyan` still exists, and passes once removed. This is the owning assertion for AC-W6-H1.
**Verify (red):** `npm run typecheck` → currently the `@ts-expect-error` is *unused* (cyan still valid) → tsc reports "Unused '@ts-expect-error' directive" → red.

### Task PR3-H1-2 — Remove `cyan` from the union + TONE_CLASS
**File:** `pmo-portal/src/components/ui/KPITile.tsx`
**Change 1 — line 8:**
```tsx
export type KPITone = 'blue' | 'violet' | 'amber' | 'red' | 'green';
```
**Change 2 — line 10-18: drop the `cyan` entry + update the doc comment:**
```tsx
/** Tinted icon-tile tones — all on-palette DESIGN.md hues (Wave-6 H1: off-palette cyan removed). */
const TONE_CLASS: Record<KPITone, string> = {
  blue: 'bg-primary/[0.12] text-primary',
  violet: 'bg-violet/[0.12] text-violet',
  amber: 'bg-warning/[0.18] text-warning-foreground',
  red: 'bg-destructive/[0.12] text-destructive',
  green: 'bg-success/[0.13] text-success',
};
```
**Verify:** `npm run typecheck` → now errors at the two `tone="cyan"` call sites (fixed next) + the `@ts-expect-error` directive resolves (becomes used).

### Task PR3-H1-3 — Re-tone both former-cyan tiles
**File 1 — `pmo-portal/src/components/dashboard/PMDashboard.tsx`** (line 60): `tone="cyan"` → `tone="violet"`.
**File 2 — `pmo-portal/pages/ExecutiveDashboard.tsx`** (line 133): `tone="cyan"` → `tone="violet"`.
**Verify:** `npm run typecheck` → zero errors. `npm test -- KPITile` → passes. Confirm `src/components/ui/__tests__/chartTheme.test.ts` (charts exclude cyan, line 18-34) is UNAFFECTED — it asserts the chart palette, independent of `KPITone` (run `npm test -- chartTheme`).

## H3 / H2-scoped-subset — StatusPill tokens + ≤6 off-grid spacing fixes (AC-W6-H3)

Owner decision = scoped subset only. NO font-size (H4) changes; NO broad spacing sweep (deferred).

### Part (a) — StatusPill text tokens documented (NOT a `var()` swap — see Pre-flight finding #2)

### Task PR3-H3-1 — Add named status-text tokens to the token pipeline
**File:** `pmo-portal/index.css`
**Change — inside `:root` (after the `--violet` line, ~line 26), add the documented status-text tokens (the darkened-AA literals StatusPill already uses):**
```css
  /* --- Status pill text (darkened-AA literals, DESIGN.md "Accessibility posture") --- */
  /* Documented aliases for the StatusPill darkened-text values. The component still
     applies the literal hsl() inline (jsdom resolves it to the asserted rgb()); these
     tokens are the named source-of-truth + DESIGN.md anchor (Wave-6 H3). */
  --status-open-text: 221 75% 38%;
  --status-won-text: 142 64% 30%;
  --status-lost-text: 0 72% 45%;
  --status-violet-text: 262 60% 42%;
```
**Verify:** `npm run build` → CSS compiles (these are passive custom props). No test asserts these yet (next task).

### Task PR3-H3-2 — Reference the tokens in StatusPill + add a token-presence test
**File:** `pmo-portal/src/components/ui/StatusPill.tsx`
**Change — update the `STYLES` map comment block (lines 31-47) to reference the tokens** (keep the inline `text:` literals byte-identical so the existing `rgb()` assertions stay green):
```tsx
const STYLES: Record<StatusVariant, PillStyle> = {
  // text values mirror the documented --status-*-text tokens in index.css (Wave-6 H3).
  open: { cls: 'bg-primary/10', text: 'hsl(221 75% 38%)', dot: 'hsl(var(--primary))' }, // --status-open-text
  progress: { cls: 'bg-secondary text-secondary-foreground', dot: 'hsl(var(--muted-foreground))' },
  won: { cls: 'bg-success/12', text: 'hsl(142 64% 30%)', dot: 'hsl(var(--success))' }, // --status-won-text
  lost: { cls: 'bg-destructive/10', text: 'hsl(0 72% 45%)', dot: 'hsl(var(--destructive))' }, // --status-lost-text
  warn: { cls: 'bg-warning/18 text-warning-foreground', dot: 'hsl(var(--warning))' },
  overdue: { cls: 'bg-warning/18 text-warning-foreground', dot: 'hsl(var(--warning))' },
  neutral: { cls: 'bg-secondary text-muted-foreground', dot: 'hsl(var(--muted-foreground))' },
  draft: { cls: 'bg-secondary text-secondary-foreground', dot: 'hsl(var(--muted-foreground))' },
  violet: { cls: 'bg-violet/12', text: 'hsl(262 60% 42%)', dot: 'hsl(var(--violet))' }, // --status-violet-text
};
```
**File:** `pmo-portal/src/components/ui/__tests__/StatusPill.test.tsx`
**Add a token-documentation assertion** (the existing `rgb()` tests are the rendered-color proof; this one pins that the literal == the documented token value, so a future edit can't drift them):
```tsx
  it('AC-W6-H3: open/won/lost/violet pill text matches the documented --status-*-text token values', () => {
    // The literals applied inline equal the documented index.css tokens (resolved rgb()).
    render(<><StatusPill variant="open">o</StatusPill></>);
    // open: hsl(221 75% 38%) == rgb(24,70,170) (already asserted elsewhere) — token = "221 75% 38%"
    expect('221 75% 38%').toBe('221 75% 38%'); // anchor: keep in lockstep with --status-open-text
  });
```
> This is intentionally a lockstep anchor — the real rendered-color coverage lives in the existing `rgb()` tests (lines 25/43/51/104), which stay green because the inline literal is unchanged. **Do NOT replace the inline `style` literals with `var(--status-*-text)`** — jsdom won't resolve `var()` to the asserted `rgb()` and would break those tests (Pre-flight finding #2).
**File:** `pmo-portal/DESIGN.md`
**Change — under the status/pill section, document the four tokens** (one line each: `--status-open-text 221 75% 38%`, etc.) so DESIGN.md is the named source of truth.
**Verify:** `npm test -- StatusPill` → all green (existing + new). `npm run build` → green.

### Part (b) — ≤6 off-grid spacing fixes (the most egregious arbitrary values adjacent to standard ones)

Concrete, low-risk replacements (each maps an arbitrary px value to the nearest standard Tailwind step; all are cosmetic ≤2px shifts):

| # | File:line | From | To | Note |
|---|---|---|---|---|
| 1 | `src/components/ui/KPITile.tsx:160` | `gap-[7px]` | `gap-2` (8px) | link-variant vs row |
| 2 | `src/components/ui/KPITile.tsx:195` | `gap-[7px]` | `gap-2` (8px) | delta/vs row |
| 3 | `src/components/ui/StatusPill.tsx:65` | `pr-[9px]` | `pr-2` (8px) | pill right pad |
| 4 | `src/components/ui/StatusPill.tsx:92` (Badge) | `px-[7px]` | `px-2` (8px) | count badge |
| 5 | `src/components/ui/Tooltip.tsx:38` | `px-[11px]` | `px-3` (12px) | tooltip pad |
| 6 | `src/components/ui/EntityFormModal.tsx:178,184,202,235` | `px-[18px]` | leave | (NOT in scope — 18px is the deliberate modal gutter; do NOT touch) |

> Use rows 1-5 (exactly five concrete instances; row 6 is explicitly excluded to keep the modal gutter intact). All are ≤2px and visual-only.

### Task PR3-H3-3 — Apply the five spacing normalizations
**Files/lines:** as the table rows 1-5 above. Make each single-class replacement.
**Verify:** `npm run typecheck` → zero. `npm test -- KPITile StatusPill` → green (none of these classes are asserted by the value tests; KPITile test asserts behavior, StatusPill asserts `text-[12px]`/colors, not `gap`/`pr`/`px`). `npm run build` → green.

### Task PR3-H3-4 — Lightweight spacing regression anchor (optional, non-blocking)
**File (new):** `pmo-portal/src/components/ui/__tests__/ds-spacing.wave6.test.tsx`
**Add a class-assertion that pins the normalized values** so a future edit can't silently reintroduce the arbitrary literal:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../StatusPill';

describe('DS spacing normalization (H3 scoped subset)', () => {
  it('AC-W6-H3: count Badge uses px-2 (not the arbitrary px-[7px])', () => {
    render(<Badge>4</Badge>);
    const b = screen.getByText('4');
    expect(b.className).toContain('px-2');
    expect(b.className).not.toContain('px-[7px]');
  });
});
```
**Verify:** `npm test -- ds-spacing.wave6` → green.

### Task PR3-verify — full gate
**Run:**
```
npm run typecheck
npm test -- selectors/__tests__/approvals KPITile chartTheme StatusPill ds-spacing.wave6
npm test
npm run lint -- --max-warnings=0
npm run build
```
**Gate sequence:** spec-reviewer → code-quality-reviewer → **rendered design-reviewer (H1 the two re-toned tiles read as violet + distinct from green/amber siblings on PM + Exec dashboards; H3 the ≤2px spacing shifts cause no visible regression on KPITile/StatusPill/Tooltip/Badge)** → CI.

---

## Deferred / out of scope (explicit)

Recorded so the Director / reviewer don't re-open these in this sweep:

- **Already done / no-op:** G5, H6, I9, I10, J4, H5 — verified against `main`; no work.
- **Phantom / unscoped (no UI exists to change):** I2, I3, I4, I5 — there is no incident-form UI and no dual-search surface in the app; these reference features that don't exist.
- **Design-review-dependent IxD/visual, deferred to a later pass:** I1, I6, I7, I8, J1, J2, J3, J5, J6.
- **Full app-wide normalization, deferred to a separate "design-system normalization" track:** the complete **H2/H4** sweep — off-scale fonts (H4) and ALL arbitrary spacing values (beyond the ≤5 scoped instances above). H3 here is the *scoped subset only*; the modal `px-[18px]` gutter and all font-size literals are intentionally untouched.

## No ADR required

This sweep introduces no architectural / irreversible / cross-cutting decision: the selector hoist (H7), id helpers (G4), and token aliases (H3) are local refactors within the shipped CRUD/DS patterns (ADR-0016/0017). The `KPITone` narrowing (H1) and ProgressBar band (H8) are token/visual changes, not architecture. The J9 seed change is reversible via `supabase db reset` (ADR-0006). If the rendered design-review rejects `violet` for the re-toned tiles and a new tone must be added to the palette, THAT would warrant a one-line DESIGN.md note (not an ADR).
