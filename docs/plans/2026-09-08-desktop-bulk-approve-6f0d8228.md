# Desktop split-inbox bulk approve

## Design

The desktop split inbox and the stacked `ApprovalsQueue` will use one new timesheet-bulk controller at `pmo-portal/pages/timesheets/TimesheetBulkApprove.tsx`. The controller receives the already authority-filtered timesheet rows from its caller and preserves the fallback’s existing cosmetic `timesheetActions(...).approve` eligibility, selection state, one-confirmation batch, concurrent `approve.mutateAsync({ id })` calls, `Promise.allSettled` result aggregation, and success/partial/failure toast copy. It will not introduce another authority filter, client `org_id`, mutation endpoint, or database change.

That module will also provide the shared Select trigger, selection toolbar, and confirmation dialog so the two responsive render branches cannot diverge in their bulk interaction. Each branch keeps its own row layout: the desktop row receives a labelled checkbox alongside its preview-activation button, avoiding an interactive checkbox nested inside a button. The preview selection (`selectedKey`) remains independent of bulk selection, so enabling Select does not replace or hide the right-hand preview.

The desktop controller is supplied only `timesheetRows`, including under `scope=all`; procurement rows are therefore never selectable. It hides its Select trigger when there are no approvable timesheet rows. This is a presentation/controller reuse only; no ADR, migration, RLS, repository, DAL, query-key, or e2e change is needed.

## Acceptance traceability

| AC | Owning layer | Canonical proof |
| --- | --- | --- |
| AC-912 | RTL unit | `pmo-portal/pages/Approvals.test.tsx` desktop split-inbox tests |

## Implementation tasks

### 1. Write the failing desktop RTL coverage first (AC-912)

**Files:** `pmo-portal/pages/Approvals.test.tsx`

1. Extend the shared timesheet fixture with three distinct submitted sheets and extend the approval-mutation mock to expose `mutateAsync`; keep the existing single-sheet preview tests intact.
2. Make the page render helper accept an approvals-scope route and explicitly exercise the large-screen branch through the existing `matchMedia` seam. Populate the `all`-scope fixture with one pending procurement row plus the three timesheet rows.
3. Before production changes, add `AC-912`-prefixed RTL tests that assert all of the following:
   - clicking the real `Select` button on the desktop queue reveals one checkbox per timesheet, each named with that owner and formatted week; the already selected preview region still contains the same sheet;
   - selecting two named checkboxes changes the shared action to `Approve 2`; after the existing confirmation dialog is confirmed, `approve.mutateAsync` is called once for each of exactly those two ids and the aggregate success toast reports `2 approved`;
   - select-all in `scope=all` selects only the three timesheet rows (four checkboxes including select-all, no checkbox for the procurement row) and exposes `Approve 3`;
   - neither an empty queue nor a procurement-only queue exposes the `Select` button.
4. Run this test file before changing production code and require it to fail because the desktop split inbox has no Select controller:

```bash
cd pmo-portal && npm test -- pages/Approvals.test.tsx
```

### 2. Extract the fallback’s single reusable bulk controller and shared bulk controls (AC-912)

**Files:** `pmo-portal/pages/timesheets/TimesheetBulkApprove.tsx`, `pmo-portal/pages/timesheets/ApprovalsQueue.tsx`, `pmo-portal/pages/timesheets/__tests__/ApprovalsQueue.expand-bulk.test.tsx`

