# Budget import — spec

**Issue:** #495 · **Rulings:** `DD-IMP-1` (as amended 2026-08-20), `OD-SEED-2`, `OD-CR-5`, `DD-CUR-4`

> **Why this document exists.** Two dispatched planners refused #495's brief — the second explicitly
> because it *"does not define a persistence/import contract that can meet the ticket's
> match-or-create and rerun guarantees"* and had **no EARS requirements or `AC-###` identifiers**.
> Both refusals were correct: `DD-IMP-1` describes the *shape* but never turns it into criteria a
> test can own. This is that missing half.

## 1. Scope

Import budget line items from a spreadsheet through the shipped import wizard (ADR-0027), so budgets
join Companies, Contacts, Projects and Procurement as day-1 seedable data (`OD-SEED-2`). Budgets are
the one day-1 dataset with no descriptor.

**Two parts**, because the provenance machinery does not cover budgets — `0072` adds
`import_batch_id`/`imported_at`/`import_key` **per table** and covers only the procurement chain:

1. Provenance columns + a DB-enforced partial unique index on the budget tables.
2. The `ImportDescriptor` + an `<ImportButton>` on the budgets page.

## 2. Requirements (EARS)

- **FR-BIMP-001** — *Ubiquitous.* One spreadsheet row shall map to exactly one budget **line item**.
- **FR-BIMP-002** — *Event-driven.* When a row names a `(project, fiscal_year)` for which no budget
  version exists, the import shall **create** one in `Draft`.
- **FR-BIMP-003** — *Event-driven.* When a row names a `(project, fiscal_year)` for which a `Draft`
  version already exists, the import shall **attach the line item to that version** rather than
  creating a second one.
- **FR-BIMP-004** — *Ubiquitous.* The import shall never set `status`. Draft-only is achieved by
  **omission**, so activation remains reachable only through `activate_budget_version`.
- **FR-BIMP-005** — *Ubiquitous.* The import shall never write `actual_amount`. Actuals are read from
  the ERP read-model; a spreadsheet writing them would produce a figure PMO **computed** rather than
  **read** (ADR-0048/0055).
- **FR-BIMP-006** — *Ubiquitous.* The import shall set `currency` explicitly on every row it creates,
  never inheriting a global constant (`OD-CR-5`).
- **FR-BIMP-007** — *Event-driven.* When the same sheet is imported again, the import shall create
  **no new rows** — enforced in the **database** by a partial unique index on the import key, not by
  an application-side check (the `0072` pattern, which is TOCTOU-safe).
- **FR-BIMP-008** — *While a version is not `Draft`.* The import shall **refuse** the row rather than
  attaching a line item to an Active or Archived version.
- **FR-BIMP-009** — *Ubiquitous.* Validation shall occur client-side with **zero writes** before any
  confirmation, per the wizard's shipped contract (`OD-SEED-2`).

## 3. Acceptance criteria

- **AC-BIMP-001** — *Given* a sheet with two rows for the same `(project, fiscal_year)`, *when*
  imported, *then* one `Draft` budget version exists carrying **two** line items.
- **AC-BIMP-002** — *Given* a `Draft` version already exists for that `(project, fiscal_year)`,
  *when* a sheet naming it is imported, *then* no second version is created and the line items attach
  to the existing one.
- **AC-BIMP-003** — *Given* any sheet, *when* imported, *then* every created version has
  `status = 'Draft'`; **and** the descriptor exposes no `status` field at all.
- **AC-BIMP-004** — *Given* a sheet containing an `actual_amount` column, *when* imported, *then*
  `actual_amount` is unchanged on every affected row.
- **AC-BIMP-005** — *Given* a sheet imported once, *when* the identical sheet is imported again,
  *then* the row counts of `budget_versions` and `budget_line_items` are unchanged.
- **AC-BIMP-006** — *Given* two concurrent imports of the same sheet, *when* both commit, *then* the
  database rejects the duplicate (unique violation) rather than admitting both.
- **AC-BIMP-007** — *Given* an **Active** version for a `(project, fiscal_year)`, *when* a sheet
  naming it is imported, *then* the row is refused with a message naming the version's state.
- **AC-BIMP-008** — *Given* any imported row, *when* it is read back, *then* `currency` is set and
  matches the org's currency.
- **AC-BIMP-009** — *Given* a sheet with an invalid row, *when* validation runs, *then* no write has
  occurred to either budget table.

## 4. Traceability

| AC | Owning layer | Location |
|---|---|---|
| AC-BIMP-001/002/003/004/007/008 | Unit (Vitest) | descriptor tests |
| AC-BIMP-005/006 | Integration (pgTAP) | the partial unique index — the DB is the authority |
| AC-BIMP-009 | Unit (Vitest) | wizard validation path |

## 5. Traps this work will hit

- ⚑ **`DD-CUR-4`** — several money tables carry **column-level INSERT grants**, so a new column is
  *not* insertable unless explicitly granted. `0187` granted `insert (currency)` on those tables;
  verify the budget tables permit the insert the descriptor performs before assuming.
- ⚑ **Do not add a descriptor-local dedupe scheme.** `FR-BIMP-007` is a DB constraint on purpose —
  two idempotency mechanisms is how they end up disagreeing.
- ⚑ **Mutation checks required:** add `status` to the descriptor → AC-BIMP-003 must go red; drop the
  partial unique index → AC-BIMP-005/006 must go red.
