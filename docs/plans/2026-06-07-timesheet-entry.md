# Implementation plan: Timesheet entry + edit (engineers log/edit/delete own hours)

- **Date:** 2026-06-07
- **Branch:** `feat/timesheet-entry`
- **Spec (contract):** `docs/specs/timesheet-entry.spec.md` (FR-TSE-001..018, NFR-TSE-*, AC-TSE-001..024, oracle §3, traceability §7)
- **Author:** eng-planner (superpowers brainstorming + writing-plans; no-placeholder)
- **Charter / DoD:** `docs/product-expectations.md` (Architecture / Existing-repo / Performance lenses), `docs/director-playbook.md` §5 (test pyramid, ADR-0010)
- **Design source of truth:** `DESIGN.md` ("Quiet Control Surface" RIS tokens; light-only). The editable grid stays byte-for-byte on-token.
- **House format reference:** `docs/plans/2026-06-07-confirm-mutations.md`.

> **SECURITY-SENSITIVE WRITE FEATURE.** This issue adds a DB-write path *and* hardens an RLS WITH CHECK
> hole (§1.2 of the spec, FR-TSE-018). The **security-auditor MUST review** the migration — specifically
> the WITH CHECK rewrite and the `security invoker` posture (no `security definer` entry-write RPC, no
> `org_id` argument). Route the auditor at Review/Secure phase per the playbook §6.

---

## 1. Design

### 1.1 Architecture (what changes, where)

Three slices, built in this order so they do not thrash the shared files (`pages/Timesheets.tsx`, the
mutation hook, `src/lib/db/timesheets.ts`):

```
Slice 1  Backend          supabase/migrations/0011_timesheet_entry_with_check.sql   (NEW)
(TDD;     RLS + schema      supabase/tests/0046..0048_*.test.sql                     (NEW, pgTAP)
opus)    DAL writes        pmo-portal/src/lib/db/timesheets.ts                       (EXTEND)
         mutation hook     pmo-portal/src/hooks/useTimesheetEntries.ts              (NEW)

Slice 2  Frontend         pmo-portal/src/components/ui/TimesheetGrid.tsx            (EXTEND: editable mode)
(TDD)    editable grid    pmo-portal/pages/Timesheets.tsx                           (EXTEND: edit state machine)
         + picker         pmo-portal/src/lib/timesheet-edit.ts                      (NEW: pure diff/validate)

Slice 3  E2E              pmo-portal/e2e/AC-TSE-021-timesheet-entry.spec.ts          (NEW, one curated journey)
```

**Reuse (do not re-create):** `ConfirmDialog` (already shipped + already imported in `Timesheets.tsx` for
the T1 submit confirm), `useToast`, `Card`/`CardHead`/`Button`/`Icon`/`ListState`/`StatusPill`,
`listProjects({ status })` (`src/lib/db/projects.ts`), the `['timesheets', orgId, userId]` query key
(shared verbatim with `useTimesheets`), the date helpers `getWeekStartDate`/`formatDate` already in
`Timesheets.tsx`, and the `editable` predicate already half-expressed by `timesheetActions(...)`.

### 1.2 Data flow (Save)

The grid is **controlled in-memory edit state** (no DB write until Save). On Save the page:

1. Computes the Monday week-start (existing `getWeekStartDate`→`formatDate`).
2. If `currentTimesheet == null` → `createDraftTimesheet(weekStartDate)` first (returns the new sheet row;
   its `id` is the upsert target). If a unique race occurs, re-read and reuse (§6 of spec).
3. Diffs edited grid vs last-fetched server entries via the pure `diffEntries(...)` selector
   (`src/lib/timesheet-edit.ts`): cells with hours `> 0` that changed → upsert payload; cells that became
   `0`/blank with a pre-existing server entry → delete list; unchanged → omitted.
4. `upsertTimesheetEntries(upserts)` (one batched call, on the `(timesheet_id, project_id, entry_date)`
   unique key) + `deleteTimesheetEntry(id)` per zeroed cell.
5. On settle: invalidate `['timesheets', orgId, userId]` (refetch → grid reflects server state); toast.

**No `org_id` is ever sent** by the DAL — RLS scopes by `auth_org_id()` and ownership (NFR-TSE-SEC-001).
`error.code` is preserved through the DAL (throw a typed error carrying `code`) so the hook/UI can classify
(consistent with the procurement-lifecycle pattern in the repo).

### 1.3 Schema decision (OQ-2 — DECIDED: add the constraint)

`timesheet_entries` gets `unique (timesheet_id, project_id, entry_date)` so the canonical "one entry per
cell" shape (spec §3.2) supports an **idempotent upsert** (`on_conflict`). The migration first **collapses**
any pre-existing duplicate `(timesheet_id, project_id, entry_date)` rows (sum `hours`, keep the
lexicographically-min `id`, concatenate distinct notes) so the constraint applies cleanly — defensive even
though current seed (`supabase/seed.sql:204-208`) has no duplicate triple. The **same migration** also
hardens `timesheet_entries_write`'s WITH CHECK to mirror the USING clause (FR-TSE-018, §1.2). This is a
schema + RLS decision → recorded as **ADR-0015** (see §6). Reversible per ADR-0006 (`supabase db reset`);
the migration carries an explicit rollback comment.

### 1.4 Editable-state predicate (single source of "can write" — spec §3.1)

```
editable = (sheet == null) || (sheet.user_id === currentUser.id && sheet.status === 'Draft')
```

Computed once in `Timesheets.tsx`, threaded to `TimesheetGrid` as an `editable` prop and to the Add/Save/
delete affordances. A non-Draft sheet renders today's read-only grid unchanged (FR-TSE-002).

### 1.5 Pure logic extracted for cheap unit tests (NFR-TSE-PERF-001)

`src/lib/timesheet-edit.ts` (NEW) holds framework-free, memo-friendly functions so totals/validation/diff
are unit-proven without rendering and re-used by memoized selectors (no inline `.reduce` in JSX):

