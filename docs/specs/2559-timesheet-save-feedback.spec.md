# Timesheets: weekly save feedback and draft continuity (#2559)

Scope: the weekly entry page (`pmo-portal/pages/Timesheets.tsx`, `pages/timesheets/useTimesheetWeekEditor.ts`). No database rule, RPC or migration changes; timesheets feed cost, so the save and submit contracts are untouched.

## Requirements (EARS)

- FR-TSF-001 The week's save status line shall show exactly one of: invalid, saving, failed, unsaved, saved (or nothing for an empty untouched week).
- FR-TSF-002 While any hour cell is invalid, the status line shall say the hours need fixing, and Save stays disabled.
- FR-TSF-003 While a save is in flight, the status line shall say the week is saving.
- FR-TSF-004 When a save fails, the status line shall say the save failed and that the edits are kept, the toast shall carry the classified failure detail, and the edit buffer shall be unchanged.
- FR-TSF-005 When the user edits again after a failed save, the status shall return to unsaved.
- FR-TSF-006 When a save succeeds, the status shall read saved even before the week query refetches, and shall return to unsaved on the next edit.
- FR-TSF-007 When a save has created a Draft and returned its id, an immediate second Save or a Submit for the same week, before the list refetches, shall act on that same Draft and never create a second one.
- FR-TSF-008 Each week's save state shall be independent: stepping to another week shall not carry over a failed or saved state, and returning shows that week's own state.
- FR-TSF-009 When the user steps to another week with invalid input in the buffer, the discard confirmation shall say the invalid hours will be lost; Keep editing shall preserve the input unchanged.

## Acceptance criteria

- AC-TSF-001 Given a week with an invalid cell, when the page renders, then the status reads that hours need fixing and Save is disabled.
- AC-TSF-002 Given valid edits, when Save is pending, then the status reads saving.
- AC-TSF-003 Given a failing save, when Save is pressed, then the status reads failed with edits kept, the toast shows the classified detail, the typed hours are still in the grid, and editing again returns the status to unsaved.
- AC-TSF-004 Given a successful save whose refetch is delayed, then the status reads saved, and typing again returns it to unsaved.
- AC-TSF-005 Given a created draft and a delayed refetch, when Save is pressed again, then the second call carries the created id (no second create).
- AC-TSF-006 Given a created draft and a delayed refetch, when Submit is confirmed, then the draft is saved with the created id and submitted (no second create).
- AC-TSF-007 Given a failed save in week A, when the user steps to week B and back, then week B showed no failed state.
- AC-TSF-008 Given invalid input, when the user steps weeks, then the discard dialog warns about invalid hours; Keep editing leaves the typed text in place and the week unchanged.
