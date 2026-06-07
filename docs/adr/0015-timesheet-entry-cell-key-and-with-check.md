# ADR-0015: Unique entry-cell key + WITH CHECK hardening for timesheet entry writes

**Status:** Accepted — 2026-06-07
**Deciders:** Director, eng-planner, implementer
**Issue:** Timesheet entry + edit — the WRITE path for the Timesheets surface
**Spec:** `docs/specs/timesheet-entry.spec.md` (FR-TSE-018, NFR-TSE-SEC-001/002, NFR-TSE-TENANCY-001; AC-TSE-022/023/024)
**Plan:** `docs/plans/2026-06-07-timesheet-entry.md` (§1.3, §6)
**Migration:** `supabase/migrations/0011_timesheet_entry_with_check.sql`
**Precedent:** ADR-0006 (`supabase db reset` reversibility), ADR-0010 (test pyramid + AC-id tagging),
ADR-0011/0012 (security-relevant RLS/RPC hardening with inline "this MUST stay" comments).

---

## Context

This issue makes the weekly timesheet grid **editable while the sheet is Draft** (spec §1, §3). Two
backend facts block a correct, retry-safe write path:

1. **No idempotent per-cell key.** The canonical entry shape for the editable grid is **one entry per
   `(timesheet_id, project_id, entry_date)`** (spec §3.2). Save diffs the edited grid against the
   last-fetched server state and commits insert/update/delete per cell. The cleanest, retry-safe commit is
   a single `upsert` on `(timesheet_id, project_id, entry_date)` plus deletes for zeroed cells — but today
   **nothing prevents duplicate cells** (`timesheet_entries` has no unique constraint on that triple; the
   read path merely sums duplicates). Without the constraint, `on_conflict` upsert is impossible and a
   retried Save could insert a second row for the same cell. (OQ-2.)

2. **A write-time WITH CHECK hole.** `timesheet_entries_write` (`0002_rls.sql:177-181`) is `FOR ALL` with a
   correctly-tight **USING** clause (the pre-image entry's parent timesheet is the caller's own *and*
   `status='Draft'`), but its **WITH CHECK** clause is only `org_id = auth_org_id()`. USING gates the
   pre-image; it does **not** constrain the *new* row on INSERT, nor the *new* `timesheet_id` on UPDATE.
   **Consequence:** a same-org user can `insert into timesheet_entries (timesheet_id = <another user's
   sheet>, …)` or `update … set timesheet_id = <another user's sheet>` and the write passes RLS, because
   WITH CHECK never re-checks ownership/Draft of the *target* sheet. This is a write-time
   tenancy/authorization defect (spec §1.2, flagged for the security-auditor).

Both are cross-cutting and security-relevant, so the schema change and the RLS change ship together in one
reversible migration and are recorded here.

---

## Decision

Add migration `0011_timesheet_entry_with_check.sql` (forward-only, additive; reversibility = `supabase db
reset`, ADR-0006), doing three things in order:

### 1. Collapse pre-existing duplicate cells (one-time, idempotent, defensive)

Before adding the constraint, collapse any pre-existing duplicate `(timesheet_id, project_id, entry_date)`
rows: **sum** `hours` (capped at the DB CHECK ceiling of 24), keep the **lexicographically-min `id`**,
**merge distinct non-empty notes** with `'; '`. The current seed (`supabase/seed.sql`) has no duplicate
triple, so this is a no-op there — it is purely defensive so the constraint applies cleanly on any data.

### 2. Add the unique entry-cell key (resolves OQ-2)

`alter table timesheet_entries add constraint timesheet_entries_cell_uq unique (timesheet_id, project_id,
entry_date)` — one entry per cell, enabling the **idempotent upsert** (`on_conflict =
timesheet_id,project_id,entry_date`) the editable grid's Save uses. Retries converge instead of duplicating.

### 3. Harden the WITH CHECK to mirror the USING clause

Drop and recreate `timesheet_entries_write` so its **WITH CHECK** clause requires — in addition to
`org_id = auth_org_id()` — that the **post-image** entry's parent timesheet is the caller's **own**
(`t.user_id = auth.uid()`) **and** `status = 'Draft'`, i.e. byte-for-byte the existing USING clause. This
closes the write-time hole (FR-TSE-018). The migration carries the explicit OLD-clause rollback block as a
comment.

**Security-invoker posture (NFR-TSE-SEC-001):** there is **no** `security definer` entry-write RPC and
**no** `org_id` argument anywhere in the write path. All entry writes go through RLS **as the caller**; the
hardened `timesheet_entries_write` policy is the sole authority for *whose* sheet an entry may land on. The
DAL (`createDraftTimesheet` / `upsertTimesheetEntries` / `deleteTimesheetEntry`) never sends `org_id`
(the column default + the policies are the authority). This deliberately differs from the procurement
lifecycle (ADR-0012), which needed `security definer` RPCs for *multi-write atomicity* and *server-minted
sequence numbers* — timesheet entry writes are single-table, need no minted numbers, and are fully
expressible as RLS, so the simpler, lower-privilege invoker path is correct (YAGNI on an RPC).

---

## Alternatives considered

- **Match-by-id-per-cell diff instead of upsert (decline the constraint):** rejected — the diff would have
  to fetch and reconcile each cell's existing entry id, and a retry after a partial failure could still
  insert a duplicate (no DB guard). The unique key makes the upsert idempotent and the duplicate-cell shape
  unrepresentable.
- **A `security definer` entry-write RPC (procurement-style):** rejected — entry writes are single-table
  with no minted numbers and no multi-row atomicity requirement; RLS as the caller fully expresses the
  authorization. An RPC would add a higher-privilege surface for no gain (YAGNI; NFR-TSE-SEC-001).
- **Leave WITH CHECK as `org_id`-only and rely on the UI disabling writes:** rejected — the UI gate is not a
  security boundary; the hole is exploitable directly via the API. Defense-in-depth requires the write-time
  RLS check.
- **Keep duplicate cells and sum at read time only:** rejected — it forecloses idempotent upsert and makes
  "edit a cell" ambiguous (which of N duplicate rows is *the* cell?).

---

## Consequences

**Positive:**
- Save's per-cell commit is an idempotent upsert (retry-safe; no duplicate cells).
- The write-time tenancy/ownership hole is closed: it is impossible for any authenticated user to
  insert/update a `timesheet_entries` row whose parent timesheet is not their own Draft sheet, regardless of
  the `org_id` supplied (proven by pgTAP `0046`/`0047`/`0048`).
- No new privileged surface: the write path stays `security invoker`, RLS-scoped, `org_id`-free.

**Negative / risks:**
- The security-auditor MUST verify the rewritten WITH CHECK mirrors the USING clause exactly (own + Draft +
  org), and that no DAL fn sends `org_id`/`user_id` for the writer. Inline migration comments state the
  closed hole and the rollback clause.
- Pre-existing duplicate cells (none in current seed) are silently summed on migration — documented and
  acceptable for pre-production; the cap at 24 mirrors the DB CHECK.
- Reversibility is `supabase db reset` (pre-production, ADR-0006) or the documented manual `drop constraint`
  + restore-old-policy block.

**Pattern:** single-table, no-minted-number, RLS-expressible writes stay `security invoker` (this ADR);
multi-write atomicity- or sequence-critical writes go through a `security definer` RPC (ADR-0011/0012). The
distinction is whether RLS alone can express the authorization and atomicity needs.
