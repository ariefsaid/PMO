# Spec: Timesheet entry + edit (engineers log/edit/delete their own hours)

**Status:** Draft — pending owner sign-off
**Feature slug:** `timesheet-entry`
**Issue:** Timesheet entry + edit — the WRITE path for the Timesheets surface (engineers create/edit/delete time on their own Draft sheet).
**FR prefix:** `FR-TSE-###`. Non-functional: `NFR-TSE-###`. Acceptance: `AC-TSE-###`.
**AC range:** `AC-TSE-001..AC-TSE-024` (grep-confirmed unused — the `TSE` namespace is clean).

Builds directly on the shipped READ path (`docs/specs/timesheets.spec.md`, `FR-TS-*`/`AC-60x`) and the
lifecycle/approval path (`docs/specs/timesheets-approval.spec.md`, `transition_timesheet`). This spec
delivers what both of those explicitly **deferred**: `OD-T2` (entry editing) and `OD-T3` (create a Draft
sheet for a week with none). No new lifecycle states are introduced; submit/approve/reject are unchanged.

---

## 1. Background & problem

Today the Timesheets surface (`pages/Timesheets.tsx`) is **read + submit/approve only**. The weekly grid
(`src/components/ui/TimesheetGrid.tsx`) renders project rows × 7 day cells **read-only** — its header
comment says so verbatim: *"Cells are read-only here (entry editing is a separate, deferred capability)."*
An engineer can see their hours and submit the week, but **cannot create or edit their own time**: there is
no way to add a project row, type hours into a day, edit a note, or delete a row. A week with no timesheet
renders an empty state with no way to start (`timesheets-empty`).

This issue makes the grid **editable while the sheet is Draft**: the engineer opens a week, adds a project
row, types hours per day, edits notes, deletes rows, and **Saves** — and on first Save for a week with no
sheet a Draft `timesheets` row is created. A Submitted/Approved sheet stays read-only; to fix a submitted
sheet the line manager rejects it back to Draft via the existing `transition_timesheet` reject path.

### 1.1 Ground truth (verified)

- **`timesheet_entries`** (`supabase/migrations/0001_init_schema.sql:193-201`): `id, org_id,
  timesheet_id → timesheets(on delete cascade), project_id → projects, entry_date date, hours
  numeric(5,2) CHECK (hours >= 0 AND hours <= 24), notes text`. Indexed on `timesheet_id`, `project_id`.
- **`timesheets`** (`:177-191`): `id, org_id, user_id → profiles, week_start_date date, status
  timesheet_status (Draft/Submitted/Approved/Rejected)`, `unique (user_id, week_start_date)`, CHECK
  `week_is_monday (extract(dow from week_start_date) = 1)`.
- **RLS (`supabase/migrations/0002_rls.sql:157-181`):**
  - `timesheets_insert` — `with check (org_id = auth_org_id() AND user_id = auth.uid())` (own row only).
  - `timesheets_update_own` — own + Draft, status pinned Draft in both USING and WITH CHECK (status
    changes must go through the RPC).
  - `timesheet_entries_write` (`FOR ALL`) — **USING** = entry's parent timesheet is the caller's own and
    `status='Draft'`; **but WITH CHECK is only `org_id = auth_org_id()`** (`:181`). **This is a known
    security hole** (the spec hardens it — see §1.2).
- **Lifecycle:** `transition_timesheet` (`0007_timesheet_approval.sql`) owns all status changes;
  `LEGAL_TIMESHEET_TRANSITIONS` (`src/lib/db/timesheetTransition.ts:20`) includes `Rejected → Draft`, so the
  manager's reject **returns a sheet to Draft** and re-opens it for editing — no new "recall" affordance is
  needed (see Open Question OQ-3).
- **Confirm-before-write rule (binding, `docs/plans/2026-06-07-confirm-mutations.md`):** *NOTHING writes to
  the DB on a single click.* Destructive/irreversible actions get a **mandatory** `ConfirmDialog`
  (`tone="destructive"`, centered modal + scrim); forward steps get a lightweight confirm. Save here is a
  form-style explicit action (its own deliberate click after typing), which satisfies the rule for the
  non-destructive write; **delete is destructive → mandatory confirm**.

