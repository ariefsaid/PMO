// timesheet-edit.ts — framework-free pure helpers for the editable timesheet grid.
// Parsing / validation / live totals / save-diff (spec §3.2-§3.5, FR-TSE-012/013/014).
// Unit-proven without rendering; re-used by memoized selectors (no inline .reduce in JSX).

/** One editable project-row: 7 raw input strings (blank allowed) + a row-level note. */
export interface EditRow {
  project_id: string;
  project: string;
  code: string | null;
  hours: string[]; // 7 raw input strings, Monday-first; blank allowed
  note: string;
}

/** An entry-write payload for the (timesheet_id, project_id, entry_date) upsert key. org_id NOT sent. */
export interface EntryUpsert {
  timesheet_id: string;
  project_id: string;
  entry_date: string;
  hours: number;
  notes: string | null;
}