```ts
// src/lib/timesheet-edit.ts
export interface EditRow { project_id: string; project: string; code: string | null; hours: string[]; note: string; }
//                                                                        ^ 7 raw input strings (blank allowed)

/** Parse one cell. Blank ⇒ 0. Returns { value, valid }. Mirrors DB CHECK (0 ≤ h ≤ 24). */
export function parseHourCell(raw: string): { value: number; valid: boolean };

/** True iff every cell in every row parses valid (blank=0). Gates Save (FR-TSE-014). */
export function gridIsValid(rows: EditRow[]): boolean;

export interface GridTotals { perRow: number[]; perDay: number[]; weekly: number; }
/** Live totals from edited state (blank=0). (FR-TSE-013) */
export function computeTotals(rows: EditRow[]): GridTotals;

export interface EntryUpsert { timesheet_id: string; project_id: string; entry_date: string; hours: number; notes: string | null; }
export interface EntryDiff { upserts: EntryUpsert[]; deletes: string[]; } // deletes = server entry ids
/** Diff edited rows vs last-fetched server entries → insert/update (upserts) + delete ids. (FR-TSE-012) */
export function diffEntries(
  rows: EditRow[],
  weekDates: string[],            // 7 ISO dates, Monday-first
  serverEntries: { id: string; project_id: string; entry_date: string; hours: number }[],
  timesheetId: string,
): EntryDiff;
```

`Timesheets.tsx` owns the React edit state (`useState<EditRow[]>`), seeds it from `gridRows` when the week/
fetch changes, and calls these pure functions inside `useMemo`.

### 1.6 DAL signatures (exact — type consistency across tasks)

Add to `pmo-portal/src/lib/db/timesheets.ts` (no new file; the read fns already live here):

```ts
import type { EntryUpsert } from '@/src/lib/timesheet-edit';

/** Error carrying the PostgREST/PG code so the UI can classify (mirrors procurementLifecycle.ts). */
export class TimesheetWriteError extends Error { code?: string;
  constructor(message: string, code?: string) { super(message); this.name = 'TimesheetWriteError'; this.code = code; } }

/** Insert a Draft timesheet for (self, weekStartDate). org_id NOT sent (RLS sets it). Returns the row. */
export async function createDraftTimesheet(weekStartDate: string): Promise<TimesheetRow>;

/** Upsert entries on the (timesheet_id, project_id, entry_date) unique key. org_id NOT sent. */
export async function upsertTimesheetEntries(entries: EntryUpsert[]): Promise<void>;

/** Delete a single entry by id (zeroed cell). org_id NOT sent (RLS scopes). */
export async function deleteTimesheetEntry(id: string): Promise<void>;
```

`createDraftTimesheet` must send `user_id` (the signed-in user) and `week_start_date` only — never `org_id`
(the column default + the `timesheets_insert` WITH CHECK `user_id = auth.uid()` is the authority). Each fn
throws `TimesheetWriteError(error.message, error.code)` on PostgREST error.

### 1.7 Mutation hook (exact — `pmo-portal/src/hooks/useTimesheetEntries.ts`, NEW)

```ts
export interface SaveWeekInput {
  currentTimesheetId: string | null;   // null ⇒ create draft first
  weekStartDate: string;               // Monday ISO
  diff: EntryDiff;                      // from diffEntries()
}
export function useTimesheetEntryMutations(): {
  saveWeek: UseMutationResult<void, TimesheetWriteError, SaveWeekInput>;
  deleteRow: UseMutationResult<void, TimesheetWriteError, { entryIds: string[] }>;
};
```

`saveWeek` orchestrates create-if-null → upsert → deletes, then `invalidateQueries(['timesheets', orgId,
userId])` on success. `deleteRow` deletes a persisted row's entries then invalidates. `orgId`/`userId` come
from `useAuth()` exactly as in `useTimesheetApproval.ts`.

### 1.8 Out of scope (do not build — spec §2 OUT)

