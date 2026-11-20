# Work orders on the cost side — cost attribution (#2517)

- **Map:** #2516 (contractor field operations). **ADR:** ADR-0104. **Plan:** `docs/plans/2026-11-20-work-order-cost-attribution.md`.
- **Job story:** When I run a project as several client work orders, I want every cost — purchases, stock issued,
  hours and equipment — to say which work order and discipline it was spent on, so I can see what each work order
  really costs without breaking the project totals I already trust.
- **Out of scope here:** the work-order page (#2518), plan vs actual (#2519), stock per work order (#2523), a screen
  to keep the discipline list (see Open questions).

## Requirements (EARS)

- **FR-WCA-001** The system shall let each of the seven cost sources — purchase request, purchase order, goods
  receipt, vendor bill, timesheet line, stock document, equipment usage entry — carry an optional work order and an
  optional discipline.
- **FR-WCA-002** Where a cost names neither, the system shall treat it as a project-level cost, as before.
- **FR-WCA-010** The system shall keep an organisation-defined list of disciplines (code, name), readable by every
  active member of the organisation.
- **FR-WCA-011** When a non-Admin tries to add, change or delete a discipline, the system shall refuse it.
- **FR-WCA-012** While a discipline is archived, the system shall not offer it and shall refuse it on a new attribution.
- **FR-WCA-020** When a cost names a work order, the system shall refuse it unless the work order is in the cost's
  organisation and on the cost's own project, whichever path wrote it.
- **FR-WCA-021** The cost's project shall be: its own project (timesheet line, equipment usage, stock issue or
  return); the destination site warehouse's project (stock transfer); the purchase's project (purchase records).
- **FR-WCA-022** When a cost with no project names a work order, the system shall refuse it.
- **FR-WCA-023** When a purchase whose records name a work order is moved to another project, the system shall
  refuse the move.
- **FR-WCA-024** When a cost newly names a cancelled work order, the system shall refuse it.
- **FR-WCA-030** The system shall offer one write path that sets the work order and discipline of 1–500 records of
  one source, after the record exists, without changing any status, approval, posting or money figure.
- **FR-WCA-031** While a stock document is posted or cancelled, the system shall refuse every change except to its
  work order and discipline.
- **FR-WCA-032** When a timesheet week is saved, the system shall store each line's work order and discipline when
  the line names them, and keep them when it names neither.
- **FR-WCA-033** The system shall let Admin, Executive, Finance and Project Manager set the attribution of any
  record of their organisation, and anyone else only their own record while it is theirs to edit.
- **FR-WCA-034** The system shall audit every attribution change per record.
- **FR-WCA-040** The system shall offer one read of a work order's cost records, by source, under each source's own
  row rules.
- **FR-WCA-050** The forms that create these records shall offer a work-order picker (the project's open work
  orders) and a discipline picker, built on the shared Combobox, in English and Bahasa Indonesia.
- **NFR-WCA-001** Project totals shall be unchanged by attribution.
- **NFR-WCA-002** A second organisation shall read none of these records and change none of them.

## Acceptance criteria

- **AC-WCA-001** Given each of the seven sources, When Finance attributes a record to a work order of its project
  and a discipline, Then the record names both.
- **AC-WCA-002** Given a cost on project P1, When anyone (RPC or direct write) names a work order of P2, of another
  org, or a cancelled one, Then the database refuses with `23514` and the reason.
- **AC-WCA-003** Given an archived or another org's discipline, When a cost names it, Then the database refuses it.
- **AC-WCA-004** Given a stock receipt, or a transfer to a site with no project, When it names a work order, Then it
  is refused; naming only a discipline is allowed.
- **AC-WCA-005** Given a transfer to a site of P1, When it names a work order of P1, Then it is stored.
- **AC-WCA-006** Given P1's committed spend and actuals, When its costs are attributed to work orders, Then both are
  unchanged.
- **AC-WCA-007** Given a user of org B, When they attribute or read org A's records, or point their record at org A's
  work order, Then they get "not found", nothing, or a refusal; they see only org B's disciplines.
- **AC-WCA-008** Given an Engineer, When they attribute their own Draft timesheet line, their own equipment entry or
  their own stock movement, Then it is stored; another person's record is refused (`42501`).
- **AC-WCA-009** Given a Project Manager, When they add a discipline, Then RLS refuses it; an Admin's is stored and
  stamped with the Admin's org.
- **AC-WCA-010** Given a posted stock issue, When its work order changes, Then it is stored; when anything else
  changes, Then `STK_IMMUTABLE`.
- **AC-WCA-011** Given a purchase whose records name a work order of P1, When it is moved to P2, Then it is refused.
- **AC-WCA-012** Given attributed records, When the read seam is asked for one work order, Then it returns its
  records grouped by source, oldest first.
- **AC-WCA-013** Given a create that succeeded and an attribution the database refused, When the form finishes, Then
  it says the record was saved, names the reason, and offers no retry that would duplicate the record.
- **AC-WCA-014** Given a cost form, When the user opens the work-order picker, Then it lists the project's open work
  orders (never cancelled); with no project it is unavailable and says why; a project change drops the old work order.
- **AC-WCA-015** Given a Draft timesheet, When the week is saved with a line naming a work order, Then the line keeps
  it on a later save that names none, and a work order of another project is refused.
- **AC-WCA-016** Given the timesheet grid, When only a row's work order changes, Then Save re-sends that row's lines
  with it; an unchanged row sends nothing.
- **AC-WCA-017** Given an Admin on Administration → Project setup, When they add a discipline (code, name), rename it or
  archive it, Then the list and every discipline picker reflect it; a duplicate live code is refused with its reason; an
  archived discipline stays on the records that name it; Given any other role, Then the list is read-only (#2623).

## Owning layer

| AC | Layer | Test |
|---|---|---|
| AC-WCA-001..011, 015 | pgTAP | `supabase/tests/0950_work_order_cost_attribution.test.sql` |
| AC-WCA-012, 013 | Unit | `src/lib/db/workOrderCosts.test.ts`, `src/components/workOrders/costAttributionError.test.ts` |
| AC-WCA-017 | Unit (RTL) | `pages/admin/CostDisciplines.test.tsx`, `src/lib/db/workOrderCosts.test.ts`, `src/auth/policy.test.ts` |
| AC-WCA-014 | Unit (RTL) | `src/components/workOrders/CostAttributionFields.test.tsx` |
| AC-WCA-016 | Unit | `src/lib/timesheet-edit.test.ts` |

## Open questions

1. **Discipline list screen.** *Closed (#2623):* Administration → Project setup → **Cost disciplines**: an Admin adds,
   renames and archives a discipline (code, name) over 0950's Admin-only RLS; other roles read it (AC-WCA-017). A
   `pmo` CLI command for onboarding is not built.
2. **Two work orders in one day on one project** (timesheet). The row key is unchanged, so a row has one work order.
3. **The second vendor-bill entry point** (the inline capture on the decision zone) does not offer the pickers yet;
   the bill can be attributed afterwards through the write path.
