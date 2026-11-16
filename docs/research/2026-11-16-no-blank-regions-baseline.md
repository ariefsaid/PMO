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


## Phase A batch 5 (A11, A12, A14-A17): before and after

Local stack, one warm-up pass discarded, then three timed passes per side; the cell is the median (all three runs
in brackets). "before" = origin/dev with only the region hook added; "after" = this branch. Each delayed read is
held 3000 ms. The stock rows use `/stock/new/count` and `/stock/new/receive` as the admin seed user; the features
console is measured as the seeded platform operator. A region that holds a loading child does not count as
content, so a header region is measured on its own wrapper.

| slice | route | delayed read | region | before ms | after ms |
|---|---|---|---|---|---|
| A11 | /stock/new/count | rest/v1/stock_items | stock-count-header | 5052 (4971, 5052, 5248) | 1976 (1946, 1976, 2073) |
| A12 | /stock/new/receive | rest/v1/stock_items | stock-movement-header | 5031 (4974, 5031, 5077) | 2001 (1944, 2001, 2126) |
| A14 | /companies/:id (client) | rest/v1/erp_ar | collections-ageing | dropped: no gain measured | dropped |
| A15 | /administration/usage | rpc/operator_agent_run_stats | usage-table | dropped: no gain measured | dropped |
| A16 | /administration/features | rpc/operator_org_overrides | console-header | 5204 (5198, 5204, 5210) | 2159 (2130, 2159, 2182) |
| A17 | /administration/plan | rpc/resolved_org_plan | your-plan-features-card | 5120 (5009, 5120, 5196) | 2049 (2022, 2049, 2079) |

Reading the rows: the delayed read's own region (stock lines, the plan card, the switch table) still waits for
it, by design. A14 and A15 were dropped: their changes measured no gain and were reverted.

## A1 + A3 + A4 — before/after (batch 1, branch perf/2197-a1-sales-receivables)

Same method as above. The three hooks `invoice-list-body`, `receipts-list-body` and `invoice-record` were added with
this batch, so the "before" column is origin/dev plus only those three `data-testid`s (two timed passes each, the second
one kept). Rows 1 to 4 hold the read the region itself waits on, so they must not get worse. Rows 5 to 8 hold the sibling
read the old gate was OR-ed with (won/lost projects, revenue mode, invoice list): the region should now beat the delay.

| # | route | delayed read | region | before ms | after ms |
|---|---|---|---|---|---|
| 1 | /sales | `get_sales_pipeline` | pipeline-open-value-figure | 5169 | 5058 |
| 2 | /finance/receivables | `rest/v1/sales_invoices` | invoice-list-body | 5172 | 5086 |
| 3 | /finance/receivables?view=payments | `rest/v1/incoming_payments` | receipts-list-body | 4971 | 5116 |
| 4 | /sales-invoices/:id | `rest/v1/sales_invoices` (list and by-id) | invoice-record | 5037 | 5073 |
| 5 | /sales | `rest/v1/projects?` (won + lost) | pipeline-open-value-figure | 5158 | 1917 / 2082 |
| 6 | /finance/receivables | `rest/v1/external_domain_ownership` | invoice-list-body | 4597 / 4624 | 1991 / 2426 |
| 7 | /finance/receivables?view=payments | `rest/v1/external_domain_ownership` | receipts-list-body | 4462 / 4603 | 1919 / 2093 |
| 8 | /sales-invoices/:id | `order=invoice_date.desc` (list only) | invoice-record | 5024 / 5131 | 2026 / 2082 |

Rows 1 to 4 differ by run noise (5.0 to 5.2 s, which is the 3000 ms hold plus the page's own cold read); row 3 reads
4971 then 5116 (+145 ms, inside the 100 to 200 ms spread of the repeated passes: 4971 and 5135 before, 5039 and 5116 after).