Assignee-filtered picker (OQ-1), lifecycle changes, recall affordance (OQ-3), per-cell notes, copy-week,
labor-cost rollup. **Baked-in decisions:** OQ-4 = row-level note (one note per project-row, written to all
that row's entries); OQ-5 = absence == zero (0/blank cell deletes the entry; no explicit 0-hour rows).

---

## 2. Build sequence (binding order)

1. **Slice 1 — Backend (implementer, opus: schema/RLS/security slice).** Tasks 1–9. Migration + pgTAP +
   DAL + hook. Land first; nothing downstream is correct without the upsert key + the write fns.
2. **Slice 2 — Frontend (ui-implementer, opus for the grid).** Tasks 10–22. Editable grid, picker, cells,
   validation, totals, save-diff, delete-confirm, states/a11y. Strictly DESIGN.md tokens.
3. **Slice 3 — E2E (qa-acceptance / implementer).** Task 23. One curated journey on the real stack.
4. **Verification.** Task 24. Full gate.

Tests live beside source. Run from `pmo-portal/`: `npm test -- <path>`, `npm run typecheck`,
`npm run lint -- --max-warnings=0`. pgTAP from repo root: `supabase test db`. Each task is RED→GREEN
(write the failing test first), with a small REFACTOR fold where noted.

---

## 3. Tasks

### Slice 1 — Backend

#### Task 1 — Migration: collapse duplicates + add the unique constraint + harden WITH CHECK (RED via pgTAP) — AC-TSE-022/023/024, FR-TSE-018
Write the migration FIRST so the pgTAP tasks have something to run against; the tests are the RED in Tasks 2–4.
**File (NEW):** `supabase/migrations/0011_timesheet_entry_with_check.sql`
```sql
-- 0011_timesheet_entry_with_check.sql — timesheet entry-write hardening + idempotent-upsert key.
-- (FR-TSE-018, NFR-TSE-SEC-001/002, NFR-TSE-TENANCY-001; ADR-0015)
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual rollback:
--   alter table timesheet_entries drop constraint timesheet_entries_cell_uq;
--   drop policy timesheet_entries_write on timesheet_entries;
--   create policy timesheet_entries_write on timesheet_entries for all
--     using (org_id = auth_org_id() and exists (select 1 from timesheets t
--       where t.id = timesheet_entries.timesheet_id and t.user_id = auth.uid() and t.status = 'Draft'))
--     with check (org_id = auth_org_id());   -- (the OLD, leaky clause)

-- (1) Collapse any pre-existing duplicate (timesheet_id, project_id, entry_date) rows so the new
-- unique constraint applies cleanly. Sum hours; keep the min(id); merge distinct notes. Defensive:
-- current seed (supabase/seed.sql) has no duplicate triple, so this is a no-op there.
with d as (
  select timesheet_id, project_id, entry_date,
         min(id) as keep_id,
         sum(hours) as total_hours,
         string_agg(distinct nullif(notes,''), '; ' order by nullif(notes,'')) as merged_notes,
         count(*) as n
  from timesheet_entries
  group by timesheet_id, project_id, entry_date
  having count(*) > 1
)
update timesheet_entries e
   set hours = least(d.total_hours, 24), notes = d.merged_notes
  from d
 where e.id = d.keep_id;
delete from timesheet_entries e
 using (
   select id, timesheet_id, project_id, entry_date,
          min(id) over (partition by timesheet_id, project_id, entry_date) as keep_id
     from timesheet_entries
 ) r
 where e.id = r.id and r.id <> r.keep_id;

-- (2) Idempotent-upsert key (OQ-2): one entry per cell.
alter table timesheet_entries
  add constraint timesheet_entries_cell_uq unique (timesheet_id, project_id, entry_date);

-- (3) Close the WITH CHECK hole (§1.2): the POST-image entry's parent timesheet must be the
-- caller's OWN and Draft — mirror the USING clause. Without this a same-org user could insert/
-- update an entry onto another user's (or a non-Draft) sheet. security-invoker posture: no RPC.
drop policy timesheet_entries_write on timesheet_entries;
create policy timesheet_entries_write on timesheet_entries for all
  using (org_id = auth_org_id() and exists (
    select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
      and t.user_id = auth.uid() and t.status = 'Draft'))
  with check (org_id = auth_org_id() and exists (
    select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
      and t.user_id = auth.uid() and t.status = 'Draft'));
```
**Verify:** `supabase db reset` succeeds (migration applies, seed loads), then proceed to Tasks 2–4.

#### Task 2 — pgTAP: cannot write an entry onto another user's sheet (the closed hole) — AC-TSE-022, FR-TSE-018/NFR-TSE-SEC-002
**File (NEW):** `supabase/tests/0046_timesheet_entry_with_check.test.sql`. Template: `supabase/tests/0033_project_direct_update_revoked.test.sql` (JWT-switch + `throws_ok`).
RED first (run before Task 1 lands to confirm it would fail on the old policy is not possible since the migration is one file — instead author the test, run, watch it pass post-migration; the spec's hole is the oracle).
- `plan(3)`. Fixtures: one org; users A (`...a1`) + B (`...b1`), both profiles; one Active project; A has a Draft timesheet `TA`, B has a Draft timesheet `TB`; A has one own entry `EA` on `TA`.
- `set local role authenticated` + A's JWT.
- `select throws_ok($$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours) values (auth_org_id(), '<TB>', '<proj>', '2026-06-01', 8) $$, '42501', NULL, 'AC-TSE-022: A cannot INSERT an entry onto B''s sheet (hardened WITH CHECK)');`
- `select throws_ok($$ update timesheet_entries set timesheet_id = '<TB>' where id = '<EA>' $$, '42501', NULL, 'AC-TSE-022: A cannot UPDATE an entry to point at B''s sheet');`
- `select lives_ok($$ update timesheet_entries set hours = 6 where id = '<EA>' $$, 'AC-TSE-022: A can still update hours on A''s own Draft entry (no over-restrict)');`
- (Note: RLS WITH CHECK violations surface as SQLSTATE `42501`; assert that code, as `0033` does.)
**Verify:** `supabase test db` → file `0046` green (3/3).

#### Task 3 — pgTAP: cannot write to own non-Draft sheet; can write to own Draft — AC-TSE-023, FR-TSE-018/NFR-TSE-SEC-001
**File (NEW):** `supabase/tests/0047_timesheet_entry_own_draft.test.sql`.
- `plan(2)`. Fixtures: one org; user A; one Active project; A owns a **Submitted** sheet `TS` and a **Draft** sheet `TD`. A's JWT.
- `select throws_ok($$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours) values (auth_org_id(), '<TS>', '<proj>', '2026-06-08', 8) $$, '42501', NULL, 'AC-TSE-023: A cannot INSERT an entry onto A''s own Submitted sheet');`
- `select lives_ok($$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours) values (auth_org_id(), '<TD>', '<proj>', '2026-06-08', 8) $$, 'AC-TSE-023: A can INSERT a valid entry onto A''s own Draft sheet');`
**Verify:** `supabase test db` → file `0047` green (2/2).

#### Task 4 — pgTAP: cross-org entry write blocked — AC-TSE-024, NFR-TSE-TENANCY-001
**File (NEW):** `supabase/tests/0048_timesheet_entry_tenancy.test.sql`.
- `plan(1)`. Fixtures: org-A + org-B; user A in org-A; a Draft timesheet `TBORG` owned by a user in org-B; an Active project in org-B. A's JWT.
- `select throws_ok($$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours) values (auth_org_id(), '<TBORG>', '<projB>', '2026-06-01', 8) $$, '42501', NULL, 'AC-TSE-024: A (org-A) cannot write an entry referencing an org-B timesheet, any org_id');`
- (Also assert the variant with an explicit foreign `org_id` literal is rejected — add as a 2nd `throws_ok` and bump `plan(2)` if the auditor wants the explicit-org_id case; minimal version is `auth_org_id()`-supplied which the `exists` subquery + org match both block.)
**Verify:** `supabase test db` → file `0048` green.

#### Task 5 — DAL `createDraftTimesheet` (RED→GREEN) — AC-TSE-019 (part), FR-TSE-017
**Test file:** `pmo-portal/src/lib/db/timesheets.test.ts` (NEW or extend). Mock `supabase` (vi.mock the client) as the repo's other DAL tests do.
RED: `it('AC-TSE-019: createDraftTimesheet inserts (user_id, week_start_date, status=Draft), sends NO org_id, throws TimesheetWriteError preserving error.code', ...)`.
- Assert the `.insert(...)` payload contains `user_id`, `week_start_date`, `status: 'Draft'` and **no `org_id` key**; `.select().single()` is chained; on `{ error: { message, code: '23505' } }` it throws `TimesheetWriteError` with `.code === '23505'`.
GREEN: implement per §1.6. `user_id` is a required arg-or-from-auth — pass it in from the hook (the DAL takes `weekStartDate` only and reads `user_id`? NO — DAL is auth-free; **the hook passes `user_id`**). **Resolve:** signature is `createDraftTimesheet(weekStartDate: string, userId: string)`; the hook supplies `userId` from `useAuth`. Update §1.6 callers accordingly.
**Verify:** `npm test -- src/lib/db/timesheets.test.ts`.

#### Task 6 — DAL `upsertTimesheetEntries` (RED→GREEN) — AC-TSE-019 (part), FR-TSE-017
**Test file:** same as Task 5.
RED: `it('AC-TSE-019: upsertTimesheetEntries upserts on (timesheet_id,project_id,entry_date), sends NO org_id, throws TimesheetWriteError preserving code', ...)`.
- Assert `.from('timesheet_entries').upsert(entries, { onConflict: 'timesheet_id,project_id,entry_date' })` is called; payload rows contain `timesheet_id/project_id/entry_date/hours/notes` and **no `org_id`**; on PostgREST error throws `TimesheetWriteError` with `.code`.
GREEN: implement.
**Verify:** `npm test -- src/lib/db/timesheets.test.ts`.

#### Task 7 — DAL `deleteTimesheetEntry` (RED→GREEN) — AC-TSE-019 (part), FR-TSE-017
**Test file:** same as Task 5.
RED: `it('AC-TSE-019: deleteTimesheetEntry deletes by id, sends NO org_id, throws TimesheetWriteError preserving code', ...)`.
- Assert `.from('timesheet_entries').delete().eq('id', id)`; on error throws `TimesheetWriteError` with `.code`.
GREEN: implement.
**Verify:** `npm test -- src/lib/db/timesheets.test.ts`.

#### Task 8 — Pure logic `parseHourCell` / `gridIsValid` / `computeTotals` (RED→GREEN) — AC-TSE-009/010/011/012, FR-TSE-013/014
**Test file (NEW):** `pmo-portal/src/lib/timesheet-edit.test.ts`.
RED, in order:
- `it('AC-TSE-009: parseHourCell rejects > 24', ...)` → `parseHourCell('25').valid === false`.
- `it('AC-TSE-010: parseHourCell rejects negative and non-numeric', ...)` → `'-3'` invalid, `'8h'` invalid.
- `it('AC-TSE-011: blank=0 and boundaries 0 and 24 are valid', ...)` → `''→{0,true}`, `'0'→{0,true}`, `'24'→{24,true}`; `gridIsValid` true for a grid of those.
- `it('AC-TSE-012: computeTotals sums per-row/per-day/weekly from edited blank=0 state', ...)` → a row with Mon=`'6'`, Tue=`'4'`, rest blank ⇒ `perRow[0]===10`, `perDay[0]===6`, `perDay[1]===4`, `weekly===10`.
GREEN: implement per §1.5.
**Verify:** `npm test -- src/lib/timesheet-edit.test.ts`.

#### Task 9 — Pure `diffEntries` + mutation hook `useTimesheetEntryMutations` (RED→GREEN) — AC-TSE-016/017/018, FR-TSE-011/012/016/017
**Test files (NEW):** `pmo-portal/src/lib/timesheet-edit.test.ts` (diff) + `pmo-portal/src/hooks/useTimesheets.test.tsx` (hook; matches spec §7 artifact name — note this is the **entries** mutation hook tested in that file).
RED — diff (`timesheet-edit.test.ts`):
- `it('AC-TSE-017: diffEntries emits upserts for changed/new cells, deletes for zeroed cells, omits unchanged', ...)`: given a server entry P/Mon=8 and edited P/Mon='6', P/Tue='4', P/Wed='' (was 2) ⇒ `upserts` has Mon=6 + Tue=4 (with `timesheet_id`, no `org_id`), `deletes` has the Wed entry id, unchanged cells absent.
RED — hook (`useTimesheets.test.tsx`), mock the DAL fns:
- `it('AC-TSE-016: saveWeek creates a Draft then upserts entries then invalidates [timesheets,orgId,userId] when currentTimesheetId is null', ...)`: assert `createDraftTimesheet` called once with the Monday + userId, then `upsertTimesheetEntries` against the new id, then `invalidateQueries` with the exact key.
- `it('AC-TSE-018: saveWeek failure rejects with TimesheetWriteError (code preserved) and does NOT invalidate', ...)`: DAL throws ⇒ mutation `isError`, error carries `.code`, no invalidate.
GREEN: implement `diffEntries` (§1.5) + the hook (§1.7) with `createDraftTimesheet(weekStartDate, userId)`.
**Verify:** `npm test -- src/lib/timesheet-edit.test.ts src/hooks/useTimesheets.test.tsx`.

### Slice 2 — Frontend

#### Task 10 — `TimesheetGrid` editable prop surface (RED→GREEN) — AC-TSE-001, FR-TSE-001
**Test file:** `pmo-portal/src/components/ui/__tests__/timesheet.test.tsx` (extend; spec §7 artifact).
Extend `TimesheetGridProps` with: `editable?: boolean`, `onCellChange?: (rowId: string, dayIndex: number, raw: string) => void`, `onNoteChange?: (rowId: string, note: string) => void`, `onDeleteRow?: (rowId: string) => void`, and per-row `note?: string` + `invalidCells?: Set<string>` (`"<rowId>:<dayIdx>"`). When `editable` each cell renders an `<input inputMode="decimal" aria-label="<project>, <weekday> hours">` (NFR-TSE-A11Y-001) instead of the read-only div; a per-row delete `Button variant="outline" size="icon"` with `aria-label="Delete <project> row"` renders.
RED: `it('AC-TSE-001: editable grid renders hour inputs + per-row delete when editable', ...)` — `editable` rows show `getAllByRole('spinbutton'|'textbox')` inputs + a delete button; default (`editable` false) keeps the read-only divs unchanged (assert the shipped read-only path still renders `·`).
GREEN: branch the cell + add the delete control. **Tokens:** input uses `h-9 min-w-[44px] rounded-md` matching the existing cell box, `border border-border bg-card text-center tabular`, focus ring from the global `:focus-visible` (no new tokens). Invalid cell adds `border-destructive` + `aria-invalid` (no raw hex). Read-only branch byte-for-byte unchanged.
**Verify:** `npm test -- src/components/ui/__tests__/timesheet.test.tsx`.

#### Task 11 — Editable cell edit + note edit fire callbacks, no write (RED→GREEN) — AC-TSE-007/008, FR-TSE-006/007/010
**Test file:** `pmo-portal/src/components/ui/__tests__/timesheet.test.tsx`.
RED:
- `it('AC-TSE-007: typing into a cell calls onCellChange and does not write', ...)`: type `8` into Tue input ⇒ `onCellChange(rowId, 1, '8')`; no DAL/mutation invoked (grid has no DAL — assert callback only).
- `it('AC-TSE-008: editing the row note calls onNoteChange', ...)`: a per-row note input (`aria-label="<project> note"`) ⇒ `onNoteChange(rowId, 'text')`.
GREEN: wire the inputs to the callbacks. Add the row-note input (compact, `text-[13px]`, under/beside the project name; token `text-muted-foreground` placeholder, no new color).
**Verify:** `npm test -- src/components/ui/__tests__/timesheet.test.tsx`.

#### Task 12 — Inline per-cell validation error rendering (RED→GREEN) — AC-TSE-009/010, FR-TSE-014
**Test file:** `pmo-portal/src/components/ui/__tests__/timesheet.test.tsx`.
RED: `it('AC-TSE-009/010: an invalid cell shows an inline error and marks aria-invalid', ...)`: with `invalidCells` containing `"<rowId>:2"`, that input has `aria-invalid="true"` and an adjacent `role="alert"` text "0–24 only" (or similar); valid cells do not.
GREEN: render the per-cell error from `invalidCells`. **Tokens:** error text `text-destructive text-[11px]`, color-not-only (the `border-destructive` from Task 10 + the text). The *logic* of validity lives in `timesheet-edit.ts` (Task 8); the grid only displays `invalidCells` passed in by the page.
**Verify:** `npm test -- src/components/ui/__tests__/timesheet.test.tsx`.

#### Task 13 — Live totals in editable mode use computeTotals (RED→GREEN) — AC-TSE-012, FR-TSE-013
**Test file:** `pmo-portal/src/components/ui/__tests__/timesheet.test.tsx`.
RED: `it('AC-TSE-012: editable grid totals reflect edited cell values live', ...)`: render `editable` with a row whose `hours` strings are `['6','4','','','','','']` ⇒ row-total cell shows `10`, daily-total[0] `6`, daily-total[1] `4`, grand-total `10`.
GREEN: when `editable`, derive `dailyTotals`/`rowTotal`/`grandTotal` from `computeTotals(parsed rows)` (parsing blank=0) instead of the numeric `r.hours` reduce. Keep the read-only branch's existing numeric reduce. Memoize.
**Verify:** `npm test -- src/components/ui/__tests__/timesheet.test.tsx`.

#### Task 14 — Page: editable-state predicate + render editable grid for Draft/absent (RED→GREEN) — AC-TSE-001/002/003/004, FR-TSE-001/002/003
**Test file:** `pmo-portal/pages/Timesheets.test.tsx` (extend; spec §7 artifact). Mock `useTimesheets`, `useAuth`, `useTimesheetEntryMutations`, `useProjects`/`listProjects`.
RED, in order:
- `it('AC-TSE-001: a Draft sheet owned by the signed-in user renders the editable grid + Add project + delete', ...)`.
- `it('AC-TSE-002: an empty week renders an editable empty grid with Add project and issues NO create write on mount', ...)` — assert `createDraftTimesheet`/`saveWeek` NOT called on render.
- `it('AC-TSE-003: a Submitted sheet renders read-only (no inputs, no Add, no delete, no Save)', ...)`.
- `it('AC-TSE-004: an Approved sheet renders read-only', ...)`.
GREEN: compute `editable` (§1.4), seed `useState<EditRow[]>` from `gridRows`, pass `editable` + callbacks to `TimesheetGrid`, render the "Add project" + "Save" controls only when `editable`. The empty-state branch becomes an editable empty grid (Add project visible) when `editable`, else the shipped `timesheets-empty` ListState.
**Verify:** `npm test -- pages/Timesheets.test.tsx`.

#### Task 15 — Project picker: Active-minus-present, shaped for later assignee filter (RED→GREEN) — AC-TSE-005/006, FR-TSE-004/005
**Test file:** `pmo-portal/pages/Timesheets.test.tsx`.
Add a thin `useProjects({ status: 'Ongoing Project' })` read (NEW hook `pmo-portal/src/hooks/useProjects.ts` wrapping `listProjects` with key `['projects', orgId, { status }]`, OR reuse an existing projects hook if present — implementer: grep first; if `useProjects` exists, reuse it and skip the new file).
RED:
- `it('AC-TSE-005: selecting a project from the picker adds an empty editable row (0×7) and writes nothing', ...)`.
- `it("AC-TSE-006: the picker offers only Active projects not already a row (P present + R non-active excluded, Q offered)", ...)` — projects `{P Ongoing (present), Q Ongoing, R Leads}` ⇒ options = `[Q]`.
GREEN: an "Add project" `Button` opens a picker (reuse the app's existing select/menu primitive — grep `components/ui` for a `Select`/`Combobox`/`Menu`; if none, a native `<select>` with `aria-label="Add a project"` is acceptable and on-token). Options = `listProjects` filtered `status === 'Ongoing Project'` minus rows already in edit state. Selecting appends an `EditRow` with `hours: ['','','','','','','']`. The filter is a pure predicate so an `assigneeId` clause can be added later (OQ-1) without changing the call site.
**Verify:** `npm test -- pages/Timesheets.test.tsx`.

#### Task 16 — Save: diff + commit + invalidate + success toast (RED→GREEN) — AC-TSE-016/017, FR-TSE-011/012/016
**Test file:** `pmo-portal/pages/Timesheets.test.tsx`.
RED:
- `it('AC-TSE-016: Save on an empty week creates the Draft then upserts entries then toasts success', ...)`: enter hours on an added row, click Save ⇒ `saveWeek` called with `{ currentTimesheetId: null, weekStartDate: <Monday>, diff }`; on success a success toast renders.
- `it('AC-TSE-017: Save diffs an existing sheet to upsert changed cells and delete a zeroed cell', ...)`: given a mocked Draft with a server P/Mon=8 entry, change Mon→6, add Tue→4, clear a 2h Wed, Save ⇒ the `diff` passed to `saveWeek` has `upserts` Mon=6 + Tue=4 and `deletes` the Wed id.
GREEN: the Save button (`Button variant="primary"`, visible only when `editable`) builds `diffEntries(editRows, weekDates, serverEntries, currentTimesheetId ?? '')` and calls `saveWeek.mutate(...)`; `onSuccess` toasts `('Timesheet saved', '<n> changes saved', 'success')`. Save is `disabled` while `!gridIsValid(editRows)` (Task 17 covers the assertion) or `saveWeek.isPending`.
**Verify:** `npm test -- pages/Timesheets.test.tsx`.

#### Task 17 — Save blocked while any cell invalid; failure toast keeps edits (RED→GREEN) — AC-TSE-009/010/011/018, FR-TSE-014/016
**Test file:** `pmo-portal/pages/Timesheets.test.tsx`.
RED:
- `it('AC-TSE-009/010: Save is disabled while a cell is invalid (25 / -3 / 8h) and enabled when all valid', ...)`.
- `it('AC-TSE-011: blank/0/24 cells leave Save enabled', ...)`.
- `it('AC-TSE-018: a Save failure shows a failure toast carrying the error message and keeps the unsaved edits', ...)`: `saveWeek` rejects with `TimesheetWriteError('…','42501')` ⇒ warning toast with the message; the edited cell values are still in the inputs; query not marked successful.
GREEN: `disabled={!gridIsValid(editRows) || saveWeek.isPending}`; the page computes `invalidCells` from `parseHourCell` per cell and passes to the grid; `onError` toasts `('Save failed', err.message, 'warning')` and does **not** reset edit state.
**Verify:** `npm test -- pages/Timesheets.test.tsx`.

#### Task 18 — Delete row behind mandatory destructive ConfirmDialog (RED→GREEN) — AC-TSE-013/014/015, FR-TSE-008/009
**Test file:** `pmo-portal/pages/Timesheets.test.tsx`.
RED:
- `it('AC-TSE-013: activating row delete opens a destructive ConfirmDialog and does not remove the row yet', ...)`: assert a `tone="destructive"` `ConfirmDialog` (role `alertdialog`) opens; row still present.
- `it('AC-TSE-014: confirming delete removes the row and deletes its persisted entries via deleteRow', ...)`: confirm ⇒ row gone; for a persisted row, `deleteRow.mutate({ entryIds })` called with that row's server entry ids; for an unsaved added row, no DAL call (just removed from edit state).
- `it('AC-TSE-015: cancelling delete keeps the row and issues no delete write', ...)`.
GREEN: a `confirmDeleteRowId` state; the grid's `onDeleteRow` sets it; render `ConfirmDialog open tone="destructive" title="Delete this project row?" confirmLabel="Delete row"`; `onConfirm` removes the `EditRow` and, if it maps to server entries, calls `deleteRow.mutate({ entryIds })` then toasts. Reuse the shipped `ConfirmDialog` already imported in the file.
**Verify:** `npm test -- pages/Timesheets.test.tsx`.

#### Task 19 — Loading + error states parity (RED→GREEN) — AC-TSE-020, FR-TSE-015
**Test file:** `pmo-portal/pages/Timesheets.test.tsx`.
RED: `it('AC-TSE-020: pending shows the loading skeleton; error shows the error+Retry state', ...)`: mock `useTimesheets` `isPending` then `isError` ⇒ `timesheets-loading` then the `ListState variant="error"` with a Retry calling `refetch`.
GREEN: these branches already exist in `Timesheets.tsx` (lines 269–292) — assert they are preserved unchanged by the edit work (regression guard; no new code expected, REFACTOR-only if the edit-state seeding broke them).
**Verify:** `npm test -- pages/Timesheets.test.tsx`.

#### Task 20 — a11y pass: cell labels, keyboard, picker, focus-trapped confirm (RED→GREEN) — NFR-TSE-A11Y-001
**Test file:** `pmo-portal/src/components/ui/__tests__/timesheet.test.tsx` + `pmo-portal/pages/Timesheets.test.tsx`.
RED: `it('NFR-TSE-A11Y-001: every editable cell has aria-label "<project>, <weekday> hours"; the picker is labelled; the delete confirm is an alertdialog', ...)`: assert each input's `aria-label` matches the pattern; the picker control has an accessible name; the delete dialog has `role="alertdialog"` + accessible name (the `ConfirmDialog` primitive already focus-traps + restores focus — assert its presence, not re-test the primitive).
GREEN: ensure labels/roles from Tasks 10/15/18 satisfy the assertions; add any missing `aria-label`. No new primitive.
**Verify:** `npm test -- src/components/ui/__tests__/timesheet.test.tsx pages/Timesheets.test.tsx`.

#### Task 21 — DESIGN.md token audit (REFACTOR, no behavior change) — NFR-TSE-A11Y-001, design DoD
No new test. Re-read `DESIGN.md` "How to use these tokens" + the `tsgrid` section; confirm every class added in Tasks 10–18 is an existing token utility (`bg-card`, `border-border`, `rounded-md`, `text-destructive`, `text-muted-foreground`, the global focus ring) — **zero raw hex/px beyond the existing grid metrics** (`h-9`, `min-w-[44px]`, `min-w-[64px]` already in the file). Fix any drift.
**Verify:** `npm run typecheck` + `npm run lint -- --max-warnings=0`; flag the surface for `/design-review` (design-reviewer renders the editable grid in default / invalid-cell / read-only / delete-confirm / 375px states).

#### Task 22 — Slice-2 green gate (REFACTOR)
Run the full unit suite for the changed files; ensure ≥80% lines on `TimesheetGrid.tsx`, `Timesheets.tsx`, `timesheet-edit.ts`, `useTimesheetEntries.ts`, `timesheets.ts`.
**Verify:** `npm test -- src/lib/timesheet-edit.test.ts src/lib/db/timesheets.test.ts src/hooks/useTimesheets.test.tsx src/components/ui/__tests__/timesheet.test.tsx pages/Timesheets.test.tsx` ; `npm run typecheck`.

### Slice 3 — E2E

#### Task 23 — Curated journey: create → edit → delete → submit (RED→GREEN) — AC-TSE-021, FR-TSE-001/003/006/008/011/012
**File (NEW):** `pmo-portal/e2e/AC-TSE-021-timesheet-entry.spec.ts`. Helper: `import { login } from './helpers'`; engineer = `engineer@acme.test` (seed `a4`).
**Seed-collision guard (binding):** the seeded engineer Draft sheet for week `2026-06-01` is **submitted by `AC-911`**. To avoid cross-spec seed pollution, this journey operates on a **different, initially-empty week** — navigate forward one week from "today" via the "Next week" control until an empty editable grid (no rows) is shown, then build it fresh. The Active project to add is **"Acme Internal Platform" (P003, `40000000-…0004`, status `Ongoing Project`)** — not present in any seeded week.
`test('AC-TSE-021 engineer logs, edits, deletes, submits a week through the real stack', async ({ page }) => { … })`:
1. `await login(page, 'engineer@acme.test'); await page.goto('/timesheets');` wait `timesheets-loading` gone.
2. Step weeks forward to an empty week (loop: click `Next week` until `timesheets-empty` or an empty editable grid renders).
3. Add project: click "Add project", select "Acme Internal Platform".
4. Enter hours: fill the Mon input with `8`, Tue with `6` (per-cell `aria-label`).
5. Save: click Save → assert success toast and the weekly total reads `14.0 h this week` (Draft created on first Save — assert the `Draft — not submitted` pill present, i.e. a sheet now exists).
6. Edit: change Mon to `4`, Save again → weekly total `10.0 h this week` (round-trips through the DB).
7. Delete: click the row delete → destructive `ConfirmDialog` (`getByRole('alertdialog')`) → confirm → row gone; weekly total `0.0 h`.
8. Re-add + enter `8` Mon, Save, then Submit: click "Submit timesheet" → confirm dialog → confirm → assert `Submitted` pill and the grid is read-only (no `spinbutton`/editable inputs; no "Add project"; no Save).
**Verify:** from `pmo-portal/`: `npx playwright test e2e/AC-TSE-021-timesheet-entry.spec.ts`.

#### Task 24 — Full verification gate (REFACTOR/green)
**Verify (all must pass):**
- `cd pmo-portal && npm test` (full unit) — green; coverage ≥80% on changed files.
- `npm run typecheck` — zero errors.
- `npm run lint -- --max-warnings=0` — zero.
- repo root `supabase test db` — `0046`/`0047`/`0048` green + no regression in `0007`.
- `npx playwright test e2e/AC-TSE-021-timesheet-entry.spec.ts` — green.

---

## 4. Traceability (AC → task → owning layer — matches spec §7)

| AC | FR | Owning layer | Task(s) | Test artifact |
|---|---|---|---|---|
| AC-TSE-001 | FR-TSE-001 | Unit | 10, 14 | `pages/Timesheets.test.tsx`, `…/__tests__/timesheet.test.tsx` |
| AC-TSE-002 | FR-TSE-003 | Unit | 14 | `pages/Timesheets.test.tsx` |
| AC-TSE-003 | FR-TSE-002 | Unit | 14 | `pages/Timesheets.test.tsx` |
| AC-TSE-004 | FR-TSE-002 | Unit | 14 | `pages/Timesheets.test.tsx` |
| AC-TSE-005 | FR-TSE-004 | Unit | 15 | `pages/Timesheets.test.tsx` |
| AC-TSE-006 | FR-TSE-005 | Unit | 15 | `pages/Timesheets.test.tsx` |
| AC-TSE-007 | FR-TSE-006 | Unit | 11 | `…/__tests__/timesheet.test.tsx` |
| AC-TSE-008 | FR-TSE-007 | Unit | 11 | `…/__tests__/timesheet.test.tsx` |
| AC-TSE-009 | FR-TSE-014 | Unit | 8, 12, 17 | `src/lib/timesheet-edit.test.ts`, `…/__tests__/timesheet.test.tsx`, `pages/Timesheets.test.tsx` |
| AC-TSE-010 | FR-TSE-014 | Unit | 8, 12, 17 | as above |
| AC-TSE-011 | FR-TSE-014 | Unit | 8, 17 | `src/lib/timesheet-edit.test.ts`, `pages/Timesheets.test.tsx` |
| AC-TSE-012 | FR-TSE-013 | Unit | 8, 13 | `src/lib/timesheet-edit.test.ts`, `…/__tests__/timesheet.test.tsx` |
| AC-TSE-013 | FR-TSE-008 | Unit | 18 | `pages/Timesheets.test.tsx` |
| AC-TSE-014 | FR-TSE-008 | Unit | 18 | `pages/Timesheets.test.tsx` |
| AC-TSE-015 | FR-TSE-009 | Unit | 18 | `pages/Timesheets.test.tsx` |
| AC-TSE-016 | FR-TSE-011/012/017 | Unit | 9, 16 | `src/hooks/useTimesheets.test.tsx`, `pages/Timesheets.test.tsx` |
| AC-TSE-017 | FR-TSE-012 | Unit | 9, 16 | `src/lib/timesheet-edit.test.ts`, `pages/Timesheets.test.tsx` |
| AC-TSE-018 | FR-TSE-016 | Unit | 9, 17 | `src/hooks/useTimesheets.test.tsx`, `pages/Timesheets.test.tsx` |
| AC-TSE-019 | FR-TSE-017 | Unit | 5, 6, 7 | `src/lib/db/timesheets.test.ts` |
| AC-TSE-020 | FR-TSE-015 | Unit | 19 | `pages/Timesheets.test.tsx` |
| AC-TSE-021 | FR-TSE-001/003/006/008/011/012 | E2E | 23 | `e2e/AC-TSE-021-timesheet-entry.spec.ts` |
| AC-TSE-022 | FR-TSE-018 / NFR-TSE-SEC-002 | pgTAP | 2 | `supabase/tests/0046_timesheet_entry_with_check.test.sql` |
| AC-TSE-023 | FR-TSE-018 / NFR-TSE-SEC-001 | pgTAP | 3 | `supabase/tests/0047_timesheet_entry_own_draft.test.sql` |
| AC-TSE-024 | NFR-TSE-TENANCY-001 | pgTAP | 4 | `supabase/tests/0048_timesheet_entry_tenancy.test.sql` |

**Owning-layer counts:** Unit = 19 ACs (001–020 minus 021), pgTAP = 3 ACs (022–024), E2E = 1 AC (021). Matches spec §7.

> AC-id tagging (ADR-0010): Vitest in the `it(...)` title; pgTAP as the leading token of the test description (`'AC-TSE-022: …'`); Playwright as the leading token of `test(...)` + the file name `AC-TSE-021-…`. An AC may be referenced at multiple layers but its **owning** layer is the one above.

---

## 5. NFR / DoD coverage

- **NFR-TSE-SEC-001/002** — security-invoker posture (no entry-write RPC, no `org_id` arg): proven by Tasks 2/3 (pgTAP) + DAL Tasks 5–7 asserting no `org_id`.
- **NFR-TSE-TENANCY-001** — Task 4 (pgTAP cross-org).
- **NFR-TSE-A11Y-001** — Tasks 10/15/18/20 (labels, keyboard, picker, focus-trapped confirm reused from `ConfirmDialog`).
- **NFR-TSE-PERF-001** — bounded writes (one create + one batched `upsert` + per-zeroed-cell delete; §1.2) + memoized totals via `computeTotals` (Task 13, 16), no inline `.reduce` in editable JSX.
- **org_id seam** — never sent by any DAL fn (Tasks 5–7); RLS asserts `org_id = auth_org_id()` (migration Task 1).
- **Reversible migration + RLS** — Task 1 carries the explicit rollback comment; `supabase db reset` per ADR-0006.
- **Coverage ≥80% / typecheck / lint** — Tasks 22, 24.

---

## 6. ADR

**ADR-0015 — Unique entry-cell key + WITH CHECK hardening for timesheet entry writes.** Warranted: a schema
change (new unique constraint, with a one-time data collapse) **and** an RLS authorization change (closing a
write-time tenancy/ownership hole) — both cross-cutting and security-relevant.
- **Context:** the editable grid needs an idempotent per-cell upsert (spec §3.2, OQ-2); the existing
  `timesheet_entries_write` WITH CHECK only checks `org_id`, letting a same-org user write onto another
  user's (or a non-Draft) sheet (spec §1.2).
- **Decision:** add `unique (timesheet_id, project_id, entry_date)` (collapsing pre-existing duplicates
  first), and rewrite the WITH CHECK to mirror the USING clause (own + Draft). No entry-write RPC; writes
  stay `security invoker` through RLS.
- **Consequences:** upserts become idempotent (retry-safe); the write-time hole closes (proven by pgTAP
  0046–0048); existing duplicate cells (none in current seed) are summed on migration; rollback is the
  documented `drop constraint` + restore-old-policy block (or `supabase db reset` pre-production).
- **File to author (implementer, Task 1 companion):** `docs/adr/0015-timesheet-entry-cell-key-and-with-check.md`.

---

## 7. Open questions for the Director

1. **OQ-3 (recall)** stays out of scope (reject→Draft covers it) — confirmed by the spec; no action unless
   the owner wants an engineer-initiated `Submitted → Draft` recall (small lifecycle add).
2. **Picker primitive:** the plan reuses an existing `Select`/menu if one exists in `components/ui`, else a
   native labelled `<select>`. Implementer greps first (Task 15); if a richer combobox is desired for taste,
   that is a design-reviewer call, not a behavior change — flag at `/design-review`.
3. **Explicit-foreign-`org_id` pgTAP variant (Task 4):** minimal version supplies `auth_org_id()`; the
   auditor may want the explicit-foreign-`org_id` literal case too (bump `plan` to 2). Defer to the
   security-auditor's exploit list at the Secure phase.
