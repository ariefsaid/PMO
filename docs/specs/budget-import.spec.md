# Budget import — spec

**Issue:** #495 · **Rulings:** `DD-IMP-1` (as amended 2026-08-20), `OD-SEED-2`, `OD-CR-5`, `DD-CUR-4`,
`DD-BIMP-1..3` (this round)

> **Why this document exists.** Two dispatched planners refused #495's brief — the second explicitly
> because it *"does not define a persistence/import contract that can meet the ticket's
> match-or-create and rerun guarantees"* and had **no EARS requirements or `AC-###` identifiers**.
> Both refusals were correct: `DD-IMP-1` describes the *shape* but never turns it into criteria a
> test can own. This is that missing half.
>
> **Round 2 (2026-08-20), after reading the shipped schema instead of the ticket.** Three of this
> spec's own premises were false against `dev`. All three are corrected below and recorded as
> `DD-BIMP-1..3` — see §6 for what was wrong and why it mattered.

## 1. Scope

Import budget line items from a spreadsheet through the shipped import wizard (ADR-0027), so budgets
join Companies, Contacts, Projects and Procurement as day-1 seedable data (`OD-SEED-2`). Budgets are
the one day-1 dataset with no descriptor.

**Part 1 (provenance columns + indexes) is merged** — `0195_budget_import_provenance.sql`. This spec
covers the descriptor half, plus the one amendment `DD-BIMP-3` makes to `0195`'s indexes.

## 2. Requirements (EARS)

- **FR-BIMP-001** — *Ubiquitous.* One spreadsheet row shall map to exactly one budget **line item**.
- **FR-BIMP-002** — *Event-driven.* When a row names a **project** for which no `Draft` budget
  version exists, the import shall **create** one at `max(version) + 1`, in `Draft`.
- **FR-BIMP-003** — *Event-driven.* When a row names a **project** for which a `Draft` version
  already exists, the import shall **attach the line item to that version** rather than creating a
  second one. *(`DD-BIMP-1`: the match key is the project alone. `fiscal_year` lives on
  `budget_line_items`, not on `budget_versions` — `0153`.)*
- **FR-BIMP-004** — *Ubiquitous.* The import shall never set `status`. Draft-only is achieved by
  **omission**, so activation remains reachable only through `activate_budget_version`.
- **FR-BIMP-005** — *Ubiquitous.* The import shall never write `actual_amount`. Actuals are read from
  the ERP read-model; a spreadsheet writing them would produce a figure PMO **computed** rather than
  **read** (ADR-0048/0055).
- **FR-BIMP-006** — *Ubiquitous.* The import shall **not supply `currency`**. `0187`'s
  `stamp_currency` BEFORE-INSERT trigger fills it from `organizations.default_currency`, and its own
  header states that hand-carrying a currency from the client is the thing `OD-CR-5` exists to
  prevent. *(`DD-BIMP-2`.)*
- **FR-BIMP-007** — *Event-driven.* When the same sheet is imported again — **in any later session,
  under any batch id** — the import shall create **no new rows**, via two layers on the **line
  items**: a skip query keyed on `(budget_version_id, import_key)`, and the partial unique index on
  the same key as the TOCTOU backstop. *(`DD-BIMP-3` — the shipped `0072` key includes
  `import_batch_id` and therefore does not survive a new session; see §6.)*
- **FR-BIMP-010** — *Ubiquitous.* Budget **versions** shall carry `import_batch_id`/`imported_at` but
  **no `import_key`**. A version's identity is "this project's open `Draft`", not a sheet row; keying
  it would permanently block the second legitimate import for a project once the first was activated.
  Match-or-create resolves the version by `(project_id, status = 'Draft')`. *(`DD-BIMP-5`.)*
- **FR-BIMP-011** — *Ubiquitous.* A line item's `import_key` shall be the row's `Reference` cell when
  supplied, else a deterministic fingerprint of the row's content — the `0072` shape verbatim. ⚑ Two
  byte-identical lines in one sheet with no `Reference` therefore collapse to one; that is the cost
  of a content fingerprint and the `Reference` column is the way out.
- **FR-BIMP-008** — *While a project's latest version is not `Draft`.* The import shall **never
  attach** a line item to an Active or Archived version; it creates a new `Draft` (FR-BIMP-002) and
  attaches there. `enforce_draft_line_item` (`0005`) is the DB backstop on INSERT/UPDATE/DELETE, so
  a descriptor bug surfaces as a loud `P0001`, never a silent write into an activated budget.
- **FR-BIMP-009** — *Ubiquitous.* Validation shall occur client-side with **zero writes** before any
  confirmation, per the wizard's shipped contract (`OD-SEED-2`).

## 3. Acceptance criteria

- **AC-BIMP-001** — *Given* a sheet with two rows for the same project, *when* imported, *then* one
  `Draft` budget version exists carrying **two** line items.
- **AC-BIMP-002** — *Given* a `Draft` version already exists for that project, *when* a sheet naming
  it is imported, *then* no second version is created and the line items attach to the existing one.
- **AC-BIMP-003** — *Given* any sheet, *when* imported, *then* every created version has
  `status = 'Draft'`; **and** the descriptor exposes no `status` field at all.
