# Price visibility: Foreman and Field user read no price

Status: Draft for Director sign-off. Rulings it rests on: OD-SCOPE-3 (28 built-in roles), OD-SCOPE-4 (Foreman and Field user are light accounts and see no price), DD-R1215-1 (the hide setting ships off). Builds on `hide-prices.spec.md` (#2699) and `builtin-role-set.spec.md` section 2.

**Job story.** When an Admin turns on hiding prices, I want prices hidden from foremen and site users, so that only the people who work on site lose figures they never needed.

## 1. Verified: the base already answers the ask for field roles

Code was read, not assumed (2026-11-22). The item becomes acceptance tests and nothing else; no migration, no setting, no function change.

- A Foreman and a Field user are light accounts (`actor_is_light()`, `1205_light_accounts_helpers.sql:20-24`, true for the two job role keys).
- Every priced purchase and stock base table carries a restrictive policy refusing a light account's reads: `light_account_deny` (1206, list at lines 17-27) narrowed to `light_account_deny_select` for the select-only tables by 1229 (`purchase_orders`, `procurement_invoices`, `payments` among them). `po_variation_lines` is not on that list; its own read policy joins a parent whose rows a field account cannot read (the 2711 sweep records it as such).
- The masked views are `security_invoker`, so they read through those same tables: a field account gets no row (1216, 1217).
- The stock cost reads (`get_stock_on_hand`, `get_stock_ledger`, `get_stock_document_costs`) and `work_order_cost_amounts` refuse a light account (`assert_not_light`, 1209). `get_stock_erp_value` reads a table a field account cannot read and returns nothing. `stock_ledger`, `stock_balances` and the unit-cost column of `stock_document_lines` are readable by no signed-in role directly; their prices come only through those reads.
- The price right itself: `actor_may_see_prices_now()` (`1215_hide_prices_setting.sql:36-44`) answers false for these two roles when hiding is on, because they hold no `sees_prices` row (`1200_builtin_role_catalogue.sql:80-94`).
- The setting is off everywhere: `organizations.hide_prices_from_requesters` is `not null default false` (1215:7), only an Admin writes it, and its Administration card is held back (`HIDE_PRICES_SETTING_AVAILABLE = false`, `pmo-portal/src/lib/db/hidePrices.ts:5`; DD-R1215-1). No organisation uses the older behaviour.
- Who else loses prices when hiding is on is unchanged by this item (today: eleven officer roles and any no-job-role person at the Engineer level). That is a separate customer question, not built here.

## 2. Channels a price can be read through (enumerated from the code)

| Channel | Where | Price column |
|---|---|---|
| Base tables | `procurements`, `procurement_items`, `procurement_invoices`, `purchase_orders`, `purchase_requests`, `payments`, `purchase_order_lines`, `po_variation_lines`, `stock_document_lines`, `stock_ledger`, `stock_balances` | total_value, rate, amount, unit_cost, value_after, value_on_hand |
| Masked views | the same eleven, suffix `_masked` (1216, 1217) | same |
| Derived amounts | `procurement_open_commitments_masked`, `project_committed_spend_masked` (1218) and their originals `procurement_open_commitments`, `project_committed_spend` | amount |
| Stock cost seam | `stock_can_see_cost()` (1217) | boolean |
| Priced definer reads | `get_stock_on_hand`, `get_stock_ledger`, `get_stock_document_costs`, `work_order_cost_amounts` (refused to a field account); `get_stock_erp_value` (returns no value) | cost and value in the returned rows |
| Price-right answer | `get_may_see_prices`, `actor_may_see_prices`, `actor_may_see_prices_now` | boolean |

Out of scope, as in the hide-prices spec section 3: budget, BOQ and revenue figures.

## 3. Requirements (EARS)

- **FR-001** While a person holds the Foreman or Field user job role, the system shall return no priced value through any channel in section 2, with hiding on and with hiding off.
- **FR-002** While hiding is on, the price-right answer shall be false for a Foreman and for a Field user.
- **FR-003** The stock cost reads and `work_order_cost_amounts` shall refuse (42501) a Foreman and a Field user.
- **FR-004** A person with an office role who may read the rows shall read the prices (control; proves the channels hold prices).
- No refusal message is introduced and no setting or default changes.

## 4. Acceptance criteria

Each is owned by `supabase/tests/1850_price_visibility_field_roles.test.sql` (pgTAP, DB-enforced; each assertion covers a Foreman and a Field user, hiding on and off, 4 observations).

| ID | Given / When / Then |
|---|---|
| AC-PVF-001 | One assertion per base table (11): the person reads no priced value. |
| AC-PVF-002 | One assertion per masked view (11): the person reads no priced value. |
| AC-PVF-003 | `procurement_open_commitments_masked`, `project_committed_spend_masked`, `procurement_open_commitments`, `project_committed_spend`, `stock_can_see_cost`, `get_stock_erp_value`: no amount, no true. |
| AC-PVF-004 | `get_stock_on_hand`, `get_stock_ledger`, `get_stock_document_costs`, `work_order_cost_amounts` are refused with 42501. |
| AC-PVF-005 | Hiding on: `get_may_see_prices` and `actor_may_see_prices_now` answer false for each. |
| AC-PVF-006 | The two actors hold the two job roles. |
| AC-PVF-007 | Controls: an Admin and a Finance person read prices from every seeded base table and masked view; a Buyer reads a unit price through the masked view; committed spend is non-empty for the Admin; the Admin reads stock values through the three stock reads. Payments have a seeded row; ledger, balances and stock unit cost have none readable by anyone directly, so their control is the stock reads. |

Mutation check, run once on the lane DB: `actor_is_light()` made false turns five assertions red (committed spend x2, three stock reads); restored, 43 of 43 pass. Other breaks are in the file header.

## 5. Settings and defaults

Unchanged. The hide setting stays default off. Who holds the price right remains data (`built_in_role_capabilities`, capability `sees_prices`), decided by one function.

## 6. Existing tests

None change. The new file does not touch the gate branch's tests; if the base-table gate (`feat/hide-prices-db-gate`, not landed) later restates `actor_may_see_prices_now()`, this file keeps its meaning.

## 7. Question for the customer

"Which other roles should lose prices when hiding is on?" Recommended answer: none beyond Foreman and Field user. Today eleven officer roles (Project Administrator, Engineer, Planner, Quantity Surveyor, Material Coordinator, Storekeeper, Site Supervisor, Quality Inspector, Safety Officer, Equipment Officer, HR Officer) and a no-job-role person at the Engineer level also lose prices when hiding is on, which is wider than the ask. If the customer agrees, a follow-up adds one data row per role and drops the legacy-Engineer clause (two small migrations, built and reverted in this lane's history).
