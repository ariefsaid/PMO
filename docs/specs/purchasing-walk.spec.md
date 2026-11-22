# Purchasing: a purchase carries its cost, supplier and value from the start

Source: a first-time-person walk of the released build, Bahasa Indonesia, phone first. Each item below is a job a person could not finish or find.
Owning layers: pgTAP for database rules, Vitest for screens and logic, one Playwright journey per job.

## Requirements (EARS)

- **FR-PWA-001** When an organisation has Site cash on and no site cash limit, the system shall show Admin a "Site cash limit" field on the Purchase rules card, and shall show every other role the value read-only.
- **FR-PWA-002** When Site cash cannot be set up because no limit exists, the system shall say, in the reader's language, that an Admin sets it in Administration, Accounting, Purchase rules, and shall show no database text.
- **FR-PWA-003** When a request is raised on a project, the system shall ask for a work order and a discipline on the request form, starting on the project's only open work order when there is exactly one.
- **FR-PWA-004** The database shall store the chosen work order and discipline on the purchase, apply the same project rule as every other cost record, and stamp the request and order records with them.
- **FR-PWA-005** When a receipt or supplier bill form opens, it shall start on the work order and discipline the order or purchase already carries.
- **FR-PWA-006** The database shall refuse to record an order for a purchase with no supplier (ORDER_NEEDS_SUPPLIER), except a purchase that predates the connected system.
- **FR-PWA-007** When "Record order" is chosen and a supplier exists, the system shall show a confirmation naming the supplier and the amount before the order is recorded. When no supplier exists it shall open the supplier picker instead.
- **FR-PWA-008** Where a receipt has no stored amount and is the only receipt, received in full, with every order line priced, the system shall show its value from the order lines and say so. Otherwise it shall say the value is not recorded.
- **FR-PWA-009** When a work order's costs list a purchase record not yet counted, the system shall say it counts once its supplier bill is recorded, instead of "amount unavailable".
- **FR-PWA-010** Where a person may record supplier bills, the payables list shall offer "New vendor bill" with a purchase picker that opens that purchase's bill form.
- **FR-PWA-011** When the supplier bill form opens, it shall say what can hold the bill (the receipt-before-bill rule, the three-way match) and which role releases it.
- **FR-PWA-012** The payment channel, the printable purchase order and the approver the request goes to shall be visible on the purchase's Timeline tab; when printing is off, the order says which role turns it on and where.

## Acceptance criteria (Given / When / Then)

- **AC-PWA-001** (pgTAP) Given a purchase raised with a work order and discipline, When it is saved, Then both are on the purchase.
- **AC-PWA-002** (pgTAP) Given a work order of another project, When a purchase is raised naming it, Then COST_WO_PROJECT refuses it.
- **AC-PWA-003** (pgTAP) Given an attributed purchase, When it is submitted, Then its request record carries the work order.
- **AC-PWA-004** (pgTAP) Given an approved purchase with no supplier, When the order is recorded, Then ORDER_NEEDS_SUPPLIER (23514) refuses it and the status is unchanged.
- **AC-PWA-005** (pgTAP) Given a supplier, When the order is recorded, Then the order record carries the work order and discipline.
- **JOB-PU20** (journey) Finance is refused, told where an Admin sets the limit; the Admin sets it; site cash is set up.
- **JOB-PU21** (journey) The request starts on the only open work order; order and receipt forms follow it.
- **JOB-PU1** (journey) No order without a supplier; the order needs a named confirmation.
- **JOB-PU22** (journey) The receipt shows Rp 45 million from the order lines.
- **JOB-PU23** (journey) A vendor bill starts from the payables list.
- Item 6 is covered by Vitest (ProcurementDetails, JOB-PU24).

## Decisions and open questions

- Direct cost still counts a purchase when its supplier bill is recorded and paid. Counting a receipt as cost at receipt is a money policy change and was not made; the page now says what is missing. Open question for the owner.
- Attribution is per purchase (header), not per request line. A request line level would need its own table; the header answers "where does this purchase's cost go". Open question.
- No rule was loosened. The supplier rule is stricter than before.