- **AC-BIMP-004** — *Given* a sheet containing an `actual_amount` column, *when* imported, *then*
  `actual_amount` is unchanged on every affected row **and** the descriptor exposes no
  `actual_amount` field.
- **AC-BIMP-005** — *Given* a sheet imported once, *when* the identical sheet is imported again **in
  a fresh session (a new batch id)**, *then* the row counts of `budget_versions` and
  `budget_line_items` are unchanged.
- **AC-BIMP-006** — *Given* two concurrent imports of the same sheet, *when* both commit, *then* the
  database rejects the duplicate (unique violation) rather than admitting both.
- **AC-BIMP-007** — *Given* a project whose only version is **Active**, *when* the same sheet is
  imported again, *then* a new `Draft` version is created and the line items land **in it** — an
  Active version is never appended to, and the new Draft is never left empty by a stale skip.
- **AC-BIMP-008** — *Given* any imported version row, *when* it is read back, *then* `currency` is
  set, is not `'XXX'`, and equals the org's `default_currency`.
- **AC-BIMP-009** — *Given* a sheet with an invalid row, *when* validation runs, *then* no write has
  occurred to either budget table.

## 4. Traceability

| AC | Owning layer | Location |
|---|---|---|
| AC-BIMP-001/002/003/004/007 | Unit (Vitest) | descriptor tests |
| AC-BIMP-005 | Unit (Vitest) | the skip query, exercised across two batch ids |
| AC-BIMP-006/007 (schema half) | Integration (pgTAP) | `supabase/tests/0195_budget_import_provenance.test.sql` |
| AC-BIMP-006 | Integration (pgTAP) | the partial unique index — the DB is the authority for the *race* |
| AC-BIMP-008 | Integration (pgTAP) | `stamp_currency` on a provenance-carrying insert |
| AC-BIMP-009 | Unit (Vitest) | wizard validation path |

## 5. Traps this work will hit

- ⚑ **`DD-CUR-4`** — `budget_versions` carries **column-level** INSERT grants, so a new column is not
  insertable unless granted. `0187` granted `insert (currency)`; `0195` granted the three provenance
  columns. `budget_line_items` keeps its table-level grant (`0075`) — which is also why
  **`actual_amount` is DB-insertable** and `FR-BIMP-005` is a *descriptor-level* guarantee only.
  Mutation-check it accordingly.
- ⚑ **Do not add a THIRD dedupe mechanism.** `FR-BIMP-007` is two layers, same key. Widening the key
  is the amendment; adding a mechanism is not.
- ⚑ **Mutation checks target different layers.** Add `status` to the descriptor → `AC-BIMP-003` red ·
  add `actual_amount` → `AC-BIMP-004` red · drop the partial unique index → **`AC-BIMP-006`** red
  (the race) · disable the skip query → **`AC-BIMP-005`** red (the re-run). Dropping the index will
  **not** redden `AC-BIMP-005`.

## 6. What round 1 got wrong (the corrections, `DD-BIMP-1..3`)

Recorded in full because each was stated confidently and each would have shipped a defect.

**`DD-BIMP-1` — the match key.** Round 1 keyed match-or-create on `(project, fiscal_year)`.
`budget_versions` has **no `fiscal_year` column**: `0153` put `fiscal_year` on `budget_line_items`,
nullable, deliberately un-backfilled, because the value is *another system's* calendar name. Building
to the old key meant either inventing a column or silently keying on a field that is NULL on every
existing row. The key is the **project**; the year rides on the line.

**`DD-BIMP-2` — who sets `currency`.** Round 1 required the descriptor to set `currency` explicitly,
quoting `DD-IMP-1` §5 and `OD-CR-5`. Both were written before `0187` shipped the currency seam, whose
own header says a client hand-carrying a currency is precisely what the trigger exists to prevent.
The descriptor supplies nothing; `stamp_currency` fills it from the org. A per-row `Currency` field
is a later, real multi-currency feature — not this ticket.

**`DD-BIMP-3` — the idempotency key does not include the batch.** This is the one that matters. The
shipped `0072` index and skip query are keyed on `(import_key, import_batch_id)`, and
`useProcurementCycleImport` mints `crypto.randomUUID()` per mount. So a re-import in a **new session**
misses the skip and inserts duplicates; the only cross-batch layer that exists today is
`findCrossBatchCollision`, which produces a *dry-run report*, not a skip. Round 1 asserted the
opposite ("the skip query… is what makes a re-run a no-op") and would have produced an importer that
passes its own tests and duplicates every budget on the second run — the exact "green test that
cannot fail" class this repo has paid for repeatedly.

For budgets the key is therefore `import_key` **alone**: `(org_id, import_key)` on `budget_versions`,
`(budget_version_id, import_key)` on `budget_line_items`. This keeps two layers, not three, and makes
the DB the authority for the re-run as well as the race. `0195` is amended in place — it is on `dev`
only, never on `main` and never on prod, and `supabase db reset` is this phase's rollback (ADR-0006).

⚑ The procurement path keeps its batch-scoped key. Changing it is a separate decision about a shipped
importer with live data, not a drive-by.
