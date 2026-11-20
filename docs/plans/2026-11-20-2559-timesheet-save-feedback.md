# Plan: timesheet save feedback (#2559)

Spec: `docs/specs/2559-timesheet-save-feedback.spec.md`. Frontend only; no migration, no RPC change.

Design: a pure `weekSaveState()` in `pages/timesheets/timesheetWeekModel.ts` picks the one status. `useTimesheetWeekEditor` records the edit-buffer identity at the moment a save succeeded or failed (`savedRows` / `failedRows`); any later edit or reseed (week change) makes the identity differ, so status falls back to unsaved/derived and each week is independent. The existing per-week `savedSheetIds` map already carries the created draft id (FR-TSF-007); this plan adds tests proving it.

| AC | Owning layer | Test file |
|---|---|---|
| AC-TSF-001..008 (state selection) | Unit | `pages/timesheets/__tests__/timesheetWeekModel.saveState.test.ts` (selection precedence) |
| AC-TSF-001..004, 007, 008 | Mounted RTL | `pages/Timesheets.saveFeedback.test.tsx` |
| AC-TSF-005, 006 | Mounted RTL (exists, AC-TM-018) plus tagged cases | `pages/Timesheets.saveFeedback.test.tsx` |

Steps: 1 write failing tests; 2 add `weekSaveState` + locale strings (en, id); 3 wire hook and page; 4 gates (`check:guards`, `typecheck`, eslint, `vitest related`). Existing e2e keep the strings "All changes saved" and "Unsaved changes" unchanged.
