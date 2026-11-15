# No blank regions (#2197): region-timing baseline (BEFORE)

Measured with `scripts/perf/region-timing.mjs` on the local stack (seeded, `exec@acme.test`, Vite dev server,
headless Chromium 1440x900), plan slice P0. One warm-up pass is discarded per row, then one timed pass.
Each row holds every API request whose URL contains the stated substring for **3000 ms**, then reports the
time from navigation to the region first holding non-loading content (no `aria-busy`, no `*-loading` child).
"beat the delayed read" = region content arrived in under 3000 ms. **no hook** = the region has no
`data-testid` at head (or does not render in the measured state); a slice adds its hook with its own
change. Times are a single run on a shared dev box: use them to compare a slice's before/after, not as absolutes.
Each slice's PR appends its **after** row below its BEFORE row.

Rows A13 (command palette: needs the palette open) is not measurable by route and is not measured here.

## A1

Delayed read substring: `get_sales_pipeline`

**/sales** — delayed read: `get_sales_pipeline` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| pipeline-open-value-figure | 5588 | no |

## A2

Delayed read substring: `project_budget_positions`

**/projects/41000000-0000-0000-0000-000000000005/budget** — delayed read: `project_budget_positions` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| budget-readiness-summary | no hook | n/a |
| commitments-column | no hook | n/a |

## A3

Delayed read substring: `rest/v1/sales_invoices`

**/finance/receivables** — delayed read: `rest/v1/sales_invoices` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| invoice-list-body | no hook | n/a |

## A3b

Delayed read substring: `rest/v1/incoming_payments`

**/finance/receivables** — delayed read: `rest/v1/incoming_payments` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| receipts-list-body | no hook | n/a |

## A4

Delayed read substring: `rest/v1/sales_invoices`

**/sales-invoices/b5000000-0000-0000-0000-000000000001** — delayed read: `rest/v1/sales_invoices` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| invoice-record | no hook | n/a |

## A5

Delayed read substring: `project_budget_positions`

**/projects/41000000-0000-0000-0000-000000000005** — delayed read: `project_budget_positions` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| needs-attention | no hook | n/a |
| primary-action | no hook | n/a |

## A6

Delayed read substring: `get_project_overview_read`

**/projects/41000000-0000-0000-0000-000000000005** — delayed read: `get_project_overview_read` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| project-section-tabs | 5624 | no |

## A7

Delayed read substring: `rest/v1/sales_invoices`

**/projects/41000000-0000-0000-0000-000000000005/billing** — delayed read: `rest/v1/sales_invoices` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| raise-figures | no hook | n/a |

## A8

Delayed read substring: `rest/v1/sales_invoices`

**/projects/41000000-0000-0000-0000-000000000005/work-orders** — delayed read: `rest/v1/sales_invoices` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| customer-order-card | no hook | n/a |

## A9

Delayed read substring: `rest/v1/procurements`

**/approvals** — delayed read: `rest/v1/procurements` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| approvals-queue-region | 4988 | no |

## A10

Delayed read substring: `get_projects_money_collection`

**/projects** — delayed read: `get_projects_money_collection` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| projects-table-container | 2507 | yes |

## A11

Delayed read substring: `rest/v1/stock_warehouses`

**/stock/documents/1543854c-9229-468d-8b20-b085fe037d0e/edit** — delayed read: `rest/v1/stock_warehouses` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| stock-count-form | no hook | n/a |

## A12

Delayed read substring: `rest/v1/stock_warehouses`

**/stock/new/receipt** — delayed read: `rest/v1/stock_warehouses` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| stock-movement-form | no hook | n/a |

## A14

Delayed read substring: `rest/v1/erp_`

**/companies/c0000000-0000-0000-0000-000000000001** — delayed read: `rest/v1/erp_` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| collections-ageing | no hook | n/a |

## A15

Delayed read substring: `rpc/org_usage_summary`

**/administration/usage** — delayed read: `rpc/org_usage_summary` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| administration-panel-usage | no hook | n/a |

## A16

Delayed read substring: `resolved_org_features`

**/administration/features** — delayed read: `resolved_org_features` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| administration-panel-features | no hook | n/a |

## A17

Delayed read substring: `resolved_org_plan`

**/administration/plan** — delayed read: `resolved_org_plan` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| administration-panel-plan | 4989 | no |

## A18

Delayed read substring: `get_financial_statement_catalogue`

**/finance/statements** — delayed read: `get_financial_statement_catalogue` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| statement-body | no hook | n/a |

## A19

Delayed read substring: `get_financial_statement_catalogue`

**/projects/41000000-0000-0000-0000-000000000005/budget** — delayed read: `get_financial_statement_catalogue` held 3000 ms

| region | ms to content | beat the delayed read |
|---|---|---|
| project-pl-section | no hook | n/a |


## AFTER: A5, A6, A7, A8 (project detail batch)

Same method as above (local stack, Vite dev servers, headless Chromium 1440x900, 3000 ms hold). Base = the phase 0
branch with only the new `data-testid` hooks added; after = this batch. Three alternating timed runs per route after one
discarded warm-up. The project in the first table is a seeded delivery project; the finance user is used where the
primary action must exist (the Executive user is not offered it). Milliseconds to content, base then after.

| route | delayed read | region | before (3 runs) | after (3 runs) |
|---|---|---|---|---|
| /projects/:id (delivery project) | `project_budget_positions` | needs-attention-rows | 5208 / 5182 / 5246 | 2004 / 2064 / 2125 |
| | | needs-attention (whole card, incl. its loading row) | 5193 / 5182 / 5246 | 5032 / 5089 / 5156 |
| | | primary-action | 2189 / 2152 / 2220 | 2119 / 2064 / 2126 |
| | | project-section-tabs | 2189 / 2152 / 2220 | 2120 / 2065 / 2126 |
| /projects/:id | `get_project_overview_read` | project-section-tabs (A6) | 5293 / 5198 / 5169 | 2242 / 1997 / 2283 |
| | | primary-action | 5294 / 5199 / 5169 | 2242 / 2178 / 2311 |
| | | needs-attention (inside the overview content) | 5294 / 5199 / 5169 | 5267 / 5053 / 5333 |

Reading: no region got slower beyond run-to-run noise (about 150 ms on this box). The attention card's rows now arrive
before the held read; the whole card, which includes the one loading row, still waits for it by design. The overview
content region waits for the overview read, and the header, tabs and primary action no longer do.

**A7:** `raise-figures` is the raise-invoice confirm dialog's own hook (it renders only after a click), so it has no
timed state on load, and this slice adds no hook of its own. The full-layout `BillingTab` that holds the "New claim"
button is not mounted by any route at head (the contract tab mounts it in contract-tools mode); the live "New claim"
button is in `WorkOrdersClaimsCard` / `WorkOrdersTab`. See the batch notes.
**A8:** the card already takes invoices and billing from its parent (no read of its own); the hook `customer-order-card`
is added, but the seed holds no customer orders, so the region does not render in the measured state.
