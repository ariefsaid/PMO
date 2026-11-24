# Setup lane: open items needing a product decision

1. **Work-order number column.** The brief lists "number" next to "client reference". The document number is minted only at issue (migration 0193 refuses a number at creation), so the template has no number column. Decide: keep minting at issue (current), or add a separate "your own number" field to work orders.
2. **Discipline column.** A discipline is set on a contract line (`boq_items.discipline_id`), not on a work order, so the template has no discipline column. Decide: is a work-order-level discipline wanted, or does the scope line's contract line carry it?
3. **Tax treatment column.** The template requires it (the product never defaults a tax treatment); the brief did not list it. Confirm this is wanted, or name a project-level default.
4. **Opening balances: receivables, payables, site cash floats.** The CLI loader supports only work-order openings (certified and claimed quantities) and stock openings. The screen shows those two kinds; the other three have no loader to show. Decide if they are in scope, which would add loaders.
