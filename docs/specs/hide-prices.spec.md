# Hide prices from requesters: organisation setting

Ticket #2699 (map #902). Status: Draft for Director approval. Rulings: OD-SCOPE-2 (a setting, no client process), OD-SCOPE-3.
Builds on: `builtin-role-set.spec.md` (#2709): `actor_sees_prices()`, `actor_built_in_role()`.

**Job story.** When people only request items, I want them not to see unit prices and amounts, so pricing stays with purchasing and finance.

## 1. Design

One organisation setting `organizations.hide_prices_from_requesters` (default false). While false nothing changes for anyone.
One SQL rule, `actor_may_see_prices()`, decides every price read; one frontend mirror, `canSeePrices(ctx)` in `src/auth/policy.ts`
(a `can('view','prices',ctx)` entry). Price columns are nulled in the database; the frontend hides a price column only when the
server returned it as hidden.

**Requester (defined).** A person acts purely as a requester when they can raise requests but hold no purchasing or finance
authority. Concretely, with the setting on, a person is hidden from prices when either:
(a) they hold a built-in role key and `built_in_role_sees_prices(key)` is false (every officer and field role except Buyer, Finance
Officer and Billing Officer, from #2709 FR-008); or
(b) they hold no key (legacy five-role person) and their base level is Engineer.
Everyone else sees prices: managers, Buyer, Finance Officer, Billing Officer, and legacy Project Manager, Finance, Admin, Executive.
The rule reads the real signed-in role, never the view-as role, and is per person, not per request: a hidden person does not see prices
on a request they raised either. An inactive member sees nothing.

`actor_may_see_prices() = not org_setting(auth_org_id) or (actor_sees_prices() and not (actor_built_in_role() is null and auth_role() = 'Engineer'))`.

## 2. Requirements (EARS)

- **FR-001** The organization shall have a setting `hide_prices_from_requesters`, default false, changed only by an Admin of that
  organization through `set_hide_prices_enabled(boolean)`; any active member reads it through `get_hide_prices_enabled()`.
- **FR-002** While the setting is false, every read shall return what it returned before this ticket.
- **FR-003** The system shall provide one SQL function `actor_may_see_prices()` implementing section 1, and every price surface in section 3 shall
  call it (wrapped `(select actor_may_see_prices())`, once per query).
- **FR-004** While the setting is true and the actor may not see prices, each price column in section 3 shall read NULL on every API read path
  (list, detail, embed, RPC result); the row, its quantities and its status remain visible.
- **FR-005** While the setting is true and the actor may see prices, each price column shall read its real value.
- **FR-006** Writes are unchanged: a hidden actor's inputs keep their existing rules; a hidden actor cannot read back a price through the write response.
- **FR-007** Frontend: `canSeePrices` mirrors the SQL on the real role and the setting; when it is false, price columns, fields and totals
  are not rendered (no empty column, no dash column), and layouts close up. Where the server returned a price as NULL for a person who
  may see prices (genuinely empty), the cell renders as today.
- **FR-008** Administration > Organisation shows the toggle "Hide prices from requesters" (Admin-only control, state visible to Admins),
  English and Bahasa Indonesia labels.
- **FR-009** Any surface that sums or derives a figure from hidden prices (totals, remaining, variance) shall be hidden with them.
- **NFR-001** Existing RLS, RPCs and tests unchanged and green; no new method on an existing repository (new standalone modules only).

## 3. Price surface inventory (every read that returns a unit price or amount)

| # | Surface | Price columns | Covered by |
|---|---|---|---|
| S1 | `procurements` (list, detail, project procurement list) | `total_value`, `approved_total_value` | masked view |
| S2 | `procurement_items` | `rate`, `amount`, `erp_line_amount` | masked view |
| S3 | `procurement_invoices` | `amount`, `tax_amount`, `withheld_amount`, `erp_outstanding_amount` | masked view |
| S4 | `purchase_orders`, `purchase_order_lines`, `po_variation_lines` | `amount`, `rate` | masked views |
| S5 | `stock_document_lines` | `unit_cost` | masked view |
| S6 | `stock_ledger`, `stock_balances` (stock valuation reports, `stockReports.ts`) | `value_delta`, `value_after`, `value_on_hand` | masked views + report RPCs call the helper |
| S7 | read RPCs and views returning the above (committed spend, left after this purchase, approval panel figures) | derived amounts | helper inside the RPC |
| S8 | `material_request_lines` and the material-request RPCs | none (quantities only) | not covered: carries no price or amount |
| S9 | `boq_items.rate`, budget and revenue screens | planning and revenue prices | not covered: not request, procurement or stock reads; open question Q2 |

The build re-greps the DAL (`from('<table>')`, `.rpc(`) for each column before closing the inventory and adds a row for any surface found.

## 4. Acceptance criteria and owning layer

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-001 | Given the setting off, every actor class (legacy five, built-in managers, officers, field) reads every S1-S7 price unchanged. | pgTAP |
| AC-002 | Given the setting on, `actor_may_see_prices()` is false for a built-in officer/field without price right, and for a legacy Engineer without key; true for Buyer, Finance Officer, Billing Officer, every manager, and legacy PM, Finance, Admin, Executive; false for an inactive member. | pgTAP |
| AC-003 | Given the setting on, a hidden actor reading each of S1-S6 gets NULL in each price column and the row, quantity and status intact; a purchasing or finance actor gets the value (one test per surface). | pgTAP |
| AC-004 | Given the setting on, a hidden actor calling each S7 RPC gets NULL derived amounts; a finance actor gets the value. | pgTAP |
| AC-005 | Given the setting on in organisation A, an actor of organisation B (setting off) is unaffected, and A's setting never changes B's reads. | pgTAP |
| AC-006 | Given an Admin, the setting turns on and off; given a non-Admin or another organisation's Admin, `set_hide_prices_enabled` is refused (42501) and the value is unchanged; default reads false. | pgTAP |
| AC-007 | Given a hidden actor inserting or updating a procurement line, the write follows existing rules and the response carries no price. | pgTAP |
| AC-008 | Given `canSeePrices`, when ctx is each role/key/setting combination, then it equals the SQL table in AC-002 (independent literal list). | vitest |
| AC-009 | Given a hidden person on Procurement list/detail, Stock documents and Stock reports, then no price column, field or total renders and the layout has no gap; given a person who may see prices, columns render as today. | vitest |
| AC-010 | Given Administration > Organisation, then the toggle shows Off by default, an Admin switches it, a non-Admin sees no control; labels exist in English and Bahasa Indonesia. | vitest |
| AC-HP-001 | Given an Admin who turns the setting on, a requester (legacy Engineer) opens a purchase and sees no prices while a Finance person sees them. | E2E (serial lane) |

Mutation checks (reported in the build report, each turns the named AC red then is restored): `actor_may_see_prices` returns true (AC-003, AC-004);
drop the legacy-Engineer clause (AC-002); drop the setting test (AC-001 on, or AC-005); remove the helper from one surface's view (that surface's AC-003 row);
drop the Admin check in the setter (AC-006).

## 5. Settings the client controls

The setting, per organisation (`hide_prices_from_requesters`, default false = unchanged). Which role sees prices is not a setting here:
it follows #2709's role set.

## 6. Not in this ticket

Hiding budget, BOQ or revenue figures (Q2); per-field price rules; custom roles (Q1 2027). Nothing else deferred.
