# Profit and finance screens run with no accounting system connected

Issue #2734 (map #2516). Status: **Draft, 2026-11-21**. IDs: `FR-NEF-###`, `AC-NEF-###`.
Executor: Orca worker; stacked on #2733 ([earned-billed-revenue](earned-billed-revenue.spec.md)) on #2669
([discipline-profit](discipline-profit.spec.md)). Plan `docs/plans/2026-11-21-no-erp-finance-screens.md`.
**Money path: read-only, front-end only.** No posting, no SoD change, no migration, no new setting.
Not in this ticket: a general ledger, trial balance or balance sheet inside PMO.

**Job story.** When my organisation runs PMO with no accounting system connected, I want every profit and finance
screen I can open to work from PMO's own records, so I get project profit without setting up an ERP.

## 1. AS-IS
- "No ERP" is not a flag. It is the absence of an externally-owned domain (`external_domain_ownership` rows, read by
  `useExternalDomainOwnership`) and of an active integration binding (`useDomainOwnershipMode().orgBound === false`).
  PMO owns customer invoices and receipts in that case (`useRevenueMode() === 'native'`, #784, DD-NAR-1); the cost
  basis is the committed-purchase proxy (`ledgerBasis === 'pmo'`, glossary: Actual).
- Statements (`pages/FinancialStatements.tsx`, route `/finance/statements`, feature `financial_statements`) reads saved
  ERP statements (`useFinancialStatementCatalogue`) or the Odoo ledger. With none connected the read is `unavailable`
  and `FinancialStatementsSection` shows "No statements yet / Statements come from the accounting system." plus the
  Admin-only action "Set up accounting" (`finance:statements.setUp`). The Finance hub's Net profit tile shows
  "accounting disconnected" with a hidden "Set up" link to `/administration/integrations`.
- The management profit and loss PMO produces itself is the **Reports** screen (management pack, `/finance/reports`,
  `pages/ManagementPack.tsx`): recognised, invoiced and unbilled per project, and, while the #2669 setting is on, earned,
  gap to invoiced, project cost and margin on both bases (`pages/ManagementPackEarned.tsx`, #2733).

## 2. Walk: every finance and profit screen as a no-ERP organisation
Verdict key: **Works** = reads PMO's own records, no change · **Change** = changed for no-ERP only · **Hidden** = not
offered. "Journey" is the one test that proves it (§6). Verdicts marked * are confirmed by reading the screen's data
source in plan task 1 before any code; a screen found otherwise is fixed in this ticket or listed as an open item.

| # | Screen (route) | Source today | Verdict |
|---|---|---|---|
| 1 | Work-order profit and plan versus actual (project Work orders tab, `WorkOrderPlanVsActual`, #2519/#2670/#2732) | PMO attributed cost, PMO validated revenue | Works |
| 2 | Discipline profit and earned/billed (project Work orders tab, #2669/#2733) | PMO records, `disciplineProfit` / `earnedBilled` RPCs | Works (setting-gated, unchanged) |
| 3 | Project money block (`ProjectFinancesSection`) | `ledgerBasis === 'pmo'` proxy cost, PMO invoices | Works |
| 4 | Project profit and loss section (`ProjectProfitLossSection`) | Saved ERP statement totals; renders nothing when unavailable | Works* (already hides itself) |
| 5 | Reports, management pack (`/finance/reports`, #2733) | `get_management_pack`, `management_pack_earned` | Works, and is the target of 7 |
| 6 | Receivables (`/finance/receivables`), Sales invoices, Incoming payments | PMO-native rows (`pmo_native`, #784) | Works |
| 7 | **Statements (`/finance/statements`)** | ERP saved reports / Odoo ledger | **Change** (FR-NEF-001..004) |
| 8 | Finance hub Net profit tile (`/finance`) | `get_finance_hub_figures`, ledger net profit | **Change** (FR-NEF-005) |
| 9 | Payables (`/finance/payables`), Procurement bills | PMO-native vendor bills (#2525 family) | Works* |
| 10 | Billing (project Billing tab, work-order invoicing, progress claims) | PMO-native invoices, `WorkOrdersTab.billing` | Works* |
| 11 | Site cash (Imprest floats, expense claims, #2732) | PMO records | Works |
| 12 | Journals (`/journals`) | PMO manual journals (#895) | Works* |
| 13 | ERP purchases (`/erp-purchases`, feature `erp_purchases`) | ERP documents only | Hidden (already entitlement-gated); journey asserts it is not linked from Finance in a no-ERP org |
| 14 | Finance hub receivable, payable and ageing tiles | PMO rows | Works |

## 3. Requirements (EARS)
- FR-NEF-001 Where the organisation has no accounting system connected (no externally-owned domain and no active
  integration binding, both reads settled), when a viewer allowed to see financial statements opens Statements, the
  screen shall show the management profit and loss entry instead of the "set up accounting" empty state.
- FR-NEF-002 The entry shall be one card: the title "Management profit and loss", one line "Ledger statements (trial
  balance, profit and loss, balance sheet) come from an accounting system when one is connected.", and one primary
  action "Open reports" that navigates to `/finance/reports`.
- FR-NEF-003 The "Set up accounting" action shall remain available to a viewer who may manage integrations, as a
  secondary action in the same card, so connecting later is one click away.
- FR-NEF-003a For a viewer who may manage the organisation's accounting settings (Admin), the card carries one more line pointing to the Profit per discipline setting (Administration > Accounting) that adds cost and margin to the report; other roles see nothing extra. The setting's default is not changed.
- FR-NEF-004 While either read is loading the screen shall show its existing loading state, never the PMO card; if
  either read failed it shall show the existing unavailable state unchanged (fail closed to today's behaviour, so a
  connected organisation can never see the card).
- FR-NEF-005 Where the organisation has no accounting system connected, the Finance hub Net profit tile shall link to
  `/finance/reports` with the unavailable reason "see management profit and loss", and shall not show the "Set up"
  hidden link. Its label, figure and behaviour elsewhere are unchanged.
- FR-NEF-006 Where an accounting system is connected (ERPNext or Odoo), Statements, the Finance hub tile and every other
  screen in §2 shall render exactly as before.
- FR-NEF-007 The Statements card shall appear only to roles that already pass `may('view','financialStatements')` and
  feature `financial_statements`; the destination keeps its own role and feature gates (Reports needs `management_pack`;
  if not entitled the action is not shown and the line alone remains).
- FR-NEF-008 Usable at 390 px; English and Bahasa Indonesia; `DESIGN.md` tokens and the existing `ListState` empty
  shape; no new colour or spacing.

## 4. Settings
None. "No accounting system connected" is derived from existing ownership and binding reads (§1). Nothing is OFF by
default because nothing is stored; an organisation that connects an accounting system sees today's screens at once.

## 5. Database-enforced rules and proofs
None added: no new data, RPC, policy or migration. Reports and every §2 screen keep their existing role gates and RLS,
proved by their existing pgTAP files. The card grants no access (a link plus text).

## 6. Acceptance criteria
| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-NEF-001 | Given a no-ERP org and a Finance user, when they open Statements, then they see "Management profit and loss", the one-line ledger explanation and "Open reports", and no "No statements yet". | Unit + E2E |
| AC-NEF-002 | Given the card, when the user clicks "Open reports", then they land on `/finance/reports` showing the management pack. | E2E |
| AC-NEF-003 | Given an Admin in a no-ERP org, then "Set up accounting" is also offered and goes to integrations; given Finance, it is absent. | Unit |
| AC-NEF-004 | Given ownership or bindings still loading, or either read failed, then the PMO card never shows. | Unit |
| AC-NEF-005 | Given an org with an ERP binding or an externally-owned domain and no published statement, then Statements shows today's "No statements yet" with "Set up accounting" and no PMO card. | Unit |
| AC-NEF-006 | Given a no-ERP org, when Finance opens the Finance hub, then Net profit links to Reports with "see management profit and loss" and has no "Set up" link; given an ERP org it is unchanged. | Unit |
| AC-NEF-007 | Given a no-ERP org, one journey per screen in §2 rows 1-12 opens it as that org and asserts it renders its own records (not an error, not "set up accounting", no ERP-only wording); row 13 is not linked. | E2E (one spec per row, `AC-NEF-010..021`) |
| AC-NEF-008 | Given Bahasa Indonesia, every new string is translated and the card fits at 390 px. | Unit (i18n) + screenshots |

**Mutation-check plan (written, not run under the gate change):** make the no-ERP derivation return true while a binding
is active and AC-NEF-005 goes red; drop the loading guard and AC-NEF-004 goes red; point the action elsewhere and
AC-NEF-002 goes red.

## 7. Walk result (build, 2026-11-21)
Read against each screen's data source. Only two screens needed a no-ERP change (rows 7 and 8); no screen was found that
neither works from PMO's records nor is hidden, and none needs new money logic. Journals (row 12) shows its Odoo notice
only for an Odoo organisation. Payables, billing and journals read PMO-native rows (#784 and the PMO-native vendor bill
slices); the e2e journeys prove each opens cleanly. Implementation note: the Finance hub reads "no accounting system"
through a route wrapper (`FinanceHubRoute`), so `FinanceHub` itself gained only an optional prop and its tests are untouched.

## 7a. Rulings (coordinator, 2026-11-21)
No setting default changes (open question 1 closed). A screen that does neither is hidden for no-ERP organisations only.

## 7b. Open questions
1. The management profit and loss margin columns exist only while `discipline_profit_enabled` is on (#2669/#2733). With it
   off the pack still shows recognised, invoiced and unbilled but no cost or margin. Proposed: leave as is, and make the
   card say nothing about margins; owner may want the setting default on for no-ERP orgs (a separate ruling).
2. Starred verdicts (§2) are confirmed by reading in plan task 1; any no-ERP gap found beyond Statements and the hub tile
   is reported rather than silently expanded.

## 8. Out of scope
A general ledger, trial balance or balance sheet in PMO; changing any ERP-connected screen; new settings or migrations.