### 1.2 The security hole this spec MUST close (flagged for security-auditor)

`timesheet_entries_write`'s WITH CHECK clause (`0002_rls.sql:181`) is `with check (org_id =
auth_org_id())` — it verifies **only** the org, not that the **post-image** entry points at a timesheet that
is the **caller's own and in Draft**. The USING clause (pre-image) is correctly tight, but USING does not
constrain the *new* row on INSERT, nor the *new* `timesheet_id` on UPDATE. **Consequence:** a user in the
same org can `insert into timesheet_entries (timesheet_id = <another user's sheet>, …)` (or `update … set
timesheet_id = <another user's sheet>`) and the write passes RLS, because WITH CHECK never re-checks
ownership/Draft of the target sheet. This is a write-time tenancy/authorization defect. **This spec requires
tightening the WITH CHECK to mirror the USING clause** (target timesheet is the writer's own AND Draft) —
see `FR-TSE-018` / `NFR-TSE-SEC-002` / `AC-TSE-022`/`AC-TSE-023`.

---

## 2. Scope

### IN
- Make the weekly grid editable **while the current week's sheet is Draft (or absent)**: add a project row,
  enter/edit per-day hours, edit a per-row note, delete a row.
- **Lazy Draft creation:** opening a week with no sheet shows an editable empty grid; the Draft `timesheets`
  row is created on **first Save** (not on mount, not on row-add — no write until the explicit Save).
- **Explicit Save** that commits the week's changed cells/rows in one action (form-style; no per-keystroke
  writes).
- **Delete row** behind a **mandatory destructive `ConfirmDialog`**.
- **Project picker** = any **Active org project** (`status = 'Ongoing Project'`) not already a row that week.
  Designed to be filtered to *assigned* projects later (post-MVP, §9 OQ-1) without an API reshape.
- Inline client-side validation: hours numeric, `0 ≤ h ≤ 24`, blank = 0; reject `>24` / negative / non-numeric
  with an inline per-cell error, blocking Save of the invalid cell.
- Live per-day totals, per-row totals, and weekly total recomputed from the edited (unsaved) grid state.
- All write affordances disabled + RLS-blocked once the sheet is **not Draft** (read-only).
- States: loading, empty (Draft, no rows yet), error (save failed, with retry), validation error, read-only
  (Submitted/Approved).
- a11y (WCAG-AA): labelled hour inputs (per-cell `aria-label`), keyboard-navigable grid, accessible picker,
  focus-trapped confirm dialog.
- **Security:** tighten `timesheet_entries_write` WITH CHECK to require the target timesheet is the writer's
  own AND Draft (§1.2).
- DAL + hook for the entry writes (create-draft / upsert-entries / delete-entry), org_id never sent.

### OUT (deferred — do not build)
- Restricting the project picker to *assigned* projects (no project-assignment model exists yet) —
  §9 OQ-1, post-MVP follow-up.
- Submit/approve/reject lifecycle changes (shipped; unchanged here).
- A dedicated "recall a submitted sheet" affordance (the reject→Draft path covers it; §9 OQ-3).
- Copy-last-week / bulk-fill / templates / per-cell notes (row-level note only this issue).
- Labor cost roll-up into budgets (timesheets carry no cost basis; out of scope, tracked elsewhere).
- Time-off / leave / non-project hours categories.

---

## 3. Behavior model (precise — the test oracle)

### 3.1 Editable-state predicate (the single source of "can write")
A week's grid is **editable** iff: the signed-in user is the sheet's owner (or the sheet does not yet exist,
in which case the signed-in user will own the created sheet) **AND** the sheet status is `Draft` (or absent).
Formally `editable = (sheet == null) || (sheet.user_id === currentUser.id && sheet.status === 'Draft')`.
A non-Draft sheet (`Submitted`/`Approved`/`Rejected-not-yet-returned`) → **read-only** (UI disables every
write affordance; RLS independently rejects the write). Note `Rejected` is a transient pre-image: the manager's
reject moves the row to `Draft`, so an engineer never edits a `Rejected` row — they edit the resulting `Draft`.

### 3.2 What "Save" commits
Save diffs the in-memory edited grid against the last-fetched server state for the current week and commits,
in one user action:
- **Create-draft-if-absent:** if no `timesheets` row exists for `(currentUser.id, weekStartDate)`, insert one
  `(user_id = self, week_start_date = Monday-of-week, status = 'Draft')` first (one row; respects
  `unique(user_id, week_start_date)` and `week_is_monday`).
- **Entry writes (per project-row × day cell):** the canonical entry shape this issue is **one entry per
  `(timesheet_id, project_id, entry_date)`** (the read path already sums per project per day; this issue
  collapses to a single entry per cell). For each cell: hours `> 0` and no server entry → **insert**; hours
  changed and a server entry exists → **update**; hours set to `0`/blank and a server entry exists →
  **delete that entry** (a 0-hour cell is not persisted). Note text is written on every entry of its row.
- **No-op cells** (unchanged) are not written.
- Save is **atomic per intent from the user's view**: on any write error the toast reports failure and the
  user can retry; partial application is acceptable only insofar as a retry converges (idempotent upsert by
  `(timesheet_id, project_id, entry_date)`).

> Implementation note (non-binding, for the planner): the cell→insert/update/delete diff is most robustly
> served by a single `upsert` on a `(timesheet_id, project_id, entry_date)` unique key plus deletes for
> zeroed cells. Adding that unique constraint is a **schema decision for the plan/ADR**, flagged in §9 OQ-2.

### 3.3 Hour-cell validation (client-side, mirrors the DB CHECK)
A cell value is valid iff it parses as a number with `0 ≤ value ≤ 24`. Blank ⇒ `0`. Invalid (`> 24`,
negative, or non-numeric like `"8h"`) ⇒ inline per-cell error, the cell is marked invalid, and **Save is
blocked while any cell is invalid**. This mirrors the DB `CHECK (hours >= 0 AND hours <= 24)` so the user
never round-trips to discover a constraint violation; the DB CHECK remains the backstop.

### 3.4 Project picker
Options = Active org projects (`status = 'Ongoing Project'`, the on-hand "actively-running" status per
`docs/decisions.md` OD-SP-1) **minus** projects already present as a row in the current week. Selecting a
project adds an empty editable row (0 across all 7 days) to the in-memory grid; the row is not persisted
until Save writes a non-zero cell. The picker data comes from `listProjects({ status: 'Ongoing Project' })`
— the DAL already accepts a `status` filter, and accepts an optional assignee filter later (post-MVP OQ-1).

### 3.5 Live totals
Per-day total = Σ of that day's cells across all rows (incl. unsaved edits); per-row total = Σ of the row's 7
cells; weekly total = Σ of all cells. All recompute from the **edited** in-memory state (not the last-saved
server state) so the figures track typing live, before Save.

---

## 4. Functional requirements (EARS)

### Editable grid & state gating
- **FR-TSE-001** — While the current week's sheet is Draft or absent and owned (or to-be-owned) by the
  signed-in user, when the Timesheets weekly-grid view renders, the system shall present the hour cells as
  editable numeric inputs and expose an "Add project" control and a per-row delete control.
- **FR-TSE-002** — While the current week's sheet status is not `Draft` (Submitted/Approved), the system
  shall render the grid read-only: no editable inputs, no Add-project, no delete, no Save (mirroring the
  shipped read-only `TimesheetGrid`).
- **FR-TSE-003** — When the current week has no timesheet, the system shall render an editable empty grid
  (the engineer can add rows and enter hours) and shall **not** create any `timesheets` row until the user
  Saves.

### Add / edit / delete
- **FR-TSE-004** — When the user activates "Add project" and selects a project, the system shall add an empty
  editable row for that project to the current week's in-memory grid (0 hours across all 7 days), without any
  DB write.
- **FR-TSE-005** — The project picker shall offer every Active org project (`status = 'Ongoing Project'`) that
  is not already a row in the current week, sourced from `listProjects({ status: 'Ongoing Project' })`, and
  shall be structured so an assignee filter can be added later without changing the call site (OQ-1).
- **FR-TSE-006** — When the user types into an hour cell, the system shall update the in-memory grid for that
  `(row, day)` and recompute the per-day, per-row, and weekly totals live (FR-TSE-013), without a DB write.
- **FR-TSE-007** — When the user edits a row's note, the system shall update the in-memory note for that row,
  without a DB write, to be persisted on the row's entries at Save.
- **FR-TSE-008** — When the user activates the row delete control, the system shall open a **mandatory
  destructive `ConfirmDialog`** (`tone="destructive"`); only on confirm shall it remove the row from the grid
  (and, at the next Save / immediately for an already-persisted row, delete that row's `timesheet_entries`).
- **FR-TSE-009** — When the user cancels the delete confirm, the system shall make no change and dismiss the
  dialog.

### Save (the explicit commit)
- **FR-TSE-010** — The system shall commit grid changes only via an **explicit Save action**; no DB write
  shall occur on per-keystroke editing, row-add, or week navigation.
- **FR-TSE-011** — When the user activates Save and the current week has no timesheet, the system shall first
  insert a Draft `timesheets` row `(user_id = self, week_start_date = Monday-of-week, status = 'Draft')`,
  then write the week's entries against it (§3.2).
- **FR-TSE-012** — When the user activates Save, the system shall, per `(project_id, entry_date)` cell:
  insert an entry where hours `> 0` and none exists; update where hours changed and one exists; delete the
  entry where hours became `0`/blank and one exists; and leave unchanged cells untouched (§3.2), then refetch
  so the grid reflects the persisted server state.

### Totals & validation
- **FR-TSE-013** — The system shall compute per-day totals, per-row totals, and the weekly total from the
  edited in-memory grid (including unsaved edits) and update them live as the user types.
- **FR-TSE-014** — When an hour cell's value is non-numeric, negative, or `> 24`, the system shall show an
  inline per-cell validation error and shall block Save while any cell is invalid; a blank cell shall be
  treated as `0`.

### States & feedback
- **FR-TSE-015** — While the timesheets query is pending the system shall render the loading skeleton; while
  it has errored it shall render an error state with Retry (reusing the shipped read-path states).
- **FR-TSE-016** — When a Save write fails, the system shall surface the failure via a toast (preserving the
  RPC/PostgREST `error.code` and message) and keep the user's unsaved edits intact for retry; when a Save
  succeeds, it shall toast success and reflect the refetched server state.

### DAL / hook
- **FR-TSE-017** — `src/lib/db/timesheets.ts` (or a sibling write module) shall expose typed write functions:
  `createDraftTimesheet(weekStartDate)`, `upsertTimesheetEntries(entries)`, and `deleteTimesheetEntry(id)`
  (or an equivalent set), each sending **no `org_id`** (RLS scopes by `auth_org_id()` and ownership), each
  throwing on PostgREST error and **preserving `error.code`**. A matching mutation hook shall invalidate the
  `['timesheets', orgId, userId]` query on success.

### Security (hardening)
- **FR-TSE-018** — A new reversible migration shall replace the `timesheet_entries_write` policy's WITH CHECK
  clause so that, in addition to `org_id = auth_org_id()`, it requires the **post-image** entry's parent
  timesheet to be the **caller's own** (`t.user_id = auth.uid()`) **and** `status = 'Draft'` — i.e. it shall
  mirror the existing USING clause. This closes the write-time hole where a same-org user could write an
  entry onto another user's timesheet (§1.2).

### Non-functional
- **NFR-TSE-SEC-001** — All entry writes go through RLS as the caller (`security invoker` posture; no
  `security definer` entry-write RPC, no `org_id` argument): the only authority for *whose* sheet an entry
  may land on is the (hardened) `timesheet_entries_write` policy. No client-supplied `user_id`/`org_id` is
  ever trusted.
- **NFR-TSE-SEC-002** — After `FR-TSE-018`, it shall be impossible for any authenticated user to insert or
  update a `timesheet_entries` row whose parent timesheet is not their own Draft sheet, regardless of the
  `org_id` value supplied. Proven by pgTAP (AC-TSE-022/023).
- **NFR-TSE-TENANCY-001** — Every entry/timesheet write is scoped to the caller's org by `org_id =
  auth_org_id()` in the policies; no cross-org write or read of another org's entries is possible (existing
  `timesheets_*`/`timesheet_entries_*` policies + the hardened WITH CHECK).
- **NFR-TSE-A11Y-001** — Every editable hour cell is a labelled input (per-cell `aria-label` `"<project>,
  <weekday> hours"`), the grid is keyboard-navigable (Tab/arrow into each cell, Enter/Escape semantics), the
  project picker is keyboard- and screen-reader-operable, and the delete `ConfirmDialog` is focus-trapped with
  an accessible name — meeting WCAG 2.1 AA.
- **NFR-TSE-PERF-001** — Save issues a bounded set of writes (≤ one create + one batched upsert + the deletes
  for zeroed cells), not one round-trip per cell; totals recompute via memoized selectors keyed on the edited
  grid (no inline `.reduce` in JSX), preserving the shipped read-path memoization (FR-TS-007).

---

## 5. Acceptance criteria (Given/When/Then)

Each AC is owned by exactly **one** layer (ADR-0010); owning layer in the traceability table (§7).

### Editable grid render & gating — Unit (Vitest/RTL)
- **AC-TSE-001** — *Draft week renders editable.* **Given** a mocked `useTimesheets` returning a Draft sheet
  owned by the signed-in user for the current week, **When** the weekly-grid view renders, **Then** the hour
  cells are editable inputs and an "Add project" control and per-row delete controls are present. (FR-TSE-001)
- **AC-TSE-002** — *Empty week renders editable, no sheet created.* **Given** a mocked `useTimesheets`
  returning no sheet for the current week, **When** the view renders, **Then** an editable empty grid with an
  "Add project" control is shown and **no** create-timesheet write is issued on mount. (FR-TSE-003)
- **AC-TSE-003** — *Submitted sheet is read-only.* **Given** a mocked Submitted sheet for the current week,
  **When** the view renders, **Then** there are no editable inputs, no Add-project, no delete, and no Save
  control. (FR-TSE-002)
- **AC-TSE-004** — *Approved sheet is read-only.* **Given** a mocked Approved sheet, **When** the view
  renders, **Then** the grid is read-only (no write affordances). (FR-TSE-002)

### Add / edit / notes — Unit
- **AC-TSE-005** — *Add project row.* **Given** a Draft week and a mocked Active-projects list, **When** the
  user opens "Add project" and selects a project, **Then** a new editable row (0 across 7 days) for that
  project appears and no DB write occurs. (FR-TSE-004)
- **AC-TSE-006** — *Picker excludes already-present + non-active.* **Given** a Draft week with project P
  already a row and a projects list `{P (Ongoing), Q (Ongoing), R (Leads)}`, **When** the picker opens,
  **Then** it offers `Q` only (P excluded as present, R excluded as not Active). (FR-TSE-005)
- **AC-TSE-007** — *Edit hour cell updates state only.* **Given** an editable row, **When** the user types
  `8` into Tuesday, **Then** the cell shows 8 and no DB write occurs until Save. (FR-TSE-006/010)
- **AC-TSE-008** — *Edit note.* **Given** an editable row, **When** the user edits the row note, **Then** the
  in-memory note updates and no DB write occurs until Save. (FR-TSE-007)

### Validation — Unit
- **AC-TSE-009** — *Reject hours > 24.* **Given** an editable cell, **When** the user enters `25`, **Then** an
  inline cell error is shown and Save is disabled while it stands. (FR-TSE-014)
- **AC-TSE-010** — *Reject negative / non-numeric.* **Given** an editable cell, **When** the user enters `-3`
  or `8h`, **Then** an inline cell error is shown and Save is disabled. (FR-TSE-014)
- **AC-TSE-011** — *Blank = 0, boundary 0 and 24 accepted.* **Given** editable cells, **When** the user leaves
  one blank and enters `0` and `24` in others, **Then** all are valid (blank treated as 0) and Save is
  enabled. (FR-TSE-014)

### Live totals — Unit
- **AC-TSE-012** — *Totals track edits live.* **Given** an editable week, **When** the user enters `6` Mon and
  `4` Tue on one row, **Then** the row total shows `10`, the Mon/Tue day totals reflect the values, and the
  weekly total shows `10` — all before any Save. (FR-TSE-013)

### Delete (destructive confirm) — Unit
- **AC-TSE-013** — *Delete asks first.* **Given** an editable row, **When** the user activates delete,
  **Then** a destructive `ConfirmDialog` opens and the row is **not** removed yet. (FR-TSE-008)
- **AC-TSE-014** — *Confirm removes row.* **Given** the delete confirm open, **When** the user confirms,
  **Then** the row is removed from the grid (and its persisted entries are deleted via the DAL). (FR-TSE-008)
- **AC-TSE-015** — *Cancel keeps row.* **Given** the delete confirm open, **When** the user cancels, **Then**
  the row remains unchanged and no delete write is issued. (FR-TSE-009)

### Save commit / DAL wiring — Unit
- **AC-TSE-016** — *Save creates Draft then writes entries.* **Given** an empty current week with entered
  hours and a mocked DAL, **When** the user Saves, **Then** `createDraftTimesheet` is called once with the
  Monday week-start, then the entries are upserted against the new sheet, and the timesheets query is
  invalidated. (FR-TSE-011/012/017)
- **AC-TSE-017** — *Save diffs to insert/update/delete.* **Given** a Draft sheet with an existing 8h Monday
  entry on project P, **When** the user changes Monday to 6, adds 4h Tuesday, and clears a previously-2h
  Wednesday cell, then Saves, **Then** the DAL upserts Mon=6 and Tue=4 and deletes the Wednesday entry, and
  leaves unchanged cells untouched. (FR-TSE-012)
- **AC-TSE-018** — *Save failure keeps edits + toasts with code.* **Given** the DAL throws on save, **When**
  the user Saves, **Then** a failure toast is shown (carrying the error message), the unsaved edits remain in
  the grid, and the query is not marked successful. (FR-TSE-016)
- **AC-TSE-019** — *DAL contracts.* **Given** the write module, **When** `createDraftTimesheet`,
  `upsertTimesheetEntries`, and `deleteTimesheetEntry` are called, **Then** each issues the expected
  Supabase call sending **no `org_id`**, throws on PostgREST error, and preserves `error.code`. (FR-TSE-017)

### States — Unit
- **AC-TSE-020** — *Loading + error states.* **Given** the timesheets query pending then errored, **When** the
  view renders, **Then** the loading skeleton then the error+Retry state are shown (read-path parity).
  (FR-TSE-015)

### Cross-stack journey — E2E (Playwright, one curated)
- **AC-TSE-021** — *Engineer logs, edits, deletes, submits.* **Given** a signed-in Engineer against the
  seeded local stack on a week with no sheet, **When** they add an Active project row, enter hours across two
  days, Save (creating the Draft), see the persisted totals, edit a cell and Save again, delete a row via the
  confirm dialog, and finally submit the week, **Then** each step persists through the real stack: the Draft
  is created on first Save, the edited hours and deletion round-trip to the DB, the weekly total reflects the
  saved data, and after submit the grid is read-only. (FR-TSE-001/003/006/008/011/012, lifecycle unchanged)

### Security (RLS WITH CHECK hardening) — pgTAP  ⚑ security-auditor
- **AC-TSE-022** — *Cannot write an entry onto another user's sheet (the closed hole).* **Given** users A and
  B in the same org each with a Draft timesheet, **When** A (as `authenticated`, A's JWT) attempts to
  `insert into timesheet_entries (timesheet_id = B's sheet, project_id, entry_date, hours, org_id =
  auth_org_id())`, **Then** the insert is **rejected** by the hardened `timesheet_entries_write` WITH CHECK;
  **and When** A attempts to `update` one of A's own entries to set `timesheet_id = B's sheet`, **Then** it
  is likewise rejected. (FR-TSE-018, NFR-TSE-SEC-002)
- **AC-TSE-023** — *Cannot write to own non-Draft sheet; can write to own Draft.* **Given** A owns a
  Submitted timesheet and a separate Draft timesheet, **When** A inserts an entry onto the Submitted sheet,
  **Then** it is rejected; **When** A inserts a valid entry onto the Draft sheet, **Then** it succeeds.
  (FR-TSE-018, NFR-TSE-SEC-001)
- **AC-TSE-024** — *Cross-org entry write blocked.* **Given** A in org-A and a Draft timesheet in org-B,
  **When** A attempts to insert an entry referencing the org-B timesheet (any `org_id`), **Then** the write
  is rejected (tenancy). (NFR-TSE-TENANCY-001)

---

## 6. Error handling

| Condition | Detection | User-facing result |
|---|---|---|
| Hours `> 24` / negative / non-numeric | client validation (§3.3) | inline per-cell error; Save disabled (FR-TSE-014) |
| Save write fails (PostgREST/RLS) | DAL throws, `error.code` preserved | failure toast; edits retained; retry available (FR-TSE-016) |
| Timesheets fetch fails | query `isError` | error state + Retry (FR-TSE-015) |
| Attempt to write a non-Draft/non-own sheet | UI disabled + RLS rejects (defense in depth) | no write; if reached via API, RLS error toast (FR-TSE-002/018) |
| Duplicate `(user_id, week_start_date)` on create | DB `unique` constraint | create is idempotent in practice (week already has a Draft → reuse it); surfaced as toast if it races |
| Non-Monday week-start | DB `week_is_monday` CHECK | DAL passes the computed Monday; never user-entered |

---

## 7. Traceability (AC → FR → owning test layer)

| AC | FR | Owning layer | Test artifact (suggested) |
|---|---|---|---|
| AC-TSE-001 | FR-TSE-001 | Unit | `pmo-portal/pages/Timesheets.test.tsx` |
| AC-TSE-002 | FR-TSE-003 | Unit | `pmo-portal/pages/Timesheets.test.tsx` |
| AC-TSE-003 | FR-TSE-002 | Unit | `pmo-portal/pages/Timesheets.test.tsx` |
| AC-TSE-004 | FR-TSE-002 | Unit | `pmo-portal/pages/Timesheets.test.tsx` |
| AC-TSE-005 | FR-TSE-004 | Unit | `pmo-portal/pages/Timesheets.test.tsx` |
| AC-TSE-006 | FR-TSE-005 | Unit | `pmo-portal/pages/Timesheets.test.tsx` |
| AC-TSE-007 | FR-TSE-006 | Unit | `pmo-portal/src/components/ui/__tests__/timesheet.test.tsx` |
| AC-TSE-008 | FR-TSE-007 | Unit | `pmo-portal/src/components/ui/__tests__/timesheet.test.tsx` |
| AC-TSE-009 | FR-TSE-014 | Unit | `pmo-portal/src/components/ui/__tests__/timesheet.test.tsx` |
| AC-TSE-010 | FR-TSE-014 | Unit | `pmo-portal/src/components/ui/__tests__/timesheet.test.tsx` |
| AC-TSE-011 | FR-TSE-014 | Unit | `pmo-portal/src/components/ui/__tests__/timesheet.test.tsx` |
| AC-TSE-012 | FR-TSE-013 | Unit | `pmo-portal/src/components/ui/__tests__/timesheet.test.tsx` |
| AC-TSE-013 | FR-TSE-008 | Unit | `pmo-portal/pages/Timesheets.test.tsx` |
| AC-TSE-014 | FR-TSE-008 | Unit | `pmo-portal/pages/Timesheets.test.tsx` |
| AC-TSE-015 | FR-TSE-009 | Unit | `pmo-portal/pages/Timesheets.test.tsx` |
| AC-TSE-016 | FR-TSE-011/012/017 | Unit | `pmo-portal/src/hooks/useTimesheets.test.tsx` |
| AC-TSE-017 | FR-TSE-012 | Unit | `pmo-portal/src/hooks/useTimesheets.test.tsx` |
| AC-TSE-018 | FR-TSE-016 | Unit | `pmo-portal/src/hooks/useTimesheets.test.tsx` |
| AC-TSE-019 | FR-TSE-017 | Unit | `pmo-portal/src/lib/db/timesheets.test.ts` |
| AC-TSE-020 | FR-TSE-015 | Unit | `pmo-portal/pages/Timesheets.test.tsx` |
| AC-TSE-021 | FR-TSE-001/003/006/008/011/012 | E2E | `pmo-portal/e2e/AC-TSE-021-timesheet-entry.spec.ts` |
| AC-TSE-022 | FR-TSE-018 / NFR-TSE-SEC-002 | pgTAP | `supabase/tests/00XX_timesheet_entry_with_check.test.sql` |
| AC-TSE-023 | FR-TSE-018 / NFR-TSE-SEC-001 | pgTAP | `supabase/tests/00XX_timesheet_entry_own_draft.test.sql` |
| AC-TSE-024 | NFR-TSE-TENANCY-001 | pgTAP | `supabase/tests/00XX_timesheet_entry_tenancy.test.sql` |

Rationale: all UI/validation/totals/diff/picker logic is mock-provable at Unit (ADR-0010 lowest-sufficient
layer); the WITH-CHECK hardening is a write-time RLS *contract* → pgTAP (the layer purpose-built to prove
it, as `0007_timesheet_own_rows.test.sql` already does for read isolation); exactly one curated E2E proves
the real cross-stack create→edit→delete→submit journey.

---

## 8. Open questions (for owner / planner sign-off)

- **OQ-1 (post-MVP follow-up, owner-flagged IN-SCOPE-LATER):** the project picker offers **any** Active org
  project now. Once a **project-assignment model** exists, restrict it to the engineer's *assigned* projects.
  The picker + `listProjects({ status, assigneeId? })` are designed for this filter; no reshape needed. **Not
  built this issue.**
- **OQ-2 (schema decision for the plan/ADR):** §3.2's diff is cleanest with a **unique constraint on
  `(timesheet_id, project_id, entry_date)`** to support idempotent upsert (today nothing prevents duplicate
  cells; the read path sums them). Recommend the planner add this constraint (reversible migration) and decide
  whether existing duplicate seed rows need collapsing. If declined, the diff must insert/update by matching an
  existing entry id per cell instead.
- **OQ-3 (recall):** no new "recall a submitted sheet" affordance is built — the existing manager
  reject (`transition_timesheet`, `Rejected → Draft`) re-opens a sheet for editing. If the owner wants an
  engineer-initiated recall of a *Submitted* (not yet approved) sheet, that is a small lifecycle addition
  (`Submitted → Draft` by owner) — flag at sign-off; **out of scope** until then.
- **OQ-4 (note granularity):** this issue persists a **row-level** note (one note per project-row, written to
  that row's entries). The shipped read path historically grouped by `project_id + notes` (OD-T4). Confirm
  row-level (per project per week) note is the intended granularity, vs per-cell notes.
- **OQ-5 (zero-hour entries):** §3.2 deletes an entry when its cell becomes 0/blank (a 0-hour entry is not
  persisted). Confirm we never want to keep an explicit 0-hour row (e.g. "assigned but no hours") — current
  model treats absence == zero.
```
