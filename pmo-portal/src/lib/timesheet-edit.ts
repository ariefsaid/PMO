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

/** Live totals derived from edited (unsaved) grid state. */
export interface GridTotals {
  perRow: number[];
  perDay: number[]; // length 7, Monday-first
  weekly: number;
}

/** The save-diff: entries to upsert + server entry ids to delete. */
export interface EntryDiff {
  upserts: EntryUpsert[];
  deletes: string[]; // server entry ids of zeroed/cleared cells
}

/**
 * Parses one hour-cell. Blank (or whitespace) ⇒ 0. Returns { value, valid }; valid mirrors the DB
 * CHECK (numeric AND 0 ≤ h ≤ 24). Non-numeric (e.g. "8h"), negative, or > 24 ⇒ valid: false.
 * (AC-TSE-009/010/011, FR-TSE-014.)
 */
export function parseHourCell(raw: string): { value: number; valid: boolean } {
  const trimmed = raw.trim();
  if (trimmed === '') return { value: 0, valid: true };
  // Number('') is 0 and Number('8h') is NaN; reject anything non-finite.
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { value: NaN, valid: false };
  const valid = value >= 0 && value <= 24;
  return { value, valid };
}

/** True iff every cell in every row parses valid (blank=0). Gates Save (FR-TSE-014). */
export function gridIsValid(rows: EditRow[]): boolean {
  return rows.every(r => r.hours.every(cell => parseHourCell(cell).valid));
}

/** A cell's numeric contribution to totals: a parseable value, else 0 (invalid cells contribute 0). */
function cellValue(raw: string): number {
  const { value, valid } = parseHourCell(raw);
  return valid ? value : 0;
}

/** Live per-row, per-day (length 7), and weekly totals from edited blank=0 state (FR-TSE-013). */
export function computeTotals(rows: EditRow[]): GridTotals {
  const perDay = [0, 0, 0, 0, 0, 0, 0];
  const perRow = rows.map(r => {
    let rowTotal = 0;
    for (let day = 0; day < 7; day++) {
      const v = cellValue(r.hours[day] ?? '');
      rowTotal += v;
      perDay[day] += v;
    }
    return rowTotal;
  });
  const weekly = perDay.reduce((sum, v) => sum + v, 0);
  return { perRow, perDay, weekly };
}

/**
 * Diffs edited rows vs the last-fetched server entries → upserts (insert/update) + delete ids
 * (FR-TSE-012, §3.2). Per (project_id, entry_date) cell:
 *   - hours > 0 and (no server entry OR hours changed OR the row note differs from the
 *     persisted note) → upsert;
 *   - hours 0/blank and a server entry exists → delete that entry's id;
 *   - unchanged (same hours AND same note) → omitted.
 * The row note is written on every upsert of that row (OQ-4 row-level note); empty note ⇒ null.
 * A note attaches to the row's non-zero entries: a row with no non-zero hours persists NO entry
 * for the note alone (absence==zero — we never fabricate a 0-hour row just to store a note).
 * No org_id is ever produced — RLS scopes by auth_org_id().
 */
export function diffEntries(
  rows: EditRow[],
  weekDates: string[],
  serverEntries: { id: string; project_id: string; entry_date: string; hours: number; notes?: string | null }[],
  timesheetId: string,
): EntryDiff {
  // Index server entries by "project_id|entry_date" for O(1) lookup. Carry the persisted note so a
  // note-only edit (hours unchanged) is detected and re-upserted instead of silently dropped.
  const serverByCell = new Map<string, { id: string; hours: number; notes: string | null }>();
  for (const e of serverEntries) {
    serverByCell.set(`${e.project_id}|${e.entry_date}`, {
      id: e.id,
      hours: e.hours,
      notes: e.notes ?? null,
    });
  }

  const upserts: EntryUpsert[] = [];
  const deletes: string[] = [];

  for (const r of rows) {
    const notes = r.note.trim() === '' ? null : r.note;
    for (let day = 0; day < 7; day++) {
      const entryDate = weekDates[day];
      const key = `${r.project_id}|${entryDate}`;
      const { value } = parseHourCell(r.hours[day] ?? '');
      const existing = serverByCell.get(key);
      if (value > 0) {
        // Upsert when no entry exists, hours changed, OR the row note differs from what's
        // persisted on this cell (a note-only edit on an existing entry — previously dropped).
        const noteChanged = existing ? (existing.notes ?? null) !== notes : false;
        if (!existing || existing.hours !== value || noteChanged) {
          upserts.push({ timesheet_id: timesheetId, project_id: r.project_id, entry_date: entryDate, hours: value, notes });
        }
      } else if (existing) {
        // Cell zeroed/cleared and a server entry exists → delete it. (A note on a now-zero row
        // is not persisted — absence==zero; the note had no non-zero entry to attach to.)
        deletes.push(existing.id);
      }
    }
  }

  return { upserts, deletes };
}
