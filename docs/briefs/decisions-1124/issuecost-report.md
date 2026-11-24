# Issue-cost lane report

Branch: `feat/1124d-issue-cost`, ships alone. Migrations: 2240, 2241 and 2242, each with a rollback.

Admin can now configure stock issue costing under Administration → Accounting, using an on/off checkbox and effective date. The shared DateField, Checkbox and Button primitives handle the form; English and Bahasa include both refusal messages. The setting is also listed in All settings and the command palette. Its two global catalogue labels follow the existing shared-catalogue common-key registration; feature form copy remains in the Administration namespace.

No setting means off for existing organisations. On the PMO-paid basis, posted issues from the chosen date contribute their existing stock-ledger value, and returns subtract their existing ledger value. No costing algorithm or ERP write path was added.

`purchase_costs_as_stock(uuid)` is the one whole-purchase classifier: a procurement-linked Posted receive is stocked when received on/after the effective date, or when its purchase belongs to the pre-date set saved at enablement in `stock_issue_cost_purchases`. The setter captures that set and its historical-cost refusal together in one SQL statement, then stores the date and set atomically. Readers never re-evaluate later invoice/payment dates against the saved set. Accepted settings changes rebuild or clear the set; refused changes preserve it. ERP-ledger organisations and earlier stock purchases with historical cost still refuse enabling.

The common stock-value source is `stock_issue_cost_lines(uuid)`. Reader changes:
- `work_order_cost_amounts_unrounded`: existing canonical work-order wrappers feed plan versus actual, profit per work order and discipline, and work-order dashboard direct cost.
- `project_finance_actuals`: project-finance totals and categories.
- `project_pmo_spent_position`: individual project spent figure.
- `project_pmo_positions`: dashboard and project-budget-position spent figures.

Spec: `docs/specs/stock-issue-direct-cost.spec.md`.
Owning tests: `2240_stock_issue_cost.test.sql` (AC-ISC-001–005), `2241_stock_issue_cutover.test.sql` (AC-ISC-006), `StockIssueCostSettings.test.tsx` (AC-ISC-007), `2242_stock_issue_snapshot.test.sql` (AC-ISC-008).

The additional cutover proof receives 999 into stock on the 15th, enables on the 16th, bills/pays on the 17th and issues on the 18th. Partial issue cost 30 plus ledger-derived stock remainder 969 equals 999; full issue cost 999 plus remaining stock 0 equals 999. Project cost removes the separate 1100 direct-delivery fixture before the same conservation assertion. A mutation removes the dated-history classifier branch and changes the conservation oracle; restoring the shipped body restores the intended result. The original 2240 ledger proof retains the two-work-order and return example.

The snapshot proof adds a bill entered after switch-on with an invoice date before it, plus a further invoice-date correction. Partial and full stock consumption conserve the bill value in both project and work-order readers. Removing the saved-set lookup changes the conservation oracle; restoring it restores the intended value. The test also covers rejected/accepted date changes, switching off/on, direct-write refusal, and visibility checks against a populated own-organisation snapshot.

Validation (source candidate `614fb4242`; the final report commit changes documentation only):
- Spare-runner pgTAP: 2240, 2241, 2242, 0997 work-order finance and 0178 definer ACL inventory, 151 assertions passing.
- UI source is unchanged from `1e7be4a85`; the prior targeted UI evidence below is retained without repeating those checks.
- Targeted UI/shell/policy run: 215 assertions passing, including six new RTL cases for enable, disable/read state, both refusals, role affordance and required date.
- Targeted UI/catalogue/palette run: 52 assertions passing (six RTL assertions overlap the prior run).
- Fresh `npm run check:guards`, `npm run typecheck`, restated-function guard and `git diff --check origin/dev`: passing. No JS/TS file changed in the snapshot follow-up; prior touched-file ESLint evidence remains applicable.
- Affected-e2e selection was generated; no local journeys ran under the dispatch's shared-Mac restriction. Rendered captures/ux-proof at `/administration/accounting` remain for the integration executor under that restriction.

Approved follow-ups remain in `issuecost-open.md`: historical-stock migration, ERP reconciliation and per-line classification for mixed deliveries. No dependency on the receive lane, no PR, merge or production action.

Execution ownership: this worker owns this branch and local scoped checks; the spare runner owns touched pgTAP; the coordinator owns rendered acceptance, review and CI acceptance. Source and runtime proof are ready for review.

DONE: 1124d-issuecost
