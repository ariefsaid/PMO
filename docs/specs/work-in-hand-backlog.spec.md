# Spec: Value of work in hand and months of backlog per contract and work order (#2575)

**Status:** proposed; owner decisions below need sign-off before build. Scheduled after the December go-live (map #2516, February to March). IDs `FR-WIH-###`, `NFR-WIH-###`, `AC-WIH-###`. Plan: `docs/plans/2026-11-20-work-in-hand-backlog.md`. Executor: Orca worker. **Money path: read-only.** It posts nothing, changes no separation-of-duties rule, adds no write path and stores no figure. The screen is composed with the `restructure` skill and judged rendered by the owner (`docs/ux/screen-rules.md`).

> **Review 20 Nov** — checked against the shipped billing read model (`sales_invoice_work_billed` 0262/0498, `work_order_billing` 0337, `get_project_billing` 0921, `get_management_pack` 0908/0919, `org_current_month` 0245, `work_orders` 0193/0337, `projects` 0001/0197). Changed: the work-order value is `work_order_billing.order_net`, and a **work-in-hand row can never carry a closing value** — `closing_value` is stamped only by the final acceptance, which closes the work order, so the old definition and AC-WIH-010 described an impossible row; a foreign-currency invoice makes the pack's Left to bill **unknown** (`reconciled = false`), not a figure with a "left out" count, and the spec now matches the pack (FR-WIH-009, AC-WIH-011); an **undated** invoice is excluded from billed to date and reported in a finding line, not counted (FR-WIH-016); an invoice of unknown amount is reported by the pack only as one org-wide count because it carries no project — this read can attribute it from the view, so that is stated as a deliberate improvement rather than as "as the pack does"; an unset tax basis does not mean "no contract value" (`tax_treatment` falls through to exclusive), only `contract_net <= 0` does; work-order figures take `work_order_billing.figures_complete`; the access clause now says the new function is a presentation gate because `projects` SELECT is org-wide today (new OQ-WIH-4). Open owner decisions: OQ-WIH-4 (whether contract value must stop being readable by every role, which is an RLS/grant change, not this screen), plus the existing OD-WIH-1..7 and OQ-WIH-1..3.

## Job story

When crews and equipment are limited, I want to see for every contract and every work order how much work is still to be billed and how many months that is at the pace we are billing now, ranked, so I can put the crews and machines where the most revenue is waiting.

## Context and boundary

- A **contract** here is a project that carries a contract value (`projects.contract_value`, tax basis in `tax_treatment` and `tax_amount`, 0197). A **work order** is the client's purchase order against a project (`work_orders`, 0193). A work order is a slice of its contract's value, so the two levels are shown as a hierarchy and never added together.
- The billed figure already has one definition in the system: the `security_invoker` view `sales_invoice_work_billed` (0250, 0262, 0498; ADR-0077 decision 9, DD-PBL-9). `get_project_billing` (0921) and `work_order_billing` (0337) both read it. This spec reuses that definition and adds none (OD-WIH-1).
- This is **not** earned value, WIP, margin or cash. Left to bill is a billing quantity: value not yet billed. Earned-but-unbilled work (`get_project_billing.earned_value`) is a different quantity with a different name and stays on the project page.
- **One quantity, one name.** The contract-level figure this spec ranks already exists and is named **Left to bill** (glossary; management pack `leftToBill`, `pmo-portal/src/lib/reports/managementPack.ts`, #2203): contract net less invoiced to date, over the Contract on hand set. This spec reuses that name and that figure and extends it to work orders and to a monthly rate. It adds no second name for it. It is distinct from **Remaining work** (contract net less recognised revenue; formerly "backlog" in the pack, DD-MMP-3), which follows the recognition basis. "Months of backlog" is the new term here and is derived from Left to bill, never from Remaining work (OD-WIH-7).
- The executive home's "contract remaining after spending" (0901) subtracts spending, not billing; it is unchanged.
- No ERP write, no outbox row, no mirror change.

## Definitions (used by the acceptance criteria)

All money is exact decimal, excludes tax, and is in one currency per figure.

- **Contract value** = `contract_value`, minus `tax_amount` when `tax_treatment = 'inclusive'` (the expression of 0901 and `get_project_billing.contract_net`). A `contract_net` that is null or not above 0 means **no contract value**: the contract is listed as "no value set" and has no remaining and no backlog. An unset `tax_treatment` is not "no value": it falls through to exclusive.
- **Work order value** = `work_order_billing.order_net`, which is `closing_value` when stamped and otherwise `order_value` minus `tax_amount` when inclusive. In work in hand (an `Issued` work order) it is always the second form: `closing_value` is stamped only by the final acceptance, and that acceptance closes the work order (0337's pairing constraint and `confirm_work_order_acceptance`).
- **Billed work** (per invoice) = from `sales_invoice_work_billed`: status `Submitted`, `Unpaid` or `Paid`; `net + recovery`; a down-payment invoice counts zero; paired PMO copies are already excluded by the view; invoice currency equals the contract's currency; the invoice has an `invoice_date` and a non-null `net`. Cancelled, Draft and undated invoices do not count, and neither does an invoice whose value is unknown. This counts the same rows as `get_project_billing.work_billed`, which silently drops the foreign-currency and unpriced ones; this screen reports them instead (OD-WIH-1).
- **Billed to date** (contract) = sum of billed work over the project. **Billed to date** (work order) = sum of billed work over invoices naming that work order. Invoices naming no work order count only at contract level.
- **Left to bill** = value minus billed to date; for a contract it is the management pack's figure **when that project has no foreign-currency invoice**. When billed exceeds value the figure is shown as 0 and the row is marked "billed over value"; the pack's own figure is never clamped, so this screen's marked 0 and the pack's negative figure are the same fact shown two ways, and the excess is never netted against another contract.
- **Figure incomplete**: a contract whose billed figure cannot be stated in its own currency — a valued invoice in another currency (the pack's `reconciled = false`), or an invoice of unknown amount. Such a row shows no number for billed to date, Left to bill, rate or backlog, enters no ranking or total, and is counted in the hidden-figures line (NFR-WIH-004).
- **Billing month** = the calendar month of `invoice_date` in the organisation's timezone (`default_timezone`, helper `org_current_month`, 0245). Never browser time.
- **Billing window** = the last N complete billing months before the as-of date, N = 6 (OD-WIH-2). The current partial month is excluded. The as-of date defaults to today in the organisation's timezone (`default_timezone`, `org_current_month`, 0245); a supplied as-of date is used as given.
- **Billing months counted** (M) = the number of calendar months from `max(window start, first billing month of that contract or work order)` through the last complete month, inclusive. Months with no billing inside that span count and contribute zero. When the first billing month is the current partial month, or nothing was billed in the window, M = 0.
- **Current billing rate** = billed work inside the window / M, per month; undefined when M = 0 or the sum is 0 (**no billing rate**).
- **Months of backlog** = Left to bill / current billing rate, rounded half up to one decimal for display, computed from exact integer cents. Undefined when the rate is undefined (OD-WIH-3); 0.0 when Left to bill is 0.
- **Work in hand** = Left to bill on the Contract on hand set (status `Won, Pending KoM`, `Ongoing Project`, `On Hold` or `Close Out`, not archived; the pack's `on_hand` mark, 0919) and on work orders that are `Issued` (Draft is not a commitment yet; Closed and Cancelled hold nothing). The status is shown on each row. Totals are per currency.

Hand calculation (test fixture): contract value 1,200,000 (exclusive); as-of 2026-12-10, so the window is June to November 2026. Billed work: September 100,000, October 150,000 (a down payment of 500,000 counts zero), November 50,000; a Draft invoice of 80,000 and a Cancelled invoice of 90,000 are ignored; December so far 40,000 is outside the window and, being Submitted, still counts in billed to date. Billed to date = 340,000; Left to bill = 860,000. First billing month September, M = 3 (September to November), window sum 300,000, rate = 100,000 a month. Backlog = 860,000 / 100,000 = **8.6 months**.

## Requirements (EARS)

**Figures**
- FR-WIH-001 The system shall show, for each contract in work in hand, its status, value, billed to date, Left to bill, current billing rate and months of backlog, using the Definitions above.
- FR-WIH-002 The system shall show, for each Issued work order in work in hand, the same figures, grouped under its contract.
- FR-WIH-003 The Left to bill and billed figures shall come from the single billed-work definition (`sales_invoice_work_billed`); no new billed definition shall be introduced and the screen shall not recompute billed work from raw invoices in the browser.
- FR-WIH-004 Months of backlog shall be computed from exact decimals (integer cents) and rounded only for display; it shall be reproducible from the underlying rows (the drill-down offers the month-by-month billed table of the window).
- FR-WIH-005 When the billing rate is undefined, the system shall not show a number or zero for backlog; it shall show the row as "no billing rate", rank it after every row with a rate, and name the cause (nothing billed in the window, or billing began this month).
- FR-WIH-006 When Left to bill is 0 or billed exceeds value, Left to bill shall display as 0, backlog as 0.0, and the row shall be marked and shall rank last among rows with a rate.
- FR-WIH-007 When a contract has no contract value, it shall be listed once in a single hidden-figures line with a link to set it, and shall not enter ranking or totals.

- FR-WIH-016 An invoice with no invoice date is excluded from billed to date and from every window month, and is counted in the hidden-figures line (matching `get_management_pack`'s `undated_invoice_count`). An invoice of unknown value (no amount, or no tax basis) makes its contract's figures **incomplete**: that row enters neither ranking nor totals and is counted in the hidden-figures line. The pack can only report these org-wide because its unpriced read carries no project, so attributing them to the contract is a deliberate improvement on the pack, not a restatement of it.

**Currency**
- FR-WIH-008 The system shall rank and total within one currency at a time; it shall never add or compare figures of different currencies. The organisation's currency is shown first; another currency's rows follow as their own group with their own totals.
- FR-WIH-009 A valued invoice whose currency differs from its contract's shall not count as billed work, and its contract row shall be **figure incomplete** (the management pack's `reconciled = false` behaviour), naming how many such invoices caused it. The system shall not show a computed Left to bill for that contract, so no reader sees a number that silently omits an invoice.

**Ranking and views**
- FR-WIH-010 The default order shall be Left to bill descending (revenue waiting), tie-broken by months of backlog descending then name. The user may switch to months of backlog descending, where "no billing rate" rows come last (OD-WIH-4).
- FR-WIH-011 Each ranked row shall link to its contract's project page or its work order's record page (`/work-orders/:id`, #2518).
- FR-WIH-012 The screen shall show per currency the total Left to bill of work in hand and the total current billing rate; the total backlog is the total Left to bill over the total rate, computed only from rows that have a rate, and the rows left out shall be counted in the hidden-figures line.

**Access**
- FR-WIH-013 The read shall be refused to any caller who is not an active member with a role allowed to see finance (Admin, Executive, Finance, OD-WIH-5), by the database, not only by hiding the screen. The route shall be gated by `can('view', 'finance')` and the entry shall not appear for other roles. This is a presentation gate: `projects` SELECT is org-wide today and `get_project_billing` is invoker, so a Project Manager can already read a project's contract value elsewhere; making contract value unreadable to a role is a separate RLS/column-grant change (OQ-WIH-4).
- FR-WIH-014 The read shall be `security invoker`; the caller's RLS is the tenancy boundary, `org_id` is never sent by the client, and another organisation's rows are never returned.
- FR-WIH-015 When the organisation's revenue is mirrored from an external system, the figures shall use the mirrored invoices exactly as the other billing reads do; the screen shall add no write and shall not refresh the mirror.

## Non-functional requirements
- NFR-WIH-001 One database read returns the whole page's rows (one JSON value, so the 1,000-row PostgREST cap does not apply). It returns at most 500 contracts and 3,000 work orders and, beyond that, a `truncated` flag the screen reports in the hidden-figures line instead of silently dropping rows.
- NFR-WIH-002 English and Bahasa Indonesia strings in a new namespace; `DESIGN.md` tokens; money carries its currency; tables right-align tabular figures; usable at phone width.
- NFR-WIH-003 Dates are organisation calendar dates computed in the database; the as-of date is shown on the screen.
- NFR-WIH-004 A screen figure that cannot be computed is hidden with its reason in the one hidden-figures line; it is never 0 and never a sentence in a tile (`docs/ux/screen-rules.md`).

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-WIH-001 | Given the hand-calculation fixture, when figures are derived, then billed to date is 340,000, Left to bill 860,000, rate 100,000 and backlog 8.6. | Unit (pure function) |
| AC-WIH-002 | Given a contract with no billing in the window, when derived, then rate and backlog are undefined and the row is flagged "no billing rate" (not 0, not infinity). | Unit |
| AC-WIH-003 | Given a contract whose first billing month is the current partial month only, when derived, then M = 0 and the rate is undefined. | Unit |
| AC-WIH-004 | Given a contract first billed in the third month of the window with a gap month, when derived, then the gap month counts in M and contributes zero. | Unit |
| AC-WIH-005 | Given billed exceeding value, when derived, then Left to bill shows 0, backlog 0.0, the row is marked over-billed and no negative figure appears. | Unit |
| AC-WIH-006 | Given a Left to bill of 1 cent over a rate of 3 cents, when backlog is rounded, then it uses integer arithmetic half up (0.3), identical to the same inputs through a float-free reference. | Unit |
| AC-WIH-007 | Given rows with and without a rate in two currencies, when ranked, then rows rank by Left to bill within each currency, rows without a rate rank after rows with one, and no cross-currency total exists. | Unit |
| AC-WIH-008 | Given switching to the backlog order, when ranked, then rows order by backlog descending with "no billing rate" last. | Unit |
| AC-WIH-009 | Given the fixture's data seeded as invoices (including a down-payment invoice, a Draft, a Cancelled invoice and a paired PMO copy, and no foreign-currency or unpriced invoice), when the read runs, then billed to date and the window's month sums equal the fixture, billed to date equals `get_project_billing.work_billed` for the same project, and Left to bill equals contract net less the pack's invoiced to date for it. | pgTAP |
| AC-WIH-010 | Given an Issued work order, when the read runs, then its value equals `work_order_billing.order_net` and its figures honour `work_order_billing.figures_complete`; given a Closed work order carrying a stamped closing value, then it is absent from the read and its value does not appear in any row or total. | pgTAP |
| AC-WIH-011 | Given a valued invoice in a currency other than its contract's, when the read runs, then it is excluded from billed work, the contract row is **figure incomplete** (no billed-to-date, Left-to-bill, rate or backlog figure), it ranks nowhere and enters no total, and the row counts the excluded invoices. | pgTAP |
| AC-WIH-012 | Given an invoice dated on the last day of a month in a timezone ahead of UTC, when the read runs, then it falls in that organisation-local month. | pgTAP |
| AC-WIH-013 | Given a caller whose role is not Admin, Executive or Finance (including Project Manager, Viewer and Field roles), or an offboarded account, when the read is called, then it is refused with insufficient privilege and returns no row. (`get_project_finances` also admits a Project Manager; this gate is deliberately narrower, OD-WIH-5.) | pgTAP |
| AC-WIH-014 | Given a caller in another organisation, when the read runs, then none of the first organisation's contracts or work orders appear. | pgTAP |
| AC-WIH-015 | Given a contract with value 0, when the read runs, then it appears in the "no value set" list and in no ranking or total. | pgTAP |
| AC-WIH-016 | Given more than the row bounds, when the read runs, then the flag `truncated` is true and the screen reports it. | pgTAP (owner: server sets the flag); also referenced: Unit (render) |
| AC-WIH-017 | Given a Finance user, when they open the screen, then ranked contracts show with their work orders beneath, switching the order re-sorts, and a row opens its page. | E2E (one journey, owner-sketch-approved layout) |
| AC-WIH-018 | Given an invoice with no invoice date, and a separate contract whose only invoice has no amount, when the read runs, then the undated invoice is in neither billed to date nor any window month and is counted in the hidden-figures line, and the unpriced contract is figure incomplete, ranked nowhere and counted in that line. | pgTAP |

Mutation check (Director-reviewed, though read-only): in the migration, remove the role gate and AC-WIH-013 must go red; change the status filter to include Draft invoices and AC-WIH-009 must go red; stop excluding undated invoices and AC-WIH-018 must go red; restore.

## Errors
| Condition | Result |
|---|---|
| Caller role not allowed, or not an active member | Database refusal; screen shows the shared access-denied state |
| Read fails or returns a malformed figure | Shared error state with retry; never a plausible zero |
| Contract has a foreign-currency or unpriced invoice | Row marked "figure incomplete" with the reason and count; no number, no rank, no total |
| Invoice with no invoice date | Excluded from the figures and counted once in the hidden-figures line |
| No contract in work in hand | One-line empty state naming that nothing is in work in hand |
| Organisation has no invoices yet | Rows listed with no billing rate; no zero backlog |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-WIH-1 | **Billed to date = invoiced work** (the pack's "invoiced to date"): invoices in status Submitted, Unpaid or Paid, net of tax, plus the down-payment recovery, per the existing single definition. Not claims not yet raised, not Draft, not "paid". `work_order_billing.remaining` today also subtracts Draft invoices and unraised claims (a reservation for the over-invoice fence); this view does not, so a work order can show more Left to bill here than the invoice dialog's "still to invoice". Both are labelled. | Using paid would shrink billing rate by the receivables delay and read as slow work; using reserved amounts would hide work a crew has yet to do. A reader comparing with the invoice dialog may see two numbers; the existing labels "Left to bill" and "Still to invoice" keep them apart. |
| OD-WIH-2 | Current billing rate = billed work in the last 6 complete months / months counted, M running from the contract's or work order's first billing month inside the window. | A shorter window chases one big invoice; a longer one lags a real change in pace. A fixed divisor of 6 would understate a contract that started billing recently and show it as years of backlog. |
| OD-WIH-3 | Zero rate: backlog is undefined, shown as "no billing rate", ranked after every row with a rate. | Showing infinity, zero or a cap would hide exactly the contracts with value waiting and no billing, which management most needs to see. |
| OD-WIH-4 | Default rank is Left to bill descending (matching "revenue potential is highest"); backlog months is the alternate order. | A contract with a huge value and fast billing would top a backlog ranking while needing no extra crews. |
| OD-WIH-5 | Access is Admin, Executive and Finance, the same as the Finance area. A Project Manager sees contract billing on their own project page already and is not given this cross-contract ranking. Project Manager access would be a later decision, because it exposes other projects' values. | Too narrow: a PM cannot see where crews are needed. Too wide: a role without finance access reads every contract's value and billing. |
| OD-WIH-6 | Contracts in the Contract on hand set (so the contract figure equals the pack's and the home dashboard's Left to bill) and Issued work orders count as work in hand; the status is shown so On Hold and Close Out rows read as such; contract value and work-order value are shown in their own rows and never added. | Restricting to Ongoing Project alone would make this screen disagree with the pack's Left to bill; counting Draft work orders inflates work in hand with orders not yet committed; adding the two levels double-counts. |
| OD-WIH-7 | Months of backlog is derived from Left to bill (invoice basis), not from Remaining work (recognition basis), because the rate is also invoice-based and the two then share one clock. | Mixing bases would divide an earned-value remainder by an invoicing pace and give a figure no table can reproduce. |
| OQ-WIH-1 | Does a contract's variation or approved change to contract value already flow into `contract_value`? Default: this view follows whatever `contract_value` holds. | Left to bill is off by the unrecorded variation. |
| OQ-WIH-2 | Should a work order with no billing yet borrow its contract's rate as an estimate? Default no: it shows "no billing rate". | Newly issued work orders look unranked until their first invoice. |
| OQ-WIH-3 | Bahasa Indonesia wording (default "Sisa nilai pekerjaan" for Left to bill and "Bulan backlog" for months of backlog) to be confirmed by the owner. | A term the finance team does not use. |
| OQ-WIH-4 | `projects` SELECT is org-wide and `get_project_billing` is invoker, so every active member can already read a contract's net value through the API. This screen's role gate changes who is *shown* the cross-contract ranking, not who can read the figure. If contract value must be unreadable to a role, that is a column-grant/RLS change on `projects` (and the existing readers), which is a separate money-path decision. | Left as is, a Project Manager can reach the same values by another route, so the gate reads as stronger than it is; changed carelessly, project pages stop showing contract value to the people who run the projects. |

## Delivery checklist
- [ ] Owner signs OD-WIH-1..7, answers OQ-WIH-1..4.
- [ ] Owner sketch-glance of the layout before build.
- [ ] Glossary entries added (this change).
- [ ] After release: `improve-codebase-architecture` on the changed areas.