1. Create `TimesheetBulkApprove.tsx` with `useTimesheetBulkApprove(sheets: TimesheetAwaitingApproval[])`. Keep the fallback’s existing semantics exactly: derive `approvableIds` with `timesheetActions(status, false, isApprover).approve`; maintain selecting, selected ids, confirm-open, and running state; discard stale/non-approvable ids from `effectiveSelected`; toggle all eligible ids; and clear selection after a settled batch.
2. In that same module, export the shared Select trigger, selection toolbar, and confirmation-dialog components. Their inputs must be the controller and the displayed timesheet rows, and they must retain the existing 32px tokenized controls, `Bulk approve` group label, mixed select-all checkbox state, disabled zero-selection `Approve N`, `Clear`, selected-sheet evidence list, confirmation title/label, and aggregate toast messages.
3. Keep the batch commit in the controller: build ids in display order from `sheets`, call `approve.mutateAsync({ id })` for every selected id through `Promise.allSettled`, then report the existing all-success, all-failed, or partial aggregate toast. Do not use per-row callbacks or add a new mutation path.
4. Refactor `ApprovalsQueue.tsx` to remove its duplicate bulk state/commit/UI and consume the new controller and shared controls. Continue rendering a row checkbox only for controller-eligible sheets; update its accessible label to include both the owner and `weekLabel(sheet.week_start_date)`; preserve expand-in-place and individual Approve/Return behavior when selection mode is off.
5. Update the fallback test mocks only as needed for the extracted module (including `mutateAsync`) and retain all existing fallback bulk assertions as regression proof that the responsive fallback still uses the same behavior.
6. Run the fallback suite and require it to pass:

```bash
cd pmo-portal && npm test -- pages/timesheets/__tests__/ApprovalsQueue.expand-bulk.test.tsx
```

### 3. Mount the shared controller in the desktop queue without changing its preview behavior (AC-912)

**Files:** `pmo-portal/pages/Approvals.tsx`, `pmo-portal/pages/Approvals.test.tsx`

1. Instantiate `useTimesheetBulkApprove(timesheetRows)` once in `ApprovalsPage` and render the shared Select trigger, selection toolbar, and confirmation dialog in the large-screen queue pane. Render the trigger only via the shared component so it is absent for empty/procurement-only queues.
2. Thread the controller only into the desktop timesheet `QueueGroup`/`QueueButton` path. When selection mode is active, render the controller-owned `Checkbox` beside each eligible timesheet row with the owner-and-week accessible label; retain procurement rows as ordinary preview buttons with no selectable affordance.
3. Refactor the desktop timesheet row DOM so the checkbox is a sibling of the row’s preview button, not a nested interactive control. Keep `onSelect` for preview selection and leave `selectedKey` untouched when Select is entered or checkboxes are changed, preserving the right-hand `TimesheetApprovalPreview`.
4. Do not change the filtered `timesheetRows` source, scope construction, procurement selection behavior, preview component, server authorization, or per-sheet mutation contract.
5. Run the desktop AC proof and fallback regression together:

```bash
cd pmo-portal && npm test -- pages/Approvals.test.tsx pages/timesheets/__tests__/ApprovalsQueue.expand-bulk.test.tsx
```

### 4. Perform the rendered desktop check and whole-suite gate

**Files:** `adws/adw_data/sessions/6f0d8228/context_handoff/screenshots/desktop-bulk-approve-select.png`

1. With the local stack and app already running, sign in through the browser UI as an existing local approver without reading any `.env*` file or recording credentials. Connect the agent-browser CLI to that authenticated browser, use the split-inbox route, and set a desktop viewport. Do not use the Playwright MCP.
2. Use the accessible browser interaction to activate Select, confirm that the preview remains visible and the timesheet checkboxes are visible, then save the required screenshot:

```bash
mkdir -p adws/adw_data/sessions/6f0d8228/context_handoff/screenshots
agent-browser --auto-connect set viewport 1440 1000
agent-browser --auto-connect pushstate /approvals?scope=timesheets
agent-browser --auto-connect find role button click --name Select
agent-browser --auto-connect screenshot adws/adw_data/sessions/6f0d8228/context_handoff/screenshots/desktop-bulk-approve-select.png
```

3. Inspect the resulting screenshot for the desktop split pane, visible Select-mode checkboxes, one primary bulk action, and an unchanged readable preview. If this reveals a UI defect, add a regression test at the owning RTL layer before correcting it.
4. Run the required complete verification gate; proceed only if its exit status is zero. If it is red, fix the implementation or report the blocker without weakening, skipping, or deleting tests:

```bash
cd pmo-portal && npm run verify
```

## Final verification checklist

```bash
cd pmo-portal && npm test -- pages/Approvals.test.tsx pages/timesheets/__tests__/ApprovalsQueue.expand-bulk.test.tsx
cd pmo-portal && npm run verify
```
