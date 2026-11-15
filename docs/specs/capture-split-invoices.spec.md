# Purchase capture B2 — one ERP supplier invoice split across several PMO projects (#2195)

Status: draft for owner sign-off · Issue: #2195 (purchase capture), slice B2 · Builds on: B1 (migration 0882,
`origin/feat/2195-b1-unassigned-invoices-clean`) · Plan: `docs/plans/2026-11-15-capture-split-invoices.md`

## Owner questions (one line each; the recommended default is what this spec assumes)

1. **Wrapper purchase per split?** Default: **none** — the split decision row is the record (a document links to at most
   one purchase, and a purchase on one "lead" project would show the whole invoice on that project's list).
2. **How are split lines stated?** Default: **amounts in the ledger (company) currency**, exact to its minor unit; no percents in B2.
3. **How is each ledger line shared out?** Default: **proportionally** — every project gets the same mix of accounts
   (budget categories) as the invoice, not whole lines in order.
4. **Minimum / maximum lines?** Default: **2 to 20** distinct projects per invoice (one project is B1's `project` decision).
5. **Where does the minor-unit scale come from?** Default: the purchase-capture route reads the ERP's currency precision
   (read only) and passes it to the database; the database refuses ledger amounts that are not exact at that scale.
6. **The ledger changes after the split** (an account newly mapped, an ERP repost)? Default: the split owns the whole
   invoice, as B1 does, and shares the **current** placeable total by the stated proportions; the report flags
   `split_basis_changed` whenever that total differs from the stated one.
7. **Change a split?** Default: **undo and split again** (decisions stay immutable; no edit in place).
8. **Screen in B2?** Default: **CLI only**, like B1; the screen is the later #2195 screen slice.

## Context

B1 lets an active Admin place an ERP Purchase Invoice that carries no ERP project on **one** PMO project, or set it
aside as overhead (`assign_capture_invoices`, decision `project` | `set_aside`). A placed invoice's mapped expense
ledger lines count once, on that project, through `capture_assigned_gl`, and the attribution engine anti-joins the
voucher so a rule or equipment pool does not count it again. B1 refuses an invoice whose cost belongs to several
projects. B2 adds a third decision, `split`: one invoice, N PMO projects, stated amounts that sum exactly to what the
ledger says the invoice costs.

The ledger is the oracle (ADR-0048, `docs/money-path-primer.md`): every placed amount is a share of an
`erp_gl_entry_mirror` row, never the invoice face. Nothing in B2 writes to the ERP (`erp_write: false` everywhere).

## Glossary additions (`docs/glossary.md`)

- **Split decision** — an active Admin's decision that one ERP supplier invoice's project cost belongs to several PMO
  projects in stated amounts.
- **Split line** — one project and its stated amount within a split decision.
- **Placeable total** — the sum of the invoice's current, untagged, non-cancelled ledger rows on mapped expense
  accounts, in ledger currency (B1's `mapped_amount`).
- **Split share** — the part of one current ledger row given to one split line, in minor units, worked out on every
  read from the live ledger (never stored, so an ERP repost that replaces ledger rows cannot leave it stale).

## Money rules (binding)

- **MR-1 Unit.** All split arithmetic is in integer **minor units** of the ledger currency at scale `s` (0–4), read as
  `round(amount × 10^s)`; a ledger row or a stated amount that is not exact at `s` is refused, never rounded silently.
- **MR-2 Exact sum.** The stated amounts must sum **exactly** to the placeable total at decision time (no tolerance).
- **MR-3 Apportionment** (on every read, per invoice). Let `W` be the stated total, `S_i` the running sum of stated
  amounts through line `i` (line order as sent), and `T` the current placeable total. Line targets are
  `t_i = floor(T·S_i/W) − floor(T·S_{i−1}/W)`, so `t_i` is the stated amount whenever `T = W`, and `Σ t_i = T` always.
  For each current eligible row of `A` minor units, each line first gets `floor(A·t_i/T)`; the row's leftover units
  (fewer than the number of lines) go one each to the lines with the largest remainder `A·t_i − floor(A·t_i/T)·T`, ties
  by line ordinal. Then each line's residual `t_i − Σ_rows share` is added to its share of the row with the largest
  absolute amount (ties by ERP ledger-entry name, then id). Result: every row's shares sum exactly to the row, every
  line's shares sum exactly to `t_i`, and the invoice's shares sum exactly to `T`.
- **MR-3a No negative share.** A split is refused (`split_line_too_small`) when any stated amount is below `n²` minor
  units, `n` being the invoice's eligible ledger rows at decision time; with that floor, no line's share of a debit row
  is negative while the row set is unchanged (a 300 000-case randomized check of MR-3 found none).
- **MR-4 Once.** One active decision per invoice (B1's active-source index covers `split`); the attribution engine
  excludes every row of a split voucher exactly as it does for a B1 placement, so each row counts once, as its shares.
- **MR-5 ERP wins.** If any current row of the voucher carries an ERP project tag, the split places nothing and the
  voucher returns to the ordinary paths (B1's precedence rule, unchanged).

## Functional requirements (EARS)

- **FR-001** (event) When an active Admin sends an assignment row with `decision: "split"`, the system shall accept it
  only with a `splits` array of 2–20 objects `{project_id, amount}` with distinct project UUIDs of the caller's
  organization and positive decimal-string amounts, and shall refuse `project_id`, and `allow_capital_as_overhead` on the row.
- **FR-002** (ubiquitous) The system shall apply to a split row every B1 source check (`capture_assignment_validate`:
  kind, status, return, PMO-recorded, linked, tagged, currency, supplier, duplicate lineage, family, ledger evidence,
  company, classification, state, snapshot freshness, set-aside confirmation) with the same refusal reasons.
- **FR-003** (conditional) While the invoice's classification is `capital` or `unmapped`, when a split is requested, the
  system shall refuse it with B1's `capital_spending_not_assignable` / `invoice_has_no_mapped_cost`.
- **FR-004** (event) When the stated amounts do not sum exactly to the placeable total, the system shall refuse the row
  with `split_total_mismatch` and return the placeable total and the stated sum, both as decimal strings.
- **FR-005** (event) When a ledger row of the invoice, or a stated amount, is not exact at the ledger scale, the system
  shall refuse the row with `ledger_amount_not_minor` or `split_amount_scale`; when a stated amount is below MR-3a's
  floor, with `split_line_too_small`.
- **FR-006** (event) When a split row passes, the system shall record one decision row (`decision = 'split'`, no
  `project_id`, `ledger_scale` stored) and its split lines, in one transaction, and write the
  audit event `procurement.erp_split` with the lines, the placeable total, the excluded lines and `prior_placement`.
- **FR-007** (ubiquitous) The system shall create no purchase, purchase link, capture row or ERP write for a split.
- **FR-008** (event) When a split request is previewed (`dry_run`), the system shall return per line the project, stated
  amount and its per-account shares (MR-3), then roll everything back.
- **FR-009** (event) When the same `request_id` is sent again with the same payload, the system shall return the stored
  outcome (`skip`); with a different payload (including any change to the lines), `request_conflict`.
- **FR-010** (ubiquitous) The system shall make split lines immutable once written, and the decision
  row immutable except its undo columns (B1 rule).
- **FR-011** (ubiquitous) The system shall place each split share (MR-3) on its line's project in every project-actuals
  and organization-actuals read that today includes B1 placements, computed from the current ledger rows (a cancelled,
  deleted or no-longer-eligible row places nothing; a re-created or newly eligible row is shared).
- **FR-012** (ubiquitous) The system shall exclude every row of an active split's voucher from the attribution engine,
  as B1 does for a placed invoice.
- **FR-013** (state) While any current row of the voucher carries an ERP project tag, the system shall place nothing for
  the split (MR-5) and the report shall show `tagged_in_erp: true`.
- **FR-014** (event) When an active Admin undoes a split with a reason, the system shall set the decision's undo
  columns, restore the invoice's overhead mark as B1's undo does, and write `procurement.erp_split_undo` with the
  placement before and the recorded prior placement; when the mark has changed since, it shall refuse with
  `assignment_mark_changed`.
- **FR-015** (ubiquitous) The capture report (`purchase_capture_assignment_report`) shall list each active split with,
  per line, the stated amount and the amount placed now, and shall flag `split_basis_changed` when the placed total
  differs from the stated total.
- **FR-016** (ubiquitous) The capture revision shall fingerprint split lines, so a split recorded or undone
  after a preview stales that preview at apply (`source_stale`).
- **FR-017** (ubiquitous) Only an active Admin of the organization, through the purchase-capture route or the CLI
  command-line sign-in already allowed for B1, shall reach the split entry points; other roles read split rows under
  B1's select policy.
- **FR-018** (event) When an Admin runs `pmo purchases assign <file>` with split rows, the CLI shall check them locally
  (shape, distinct projects, amount strings), print one line per row with each split line's amount and the next
  command, and `pmo purchases undo-split <decision> --reason <text> [--dry-run]` shall undo one.

## Non-functional

- **NFR-001** A 500-row assign batch mixing split rows reads the attribution engine once (B1's batch read, unchanged).
- **NFR-002** Project-actuals reads stay plan-inlinable: the split path is one plain-SQL function (window functions over
  the rows of active split vouchers only, found through the voucher index), no plpgsql on the read path.
- **NFR-003** The migration is reversible: a down file restores every replaced body verbatim (B1 rollback harness pattern).

## Acceptance criteria (Given/When/Then)

- **AC-001** Given an untagged invoice whose placeable total is 1000.00 and Projects A, B, When an Admin applies a split
  of A 600.00 / B 400.00, Then A's mapped actuals rise by 600.00, B's by 400.00, and no purchase or ERP write exists.
- **AC-002** Given the same invoice, When the lines sum to 999.99, Then the row is refused `split_total_mismatch` with
  `placeable_total = "1000.00"` and `stated_total = "999.99"`, and nothing is written.
- **AC-003** Given an invoice with ledger rows Cost 700.00 and Fuel 300.00 split A 500.00 / B 500.00, When it is
  recorded, Then each project gets Cost 350.00 and Fuel 150.00.
- **AC-004** Given three rows of 0.01 split A 0.01 / B 0.02, When recorded, Then every row's shares sum to 0.01, A's
  shares sum to 0.01, B's to 0.02, and no share is negative.
- **AC-005** Given a rule that sends untagged Cost lines to Project C, When the invoice is split across A and B, Then C
  loses the invoice's Cost amount, A + B gain it, and the organization's total mapped actuals are unchanged.
- **AC-006** Given an active split, When the ERP later tags one row of the voucher with a project, Then the split places
  nothing, the voucher counts through the ERP tag and the rules, and the report shows `tagged_in_erp`.
- **AC-007** Given an active split, When an Admin undoes it with a reason, Then the projects' actuals return to the
  prior placement and the overhead mark is restored; a second undo returns `already_undone`.
- **AC-008** Given a split request already applied, When it is resent with the same payload, Then the outcome is `skip`;
  with one amount changed, `request_conflict`.
- **AC-009** Given an invoice already placed by a B1 `project` decision, When a split for it is requested, Then the
  row is refused `source_already_decided`.
- **AC-010** Given a split row with one project, a repeated project, 21 lines, a zero amount, `project_id` on the row,
  or a project of another organization, When sent, Then it is refused (`invalid_assignment_row` or `not_found`).
- **AC-011** Given a stated amount with more decimals than the ledger scale, a ledger row not exact at that scale, or a
  stated amount below `n²` minor units, When sent, Then it is refused `split_amount_scale` / `ledger_amount_not_minor` /
  `split_line_too_small`.
- **AC-012** Given a preview revision, When a split is recorded by someone else before apply, Then the apply returns
  `source_stale`.
- **AC-013** Given a Finance, Project Manager or Executive member, When they call the split entry points, Then they are
  refused; they can read split lines of their own organization only.
- **AC-014** Given an active split, When a split line is updated or deleted, Then the write is refused
  `assignment_decision_immutable`.
- **AC-015** Given a split of 1000.00 as A 600.00 / B 400.00, When a newly mapped account adds a row of 50.00 to the
  voucher, Then A reads 630.00, B 420.00, the organization total rises by exactly 50.00, and the report flags
  `split_basis_changed`.
- **AC-016** Given a split file, When the Admin runs `pmo purchases assign` without `--apply`, Then the CLI prints each
  split line with its amount, `erp_write: false`, and the exact apply command; a malformed split is refused locally.
- **AC-017** Given the purchase-capture route, When an assign batch contains a split row, Then the route reads the ERP
  currency precision once (read only), passes it to the database, and returns `erp_write: false`.
- **AC-018** Given migration NNNN applied, When its down runs, Then every replaced function body is restored verbatim
  and the split tables are gone.
- **AC-019** Given an active split, When the ERP reposts the voucher (its ledger rows deleted and re-created under new
  names with the same amounts), Then each project's actuals are unchanged and no write is blocked.

## Out of scope

The screen; percent-based lines; editing a split in place; splitting orders, receipts or journals; any ERP write
(tagging the ERP invoice with projects is a later, separately approved money-path slice).
